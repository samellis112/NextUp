/* Game orchestration: menu, daily challenge, practice rounds, results,
   stats, history — local-first; account features layer on top. */

import './migrate.js'; // must stay first: renames saved data before anything reads it
import { makeRng, rngHelpers } from './rng.js';
import { renderPanel, panelEq } from './panels.js';
import { generateProblem, generateNestedFinale, generateTrial } from './generators.js?v=57';
import { renderBuilder } from './builder.js?v=55';
import { shake, playSound, setStreakHeat, primeAudio, isMuted, setMuted, reducedMotion } from './feel.js';
import { showLevels, stepLevel, levelSlip, hideLevels, levelFromResults, setScenes } from './levels.js?v=33';
import {
  DAILY_GEN_VERSION, DAILY_LENGTH, todayKey, dailyNumber, dailySeed,
  dailyRamp, msUntilTomorrow, formatCountdown, shareText,
} from './daily.js';
import {
  loadHistory, saveHistoryEntry, getDailyResult, saveDailyResult,
  computeStreaks, loadDaily, getPendingJoin, getFlag, setFlag, getGuest,
} from './storage.js';
import { esc, registerScreens, showScreen, activeScreen, openModal, closeModal } from './ui.js';
import {
  currentUser, initAuth, capturePendingInvite, resolvePendingInvite,
  showInviteLanding, openLeaderboard, postScore,
  signInWithGoogle, googleButtonHtml, requireAccount, postFeedback,
  postGuestScore, renderTodayBoard,
} from './social.js?v=58';

const PRACTICE_LENGTH = 5;
const DAILY_PROGRESS_KEY = 'nextup-daily-progress-v1';

let practiceDifficulty = 'medium';
let game = null;
let countdownTimer = null;

const ui = {
  sequence: document.getElementById('sequence'),
  builder: document.getElementById('answer-builder'),
  panel: document.querySelector('#screen-round .panel'),
  msg: document.getElementById('msg'),
  rule: document.getElementById('rule-note'),
  next: document.getElementById('next'),
  timer: document.getElementById('timer'),
  problemNum: document.getElementById('problemNum'),
  progress: document.getElementById('progress'),
};

/* ---------- Daily progress (mid-round persistence: no restart-scumming) ---------- */

function loadDailyProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(DAILY_PROGRESS_KEY));
    if (p && p.day === todayKey() && p.v === DAILY_GEN_VERSION) return p;
  } catch { /* ignore */ }
  return null;
}
function saveDailyProgress(results) {
  try {
    localStorage.setItem(DAILY_PROGRESS_KEY, JSON.stringify({
      day: todayKey(), v: DAILY_GEN_VERSION, results,
    }));
  } catch { /* ignore */ }
}
function clearDailyProgress() {
  try { localStorage.removeItem(DAILY_PROGRESS_KEY); } catch { /* ignore */ }
}

/* ---------- Round flow ---------- */

function dailyQuestions() {
  const R = rngHelpers(makeRng(dailySeed()));
  const qs = dailyRamp().map(diff => generateProblem(R, diff));
  // No puzzle type twice in one daily: a repeat is re-drawn from its own
  // side seed, so the other puzzles of the day stay exactly as they were.
  qs.forEach((q, i) => {
    const earlier = qs.slice(0, i).map(e => e.gen);
    if (earlier.includes(q.gen)) {
      qs[i] = generateProblem(rngHelpers(makeRng(dailySeed() + ':alt' + i)), q.difficulty, earlier);
    }
  });
  qs.push(generateNestedFinale(R)); // hard nested-shape finale
  return qs;
}

function startDaily() {
  const existing = getDailyResult(todayKey());
  if (existing) { showDailyResults(existing); return; }

  const progress = loadDailyProgress();
  game = {
    mode: 'daily',
    questions: dailyQuestions(),
    idx: progress ? progress.results.length : 0,
    results: progress ? progress.results.slice() : [],
    answered: false,
    heat: 0,
    elapsedMs: 0,
    startTs: 0,
    timerId: null,
  };
  primeAudio();
  setStreakHeat(0);
  showLevels(levelFromResults(game.results)); // resumes part-way up on a resumed daily
  showScreen('round');
  loadQuestion();
}

function startPractice() {
  game = {
    mode: 'practice',
    questions: null, // generated lazily, unseeded
    idx: 0,
    results: [],
    answered: false,
    heat: 0,
    elapsedMs: 0,
    startTs: 0,
    timerId: null,
  };
  primeAudio();
  setStreakHeat(0);
  showLevels(levelFromResults(game.results)); // resumes part-way up on a resumed daily
  showScreen('round');
  loadQuestion();
}

const isNewPlayer = () => Object.keys(loadDaily().results).length === 0 && !loadDailyProgress();

/* "Try the game": one random puzzle, then a result with Play Again. Meant for
   handing to someone new (also reachable directly with ?try in the link).
   Nothing is saved or posted. */
function startDemo() {
  closeModal();
  const R = rngHelpers(makeRng(null));
  const q = generateProblem(R, R.pick(['medium', 'hard'])); // never easy: the try link should show off a real puzzle
  if (!q.instruction) q.instruction = 'What comes next?';
  game = {
    mode: 'demo',
    questions: [q],
    idx: 0,
    results: [],
    answered: false,
    heat: 0,
    elapsedMs: 0,
    startTs: 0,
    timerId: null,
  };
  primeAudio();
  setStreakHeat(0);
  showLevels(0);
  showScreen('round');
  loadQuestion();
}

const fbButtons = () => [1, 2, 3, 4, 5]
  .map(n => `<button type="button" class="fb-num" data-v="${n}" aria-pressed="false">${n}</button>`).join('');

