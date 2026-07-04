import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import multer, { diskStorage } from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middleware/authenticate.js';
import { Datasheet } from '../models/Datasheet.js';
import { Component } from '../models/Component.js';
import { Project } from '../models/Project.js';
import { pdfQueue } from '../services/pdfQueue.js';
import { refineDatasheetSpecs } from '../services/cognee.js';

const UPLOAD_DIR = path.resolve('uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, _file, cb) => cb(null, `${uuid()}.pdf`),
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const sheets = await Datasheet.find({ userId: req.user!._id }).sort({
      uploadedAt: -1,
    });
    res.json(sheets);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const sheet = await Datasheet.findOne({
      _id: req.params.id,
      userId: req.user!._id,
    });
    if (!sheet) return res.status(404).json({ error: 'Datasheet not found' });
    res.json(sheet);
  } catch (err) {
    next(err);
  }
});

router.post('/', upload.any(), async (req, res, next) => {
  const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
  if (req.file) files.push(req.file);

  if (files.length === 0) return res.status(400).json({ error: 'PDF file(s) required' });

  try {
    const { projectId } = req.body;
    const createdSheets = [];
    for (const file of files) {
      const sheet = await Datasheet.create({
        userId: req.user!._id,
        name: file.originalname,
        size: formatBytes(file.size),
        filePath: file.path,
        parsed: false,
        status: 'waiting',
        cogneeConfig: null,
      });

      if (projectId) {
        await Project.findOneAndUpdate(
          { _id: projectId, userId: req.user!._id },
          { $addToSet: { datasheets: sheet._id } }
        );
      }

      // Enqueue into asynchronous background processing queue
      pdfQueue.enqueue(sheet._id.toString(), sheet.filePath, sheet.name);
      createdSheets.push(sheet);
    }

    if (createdSheets.length === 1 && !req.body.multi) {
      res.status(201).json(createdSheets[0]);
    } else {
      res.status(201).json(createdSheets);
    }
  } catch (err) {
    next(err);
  }
});

// Link a datasheet to a user component
router.put('/:id/link/:componentId', async (req, res, next) => {
  try {
    const [sheet, component] = await Promise.all([
      Datasheet.findOne({ _id: req.params.id, userId: req.user!._id }),
      Component.findOne({ _id: req.params.componentId, userId: req.user!._id }),
    ]);
    if (!sheet) return res.status(404).json({ error: 'Datasheet not found' });
    if (!component)
      return res.status(404).json({ error: 'Component not found' });

    component.datasheetId = sheet._id as any;
    await component.save();

    res.json({
      linked: true,
      componentId: component._id,
      datasheetId: sheet._id,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/file', async (req, res, next) => {
  try {
    const sheet = await Datasheet.findOne({
      _id: req.params.id,
      userId: req.user!._id,
    });
    if (!sheet) return res.status(404).json({ error: 'Datasheet not found' });
    if (!sheet.filePath || !fs.existsSync(sheet.filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${sheet.name}"`);
    fs.createReadStream(sheet.filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/refine', async (req, res, next) => {
  try {
    const { prompt } = req.body;
    const sheet = await Datasheet.findOne({
      _id: req.params.id,
      userId: req.user!._id,
    });
    if (!sheet) return res.status(404).json({ error: 'Datasheet not found' });
    if (!sheet.filePath || !fs.existsSync(sheet.filePath)) {
      return res.status(404).json({ error: 'File not found on disk for refinement' });
    }

    const refinedSpecs = await refineDatasheetSpecs(
      sheet.filePath,
      sheet.name,
      sheet.cogneeConfig,
      prompt || '',
      sheet._id.toString()
    );

    sheet.cogneeConfig = refinedSpecs;
    sheet.verificationStatus = 'accepted';
    if (prompt) sheet.userNotes = prompt;
    await sheet.save();

    const comp = await Component.findOne({ datasheetId: sheet._id });
    if (comp) {
      comp.cogneeConfig = refinedSpecs;
      const nomVolt = (refinedSpecs["Electrical Limits"] as any)?.nominalVoltage;
      comp.description = `${refinedSpecs["Component Classification"] || (nomVolt ? `${nomVolt}V Nominal` : 'AI Extracted')} • AI Refined Specs`;
      await comp.save();
    }

    res.json(sheet);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/review', async (req, res, next) => {
  try {
    const { action, feedback, updatedSpecs, useAi } = req.body;
    const sheet = await Datasheet.findOne({
      _id: req.params.id,
      userId: req.user!._id,
    });
    if (!sheet) return res.status(404).json({ error: 'Datasheet not found' });

    if (action === 'accept') {
      sheet.verificationStatus = 'accepted';
      if (updatedSpecs) sheet.cogneeConfig = updatedSpecs;
    } else if (action === 'improve') {
      if (feedback) sheet.userNotes = feedback;
      if (useAi && sheet.filePath && fs.existsSync(sheet.filePath)) {
        const refinedSpecs = await refineDatasheetSpecs(
          sheet.filePath,
          sheet.name,
          sheet.cogneeConfig,
          feedback || '',
          sheet._id.toString()
        );
        sheet.cogneeConfig = refinedSpecs;
        sheet.verificationStatus = 'accepted';
      } else if (updatedSpecs) {
        sheet.cogneeConfig = updatedSpecs;
        sheet.verificationStatus = 'accepted';
      } else {
        sheet.verificationStatus = 'unverified';
      }
    } else if (action === 'forget') {
      sheet.cogneeConfig = null;
      sheet.verificationStatus = 'rejected';
      sheet.parsed = false;
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    await sheet.save();
    res.json(sheet);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const sheet = await Datasheet.findOneAndDelete({
      _id: req.params.id,
      userId: req.user!._id,
    });
    if (!sheet) return res.status(404).json({ error: 'Datasheet not found' });

    if (sheet.filePath) {
      const absPath = path.resolve(sheet.filePath);
      if (fs.existsSync(absPath)) {
        try { fs.unlinkSync(absPath); } catch (err) { console.error('Failed to unlink abs path:', err); }
      } else if (fs.existsSync(sheet.filePath)) {
        try { fs.unlinkSync(sheet.filePath); } catch (err) { console.error('Failed to unlink raw path:', err); }
      }
    }

    // Remove any components auto-created for or linked exclusively to this datasheet
    await Component.deleteMany({ userId: req.user!._id, datasheetId: sheet._id });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default router;
