import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { errorHandler } from './middleware/errorHandler.js';
import authRouter from './routes/auth.js';
import projectsRouter from './routes/projects.js';
import componentsRouter from './routes/components.js';
import datasheetsRouter from './routes/datasheets.js';
import chatRouter from './routes/chat.js';
import validateRouter from './routes/validate.js';
import aiRouter from './routes/ai.js';

const app = express();
const PORT = process.env.PORT ?? 3000;
const MONGO_URI =
  process.env.MONGODB_URI ?? 'mongodb://localhost:27017/hangover';

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  }),
);
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/projects', aiRouter);
app.use('/api/components', componentsRouter);
app.use('/api/datasheets', datasheetsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/validate', validateRouter);

app.use(errorHandler);

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () =>
      console.log(`Server running on http://localhost:${PORT}`),
    );
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
