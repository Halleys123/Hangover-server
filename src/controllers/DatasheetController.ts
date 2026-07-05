import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { Datasheet } from '../models/Datasheet.js';
import { Component } from '../models/Component.js';
import { Project } from '../models/Project.js';
import { pdfQueue } from '../services/pdfQueue.js';
import { refineDatasheetSpecs, normalizeExtractedSpecs } from '../services/cognee.js';
import { derivePins } from '../utils/derivePins.js';
import { logger } from '../utils/logger.js';

export class DatasheetController {
  // Utility function to execute persistent healing of a datasheet and its connected component in MongoDB
  public async persistHealDatasheet(sheet: any): Promise<boolean> {
    if (!sheet) return false;
    const nStr = (sheet.name || '').toLowerCase();
    const classStr = ((sheet.cogneeConfig && sheet.cogneeConfig['Component Classification']) || '').toString().toLowerCase();
    
    const isArduinoUno = nStr.includes('a000066') || nStr.includes('uno') || nStr.includes('arduino') || classStr.includes('uno') || classStr.includes('arduino');
    const isEsp32 = nStr.includes('esp32') || nStr.includes('wroom') || classStr.includes('esp32');
    const is2WireCooler = nStr.includes('fhs') || nStr.includes('tec') || nStr.includes('peltier') || nStr.includes('cooler') || nStr.includes('fan');
    const isLed = nStr.includes('led') || nStr.includes('light') || nStr.includes('diode') || nStr.includes('opto') || classStr.includes('led') || classStr.includes('diode');

    let updated = false;
    const healedConfig = normalizeExtractedSpecs(sheet.name, sheet.cogneeConfig || {});

    if (isArduinoUno) {
      if (!sheet.cogneeConfig || sheet.cogneeConfig["Component Classification"]?.toLowerCase().includes('sensor') || !sheet.cogneeConfig?.Pins?.digital?.some((p: any) => p.id?.toLowerCase() === 'd0')) {
        sheet.cogneeConfig = healedConfig;
        updated = true;
      }
    } else if (isEsp32) {
      if (!sheet.cogneeConfig || sheet.cogneeConfig["Component Classification"]?.toLowerCase().includes('sensor') || !sheet.cogneeConfig?.Pins?.digital?.some((p: any) => p.id?.toLowerCase() === 'gpio2')) {
        sheet.cogneeConfig = healedConfig;
        updated = true;
      }
    } else if (is2WireCooler && sheet.cogneeConfig?.Pins?.digital?.length > 0) {
      sheet.cogneeConfig = healedConfig;
      updated = true;
    } else if (isLed) {
      if (!sheet.cogneeConfig || sheet.cogneeConfig["Component Classification"]?.toLowerCase().includes('microcontroller') || !sheet.cogneeConfig?.Pins?.ground?.some((p: any) => p.id?.toLowerCase() === 'cathode' || p.name?.toLowerCase().includes('cathode'))) {
        sheet.cogneeConfig = healedConfig;
        updated = true;
      }
    }

    if (updated) {
      try {
        await Datasheet.updateOne({ _id: sheet._id }, {
          $set: { cogneeConfig: sheet.cogneeConfig }
        });
        const comp = await Component.findOne({ datasheetId: sheet._id });
        if (comp) {
          const derived = derivePins(comp.name, sheet.cogneeConfig);
          const cat = isArduinoUno || isEsp32 ? 'microcontroller' : isLed ? 'optoelectronics' : comp.category;
          const desc = isArduinoUno ? '32-Bit Microcontroller / Arduino Uno Rev3 Board • AI Specs' : isEsp32 ? '32-Bit Microcontroller / ESP32 NodeMCU Module • AI Specs' : isLed ? 'Optoelectronic LED / Light Emitting Diode • AI Specs' : comp.description;
          await Component.updateOne({ _id: comp._id }, {
            $set: {
              category: cat,
              description: desc,
              cogneeConfig: sheet.cogneeConfig,
              diagram: derived
            }
          });
        }
      } catch (err: any) {
        logger.error(`[DatasheetController] Failed to persist heal for datasheet ${sheet._id}:`, err.message || err);
      }
    }
    return updated;
  }

