import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Project } from '../models/Project.js';
import { Datasheet } from '../models/Datasheet.js';
import { addDatasheetToProjectDataset } from '../services/cognee.js';

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

    // Semantic healing: If existing nodes on the canvas represent 2-wire coolers or fans (e.g., TEC1-12706 or FHS-A9015S00),
    // strip any erroneous hardcoded SIG/DATA pins so the UI displays exactly two leads: (+) RED / VCC and (-) BLACK / GND.
    if (project.canvas && Array.isArray(project.canvas.nodes)) {
      let modified = false;
      project.canvas.nodes.forEach((node: any) => {
        if (node && node.data && typeof node.data.label === 'string') {
          const lblStr = node.data.label.toLowerCase();
          const is2WireCooler = lblStr.includes('fhs') || lblStr.includes('tec') || lblStr.includes('peltier') || lblStr.includes('cooler') || lblStr.includes('fan');
          if (is2WireCooler) {
            node.data.pins = {
              left: [
                { id: 'vcc', label: '(+) RED / VCC', color: 'red' },
                { id: 'gnd', label: '(-) BLACK / GND', color: 'gray' },
              ],
              right: [], // Remove any incorrect data wire
            };
            modified = true;
          }
        }
      });
      if (modified) {
        await Project.updateOne({ _id: project._id }, { $set: { 'canvas.nodes': project.canvas.nodes } });
      }
    }

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

router.post('/:id/components', async (req, res, next) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!._id },
      { $addToSet: { components: name } },
      { new: true }
    );
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/components/:name', async (req, res, next) => {
  try {
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!._id },
      { $pull: { components: req.params.name } as any },
      { new: true }
    );
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/datasheets', async (req, res, next) => {
  const { datasheetId } = req.body;
  if (!datasheetId) return res.status(400).json({ error: 'datasheetId is required' });
  try {
    const datasheet = await Datasheet.findOne({ _id: datasheetId, userId: req.user!._id });
    if (!datasheet) {
      return res.status(404).json({ error: 'Datasheet not found' });
    }

    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!._id },
      { 
        $addToSet: { datasheets: datasheetId },
        $set: {
          chatHistory: [{
            role: 'assistant',
            text: `New datasheet attached to workspace. Started a clean chat session from zero specifically for this component. How would you like to integrate it into your circuit design?`,
            timestamp: new Date()
          }]
        }
      },
      { new: true }
    ).populate('datasheets');
    if (!project) return res.status(404).json({ error: 'Project not found' });

    try {
      await addDatasheetToProjectDataset(datasheet, req.params.id);
      await Datasheet.findOneAndUpdate(
        { _id: datasheetId, userId: req.user!._id },
        { $set: { projectId: req.params.id } }
      );
    } catch (e) {
      console.error('[Projects] Failed to sync datasheet link metadata:', e);
    }

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

    try {
      await Datasheet.findOneAndUpdate(
        { _id: req.params.datasheetId, userId: req.user!._id },
        { $set: { projectId: null } }
      );
    } catch (e) {
      console.error('[Projects] Failed to clear datasheet projectId:', e);
    }

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
