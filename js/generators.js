/* Procedural question generators (construct-the-answer edition).

   The player no longer picks from multiple choices — they BUILD the answer
   panel, which game.js grades against `next` via panelEq(). So every generator
   returns:

     { type: 'sequence'|'matrix', frames, next, rule, answerSpec }

   `answerSpec` tells builder.js what to render and which constrained palettes to
   offer (so grading is fair, not a needle-in-a-haystack). Kinds:

     center        { shapes, fills, sizes? }                  one centered shape
     centerNested  { shapes, fills }                          outer + inner shape
     dots          { dotToken, grid3, cellPositions }          dot patterns
     nested        { colors, textures }                       nested-squares puzzle

   Difficulty scales by stacking simultaneous rules and lowering rule salience.
   Every generator takes (R, level) where R = rngHelpers(random) so the daily
   challenge can run on a shared seed. */

import { SHAPES, COLOR_NAMES, TEXTURES, panelEq, deepClone } from './panels.js';

const SEQ_LEN = 4; // frames shown before the "?"

/* Quadrant indices run clockwise TL→TR→BR→BL, so +1 is one clockwise step. */
const cwq = (i, k) => (((i + k) % 4) + 4) % 4;
/* 3x3 border cells in clockwise order. */
const BORDER8 = [0, 1, 2, 5, 8, 7, 6, 3];
/* Fill order for counting patterns — border first, centre last (9 slots). */
const FILL9 = [0, 1, 2, 5, 8, 7, 6, 3, 4];

/* Ordered color triples with strong luminance spread (colorblind-safe),
   drawn from the four-color palette (blue/orange/green/red). */
const COLOR_CYCLES = [
  ['blue', 'orange', 'green'],
  ['red', 'green', 'blue'],
  ['orange', 'red', 'blue'],
];

const flip = f => (f === 'solid' ? 'outline' : 'solid');
const uniq = arr => [...new Set(arr)];

function rotateQuadrants(quads, k) {
  const out = [null, null, null, null];
  for (let i = 0; i < 4; i++) out[cwq(i, k)] = quads[i];
  return out;
}

/* A few decoy shapes added to a palette alongside the shape(s) actually in play. */
function shapePalette(R, inPlay, extra = 2) {
  const others = R.sample(SHAPES.filter(k => !inPlay.includes(k)), extra);
  return R.shuffle(uniq([...inPlay, ...others]));
}

/* ============================================================
   Sequence generators
   ============================================================ */

/* ---------- Dot puzzles: randomized sub-modes so no two feel alike ----------
   Every mode emits explicit cell sets per panel; the answer is clicked
   straight into the inline 3x3 grid. */

/* 3x3 index transforms — used to randomize any traversal order's
   orientation, so the same logical rule reads differently every time. */
const rot90 = p => {
  const r = Math.floor(p / 3), c = p % 3;
  return c * 3 + (2 - r);
};
const flipH = p => {
  const r = Math.floor(p / 3), c = p % 3;
  return r * 3 + (2 - c);
};
function randomOrientation(R, order) {
  let out = order.slice();
  const turns = R.int(4);
  for (let t = 0; t < turns; t++) out = out.map(rot90);
  if (R.chance(0.5)) out = out.map(flipH);
  return out;
}

/* Dots: intuitive, satisfying patterns you click straight into the grid.
   3x3 for easy/medium; some 5x5 for the bigger, showier patterns. */
function genDots(R, level) {
  const color = level >= 3 ? R.pick(['blue', 'red', 'green']) : 'solid';
  return (level >= 3 && R.chance(0.6)) ? genDots5(R, color) : genDots3(R, color);
}

/* 3x3 — count up, follow a moving dot, or a dot circling the edge. Clear,
   fixed orientation (reads top-left → right → down), light variety. */
function genDots3(R, color) {
  const dotToken = { kind: 'circle', fill: color, scale: 0.8 };
  const READ = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const BORDER = [0, 1, 2, 5, 8, 7, 6, 3];
  const mode = R.pick(['count', 'move', 'border']);
  let cellsAt, rule;

  if (mode === 'count') {
    const step = R.pick([1, 2]);
    const start = 1 + R.int(2);
    cellsAt = i => READ.slice(0, Math.min(9, start + step * i));
    rule = `Each panel has ${step} more dot${step > 1 ? 's' : ''} than the one before.`;
  } else if (mode === 'move') {
    const start = R.int(4);
    cellsAt = i => [Math.min(8, start + i)];
    rule = 'One dot moves forward one space each panel (left to right, top to bottom).';
  } else {
    const dir = R.chance(0.5) ? 1 : 7; // +1 clockwise, +7 ≡ −1 counter
    const start = R.int(8);
    cellsAt = i => [BORDER[(start + dir * i) % 8]];
    rule = `One dot steps ${dir === 1 ? 'clockwise' : 'counter-clockwise'} around the edge each panel.`;
  }

  const panelAt = i => {
    const cells = Array(9).fill(null);
    for (const p of cellsAt(i)) cells[p] = { ...dotToken };
    return { grid3: true, cols: 3, cells };
  };
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN), rule,
    answerSpec: { kind: 'dots', dotToken, grid3: true, cols: 3, cellPositions: READ.slice() },
  };
}

