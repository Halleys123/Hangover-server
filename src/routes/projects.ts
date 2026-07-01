import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { projects } from '../data/projects.js';
import type { Project } from '../types/index.js';

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
