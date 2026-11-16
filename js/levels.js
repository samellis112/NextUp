/* "Changing levels" background for a round.

   Every solved puzzle lifts you a level: the sky brightens and the specks
   behind the puzzle stream down past you (so you feel yourself rising). A
   missed puzzle sinks you a level: it dims and the specks run the other way.
   A wrong try is a small slip. No bars or meters — just the movement.

   Purely decorative: one fixed layer behind the page, built lazily, hidden
   outside rounds. Under prefers-reduced-motion only the colours change. */

import { reducedMotion } from './feel.js';

export const MAX_LEVEL = 5;

// [top, bottom] sky colours per level — dimmest at 0, brightest at 5.
const SKY_DARK = [
  ['#070c17', '#0b1424'], ['#0a1428', '#10254a'], ['#0c1b3a', '#163a75'],
  ['#0f2552', '#1f55a8'], ['#122c63', '#2a68c4'], ['#163676', '#3f86e0'],
];
const SKY_LIGHT = [
  ['#c9d1de', '#d9dfe9'], ['#d5dce7', '#e3e8f0'], ['#e0e6ef', '#edf1f7'],
  ['#eaeff6', '#f5f7fb'], ['#f3f6fb', '#fdfdff'], ['#ffffff', '#fff3d6'],
];
const STEP_PX = 320; // how far the nearest specks travel per level

let root = null;
let level = 0;
let travel = 0; // total scroll in px; grows as you climb

function ensure() {
  if (root && document.body.contains(root)) return root;
  root = document.createElement('div');
  root.className = 'lvl-bg';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="lvl-glow"></div>
    <div class="lvl-specks"></div>`;
  document.body.prepend(root);
  return root;
}

function paint() {
  const el = ensure();
  const light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const [top, bot] = (light ? SKY_LIGHT : SKY_DARK)[level];
  el.style.setProperty('--sky-top', top);
  el.style.setProperty('--sky-bot', bot);
  el.querySelector('.lvl-glow').style.opacity = String(Math.max(0, (level - 2) / 3));
  if (reducedMotion()) return;
  // Three layers at different speeds: near specks move furthest (depth).
  el.querySelector('.lvl-specks').style.backgroundPosition =
    `40px ${travel}px, 20px ${travel * 0.55}px, 80px ${60 + travel * 0.3}px`;
}

/* Lift / drop the puzzle so the content moves with the level. (The panel, not
   the whole screen: a transform on the screen would drag the fixed HUD along.) */
function react(cls) {
  const screen = document.querySelector('#screen-round .panel');
  if (!screen || reducedMotion()) return;
  screen.classList.remove('lvl-rise', 'lvl-drop');
  void screen.offsetWidth; // restart on back-to-back changes
  screen.classList.add(cls);
  screen.addEventListener('animationend', () => screen.classList.remove(cls), { once: true });
}

/* Show the background at a given level with no travel animation (round start
   or resuming a daily part-way through). */
export function showLevels(startLevel = 0) {
  level = Math.max(0, Math.min(MAX_LEVEL, startLevel));
  travel = level * STEP_PX;
  ensure().classList.add('on');
  paint();
}

/* +1 on a solved puzzle, -1 on a missed one. */
export function stepLevel(delta) {
  const next = Math.max(0, Math.min(MAX_LEVEL, level + delta));
  if (next !== level) {
    travel += (next - level) * STEP_PX;
    level = next;
    react(delta > 0 ? 'lvl-rise' : 'lvl-drop');
  } else if (delta < 0) {
    travel -= 60; // already at the bottom: still feel the slip
  }
  paint();
}

/* A wrong try with tries left: a small slip backwards. */
export function levelSlip() {
  travel -= 40;
  paint();
}

export function hideLevels() {
  if (root) root.classList.remove('on');
  level = 0;
  travel = 0;
}

/* Where a part-finished round stands, replayed from its results so far. */
export function levelFromResults(results) {
  return results.reduce((lv, r) => Math.max(0, Math.min(MAX_LEVEL, lv + (r.solved ? 1 : -1))), 0);
}
