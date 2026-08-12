// Google Sheets backend via an Apps Script Web App webhook.
//
// No Google Cloud project or service-account key is required: the operator
// pastes a small Apps Script (see scripts/google-apps-script.gs), deploys it as
// a Web App, and sets SHEETS_WEBHOOK_URL + SHEETS_SECRET. This module POSTs
// rows to it and reads rows back. All calls carry the shared secret in the body
// (never the URL) and the app rejects mismatches.
import config from './config.js';

// Short read cache so a burst of leaderboard views doesn't hammer Apps Script
// (which has per-day URL-fetch quotas). Appends bust the cache for that tab.
const CACHE_MS = 4000;
const cache = new Map(); // tab -> { t, rows }

async function call(payload, { timeoutMs = 10000 } = {}) {
  if (!config.sheets.url) throw new Error('Sheets webhook URL not configured.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(config.sheets.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: config.sheets.secret, ...payload }),
      redirect: 'follow', // Apps Script 302-redirects to googleusercontent.com
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Sheets webhook HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (data && data.error) throw new Error(`Sheets: ${data.error}`);
  return data || {};
}

// Append one record (object keyed by header) to a tab ('sessions' | 'answers').
export async function appendRow(tab, row) {
  cache.delete(tab);
  await call({ action: 'append', tab, row });
}

// Read all records from a tab as array-of-objects keyed by the header row.
export async function readRows(tab) {
  const c = cache.get(tab);
  if (c && Date.now() - c.t < CACHE_MS) return c.rows;
  const data = await call({ action: 'read', tab });
  const rows = Array.isArray(data.rows) ? data.rows : [];
  cache.set(tab, { t: Date.now(), rows });
  return rows;
}

// Ensure the sheet tabs exist with the given headers, and verify connectivity.
export async function ensureTabs(tabs) {
  await call({ action: 'ensure', tabs });
}
