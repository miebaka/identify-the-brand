// IDENTIFY THE BRAND — client controller.
// Explicit state machine (spec §19). One authoritative state object; screens
// are never inferred from DOM visibility.
import { api, ApiError } from './api.js';
import { CountdownTimer } from './timer.js';
import { Sound } from './sound.js';

const ARC_R = 47;
const ARC_C = 2 * Math.PI * ARC_R;

const STATE = {
  status: 'register', // register|ready|loading|playing|feedback|results|leaderboard|error
  sessionId: null,
  player: { firstName: '', surname: '' },
  game: null, // { totalQuestions, durationPerQuestionMs, totalPossibleScore }
  question: null, // current question payload
  questionNonce: 0, // increments each question; guards stale async responses
  answered: false, // one answer per question
  results: null,
};

const sound = new Sound();
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// ---- Screen management ----
function show(status) {
  STATE.status = status;
  for (const s of document.querySelectorAll('.screen')) {
    s.classList.toggle('is-active', s.dataset.screen === status);
  }
  const chromeState = $('#chrome-state');
  if (chromeState) chromeState.textContent = status.toUpperCase();
}

// aria-live announcer
function announce(msg) {
  const live = $('#live');
  if (live) live.textContent = msg;
}

// ==========================================================
// REGISTER
// ==========================================================
function initRegister() {
  const form = $('#reg-form');
  const errBox = $('#reg-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.textContent = '';
    const firstName = $('#reg-first').value.trim();
    const surname = $('#reg-surname').value.trim();
    const consent = $('#reg-consent').checked;
    if (!firstName || !surname) {
      errBox.textContent = 'Enter both a first name and a surname.';
      return;
    }
    if (!consent) {
      errBox.textContent = 'You must accept the data notice to play.';
      return;
    }
    const btn = $('#reg-submit');
    btn.disabled = true;
    try {
      const data = await api.register(firstName, surname, consent);
      STATE.sessionId = data.sessionId;
      STATE.player = { firstName, surname };
      STATE.game = data.game;
      buildReady();
      show('ready');
    } catch (err) {
      // Preserve entered fields (spec §21) — we do not clear inputs.
      errBox.textContent = err.message || 'Registration failed. Try again.';
    } finally {
      btn.disabled = false;
    }
  });
}

// ==========================================================
// READY
// ==========================================================
function buildReady() {
  $('#ready-hi').textContent = `Hi, ${STATE.player.firstName}.`;
  const max = STATE.game.totalPossibleScore;
  $('#ready-max').textContent = String(max);
}

function initReady() {
  $('#ready-start').addEventListener('click', startGame);
}

// ==========================================================
// GAMEPLAY
// ==========================================================
let timer = null;

async function startGame() {
  show('loading');
  try {
    const data = await api.start(STATE.sessionId);
    renderQuestion(data.question);
  } catch (err) {
    handleFatal(err);
  }
}

function buildPlayScreen() {
  const scr = $('[data-screen="playing"]');
  scr.innerHTML = `
    <div class="play">
      <div class="play__hud">
        <div class="play__counter"><b id="q-num">01</b><span id="q-total"></span></div>
        <output class="play__timer-num" id="timer-num" aria-hidden="true">15.0<span class="unit"> SEC</span></output>
      </div>
      <div class="arc-wrap">
        <svg class="arc" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="arc-track" cx="50" cy="50" r="${ARC_R}"></circle>
          <circle class="arc-progress" id="arc" cx="50" cy="50" r="${ARC_R}"
            stroke-dasharray="${ARC_C.toFixed(2)}" stroke-dashoffset="0"></circle>
        </svg>
        <div class="logo-frame" id="logo-frame">
          <div class="frag" id="logo-frag"></div>
          <div class="full" id="logo-full"></div>
        </div>
      </div>
      <div class="feedback" id="feedback" aria-hidden="true"></div>
      <form class="answer" id="answer-form" autocomplete="off">
        <label class="sr-only" for="answer-input">Type the brand name</label>
        <input id="answer-input" type="text" placeholder="type brand name..."
          autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
          enterkeyhint="send" />
        <button type="submit" class="btn btn--block" id="answer-submit">Submit</button>
      </form>
    </div>`;

  $('#answer-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitAnswer($('#answer-input').value);
  });
}

