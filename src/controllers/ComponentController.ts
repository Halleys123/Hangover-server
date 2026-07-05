import type { Request, Response, NextFunction } from 'express';
import { Component } from '../models/Component.js';
import { Datasheet } from '../models/Datasheet.js';
import { derivePins } from '../utils/derivePins.js';
import { normalizeExtractedSpecs } from '../services/cognee.js';
import { logger } from '../utils/logger.js';

export class ComponentController {
  // Utility function to execute persistent healing of a component in MongoDB
  public async persistHealComponent(comp: any): Promise<boolean> {
    if (!comp) return false;
    const nStr = (comp.name || '').toLowerCase();
    const classStr = ((comp.cogneeConfig && comp.cogneeConfig['Component Classification']) || '').toString().toLowerCase();
    
    const isArduinoUno = nStr.includes('a000066') || nStr.includes('uno') || nStr.includes('arduino') || classStr.includes('uno') || classStr.includes('arduino');
    const isEsp32 = nStr.includes('esp32') || nStr.includes('wroom') || classStr.includes('esp32');
    const is2WireCooler = nStr.includes('fhs') || nStr.includes('tec') || nStr.includes('peltier') || nStr.includes('cooler') || nStr.includes('fan');
    const isLed = nStr.includes('led') || nStr.includes('light') || nStr.includes('diode') || nStr.includes('opto') || classStr.includes('led') || classStr.includes('diode');

    let updated = false;
    const healedConfig = normalizeExtractedSpecs(comp.name, comp.cogneeConfig || {});

    if (isArduinoUno) {
      if (comp.category !== 'microcontroller' || comp.description?.toLowerCase().includes('sensor') || comp.description?.toLowerCase().includes('humidity') || !comp.diagram?.pins?.right?.some((p: any) => p.id?.toLowerCase() === 'd0')) {
        comp.category = 'microcontroller';
        comp.description = '32-Bit Microcontroller / Arduino Uno Rev3 Board • AI Specs';
        comp.cogneeConfig = healedConfig;
        comp.diagram = derivePins(comp.name, healedConfig);
        updated = true;
      }
    } else if (isEsp32) {
      if (comp.category !== 'microcontroller' || comp.description?.toLowerCase().includes('sensor') || comp.description?.toLowerCase().includes('humidity') || !comp.diagram?.pins?.right?.some((p: any) => p.id?.toLowerCase() === 'gpio2')) {
        comp.category = 'microcontroller';
        comp.description = '32-Bit Microcontroller / ESP32 NodeMCU Module • AI Specs';
        comp.cogneeConfig = healedConfig;
        comp.diagram = derivePins(comp.name, healedConfig);
        updated = true;
      }
    } else if (is2WireCooler && comp.diagram?.pins?.right?.length > 0) {
      comp.cogneeConfig = healedConfig;
      comp.diagram = derivePins(comp.name, comp.cogneeConfig);
      updated = true;
    } else if (isLed) {
      const derived = derivePins(comp.name, healedConfig);
      if (comp.category !== 'optoelectronics' || comp.description?.toLowerCase().includes('microcontroller') || !comp.diagram?.pins?.right?.some((p: any) => p.id?.toLowerCase() === 'cathode' || p.label?.toLowerCase().includes('cathode'))) {
        comp.category = 'optoelectronics';
        comp.description = 'Optoelectronic LED / Light Emitting Diode • AI Specs';
        comp.cogneeConfig = healedConfig;
        comp.diagram = derived;
        updated = true;
      }
    } else if (comp.cogneeConfig) {
      const derived = derivePins(comp.name, comp.cogneeConfig);
      if (JSON.stringify(comp.diagram) !== JSON.stringify(derived)) {
        comp.diagram = derived;
        updated = true;
      }
    }

    if (updated) {
      try {
        await Component.updateOne({ _id: comp._id }, {
          $set: {
            category: comp.category,
            description: comp.description,
            cogneeConfig: comp.cogneeConfig,
            diagram: comp.diagram
          }
        });
        if (comp.datasheetId) {
          await Datasheet.updateOne({ _id: comp.datasheetId }, {
            $set: { cogneeConfig: comp.cogneeConfig }
          });
        }
      } catch (err: any) {
        logger.error(`[ComponentController] Failed to persist heal for component ${comp._id}:`, err.message || err);
      }
    }
    return updated;
  }

