/* Shared building blocks for the per-puzzle components in js/puzzles/.

   Each puzzle game lives in its own file here and owns its rules (generation),
   its answer type, and — when it needs one — its custom layout. This module
   holds only the genuinely-shared primitives so a global change (a constant,
   a grid helper) stays in one place and no game duplicates another's code.

   A generator is `generate(R, level)` where R = rngHelpers(random) (seeded for
   the daily so everyone gets the same puzzles) and returns:
     { type, frames, next, rule, instruction?, answerSpec, family?, ...extra } */

import { SHAPES, COLOR_NAMES, TEXTURES, panelEq, deepClone } from '../panels.js';
export { SHAPES, COLOR_NAMES, TEXTURES, panelEq, deepClone };

export const SEQ_LEN = 4; // frames shown before the "?"

/* 3x3 helpers. */
export const BORDER8 = [0, 1, 2, 5, 8, 7, 6, 3];       // border cells, clockwise
export const FILL9 = [0, 1, 2, 5, 8, 7, 6, 3, 4];      // border first, centre last

/* Colour triples with strong luminance spread (from the 4-colour palette). */
export const COLOR_CYCLES = [
  ['blue', 'orange', 'green'],
  ['red', 'green', 'blue'],
  ['orange', 'red', 'blue'],
];

export const flip = f => (f === 'solid' ? 'outline' : 'solid');
export const uniq = arr => [...new Set(arr)];

/* Quadrant maths — clockwise TL→TR→BR→BL. */
export const cwq = (i, k) => (((i + k) % 4) + 4) % 4;
export function rotateQuadrants(quads, k) {
  const out = [null, null, null, null];
  for (let i = 0; i < 4; i++) out[cwq(i, k)] = quads[i];
  return out;
}

/* 3x3 index transforms, for randomising a traversal's orientation. */
export const rot90 = p => { const r = Math.floor(p / 3), c = p % 3; return c * 3 + (2 - r); };
export const flipH = p => { const r = Math.floor(p / 3), c = p % 3; return r * 3 + (2 - c); };
export function randomOrientation(R, order) {
  let out = order.slice();
  const turns = R.int(4);
  for (let t = 0; t < turns; t++) out = out.map(rot90);
  if (R.chance(0.5)) out = out.map(flipH);
  return out;
}

/* A few decoy shapes mixed into a palette alongside the shape(s) in play. */
export function shapePalette(R, inPlay, extra = 2) {
  const others = R.sample(SHAPES.filter(k => !inPlay.includes(k)), extra);
  return R.shuffle(uniq([...inPlay, ...others]));
}

/* Five visually-distinct fills (3 plain colours + 2 textured) for nested games. */
export function fiveFills(R) {
  const c = R.shuffle(COLOR_NAMES.slice());
  const t = R.shuffle(TEXTURES.slice());
  return [
    { color: c[0] }, { color: c[1] }, { color: c[2] },
    { color: c[3 % c.length], texture: t[0] },
    { color: c[0], texture: t[1] },
  ];
}

/* 3x3 matrix: 8 shown cells row-major + the empty bottom-right as `next`. */
export function matrixFrames(cellAt) {
  const frames = [];
  for (let i = 0; i < 8; i++) frames.push(cellAt(Math.floor(i / 3), i % 3));
  return { frames, next: cellAt(2, 2) };
}

/* Clockwise spiral order of an n×n grid (turn-when-blocked walk — robust). */
export function spiralOrder(n) {
  const grid = Array.from({ length: n }, () => Array(n).fill(false));
  const order = [];
  const dr = [0, 1, 0, -1], dc = [1, 0, -1, 0]; // right, down, left, up
  let r = 0, c = 0, d = 0;
  for (let k = 0; k < n * n; k++) {
    order.push(r * n + c);
    grid[r][c] = true;
    let nr = r + dr[d], nc = c + dc[d];
    if (!(nr >= 0 && nr < n && nc >= 0 && nc < n && !grid[nr][nc])) {
      d = (d + 1) % 4;
      nr = r + dr[d]; nc = c + dc[d];
    }
    r = nr; c = nc;
  }
  return order;
}
