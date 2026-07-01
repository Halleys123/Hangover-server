import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Project } from '../models/Project.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const projects = await Project.find({ userId: req.user!._id }).sort({ createdAt: -1 });
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, userId: req.user!._id });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  const { name, description = '', status = 'in-progress' } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const project = await Project.create({
      userId: req.user!._id,
      name,
      description,
      status,
      date: new Date().toISOString().split('T')[0],
      components: [],
      canvas: { nodes: [], edges: [] }
    });
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  const { canvas: _canvas, userId: _uid, ...fields } = req.body;
  try {
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!._id },
      { $set: fields },
      { new: true }
    );
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/canvas', async (req, res, next) => {
  const { nodes, edges } = req.body;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return res.status(400).json({ error: 'nodes and edges must be arrays' });
  }
  try {
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!._id },
      { $set: { canvas: { nodes, edges } } },
      { new: true }
    );
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ saved: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await Project.deleteOne({ _id: req.params.id, userId: req.user!._id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Project not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;

const router = Router();

router.get('/', (_req, res) => {
  res.json(projects);
});

router.get('/:id', (req, res) => {
  const project = projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

router.post('/', (req, res) => {
  const {
    name,
    description,
    status = 'in-progress',
  } = req.body as Partial<Project>;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const project: Project = {
    id: uuid(),
    name,
    description: description ?? '',
    components: [],
    date: new Date().toISOString().split('T')[0],
    status: status as Project['status'],
    canvas: { nodes: [], edges: [] },
  };

  projects.push(project);
  res.status(201).json(project);
});

router.put('/:id', (req, res) => {
  const index = projects.findIndex((p) => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Project not found' });

  const { canvas, ...rest } = req.body as Partial<Project>;
  projects[index] = { ...projects[index], ...rest };
  res.json(projects[index]);
});

router.put('/:id/canvas', (req, res) => {
  const project = projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { nodes, edges } = req.body;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return res.status(400).json({ error: 'nodes and edges must be arrays' });
  }

  project.canvas = { nodes, edges };
  res.json({ saved: true });
});

router.delete('/:id', (req, res) => {
  const index = projects.findIndex((p) => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Project not found' });

  projects.splice(index, 1);
  res.status(204).send();
});

export default router;
