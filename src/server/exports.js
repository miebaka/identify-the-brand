// Admin export builders. All exports are UTF-8 with a BOM (Excel-friendly),
// injection-safe via the CsvTable escaping, and date-stamped by the route.
import config from './config.js';
import { buildCsvExport } from './csv.js';
import { readSessionRows, readAnswerRows } from './store.js';

export function dateStamp(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Scores export: one row per completed session (spec §12 primary export).
export async function scoresCsv() {
  const rows = await readSessionRows();
  const header = [
    'session_id',
    'first_name',
    'surname',
    'score',
    'total_possible',
    'percentage',
    'correct_answers',
    'incorrect_answers',
    'timed_out',
    'completed_at',
  ];
  const records = rows
    .filter((r) => r.status === 'completed')
    .map((r) => ({
      session_id: r.session_id,
      first_name: r.first_name,
      surname: r.surname,
      score: r.score,
      total_possible: r.total_possible,
      percentage: r.percentage,
      correct_answers: r.correct_answers,
      incorrect_answers: r.incorrect_answers,
      timed_out: r.timed_out,
      completed_at: r.completed_at,
    }));
  return buildCsvExport(header, records);
}

// Answers export: one row per question (spec §12 detailed export).
export async function answersCsvExport() {
  const rows = await readAnswerRows();
  const header = [
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
    'timestamp',
  ];
  const records = rows.map((r) => ({
    session_id: r.session_id,
    question_number: r.question_number,
    logo_id: r.logo_id,
    brand: r.brand,
    difficulty: r.difficulty,
    points_possible: r.points_possible,
    points_earned: r.points_earned,
    answer_given: r.answer_given,
    correct: r.correct,
    elapsed_ms: r.elapsed_ms,
    time_remaining_ms: r.time_remaining_ms,
    timestamp: r.submitted_at,
  }));
  return buildCsvExport(header, records);
}

// Full dataset: session row joined with each of its answers (spec §12).
export async function fullCsv() {
  const sessions = await readSessionRows();
  const answers = await readAnswerRows();
  const byId = new Map();
  for (const s of sessions) byId.set(s.session_id, s);

  const header = [
    'session_id',
    'first_name',
    'surname',
    'session_status',
    'session_score',
    'total_possible',
    'session_percentage',
    'completed_at',
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
  ];
  const records = answers.map((a) => {
    const s = byId.get(a.session_id) || {};
    return {
      session_id: a.session_id,
      first_name: s.first_name || '',
      surname: s.surname || '',
      session_status: s.status || '',
      session_score: s.score || '',
      total_possible: s.total_possible || '',
      session_percentage: s.percentage || '',
      completed_at: s.completed_at || '',
      question_number: a.question_number,
      logo_id: a.logo_id,
      brand: a.brand,
      difficulty: a.difficulty,
      points_possible: a.points_possible,
      points_earned: a.points_earned,
      answer_given: a.answer_given,
      correct: a.correct,
      elapsed_ms: a.elapsed_ms,
      time_remaining_ms: a.time_remaining_ms,
      submitted_at: a.submitted_at,
    };
  });
  return buildCsvExport(header, records);
}

// Admin stats for the dashboard header (spec §46).
export async function adminStats() {
  const sessions = await readSessionRows();
  const completed = sessions.filter((r) => r.status === 'completed');
  const scores = completed.map((r) => Number(r.score) || 0);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const high = scores.length ? Math.max(...scores) : 0;
  return {
    players: sessions.length,
    completed: completed.length,
    avgScore: Math.round(avg * 10) / 10,
    highScore: high,
    totalPossible: config.game.totalPossibleScore,
  };
}

// Player table for the dashboard (spec §46), newest first.
export async function playerRows() {
  const sessions = await readSessionRows();
  return sessions
    .filter((r) => r.status === 'completed')
    .map((r) => ({
      name: `${r.first_name} ${r.surname}`.trim(),
      score: Number(r.score) || 0,
      totalPossible: Number(r.total_possible) || 40,
      percentage: Number(r.percentage) || 0,
      completedAt: r.completed_at,
      status: r.status,
    }))
    .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));
}