/* Two 1–5 ratings on the try-mode result; sent once, to the feedback table. */
function wireDemoFeedback(r, q) {
  const box = document.getElementById('demo-feedback');
  const send = document.getElementById('btn-fb-send');
  const status = document.getElementById('fb-status');
  const picked = { rating: null, recommend: null };
  box.querySelectorAll('.fb-scale').forEach(scale => {
    scale.querySelectorAll('.fb-num').forEach(btn => btn.addEventListener('click', () => {
      picked[scale.dataset.fb] = parseInt(btn.dataset.v, 10);
      scale.querySelectorAll('.fb-num').forEach(b => {
        b.classList.toggle('sel', b === btn);
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      send.disabled = !(picked.rating && picked.recommend);
    }));
  });
  send.addEventListener('click', async () => {
    send.disabled = true;
    status.textContent = 'Sending…';
    const ok = await postFeedback({
      rating: picked.rating, recommend: picked.recommend,
      solved: r.solved, tries: r.tries, timeMs: r.timeMs,
      family: q.family, difficulty: q.difficulty,
    });
    if (ok) {
      box.classList.add('sent');
      box.querySelectorAll('.fb-num').forEach(b => { b.disabled = true; });
      send.hidden = true;
      status.textContent = 'Thanks — that really helps!';
    } else {
      send.disabled = false;
      status.textContent = 'Couldn’t send that — please try again.';
    }
  });
}

function showDemoResult(r, q) {
  const container = document.getElementById('results-body');
  container.innerHTML = `
    <h2>${r.solved ? (r.tries === 1 ? 'Solved first try!' : 'Solved!') : 'Not this time'}</h2>
    <div class="big">${r.solved ? '✓' : '✕'}</div>
    <div class="big-label">${r.solved ? 'You spotted the rule' : 'The rule got away'}</div>

    <div class="results-grid results-grid-2">
      <div class="result-stat"><div class="val">${r.solved ? `${r.tries} of ${MAX_TRIES}` : `${MAX_TRIES} of ${MAX_TRIES}`}</div><div class="lbl">Tries used</div></div>
      <div class="result-stat"><div class="val">${(r.timeMs / 1000).toFixed(1)}s</div><div class="lbl">Time</div></div>
    </div>
    ${q.rule ? `<div class="rule-note demo-rule"><b>The rule:</b> ${esc(q.rule)}</div>` : ''}

    <div class="demo-feedback" id="demo-feedback">
      <div class="fb-q">How would you rate the game?</div>
      <div class="fb-scale" data-fb="rating" role="group" aria-label="Rate the game from 1 to 5">${fbButtons()}</div>
      <div class="fb-ends"><span>Not for me</span><span>Loved it</span></div>
      <div class="fb-q">Would you recommend it to your friends?</div>
      <div class="fb-scale" data-fb="recommend" role="group" aria-label="Would you recommend it, from 1 to 5">${fbButtons()}</div>
      <div class="fb-ends"><span>No way</span><span>Definitely</span></div>
      <button class="fb-send" id="btn-fb-send" disabled>Send feedback</button>
      <div class="fb-status" id="fb-status" aria-live="polite"></div>
    </div>

    <div class="results-cta">
      <button class="share-big" id="btn-demo-again">Play Again</button>
      <button class="leaderboard-big" id="btn-demo-daily">Play today's 5 puzzles</button>
    </div>
    <div class="results-actions">
      <button class="back-link" id="btn-results-menu2">Main Menu</button>
    </div>`;
  showScreen('results');
  wireDemoFeedback(r, q);
  document.getElementById('btn-demo-again').addEventListener('click', startDemo);
  document.getElementById('btn-demo-daily').addEventListener('click', goDaily);
  document.getElementById('btn-results-menu2').addEventListener('click', () => { renderMenu(); showScreen('menu'); });
}

function totalLength() { return game.questions ? game.questions.length : PRACTICE_LENGTH; }

function currentQuestion() {
  if (game.questions) return game.questions[game.idx];
  if (!game.currentQ) {
    game.currentQ = generateProblem(rngHelpers(makeRng(null)), practiceDifficulty);
  }
  return game.currentQ;
}

function loadQuestion() {
  game.answered = false;
  game.tries = 0;
  game.currentQ = null;
  const q = currentQuestion();
  const n = totalLength();

  ui.problemNum.textContent = game.mode === 'demo' ? 'Try it' : `${game.idx + 1}/${n}`;
  setScenes(n === 5); // cloud/sky scenes follow your level on full 5-puzzle rounds
  ui.progress.style.width = (game.idx / n * 100) + '%';
  ui.msg.textContent = '';
  ui.msg.className = 'msg';
  ui.rule.hidden = true;
  ui.next.hidden = true;
  ui.builder.style.minHeight = '';

  const fam = q.family || (q.type === 'matrix' ? 'matrix' : 'shapes');
  ui.panel.dataset.family = fam; // drives per-family styling
  const isMC = !!q.choice;        // shape/colour/pattern puzzles → pick from 5

  // Numbered frames read left-to-right; the answer continues as frame 5.
  const frameStack = (frames, size) => `
    <div class="frame-stack">
      ${frames.map((p, i) => `<div class="tile frame-tile">${renderPanel(p, size)}<span class="frame-chip">${i + 1}</span></div>`).join('')}
    </div>`;
  // The answer cell: a plain "?" stage for pick-one puzzles (filled on choice)
  // or the interactive slot for direct-input puzzles.
  const ANSWER_STAGE = `
    <div class="answer-stage">
      <div class="answer-wrap">
        <div class="tile question answer-big" id="answer-slot"><span class="slot-ph">?</span></div>
        <span class="frame-chip chip-answer">5</span>
      </div>
    </div>`;
  const SLOT_WEEK = `<div class="week-row question-week"><span class="week-num">Wk 5</span><div id="answer-slot" class="week-slot"></div></div>`;

  if (fam === 'matrix') {
    ui.sequence.className = 'matrix';
    ui.sequence.innerHTML = q.frames
      .map(p => `<div class="tile">${renderPanel(p, 120)}</div>`)
      .join('') + `<div class="tile question" id="answer-slot"><span class="slot-ph">?</span></div>`;
  } else if (fam === 'combine') {
    // Each row shown as A + B = C, with the two source cells highlighted.
    ui.sequence.className = 'combine-grid';
    const cell = (p, cls) => `<div class="tile combine-cell${cls ? ' ' + cls : ''}">${renderPanel(p, 92)}</div>`;
    let h = '';
    for (let r = 0; r < 3; r++) {
      const last = r === 2;
      h += `<div class="combine-row">`
        + cell(q.frames[r * 3], 'src') + `<span class="combine-op">+</span>`
        + cell(q.frames[r * 3 + 1], 'src') + `<span class="combine-op">=</span>`
        + (last ? `<div class="tile question combine-cell" id="answer-slot"><span class="slot-ph">?</span></div>`
                : cell(q.frames[r * 3 + 2]))
        + `</div>`;
    }
    ui.sequence.innerHTML = h;
  } else if (fam === 'matrixsum') {
    // 3x3 number board; the blank's row + column (and their totals) highlight.
    ui.sequence.className = 'sumgrid-wrap';
    let h = '<div class="sumgrid">';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const blank = r === q.blank.r && c === q.blank.c;
        const hl = (r === q.blank.r || c === q.blank.c) ? ' sum-hl' : '';
        h += blank
          ? `<div class="sum-cell sum-blank${hl}" id="answer-slot"><span class="slot-ph">?</span></div>`
          : `<div class="sum-cell${hl}">${q.grid[r][c]}</div>`;
      }
      h += `<div class="sum-tot${r === q.blank.r ? ' sum-hl' : ''}">${q.rowSums[r]}</div>`;
    }
    for (let c = 0; c < 3; c++) h += `<div class="sum-tot${c === q.blank.c ? ' sum-hl' : ''}">${q.colSums[c]}</div>`;
    h += `<div class="sum-corner"></div></div>`;
    ui.sequence.innerHTML = h;
  } else if (fam === 'weeks') {
    ui.sequence.className = 'weeks';
    ui.sequence.innerHTML = q.frames
      .map((p, i) => `<div class="week-row"><span class="week-num">Wk ${i + 1}</span>${renderPanel(p, 330)}</div>`)
      .join('') + SLOT_WEEK;
  } else if (fam === 'schedule') {
    ui.sequence.className = 'schedule';
    ui.sequence.innerHTML = `<div class="week-row">${renderPanel(q.frames[0], 330)}</div>`
      + `<div class="week-row question-week"><span class="week-num">You</span><div id="answer-slot" class="week-slot"></div></div>`;
  } else if (fam === 'month') {
    ui.sequence.className = 'month-layout';
    ui.sequence.innerHTML = `<div id="answer-slot" class="month-slot"></div>`;
  } else if (fam === 'bars') {
    ui.sequence.className = 'bars-layout';
    ui.sequence.innerHTML = `<div id="answer-slot" class="bars-slot"></div>`;
  } else if (fam === 'place') {
    // One board to fill in — no numbered frames.
    ui.sequence.className = 'sequence place-layout';
    ui.sequence.innerHTML = `<div class="answer-stage"><div class="tile question answer-big" id="answer-slot"></div></div>`;
  } else if (fam === 'word') {
    ui.sequence.className = 'word-layout';
    ui.sequence.innerHTML = `<div class="word-prompt">${esc(q.prompt || '')}</div>` + ANSWER_STAGE;
  } else {
    ui.sequence.className = 'sequence';
    ui.sequence.innerHTML = frameStack(q.frames, 132) + ANSWER_STAGE;
  }

  // One-line how-to only where a puzzle needs its rules shown; the visual
  // puzzles carry none (the frames + "?" + → say it all).
  const instr = document.getElementById('instruction');
  instr.hidden = !q.instruction;
  // Big headline, then any numbered requirements (①②③) one per line.
  const [head, ...items] = (q.instruction || '').split(/\s*(?=[①②③])/);
  instr.innerHTML = `<div class="instr-head">${esc(head)}</div>`
    + items.map(t => `<div class="instr-item">${esc(t)}</div>`).join('');

  if (isMC) {
    renderChoices(q);
  } else {
    ui.builder.innerHTML = '';
    renderBuilder(document.getElementById('answer-slot'), ui.builder, q.answerSpec,
      built => handleSubmit(built));
  }

  startTimer();
}

