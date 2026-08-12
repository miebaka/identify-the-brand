// Leaderboard derivation from the durable sessions CSV (spec §15).
import { readSessionRows } from './store.js';

// Sort: score DESC, then completion timestamp ASC (earlier wins on a tie).
export async function buildLeaderboard() {
  const rows = await readSessionRows();
  const completed = rows
    .filter((r) => r.status === 'completed' && r.completed_at)
    .map((r) => ({
      sessionId: r.session_id,
      name: `${r.first_name} ${r.surname}`.trim(),
      score: Number(r.score) || 0,
      percentage: Number(r.percentage) || 0,
      completedAt: r.completed_at,
    }));

  completed.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.completedAt.localeCompare(b.completedAt);
  });

  return completed.map((entry, i) => ({ rank: i + 1, ...entry }));
}

// Full leaderboard + the current player's placement (even if outside top N).
export async function leaderboardWithPlacement(sessionId, topN = 50) {
  const full = await buildLeaderboard();
  const top = full.slice(0, topN);
  let placement = null;
  if (sessionId) {
    const mine = full.find((e) => e.sessionId === sessionId);
    if (mine) placement = { rank: mine.rank, total: full.length, inTop: mine.rank <= topN };
  }
  return { top, placement, total: full.length };
}
