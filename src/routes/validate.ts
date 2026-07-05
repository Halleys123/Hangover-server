import { Router } from 'express';
import { validationController } from '../controllers/ValidationController.js';

const router = Router();

router.post('/', validationController.validate.bind(validationController));

export default router;