/* Timer pauses while the tab is hidden so solve times stay honest. */
/* The clock on screen is the RUNNING TOTAL for the whole round: every
   finished puzzle's time plus the one in progress. It pauses between puzzles
   (while you read the result) and picks up when the next one loads. Under a
   minute it reads "42.37s"; from a minute on, "01:05.42". Scoring still uses
   each puzzle's own time. */
function formatClock(ms) {
  const cs = Math.floor(ms / 10);                 // centiseconds
  const totalSec = Math.floor(cs / 100);
  const frac = String(cs % 100).padStart(2, '0');
  if (totalSec < 60) return `${totalSec}.${frac}s`;
  const m = Math.floor(totalSec / 60), sec = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${frac}`;
}
const finishedMs = () => (game ? game.results.reduce((s, r) => s + r.timeMs, 0) : 0);
function paintClock() { ui.timer.textContent = formatClock(finishedMs() + currentElapsed()); }

function startTimer() {
  game.elapsedMs = 0;
  game.startTs = performance.now();
  if (game.timerId) clearInterval(game.timerId);
  paintClock();
  game.timerId = setInterval(paintClock, 47);
}
function currentElapsed() {
  return game.elapsedMs + (game.startTs ? performance.now() - game.startTs : 0);
}
function stopTimer() {
  if (game.timerId) clearInterval(game.timerId);
  game.timerId = null;
  const total = currentElapsed();
  game.startTs = 0;
  return total;
}

document.addEventListener('visibilitychange', () => {
  if (!game || !game.timerId) return;
  if (document.hidden) {
    game.elapsedMs = currentElapsed();
    game.startTs = 0;
  } else if (!game.answered) {
    game.startTs = performance.now();
  }
});

/* Up to MAX_TRIES per puzzle. You compete on solved count, then total
   attempts, then total time. A wrong submit (with tries left) keeps the
   builder editable and the timer running — a mistake costs an attempt, not
   the puzzle. */
export const MAX_TRIES = 3;

const totalAttempts = results => results.reduce((s, r) => s + r.tries, 0);
const totalSolved = results => results.filter(r => r.solved).length;

/* A wrong try with tries left: nudge and let them keep going. Returns true if
   the question is now resolved (solved or out of tries). */
function registerTry(correct) {
  game.tries++;
  if (!correct && game.tries < MAX_TRIES) {
    const left = MAX_TRIES - game.tries;
    ui.msg.textContent = `Not quite — ${left} ${left === 1 ? 'try' : 'tries'} left.`;
    ui.msg.className = 'msg wrong';
    shake(ui.panel);
    playSound('wrong');
    levelSlip();
    return false;
  }
  game.answered = true;
  if (correct) {
    game.heat = (game.heat || 0) + (game.tries === 1 ? 2 : 1); // first-try solves heat faster
    playSound('correct');
  } else {
    game.heat = 0;
    shake(ui.panel);
    playSound('wrong');
  }
  setStreakHeat(game.heat);
  stepLevel(correct ? 1 : -1); // climb on a solve, sink on a miss
  return true;
}

/* Shared tail once a question resolves: score it, reveal the rule, advance. */
function afterResolve(correct) {
  const elapsed = stopTimer();
  game.results.push({ solved: correct, tries: game.tries, timeMs: Math.round(elapsed) });
  ui.timer.textContent = formatClock(finishedMs()); // the clock holds at the round total
  const q = currentQuestion();

  ui.msg.textContent = correct
    ? `Correct${game.tries > 1 ? ` on try ${game.tries}` : ''} · ${(elapsed / 1000).toFixed(1)}s`
    : 'Out of tries';
  ui.msg.className = 'msg ' + (correct ? 'correct' : 'wrong');
  if (q.rule) { ui.rule.innerHTML = `<b>Rule:</b> ${esc(q.rule)}`; ui.rule.hidden = false; }
  ui.progress.style.width = ((game.idx + 1) / totalLength() * 100) + '%';
  if (game.mode === 'daily') saveDailyProgress(game.results);

  const last = game.idx + 1 >= totalLength();
  ui.next.textContent = last ? 'See results →' : 'Next →';
  ui.next.setAttribute('aria-label', last ? 'See results' : 'Next puzzle');
  ui.next.hidden = false;
  ui.next.focus({ preventScroll: true });
  // If the window is too short to show it, bring Next into view (in the page, no pop-up).
  setTimeout(() => {
    const r = ui.next.getBoundingClientRect();
    if (r.bottom > window.innerHeight || r.top < 0) {
      ui.next.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }, 50);
}

/* Direct-input puzzles (dots, number, calendar, schedule, bars). */
function handleSubmit(built) {
  if (!game || game.answered) return;
  const q = currentQuestion();
  const correct = panelEq(built, q.next);
  if (!registerTry(correct)) return;

  // Freeze the slot green/red; show the correct answer when they missed it.
  const slot = document.getElementById('answer-slot');
  if (slot) slot.classList.add('resolved', correct ? 'correct' : 'wrong');
  // Hold the tray's height so the centered puzzle doesn't hop when Submit goes away.
  ui.builder.style.minHeight = ui.builder.offsetHeight + 'px';
  // Calendar, week and bar puzzles mark the right answer on the puzzle itself
  // (no second full-size copy below, which would push Next off the screen).
  if (!correct && slot && markAnswerInSlot(slot, q.next)) {
    ui.builder.innerHTML = `<div class="reveal-label reveal-inline">Right answer shown in green</div>`;
  } else {
    ui.builder.innerHTML = correct ? '' : `
      <div class="reveal">
        <div class="reveal-item">
          <div class="reveal-label">Answer</div>
          <div class="tile correct">${renderPanel(q.next, 120)}</div>
        </div>
      </div>`;
  }
  afterResolve(correct);
}

/* Highlight the correct answer inside a resolved calendar / week / bar slot.
   Returns false for puzzle kinds it doesn't handle. */
function markAnswerInSlot(slot, next) {
  if (next.month) {
    const marks = new Set(next.month.marks || []);
    slot.querySelectorAll('[data-mday]').forEach(b => b.classList.toggle('m-answer', marks.has(+b.dataset.mday)));
    return true;
  }
  if (next.week) {
    slot.querySelectorAll('[data-day]').forEach(b => b.classList.toggle('d-answer', next.week.days[+b.dataset.day] === 'mark'));
    return true;
  }
  if (next.cells && slot.querySelector('[data-cell]')) {
    slot.querySelectorAll('[data-cell]').forEach(b => {
      const t = next.cells[+b.dataset.cell];
      b.classList.toggle('c-answer', !!t && t.kind !== 'star');
    });
    return true;
  }
  if (next.bars) {
    slot.querySelectorAll('.bar-track').forEach((t, i) => {
      const cap = parseFloat(t.dataset.max || '0') || null;
      const pct = cap ? next.bars[i] / cap * 100 : null;
      const mark = document.createElement('div');
      mark.className = 'bar-answer';
      if (pct != null) mark.style.bottom = pct + '%';
      mark.innerHTML = `<span>${next.bars[i]}</span>`;
      t.appendChild(mark);
    });
    return true;
  }
  return false;
}

/* Pick-from-5 puzzles (shapes, nesting, pattern, matrix distribution). */
function renderChoices(q) {
  const opts = q.choice.options;
  ui.builder.innerHTML = `<div class="choices">${opts.map((p, i) =>
    `<button type="button" class="choice-opt" data-i="${i}" aria-label="Option ${i + 1}">${renderPanel(p, 108)}</button>`).join('')}</div>`;
  const els = [...ui.builder.querySelectorAll('.choice-opt')];
  els.forEach(btn => btn.addEventListener('click', () => {
    if (game.answered || btn.disabled) return;
    const i = parseInt(btn.dataset.i, 10);
    const slot = document.getElementById('answer-slot'); // echo the pick into the "?" cell
    if (slot) slot.innerHTML = renderPanel(opts[i], 160);
    handleChoice(i, q, els);
  }));
}

function handleChoice(idx, q, els) {
  if (!game || game.answered) return;
  const correct = idx === q.choice.answerIndex;
  if (!registerTry(correct)) {
    els[idx].classList.add('opt-wrong');
    els[idx].disabled = true; // a wrong pick is spent; choose again
    return;
  }
  els.forEach(e => { e.disabled = true; });
  els[q.choice.answerIndex].classList.add('opt-correct');
  if (!correct) els[idx].classList.add('opt-wrong');
  const slot = document.getElementById('answer-slot');
  if (slot) slot.classList.add('resolved', correct ? 'correct' : 'wrong');
  afterResolve(correct);
}

function nextOrFinish() {
  if (!game) return;
  if (game.idx + 1 >= totalLength()) { finishRound(); return; }
  game.idx++;
  loadQuestion();
}

function finishRound() {
  if (game.mode === 'demo') {
    const r = game.results[0], q = game.questions[0];
    game = null;
    setStreakHeat(0);
    playSound('round');
    showDemoResult(r, q);
    return;
  }
  const results = game.results;
  const totalMs = results.reduce((s, r) => s + r.timeMs, 0);
  const solved = totalSolved(results);
  const attempts = totalAttempts(results);
  playSound('round');
  setStreakHeat(0);
  // The background stays as it was on the last puzzle for the results screen;
  // it clears when the player goes back to the menu (see 'nextup:screen').

  if (game.mode === 'daily') {
    const entry = {
      score: solved,
      total: DAILY_LENGTH,
      attempts,
      timeMs: totalMs,
      grid: results.map(r => (r.solved ? 'g' : 'r')),
      triesGrid: results.map(r => (r.solved ? r.tries : 'x')),
      times: results.map(r => r.timeMs),
      number: dailyNumber(),
      date: new Date().toISOString(),
    };
    saveDailyResult(todayKey(), entry);
    clearDailyProgress();
    postScore({ difficulty: 'daily', avgMs: totalMs / DAILY_LENGTH, accuracy: solved / DAILY_LENGTH,
      attempts, dayKey: todayKey(), triesGrid: entry.triesGrid.join(','),
      local: { kind: 'daily', key: todayKey() } });
    game = null;
    renderMenu();
    showDailyResults(entry);
    if (!currentUser) openJoinBoard(entry); // signed-out finishers are invited onto the board
  } else {
    // Practice is personal training: saved locally, never posted to leaderboards.
    const entry = {
      sub: currentUser ? currentUser.sub : null,
      mode: 'practice',
      date: new Date().toISOString(),
      difficulty: practiceDifficulty,
      avg: totalMs / 1000 / results.length,
      totalTime: totalMs / 1000,
      correct: solved,
      total: results.length,
      attempts,
      problems: results.map(r => ({ time: r.timeMs / 1000, correct: r.solved, tries: r.tries })),
    };
    saveHistoryEntry(entry);
    game = null;
    renderPracticeResults(entry);
    showScreen('results');
  }
}

/* ---------- Results screens ---------- */

/* Legacy daily entries (pre-points) lack triesGrid — derive one from the old
   green/red grid so results and share still render. */
function triesGridOf(entry) {
  if (entry.triesGrid) return entry.triesGrid;
  return (entry.grid || []).map(g => (g === 'g' ? 1 : 'x'));
}

const TRY_BADGE = { 1: '1️⃣', 2: '2️⃣', 3: '3️⃣', x: '❌' };

function triesHtml(triesGrid) {
  return triesGrid.map(t => TRY_BADGE[t] || '❌').join('');
}

/* Ease-out count-up for the headline score (≈800ms); instant under
   reduced motion. Suffix (e.g. "/15") stays static. */
function countUp(el, target, suffix) {
  if (!el) return;
  if (reducedMotion()) { el.textContent = `${target}${suffix}`; return; }
  const dur = 800;
  const t0 = performance.now();
  const tick = now => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = `${Math.round(target * eased)}${suffix}`;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* Attempts for legacy entries that predate the field: solved = 1 try, missed = 3. */
function attemptsOf(entry) {
  if (entry.attempts != null) return entry.attempts;
  return triesGridOf(entry).reduce((s, t) => s + (t === 'x' ? MAX_TRIES : t), 0);
}

function showDailyResults(entry) {
  const streaks = computeStreaks(todayKey());
  const attempts = attemptsOf(entry);
  const perfect = entry.score === entry.total && attempts === entry.total;
  const container = document.getElementById('results-body');
  // Score on the left, today's leaderboard on the right (stacked on phones,
  // where the board sits just below Share).
  container.innerHTML = `
    <div class="results-split">
      <div class="results-left">
        <h2>${perfect ? 'Perfect!' : entry.score >= 3 ? 'Nice work!' : 'Round Complete'}</h2>
        <div class="big" id="results-big">${entry.score}/${entry.total}</div>
        <div class="big-label">Daily #${entry.number}</div>
        <div class="share-grid" aria-label="result grid: try each puzzle was solved on">${triesHtml(triesGridOf(entry))}</div>

        <div class="results-grid">
          <div class="result-stat"><div class="val">${attempts}</div><div class="lbl">Attempts</div></div>
          <div class="result-stat"><div class="val">${formatClock(entry.timeMs)}</div><div class="lbl">Time</div></div>
          <div class="result-stat"><div class="val">🔥 ${streaks.current}</div><div class="lbl">Streak</div></div>
        </div>

        <div class="results-cta">
          <button class="share-big" id="btn-share">Share your result</button>
        </div>
        <div class="countdown-note">Next puzzle in <b id="countdown">--:--:--</b></div>
        <div class="results-actions">
          <button class="back-link" id="btn-results-stats">My Stats</button>
          <button class="back-link" id="btn-results-menu2">Main Menu</button>
        </div>
      </div>

      <div class="results-right">
        <h3>🏆 Today's leaderboard</h3>
        <button class="leaderboard-big" id="btn-results-join" hidden>Get on the leaderboard</button>
        <div id="results-board"></div>
        <button class="back-link" id="btn-results-leaderboard">Full leaderboard</button>
      </div>
    </div>`;
  showScreen('results');
  countUp(document.getElementById('results-big'), entry.score, `/${entry.total}`);

  document.getElementById('btn-share').addEventListener('click', () => shareDaily(entry, streaks.current));
  document.getElementById('btn-results-leaderboard').addEventListener('click', () => { stopCountdown(); openLeaderboard(); });
  document.getElementById('btn-results-stats').addEventListener('click', openStats);
  document.getElementById('btn-results-menu2').addEventListener('click', () => { renderMenu(); showScreen('menu'); });
  document.getElementById('btn-results-join').addEventListener('click', () => openJoinBoard(entry));
  refreshResultsBoard();

  startCountdown();
}

/* (Re)load the board on the results screen and show the "Get on the
   leaderboard" button only to players who aren't on it yet. */
function refreshResultsBoard() {
  const board = document.getElementById('results-board');
  if (!board) return;
  const saved = getDailyResult(todayKey());
  const join = document.getElementById('btn-results-join');
  if (join) join.hidden = !!currentUser || !!(saved && saved.posted);
  renderTodayBoard(board, 15);
}

/* "Get on the leaderboard": sign in with Google, or just type a guest name. */
function openJoinBoard(entry) {
  const saved = getDailyResult(todayKey());
  if (currentUser || (saved && saved.posted)) return;
  openModal(`
    <h3>Get on the leaderboard</h3>
    <div class="modal-actions">
      <button class="btn-google" id="modal-join-google">${googleButtonHtml('Sign in with Google')}</button>
    </div>
    <div class="join-or">or</div>
    <form class="join-guest" id="join-guest-form">
      <input type="text" id="join-guest-name" maxlength="24" autocomplete="nickname"
        placeholder="Put in a guest name" aria-label="Guest name" value="${esc(getGuest().name || '')}">
      <button type="submit" class="primary" id="join-guest-go">Join</button>
    </form>
    <div class="join-status" id="join-status" aria-live="polite"></div>
    <div class="modal-actions">
      <button id="modal-join-skip">Not now</button>
    </div>`, 'join-box');
  document.getElementById('modal-join-google').addEventListener('click', signInWithGoogle);
  document.getElementById('modal-join-skip').addEventListener('click', closeModal);
  const form = document.getElementById('join-guest-form');
  const status = document.getElementById('join-status');
  const go = document.getElementById('join-guest-go');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    go.disabled = true;
    status.textContent = 'Saving…';
    const res = await postGuestScore({
      name: document.getElementById('join-guest-name').value,
      avgMs: entry.timeMs / entry.total,
      accuracy: entry.score / entry.total,
      attempts: attemptsOf(entry),
      dayKey: todayKey(),
      triesGrid: triesGridOf(entry).join(','),
    });
    if (!res.ok) { status.textContent = res.message; go.disabled = false; return; }
    closeModal();
    renderMenu();
    refreshResultsBoard();
  });
}

async function shareDaily(entry, streak) {
  const text = shareText({
    number: entry.number,
    triesGrid: triesGridOf(entry),
    solved: entry.score,
    total: entry.total,
    timeMs: entry.timeMs,
    streak,
    url: window.location.origin + window.location.pathname,
  });
  const btn = document.getElementById('btn-share');
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch { /* user cancelled — fall through */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Share your result'; }, 1500); }
  } catch {
    openModal(`<h3>Share your result</h3><p style="white-space:pre-line; color:var(--text);">${esc(text)}</p>
      <div class="modal-actions"><button class="primary" id="modal-ok">Close</button></div>`);
    document.getElementById('modal-ok').addEventListener('click', closeModal);
  }
}

function startCountdown() {
  stopCountdown();
  const tick = () => {
    const el = document.getElementById('countdown');
    if (!el) { stopCountdown(); return; }
    el.textContent = formatCountdown(msUntilTomorrow());
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}
function stopCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

function renderPracticeResults(entry) {
  const container = document.getElementById('results-body');
  const attempts = entry.attempts
    ?? entry.problems.reduce((s, p) => s + (p.tries || (p.correct ? 1 : MAX_TRIES)), 0);
  const rows = entry.problems.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><span class="badge ${p.correct ? 'correct' : 'wrong'}">${p.correct ? `Solved${p.tries ? ` (try ${p.tries})` : ''}` : 'Missed'}</span></td>
      <td class="right">${p.time.toFixed(2)}s</td>
    </tr>`).join('');
  container.innerHTML = `
    <h2>Round Complete</h2>
    <div class="big" id="results-big">${entry.correct}/${entry.total}</div>
    <div class="big-label">Solved</div>

    <div class="results-grid">
      <div class="result-stat"><div class="val">${attempts}</div><div class="lbl">Attempts</div></div>
      <div class="result-stat"><div class="val">${entry.avg.toFixed(2)}s</div><div class="lbl">Avg / Puzzle</div></div>
      <div class="result-stat"><div class="val">${esc(entry.difficulty[0].toUpperCase() + entry.difficulty.slice(1))}</div><div class="lbl">Difficulty</div></div>
    </div>

    <div class="per-problem">
      <table>
        <thead><tr><th>#</th><th>Result</th><th class="right">Time</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="results-actions">
      <button class="next" id="btn-again">Play Again</button>
      <button class="back-link" id="btn-results-history">View History</button>
      <button class="back-link" id="btn-results-menu2">Main Menu</button>
    </div>`;
  countUp(document.getElementById('results-big'), entry.correct, `/${entry.total}`);
  document.getElementById('btn-again').addEventListener('click', startPractice);
  document.getElementById('btn-results-history').addEventListener('click', openHistory);
  document.getElementById('btn-results-menu2').addEventListener('click', () => { renderMenu(); showScreen('menu'); });
}

