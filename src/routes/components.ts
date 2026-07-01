import { Router } from 'express';
import { components } from '../data/components.js';

const router = Router();

router.get('/', (req, res) => {
  const { category, search } = req.query as Record<string, string>;

  let result = components;

  if (category) {
    result = result.filter((c) => c.category === category);
  }

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

router.get('/categories', (_req, res) => {
  const cats = [...new Set(components.map((c) => c.category))];
  res.json(cats);
});

router.get('/:id', (req, res) => {
  const component = components.find((c) => c.id === req.params.id);
  if (!component) return res.status(404).json({ error: 'Component not found' });
  res.json(component);
});

export default router;
