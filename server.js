// IDENTIFY THE BRAND — Express application.
// Vercel detects this Express entry point and deploys it as the Node.js backend.
// Running `npm start` locally still starts a normal HTTP server.
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'node:path';

import config, { assertProductionSecrets } from './src/server/config.js';
import { initPersistence, startJanitor } from './src/server/store.js';
import apiRouter from './src/server/routes/api.js';
import adminRouter from './src/server/routes/admin.js';

const warnings = assertProductionSecrets();
if (warnings.length && !config.isProd) {
  console.warn('[warn] Insecure admin config (fine for local dev):');
  for (const w of warnings) console.warn('   - ' + w);
}

const app = express();
if (config.trustProxy || process.env.VERCEL) app.set('trust proxy', 1);
app.disable('x-powered-by');

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

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/', apiLimiter);

app.use('/api', apiRouter);
app.use('/api/admin', adminRouter);

app.get('/healthz', (req, res) => res.json({ ok: true }));

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

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});

// Initialise persistence once per warm Vercel instance. Google Sheets is the
// durable production backend; local CSV remains available for local development.
const ready = initPersistence()
  .then(() => {
    startJanitor();
  })
  .catch((err) => {
    console.error('[fatal] Startup validation failed:\n' + err.message);
    throw err;
  });

app.locals.ready = ready;

// Vercel owns the HTTP server. Only listen when running locally.
if (!process.env.VERCEL) {
  ready.then(() => {
    app.listen(config.port, () => {
      console.log(`IDENTIFY THE BRAND running on http://localhost:${config.port}`);
      console.log(`  env=${config.env}  dataDir=${config.dataDir}`);
      console.log(`  admin dashboard: http://localhost:${config.port}/admin`);
    });
  }).catch((err) => {
    console.error('[fatal] Unable to start server:', err.message);
    process.exitCode = 1;
  });
}

export default app;