/* ---------- Stats ---------- */

function openStats() {
  stopCountdown();
  document.getElementById('stats-signin-note').style.display = currentUser ? 'none' : '';
  const streaks = computeStreaks(todayKey());
  const daily = loadDaily().results;
  const days = Object.values(daily);
  const played = days.length;
  const perfect = days.filter(d => d.score === d.total).length;
  const avgScore = played ? (days.reduce((s, d) => s + d.score, 0) / played) : 0;

  const practice = loadHistory();
  const pRounds = practice.length;
  const pBest = pRounds ? Math.min(...practice.map(e => e.avg)) : null;

  const dist = [0, 0, 0, 0, 0, 0];
  days.forEach(d => { dist[Math.min(5, d.score)]++; });
  const maxDist = Math.max(1, ...dist);
  const distRows = dist.map((n, score) => `
    <div class="dist-row">
      <div class="k">${score}/5</div>
      <div class="bar-wrap"><div class="bar" style="width:${Math.max(8, Math.round(n / maxDist * 100))}%">${n || ''}</div></div>
    </div>`).join('');

  const cards = [
    [played, 'Dailies Played'],
    [`🔥 ${streaks.current}`, 'Current Streak'],
    [streaks.max, 'Best Streak'],
    [played ? avgScore.toFixed(1) : '—', 'Avg Score'],
    [perfect, 'Perfect Days'],
    [pRounds, 'Practice Rounds'],
    [pBest != null ? pBest.toFixed(2) + 's' : '—', 'Best Practice Avg'],
  ].map(([val, lbl]) => `<div class="result-stat"><div class="val">${val}</div><div class="lbl">${lbl}</div></div>`).join('');

  document.getElementById('stats-content').innerHTML = `
    <div class="stats-cards">${cards}</div>
    <div class="dist">
      <h3>Daily score distribution</h3>
      ${distRows}
    </div>`;
  showScreen('stats');
}

