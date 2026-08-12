// Persistence abstraction. Two backends behind one surface:
//
//   - CSV (default): local files, injection-safe, serialized writes.
//   - Google Sheets (when config.sheets.enabled): durable, operator-visible,
//     no disk required — ideal for free-tier hosting.
//
// When Sheets is enabled we STILL mirror to the local CSV (a best-effort,
// within-instance copy) but treat Sheets as the source of truth for reads
// (leaderboard + exports), since the local file is ephemeral on such hosts.
import path from 'node:path';
import config from './config.js';
import { CsvTable, buildCsvExport } from './csv.js';
import * as sheets from './sheets.js';

export const SESSION_HEADER = [
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
];

export const ANSWER_HEADER = [
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
];

const sessionsCsv = new CsvTable(path.join(config.dataDir, 'sessions.csv'), SESSION_HEADER);
const answersCsv = new CsvTable(path.join(config.dataDir, 'answers.csv'), ANSWER_HEADER);

const useSheets = config.sheets.enabled;

export function backend() {
  return useSheets ? 'sheets' : 'csv';
}

export async function init() {
  // Local CSV files always exist (mirror + fallback), and validate headers.
  sessionsCsv.ensure();
  answersCsv.ensure();
  if (useSheets) {
    try {
      await sheets.ensureTabs({ sessions: SESSION_HEADER, answers: ANSWER_HEADER });
      console.log('[persistence] Google Sheets backend active.');
    } catch (err) {
      // Non-fatal: the game still runs on the local CSV mirror. Surface loudly
      // so the operator fixes the webhook.
      console.warn(
        `[warn] Google Sheets webhook unreachable at startup (${err.message}). ` +
          'Falling back to local CSV until it is reachable.',
      );
    }
  }
}

// Append helpers. The local CSV append is awaited (fast, serialized); the Sheets
// append is best-effort so a webhook hiccup never blocks or fails a player's
// submission — failures are logged for the operator.
export async function appendSession(record) {
  await sessionsCsv.append(record);
  if (useSheets) {
    try {
      await sheets.appendRow('sessions', record);
    } catch (err) {
      console.warn(`[warn] Sheets appendSession failed: ${err.message}`);
    }
  }
}

export async function appendAnswer(record) {
  await answersCsv.append(record);
  if (useSheets) {
    try {
      await sheets.appendRow('answers', record);
    } catch (err) {
      console.warn(`[warn] Sheets appendAnswer failed: ${err.message}`);
    }
  }
}

// Reads come from the source of truth: Sheets when enabled, else local CSV.
export async function readSessions() {
  if (useSheets) {
    try {
      return await sheets.readRows('sessions');
    } catch (err) {
      console.warn(`[warn] Sheets readSessions failed, using local CSV: ${err.message}`);
    }
  }
  return sessionsCsv.readAll();
}

export async function readAnswers() {
  if (useSheets) {
    try {
      return await sheets.readRows('answers');
    } catch (err) {
      console.warn(`[warn] Sheets readAnswers failed, using local CSV: ${err.message}`);
    }
  }
  return answersCsv.readAll();
}

// Excel-friendly CSV exports built from whichever backend is authoritative.
export async function exportSessionsCsv() {
  return buildCsvExport(SESSION_HEADER, await readSessions());
}
export async function exportAnswersCsv() {
  return buildCsvExport(ANSWER_HEADER, await readAnswers());
}

// Local CSV backup (no-op value when Sheets is authoritative, but harmless).
export async function backup(dir) {
  await sessionsCsv.backup(dir);
  await answersCsv.backup(dir);
}
