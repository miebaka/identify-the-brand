// IDENTIFY THE BRAND — Express bootstrap.
// Security (Helmet), compression, rate limiting, static hosting, JSON API.
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'node:path';

import config, { assertProductionSecrets } from './src/server/config.js';
import { initPersistence, startJanitor } from './src/server/store.js';
import apiRouter from './src/server/routes/api.js';
import adminRouter from './src/server/routes/admin.js';

// Fail loudly on insecure production config; warn in development.
const warnings = assertProductionSecrets();
if (warnings.length && !config.isProd) {
  console.warn('[warn] Insecure admin config (fine for local dev):');
  for (const w of warnings) console.warn('   - ' + w);
}

// Validate the logo registry + ensure CSV files exist BEFORE serving traffic.
try {
  initPersistence();
} catch (err) {
  console.error('[fatal] Startup validation failed:\n' + err.message);
  process.exit(1);
}
startJanitor();

const app = express();
if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

// Content Security Policy: allow inline styles (design tokens) + our own SVG.
// No third-party scripts. Fonts self-hosted or system.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(compression());
app.use(express.json({ limit: '16kb' }));

// Global API rate limit (gameplay). Generous but abuse-resistant.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240, // ~4 req/s per IP sustained
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/', apiLimiter);

app.use('/api', apiRouter);
app.use('/api/admin', adminRouter);

// Health check.
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Static assets. Backups are inside data/, never under public/, so they are
// not web-exposed (spec §28).
app.use(
  express.static(config.publicDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.svg')) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    },
  }),
);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(config.publicDir, 'admin.html'));
});

// SPA fallback for the game (single page).
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

// JSON 404 for unknown API routes.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Central error handler — never leak stack traces to players (spec §21).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// Last-resort safety net: log rather than crash the game server on a stray
// async error. Route-level errors are already funneled to the error handler.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});

app.listen(config.port, () => {
  console.log(`IDENTIFY THE BRAND running on http://localhost:${config.port}`);
  console.log(`  env=${config.env}  dataDir=${config.dataDir}`);
  console.log(`  admin dashboard: http://localhost:${config.port}/admin`);
});