/* ---------- History (device-local; works for guests too) ---------- */

function openHistory() {
  stopCountdown();
  const h = loadHistory();
  const container = document.getElementById('history-content');
  if (!h.length) {
    container.innerHTML = `<div class="history-empty">No practice rounds yet. Play one to see your results here.</div>`;
  } else {
    const rows = h.map(e => {
      const date = new Date(e.date);
      const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const diff = esc(e.difficulty[0].toUpperCase() + e.difficulty.slice(1));
      return `
        <div class="history-row">
          <div>
            <div style="font-weight:500;">${dateStr}</div>
            <div style="color:var(--muted); font-size:12px; margin-top:2px;">${diff}</div>
          </div>
          <div class="num col-problems">${e.correct}/${e.total} correct</div>
          <div class="num">${e.totalTime.toFixed(1)}s total</div>
          <div class="avg">${e.avg.toFixed(2)}s avg</div>
        </div>`;
    }).join('');
    container.innerHTML = `
      <div class="history-list">
        <div class="history-row head">
          <div>When</div>
          <div class="col-problems">Score</div>
          <div>Total</div>
          <div>Avg Time</div>
        </div>
        ${rows}
      </div>`;
  }
  showScreen('history');
}

/* ---------- How to play ---------- */

function howToPlay() {
  setFlag('howto-seen');
  // The practice puzzle lives INSIDE the popup, so nobody mistakes it for the
  // real game: no timer, no score, as many taps as they like.
  const q = generateTrial(rngHelpers(makeRng('nextup-warmup')));
  const tile = (p, cls = '') => `<div class="tile${cls}">${renderPanel(p, 72)}</div>`;
  openModal(`
    <h3>How to play</h3>
    <p class="howto-lead">Every puzzle is a pattern. Work out <b>what comes next</b>.</p>
    <div class="howto-practice">
      <div class="howto-tag">Practice — this one doesn't count</div>
      <div class="howto-example">
        ${q.frames.map(p => tile(p)).join('')}
        <div class="tile question howto-q" id="howto-slot">?</div>
      </div>
      <div class="howto-prompt" id="howto-prompt">Tap the one that comes next:</div>
      <div class="howto-choices">
        ${q.choice.options.map((p, i) =>
          `<button type="button" class="howto-opt" data-i="${i}" aria-label="Option ${i + 1}">${renderPanel(p, 72)}</button>`).join('')}
      </div>
    </div>
    <ol class="howto-steps">
      <li><b>Spot the rule</b> in the numbered boxes.</li>
      <li><b>Fill in the “?”</b> — tap an answer, or build it right in the box.</li>
      <li><b>3 tries</b> per puzzle. <b>5 puzzles</b> a day, the same for everyone.</li>
    </ol>
    <div class="modal-actions">
      <button class="primary" id="modal-howto-close">Got it</button>
    </div>`, 'howto-box');
  const prompt = document.getElementById('howto-prompt');
  const opts = [...document.querySelectorAll('.howto-opt')];
  opts.forEach(btn => btn.addEventListener('click', () => {
    const i = parseInt(btn.dataset.i, 10);
    if (i !== q.choice.answerIndex) {
      btn.classList.add('opt-wrong');
      btn.disabled = true;
      prompt.textContent = 'Not quite — look at the pattern and try another.';
      prompt.className = 'howto-prompt wrong';
      return;
    }
    opts.forEach(o => { o.disabled = true; });
    btn.classList.add('opt-correct');
    const slot = document.getElementById('howto-slot');
    slot.innerHTML = renderPanel(q.choice.options[i], 72);
    slot.classList.add('solved');
    prompt.textContent = 'That’s it! The fill flips every time. The real puzzles work the same way.';
    prompt.className = 'howto-prompt correct';
  }));
  document.getElementById('modal-howto-close').addEventListener('click', closeModal);
}