/* 5x5 — bigger, showier growth: a diamond opening out, a cross reaching the
   edges, or a diagonal line sweeping across. */
function genDots5(R, color) {
  const dotToken = { kind: 'circle', fill: color, scale: 0.8 };
  const idx = (r, c) => r * 5 + c;
  const mode = R.pick(['diamond', 'cross', 'sweep']);
  let cellsAt, rule;

  if (mode === 'diamond') {
    cellsAt = i => {
      const out = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (Math.abs(r - 2) + Math.abs(c - 2) <= i) out.push(idx(r, c));
      return out;
    };
    rule = 'A diamond opens one step outward from the centre each panel.';
  } else if (mode === 'cross') {
    cellsAt = i => {
      const out = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if ((r === 2 && Math.abs(c - 2) <= i) || (c === 2 && Math.abs(r - 2) <= i)) out.push(idx(r, c));
      return out;
    };
    rule = 'The cross reaches one cell further along each arm every panel.';
  } else {
    const dir = R.chance(0.5) ? 1 : -1;
    const startK = dir === 1 ? 0 : 8;
    cellsAt = i => {
      const k = startK + dir * i;
      const out = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (r + c === k) out.push(idx(r, c));
      return out;
    };
    rule = `A diagonal line sweeps across, moving one step ${dir === 1 ? 'down-right' : 'up-left'} each panel.`;
  }

  const panelAt = i => {
    const cells = Array(25).fill(null);
    for (const p of cellsAt(i)) cells[p] = { ...dotToken };
    return { grid5: true, cols: 5, cells };
  };
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN), rule,
    answerSpec: { kind: 'dots', dotToken, grid5: true, cols: 5, cellPositions: [...Array(25).keys()] },
  };
}

/* Fill cycles through three colors; harder levels alternate the shape too.
   (Size rules were removed — relative size is unjudgeable in a blank slot.) */
function genColorCycle(R, level) {
  const cycle = R.pick(COLOR_CYCLES);
  const kinds = level >= 3 ? R.sample(SHAPES, 2) : [R.pick(SHAPES)];
  const phase = R.int(3);
  const panelAt = i => ({
    center: {
      kind: kinds[i % kinds.length],
      fill: cycle[(phase + i) % 3],
    },
  });
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: `The color repeats every three panels (${cycle.join(' → ')})`
      + (kinds.length > 1 ? ', while the shape alternates' : '') + '.',
    answerSpec: { kind: 'center', shapes: shapePalette(R, kinds), fills: cycle.slice() },
  };
}

/* Polygon morphs through the side-count ladder. */
function genPolygonMorph(R, level) {
  const ladder = ['triangle', 'square', 'pentagon', 'hexagon'];
  const startIdx = R.int(2);
  const dir = R.chance(0.5) ? 1 : -1;
  const panelAt = i => {
    const idx = (((startIdx + dir * i) % ladder.length) + ladder.length) % ladder.length;
    return { center: { kind: ladder[idx], fill: 'solid' } };
  };
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: `The shape cycles ${dir === 1 ? 'up' : 'down'} the ladder triangle → square → pentagon → hexagon.`,
    answerSpec: { kind: 'center', shapes: ladder.slice(), fills: ['solid', 'outline'], sizes: null },
  };
}

/* Nesting conveyor: outer shape leaves, inner is promoted, a new shape enters. */
function genNesting(R, level) {
  // 5-shape cycle so the answer panel isn't an exact copy of frame 1.
  const cycle = R.shuffle(SHAPES).slice(0, 5);
  const fills = level >= 3 ? ['outline', R.pick(['blue', 'orange', 'green'])] : ['outline', 'outline'];
  const shapeAt = i => cycle[((i % cycle.length) + cycle.length) % cycle.length];
  const panelAt = i => ({
    center: {
      kind: shapeAt(i), fill: fills[0],
      inner: { kind: shapeAt(i + 1), fill: fills[1] },
    },
  });
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: 'Each panel, the outer shape leaves, the inner shape grows to take its place, and the next shape in the cycle appears inside.',
    answerSpec: { kind: 'centerNested', shapes: cycle.slice(), fills: uniq(['outline', 'solid', fills[1]]) },
  };
}

/* Layered alternation: fill flips every panel, shape every two. */
function genAlternation(R, level) {
  const kinds = R.sample(SHAPES, level >= 2 ? 2 : 1);
  const startFill = R.chance(0.5) ? 'solid' : 'outline';
  const shapePeriod = level >= 3 ? 2 : 1; // shape changes every `period` panels
  const panelAt = i => ({
    center: {
      kind: kinds.length > 1 ? kinds[Math.floor(i / shapePeriod) % 2] : kinds[0],
      fill: i % 2 === 0 ? startFill : flip(startFill),
    },
  });
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: kinds.length > 1
      ? `The fill flips every panel, while the shape changes every ${shapePeriod === 2 ? 'two panels' : 'panel'} — two cycles running at once.`
      : 'The fill alternates between solid and outline.',
    answerSpec: { kind: 'center', shapes: shapePalette(R, kinds), fills: ['solid', 'outline'], sizes: null },
  };
}

