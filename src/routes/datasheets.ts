import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import multer, { diskStorage } from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middleware/authenticate.js';
import { Datasheet } from '../models/Datasheet.js';
import { Component } from '../models/Component.js';
import { indexDatasheet } from '../services/cognee.js';

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
    const sheets = await Datasheet.find({ userId: req.user!._id }).sort({ uploadedAt: -1 });
    res.json(sheets);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const sheet = await Datasheet.findOne({ _id: req.params.id, userId: req.user!._id });
    if (!sheet) return res.status(404).json({ error: 'Datasheet not found' });
    res.json(sheet);
  } catch (err) {
    next(err);
  }
});

router.post('/', upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'PDF file is required' });

  try {
    const sheet = await Datasheet.create({
      userId: req.user!._id,
      name: req.file.originalname,
      size: formatBytes(req.file.size),
      filePath: req.file.path,
      parsed: false,
      cogneeConfig: null,
    });

    // Background Cognee indexing — does not block the response
    indexDatasheet(sheet.filePath, sheet.name)
      .then(async (cogneeConfig) => {
        await Datasheet.findByIdAndUpdate(sheet._id, { parsed: true, cogneeConfig });
      })
      .catch(() => {
        // Cognee not configured — sheet remains parsed: false
      });

    res.status(201).json(sheet);
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
    if (!component) return res.status(404).json({ error: 'Component not found' });

    component.datasheetId = sheet._id as any;
    await component.save();

    res.json({ linked: true, componentId: component._id, datasheetId: sheet._id });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const sheet = await Datasheet.findOneAndDelete({ _id: req.params.id, userId: req.user!._id });
    if (!sheet) return res.status(404).json({ error: 'Datasheet not found' });

    if (sheet.filePath && fs.existsSync(sheet.filePath)) fs.unlinkSync(sheet.filePath);

    await Component.updateMany(
      { userId: req.user!._id, datasheetId: sheet._id },
      { $set: { datasheetId: null } }
    );

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
