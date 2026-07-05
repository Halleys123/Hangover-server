import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { env } from '../config/env.js';

export class AuthController {
  public async signup(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ error: 'name, email, and password are required' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    try {
      const exists = await User.findOne({ email: email.toLowerCase() });
      if (exists) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }

      const hashed = await bcrypt.hash(password, 12);
      const user = await User.create({ name, email, password: hashed });

      const token = jwt.sign({ userId: user._id }, env.JWT_SECRET, {
        expiresIn: '7d',
      });
      res.status(201).json({
        token,
        user: { id: user._id, name: user.name, email: user.email },
      });
    } catch (err) {
      next(err);
    }
  }

  public async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const token = jwt.sign({ userId: user._id }, env.JWT_SECRET, {
        expiresIn: '7d',
      });
      res.json({
        token,
        user: { id: user._id, name: user.name, email: user.email },
      });
    } catch (err) {
      next(err);
    }
  }

  public async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const { userId } = jwt.verify(header.slice(7), env.JWT_SECRET) as {
        userId: string;
      };
      const user = await User.findById(userId).select('-password');
      if (!user) {
        res.status(401).json({ error: 'User not found' });
        return;
      }
      res.json({ id: user._id, name: user.name, email: user.email });
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  }
}

export const authController = new AuthController();