/* Five visually-distinct fills from 4 colors + 2 textures: three plain colors,
   then two textured accents (one per texture). All five read apart even though
   we only have four colors. */
function fiveFills(R) {
  const c = R.shuffle(COLOR_NAMES.slice());
  const t = R.shuffle(TEXTURES.slice());
  return [
    { color: c[0] },
    { color: c[1] },
    { color: c[2] },
    { color: c[3 % c.length], texture: t[0] },
    { color: c[0], texture: t[1] },
  ];
}

/* Nested "pattern of 5" puzzle (the owner's reference mechanic).

   One ordered pattern P of FIVE DISTINCT fills. Every section — all four outer
   plus all four inner (three for triangles, single-layer) — steps through P at
   its own phase, advancing each frame. Across the four shown frames a section
   reveals four of its five states; the ANSWER is each section's unshown fifth.
   You reconstruct the whole five-pattern by cross-referencing sections at
   different phases ("figure out half from three, the rest from two and the
   last one"). Distinct states ⇒ a unique answer, and a 5-pattern over 4 shown
   frames ⇒ the answer is never a copy of a shown frame.

   Difficulty levers: tidy vs scrambled phases, plain-colour vs colour+texture
   states, and (top tier) some sections advancing two steps at a time. */
function genNestedShape(R, level, shape) {
  const n = shape === 'triangle' ? 3 : 4;
  const single = shape === 'triangle';            // triangles stay single-layer
  const sections = single ? n : 2 * n;
  const scramble = level >= 3;
  const uneven = level >= 4;

  // Pattern of 5 distinct fills. Easy/medium: a blank + four plain colours
  // (cleanest). Hard/double: five colour+texture combos (subtler to tell apart).
  const cols = R.shuffle(COLOR_NAMES.slice());
  const P = level <= 2
    ? R.shuffle([null, ...cols.map(c => ({ color: c }))])
    : R.shuffle(fiveFills(R));

  // Per-section phase (start point in P) and step (places advanced per frame).
  // Tidy on easy (outer & inner march by position); scattered on hard; some
  // 2-steps on the top tier. Retry until all five states are visible across
  // the shown frames, so the player can always reconstruct the full pattern.
  let phases, steps;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (scramble) {
      const base = [0, 1, 2, 3, 4];
      while (base.length < sections) base.push(R.int(5));
      phases = R.shuffle(base).slice(0, sections);
    } else {
      phases = Array.from({ length: sections }, (_, i) => (i % n) % 5);
    }
    steps = phases.map((_, i) => (uneven && i % 3 === 0 ? 2 : 1));
    const shown = new Set();
    for (let i = 0; i < sections; i++)
      for (let f = 0; f < SEQ_LEN; f++) shown.add((((phases[i] + steps[i] * f) % 5) + 5) % 5);
    if (shown.size === 5) break;
  }

  const at = (i, f) => {
    const v = P[(((phases[i] + steps[i] * f) % 5) + 5) % 5];
    return v ? { ...v } : null;
  };
  const frameAt = f => ({
    nested: {
      shape,
      outer: Array(n).fill(null).map((_, j) => at(j, f)),
      inner: single ? [] : Array(n).fill(null).map((_, j) => at(n + j, f)),
    },
  });

  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(frameAt(i));
  const states = P.filter(Boolean).map(v => ({ ...v }));
  return {
    type: 'sequence', family: 'nested', frames, next: frameAt(SEQ_LEN),
    rule: 'Every section follows the same repeating pattern of five fills, each '
      + 'starting at a different point in it'
      + (uneven ? ' and some advancing two steps at a time' : '')
      + '. Each section’s answer is the one fill it hasn’t shown yet.',
    instruction: null, // visual pick-one puzzle — no wording needed
    answerSpec: { kind: 'nested', shape, n, single, states },
  };
}

const genNestedSquare = (R, level) => genNestedShape(R, 1, 'square');
const genNestedCircle = (R, level) => genNestedShape(R, 2, 'circle');
const genNestedTriangle = (R, level) => genNestedShape(R, 3, 'triangle');
// Hard, single-layer variants of the offset-5-cycle mechanic (the one the
// owner liked on triangles) applied to squares and circles too.
const genNestedSquareHard = (R, level) => genNestedShape(R, 3, 'square');
const genNestedCircleHard = (R, level) => genNestedShape(R, 3, 'circle');
// Double (two-layer) variants: outer AND inner each run the offset-5-cycle.
const genNestedSquareDouble = (R, level) => genNestedShape(R, 4, 'square');
const genNestedCircleDouble = (R, level) => genNestedShape(R, 4, 'circle');

/* ============================================================
   Matrix (3x3) generators — Raven's style. The answer is the empty cell.
   ============================================================ */

function matrixFrames(cellAt) {
  const frames = [];
  for (let i = 0; i < 8; i++) frames.push(cellAt(Math.floor(i / 3), i % 3));
  return { frames, next: cellAt(2, 2) };
}

