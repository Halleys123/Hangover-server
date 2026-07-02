import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middleware/authenticate.js';
import { Project } from '../models/Project.js';
import { Component } from '../models/Component.js';
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

    let parsedSpecs = specs;
    if (typeof specs === 'string') {
      try { parsedSpecs = JSON.parse(specs); } catch { }
    }

    // Pass the parsed stream metadata and electrical specifications to Cognee dual-memory layer
    const graphNode = await cognee.remember({
      dataset: projectId,
      filePath,
      componentName: componentName || req.file?.originalname?.replace(/\.pdf$/i, '') || 'Custom Component',
      text,
      extractedSpecs: parsedSpecs,
    });

    const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
    if (project) {
      project.chatHistory = [{
        role: 'assistant',
        text: `Datasheet **${componentName || req.file?.originalname || 'Document'}** ingested. Started a clean conversation session from zero specifically for this document. How would you like to proceed?`,
        timestamp: new Date()
      }];
      await project.save();
    }

    res.status(201).json({
      success: true,
      message: 'Datasheet successfully parsed, entity facts indexed into Graph DB, and semantic chunks stored in Vector DB.',
      node: graphNode,
      chatHistory: project?.chatHistory || []
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
router.get('/:projectId/chat', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project.chatHistory || []);
  } catch (err) {
    next(err);
  }
});

router.post('/:projectId/chat/new', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    let summaryContext = project.description;
    if (project.chatHistory && project.chatHistory.length > 1) {
      const recentTopics = project.chatHistory
        .filter((m: any) => m.role === 'user')
        .slice(-4)
        .map((m: any) => m.text)
        .join('; ');
      if (recentTopics) {
        summaryContext = `${project.description ? project.description + ' | ' : ''}Prior discussion: ${recentTopics}`;
        project.description = summaryContext.slice(0, 350);
      }
    }

    const greeting = `Welcome back to your **${project.name}** workspace! Based on your previous context (${summaryContext ? summaryContext : 'getting started'}), what specific circuit schematic or component integration would you like to work on next?`;

    project.chatHistory = [{
      role: 'assistant',
      text: greeting,
      timestamp: new Date()
    }];

    await project.save();

    res.json({
      success: true,
      greeting,
      chatHistory: project.chatHistory
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:projectId/chat', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const query = req.body.query || req.body.message;

    if (!query) {
      return res.status(400).json({ error: 'Query message is required' });
    }

    const project = await Project.findOne({ _id: projectId, userId: req.user!._id });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Save user query to persistent chat history
    if (!project.chatHistory) project.chatHistory = [];
    project.chatHistory.push({ role: 'user', text: query, timestamp: new Date() });

    // Step A: Context Retrieval from MongoDB Project Library & Cognee Graph
    const compArray: any[] = [];
    try {
      const dbComps = await Component.find({ userId: req.user!._id });
      const matchedComps = dbComps.filter(c => 
        (project.components && project.components.some(pComp => c.name.toLowerCase() === pComp.toLowerCase() || pComp.toLowerCase().includes(c.name.toLowerCase()))) ||
        (c.datasheetId && project.datasheets && project.datasheets.some(d => d.toString() === c.datasheetId?.toString()))
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
      const recalled = await cognee.recall({ dataset: projectId });
      if (Array.isArray(recalled)) compArray.push(...recalled);
    } catch {}
    if (project.datasheets && project.datasheets.length > 0) {
      for (const dsId of project.datasheets) {
        try {
          const recalledDs = await cognee.recall({ dataset: dsId.toString() });
          if (Array.isArray(recalledDs)) compArray.push(...recalledDs);
        } catch {}
      }
    }

    // Step B: Agentic State Machine & Circuit Generation via OpenAI
    const agenticResult = await openaiService.generateAgenticChatAndCircuit(
      query,
      { name: project.name, description: project.description },
      compArray
    );

    const aiReply = agenticResult.message || (agenticResult as any).reply || 'Processed request.';
    project.chatHistory.push({ role: 'assistant', text: aiReply, timestamp: new Date() });

    // Step C: Auto-Persist generated circuit into MongoDB if schematic was built
    if (agenticResult.type === 'circuit_generated' && agenticResult.nodes && agenticResult.edges) {
      project.canvas = {
        nodes: agenticResult.nodes as any,
        edges: agenticResult.edges as any,
      };
    }

    await project.save();

    // Step D: Return structured payload for React Flow / Svelte Flow rendering
    res.json(agenticResult);
  } catch (err) {
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
