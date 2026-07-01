import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import multer, { diskStorage } from 'multer';
import path from 'path';
import fs from 'fs';
import { datasheets } from '../data/datasheets.js';
import { indexDatasheet } from '../services/cognee.js';

const UPLOAD_DIR = path.resolve('uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

const router = Router();

router.get('/', (_req, res) => {
  res.json(datasheets);
});

router.get('/:id', (req, res) => {
  const sheet = datasheets.find((d) => d.id === req.params.id);
  if (!sheet) return res.status(404).json({ error: 'Datasheet not found' });
  res.json(sheet);
});

router.post('/', upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'PDF file is required' });

  const sheet = {
    id: uuid(),
    name: req.file.originalname,
    size: formatBytes(req.file.size),
    parsed: false,
    uploadedAt: new Date().toISOString(),
    filePath: req.file.path,
  };

  datasheets.push(sheet);

  // Kick off Cognee indexing in the background — does not block the response
  indexDatasheet(sheet.filePath, sheet.name)
    .then(() => {
      sheet.parsed = true;
    })
    .catch(() => {
      // Cognee not configured — sheet remains parsed: false
    });

  res.status(201).json(sheet);
});

router.delete('/:id', (req, res) => {
  const index = datasheets.findIndex((d) => d.id === req.params.id);
  if (index === -1)
    return res.status(404).json({ error: 'Datasheet not found' });

  const [removed] = datasheets.splice(index, 1);
  if (removed.filePath && fs.existsSync(removed.filePath)) {
    fs.unlinkSync(removed.filePath);
  }

  res.status(204).send();
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default router;
