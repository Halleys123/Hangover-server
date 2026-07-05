import type { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { Project } from '../models/Project.js';
import { Datasheet } from '../models/Datasheet.js';
import { Component } from '../models/Component.js';
import { addDatasheetToProjectDataset, normalizeExtractedSpecs } from '../services/cognee.js';
import { derivePins } from '../utils/derivePins.js';
import { logger } from '../utils/logger.js';

export class ProjectController {
  // Dynamic in-memory healing helper to make GET responses physically accurate without triggering DB writes
  public healCanvasInPlace(project: any): boolean {
    if (!project?.canvas?.nodes || !Array.isArray(project.canvas.nodes)) return false;
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
            right: [],
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
    return modified;
  }

  private cleanCanvasComponents(project: any, componentNames: string[]) {
    if (!project.canvas) return;
    const namesLower = componentNames.map(n => n.toLowerCase());
    
    const removedNodeIds = new Set<string>();
    const keptNodes = (project.canvas.nodes || []).filter((node: any) => {
      if (node && node.data && typeof node.data.label === 'string') {
        const match = namesLower.includes(node.data.label.toLowerCase());
        if (match) {
          removedNodeIds.add(node.id);
          return false;
        }
      }
      return true;
    });

    const keptEdges = (project.canvas.edges || []).filter((edge: any) => {
      if (edge && (removedNodeIds.has(edge.source) || removedNodeIds.has(edge.target))) {
        return false;
      }
      return true;
    });

    project.canvas.nodes = keptNodes;
    project.canvas.edges = keptEdges;
  }

  public async listProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projects = await Project.find({ userId: req.user!._id }).sort({
        createdAt: -1,
      });
      res.json(projects);
    } catch (err) {
      next(err);
    }
  }

  public async getProjectById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const project = await Project.findOne({
        _id: req.params.id,
        userId: req.user!._id,
      }).populate('datasheets');
      
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      // Dynamic healing in-memory before returning the response
      this.healCanvasInPlace(project);

      res.json(project);
    } catch (err) {
      next(err);
    }
  }

  public async createProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { name, description = '', status = 'in-progress' } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

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
  }

  public async updateProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { canvas: _canvas, userId: _uid, ...fields } = req.body;
    try {
      const project = await Project.findOneAndUpdate(
        { _id: req.params.id, userId: req.user!._id },
        { $set: fields },
        { new: true },
      );
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.json(project);
    } catch (err) {
      next(err);
    }
  }

  public async updateProjectCanvas(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { nodes, edges } = req.body;
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      res.status(400).json({ error: 'nodes and edges must be arrays' });
      return;
    }

    const componentsList = Array.from(
      new Set(
        nodes
          .filter((n: any) => n && n.data && typeof n.data.label === 'string')
          .map((n: any) => n.data.label)
      )
    );

    try {
      // Heal the canvas nodes before persistent save
      const tempProject = { canvas: { nodes, edges } };
      this.healCanvasInPlace(tempProject);

      const project = await Project.findOneAndUpdate(
        { _id: req.params.id, userId: req.user!._id },
        { 
          $set: { 
            canvas: { nodes: tempProject.canvas.nodes, edges: tempProject.canvas.edges },
            components: componentsList
          } 
        },
        { new: true },
      );
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.json({ saved: true });
    } catch (err) {
      next(err);
    }
  }

  public async addProjectComponent(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { name } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    try {
      const project = await Project.findOneAndUpdate(
        { _id: req.params.id, userId: req.user!._id },
        { $addToSet: { components: name } },
        { new: true }
      );
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.json(project);
    } catch (err) {
      next(err);
    }
  }

  public async deleteProjectComponent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const compName = req.params.name;
      const project = await Project.findOne({ _id: req.params.id, userId: req.user!._id });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      project.components = project.components.filter(c => c !== compName);
      this.cleanCanvasComponents(project, [compName]);

      await project.save();
      res.json(project);
    } catch (err) {
      next(err);
    }
  }

  public async addProjectDatasheet(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { datasheetId } = req.body;
    if (!datasheetId) {
      res.status(400).json({ error: 'datasheetId is required' });
      return;
    }
    try {
      const datasheet = await Datasheet.findOne({ _id: datasheetId, userId: req.user!._id });
      if (!datasheet) {
        res.status(404).json({ error: 'Datasheet not found' });
        return;
      }

      const project = await Project.findOneAndUpdate(
        { _id: req.params.id, userId: req.user!._id },
        { $addToSet: { datasheets: datasheetId } },
        { new: true }
      ).populate('datasheets');
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

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
      } catch (e: any) {
        logger.error('[Projects] Failed to sync datasheet link metadata:', e.message || e);
      }

      res.json(project);
    } catch (err) {
      next(err);
    }
  }

  public async deleteProjectDatasheet(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id, datasheetId } = req.params;
      const project = await Project.findOne({ _id: id, userId: req.user!._id });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const components = await Component.find({ datasheetId: datasheetId });
      const componentNames = components.map(c => c.name);

      project.datasheets = project.datasheets.filter(d => d.toString() !== datasheetId);

      if (componentNames.length > 0) {
        project.components = project.components.filter(c => !componentNames.includes(c));
        this.cleanCanvasComponents(project, componentNames);
      }

      await project.save();

      const populatedProject = await Project.findOne({ _id: id, userId: req.user!._id }).populate('datasheets');
      logger.info(`[Projects] Detached datasheet ${datasheetId} and cleaned canvas components: ${componentNames.join(', ')}`);

      res.json(populatedProject);
    } catch (err) {
      next(err);
    }
  }

  public async deleteProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await Project.deleteOne({
        _id: req.params.id,
        userId: req.user!._id,
      });
      if (result.deletedCount === 0) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}

export const projectController = new ProjectController();