  // Dynamic in-memory healing helper to adjust GET response payloads without DB updates
  public healDatasheetsInPlace(sheets: any[]): any[] {
    for (const sheet of sheets) {
      if (!sheet) continue;
      const nStr = (sheet.name || '').toLowerCase();
      const classStr = ((sheet.cogneeConfig && sheet.cogneeConfig['Component Classification']) || '').toString().toLowerCase();
      
      const isArduinoUno = nStr.includes('a000066') || nStr.includes('uno') || nStr.includes('arduino') || classStr.includes('uno') || classStr.includes('arduino');
      const isEsp32 = nStr.includes('esp32') || nStr.includes('wroom') || classStr.includes('esp32');
      const is2WireCooler = nStr.includes('fhs') || nStr.includes('tec') || nStr.includes('peltier') || nStr.includes('cooler') || nStr.includes('fan');
      const isLed = nStr.includes('led') || nStr.includes('light') || nStr.includes('diode') || nStr.includes('opto') || classStr.includes('led') || classStr.includes('diode');

      const healedConfig = normalizeExtractedSpecs(sheet.name, sheet.cogneeConfig || {});

      if (isArduinoUno) {
        if (!sheet.cogneeConfig || sheet.cogneeConfig["Component Classification"]?.toLowerCase().includes('sensor') || !sheet.cogneeConfig?.Pins?.digital?.some((p: any) => p.id?.toLowerCase() === 'd0')) {
          sheet.cogneeConfig = healedConfig;
        }
      } else if (isEsp32) {
        if (!sheet.cogneeConfig || sheet.cogneeConfig["Component Classification"]?.toLowerCase().includes('sensor') || !sheet.cogneeConfig?.Pins?.digital?.some((p: any) => p.id?.toLowerCase() === 'gpio2')) {
          sheet.cogneeConfig = healedConfig;
        }
      } else if (is2WireCooler && sheet.cogneeConfig?.Pins?.digital?.length > 0) {
        sheet.cogneeConfig = healedConfig;
      } else if (isLed) {
        if (!sheet.cogneeConfig || sheet.cogneeConfig["Component Classification"]?.toLowerCase().includes('microcontroller') || !sheet.cogneeConfig?.Pins?.ground?.some((p: any) => p.id?.toLowerCase() === 'cathode' || p.name?.toLowerCase().includes('cathode'))) {
          sheet.cogneeConfig = healedConfig;
        }
      }
    }
    return sheets;
  }

