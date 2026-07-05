import { env, validateConfig } from './config/env.js';
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
import { runStartupHealing } from './utils/startupCheck.js';
import { logger } from './utils/logger.js';

const app = express();
const PORT = env.PORT;
const MONGO_URI = env.MONGODB_URI;

app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
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

// Validate environment configurations on boot
validateConfig();

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    logger.info('Connected to MongoDB');
    
    // Execute database schema healing checks asynchronously after boot
    runStartupHealing().catch(err => {
      logger.error('Startup schema healing failed:', err);
    });

    app.listen(PORT, () =>
      logger.info(`Server running on http://localhost:${PORT}`),
    );
  })
  .catch((err) => {
    logger.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
