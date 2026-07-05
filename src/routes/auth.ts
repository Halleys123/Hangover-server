import { Router } from 'express';
import { authController } from '../controllers/AuthController.js';

const router = Router();

router.post('/signup', authController.signup.bind(authController));
router.post('/login', authController.login.bind(authController));
router.get('/me', authController.me.bind(authController));

export default router;
