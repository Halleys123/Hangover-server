import type { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { Project } from '../models/Project.js';
import { Component } from '../models/Component.js';
import { cognee } from '../services/cogneeClient.js';
import { openaiService } from '../services/openaiService.js';
import { derivePins } from '../utils/derivePins.js';
import { normalizeExtractedSpecs } from '../services/cognee.js';
import { logger } from '../utils/logger.js';

export class AIController {
  private activeGenerations = new Set<string>();

  private sanitizeDatasetName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  }

  public async ingest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { projectId } = req.params;
      const { componentName, text, specs } = req.body;
      const filePath = req.file?.path;

      const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const datasetName = this.sanitizeDatasetName(project.name);

      let parsedSpecs = specs;
      if (typeof specs === 'string') {
        try { parsedSpecs = JSON.parse(specs); } catch { }
      }

      // Pass specs to Cognee local+cloud storage
      const graphNode = await cognee.remember({
        dataset: datasetName,
        filePath,
        componentName: componentName || req.file?.originalname?.replace(/\.pdf$/i, '') || 'Custom Component',
        text,
        extractedSpecs: parsedSpecs,
      });

      try {
        await cognee.improve({ dataset: datasetName });
      } catch (e: any) {
        logger.warn('[AI Ingest] Improve call failed (non-blocking):', e.message || e);
      }

      const cleanName = (componentName || req.file?.originalname || 'Datasheet').replace(/\.pdf$/i, '').replace(/_Datasheet|_Spec|_Specifications/i, '').trim();
      const greetingText = `Datasheet **${cleanName}** ingested. I have created a dedicated, isolated chat context for **${cleanName}** so there is no confusion with previous datasheets. How would you like to proceed?`;
      
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
      const session = project.chatHistory[project.chatHistory.length - 1];

      res.status(201).json({
        success: true,
        message: 'Datasheet successfully parsed, entity facts indexed into Graph DB, and semantic chunks stored in Vector DB.',
        node: graphNode,
        chatHistory: session.chats,
        sessionId: session._id.toString()
      });
    } catch (err) {
      next(err);
    }
  }

  public async getChatSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { projectId } = req.params;
      const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      if (!project.chatHistory || project.chatHistory.length === 0) {
        project.chatHistory = [{
          _id: new Types.ObjectId(),
          title: 'Main Conversation',
          chats: [{
            role: 'assistant',
            text: 'Hello! I am your **AI Hardware Architect**. Tell me what project or circuit goal you want to build!',
            timestamp: new Date()
          }]
        }];
        await project.save();
      }

      res.json(project.chatHistory);
    } catch (err) {
      next(err);
    }
  }

  public async getChatSessionById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { projectId, sessionId } = req.params;
      const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const session = project.chatHistory.find(s => s._id.toString() === sessionId);
      if (!session) {
        res.status(404).json({ error: 'Chat session not found' });
        return;
      }

      // Auto-heal interrupted/orphaned chats
      if (session && session.chats && session.chats.length > 0) {
        const lastMsg = session.chats[session.chats.length - 1];
        if (lastMsg.role === 'user' && !this.activeGenerations.has(sessionId)) {
          logger.info(`[AI] Interrupted prompt detected for session ${sessionId}. Healing session in database.`);
          session.chats.push({
            role: 'assistant',
            text: '*Generation was interrupted. Please try again.*',
            timestamp: new Date()
          });
          await project.save();
        }
      }

      res.json(session.chats || []);
    } catch (err) {
      next(err);
    }
  }

  public async getChat(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { projectId } = req.params;
      const { sessionId } = req.query;

      const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      if (!project.chatHistory || project.chatHistory.length === 0) {
        project.chatHistory = [{
          _id: new Types.ObjectId(),
          title: 'Main Conversation',
          chats: [{
            role: 'assistant',
            text: 'Hello! I am your **AI Hardware Architect**. Tell me what project or circuit goal you want to build!',
            timestamp: new Date()
          }]
        }];
        await project.save();
      }

      let session;
      if (sessionId) {
        session = project.chatHistory.find(s => s._id.toString() === sessionId as string);
      } else {
        session = project.chatHistory[project.chatHistory.length - 1];
      }

      if (!session) {
        session = project.chatHistory[project.chatHistory.length - 1];
      }

      // Auto-heal interrupted/orphaned chats
      if (session && session.chats && session.chats.length > 0) {
        const lastMsg = session.chats[session.chats.length - 1];
        const sId = session._id.toString();
        if (lastMsg.role === 'user' && !this.activeGenerations.has(sId)) {
          logger.info(`[AI] Interrupted prompt detected for session ${sId}. Healing session in database.`);
          session.chats.push({
            role: 'assistant',
            text: '*Generation was interrupted. Please try again.*',
            timestamp: new Date()
          });
          await project.save();
        }
      }

      res.json(session.chats || []);
    } catch (err) {
      next(err);
    }
  }

  public async startNewChatSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { projectId } = req.params;
      const { title } = req.body;
      const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      let summaryContext = project.description;
      if (project.chatHistory && project.chatHistory.length > 0) {
        const lastSession = project.chatHistory[project.chatHistory.length - 1];
        if (lastSession.chats && lastSession.chats.length > 1) {
          const recentTopics = lastSession.chats
            .filter(m => m.role === 'user')
            .slice(-4)
            .map(m => m.text)
            .join('; ');
          if (recentTopics) {
            summaryContext = `${project.description ? project.description + ' | ' : ''}Prior discussion: ${recentTopics}`;
            project.description = summaryContext.slice(0, 350);
          }
        }
      }

      const greeting = `Welcome to a new chat session for **${project.name}**! Based on your context (${summaryContext ? summaryContext : 'getting started'}), what specific circuit schematic or component integration would you like to work on next?`;

      const newSessionId = new Types.ObjectId();
      project.chatHistory.push({
        _id: newSessionId,
        title: title || 'New Chat',
        chats: [{
          role: 'assistant',
          text: greeting,
          timestamp: new Date()
        }]
      });
      
      await project.save();

      res.json({
        success: true,
        greeting,
        chatHistory: project.chatHistory[project.chatHistory.length - 1].chats,
        sessionId: newSessionId.toString()
      });
    } catch (err) {
      next(err);
    }
  }

  public async renameChatSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { projectId, sessionId } = req.params;
      const { title } = req.body;
      if (!title) {
        res.status(400).json({ error: 'Title is required' });
        return;
      }

      const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const session = project.chatHistory.find(s => s._id.toString() === sessionId);
      if (!session) {
        res.status(404).json({ error: 'Chat session not found' });
        return;
      }

      session.title = title;
      await project.save();

      res.json({ success: true, title });
    } catch (err) {
      next(err);
    }
  }

  public async messageChat(req: Request, res: Response, next: NextFunction): Promise<void> {
    let isRequestClosed = false;
    let sessionToUpdateId: string | null = null;
    const { projectId } = req.params;

    try {
      const query = req.body.query || req.body.message;
      const sessionId = req.body.sessionId || req.query.sessionId;

      if (!query) {
        res.status(400).json({ error: 'Query message is required' });
        return;
      }

      const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      if (!project.chatHistory || project.chatHistory.length === 0) {
        project.chatHistory = [{
          _id: new Types.ObjectId(),
          title: 'Main Conversation',
          chats: [{
            role: 'assistant',
            text: 'Hello! I am your **AI Hardware Architect**. Tell me what project or circuit goal you want to build!',
            timestamp: new Date()
          }]
        }];
        await project.save();
      }

      let session;
      if (sessionId) {
        session = project.chatHistory.find(s => s._id.toString() === sessionId);
      } else {
        session = project.chatHistory[project.chatHistory.length - 1];
      }

      if (!session) {
        session = project.chatHistory[project.chatHistory.length - 1];
      }

      sessionToUpdateId = session._id.toString();
      this.activeGenerations.add(sessionToUpdateId);

      // Auto-rename thread title
      if (session.chats.length === 1 || session.title === 'New Chat' || session.title === 'Main Conversation') {
        session.title = query.length > 30 ? `${query.substring(0, 27)}...` : query;
      }

      req.on('close', async () => {
        isRequestClosed = true;
        if (!res.headersSent && sessionToUpdateId) {
          logger.info('[AI] Client closed connection before response sent. Appending stopped state to db.');
          try {
            const latestProject = await Project.findOne({ _id: projectId, userId: req.user!._id });
            if (latestProject) {
              const activeSession = latestProject.chatHistory.find(s => s._id.toString() === sessionToUpdateId);
              if (activeSession) {
                const last = activeSession.chats[activeSession.chats.length - 1];
                if (last && last.role === 'user') {
                  activeSession.chats.push({
                    role: 'assistant',
                    text: '*Generation stopped by user.*',
                    timestamp: new Date()
                  });
                  await latestProject.save();
                }
              }
            }
          } catch (err: any) {
            logger.error('[AI] Error saving aborted state:', err.message || err);
          }
        }
      });

      // Save user query
      const lastMsg = session.chats[session.chats.length - 1];
      const isDuplicate = lastMsg && lastMsg.role === 'user' && lastMsg.text === query;
      if (!isDuplicate) {
        session.chats.push({ role: 'user', text: query, timestamp: new Date() });
        await project.save();
      }

      // Step A: Context Retrieval from MongoDB & Cognee
      const compArray: any[] = [];
      try {
        const dbComps = await Component.find({ userId: req.user!._id });
        const matchedComps = dbComps.filter(c =>
          (project.components && project.components.some(pComp => c.name.toLowerCase() === pComp.toLowerCase() || pComp.toLowerCase().includes(c.name.toLowerCase()))) ||
          (project.datasheets && project.datasheets.some(d => d.toString() === c.datasheetId?.toString()))
        );
        const effectiveComps = matchedComps.length > 0 ? matchedComps : ((project.components && project.components.length > 0) ? dbComps : []);

        for (const c of effectiveComps) {
          compArray.push({
            componentName: c.name,
            description: c.description,
            category: c.category,
            specs: c.cogneeConfig || {},
            pins: [
              ...(c.diagram?.pins?.left || []),
              ...(c.diagram?.pins?.right || [])
            ].map(p => ({
              pinNumber: p.id,
              pinName: p.label
            }))
          });
        }
      } catch (e: any) {
        logger.error('[AI] Error fetching project components from MongoDB:', e.message || e);
      }

      try {
        const datasetName = this.sanitizeDatasetName(project.name);
        const recalled = await cognee.recall({
          dataset: datasetName,
          query: query,
          sessionId: datasetName
        });
        if (Array.isArray(recalled)) {
          const validChunks = recalled.filter(r => r && typeof r.componentName === 'string' && r.componentName);
          compArray.push(...validChunks);
        }
      } catch (e: any) {
        logger.error('[AI] Cognee recall error:', e.message || e);
      }

      if (isRequestClosed) return;

      // Step B: Agentic State Machine & Circuit Generation via OpenAI
      const agenticResult = await openaiService.generateAgenticChatAndCircuit(
        query,
        { name: project.name, description: project.description },
        compArray,
        project.canvas
      );

      if (isRequestClosed) return;

      const aiReply = agenticResult.message || (agenticResult as any).reply || 'Processed request.';

      // Reload project
      const latestProject = await Project.findOne({ _id: projectId, userId: req.user!._id });
      if (!latestProject) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const activeSession = latestProject.chatHistory.find(s => s._id.toString() === sessionToUpdateId);
      if (!activeSession) {
        res.status(404).json({ error: 'Chat session not found' });
        return;
      }

      activeSession.chats.push({ role: 'assistant', text: aiReply, timestamp: new Date() });
      await latestProject.save();

      // Step C: Auto-Persist generated circuit and merge visual nodes
      console.log(`[AIController] agenticResult.type="${agenticResult.type}", nodes=${agenticResult.nodes?.length || 0}, edges=${agenticResult.edges?.length || 0}`);
      if (agenticResult.type === 'circuit_generated' && agenticResult.nodes && agenticResult.edges) {
        const latestProjectForCanvas = await Project.findOne({ _id: projectId, userId: req.user!._id });
        if (latestProjectForCanvas) {
          const existingNodes: any[] = latestProjectForCanvas.canvas?.nodes || [];
          const existingEdges: any[] = latestProjectForCanvas.canvas?.edges || [];

          const existingPosMap = new Map<string, { x: number; y: number }>();
          existingNodes.forEach((n: any) => {
            if (n?.data?.label) existingPosMap.set(n.data.label.toLowerCase(), n.position);
            if (n?.id) existingPosMap.set(n.id, n.position);
          });

          const mergedNodes = (agenticResult.nodes as any[]).map((newNode: any) => {
            const existingPos =
              existingPosMap.get(newNode?.data?.label?.toLowerCase()) ||
              existingPosMap.get(newNode?.id);
            return existingPos ? { ...newNode, position: existingPos } : newNode;
          });

          // Preserve any existing node on the canvas that is not in agenticResult.nodes
          const newNodeIds = new Set(mergedNodes.map((n: any) => n.id));
          const newNodeLabels = new Set(mergedNodes.map((n: any) => n?.data?.label?.toLowerCase()));
          const preservedExistingNodes = existingNodes.filter(
            (en: any) => !newNodeIds.has(en.id) && (!en?.data?.label || !newNodeLabels.has(en.data.label.toLowerCase()))
          );
          const finalNodes = [...preservedExistingNodes, ...mergedNodes];

          const validNodeIds = new Set(finalNodes.map((n: any) => n.id));

          // Find all pairs of node IDs connected by the newly generated AI edges
          const aiConnectedPairs = new Set<string>();
          (agenticResult.edges as any[]).forEach((e: any) => {
            if (e.source && e.target) {
              aiConnectedPairs.add(`${e.source}:::${e.target}`);
              aiConnectedPairs.add(`${e.target}:::${e.source}`);
            }
          });

          const newEdgeIds = new Set((agenticResult.edges as any[]).map((e: any) => e.id));

          // Preserve existing edges ONLY IF:
          // 1. Both source and target nodes still exist in finalNodes (remove dead orphan edges)
          // 2. The edge ID does not collide with a newly generated edge ID
          // 3. The source and target nodes are NOT being re-wired by the new AI edges
          const preservedExistingEdges = existingEdges.filter((e: any) => {
            if (!validNodeIds.has(e.source) || !validNodeIds.has(e.target)) return false;
            if (newEdgeIds.has(e.id)) return false;
            if (aiConnectedPairs.has(`${e.source}:::${e.target}`)) return false;
            return true;
          });

          const finalEdges = [...preservedExistingEdges, ...(agenticResult.edges as any[])];
          console.log(`[AIController] Canvas merge: preservedEdges=${preservedExistingEdges.length}, newEdges=${agenticResult.edges?.length || 0}, finalEdges=${finalEdges.length}`);

          latestProjectForCanvas.canvas = {
            nodes: finalNodes as any,
            edges: finalEdges as any,
          };
          await latestProjectForCanvas.save();

          (agenticResult as any).nodes = finalNodes;
          (agenticResult as any).edges = finalEdges;
        }
      }

      console.log(`[AIController] Final response: type=${agenticResult.type}, nodes=${agenticResult.nodes?.length || 0}, edges=${agenticResult.edges?.length || 0}`);
      res.json(agenticResult);

    } catch (err: any) {
      logger.error('[AI] Chat error:', err.message || err);
      try {
        if (sessionToUpdateId && !isRequestClosed) {
          const latestProject = await Project.findOne({ _id: projectId, userId: req.user!._id });
          if (latestProject) {
            const activeSession = latestProject.chatHistory.find(s => s._id.toString() === sessionToUpdateId);
            if (activeSession) {
              activeSession.chats.push({
                role: 'assistant',
                text: `Error generating response: ${err.message || 'Unknown error'}`,
                timestamp: new Date()
              });
              await latestProject.save();
            }
          }
        }
      } catch (e: any) {
        logger.error('[AI] Failed to save error message to session:', e.message || e);
      }
      next(err);
    } finally {
      if (sessionToUpdateId) {
        this.activeGenerations.delete(sessionToUpdateId);
      }
    }
  }

  public async validateConnection(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { projectId } = req.params;
      const { pinA, pinB } = req.body;

      if (!pinA || !pinB) {
        res.status(400).json({
          status: 'UNKNOWN',
          reason: 'Missing source pinA or destination pinB payload for validation.',
        });
        return;
      }

      // Layer 1: Data Retrieval
      const pinAData = await cognee.recall({
        dataset: projectId,
        componentName: pinA.componentName || pinA.component,
        pinNumber: pinA.pinNumber || pinA.pin,
      });

      const pinBData = await cognee.recall({
        dataset: projectId,
        componentName: pinB.componentName || pinB.component,
        pinNumber: pinB.pinNumber || pinB.pin,
      });

      const vOut = Number(pinAData.outputVoltage);
      const vInMax = Number(pinBData.maxInputTolerance);

      // Layer 2: Node.js Math Failsafe
      let status: 'SAFE' | 'UNSAFE' | 'UNKNOWN' = 'UNKNOWN';
      let mathReason = '';

      if (isNaN(vOut) || isNaN(vInMax)) {
        status = 'UNKNOWN';
        mathReason = `Missing numerical voltage bounds in datasheet memory (PinA vOut: ${vOut}, PinB vInMax: ${vInMax}).`;
      } else if (vOut > vInMax) {
        status = 'UNSAFE';
        mathReason = `Pin A output voltage (${vOut}V) exceeds Pin B maximum input tolerance (${vInMax}V).`;
      } else {
        status = 'SAFE';
        mathReason = `Pin A output voltage (${vOut}V) is <= Pin B maximum input tolerance (${vInMax}V).`;
      }

      if (status === 'UNKNOWN') {
        res.json({
          status: 'UNKNOWN',
          reason: `Connection cannot be verified: ${mathReason}`,
        });
        return;
      }

      // Layer 3: LLM Translation
      const translation = await openaiService.translateGuardrailResult({
        status,
        pinA: pinAData,
        pinB: pinBData,
        mathEvaluation: mathReason,
      });

      res.json(translation);
    } catch (err) {
      next(err);
    }
  }
}

export const aiController = new AIController();
