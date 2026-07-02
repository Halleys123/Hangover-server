import { Datasheet } from '../models/Datasheet.js';
import { Component } from '../models/Component.js';
import { indexDatasheet } from './cognee.js';
import { derivePins } from '../utils/derivePins.js';

interface QueueJob {
  datasheetId: string;
  filePath: string;
  originalName: string;
}

class PDFQueueService {
  private queue: QueueJob[] = [];
  private isProcessing = false;

  public enqueue(datasheetId: string, filePath: string, originalName: string): void {
    this.queue.push({ datasheetId, filePath, originalName });
    if (!this.isProcessing) {
      this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const job = this.queue.shift()!;

    try {
      // Transition status to processing
      await Datasheet.findByIdAndUpdate(job.datasheetId, {
        status: 'processing',
      });

      console.log(`[PDFQueue] Starting real text extraction & LLM analysis for ${job.originalName}...`);
      const cogneeConfig = await indexDatasheet(job.filePath, job.originalName, job.datasheetId);
      console.log(`[PDFQueue] Successfully extracted specs via Ollama/Cognee for ${job.originalName}:`, cogneeConfig);

      const sheet = await Datasheet.findByIdAndUpdate(job.datasheetId, {
        status: 'completed',
        parsed: true,
        cogneeConfig,
      }, { returnDocument: 'after' });

      if (sheet) {
        const existingComp = await Component.findOne({ datasheetId: sheet._id });
        if (!existingComp) {
          const cleanName = job.originalName.replace(/\.pdf$/i, '').replace(/_Datasheet|_Spec|_Specifications/i, '').trim();
          const isSensor = job.originalName.toLowerCase().includes('dht') || job.originalName.toLowerCase().includes('sensor') || job.originalName.toLowerCase().includes('mpu');
          
          // Derive accurate deterministic visual schematic pins (eliminating random SIG/DATA leads on 2-wire coolers/fans)
          const derivedDiagram = derivePins(cleanName, cogneeConfig);

          await Component.create({
            userId: sheet.userId,
            datasheetId: sheet._id,
            category: isSensor ? 'sensor' : 'microcontroller',
            name: cleanName || 'AI Component',
            description: `${cogneeConfig["Component Classification"] || ((cogneeConfig["Electrical Limits"] as any)?.nominalVoltage ? `${(cogneeConfig["Electrical Limits"] as any).nominalVoltage}V Nominal` : 'AI Extracted')} • AI Specs`,
            diagram: derivedDiagram,
            cogneeConfig
          });
        }
      }
    } catch (err: any) {
      console.error(`Queue job failed for datasheet ${job.datasheetId}:`, err);
      await Datasheet.findByIdAndUpdate(job.datasheetId, {
        status: 'failed',
        error: err.message || 'Extraction failed',
      });
    } finally {
      // Process next item in FIFO queue
      this.processNext();
    }
  }

  public getQueueLength(): number {
    return this.queue.length;
  }
}

export const pdfQueue = new PDFQueueService();
