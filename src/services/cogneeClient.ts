import fs from 'fs';
import crypto from 'crypto';

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

function toUuid(name: string): string {
  // If it's already a valid 32-char simple UUID or standard 36-char UUID, return it
  if (/^[0-9a-fA-F]{32}$/.test(name) || /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(name)) {
    return name.toLowerCase();
  }
  // Generate deterministic UUID simple hex representation using MD5
  return crypto.createHash('md5').update(name).digest('hex');
}

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

  private logCall(operation: string, details: string) {
    const timestamp = new Date().toISOString();
    console.log(`[Cognee Client] [${timestamp}] OPERATION: ${operation.toUpperCase()} | ${details}`);
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

    const datasetName = toUuid(dataset);

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

        form.append('datasetName', datasetName);

        this.logCall('REMEMBER_ADD_START', `Dataset: ${datasetName} (raw: ${dataset}), Component: ${componentName}, API URL: ${apiUrl}/api/v1/add`);

        const addRes = await fetch(`${apiUrl}/api/v1/add`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: form,
        });

        if (addRes.ok) {
          const addResult = await addRes.json();
          this.logCall('REMEMBER_ADD_SUCCESS', `Dataset: ${datasetName}, Component: ${componentName}, Status: ${addResult.status || 'OK'}`);

          // Trigger cognify to build knowledge graph
          try {
            this.logCall('COGNIFY_START', `Dataset: ${datasetName}`);
            const cognifyRes = await fetch(`${apiUrl}/api/v1/cognify`, {
              method: 'POST',
              headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ datasets: [datasetName] }),
            });
            if (cognifyRes.ok) {
              const cognifyResult = await cognifyRes.json();
              this.logCall('COGNIFY_SUCCESS', `Dataset: ${datasetName}, Status: ${cognifyResult.status || 'OK'}`);
            } else {
              this.logCall('COGNIFY_FAILED', `Dataset: ${datasetName}, Status: ${cognifyRes.status}, Error: ${await cognifyRes.text()}`);
            }
          } catch (cognifyErr: any) {
            this.logCall('COGNIFY_ERROR', `Dataset: ${datasetName}, Error: ${cognifyErr.message || cognifyErr}`);
          }
        } else {
          const errText = await addRes.text();
          this.logCall('REMEMBER_ADD_FAILED', `Dataset: ${datasetName}, Status: ${addRes.status}, Error: ${errText}`);
        }
      } catch (err: any) {
        this.logCall('REMEMBER_ERROR', `Dataset: ${datasetName}, Component: ${componentName}, Error: ${err.message || err}`);
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
    sessionId?: string;
  }): Promise<any> {
    const { dataset, query, componentName, pinNumber, sessionId } = params;

    // Ensure local store
    if (!memoryGraphStore.has(dataset)) {
      memoryGraphStore.set(dataset, new Map());
    }

    const datasetName = toUuid(dataset);

    // === COGNEE CLOUD SEARCH ===
    const apiUrl = this.getApiUrl();
    if (apiUrl && process.env.COGNEE_API_KEY && query) {
      try {
        this.logCall('RECALL_START', `Dataset: ${datasetName} (raw: ${dataset}), Query: "${query}", Session: ${sessionId}`);
        const searchRes = await fetch(`${apiUrl}/api/v1/search`, {
          method: 'POST',
          headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            searchType: 'CHUNKS',
            search_type: 'CHUNKS',
            datasets: [datasetName],
            session_id: sessionId,
          }),
        });
        if (searchRes.ok) {
          const results = await searchRes.json();
          if (Array.isArray(results) && results.length > 0) {
            this.logCall('RECALL_SUCCESS', `Dataset: ${datasetName}, Query: "${query}", Returned ${results.length} chunks`);
            return results;
          } else {
            this.logCall('RECALL_EMPTY', `Dataset: ${datasetName}, Query: "${query}", Returned 0 chunks`);
          }
        } else {
          this.logCall('RECALL_FAILED', `Dataset: ${datasetName}, Status: ${searchRes.status}, Error: ${await searchRes.text()}`);
        }
      } catch (err: any) {
        this.logCall('RECALL_ERROR', `Dataset: ${datasetName}, Query: "${query}", Error: ${err.message || err}`);
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

  /**
   * Improve: Triggers enrichment/graph construction on Cognee Cloud.
   */
  public async improve(params: { dataset: string }): Promise<any> {
    const apiUrl = this.getApiUrl();
    if (apiUrl && process.env.COGNEE_API_KEY) {
      const datasetName = toUuid(params.dataset);
      try {
        this.logCall('IMPROVE_START', `Dataset: ${datasetName} (raw: ${params.dataset})`);
        const improveRes = await fetch(`${apiUrl}/api/v1/improve`, {
          method: 'POST',
          headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataset_name: datasetName,
            run_in_background: true,
          }),
        });

        if (improveRes.ok) {
          const improveResult = await improveRes.json();
          this.logCall('IMPROVE_SUCCESS', `Dataset: ${datasetName}`);
          return improveResult;
        } else {
          this.logCall('IMPROVE_FAILED', `Dataset: ${datasetName}, Status: ${improveRes.status}, Error: ${await improveRes.text()}`);
        }
      } catch (err: any) {
        this.logCall('IMPROVE_ERROR', `Dataset: ${datasetName}, Error: ${err.message || err}`);
      }
    }
  }

  /**
   * Forget: Deletes a dataset on Cognee Cloud and clears local memory store.
   */
  public async forget(params: { dataset: string }): Promise<any> {
    const { dataset } = params;
    const datasetName = toUuid(dataset);

    // Clear local graph store
    if (memoryGraphStore.has(dataset)) {
      memoryGraphStore.delete(dataset);
    }

    // === COGNEE CLOUD: Delete dataset via API ===
    const apiUrl = this.getApiUrl();
    if (apiUrl && process.env.COGNEE_API_KEY) {
      try {
        this.logCall('FORGET_START', `Dataset: ${datasetName} (raw: ${dataset})`);
        const deleteRes = await fetch(`${apiUrl}/api/v1/datasets/${datasetName}`, {
          method: 'DELETE',
          headers: this.getHeaders(),
        });
        
        if (deleteRes.ok) {
          this.logCall('FORGET_SUCCESS', `Dataset: ${datasetName}`);
          return { success: true };
        } else {
          this.logCall('FORGET_FAILED', `Dataset: ${datasetName}, Status: ${deleteRes.status}, Error: ${await deleteRes.text()}`);
        }
      } catch (err: any) {
        this.logCall('FORGET_ERROR', `Dataset: ${datasetName}, Error: ${err.message || err}`);
      }
    }
    return { success: false };
  }
}

export const cognee = new CogneeClient();
