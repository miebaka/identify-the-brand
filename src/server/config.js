// Central configuration for local Node/Express and Vercel.
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });

function bool(v, def = false) {
  if (v === undefined) return def;
  return v === '1' || String(v).toLowerCase() === 'true';
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const isVercel = Boolean(process.env.VERCEL);

// Vercel's project filesystem is read-only. /tmp is writable but ephemeral,
// which is fine because Google Sheets is the durable production backend.
const defaultDataDir = isVercel ? '/tmp/identify-the-brand' : './data';

const config = {
  root: process.cwd(),
  env: NODE_ENV,
  isProd,
  isVercel,
  port: Number(process.env.PORT) || 3000,
  trustProxy: bool(process.env.TRUST_PROXY, isVercel),
  dataDir: path.resolve(process.env.DATA_DIR || defaultDataDir),
  logosFile: path.resolve(process.env.LOGOS_FILE || path.join('data', 'logos.json')),
  publicDir: path.resolve(process.cwd(), 'public'),
  retentionDays: Number(process.env.RETENTION_DAYS) || 90,
  admin: {
    user: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
    tokenSecret: process.env.ADMIN_TOKEN_SECRET || '',
  },
  sheets: {
    url: process.env.SHEETS_WEBHOOK_URL || '',
    secret: process.env.SHEETS_SECRET || '',
    get enabled() {
      return Boolean(this.url && this.secret);
    },
  },
  game: (() => {
    const distribution = { easy: 8, medium: 7, hard: 6 };
    const points = { easy: 1, medium: 2, hard: 3 };
    const totalQuestions = distribution.easy + distribution.medium + distribution.hard;
    const totalPossibleScore = distribution.easy * points.easy + distribution.medium * points.medium + distribution.hard * points.hard;
    return {
      totalQuestions,
      durationPerQuestionMs: 10000,
      graceMs: 750,
      totalPossibleScore,
      distribution,
      points,
    };
  })(),
};

export function assertProductionSecrets() {
  const problems = [];
  if (!config.admin.password || config.admin.password.length < 12) problems.push('ADMIN_PASSWORD must be set and at least 12 characters.');
  if (!config.admin.tokenSecret || config.admin.tokenSecret.length < 16) problems.push('ADMIN_TOKEN_SECRET must be set and at least 16 characters.');
  return problems;
}

export default config;