/* ---------- Menu ---------- */

function renderMenu() {
  const n = dailyNumber();
  const played = getDailyResult(todayKey());
  const progress = loadDailyProgress();
  const note = document.getElementById('go-note');
  if (played) {
    note.innerHTML = `Done ${triesHtml(triesGridOf(played))} · see results`;
  } else if (progress) {
    note.textContent = `Resume · puzzle ${progress.results.length + 1} of ${DAILY_LENGTH}`;
  } else {
    note.textContent = `Daily #${n}`;
  }

  const streaks = computeStreaks(todayKey());
  const chip = document.getElementById('streak-chip');
  if (streaks.current > 0) {
    chip.hidden = false;
    chip.innerHTML = `🔥 <b>${streaks.current}</b>&nbsp;day streak`;
  } else {
    chip.hidden = true;
  }
}

/* ---------- Wiring ---------- */

registerScreens(['invite', 'daily-intro', 'menu', 'round', 'results', 'history', 'leaderboard', 'stats']);

/* The round's final background carries onto the results screen and is put
   away once the player returns to a home screen. */
document.addEventListener('nextup:screen', e => {
  if (e.detail === 'menu' || e.detail === 'daily-intro') hideLevels();
});

/* Daily intro: the pre-round screen with the START button. The timer (and the
   round itself) only begins when START is pressed. */
