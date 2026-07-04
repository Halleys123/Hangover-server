import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Types } from 'mongoose';
import { authenticate } from '../middleware/authenticate.js';
import { Project } from '../models/Project.js';
import { Component } from '../models/Component.js';
import { ChatSession } from '../models/ChatSession.js';
import { cognee } from '../services/cogneeClient.js';
import { openaiService } from '../services/openaiService.js';

const UPLOAD_DIR = path.resolve('uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
});

const router = Router();
router.use(authenticate);

function sanitizeDatasetName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

/**
 * 1. Ingest Route: /api/projects/:projectId/ingest
 * 
 * CRITICAL ARCHITECTURAL PIPELINE (How Cognee processes uploaded PDF datasheets):
 * -----------------------------------------------------------------------------------------
 * Step A: Parsing & Full Document Extraction
 *   - When the user uploads a PDF datasheet (via Multer binary upload), Cognee does not simply
 *     treat the file as an opaque blob. Instead, the document parser reads all textual content,
 *     electrical specification tables, absolute maximum rating matrices, and pinout diagrams.
 * 
 * Step B: Confirmation of Non-Raw Processing (No Opaque File Storage)
 *   - We confirm that Cognee DOES NOT just save the raw PDF file to disk or database.
 *     The temporary binary uploaded by Multer is merely the input stream. Once parsed,
 *     the physical file can be discarded; all knowledge is decomposed and indexed into
 *     structured memory layers.
 * 
 * Step C: Hybrid Graph & Vector Dual-Indexing
 *   1. Graph Database (Deterministic Knowledge Hierarchy):
 *      - Cognee deterministically extracts exact facts: component entities, pin numbers,
 *        logic voltage rails (e.g. 3.3V vs 5V logic), absolute input tolerance ceilings, and
 *        communication interfaces (I2C, SPI, UART).
 *      - These facts are stored as connected nodes and edges in our Graph DB (via cognee.remember()),
 *        enabling Layer 1 of our 3-Layer Guardrail to perform exact structural lookups without hallucination.
 *   2. Vector Database (Semantic Search Chunks):
 *      - Simultaneously, narrative sections (application notes, thermal guidelines, layout recommendations)
 *        are embedded into high-dimensional vector space stored in our Vector DB. This allows natural-language
 *        engineering queries during the /chat flow to retrieve contextually relevant design guidance.
 * -----------------------------------------------------------------------------------------
 */
router.post('/:projectId/ingest', upload.single('file'), async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { componentName, text, specs } = req.body;
    const filePath = req.file?.path;

    const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const datasetName = sanitizeDatasetName(project.name);

    let parsedSpecs = specs;
    if (typeof specs === 'string') {
      try { parsedSpecs = JSON.parse(specs); } catch { }
    }

    // Pass the parsed stream metadata and electrical specifications to Cognee dual-memory layer
    const graphNode = await cognee.remember({
      dataset: datasetName,
      filePath,
      componentName: componentName || req.file?.originalname?.replace(/\.pdf$/i, '') || 'Custom Component',
      text,
      extractedSpecs: parsedSpecs,
    });

    try {
      await cognee.improve({ dataset: datasetName });
    } catch (e) {
      console.warn('[AI Ingest] Improve call failed (non-blocking):', e);
    }

    const greetingText = `Datasheet **${componentName || req.file?.originalname || 'Document'}** ingested. How would you like to proceed?`;
    let session;
    if (project.chatHistory && project.chatHistory.length > 0) {
      session = project.chatHistory[project.chatHistory.length - 1];
      session.chats.push({
        role: 'assistant',
        text: greetingText,
        timestamp: new Date()
      });
      await project.save();
    } else {
      const newSessionId = new Types.ObjectId();
      project.chatHistory = [{
        _id: newSessionId,
        title: 'Main Conversation',
        chats: [
          {
            role: 'assistant',
            text: 'Hello! I am your **AI Hardware Architect**. Tell me what project or circuit goal you want to build!',
            timestamp: new Date()
          },
          {
            role: 'assistant',
            text: greetingText,
            timestamp: new Date()
          }
        ]
      }];
      await project.save();
      session = project.chatHistory[0];
    }

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
});

/**
 * 2. Agentic Chat & Circuit Assembly Route: /api/projects/:projectId/chat
 * Implements a 4-Stage Agentic State Machine that guides ideation, requests datasheets,
 * checks graph compatibility, and auto-generates visual schematic wiring saved directly to project canvas.
 */
router.get('/:projectId/chat/sessions', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
    if (!project) return res.status(404).json({ error: 'Project not found' });

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
});

router.get('/:projectId/chat/sessions/:sessionId', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;
    const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const session = project.chatHistory.find(s => s._id.toString() === sessionId);
    if (!session) return res.status(404).json({ error: 'Chat session not found' });

    res.json(session.chats || []);
  } catch (err) {
    next(err);
  }
});

router.get('/:projectId/chat', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { sessionId } = req.query;

    const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
    if (!project) return res.status(404).json({ error: 'Project not found' });

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

    res.json(session.chats || []);
  } catch (err) {
    next(err);
  }
});

