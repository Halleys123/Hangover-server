import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Component, type IComponent } from '../models/Component.js';
import { components as catalog } from '../data/components.js';
import { derivePins } from '../utils/derivePins.js';

const router = Router();
router.use(authenticate);

/**
 * Semantic Healing Helper:
 * Evaluates each stored component's diagram representation against its name and extracted Cognee specs.
 * Automatically removes erroneous random SIG/DATA pins on 2-wire coolers/fans (TEC1-12706, FHS-A9015S00)
 * and updates MongoDB in-place so the frontend library and canvas always show the physical truth.
 */
async function healComponentList(items: any[]): Promise<any[]> {
  for (const comp of items) {
    if (!comp) continue;
    const nStr = (comp.name || '').toLowerCase();
    const classStr = ((comp.cogneeConfig && comp.cogneeConfig['Component Classification']) || '').toString().toLowerCase();
    const is2WireCooler = nStr.includes('fhs') || nStr.includes('tec') || nStr.includes('peltier') || nStr.includes('cooler') || nStr.includes('fan');
    
    // If existing database record shows invalid right pins (e.g. SIG/DATA) on a 2-wire power/cooling unit
    if (is2WireCooler && comp.diagram?.pins?.right?.length > 0) {
      const derived = derivePins(comp.name, comp.cogneeConfig);
      comp.diagram = derived;
      try {
        await Component.updateOne({ _id: comp._id }, { $set: { diagram: derived } });
      } catch {}
    }
  }
  return items;
}

router.get('/catalog', async (req, res, next) => {
  try {
    const { category, search } = req.query as Record<string, string>;
    let result = await Component.find({ userId: req.user!._id })
      .populate('datasheetId', 'name size parsed uploadedAt')
      .sort({ createdAt: -1 });

    await healComponentList(result);

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
});

router.get('/catalog/categories', async (req, res, next) => {
  try {
    const items = await Component.find({ userId: req.user!._id });
    res.json([...new Set(items.map((c) => c.category))]);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const items = await Component.find({ userId: req.user!._id })
      .populate('datasheetId', 'name size parsed uploadedAt')
      .sort({ createdAt: -1 });
    await healComponentList(items);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const item = await Component.findOne({
      _id: req.params.id,
      userId: req.user!._id,
    }).populate('datasheetId');
    if (!item) return res.status(404).json({ error: 'Component not found' });
    await healComponentList([item]);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  const { category, name, description = '', diagram, datasheetId } = req.body;
  if (!category || !name)
    return res.status(400).json({ error: 'category and name are required' });

  try {
    const item = await Component.create({
      userId: req.user!._id,
      category,
      name,
      description,
      diagram: diagram ?? { theme: 'blue', pins: { left: [], right: [] } },
      datasheetId: datasheetId ?? null,
      cogneeConfig: null,
    });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await Component.deleteOne({
      _id: req.params.id,
      userId: req.user!._id,
    });
    if (result.deletedCount === 0)
      return res.status(404).json({ error: 'Component not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
