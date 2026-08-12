import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../src/server/config.js';
import { normalize, isCorrect, shuffle, interleaveByDifficulty, tallyScore } from '../src/server/game.js';

test('game configuration is 21 questions and 40 points', () => {
  assert.equal(config.game.totalQuestions, 21);
  assert.equal(config.game.totalPossibleScore, 40);
  assert.deepEqual(config.game.distribution, { easy: 8, medium: 7, hard: 6 });
  assert.equal(config.game.durationPerQuestionMs, 10000);
});

test('normalization handles case, punctuation and accents', () => {
  assert.equal(normalize("McDonald’s"), 'mcdonalds');
  assert.equal(normalize('  NIKE  '), 'nike');
});

test('answer matching accepts exact answers and one-character typos for long names', () => {
  assert.equal(isCorrect('Nike', ['nike']), true);
  assert.equal(isCorrect('Mailchim', ['mailchimp']), true);
  assert.equal(isCorrect('Mailxhim', ['mailchimp']), true);
  assert.equal(isCorrect('Nik', ['nike']), false);
});

test('shuffle preserves every item exactly once', () => {
  const source = Array.from({ length: 21 }, (_, i) => i);
  const result = shuffle(source);
  assert.equal(result.length, source.length);
  assert.deepEqual([...result].sort((a, b) => a - b), source);
});

test('difficulty interleaving preserves distribution and avoids blocks while multiple tiers remain', () => {
  const logos = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, difficulty: 'easy' })),
    ...Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, difficulty: 'medium' })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `h${i}`, difficulty: 'hard' })),
  ];
  const result = interleaveByDifficulty(logos);
  assert.equal(result.length, 21);
  assert.deepEqual(result.map((x) => x.difficulty).sort(), logos.map((x) => x.difficulty).sort());
  for (let i = 1; i < result.length; i++) {
    const remainingTiers = new Set(result.slice(i).map((x) => x.difficulty));
    if (remainingTiers.size > 1) assert.notEqual(result[i].difficulty, result[i - 1].difficulty);
  }
});

test('score tally cannot exceed the configured maximum', () => {
  const answers = [
    ...Array.from({ length: 8 }, (_, i) => ({ difficulty: 'easy', pointsPossible: 1, pointsEarned: 1, correct: true, timedOut: false, questionNumber: i + 1 })),
    ...Array.from({ length: 7 }, (_, i) => ({ difficulty: 'medium', pointsPossible: 2, pointsEarned: 2, correct: true, timedOut: false, questionNumber: i + 9 })),
    ...Array.from({ length: 6 }, (_, i) => ({ difficulty: 'hard', pointsPossible: 3, pointsEarned: 3, correct: true, timedOut: false, questionNumber: i + 16 })),
  ];
  assert.equal(tallyScore(answers).score, 40);
});
