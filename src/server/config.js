// Central configuration. Reads environment, applies safe defaults, and fails
// loudly on missing critical secrets in production.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// Load .env from the project ROOT explicitly, so the server works no matter
// what directory it is launched from (e.g. a parent-folder launch.json).
dotenv.config({ path: path.join(ROOT, '.env') });

function bool(v, def = false) {
  if (v === undefined) return def;
  return v === '1' || String(v).toLowerCase() === 'true';
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

const config = {
  root: ROOT,
  env: NODE_ENV,
  isProd,
  port: Number(process.env.PORT) || 3000,
  trustProxy: bool(process.env.TRUST_PROXY, false),

  // Writable persistence dir (CSV + backups). On a host with a mounted disk,
  // set DATA_DIR to an absolute path OUTSIDE the repo (e.g. /var/data) so the
  // disk mount does not shadow the committed logo registry below.
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || './data'),
  // The logo registry is read-only and ships in the repo, so it is resolved
  // independently of DATA_DIR (a disk mounted at ./data must not hide it).
  logosFile: path.resolve(
    ROOT,
    process.env.LOGOS_FILE || path.join('data', 'logos.json'),
  ),
  publicDir: path.resolve(ROOT, 'public'),

  retentionDays: Number(process.env.RETENTION_DAYS) || 90,

  admin: {
    user: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
    tokenSecret: process.env.ADMIN_TOKEN_SECRET || '',
  },

  // Authoritative game parameters (see spec "CRITICAL GAME PARAMETERS").
  //
  // MAXIMUM SCORE is DERIVED from the distribution + points (single source of
  // truth), never hard-coded, so a perfect game always reads score/max = 100%.
  // Distribution 8 easy×1 + 7 medium×2 + 6 hard×3 = 8 + 14 + 18 = 40.
  // (The original 8/6/6 summed to 38; adding a 7th medium reaches the intended
  // 40 cleanly. Change these and the whole app — UI, exports, validation —
  // follows automatically.)
  game: (() => {
    const distribution = { easy: 8, medium: 7, hard: 6 };
    const points = { easy: 1, medium: 2, hard: 3 };
    const totalQuestions = distribution.easy + distribution.medium + distribution.hard;
    const totalPossibleScore =
      distribution.easy * points.easy +
      distribution.medium * points.medium +
      distribution.hard * points.hard;
    return {
      totalQuestions,
      durationPerQuestionMs: 15000,
      // Small allowance for network latency so an answer that left the browser
      // just before 15.000s is not rejected by wire time. Timing remains
      // server-authoritative; this only widens the acceptance window slightly.
      graceMs: 750,
      totalPossibleScore, // = 40 with the current 8/7/6 distribution
      distribution,
      points,
    };
  })(),
};

export function assertProductionSecrets() {
  const problems = [];
  if (!config.admin.password || config.admin.password.length < 12) {
    problems.push('ADMIN_PASSWORD must be set and at least 12 characters.');
  }
  if (!config.admin.tokenSecret || config.admin.tokenSecret.length < 16) {
    problems.push('ADMIN_TOKEN_SECRET must be set and at least 16 characters.');
  }
  if (config.isProd && problems.length) {
    throw new Error(
      'Refusing to start in production with insecure admin config:\n  - ' +
        problems.join('\n  - '),
    );
  }
  return problems; // returned for a non-fatal warning in development
}

export default config;
