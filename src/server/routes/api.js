// Public gameplay API. All timing + scoring is server-authoritative.
import express from 'express';
import rateLimit from 'express-rate-limit';
import config from '../config.js';
import { getLogo, fragmentForClient, fullSvg } from '../logos.js';
import { createSession, getSession, nextQuestion, recordSubmission, completeSession, summarize } from '../store.js';
import { performanceMessage } from '../game.js';
import { leaderboardWithPlacement } from '../leaderboard.js';

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const registrationLimiter = rateLimit({ windowMs: 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many new games. Please wait a minute and try again.' } });

function cleanName(v) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''; }
function validName(v) { return v.length >= 1 && v.length <= 60 && /^[\p{L}\p{M}][\p{L}\p{M} '.-]*$/u.test(v); }

router.post('/register', registrationLimiter, (req, res) => {
  const firstName = cleanName(req.body?.firstName);
  const surname = cleanName(req.body?.surname);
  if (!validName(firstName) || !validName(surname)) return res.status(400).json({ error: 'Please enter a valid first name and surname.' });
  if (req.body?.consent !== true) return res.status(400).json({ error: 'Consent is required to play.' });
  const session = createSession(firstName, surname);
  res.json({ sessionId: session.sessionId, player: { firstName }, game: { totalQuestions: config.game.totalQuestions, durationPerQuestionMs: config.game.durationPerQuestionMs, totalPossibleScore: config.game.totalPossibleScore } });
});

async function questionPayload(q, session) {
  const logo = getLogo(q.logoId);
  const elapsedMs = session.questionStartedAt ? Math.max(0, Date.now() - session.questionStartedAt) : 0;
  return { number: q.number, total: q.total, logoId: q.logoId, points: q.points, durationMs: Math.max(0, config.game.durationPerQuestionMs - elapsedMs), elapsedMs, fragmentSvg: await fragmentForClient(logo) };
}

router.post('/start', wrap(async (req, res) => {
  const session = getSession(req.body?.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found. Please restart.' });
  if (session.status === 'completed') return res.status(409).json({ error: 'This game is already complete.' });

  // If the previous question was already submitted before a refresh, advance
  // instead of returning an answered question. This makes refresh safe during
  // the feedback/transition window too.
  if (session.currentIndex >= 0) {
    const currentLogoId = session.assignedLogos[session.currentIndex];
    if (session.submittedLogoIds.has(currentLogoId)) {
      const next = nextQuestion(session);
      if (!next) {
        const summary = await completeSession(session);
        return res.json({ done: true, results: { ...summary, message: performanceMessage(summary.score) } });
      }
      return res.json({ question: await questionPayload(next, session), resumed: true, advanced: true });
    }
    const q = { number: session.currentIndex + 1, total: session.assignedLogos.length, logoId: currentLogoId, points: getLogo(currentLogoId).points };
    return res.json({ question: await questionPayload(q, session), resumed: true });
  }

  const q = nextQuestion(session);
  res.json({ question: await questionPayload(q, session), resumed: false });
}));

router.get('/resume/:sessionId', wrap(async (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session expired. Please start a new game.' });
  if (session.status === 'completed') return res.json({ status: 'completed', results: { ...summarize(session), message: performanceMessage(session.totals?.score ?? 0) } });
  const game = { totalQuestions: config.game.totalQuestions, durationPerQuestionMs: config.game.durationPerQuestionMs, totalPossibleScore: config.game.totalPossibleScore };
  if (session.currentIndex < 0) return res.json({ status: 'ready', player: { firstName: session.firstName, surname: session.surname }, game });
  const logoId = session.assignedLogos[session.currentIndex];
  const q = { number: session.currentIndex + 1, total: session.assignedLogos.length, logoId, points: getLogo(logoId).points };
  return res.json({ status: 'playing', player: { firstName: session.firstName, surname: session.surname }, game, question: await questionPayload(q, session) });
}));

router.post('/submit', wrap(async (req, res) => {
  const session = getSession(req.body?.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found. Please restart.' });
  if (typeof req.body?.logoId !== 'string') return res.status(400).json({ error: 'Invalid payload.' });
  const result = await recordSubmission(session, req.body.logoId, req.body.answer, { timeout: false });
  if (result.status === 'stale' || result.status === 'conflict') return res.status(409).json(result.payload);
  res.json({ ...result.payload, fullSvg: fullSvg(getLogo(req.body.logoId)) });
}));

router.post('/timeout', wrap(async (req, res) => {
  const session = getSession(req.body?.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found. Please restart.' });
  if (typeof req.body?.logoId !== 'string') return res.status(400).json({ error: 'Invalid payload.' });
  const result = await recordSubmission(session, req.body.logoId, '', { timeout: true });
  const logo = getLogo(req.body.logoId);
  if (result.status === 'conflict') return res.json({ correct: false, timedOut: true, pointsEarned: 0, correctAnswer: logo.brand, fullSvg: fullSvg(logo), duplicate: true });
  if (result.status === 'stale') return res.status(409).json(result.payload);
  res.json({ ...result.payload, fullSvg: fullSvg(logo) });
}));

router.post('/next', wrap(async (req, res) => {
  const session = getSession(req.body?.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found. Please restart.' });
  const activeLogoId = session.assignedLogos[session.currentIndex];
  if (session.currentIndex >= 0 && activeLogoId && !session.submittedLogoIds.has(activeLogoId)) return res.status(409).json({ error: 'Answer the current question first.' });
  const q = nextQuestion(session);
  if (!q) {
    const summary = await completeSession(session);
    return res.json({ done: true, results: { ...summary, message: performanceMessage(summary.score) } });
  }
  res.json({ done: false, question: await questionPayload(q, session) });
}));

router.get('/results/:sessionId', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  if (session.status !== 'completed') return res.status(409).json({ error: 'Game not complete yet.' });
  const summary = summarize(session);
  res.json({ ...summary, message: performanceMessage(summary.score) });
});

router.get('/leaderboard', wrap(async (req, res) => {
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : null;
  res.json(await leaderboardWithPlacement(sessionId, 50));
}));

export default router;