function renderQuestion(q) {
  STATE.question = q;
  STATE.answered = false;
  const nonce = ++STATE.questionNonce;
  show('playing');

  $('#q-num').textContent = String(q.number).padStart(2, '0');
  $('#q-total').textContent = `/ ${q.total}`;

  const frame = $('#logo-frame');
  frame.classList.remove('is-revealed');
  $('#logo-frag').innerHTML = q.fragmentSvg; // server-generated, trusted SVG
  $('#logo-full').innerHTML = '';

  const fb = $('#feedback');
  fb.innerHTML = '';
  fb.setAttribute('aria-hidden', 'true');

  const input = $('#answer-input');
  input.value = '';
  input.disabled = false;
  $('#answer-submit').disabled = false;
  // Autofocus (desktop). On mobile this also raises the keyboard.
  setTimeout(() => input.focus(), 60);

  // Timer visuals
  const arc = $('#arc');
  const num = $('#timer-num');
  arc.classList.remove('is-warn', 'is-danger');
  num.classList.remove('is-warn', 'is-danger');
  sound.appear();

  timer = new CountdownTimer({
    durationMs: q.durationMs,
    onTick: ({ fraction, seconds }) => {
      arc.setAttribute('stroke-dashoffset', (ARC_C * (1 - fraction)).toFixed(2));
      num.firstChild.textContent = seconds.toFixed(1);
      const warn = seconds <= 5 && seconds > 2;
      const danger = seconds <= 2;
      arc.classList.toggle('is-warn', warn);
      arc.classList.toggle('is-danger', danger);
      num.classList.toggle('is-warn', warn);
      num.classList.toggle('is-danger', danger);
    },
    onMilestone: (m) => {
      if (m === 0) announce("Time's up.");
      else announce(`${m} seconds remaining.`);
      if (m === 5 || m === 2) sound.warn();
    },
    onExpire: () => {
      if (nonce === STATE.questionNonce) handleTimeout();
    },
  });
  timer.start();
}

async function submitAnswer(raw) {
  if (STATE.answered) return;
  const answer = String(raw || '').trim();
  const nonce = STATE.questionNonce;
  STATE.answered = true;
  if (timer) timer.disarm();
  const input = $('#answer-input');
  input.disabled = true;
  $('#answer-submit').disabled = true;

  try {
    const res = await api.submit(STATE.sessionId, STATE.question.logoId, answer);
    if (nonce !== STATE.questionNonce) return; // stale response, ignore
    showFeedback(res, { fromTimeout: false });
  } catch (err) {
    if (nonce !== STATE.questionNonce) return;
    if (err instanceof ApiError && err.status === 409) {
      // Already answered / stale — just advance safely.
      advance();
      return;
    }
    handleFatal(err);
  }
}

async function handleTimeout() {
  if (STATE.answered) return;
  const nonce = STATE.questionNonce;
  STATE.answered = true;
  const input = $('#answer-input');
  input.disabled = true;
  $('#answer-submit').disabled = true;
  try {
    const res = await api.timeout(STATE.sessionId, STATE.question.logoId);
    if (nonce !== STATE.questionNonce) return;
    showFeedback(res, { fromTimeout: true });
  } catch (err) {
    if (nonce !== STATE.questionNonce) return;
    handleFatal(err);
  }
}

function showFeedback(res, { fromTimeout }) {
  const fb = $('#feedback');
  fb.setAttribute('aria-hidden', 'false');
  fb.innerHTML = '';

  if (res.correct) {
    const mark = el('div', 'feedback__mark ok', `✓ ${res.correctAnswer}`);
    const pts = el('div', 'feedback__pts', `+${res.pointsEarned} PT`);
    fb.append(mark, pts);
    announce(`Correct. ${res.correctAnswer}. Plus ${res.pointsEarned} points.`);
    sound.correct();
  } else if (res.timedOut || fromTimeout) {
    const mark = el('div', 'feedback__mark no', "Time's up");
    const pts = el('div', 'feedback__pts', `It was ${res.correctAnswer}`);
    fb.append(mark, pts);
    announce(`Time's up. It was ${res.correctAnswer}.`);
    sound.timeout();
  } else {
    const mark = el('div', 'feedback__mark no', 'Not quite');
    const pts = el('div', 'feedback__pts', `It was ${res.correctAnswer}`);
    fb.append(mark, pts);
    announce(`Incorrect. It was ${res.correctAnswer}.`);
    sound.wrong();
  }

  // Reveal the full logo via crossfade (spec §40). Cache it so the results
  // review can redraw it without re-requesting (and without ever holding the
  // answer key before submission).
  if (res.fullSvg) {
    if (STATE.question) REVEAL_CACHE.set(STATE.question.logoId, res.fullSvg);
    $('#logo-full').innerHTML = res.fullSvg;
    requestAnimationFrame(() => $('#logo-frame').classList.add('is-revealed'));
  }

  // Hold ~2s on feedback, then advance (spec §39).
  const nonce = STATE.questionNonce;
  setTimeout(() => {
    if (nonce === STATE.questionNonce) advance();
  }, 2000);
}

