import fs from 'fs';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ComponentGraphNode, type IComponentGraphNode } from '../models/ComponentGraphNode.js';

export interface PinConstraint {
  pinNumber: string | number;
  pinName: string;
  outputVoltage: number;
  maxInputTolerance: number;
  pinType?: 'power' | 'ground' | 'digital_out' | 'digital_in' | 'analog' | 'bidirectional';
  description?: string;
}

export interface ComponentGraphNodeData {
  dataset: string;
  componentName: string;
  description?: string;
  operatingVoltageRange?: { min: number; max: number };
  maxCurrentDrawmA?: number;
  pins: Record<string, PinConstraint>;
  rawText?: string;
  updatedAt: Date;
}

export class CogneeClient {
  private getApiUrl(): string | undefined {
    return env.COGNEE_BASE_URL;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (env.COGNEE_API_KEY) {
      headers['X-API-KEY'] = env.COGNEE_API_KEY;
    }
    return headers;
  }

  /**
   * Remember: Ingests datasheet text into Cognee Cloud (multipart/form-data) AND MongoDB local graph store.
   */
  public async remember(params: {
    dataset: string;
    filePath?: string;
    componentName?: string;
    text?: string;
    extractedSpecs?: Record<string, any>;
  }): Promise<ComponentGraphNodeData> {
    const { dataset, filePath, componentName = 'Unknown Component', extractedSpecs } = params;

    // === COGNEE CLOUD: Upload to real Cognee API ===
    const apiUrl = this.getApiUrl();
    if (apiUrl && env.COGNEE_API_KEY) {
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

        logger.info(`[Cognee Cloud] Uploading to ${apiUrl}/api/v1/add (dataset: ${datasetName}, component: ${componentName})...`);

        const addRes = await fetch(`${apiUrl}/api/v1/add`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: form,
        });

        if (addRes.ok) {
          const addResult = await addRes.json();
          logger.info(`[Cognee Cloud] Add succeeded: ${addResult.status || 'OK'}`);

          // Trigger cognify to build knowledge graph
          try {
            const cognifyRes = await fetch(`${apiUrl}/api/v1/cognify`, {
              method: 'POST',
              headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ datasets: [datasetName] }),
            });
            if (cognifyRes.ok) {
              const cognifyResult = await cognifyRes.json();
              logger.info(`[Cognee Cloud] Cognify triggered: ${cognifyResult.status || 'OK'}`);
            } else {
              logger.warn(`[Cognee Cloud] Cognify response ${cognifyRes.status}: ${await cognifyRes.text()}`);
            }
          } catch (cognifyErr: any) {
            logger.warn('[Cognee Cloud] Cognify call failed (non-blocking):', cognifyErr.message || cognifyErr);
          }
        } else {
          const errText = await addRes.text();
          logger.warn(`[Cognee Cloud] Add failed (${addRes.status}): ${errText}`);
        }
      } catch (err: any) {
        logger.warn('[Cognee Cloud] Upload failed (falling back to embedded store):', err.message || err);
      }
    }

    // === LOCAL GRAPH STORE: Persist in MongoDB for immediate durability ===
    let existingNode = await ComponentGraphNode.findOne({ dataset, componentName });
    if (!existingNode) {
      existingNode = await ComponentGraphNode.findOne({ dataset, componentName: componentName.replace(/\s+/g, '_') });
    }

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

    const nodeData = {
      dataset,
      componentName,
      description: existingNode?.description || `Extracted knowledge graph node for ${componentName}`,
      operatingVoltageRange: existingNode?.operatingVoltageRange || { min: 3.0, max: 3.6 },
      maxCurrentDrawmA: existingNode?.maxCurrentDrawmA || 50,
      pins,
      rawText: params.text || (filePath && fs.existsSync(filePath) ? `Ingested file: ${filePath}` : undefined),
    };

    const savedNode = await ComponentGraphNode.findOneAndUpdate(
      { dataset, componentName },
      { $set: nodeData },
      { new: true, upsert: true }
    );

    return {
      dataset: savedNode.dataset,
      componentName: savedNode.componentName,
      description: savedNode.description,
      operatingVoltageRange: savedNode.operatingVoltageRange,
      maxCurrentDrawmA: savedNode.maxCurrentDrawmA,
      pins: savedNode.pins,
      rawText: savedNode.rawText,
      updatedAt: savedNode.updatedAt,
    };
  }

  /**
   * Recall: Retrieves from Cognee Cloud search first, falls back to local MongoDB store.
   */
  public async recall(params: {
    dataset: string;
    query?: string;
    componentName?: string;
    pinNumber?: string | number;
    sessionId?: string;
  }): Promise<any> {
    const { dataset, query, componentName, pinNumber, sessionId } = params;

    // === COGNEE CLOUD SEARCH ===
    const apiUrl = this.getApiUrl();
    if (apiUrl && env.COGNEE_API_KEY && query) {
      try {
        const datasetName = dataset.replace(/[^a-zA-Z0-9_-]/g, '_');
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
            logger.info(`[Cognee Cloud] Search returned ${results.length} chunks for "${query}" (session: ${sessionId})`);
            return results;
          }
        }
      } catch (err: any) {
        logger.warn('[Cognee Cloud] Search failed, using local graph store:', err.message || err);
      }
    }

    // === LOCAL GRAPH STORE FALLBACK (MongoDB) ===
    // If requesting specific pin constraints for Layer 1 Data Retrieval
    if (componentName && pinNumber !== undefined) {
      let comp = await ComponentGraphNode.findOne({ dataset, componentName });
      if (!comp) {
        comp = await ComponentGraphNode.findOne({
          dataset,
          componentName: { $regex: new RegExp('^' + componentName + '$', 'i') }
        });
      }

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
    const allComponents = await ComponentGraphNode.find({ dataset });
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
    if (apiUrl && env.COGNEE_API_KEY) {
      try {
        const datasetName = params.dataset.replace(/[^a-zA-Z0-9_-]/g, '_');
        logger.info(`[Cognee Cloud] Improving dataset: ${datasetName}...`);
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
          logger.info(`[Cognee Cloud] Improve succeeded for ${datasetName}:`, improveResult);
          return improveResult;
        } else {
          logger.warn(`[Cognee Cloud] Improve failed (${improveRes.status}): ${await improveRes.text()}`);
        }
      } catch (err: any) {
        logger.warn(`[Cognee Cloud] Improve call failed:`, err.message || err);
      }
    }
  }
}

export const cognee = new CogneeClient();
