// Pure game logic: normalization, answer matching, secure randomisation,
// difficulty interleaving, scoring, and performance messaging.
import { randomInt } from 'node:crypto';
import config from './config.js';

export function normalize(input) {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`.,!?/\\_-]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
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

export function isCorrect(rawAnswer, acceptableAnswers) {
  const guess = normalize(rawAnswer);
  if (!guess) return false;
  return acceptableAnswers.some((accepted) => {
    const target = normalize(accepted);
    return guess === target || (target.length >= 6 && levenshtein(guess, target) <= 1);
  });
}

// Fisher-Yates with crypto.randomInt. Quiz ordering does not need secrecy, but
// using a CSPRNG removes biased/predictable Math.random() behaviour entirely.
export function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Weighted random interleaving prevents adjacent repeats and avoids obvious
// Easy→Medium→Hard blocks while still allowing each tier to appear naturally.
export function interleaveByDifficulty(logos) {
  const buckets = {
    easy: shuffle(logos.filter((l) => l.difficulty === 'easy')),
    medium: shuffle(logos.filter((l) => l.difficulty === 'medium')),
    hard: shuffle(logos.filter((l) => l.difficulty === 'hard')),
  };
  const remaining = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]));
  const result = [];
  let previous = null;

  while (result.length < logos.length) {
    const available = Object.keys(buckets).filter((d) => remaining[d] > 0);
    let candidates = available.filter((d) => d !== previous);
    if (!candidates.length) candidates = available;

    const total = candidates.reduce((sum, d) => sum + remaining[d], 0);
    let pick = randomInt(total);
    let chosen = candidates[candidates.length - 1];
    for (const d of candidates) {
      if (pick < remaining[d]) {
        chosen = d;
        break;
      }
      pick -= remaining[d];
    }

    result.push(buckets[chosen].pop());
    remaining[chosen] -= 1;
    previous = chosen;
  }
  return result;
}

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
    if (a.timedOut) timedOut += 1;
    else if (a.correct) {
      correct += 1;
      score += a.pointsEarned;
      d.correct += 1;
      d.earned += a.pointsEarned;
    } else incorrect += 1;
  }

  const percentage = Math.round((score / config.game.totalPossibleScore) * 100);
  return { score, correct, incorrect, timedOut, percentage, byDifficulty };
}

export function performanceMessage(score) {
  const max = config.game.totalPossibleScore;
  const pct = max ? score / max : 0;
  if (score >= max) return 'Perfect score.';
  if (pct >= 0.75) return 'Design brain confirmed.';
  if (pct >= 0.5) return 'Solid eye.';
  if (pct >= 0.25) return "You're getting there.";
  return 'Room to improve.';
}