async function advance() {
  show('loading');
  try {
    const data = await api.next(STATE.sessionId);
    if (data.done) {
      STATE.results = data.results;
      renderResults(data.results);
    } else {
      renderQuestion(data.question);
    }
  } catch (err) {
    handleFatal(err);
  }
}

// ==========================================================
// RESULTS
// ==========================================================
function renderResults(r) {
  const scr = $('[data-screen="results"]');
  const d = r.byDifficulty;
  const diffRow = (label, obj) => `
    <div class="breakdown__row">
      <span class="diff">${label}</span>
      <span class="breakdown__meter"><i data-w="${obj.possible ? (obj.earned / obj.possible) * 100 : 0}"></i></span>
      <b>${obj.earned} / ${obj.possible}</b>
    </div>`;

  const cells = r.answers
    .map((a) => {
      const outcome = a.correct
        ? `<span class="earn">+${a.pointsEarned} PT</span>`
        : `<span class="zero">0 PT</span>`;
      const yourAns = a.timedOut
        ? `<div class="v wrong">— timeout —</div>`
        : a.correct
          ? `<div class="v">${escapeHtml(a.answerGiven) || '—'}</div>`
          : `<div class="v wrong">${escapeHtml(a.answerGiven) || '—'}</div>`;
      const correctLine = a.correct
        ? ''
        : `<div class="k">correct answer</div><div class="v right">${escapeHtml(a.brand)}</div>`;
      return `
        <div class="review__cell">
          <div class="review__top">
            <span class="review__num">${String(a.questionNumber).padStart(2, '0')}</span>
            <span class="review__tag ${a.difficulty}">${a.difficulty}</span>
          </div>
          <div class="review__logo" data-full="${a.logoId}"></div>
          <div class="review__ans">
            <div class="k">your answer</div>${yourAns}${correctLine}
          </div>
          <div class="review__result">
            <span>${a.correct ? 'Identified' : a.timedOut ? 'Timed out' : 'Missed'}</span>
            <b>${outcome}</b>
          </div>
        </div>`;
    })
    .join('');

  scr.innerHTML = `
    <div class="results">
      <div class="results__hero">
        <div class="eyebrow">Your Score</div>
        <div class="score-big" id="score-big">0<span class="of"> / ${r.totalPossible}</span></div>
        <div class="score-bar"><div class="score-bar__fill" id="score-fill"></div></div>
        <div class="score-meta">
          <span class="pct" id="score-pct">0%</span>
          <span class="msg">${escapeHtml(r.message)}</span>
        </div>
      </div>
      <div>
        <div class="section-label"><span>Performance by difficulty</span><span>Earned / Possible</span></div>
        <div class="breakdown" style="margin-top:var(--s4)">
          ${diffRow('Easy', d.easy)}
          ${diffRow('Medium', d.medium)}
          ${diffRow('Hard', d.hard)}
        </div>
      </div>
      <div>
        <div class="section-label"><span>The Review</span><span>${r.answers.length} artefacts</span></div>
        <div class="review">${cells}</div>
      </div>
      <div class="results__actions">
        <button class="btn" id="to-board">See Leaderboard →</button>
        <button class="btn btn--ghost" id="to-replay">Play Again</button>
      </div>
    </div>`;

  show('results');

  // Fetch full logos for the review from the server reveal (already have them
  // in the answers via a lightweight per-logo endpoint). We reuse fragmentless
  // full art by asking the results payload — but to keep the answer key server
  // side, we request full art through the public reveal we already received.
  hydrateReviewLogos(r.answers);

  // Animate score ticker + bars (respect reduced motion).
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const big = $('#score-big');
  const pct = $('#score-pct');
  const fill = $('#score-fill');
  const bars = scr.querySelectorAll('.breakdown__meter i');

  if (reduce) {
    big.firstChild.textContent = String(r.score);
    pct.textContent = `${r.percentage}%`;
    fill.style.width = `${r.percentage}%`;
    bars.forEach((b) => (b.style.width = `${b.dataset.w}%`));
  } else {
    animateNumber(big.firstChild, 0, r.score, 1100);
    animateNumber(pct, 0, r.percentage, 1100, '%');
    requestAnimationFrame(() => {
      fill.style.width = `${r.percentage}%`;
      bars.forEach((b) => (b.style.width = `${b.dataset.w}%`));
    });
    if (r.score >= 30) big.classList.add('celebrate');
  }

  $('#to-board').addEventListener('click', showLeaderboard);
  $('#to-replay').addEventListener('click', replay);
  announce(`Final score ${r.score} out of ${r.totalPossible}. ${r.message}`);
}

