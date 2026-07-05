import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middleware/authenticate.js';
import { aiController } from '../controllers/AIController.js';

const UPLOAD_DIR = path.resolve('uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
});

const router = Router();
router.use(authenticate);

router.post('/:projectId/ingest', upload.single('file'), aiController.ingest.bind(aiController));
router.get('/:projectId/chat/sessions', aiController.getChatSessions.bind(aiController));
router.get('/:projectId/chat/sessions/:sessionId', aiController.getChatSessionById.bind(aiController));
router.get('/:projectId/chat', aiController.getChat.bind(aiController));
router.post('/:projectId/chat/new', aiController.startNewChatSession.bind(aiController));
router.put('/:projectId/chat/sessions/:sessionId/rename', aiController.renameChatSession.bind(aiController));
router.post('/:projectId/chat', aiController.messageChat.bind(aiController));
router.post('/:projectId/validate-connection', aiController.validateConnection.bind(aiController));

export default router;