function showDailyIntro() {
  const n = dailyNumber();
  const progress = loadDailyProgress();
  document.getElementById('intro-title').textContent = `Daily #${n}`;
  document.getElementById('intro-sub').textContent = progress
    ? `Resume · puzzle ${progress.results.length + 1} of ${DAILY_LENGTH}` : '';
  showScreen('daily-intro');
}

/* GO: finished today → results; otherwise the intro (START begins the clock). */
function goDaily() {
  primeAudio();
  if (getDailyResult(todayKey())) { startDaily(); return; } // shows results
  showDailyIntro();
}

document.getElementById('btn-start-daily').addEventListener('click', () => {
  primeAudio();
  startDaily();
});
document.getElementById('btn-intro-leaderboard').addEventListener('click', openLeaderboard);
document.getElementById('btn-intro-menu').addEventListener('click', () => { renderMenu(); showScreen('menu'); });
document.getElementById('btn-intro-howto').addEventListener('click', howToPlay);
document.getElementById('btn-daily').addEventListener('click', goDaily);
document.getElementById('btn-practice').addEventListener('click', startPractice);
document.getElementById('btn-try').addEventListener('click', startDemo);
document.getElementById('btn-intro-try').addEventListener('click', startDemo);
document.getElementById('btn-stats').addEventListener('click', openStats);
document.getElementById('btn-history').addEventListener('click', openHistory);
document.getElementById('btn-leaderboard').addEventListener('click', openLeaderboard);
document.getElementById('btn-howto').addEventListener('click', howToPlay);