/* Distribution of three: each row/column holds each value exactly once. */
function genMatrixLatin(R, level) {
  const shapes = R.sample(SHAPES, 3);
  const fills = R.chance(0.5)
    ? ['outline', 'solid', R.pick(COLOR_NAMES)]
    : R.pick(COLOR_CYCLES).slice();
  const shapeLatin = level >= 2; // easy: shape constant per row; medium+: shapes Latin too
  const sizeLatin = level >= 4;
  const sizes = [0.65, 0.95, 1.25];
  const pairA = R.pick([[1, 1], [2, 2]]);
  const pairB = R.pick([[1, 2], [2, 1]]);
  const [shapeCoef, fillCoef] = R.chance(0.5) ? [pairA, pairB] : [pairB, pairA];
  const sizeCoef = [3 - shapeCoef[0], 3 - shapeCoef[1]];
  const idx = (k, r, c) => (k[0] * r + k[1] * c) % 3;
  const cellAt = (r, c) => ({
    center: {
      kind: shapeLatin ? shapes[idx(shapeCoef, r, c)] : shapes[r],
      fill: fills[idx(fillCoef, r, c)],
      scale: sizeLatin ? sizes[idx(sizeCoef, r, c)] : 1,
    },
  });
  const { frames, next } = matrixFrames(cellAt);
  return {
    type: 'matrix', frames, next,
    rule: shapeLatin
      ? 'Every row and column contains each shape and each fill exactly once (a Latin square on both).'
      : 'Each row keeps one shape; each fill appears exactly once per row and column.',
    answerSpec: { kind: 'center', shapes: shapes.slice(), fills: fills.slice(), sizes: sizeLatin ? sizes.slice() : null },
  };
}

/* Quantitative pairwise progression: dot count climbs across each row. */
function genMatrixRowCount(R, level) {
  const base = 1 + R.int(2);
  const d1 = 1 + R.int(2);
  const rowStart = [base, base + d1, base + d1 + 1 + R.int(2)];
  const color = level >= 3 ? R.pick(['blue', 'green', 'red']) : 'solid';
  const dotToken = { kind: 'circle', fill: color, scale: 0.8 };
  // Randomized ring orientation: the fill can start at any corner and run
  // either way, so the board reads differently each time.
  const ring = randomOrientation(R, BORDER8);
  const cellAt = (r, c) => {
    const n = rowStart[r] + c;
    const cells = Array(9).fill(null);
    for (let k = 0; k < n && k < 8; k++) cells[ring[k]] = { ...dotToken };
    return { cells };
  };
  const { frames, next } = matrixFrames(cellAt);
  return {
    type: 'matrix', frames, next,
    rule: 'In every row the dot count rises by one from left to right; dots fill around the ring in the same order every cell.',
    answerSpec: { kind: 'dots', dotToken, grid3: false, cellPositions: BORDER8.slice() },
  };
}

/* Combine: in every row, the third cell is the first two laid on top of each
   other (every dot from both). Rendered A + B = C with the two source cells
   highlighted, so "how they combine" is obvious. All 9 cells are in play (the
   centre is clickable too). */
function genMatrixOverlay(R, level) {
  const positions = [0, 1, 2, 3, 4, 5, 6, 7, 8]; // all cells, centre included
  const orSet = (a, b) => new Set([...a, ...b]);
  const rows = [];
  for (let r = 0; r < 3; r++) {
    let a, b;
    for (let tries = 0; tries < 60; tries++) {
      a = new Set(R.sample(positions, 2 + R.int(2)));
      b = new Set(R.sample(positions, 2 + R.int(2)));
      const inter = [...a].filter(x => b.has(x)).length;
      // overlap a little (so the union isn't just A beside B) but each keeps a dot of its own
      if (inter >= 1 && a.size - inter >= 1 && b.size - inter >= 1) break;
    }
    rows.push([a, b]);
  }
  const dotToken = { kind: 'circle', fill: 'solid', scale: 0.85 };
  const setToPanel = s => {
    const cells = Array(9).fill(null);
    for (const p of s) cells[p] = { ...dotToken };
    return { grid3: true, cells };
  };
  const cellAt = (r, c) => setToPanel(c === 0 ? rows[r][0] : c === 1 ? rows[r][1] : orSet(rows[r][0], rows[r][1]));
  const { frames, next } = matrixFrames(cellAt);
  return {
    type: 'matrix', family: 'combine', frames, next,
    rule: 'Each row: the first two cells laid together make the third (every dot from both).',
    instruction: 'A + B = C — place every dot from the two highlighted cells.',
    answerSpec: { kind: 'dots', dotToken, grid3: true, cellPositions: positions.slice() },
  };
}

/* Numbers that add up: a 3x3 of small numbers with the row totals down the
   right and the column totals along the bottom. One cell is blank — the row
   and column it sits in are highlighted; fill the number that makes both
   totals work. Light mental math, clear visual target. */
function genMatrixSum(R, level) {
  const grid = [];
  for (let r = 0; r < 3; r++) {
    const row = [];
    for (let c = 0; c < 3; c++) row.push(1 + R.int(9)); // single digits
    grid.push(row);
  }
  const rowSums = grid.map(row => row[0] + row[1] + row[2]);
  const colSums = [0, 1, 2].map(c => grid[0][c] + grid[1][c] + grid[2][c]);
  const br = R.int(3), bc = R.int(3);
  const answer = grid[br][bc];
  return {
    type: 'matrix', family: 'matrixsum',
    frames: [], next: { text: String(answer) },
    grid, rowSums, colSums, blank: { r: br, c: bc },
    rule: `Row ${br + 1} adds to ${rowSums[br]} and column ${bc + 1} adds to ${colSums[bc]}, so the missing number is ${answer}.`,
    instruction: 'Fill the blank so its highlighted row and column each add up to the totals shown.',
    answerSpec: { kind: 'number', maxLen: 2 },
  };
}