  // Dynamic in-memory healing helper to make GET responses physically accurate without triggering DB writes
  public healComponentsInPlace(items: any[]): any[] {
    for (const comp of items) {
      if (!comp) continue;
      const nStr = (comp.name || '').toLowerCase();
      const classStr = ((comp.cogneeConfig && comp.cogneeConfig['Component Classification']) || '').toString().toLowerCase();
      
      const isArduinoUno = nStr.includes('a000066') || nStr.includes('uno') || nStr.includes('arduino') || classStr.includes('uno') || classStr.includes('arduino');
      const isEsp32 = nStr.includes('esp32') || nStr.includes('wroom') || classStr.includes('esp32');
      const is2WireCooler = nStr.includes('fhs') || nStr.includes('tec') || nStr.includes('peltier') || nStr.includes('cooler') || nStr.includes('fan');
      const isLed = nStr.includes('led') || nStr.includes('light') || nStr.includes('diode') || nStr.includes('opto') || classStr.includes('led') || classStr.includes('diode');

      const healedConfig = normalizeExtractedSpecs(comp.name, comp.cogneeConfig || {});

      if (isArduinoUno) {
        if (comp.category !== 'microcontroller' || comp.description?.toLowerCase().includes('sensor') || comp.description?.toLowerCase().includes('humidity') || !comp.diagram?.pins?.right?.some((p: any) => p.id?.toLowerCase() === 'd0')) {
          comp.category = 'microcontroller';
          comp.description = '32-Bit Microcontroller / Arduino Uno Rev3 Board • AI Specs';
          comp.cogneeConfig = healedConfig;
          comp.diagram = derivePins(comp.name, healedConfig);
        }
      } else if (isEsp32) {
        if (comp.category !== 'microcontroller' || comp.description?.toLowerCase().includes('sensor') || comp.description?.toLowerCase().includes('humidity') || !comp.diagram?.pins?.right?.some((p: any) => p.id?.toLowerCase() === 'gpio2')) {
          comp.category = 'microcontroller';
          comp.description = '32-Bit Microcontroller / ESP32 NodeMCU Module • AI Specs';
          comp.cogneeConfig = healedConfig;
          comp.diagram = derivePins(comp.name, healedConfig);
        }
      } else if (is2WireCooler && comp.diagram?.pins?.right?.length > 0) {
        comp.cogneeConfig = healedConfig;
        comp.diagram = derivePins(comp.name, comp.cogneeConfig);
      } else if (isLed) {
        const derived = derivePins(comp.name, healedConfig);
        if (comp.category !== 'optoelectronics' || comp.description?.toLowerCase().includes('microcontroller') || !comp.diagram?.pins?.right?.some((p: any) => p.id?.toLowerCase() === 'cathode' || p.label?.toLowerCase().includes('cathode'))) {
          comp.category = 'optoelectronics';
          comp.description = 'Optoelectronic LED / Light Emitting Diode • AI Specs';
          comp.cogneeConfig = healedConfig;
          comp.diagram = derived;
        }
      } else if (comp.cogneeConfig) {
        const derived = derivePins(comp.name, comp.cogneeConfig);
        if (JSON.stringify(comp.diagram) !== JSON.stringify(derived)) {
          comp.diagram = derived;
        }
      }
    }
    return items;
  }

  public async getCatalog(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { category, search } = req.query as Record<string, string>;
      let result = await Component.find({ userId: req.user!._id })
        .populate('datasheetId', 'name size parsed uploadedAt')
        .sort({ createdAt: -1 });

      this.healComponentsInPlace(result);

      if (category) result = result.filter((c) => c.category === category);
      if (search) {
        const q = search.toLowerCase();
        result = result.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.description.toLowerCase().includes(q) ||
            c.category.toLowerCase().includes(q),
        );
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  public async getCategories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const items = await Component.find({ userId: req.user!._id });
      res.json([...new Set(items.map((c) => c.category))]);
    } catch (err) {
      next(err);
    }
  }

  public async listComponents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const items = await Component.find({ userId: req.user!._id })
        .populate('datasheetId', 'name size parsed uploadedAt')
        .sort({ createdAt: -1 });
      
      this.healComponentsInPlace(items);
      res.json(items);
    } catch (err) {
      next(err);
    }
  }

  public async getComponentById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const item = await Component.findOne({
        _id: req.params.id,
        userId: req.user!._id,
      }).populate('datasheetId');
      if (!item) {
        res.status(404).json({ error: 'Component not found' });
        return;
      }
      this.healComponentsInPlace([item]);
      res.json(item);
    } catch (err) {
      next(err);
    }
  }

  public async createComponent(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { category, name, description = '', diagram, datasheetId } = req.body;
    if (!category || !name) {
      res.status(400).json({ error: 'category and name are required' });
      return;
    }

    try {
      // Ensure we execute healing during component creation
      const cleanDiagram = diagram ?? derivePins(name, null);

      const item = await Component.create({
        userId: req.user!._id,
        category,
        name,
        description,
        diagram: cleanDiagram,
        datasheetId: datasheetId ?? null,
        cogneeConfig: null,
      });

      // Run persistent healing immediately
      await this.persistHealComponent(item);

      res.status(201).json(item);
    } catch (err) {
      next(err);
    }
  }

  public async deleteComponent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await Component.deleteOne({
        _id: req.params.id,
        userId: req.user!._id,
      });
      if (result.deletedCount === 0) {
        res.status(404).json({ error: 'Component not found' });
        return;
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}

export const componentController = new ComponentController();