// The results payload does not resend full SVGs (kept lean). Fetch each full
// logo image for the review grid from the public reveal already stored per
// answer during play — we cached them on the client as we revealed.
const REVEAL_CACHE = new Map();
function hydrateReviewLogos(answers) {
  for (const a of answers) {
    const holder = document.querySelector(`.review__logo[data-full="${a.logoId}"]`);
    if (holder && REVEAL_CACHE.has(a.logoId)) {
      holder.innerHTML = REVEAL_CACHE.get(a.logoId);
    }
  }
}

function animateNumber(node, from, to, durationMs, suffix = '') {
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = Math.round(from + (to - from) * eased);
    node.textContent = `${val}${suffix}`;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ==========================================================
// LEADERBOARD
// ==========================================================
async function showLeaderboard() {
  show('loading');
  try {
    const data = await api.leaderboard(STATE.sessionId);
    renderLeaderboard(data);
  } catch (err) {
    handleFatal(err);
  }
}

function renderLeaderboard(data) {
  const scr = $('[data-screen="leaderboard"]');
  const rows = data.top
    .map((e) => {
      const isMe = e.sessionId === STATE.sessionId;
      const first = e.rank === 1 ? ' is-first' : '';
      return `
        <div class="board__row${isMe ? ' is-me' : ''}${first}">
          <span class="rank">${String(e.rank).padStart(2, '0')}</span>
          <span class="name">${escapeHtml(e.name)}</span>
          <span class="score">${e.score}</span>
        </div>`;
    })
    .join('');

  let placement = '';
  if (data.placement && !data.placement.inTop) {
    placement = `<div class="board__placement">You placed <b>#${data.placement.rank}</b> of ${data.placement.total}.</div>`;
  } else if (data.placement && data.placement.rank === 1) {
    placement = `<div class="board__placement">♛ You hold <b>#1</b>.</div>`;
  }

  scr.innerHTML = `
    <div class="board">
      <div>
        <div class="eyebrow">Leaderboard</div>
        <h2 class="title" style="font-size:clamp(2.2rem,8vw,3.6rem);margin-top:var(--s4)">STANDINGS</h2>
      </div>
      ${placement}
      <div class="board__table">
        <div class="board__row board__row--head">
          <span>Rank</span><span>Player</span><span>Score</span>
        </div>
        ${rows || '<div class="board__row"><span></span><span class="name">No completed games yet.</span><span></span></div>'}
      </div>
      <div class="results__actions">
        <button class="btn" id="board-replay">Play Again</button>
        <button class="btn btn--ghost" id="board-back">← Back to Results</button>
      </div>
    </div>`;

  show('leaderboard');
  $('#board-replay').addEventListener('click', replay);
  $('#board-back').addEventListener('click', () => {
    if (STATE.results) {
      renderResults(STATE.results);
    } else {
      show('results');
    }
  });
}

// ==========================================================
// REPLAY / ERROR
// ==========================================================
function replay() {
  STATE.sessionId = null;
  STATE.question = null;
  STATE.results = null;
  STATE.answered = false;
  REVEAL_CACHE.clear();
  $('#reg-form').reset();
  $('#reg-error').textContent = '';
  show('register');
  setTimeout(() => $('#reg-first').focus(), 80);
}

function handleFatal(err) {
  const scr = $('[data-screen="error"]');
  const expired = err instanceof ApiError && err.status === 404;
  scr.innerHTML = `
    <div class="state-msg">
      <div class="eyebrow">System</div>
      <div class="title" style="font-size:clamp(2rem,8vw,3rem)">${expired ? 'SESSION LOST' : 'SIGNAL DROPPED'}</div>
      <p class="lede" style="text-align:center">${escapeHtml(err.message || 'Something went wrong.')}${expired ? ' Your game state could not be recovered. Start a new run.' : ''}</p>
      <button class="btn" id="err-retry">${expired ? 'New Game' : 'Retry'}</button>
    </div>`;
  show('error');
  $('#err-retry').addEventListener('click', () => {
    if (expired) {
      replay();
    } else if (STATE.status === 'error' && STATE.question) {
      advance();
    } else {
      replay();
    }
  });
}

// ==========================================================
// UTIL
// ==========================================================
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

// ==========================================================
// SOUND TOGGLE + BOOT
// ==========================================================
function initSound() {
  const btn = $('#sound-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const on = sound.toggle();
    btn.textContent = on ? 'SND ON' : 'SND OFF';
    btn.classList.toggle('mono-red', on);
  });
}

function boot() {
  buildPlayScreen();
  initRegister();
  initReady();
  initSound();
  show('register');
  setTimeout(() => $('#reg-first')?.focus(), 120);
}

document.addEventListener('DOMContentLoaded', boot);
