import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Component } from '../models/Component.js';
import { components as catalog } from '../data/components.js';

const router = Router();

router.get('/catalog', (req, res) => {
  const { category, search } = req.query as Record<string, string>;
  let result = catalog;
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
});

router.get('/catalog/categories', (_req, res) => {
  res.json([...new Set(catalog.map((c) => c.category))]);
});

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const items = await Component.find({ userId: req.user!._id })
      .populate('datasheetId', 'name size parsed uploadedAt')
      .sort({ createdAt: -1 });
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
