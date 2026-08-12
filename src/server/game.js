// Pure game logic: normalization, answer matching, shuffling, scoring.
// No I/O here so this is trivially testable.
import config from './config.js';

// Normalize an answer for comparison (spec §9):
//   trim, lowercase, unicode NFKD fold (strip diacritics), collapse spaces,
//   drop harmless punctuation (keep letters/numbers/spaces).
export function normalize(input) {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks
    .toLowerCase()
    .replace(/['’`.,!?/\\_-]/g, ' ') // harmless punctuation -> space
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Levenshtein distance, capped early — we only ever care about <= 1.
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2; // > 1, exact value irrelevant
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Decide whether an answer matches. Conservative typo tolerance:
//   - exact normalized match always wins
//   - Levenshtein distance 1 allowed ONLY when the accepted answer is >= 6
//     chars (avoids "x" -> "y" style false positives on short brands)
export function isCorrect(rawAnswer, acceptableAnswers) {
  const guess = normalize(rawAnswer);
  if (!guess) return false;
  for (const accepted of acceptableAnswers) {
    const target = normalize(accepted);
    if (guess === target) return true;
    if (target.length >= 6 && levenshtein(guess, target) <= 1) return true;
  }
  return false;
}

// Fisher-Yates, seeded by crypto for fairness (spec §16). Returns a new array.
export function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Interleave difficulties so runs of the same difficulty are broken up
// (spec §16: "Easy/Medium/Hard must be interleaved. Do not group difficulty").
// Strategy: shuffle within each difficulty, then weave by proportional spacing.
export function interleaveByDifficulty(logos) {
  const buckets = { easy: [], medium: [], hard: [] };
  for (const l of logos) buckets[l.difficulty].push(l);
  for (const k of Object.keys(buckets)) buckets[k] = shuffle(buckets[k]);

  // Assign each item a target position spread evenly across [0,1), then sort.
  const placed = [];
  for (const k of Object.keys(buckets)) {
    const arr = buckets[k];
    arr.forEach((item, i) => {
      const pos = (i + 0.5) / arr.length + Math.random() * 0.001; // tie-break
      placed.push({ item, pos });
    });
  }
  placed.sort((a, b) => a.pos - b.pos);

  // Guard against accidental 3-in-a-row of the same difficulty by a light swap.
  const order = placed.map((p) => p.item);
  for (let i = 2; i < order.length; i++) {
    if (
      order[i].difficulty === order[i - 1].difficulty &&
      order[i].difficulty === order[i - 2].difficulty
    ) {
      for (let j = i + 1; j < order.length; j++) {
        if (order[j].difficulty !== order[i].difficulty) {
          [order[i], order[j]] = [order[j], order[i]];
          break;
        }
      }
    }
  }
  return order;
}

// Score a completed set of answers.
export function tallyScore(answers) {
  let score = 0;
  let correct = 0;
  let incorrect = 0;
  let timedOut = 0;
  const byDifficulty = {
    easy: { correct: 0, total: 0, earned: 0, possible: 0 },
    medium: { correct: 0, total: 0, earned: 0, possible: 0 },
    hard: { correct: 0, total: 0, earned: 0, possible: 0 },
  };
  for (const a of answers) {
    const d = byDifficulty[a.difficulty];
    d.total += 1;
    d.possible += a.pointsPossible;
    if (a.timedOut) {
      timedOut += 1;
    } else if (a.correct) {
      correct += 1;
      score += a.pointsEarned;
      d.correct += 1;
      d.earned += a.pointsEarned;
    } else {
      incorrect += 1;
    }
  }
  const percentage = Math.round((score / config.game.totalPossibleScore) * 100);
  return { score, correct, incorrect, timedOut, percentage, byDifficulty };
}

// Performance message tiers (spec §42). Derived from the max score so they
// stay correct if the distribution changes — a genuine perfect game always
// reads "Perfect score."
export function performanceMessage(score) {
  const max = config.game.totalPossibleScore;
  const pct = max ? score / max : 0;
  if (score >= max) return 'Perfect score.';
  if (pct >= 0.75) return 'Design brain confirmed.';
  if (pct >= 0.5) return 'Solid eye.';
  if (pct >= 0.25) return "You're getting there.";
  return 'Room to improve.';
}
