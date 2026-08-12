// Public gameplay API. All timing + scoring is server-authoritative.
import express from 'express';
import config from '../config.js';
import { getLogo } from '../logos.js';
import { fragmentForClient, fullSvg } from '../logos.js';
import {
  createSession,
  getSession,
  nextQuestion,
  recordSubmission,
  completeSession,
  summarize,
} from '../store.js';
import { performanceMessage } from '../game.js';
import { leaderboardWithPlacement } from '../leaderboard.js';

const router = express.Router();

// Wrap async handlers so a rejected promise is forwarded to the Express error
// handler (500) instead of becoming an unhandled rejection that crashes Node.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- Input validation helpers ---
function cleanName(v) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}
function validName(v) {
  // 1-60 chars; letters (any script), spaces, hyphen, apostrophe, period.
  return v.length >= 1 && v.length <= 60 && /^[\p{L}\p{M}][\p{L}\p{M} '.-]*$/u.test(v);
}

// POST /api/register — create a session, return game meta. No answer key.
router.post('/register', (req, res) => {
  const firstName = cleanName(req.body?.firstName);
  const surname = cleanName(req.body?.surname);
  const consent = req.body?.consent === true;
  if (!validName(firstName) || !validName(surname)) {
    return res.status(400).json({ error: 'Please enter a valid first name and surname.' });
  }
  if (!consent) {
    return res.status(400).json({ error: 'Consent is required to play.' });
  }
  const session = createSession(firstName, surname);
  res.json({
    sessionId: session.sessionId,
    player: { firstName },
    game: {
      totalQuestions: config.game.totalQuestions,
      durationPerQuestionMs: config.game.durationPerQuestionMs,
      totalPossibleScore: config.game.totalPossibleScore,
    },
  });
});

// Build the client-safe question payload including the fragment markup.
// The fragment is rasterized server-side (fragmentForClient), so no vector
// geometry — and therefore no recoverable visual answer — reaches the browser.
async function questionPayload(q) {
  const logo = getLogo(q.logoId);
  return {
    number: q.number,
    total: q.total,
    logoId: q.logoId,
    points: q.points,
    durationMs: config.game.durationPerQuestionMs,
    fragmentSvg: await fragmentForClient(logo),
    startedAt: new Date().toISOString(),
  };
}

// POST /api/start — begin the game, return the first question.
router.post('/start', wrap(async (req, res) => {
  const session = getSession(req.body?.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found. Please restart.' });
  if (session.status === 'completed') {
    return res.status(409).json({ error: 'This game is already complete.' });
  }
  if (session.currentIndex >= 0) {
    return res.status(409).json({ error: 'Game already started.' });
  }
  const q = nextQuestion(session);
  res.json({ question: await questionPayload(q) });
}));

// POST /api/submit — submit an answer; server decides correctness + timing.
router.post('/submit', wrap(async (req, res) => {
  const session = getSession(req.body?.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found. Please restart.' });
  const logoId = req.body?.logoId;
  const answer = req.body?.answer;
  if (typeof logoId !== 'string') return res.status(400).json({ error: 'Invalid payload.' });

  const result = await recordSubmission(session, logoId, answer, { timeout: false });
  if (result.status === 'stale') return res.status(409).json(result.payload);
  if (result.status === 'conflict') return res.status(409).json(result.payload);

  const logo = getLogo(logoId);
  res.json({ ...result.payload, fullSvg: fullSvg(logo) });
}));

// POST /api/timeout — mark the active question as timed out.
router.post('/timeout', wrap(async (req, res) => {
  const session = getSession(req.body?.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found. Please restart.' });
  const logoId = req.body?.logoId;
  if (typeof logoId !== 'string') return res.status(400).json({ error: 'Invalid payload.' });

  const result = await recordSubmission(session, logoId, '', { timeout: true });
  if (result.status === 'conflict') {
    // Already answered (e.g. a submit beat the timeout). Reveal is idempotent.
    const logo = getLogo(logoId);
    return res.status(200).json({
      correct: false,
      timedOut: true,
      pointsEarned: 0,
      correctAnswer: logo.brand,
      fullSvg: fullSvg(logo),
      duplicate: true,
    });
  }
  if (result.status === 'stale') return res.status(409).json(result.payload);
  const logo = getLogo(logoId);
  res.json({ ...result.payload, fullSvg: fullSvg(logo) });
}));

// POST /api/next — advance to the next question, or finish the game.
router.post('/next', wrap(async (req, res) => {
  const session = getSession(req.body?.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found. Please restart.' });
  // Refuse to advance past an active question that has not been recorded yet.
  // This makes /next idempotent against duplicate or premature calls (a second
  // in-flight /next can otherwise double-increment and silently skip a logo).
  const activeLogoId = session.assignedLogos[session.currentIndex];
  if (session.currentIndex >= 0 && activeLogoId && !session.submittedLogoIds.has(activeLogoId)) {
    return res.status(409).json({ error: 'Answer the current question first.' });
  }
  const q = nextQuestion(session);
  if (!q) {
    const summary = await completeSession(session);
    return res.json({
      done: true,
      results: { ...summary, message: performanceMessage(summary.score) },
    });
  }
  res.json({ done: false, question: await questionPayload(q) });
}));

// GET /api/results/:sessionId — re-fetch results (idempotent).
router.get('/results/:sessionId', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  if (session.status !== 'completed') {
    return res.status(409).json({ error: 'Game not complete yet.' });
  }
  const summary = summarize(session);
  res.json({ ...summary, message: performanceMessage(summary.score) });
});

// GET /api/leaderboard — top 50 + this player's placement.
router.get('/leaderboard', wrap(async (req, res) => {
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : null;
  const data = await leaderboardWithPlacement(sessionId, 50);
  res.json(data);
}));

export default router;
