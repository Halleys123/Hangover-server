import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import multer, { diskStorage } from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middleware/authenticate.js';
import { datasheetController } from '../controllers/DatasheetController.js';

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
    else cb(new Error('Only PDF files are allowed') as any);
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

const router = Router();
router.use(authenticate);

router.get('/', datasheetController.listDatasheets.bind(datasheetController));
router.get('/:id', datasheetController.getDatasheetById.bind(datasheetController));
router.post('/', upload.any(), datasheetController.uploadDatasheet.bind(datasheetController));
router.put('/:id/link/:componentId', datasheetController.linkComponent.bind(datasheetController));
router.get('/:id/file', datasheetController.streamFile.bind(datasheetController));
router.post('/:id/refine', datasheetController.refine.bind(datasheetController));
router.patch('/:id/review', datasheetController.review.bind(datasheetController));
router.delete('/:id', datasheetController.deleteDatasheet.bind(datasheetController));

export default router;
