import express from 'express';
import mongoose from 'mongoose';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { authRouter } from './routes/auth.js';
import { apiRouter } from './routes/api.js';
import { sameOrigin } from './middleware/auth.js';
import { errorHandler } from './middleware/errors.js';
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('X-Frame-Options', 'DENY'); res.set('Referrer-Policy', 'same-origin'); next(); });
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', sameOrigin);
  app.get('/api/health', (req, res) => res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({ status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', database: 'MongoDB', name: mongoose.connection.name }));
  app.use('/api/auth', authRouter);
  app.use('/api', apiRouter);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  if (existsSync(path.resolve('dist/index.html'))) { app.use(express.static('dist')); app.get('/{*path}', (req, res) => res.sendFile(path.resolve('dist/index.html'))); }
  app.use(errorHandler);
  return app;
}
