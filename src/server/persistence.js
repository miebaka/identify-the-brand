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
    console.log('[persistence] Google Sheets backend enabled.');
    // Ensure the tabs exist, but do NOT block server startup on a network
    // round-trip to Google (keeps cold starts fast and health checks green).
    // Tabs are also auto-created on the first write, so this is best-effort.
    sheets
      .ensureTabs({ sessions: SESSION_HEADER, answers: ANSWER_HEADER })
      .then(() => console.log('[persistence] Google Sheets connected.'))
      .catch((err) =>
        console.warn(
          `[warn] Google Sheets webhook not reachable yet (${err.message}). ` +
            'Writes will retry; local CSV mirror is active meanwhile.',
        ),
      );
  }
}

// Append helpers. The local CSV append is awaited (fast, serialized). The Sheets
// write is fire-and-forget: gameplay latency never depends on Google's network,
// and a webhook hiccup can't block or fail a player's submission. Failures are
// logged for the operator; the local CSV mirror still holds the row.
function mirrorToSheet(tab, record) {
  if (!useSheets) return;
  sheets
    .appendRow(tab, record)
    .catch((err) => console.warn(`[warn] Sheets append (${tab}) failed: ${err.message}`));
}

export async function appendSession(record) {
  await sessionsCsv.append(record);
  mirrorToSheet('sessions', record);
}

export async function appendAnswer(record) {
  await answersCsv.append(record);
  mirrorToSheet('answers', record);
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