/* ============================================================
   Number / calendar / scheduling families (hard tier)
   ============================================================ */

/* Number sequences driven by % growth and simple arithmetic. All answers are
   integers by construction. */
function genNumberSeq(R, level) {
  const kind = R.pick(['percent', 'altops', 'accel']);
  let seq, rule;

  if (kind === 'percent') {
    // ratio num/den with a start that keeps five terms integral
    const [num, den, label] = R.pick([[3, 2, '50%'], [5, 4, '25%'], [2, 1, '100%']]);
    const k = den === 4 ? 1 : den === 2 ? 1 + R.int(5) : 3 + R.int(6);
    let x = Math.pow(den, SEQ_LEN) * k;
    seq = [x];
    for (let i = 0; i < SEQ_LEN; i++) { x = (x * num) / den; seq.push(x); }
    rule = `Each number grows by ${label} (×${num}/${den}).`;
  } else if (kind === 'altops') {
    // alternate +a, ×2
    const a = 2 + R.int(6);
    let x = 2 + R.int(5);
    seq = [x];
    const ops = [];
    for (let i = 0; i < SEQ_LEN; i++) {
      if (i % 2 === 0) { x += a; ops.push(`+${a}`); } else { x *= 2; ops.push('×2'); }
      seq.push(x);
    }
    rule = `Two alternating steps: +${a}, then ×2, repeating.`;
  } else {
    // growing difference: +d, +d+s, +d+2s…
    const d = 2 + R.int(4);
    const s = 1 + R.int(3);
    let x = 1 + R.int(9);
    seq = [x];
    for (let i = 0; i < SEQ_LEN; i++) { x += d + i * s; seq.push(x); }
    rule = `The gap between numbers grows by ${s} each step (+${d}, +${d + s}, +${d + 2 * s}…).`;
  }

  const frames = seq.slice(0, SEQ_LEN).map(v => ({ text: String(v) }));
  return {
    type: 'sequence', family: 'number', frames, next: { text: String(seq[SEQ_LEN]) },
    rule,
    instruction: null, // self-evident: numbers + "?" + keypad
    answerSpec: { kind: 'number', maxLen: String(seq[SEQ_LEN]).length + 2 },
  };
}

/* Calendar requirements: a month grid (days 1..N starting on a Monday, a few
   ★/◆ event days), three requirements, and a blank calendar — the player
   marks EVERY day that satisfies all three. Solver-built; the qualifying set
   is regenerated until it's a thoughtful size (2–6 days). */
function genMonthReqs(R, level) {
  const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const days = R.pick([28, 30, 31]);
  const wd = d => (d - 1) % 7; // day 1 is a Monday; 5/6 = weekend

  for (let attempt = 0; attempt < 80; attempt++) {
    const all = Array.from({ length: days }, (_, i) => i + 1);
    const starDays = R.sample(all, 2 + R.int(2));
    const diamondDays = R.sample(all.filter(d => !starDays.includes(d)), 2 + R.int(2));
    const marks = {};
    starDays.forEach(d => { marks[d] = 'star'; });
    diamondDays.forEach(d => { marks[d] = 'diamond'; });
    const lastStar = Math.max(...starDays);

    const categoryReqs = [
      ...[0, 1, 2, 3, 4].map(w => ({ text: `It must be a ${WEEKDAY_NAMES[w]}.`, test: d => wd(d) === w })),
      { text: 'It must be a weekend day.', test: d => wd(d) >= 5 },
      { text: 'It must be a Monday, Wednesday, or Friday.', test: d => [0, 2, 4].includes(wd(d)) },
    ];
    const rangeReqs = [
      { text: 'It must be after the 15th.', test: d => d > 15 },
      { text: 'It must be on or before the 15th.', test: d => d <= 15 },
      { text: 'It must fall between the 8th and the 22nd.', test: d => d >= 8 && d <= 22 },
    ];
    const extraReqs = [
      { text: 'It must be an odd-numbered day.', test: d => d % 2 === 1 },
      { text: 'It must be an even-numbered day.', test: d => d % 2 === 0 },
      { text: 'It must not be next to a ◆ day (the day before or after one).', test: d => !diamondDays.includes(d - 1) && !diamondDays.includes(d + 1) },
      { text: 'It must come after the last ★ of the month.', test: d => d > lastStar },
    ];
    const reqs = [R.pick(categoryReqs), R.pick(rangeReqs), R.pick(extraReqs)];
    const solution = all.filter(d => reqs.every(r => r.test(d)));
    if (solution.length < 2 || solution.length > 6) continue;

    return {
      type: 'single', family: 'month',
      frames: [],
      next: { month: { days, marks: solution } },
      rule: `The qualifying days are ${solution.join(', ')} — the only ones passing all three requirements.`,
      instruction: `Mark every day that fits ALL the requirements: ① ${reqs[0].text} ② ${reqs[1].text} ③ ${reqs[2].text}`,
      answerSpec: { kind: 'month', days, marks },
    };
  }
  return genSchedule(R, level); // vanishingly unlikely fallback
}

