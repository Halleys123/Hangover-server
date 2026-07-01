import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Project } from '../models/Project.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const projects = await Project.find({ userId: req.user!._id }).sort({
      createdAt: -1,
    });
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      userId: req.user!._id,
    }).populate('datasheets');
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
      datasheets: [],
      canvas: { nodes: [], edges: [] },
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
      { new: true },
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

  // Extract unique component labels from the placed nodes on the canvas
  const componentsList = Array.from(
    new Set(
      nodes
        .filter((n: any) => n && n.data && typeof n.data.label === 'string')
        .map((n: any) => n.data.label)
    )
  );

  try {
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!._id },
      { 
        $set: { 
          canvas: { nodes, edges },
          components: componentsList
        } 
      },
      { new: true },
    );
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ saved: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/datasheets', async (req, res, next) => {
  const { datasheetId } = req.body;
  if (!datasheetId) return res.status(400).json({ error: 'datasheetId is required' });
  try {
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!._id },
      { $addToSet: { datasheets: datasheetId } },
      { new: true }
    ).populate('datasheets');
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/datasheets/:datasheetId', async (req, res, next) => {
  try {
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!._id },
      { $pull: { datasheets: req.params.datasheetId } as any },
      { new: true }
    ).populate('datasheets');
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await Project.deleteOne({
      _id: req.params.id,
      userId: req.user!._id,
    });
    if (result.deletedCount === 0)
      return res.status(404).json({ error: 'Project not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
