/* "Changing levels" background for a round.

   Every solved puzzle lifts you a level: the sky brightens and the specks
   behind the puzzle stream down past you (so you feel yourself rising). A
   missed puzzle sinks you a level: it dims and the specks run the other way.
   A wrong try is a small slip. No bars or meters, and the specks are hidden
   except while they move — the screen stays plain while you solve.

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

/* Scenes for the upper levels of a 5-puzzle round — a climb through the
   clouds. They override the level colours:
     below   level 2: clouds gather along the top, you're coming up under them
     clouds  level 3: you're inside them, clouds all around
     sun     level 4+: above them — bright blue, light from the corner, cloud below
   The same eight clouds slide down the screen from one scene to the next. */
const SCENES = {
  below: ['#3d74bd', '#16305f'],
  clouds: ['#2f66ad', '#86aedb'],
  sun: ['#1479e0', '#6fc0ff'],
};
let scene = null;

let root = null;
let level = 0;
let travel = 0; // total scroll in px; grows as you climb

function ensure() {
  if (root && document.body.contains(root)) return root;
  root = document.createElement('div');
  root.className = 'lvl-bg';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="lvl-specks"></div>
    <div class="lvl-sun"></div>
    <div class="lvl-clouds">${Array.from({ length: 8 }, (_, i) => `<i class="cloud c${i + 1}"></i>`).join('')}</div>
    <div class="lvl-deck back"></div>
    <div class="lvl-deck front"></div>`;
  document.body.prepend(root);
  return root;
}

/* The scene follows your LEVEL (solves minus misses), not the puzzle number:
   two solves up you reach the underside of the clouds, three you're inside
   them, four you break out above. A missed puzzle drops you a level, so anyone
   who misses even one never reaches the bright sky. */
const SCENE_AT_LEVEL = [null, null, 'below', 'clouds', 'sun', 'sun'];
let scenesOn = false;

function paint() {
  const el = ensure();
  scene = scenesOn ? SCENE_AT_LEVEL[level] : null;
  for (const name of Object.keys(SCENES)) el.classList.toggle('scene-' + name, scene === name);
  document.body.classList.toggle('sky-scene', !!scene); // keeps directions readable on the bright sky
  const light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const [top, bot] = scene ? SCENES[scene] : (light ? SKY_LIGHT : SKY_DARK)[level];
  el.style.setProperty('--sky-top', top);
  el.style.setProperty('--sky-bot', bot);
  if (reducedMotion()) return;
  // Three layers at different speeds: near specks move furthest (depth).
  el.querySelector('.lvl-specks').style.backgroundPosition =
    `40px ${travel}px, 20px ${travel * 0.55}px, 80px ${60 + travel * 0.3}px`;
}

/* The specks are only visible while they move, so the screen stays plain
   while you're thinking and comes alive for a moment when the level changes. */
let movingTimer = null;
function showMovement() {
  if (reducedMotion()) return;
  const el = ensure();
  el.classList.add('moving');
  clearTimeout(movingTimer);
  movingTimer = setTimeout(() => el.classList.remove('moving'), 1200);
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
  showMovement();
  paint();
}

/* A wrong try with tries left: a small slip backwards. */
export function levelSlip() {
  travel -= 40;
  showMovement();
  paint();
}

/* Scenes are used on full 5-puzzle rounds only. */
export function setScenes(on) {
  scenesOn = !!on;
  paint();
}

export function hideLevels() {
  if (root) root.classList.remove('on', ...Object.keys(SCENES).map(n => 'scene-' + n));
  document.body.classList.remove('sky-scene');
  scene = null;
  scenesOn = false;
  level = 0;
  travel = 0;
}

/* Where a part-finished round stands, replayed from its results so far. */
export function levelFromResults(results) {
  return results.reduce((lv, r) => Math.max(0, Math.min(MAX_LEVEL, lv + (r.solved ? 1 : -1))), 0);
}