/* Grid placement: a 3x3 board with a fixed ★; place dots so every rule holds.
   Constraints are solver-verified to admit exactly ONE arrangement. */
function genGridPlace(R, level) {
  const row = p => Math.floor(p / 3), col = p => p % 3;
  const adjacent = (a, b) => Math.abs(row(a) - row(b)) <= 1 && Math.abs(col(a) - col(b)) <= 1 && a !== b;
  const CORNERS = [0, 2, 6, 8];

  for (let attempt = 0; attempt < 120; attempt++) {
    const star = R.int(9);
    const free = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(p => p !== star);
    const candidates = [
      { text: 'Exactly one dot in each row.', test: s => [0, 1, 2].every(r => s.filter(p => row(p) === r).length === 1) },
      { text: 'Exactly one dot in each column.', test: s => [0, 1, 2].every(c => s.filter(p => col(p) === c).length === 1) },
      { text: 'No dot may touch the ★ (not even diagonally).', test: s => s.every(p => !adjacent(p, star)) },
      { text: 'No two dots may touch each other (not even diagonally).', test: s => s.every(a => s.every(b => a === b || !adjacent(a, b))) },
      { text: 'Exactly one dot in a corner.', test: s => s.filter(p => CORNERS.includes(p)).length === 1 },
      { text: 'The centre cell stays empty.', test: s => !s.includes(4) },
      { text: `No dot in the ★'s row.`, test: s => s.every(p => row(p) !== row(star)) },
    ];
    const reqs = R.sample(candidates, 3);

    // Enumerate all 3-dot placements on the free cells; demand a unique fit.
    const fits = [];
    for (let a = 0; a < free.length - 2 && fits.length < 2; a++)
      for (let b = a + 1; b < free.length - 1 && fits.length < 2; b++)
        for (let c = b + 1; c < free.length && fits.length < 2; c++) {
          const s = [free[a], free[b], free[c]];
          if (reqs.every(r => r.test(s))) fits.push(s);
        }
    if (fits.length !== 1) continue;

    const starPanel = { grid3: true, cells: Array(9).fill(null) };
    starPanel.cells[star] = { kind: 'star', fill: 'orange', scale: 0.7 };
    const answer = { grid3: true, cells: Array(9).fill(null) };
    for (const p of fits[0]) answer.cells[p] = { kind: 'circle', fill: 'solid', scale: 0.8 };

    return {
      type: 'single', family: 'dots',
      frames: [starPanel],
      next: answer,
      rule: 'Only one arrangement of three dots satisfies every rule at once.',
      instruction: `Place exactly 3 dots in the answer grid (the ★ stays where it is): ① ${reqs[0].text} ② ${reqs[1].text} ③ ${reqs[2].text}`,
      answerSpec: { kind: 'dots', dotToken: { kind: 'circle', fill: 'solid', scale: 0.8 }, grid3: true, cellPositions: free },
    };
  }
  return genSchedule(R, level);
}

/* Ratio / percent word problems — typed integer answers, built so the
   arithmetic always lands on whole numbers. */
function genRatioWord(R, level) {
  const variant = R.pick(['ratio', 'percent', 'rate']);
  let prompt, answer;

  if (variant === 'ratio') {
    const pairs = [[2, 1], [3, 2], [5, 3], [7, 4], [18, 13], [9, 5]];
    const [a, b] = R.pick(pairs);
    const k = 2 + R.int(5);
    const total = k * (a + b);
    const first = R.chance(0.5);
    prompt = `Two businesses split ${total} units of product A in the ratio ${a}:${b}. How many units does business ${first ? 'one' : 'two'} hold?`;
    answer = k * (first ? a : b);
  } else if (variant === 'percent') {
    const opts = [[25, 4], [50, 2], [20, 5], [10, 10], [100, 1]];
    const [p, den] = R.pick(opts);
    const base = den * (3 + R.int(20));
    const grew = R.chance(0.5);
    const result = grew ? base + (base * p) / 100 : base - (base * p) / 100;
    if (R.chance(0.5)) {
      prompt = `A price ${grew ? 'rose' : 'fell'} by ${p}% and is now ${result}. What was it before the change?`;
      answer = base;
    } else {
      prompt = `A price of ${base} ${grew ? 'rises' : 'falls'} by ${p}%. What is it after the change?`;
      answer = result;
    }
  } else {
    const per = 3 + R.int(9);
    const n1 = 2 + R.int(4);
    const n2 = n1 + 2 + R.int(5);
    prompt = `${n1} crates hold ${n1 * per} units. At the same rate, how many units do ${n2} crates hold?`;
    answer = n2 * per;
  }

  return {
    type: 'single', family: 'word',
    frames: [],
    next: { text: String(answer) },
    prompt,
    rule: `The answer is ${answer}.`,
    instruction: null, // the prompt above carries it; keypad is self-evident
    answerSpec: { kind: 'number', maxLen: String(answer).length + 2 },
  };
}

/* Interactive ratio bars: drag each bar to the exact values the prompt pins
   down. Built so exactly one integer assignment works. */
