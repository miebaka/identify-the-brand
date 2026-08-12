// Google Sheets backend via an Apps Script Web App webhook.
import config from './config.js';

const CACHE_MS = 4000;
const cache = new Map();

async function call(payload, { timeoutMs = 10000 } = {}) {
  if (!config.sheets.url) throw new Error('Sheets webhook URL not configured.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(config.sheets.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: config.sheets.secret, ...payload }),
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Sheets webhook HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (data?.error) throw new Error(`Sheets: ${data.error}`);
    return data || {};
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry transient Sheets failures. The caller can remain responsive because
// gameplay persistence is mirrored locally before this network operation.
export async function appendRow(tab, row) {
  cache.delete(tab);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await call({ action: 'append', tab, row }, { timeoutMs: 8000 });
      return;
    } catch (err) {
      lastError = err;
      if (attempt < 2) await sleep(300 * 2 ** attempt);
    }
  }
  throw lastError;
}

export async function readRows(tab) {
  const c = cache.get(tab);
  if (c && Date.now() - c.t < CACHE_MS) return c.rows;
  const data = await call({ action: 'read', tab });
  const rows = Array.isArray(data.rows) ? data.rows : [];
  cache.set(tab, { t: Date.now(), rows });
  return rows;
}

export async function ensureTabs(tabs) {
  await call({ action: 'ensure', tabs });
}
