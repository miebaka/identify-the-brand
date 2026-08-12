// Admin API: login + stats + player table + CSV exports. Guarded by bearer
// token except the login route itself. Login is rate-limited separately.
import express from 'express';
import rateLimit from 'express-rate-limit';
import config from '../config.js';
import { verifyCredentials, issueToken, requireAdmin } from '../auth.js';
import { adminStats, playerRows, scoresCsv, answersCsvExport, fullCsv, dateStamp } from '../exports.js';
import { exportAnswersCsv } from '../store.js';

const router = express.Router();

// Forward async errors to the error handler instead of crashing the process.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 login attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

// POST /api/admin/login
router.post('/login', loginLimiter, (req, res) => {
  const { user, password } = req.body || {};
  if (!verifyCredentials(user, password)) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  const token = issueToken();
  if (!token) {
    // No ADMIN_TOKEN_SECRET configured — we cannot issue a safe token.
    return res.status(503).json({ error: 'Admin not configured on the server.' });
  }
  res.json({ token });
});

// GET /api/admin/stats
router.get('/stats', requireAdmin, wrap(async (req, res) => {
  res.json(await adminStats());
}));

// GET /api/admin/players
router.get('/players', requireAdmin, wrap(async (req, res) => {
  res.json({ players: await playerRows() });
}));

function sendCsv(res, filename, body) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}

// GET /api/admin/export/players — one row per completed player.
router.get('/export/players', requireAdmin, wrap(async (req, res) => {
  const body = await scoresCsv();
  sendCsv(res, `identify-the-brand-scores-${dateStamp()}.csv`, body);
}));

// GET /api/admin/export/answers — one row per question.
router.get('/export/answers', requireAdmin, wrap(async (req, res) => {
  const body = await answersCsvExport();
  sendCsv(res, `identify-the-brand-answers-${dateStamp()}.csv`, body);
}));

// GET /api/admin/export/full — session joined with all answers.
router.get('/export/full', requireAdmin, wrap(async (req, res) => {
  const body = await fullCsv();
  sendCsv(res, `identify-the-brand-full-${dateStamp()}.csv`, body);
}));

// GET /api/admin/export/raw — the underlying answers persistence file.
router.get('/export/raw', requireAdmin, wrap(async (req, res) => {
  const body = await exportAnswersCsv();
  sendCsv(res, `identify-the-brand-answers-raw-${dateStamp()}.csv`, body);
}));

export default router;