function genRatioBars(R, level) {
  const variant = R.pick(['split', 'percent']);
  let labels, values, prompt;

  if (variant === 'split') {
    const pairs = [[2, 1], [3, 1], [3, 2], [5, 3], [4, 3]];
    const [a, b] = R.pick(pairs);
    const k = 2 + R.int(5);
    values = [a * k, b * k];
    labels = ['A', 'B'];
    prompt = `Split ${values[0] + values[1]} between bar A and bar B in the ratio ${a}:${b} (A gets the bigger share).`;
  } else {
    const p = R.pick([25, 50, 100]);
    const base = R.pick([8, 12, 16, 20, 24]);
    values = [base, base + (base * p) / 100];
    labels = ['A', 'B'];
    prompt = `Set bar A to ${base}, and bar B to ${p}% more than A.`;
  }

  const max = Math.max(...values) + 4 + R.int(6);
  return {
    type: 'single', family: 'bars',
    frames: [],
    next: { bars: values },
    prompt,
    rule: `Bar A = ${values[0]}, bar B = ${values[1]}.`,
    instruction: prompt,
    answerSpec: { kind: 'bars', labels, max },
  };
}

/* Constraint scheduling: one week with symbol days; exactly one day satisfies
   every rule. Solver-verified during generation. */
function genSchedule(R, level) {
  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  for (let attempt = 0; attempt < 80; attempt++) {
    const days = Array(7).fill(null);
    const starDays = R.sample([0, 1, 2, 3, 4, 5, 6], 1 + R.int(2));
    starDays.forEach(d => { days[d] = 'star'; });
    const free = [0, 1, 2, 3, 4, 5, 6].filter(d => !days[d]);
    const diamondDays = R.sample(free, 1 + R.int(2));
    diamondDays.forEach(d => { days[d] = 'diamond'; });

    const lastStar = Math.max(...starDays);
    const candidates = [
      { text: 'Not on a weekend.', ok: d => d < 5 },
      { text: 'Not on a ★ or ◆ day.', ok: d => !days[d] },
      { text: 'Not the day right after a ★ day.', ok: d => !starDays.includes(d - 1) },
      { text: 'Not next to a ◆ day (either side).', ok: d => !diamondDays.includes(d - 1) && !diamondDays.includes(d + 1) },
      { text: 'After the last ★ day of the week.', ok: d => d > lastStar },
      { text: 'Before the first ◆ day of the week.', ok: d => d < Math.min(...diamondDays) },
      { text: 'In the first half of the week (Mon–Thu).', ok: d => d <= 3 },
    ];

    const rules = R.sample(candidates, 3);
    const valid = [0, 1, 2, 3, 4, 5, 6].filter(d => rules.every(r => r.ok(d)));
    if (valid.length !== 1) continue;

    const answerDays = Array(7).fill(null);
    answerDays[valid[0]] = 'mark';
    return {
      type: 'sequence', family: 'schedule',
      frames: [{ week: { days } }],
      next: { week: { days: answerDays } },
      rule: `Only ${DAY_NAMES[valid[0]]} passes every rule: ${rules.map(r => r.text.toLowerCase().replace(/\.$/, '')).join('; ')}.`,
      instruction: `Pick the one day that satisfies all three rules: ① ${rules[0].text} ② ${rules[1].text} ③ ${rules[2].text}`,
      answerSpec: { kind: 'pickday' },
    };
  }
  // Solver couldn't land a unique day (vanishingly unlikely) — fall back.
  return genNumberSeq(R, level);
}

/* ============================================================
   Question assembly
   ============================================================ */

/* Easy targets ~1-minute solves: every entry is a meaty 2-rule level (or the
   nested square, whose two patterns take several frames to confirm) — no
   single-glance answers. */
const POOLS = {
  easy: [
    [genNestedSquare, 1], [genDots, 2], [genColorCycle, 2], [genAlternation, 3], [genPolygonMorph, 2],
  ],
  medium: [
    [genNestedCircle, 2], [genColorCycle, 3], [genNesting, 2], [genDots, 3],
    [genMatrixRowCount, 2], [genMatrixLatin, 2], [genMatrixSum, 2], [genMatrixOverlay, 2],
  ],
  hard: [
    [genNestedTriangle, 3], [genNestedSquareHard, 3], [genNestedCircleHard, 3],
    [genNestedSquareDouble, 4], [genNestedCircleDouble, 4],
    [genNumberSeq, 3], [genMonthReqs, 3], [genSchedule, 3],
    [genGridPlace, 3], [genRatioWord, 3], [genRatioBars, 3],
    [genMatrixLatin, 4], [genMatrixOverlay, 3], [genMatrixSum, 3],
    [genMatrixRowCount, 3], [genNesting, 3],
  ],
};

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

/* Puzzles where the answer is a shape/colour/pattern you'd otherwise have to
   construct are presented as 5 pre-filled choices instead (owner: picking is
   friendlier than choosing inner/outer/colour/shape). */
const MC_KINDS = new Set(['center', 'centerNested', 'nested']);

/* Find a section fill's index in the puzzle's 5-state list (null = blank). */
function stateIndex(states, sec) {
  if (!sec) return -1;
  return states.findIndex(s => (s.color || null) === (sec.color || null)
    && (s.texture || null) === (sec.texture || null));
}

