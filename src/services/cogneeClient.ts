import fs from 'fs';

export interface PinConstraint {
  pinNumber: string | number;
  pinName: string;
  outputVoltage: number;
  maxInputTolerance: number;
  pinType?: 'power' | 'ground' | 'digital_out' | 'digital_in' | 'analog' | 'bidirectional';
  description?: string;
}

export interface ComponentGraphNode {
  dataset: string;
  componentName: string;
  description?: string;
  operatingVoltageRange?: { min: number; max: number };
  maxCurrentDrawmA?: number;
  pins: Record<string, PinConstraint>;
  rawText?: string;
  updatedAt: Date;
}

// Internal memory store mapping dataset -> componentName -> ComponentGraphNode
const memoryGraphStore: Map<string, Map<string, ComponentGraphNode>> = new Map();

export class CogneeClient {
  private getApiUrl(): string | undefined {
    return process.env.COGNEE_BASE_URL || process.env.COGNEE_API_URL;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (process.env.COGNEE_API_KEY) {
      headers['X-API-KEY'] = process.env.COGNEE_API_KEY;
    }
    return headers;
  }

  /**
   * Remember: Ingests datasheet text into Cognee Cloud (multipart/form-data) AND local graph store.
   */
  public async remember(params: {
    dataset: string;
    filePath?: string;
    componentName?: string;
    text?: string;
    extractedSpecs?: Record<string, any>;
  }): Promise<ComponentGraphNode> {
    const { dataset, filePath, componentName = 'Unknown Component', extractedSpecs } = params;

    // Ensure local graph store exists for this dataset
    if (!memoryGraphStore.has(dataset)) {
      memoryGraphStore.set(dataset, new Map());
    }

    // === COGNEE CLOUD: Upload to real Cognee API ===
    const apiUrl = this.getApiUrl();
    if (apiUrl && process.env.COGNEE_API_KEY) {
      try {
        const form = new FormData();

        // If we have a physical PDF file, upload the file itself
        if (filePath && fs.existsSync(filePath)) {
          const fileBuffer = fs.readFileSync(filePath);
          const blob = new Blob([fileBuffer], { type: 'application/pdf' });
          const fileName = componentName.replace(/[^a-zA-Z0-9_-]/g, '_') + '.pdf';
          form.append('data', blob, fileName);
        } else if (params.text) {
          // Upload text content as a .txt file
          const textBlob = new Blob([params.text], { type: 'text/plain' });
          form.append('data', textBlob, `${componentName.replace(/[^a-zA-Z0-9_-]/g, '_')}_specs.txt`);
        } else if (extractedSpecs) {
          // Upload extracted specs as a JSON file
          const jsonBlob = new Blob([JSON.stringify(extractedSpecs, null, 2)], { type: 'application/json' });
          form.append('data', jsonBlob, `${componentName.replace(/[^a-zA-Z0-9_-]/g, '_')}_extracted.json`);
        }

        const datasetName = dataset.replace(/[^a-zA-Z0-9_-]/g, '_');
        form.append('datasetName', datasetName);

        console.log(`[Cognee Cloud] Uploading to ${apiUrl}/api/v1/add (dataset: ${datasetName}, component: ${componentName})...`);

        const addRes = await fetch(`${apiUrl}/api/v1/add`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: form,
        });

        if (addRes.ok) {
          const addResult = await addRes.json();
          console.log(`[Cognee Cloud] Add succeeded:`, addResult.status || 'OK');

          // Trigger cognify to build knowledge graph
          try {
            const cognifyRes = await fetch(`${apiUrl}/api/v1/cognify`, {
              method: 'POST',
              headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ datasets: [datasetName] }),
            });
            if (cognifyRes.ok) {
              const cognifyResult = await cognifyRes.json();
              console.log(`[Cognee Cloud] Cognify triggered:`, cognifyResult.status || 'OK');
            } else {
              console.warn(`[Cognee Cloud] Cognify response ${cognifyRes.status}:`, await cognifyRes.text());
            }
          } catch (cognifyErr) {
            console.warn('[Cognee Cloud] Cognify call failed (non-blocking):', cognifyErr);
          }
        } else {
          const errText = await addRes.text();
          console.warn(`[Cognee Cloud] Add failed (${addRes.status}):`, errText);
        }
      } catch (err) {
        console.warn('[Cognee Cloud] Upload failed (falling back to embedded store):', err);
      }
    }

    // === LOCAL GRAPH STORE: Always persist locally for immediate recall ===
    const dsMap = memoryGraphStore.get(dataset)!;
    let existingNode = dsMap.get(componentName) || dsMap.get(componentName.replace(/\s+/g, '_'));

    const pins: Record<string, PinConstraint> = existingNode ? { ...existingNode.pins } : {};

    // Generate standard default pins if parsing a newly ingested custom component
    if (Object.keys(pins).length === 0) {
      const voltStr = extractedSpecs?.['Operating Voltage Range'] || extractedSpecs?.['Operating Voltage'] || '';
      const defaultVoltage = voltStr.toString().includes('5V') || voltStr.toString().includes('12V') || voltStr.toString().includes('14') ? 12.0 : 3.3;
      const defaultTolerance = defaultVoltage > 5 ? defaultVoltage * 1.1 : defaultVoltage + 0.3;
      for (let i = 1; i <= 8; i++) {
        pins[String(i)] = {
          pinNumber: i,
          pinName: `Pin ${i}`,
          outputVoltage: defaultVoltage,
          maxInputTolerance: defaultTolerance,
          pinType: 'bidirectional',
          description: `${componentName} Pin ${i} (${defaultVoltage}V Nominal)`
        };
      }
    }

    const newNode: ComponentGraphNode = {
      dataset,
      componentName,
      description: existingNode?.description || `Extracted knowledge graph node for ${componentName}`,
      operatingVoltageRange: existingNode?.operatingVoltageRange || { min: 3.0, max: 3.6 },
      maxCurrentDrawmA: existingNode?.maxCurrentDrawmA || 50,
      pins,
      rawText: params.text || (filePath && fs.existsSync(filePath) ? `Ingested file: ${filePath}` : undefined),
      updatedAt: new Date()
    };

    dsMap.set(componentName, newNode);
    return newNode;
  }

  /**
   * Recall: Retrieves from Cognee Cloud search first, falls back to local store.
   */
  public async recall(params: {
    dataset: string;
    query?: string;
    componentName?: string;
    pinNumber?: string | number;
  }): Promise<any> {
    const { dataset, query, componentName, pinNumber } = params;

    // Ensure local store
    if (!memoryGraphStore.has(dataset)) {
      memoryGraphStore.set(dataset, new Map());
    }

    // === COGNEE CLOUD SEARCH ===
    const apiUrl = this.getApiUrl();
    if (apiUrl && process.env.COGNEE_API_KEY && query) {
      try {
        const searchRes = await fetch(`${apiUrl}/api/v1/search`, {
          method: 'POST',
          headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            searchType: 'CHUNKS',
          }),
        });
        if (searchRes.ok) {
          const results = await searchRes.json();
          if (Array.isArray(results) && results.length > 0) {
            console.log(`[Cognee Cloud] Search returned ${results.length} chunks for "${query}"`);
            return results;
          }
        }
      } catch (err) {
        console.warn('[Cognee Cloud] Search failed, using local graph store');
      }
    }

    // === LOCAL GRAPH STORE FALLBACK ===
    const dsMap = memoryGraphStore.get(dataset)!;

    // If requesting specific pin constraints for Layer 1 Data Retrieval
    if (componentName && pinNumber !== undefined) {
      const comp = dsMap.get(componentName) || 
                   Array.from(dsMap.values()).find(c => c.componentName.toLowerCase() === componentName.toLowerCase());
      
      if (comp && comp.pins[String(pinNumber)]) {
        return comp.pins[String(pinNumber)];
      }

      // If specific pin not listed, return component default limits
      const defaultOut = comp ? (comp.operatingVoltageRange?.max || 3.3) : 3.3;
      const defaultIn = comp ? ((comp.operatingVoltageRange?.max || 3.3) + 0.3) : 3.6;
      return {
        pinNumber,
        pinName: `Pin ${pinNumber}`,
        outputVoltage: defaultOut,
        maxInputTolerance: defaultIn,
        description: comp ? `${comp.componentName} nominal pin limit` : `Default safety constraint (3.3V nominal)`
      };
    }

    // If general query or recall for chat context
    const allComponents = Array.from(dsMap.values());
    if (query) {
      const lowerQ = query.toLowerCase();
      const matched = allComponents.filter(c => 
        c.componentName.toLowerCase().includes(lowerQ) ||
        (c.description && c.description.toLowerCase().includes(lowerQ))
      );
      return matched.length > 0 ? matched : allComponents;
    }

    return allComponents;
  }
}

export const cognee = new CogneeClient();
