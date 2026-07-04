import { Router } from 'express';
import { Types } from 'mongoose';
import { authenticate } from '../middleware/authenticate.js';
import { Project } from '../models/Project.js';
import { Datasheet } from '../models/Datasheet.js';
import { ChatSession } from '../models/ChatSession.js';
import { addDatasheetToProjectDataset, normalizeExtractedSpecs } from '../services/cognee.js';
import { derivePins } from '../utils/derivePins.js';

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

    // Semantic healing: If existing nodes on the canvas represent 2-wire coolers, Arduino Uno, or ESP32,
    // ensure the UI displays clean, physically accurate pin arrays and strip any erroneous sensor pins.
    if (project.canvas && Array.isArray(project.canvas.nodes)) {
      let modified = false;
      project.canvas.nodes.forEach((node: any) => {
        if (node && node.data && typeof node.data.label === 'string') {
          const lblStr = node.data.label.toLowerCase();
          const is2WireCooler = lblStr.includes('fhs') || lblStr.includes('tec') || lblStr.includes('peltier') || lblStr.includes('cooler') || lblStr.includes('fan');
          const isArduinoUno = lblStr.includes('a000066') || lblStr.includes('uno') || lblStr.includes('arduino');
          const isEsp32 = lblStr.includes('esp32') || lblStr.includes('wroom');
          const isLed = lblStr.includes('led') || lblStr.includes('diode') || lblStr.includes('opto');

          if (isArduinoUno) {
            if (node.data.pins?.right?.some((p: any) => p.id?.toLowerCase() === 'data' || p.id?.toLowerCase() === 'sig') || !node.data.pins?.right?.some((p: any) => p.id?.toLowerCase() === 'd0')) {
              const derived = derivePins(node.data.label, normalizeExtractedSpecs(node.data.label, {}));
              node.data.pins = derived.pins;
              modified = true;
            }
          } else if (isEsp32) {
            if (node.data.pins?.right?.some((p: any) => p.id?.toLowerCase() === 'data' || p.id?.toLowerCase() === 'sig') || !node.data.pins?.right?.some((p: any) => p.id?.toLowerCase() === 'gpio2')) {
              const derived = derivePins(node.data.label, normalizeExtractedSpecs(node.data.label, {}));
              node.data.pins = derived.pins;
              modified = true;
            }
          } else if (is2WireCooler && (node.data.pins?.right?.length > 0 || !node.data.pins?.left?.some((p: any) => p.id === 'vcc'))) {
            node.data.pins = {
              left: [
                { id: 'vcc', label: '(+) RED / VCC', color: 'red' },
                { id: 'gnd', label: '(-) BLACK / GND', color: 'gray' },
              ],
              right: [], // Remove any incorrect data wire
            };
            modified = true;
          } else if (isLed) {
            if (!node.data.pins?.right?.some((p: any) => p.id?.toLowerCase() === 'cathode' || p.label?.toLowerCase().includes('cathode'))) {
              const derived = derivePins(node.data.label, normalizeExtractedSpecs(node.data.label, {}));
              node.data.pins = derived.pins;
              modified = true;
            }
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
      { $addToSet: { datasheets: datasheetId } },
      { new: true }
    ).populate('datasheets');
    if (!project) return res.status(404).json({ error: 'Project not found' });

    try {
      await addDatasheetToProjectDataset(datasheet, req.params.id);
      
      const cleanName = datasheet.name.replace(/\.pdf$/i, '').replace(/_Datasheet|_Spec|_Specifications/i, '').trim() || 'Datasheet';
      const greetingText = `New datasheet **${datasheet.name}** attached to workspace. I have created a dedicated, isolated chat context for **${cleanName}** so there is no confusion with previous datasheets. How would you like to integrate it into your circuit design?`;
      
      const newSessionId = new Types.ObjectId();
      const newSession = {
        _id: newSessionId,
        title: `${cleanName} Context`,
        chats: [
          {
            role: 'assistant',
            text: greetingText,
            timestamp: new Date()
          }
        ]
      };
      if (!project.chatHistory) project.chatHistory = [];
      project.chatHistory.push(newSession as any);
      await project.save();
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
      console.log(`[Projects] Detached datasheet ${req.params.datasheetId} from project ${req.params.id}`);
    } catch (e) {
      console.error('[Projects] Failed to clear datasheet association log:', e);
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