document.querySelectorAll('#diff-row button').forEach(btn => {
  btn.addEventListener('click', () => {
    practiceDifficulty = btn.dataset.diff;
    document.querySelectorAll('#diff-row button').forEach(b => b.classList.toggle('active', b === btn));
  });
});

document.getElementById('btn-quit').addEventListener('click', () => {
  if (game && game.timerId) clearInterval(game.timerId);
  game = null;
  setStreakHeat(0);
  hideLevels();
  renderMenu();
  showScreen('menu');
});

const muteBtn = document.getElementById('btn-mute');
function renderMuteBtn() { muteBtn.textContent = isMuted() ? '🔇' : '🔊'; }
muteBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  if (!isMuted()) primeAudio();
  renderMuteBtn();
});
renderMuteBtn();

ui.next.addEventListener('click', nextOrFinish);

for (const id of ['btn-history-back', 'btn-leaderboard-back', 'btn-stats-back']) {
  document.getElementById(id).addEventListener('click', () => { stopCountdown(); renderMenu(); showScreen('menu'); });
}

document.addEventListener('keydown', e => {
  if (activeScreen() !== 'round') return;
  if (e.key === 'Enter' && !ui.next.hidden) { nextOrFinish(); }
});

document.getElementById('btn-invite-google').innerHTML = googleButtonHtml('Sign in with Google to join');
document.getElementById('btn-invite-google').addEventListener('click', signInWithGoogle);
document.getElementById('btn-invite-skip').addEventListener('click', () => { renderMenu(); showScreen('menu'); });

/* ---------- Boot: guest-first, play within one tap ---------- */

capturePendingInvite();

initAuth({
  onUserChanged: () => {
    if (activeScreen() === 'invite' && currentUser) { renderMenu(); showScreen('menu'); }
  },
}).then(async user => {
  renderMenu();
  if (!user && getPendingJoin()) {
    const shown = await showInviteLanding();
    if (shown) return;
  } else if (user) {
    resolvePendingInvite();
  }
  // A "try the game" link (…/?try) drops the visitor straight into one puzzle.
  if (new URLSearchParams(window.location.search).has('try')) { startDemo(); return; }
  // Daily unfinished → land straight on the daily intro so players hop right
  // in; finished → the normal menu.
  if (!getDailyResult(todayKey())) showDailyIntro();
  else showScreen('menu');
  // Brand-new players get the instructions as a popup, once.
  if (isNewPlayer() && !getFlag('howto-seen')) howToPlay();
});
