// Session store + CSV persistence.
//
// The in-memory Map is the source of truth DURING play (needed for
// server-authoritative timing). CSV files are the durable append-only record:
// one row per answer as it is submitted, one row per session at completion.
// A browser refresh loses the in-memory session (documented limitation); the
// leaderboard and exports survive because they read from CSV.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import config from './config.js';
import { CsvTable, buildCsvExport } from './csv.js';
import { loadRegistry, getLogo, allLogos } from './logos.js';
import { interleaveByDifficulty, isCorrect, tallyScore } from './game.js';

const SESSIONS = new Map();

const sessionsCsv = new CsvTable(path.join(config.dataDir, 'sessions.csv'), [
  'session_id',
  'first_name',
  'surname',
  'created_at',
  'started_at',
  'completed_at',
  'status',
  'score',
  'total_possible',
  'percentage',
  'correct_answers',
  'incorrect_answers',
  'timed_out',
]);

const answersCsv = new CsvTable(path.join(config.dataDir, 'answers.csv'), [
  'session_id',
  'question_number',
  'logo_id',
  'brand',
  'difficulty',
  'points_possible',
  'points_earned',
  'answer_given',
  'correct',
  'elapsed_ms',
  'time_remaining_ms',
  'submitted_at',
]);

let writeCounter = 0;

// Initialize persistence: validate logo registry + CSV headers, create files.
export function initPersistence() {
  loadRegistry();
  sessionsCsv.ensure();
  answersCsv.ensure();
}

// Periodically prune abandoned in-memory sessions so memory can't grow forever.
export function startJanitor() {
  const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
  return setInterval(() => {
    const now = Date.now();
    for (const [id, s] of SESSIONS) {
      if (s.status !== 'completed' && now - s.lastTouch > MAX_AGE_MS) {
        SESSIONS.delete(id);
      }
    }
  }, 5 * 60 * 1000).unref();
}

function publicName(first, surname) {
  return `${first} ${surname}`.trim();
}

// Create a session with a randomized, difficulty-interleaved logo order.
export function createSession(firstName, surname) {
  const id = randomUUID();
  const order = interleaveByDifficulty(allLogos());
  const now = new Date().toISOString();
  const session = {
    sessionId: id,
    firstName,
    surname,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    status: 'created',
    assignedLogos: order.map((l) => l.id),
    currentIndex: -1, // no active question yet
    questionStartedAt: null, // authoritative ms timestamp
    answers: [], // completed answers
    submittedLogoIds: new Set(), // idempotency guard
    lastTouch: Date.now(),
  };
  SESSIONS.set(id, session);
  return session;
}

export function getSession(id) {
  const s = SESSIONS.get(id);
  if (s) s.lastTouch = Date.now();
  return s;
}

// Advance to the next question and stamp the authoritative start time.
// Returns the client-safe question payload, or null when the game is over.
export function nextQuestion(session) {
  session.currentIndex += 1;
  if (session.currentIndex >= session.assignedLogos.length) {
    return null;
  }
  if (session.status === 'created') {
    session.status = 'playing';
    session.startedAt = new Date().toISOString();
  }
  const logoId = session.assignedLogos[session.currentIndex];
  const logo = getLogo(logoId);
  session.questionStartedAt = Date.now();
  session.lastTouch = Date.now();
  return {
    number: session.currentIndex + 1,
    total: session.assignedLogos.length,
    logoId: logo.id,
    points: logo.points,
    // NOTE: answer key (brand, acceptableAnswers) is deliberately NOT sent.
  };
}