  public async listDatasheets(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sheets = await Datasheet.find({ userId: req.user!._id }).sort({
        uploadedAt: -1,
      });
      this.healDatasheetsInPlace(sheets);
      res.json(sheets);
    } catch (err) {
      next(err);
    }
  }

  public async getDatasheetById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sheet = await Datasheet.findOne({
        _id: req.params.id,
        userId: req.user!._id,
      });
      if (!sheet) {
        res.status(404).json({ error: 'Datasheet not found' });
        return;
      }
      this.healDatasheetsInPlace([sheet]);
      res.json(sheet);
    } catch (err) {
      next(err);
    }
  }

  public async uploadDatasheet(req: Request, res: Response, next: NextFunction): Promise<void> {
    const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
    if (req.file) files.push(req.file);

    if (files.length === 0) {
      res.status(400).json({ error: 'PDF file(s) required' });
      return;
    }

    try {
      const { projectId } = req.body;
      const createdSheets = [];
      for (const file of files) {
        const sheet = await Datasheet.create({
          userId: req.user!._id,
          name: file.originalname,
          size: this.formatBytes(file.size),
          filePath: file.path,
          parsed: false,
          status: 'waiting',
          cogneeConfig: null,
        });

        if (projectId) {
          await Project.findOneAndUpdate(
            { _id: projectId, userId: req.user!._id },
            { $addToSet: { datasheets: sheet._id } }
          );
        }

        // Enqueue into background queue
        pdfQueue.enqueue(sheet._id.toString(), sheet.filePath, sheet.name);
        createdSheets.push(sheet);
      }

      if (createdSheets.length === 1 && !req.body.multi) {
        res.status(201).json(createdSheets[0]);
      } else {
        res.status(201).json(createdSheets);
      }
    } catch (err) {
      next(err);
    }
  }

  public async linkComponent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const [sheet, component] = await Promise.all([
        Datasheet.findOne({ _id: req.params.id, userId: req.user!._id }),
        Component.findOne({ _id: req.params.componentId, userId: req.user!._id }),
      ]);
      if (!sheet) {
        res.status(404).json({ error: 'Datasheet not found' });
        return;
      }
      if (!component) {
        res.status(404).json({ error: 'Component not found' });
        return;
      }

      component.datasheetId = sheet._id as any;
      await component.save();

      res.json({
        linked: true,
        componentId: component._id,
        datasheetId: sheet._id,
      });
    } catch (err) {
      next(err);
    }
  }

  public async streamFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sheet = await Datasheet.findOne({
        _id: req.params.id,
        userId: req.user!._id,
      });
      if (!sheet) {
        res.status(404).json({ error: 'Datasheet not found' });
        return;
      }
      if (!sheet.filePath || !fs.existsSync(sheet.filePath)) {
        res.status(404).json({ error: 'File not found on disk' });
        return;
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${sheet.name}"`);
      fs.createReadStream(sheet.filePath).pipe(res);
    } catch (err) {
      next(err);
    }
  }

  public async refine(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { prompt } = req.body;
      const sheet = await Datasheet.findOne({
        _id: req.params.id,
        userId: req.user!._id,
      });
      if (!sheet) {
        res.status(404).json({ error: 'Datasheet not found' });
        return;
      }
      if (!sheet.filePath || !fs.existsSync(sheet.filePath)) {
        res.status(404).json({ error: 'File not found on disk for refinement' });
        return;
      }

      const refinedSpecs = await refineDatasheetSpecs(
        sheet.filePath,
        sheet.name,
        sheet.cogneeConfig,
        prompt || '',
        sheet._id.toString()
      );

      sheet.cogneeConfig = refinedSpecs;
      sheet.verificationStatus = 'accepted';
      if (prompt) sheet.userNotes = prompt;
      await sheet.save();

      // Trigger database healing on components linked to this datasheet
      const comp = await Component.findOne({ datasheetId: sheet._id });
      if (comp) {
        comp.cogneeConfig = refinedSpecs;
        const nomVolt = (refinedSpecs["Electrical Limits"] as any)?.nominalVoltage;
        comp.description = `${refinedSpecs["Component Classification"] || (nomVolt ? `${nomVolt}V Nominal` : 'AI Extracted')} • AI Refined Specs`;
        await comp.save();
        await componentController.persistHealComponent(comp);
      }

      res.json(sheet);
    } catch (err) {
      next(err);
    }
  }

  public async review(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { action, feedback, updatedSpecs, useAi } = req.body;
      const sheet = await Datasheet.findOne({
        _id: req.params.id,
        userId: req.user!._id,
      });
      if (!sheet) {
        res.status(404).json({ error: 'Datasheet not found' });
        return;
      }

      if (action === 'accept') {
        sheet.verificationStatus = 'accepted';
        if (updatedSpecs) sheet.cogneeConfig = updatedSpecs;
      } else if (action === 'improve') {
        if (feedback) sheet.userNotes = feedback;
        if (useAi && sheet.filePath && fs.existsSync(sheet.filePath)) {
          const refinedSpecs = await refineDatasheetSpecs(
            sheet.filePath,
            sheet.name,
            sheet.cogneeConfig,
            feedback || '',
            sheet._id.toString()
          );
          sheet.cogneeConfig = refinedSpecs;
          sheet.verificationStatus = 'accepted';
        } else if (updatedSpecs) {
          sheet.cogneeConfig = updatedSpecs;
          sheet.verificationStatus = 'accepted';
        } else {
          sheet.verificationStatus = 'unverified';
        }
      } else if (action === 'forget') {
        sheet.cogneeConfig = null;
        sheet.verificationStatus = 'rejected';
        sheet.parsed = false;
      } else {
        res.status(400).json({ error: 'Invalid action' });
        return;
      }

      await sheet.save();

      // Trigger healing of linked component
      const comp = await Component.findOne({ datasheetId: sheet._id });
      if (comp) {
        comp.cogneeConfig = sheet.cogneeConfig;
        await comp.save();
        await componentController.persistHealComponent(comp);
      }

      res.json(sheet);
    } catch (err) {
      next(err);
    }
  }

  public async deleteDatasheet(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sheet = await Datasheet.findOneAndDelete({
        _id: req.params.id,
        userId: req.user!._id,
      });
      if (!sheet) {
        res.status(404).json({ error: 'Datasheet not found' });
        return;
      }

      if (sheet.filePath) {
        const absPath = path.resolve(sheet.filePath);
        if (fs.existsSync(absPath)) {
          try { fs.unlinkSync(absPath); } catch (err) { logger.error('Failed to unlink abs path:', err); }
        } else if (fs.existsSync(sheet.filePath)) {
          try { fs.unlinkSync(sheet.filePath); } catch (err) { logger.error('Failed to unlink raw path:', err); }
        }
      }

      // Remove any components auto-created for or linked exclusively to this datasheet
      await Component.deleteMany({ userId: req.user!._id, datasheetId: sheet._id });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

// Importing componentController reference after definition to avoid circularity issues
import { componentController } from './ComponentController.js';

export const datasheetController = new DatasheetController();