/* Plausible wrong answers (near-misses a careless solver would pick). */
function choiceCandidates(next, frames, spec, R) {
  const out = [];
  const lastFrame = frames[frames.length - 1];

  if (spec.kind === 'center' || spec.kind === 'centerNested') {
    const c = next.center;
    const shapes = (spec.shapes || SHAPES).filter(s => s !== c.kind);
    const fills = (spec.fills || ['solid', 'outline']).filter(f => f !== c.fill);
    R.shuffle(shapes.slice()).forEach(s => out.push({ center: { ...c, kind: s } }));
    R.shuffle(fills.slice()).forEach(f => out.push({ center: { ...c, fill: f } }));
    if (spec.kind === 'centerNested' && c.inner) {
      // swap inner/outer shapes — a classic lure
      out.push({ center: { ...c, kind: c.inner.kind, inner: { ...c.inner, kind: c.kind } } });
      R.shuffle(shapes.slice()).forEach(s => out.push({ center: { ...c, inner: { ...c.inner, kind: s } } }));
    }
    out.push(deepClone(lastFrame));
    out.push(deepClone(frames[0]));
  } else if (spec.kind === 'nested') {
    const states = spec.states || [];
    const sh = next.nested.shape;
    const single = (next.nested.inner || []).length === 0;
    const cloneArr = a => a.map(s => (s ? { ...s } : null));
    const shift = (arr, d) => arr.map(sec => {
      const i = stateIndex(states, sec);
      if (i < 0) return states.length ? { ...states[((d % states.length) + states.length) % states.length] } : null;
      return { ...states[((i + d) % states.length + states.length) % states.length] };
    });
    // off-by-one in the pattern (didn't advance / over-advanced)
    out.push({ nested: { shape: sh, outer: shift(next.nested.outer, 1), inner: single ? [] : shift(next.nested.inner, 1) } });
    out.push({ nested: { shape: sh, outer: shift(next.nested.outer, -1), inner: single ? [] : shift(next.nested.inner, -1) } });
    if (!single && next.nested.outer.length === next.nested.inner.length) {
      out.push({ nested: { shape: sh, outer: cloneArr(next.nested.inner), inner: cloneArr(next.nested.outer) } }); // layers swapped
    }
    out.push(deepClone(lastFrame)); // copy of the last shown frame
    out.push({ nested: { shape: sh, outer: cloneArr(next.nested.outer).reverse(), inner: single ? [] : cloneArr(next.nested.inner) } });
    out.push(deepClone(frames[0]));
  }
  return out;
}

/* Build the correct answer + 4 distinct distractors, shuffled. */
function buildChoices(next, frames, spec, R) {
  const options = [deepClone(next)];
  for (const c of choiceCandidates(next, frames, spec, R)) {
    if (options.length >= 5) break;
    if (c && !options.some(o => panelEq(o, c))) options.push(c);
  }
  // Fallback: if near-misses collided, pad from other shown frames / tweaks.
  let guard = 0;
  while (options.length < 5 && guard++ < 40) {
    const src = R.pick(frames);
    const c = deepClone(src);
    if (!options.some(o => panelEq(o, c))) options.push(c);
    else if (spec.kind !== 'nested') { // last resort: random center
      const alt = { center: { kind: R.pick(spec.shapes || SHAPES), fill: R.pick(spec.fills || ['solid', 'outline']) } };
      if (!options.some(o => panelEq(o, alt))) options.push(alt);
    }
  }
  const shuffled = R.shuffle(options.map((p, i) => ({ p, correct: i === 0 })));
  return { options: shuffled.map(o => o.p), answerIndex: shuffled.findIndex(o => o.correct) };
}

function packQuestion(q, difficulty, R) {
  const kind = q.answerSpec.kind;
  const base = {
    type: q.type,
    family: q.family || (q.type === 'matrix' ? 'matrix'
      : kind === 'nested' ? 'nested'
      : kind === 'dots' ? 'dots' : 'shapes'),
    frames: q.frames,
    next: q.next,
    rule: q.rule,
    instruction: q.instruction || null,
    prompt: q.prompt || null,
    answerSpec: q.answerSpec,
    difficulty,
  };
  // Number-grid puzzles carry their board + totals for custom rendering.
  if (q.grid) { base.grid = q.grid; base.rowSums = q.rowSums; base.colSums = q.colSums; base.blank = q.blank; }
  if (R && MC_KINDS.has(kind)) base.choice = buildChoices(q.next, q.frames, q.answerSpec, R);
  return base;
}

/* The daily's fifth puzzle is always a hard nested shape — the flagship finale. */
export function generateNestedFinale(R) {
  // Mix single-layer (3) and double (4) shape variants for the daily closer.
  const pick = R.pick([
    ['triangle', 3], ['square', 3], ['circle', 3],
    ['square', 4], ['circle', 4],
  ]);
  return packQuestion(genNestedShape(R, pick[1], pick[0]), 'hard', R);
}

export function generateProblem(R, difficulty) {
  const pool = POOLS[difficulty] || POOLS.medium;
  const [gen, level] = R.pick(pool);
  return packQuestion(gen(R, level), difficulty, R);
}
