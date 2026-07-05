import { Component } from '../models/Component.js';
import { Datasheet } from '../models/Datasheet.js';
import { componentController } from '../controllers/ComponentController.js';
import { datasheetController } from '../controllers/DatasheetController.js';
import { logger } from './logger.js';

export async function runStartupHealing(): Promise<void> {
  logger.info('[Startup] Running database schema healing check...');
  try {
    const components = await Component.find({});
    let healedComponentsCount = 0;
    for (const comp of components) {
      const updated = await componentController.persistHealComponent(comp);
      if (updated) healedComponentsCount++;
    }

    const datasheets = await Datasheet.find({});
    let healedDatasheetsCount = 0;
    for (const sheet of datasheets) {
      const updated = await datasheetController.persistHealDatasheet(sheet);
      if (updated) healedDatasheetsCount++;
    }

    logger.info(`[Startup] Finished schema healing. Components healed: ${healedComponentsCount}, Datasheets healed: ${healedDatasheetsCount}`);
  } catch (err: any) {
    logger.error('[Startup] Schema healing encountered an error:', err.message || err);
  }
}