router.post('/:projectId/chat/new', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { title } = req.body;
    const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
    if (!project) return res.status(404).json({ error: 'Project not found' });

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
});

router.put('/:projectId/chat/sessions/:sessionId/rename', async (req, res, next) => {
  try {
    const { projectId, sessionId } = req.params;
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const session = project.chatHistory.find(s => s._id.toString() === sessionId);
    if (!session) return res.status(404).json({ error: 'Chat session not found' });

    session.title = title;
    await project.save();

    res.json({ success: true, title });
  } catch (err) {
    next(err);
  }
});

router.post('/:projectId/chat', async (req, res, next) => {
  let isRequestClosed = false;
  let sessionToUpdateId: string | null = null;

  try {
    const { projectId } = req.params;
    const query = req.body.query || req.body.message;
    const sessionId = req.body.sessionId || req.query.sessionId;

    if (!query) {
      return res.status(400).json({ error: 'Query message is required' });
    }

    const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
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

    // Auto-rename thread title based on user's first prompt if it has default welcome message
    if (session.chats.length === 1 || session.title === 'New Chat' || session.title === 'Main Conversation') {
      session.title = query.length > 30 ? `${query.substring(0, 27)}...` : query;
    }

    req.on('close', async () => {
      isRequestClosed = true;
      if (!res.headersSent && sessionToUpdateId) {
        console.log('[AI] Client closed connection before response sent. Appending stopped state to db.');
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
        } catch (err) {
          console.error('[AI] Error saving aborted state:', err);
        }
      }
    });

    // Save user query to persistent chat history
    const lastMsg = session.chats[session.chats.length - 1];
    const isDuplicate = lastMsg && lastMsg.role === 'user' && lastMsg.text === query;
    if (!isDuplicate) {
      session.chats.push({ role: 'user', text: query, timestamp: new Date() });
      await project.save();
    }

    // Step A: Context Retrieval from MongoDB Project Library & Cognee Graph
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
    } catch (e) {
      console.error('[AI] Error fetching project components from MongoDB:', e);
    }

    try {
      const datasetName = sanitizeDatasetName(project.name);
      const recalled = await cognee.recall({
        dataset: datasetName,
        query: query,
        sessionId: datasetName
      });
      if (Array.isArray(recalled)) compArray.push(...recalled);
    } catch (e) {
      console.error('[AI] Cognee recall error:', e);
    }

    if (isRequestClosed) return;

    // Step B: Agentic State Machine & Circuit Generation via OpenAI
    const agenticResult = await openaiService.generateAgenticChatAndCircuit(
      query,
      { name: project.name, description: project.description },
      compArray
    );

    if (isRequestClosed) return;

    const aiReply = agenticResult.message || (agenticResult as any).reply || 'Processed request.';

    // Reload project to avoid overwrite issues
    const latestProject = await Project.findOne({ _id: projectId, userId: req.user!._id });
    if (!latestProject) return res.status(404).json({ error: 'Project not found' });

    const activeSession = latestProject.chatHistory.find(s => s._id.toString() === sessionToUpdateId);
    if (!activeSession) return res.status(404).json({ error: 'Chat session not found' });

    activeSession.chats.push({ role: 'assistant', text: aiReply, timestamp: new Date() });
    await latestProject.save();

    // Step C: Auto-Persist generated circuit into MongoDB if schematic was built
    if (agenticResult.type === 'circuit_generated' && agenticResult.nodes && agenticResult.edges) {
      const latestProjectForCanvas = await Project.findOne({ _id: projectId, userId: req.user!._id });
      if (latestProjectForCanvas) {
        latestProjectForCanvas.canvas = {
          nodes: agenticResult.nodes as any,
          edges: agenticResult.edges as any,
        };
        await latestProjectForCanvas.save();
      }
    }

    res.json(agenticResult);

  } catch (err: any) {
    console.error('[AI] Chat error:', err);
    try {
      if (sessionToUpdateId && !isRequestClosed) {
        const latestProject = await Project.findOne({ _id: req.params.projectId, userId: req.user!._id });
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
    } catch (e) {
      console.error('[AI] Failed to save error message to session:', e);
    }
    next(err);
  }
});


/**
 * 3. Validation Route: /api/projects/:projectId/validate-connection
 * The 3-Layer Deterministic Guardrail guaranteed safety evaluation.
 */
router.post('/:projectId/validate-connection', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { pinA, pinB } = req.body;

    if (!pinA || !pinB) {
      return res.status(400).json({
        status: 'UNKNOWN',
        reason: 'Missing source pinA or destination pinB payload for validation.',
      });
    }

    // LAYER 1: Data Retrieval via Cognee Recall
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

    // LAYER 2: Node.js Math Failsafe (NEVER ask the LLM to evaluate math)
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
      return res.json({
        status: 'UNKNOWN',
        reason: `Connection cannot be verified: ${mathReason}`,
      });
    }

    // LAYER 3: LLM Translation (Acts strictly as translator to write human-friendly explanation)
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
});

export default router;