// Record a submitted answer (correct/incorrect/timeout) and persist it.
// Returns { status, payload } where status is an HTTP-ish signal.
export async function recordSubmission(session, logoId, rawAnswer, opts = {}) {
  const isTimeout = !!opts.timeout;

  // Must be the currently active question.
  const activeLogoId = session.assignedLogos[session.currentIndex];
  if (activeLogoId !== logoId) {
    return { status: 'stale', payload: { error: 'Not the active question.' } };
  }
  // Idempotency: one answer per logo (spec §18).
  if (session.submittedLogoIds.has(logoId)) {
    return { status: 'conflict', payload: { error: 'Already answered.' } };
  }

  const logo = getLogo(logoId);
  const now = Date.now();
  const elapsedMs = session.questionStartedAt ? now - session.questionStartedAt : Infinity;
  const limit = config.game.durationPerQuestionMs + config.game.graceMs;
  const withinWindow = elapsedMs <= limit;

  let correct = false;
  let timedOut = isTimeout || !withinWindow;
  let pointsEarned = 0;

  if (!timedOut) {
    correct = isCorrect(rawAnswer, logo.acceptableAnswers);
    if (correct) pointsEarned = logo.points;
  }

  const answer = {
    questionNumber: session.currentIndex + 1,
    logoId: logo.id,
    brand: logo.brand,
    difficulty: logo.difficulty,
    pointsPossible: logo.points,
    pointsEarned,
    answerGiven: timedOut && isTimeout ? '' : String(rawAnswer ?? ''),
    correct,
    timedOut,
    elapsedMs: Number.isFinite(elapsedMs) ? Math.round(elapsedMs) : config.game.durationPerQuestionMs,
    timeRemainingMs: Math.max(0, config.game.durationPerQuestionMs - Math.round(elapsedMs || 0)),
    submittedAt: new Date().toISOString(),
  };

  session.answers.push(answer);
  session.submittedLogoIds.add(logoId);
  session.lastTouch = Date.now();

  await answersCsv.append({
    session_id: session.sessionId,
    question_number: answer.questionNumber,
    logo_id: answer.logoId,
    brand: answer.brand,
    difficulty: answer.difficulty,
    points_possible: answer.pointsPossible,
    points_earned: answer.pointsEarned,
    answer_given: answer.answerGiven,
    correct: answer.correct ? 'true' : 'false',
    elapsed_ms: answer.elapsedMs,
    time_remaining_ms: answer.timeRemainingMs,
    submitted_at: answer.submittedAt,
  });
  await maybeBackup();

  // Client-safe feedback: reveal the correct answer only AFTER submission.
  return {
    status: 'ok',
    payload: {
      correct,
      timedOut,
      pointsEarned,
      correctAnswer: logo.brand,
      elapsedMs: answer.elapsedMs,
      timeRemainingMs: answer.timeRemainingMs,
    },
  };
}

// Finalize a session, compute the score, persist the session row.
export async function completeSession(session) {
  if (session.status === 'completed') {
    return summarize(session);
  }
  session.status = 'completed';
  session.completedAt = new Date().toISOString();
  session.lastTouch = Date.now();
  const totals = tallyScore(session.answers);
  session.totals = totals;

  await sessionsCsv.append({
    session_id: session.sessionId,
    first_name: session.firstName,
    surname: session.surname,
    created_at: session.createdAt,
    started_at: session.startedAt || '',
    completed_at: session.completedAt,
    status: session.status,
    score: totals.score,
    total_possible: config.game.totalPossibleScore,
    percentage: totals.percentage,
    correct_answers: totals.correct,
    incorrect_answers: totals.incorrect,
    timed_out: totals.timedOut,
  });
  await maybeBackup(true);
  return summarize(session);
}

// Build the full results payload (safe to send; game is over).
export function summarize(session) {
  const totals = session.totals || tallyScore(session.answers);
  return {
    sessionId: session.sessionId,
    player: publicName(session.firstName, session.surname),
    firstName: session.firstName,
    score: totals.score,
    totalPossible: config.game.totalPossibleScore,
    percentage: totals.percentage,
    correct: totals.correct,
    incorrect: totals.incorrect,
    timedOut: totals.timedOut,
    byDifficulty: totals.byDifficulty,
    answers: session.answers.map((a) => ({
      questionNumber: a.questionNumber,
      logoId: a.logoId,
      brand: a.brand,
      difficulty: a.difficulty,
      pointsPossible: a.pointsPossible,
      pointsEarned: a.pointsEarned,
      answerGiven: a.answerGiven,
      correct: a.correct,
      timedOut: a.timedOut,
    })),
    completedAt: session.completedAt,
  };
}

// ---- Backups (spec §28): copy CSVs after every N writes. ----
async function maybeBackup(force = false) {
  writeCounter += 1;
  if (!force && writeCounter % 50 !== 0) return;
  const dir = path.join(config.dataDir, 'backups');
  try {
    await sessionsCsv.backup(dir);
    await answersCsv.backup(dir);
  } catch {
    // Backup failure is non-fatal; primary write already succeeded.
  }
}

// ---- Reads for leaderboard + admin (from CSV, the durable record). ----
export async function readSessionRows() {
  return sessionsCsv.readAll();
}
export async function readAnswerRows() {
  return answersCsv.readAll();
}

// Raw export helpers (Excel-friendly with BOM).
export async function exportSessionsCsv() {
  const rows = await sessionsCsv.readAll();
  return buildCsvExport(sessionsCsv.header, rows);
}
export async function exportAnswersCsv() {
  const rows = await answersCsv.readAll();
  return buildCsvExport(answersCsv.header, rows);
}
export { sessionsCsv, answersCsv };
