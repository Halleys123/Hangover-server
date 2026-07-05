import { Component } from '../models/Component.js';
import { Datasheet } from '../models/Datasheet.js';
import { Project } from '../models/Project.js';
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

    const projects = await Project.find({});
    let healedProjectsCount = 0;
    for (const proj of projects) {
      if (!proj.datasheets || proj.datasheets.length === 0) {
        const userSheets = await Datasheet.find({ userId: proj.userId });
        if (userSheets.length > 0) {
          proj.datasheets = userSheets.map(s => s._id as any);
          await proj.save();
          healedProjectsCount++;
        }
      }
    }

    logger.info(`[Startup] Finished schema healing. Components: ${healedComponentsCount}, Datasheets: ${healedDatasheetsCount}, Projects: ${healedProjectsCount}`);
  } catch (err: any) {
    logger.error('[Startup] Schema healing encountered an error:', err.message || err);
  }
}
