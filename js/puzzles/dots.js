/* Dot game — click dots straight into the grid.
   Owns its rules only; it uses the shared default layout and the shared dot
   input widget (answerSpec.kind === 'dots'). 3x3 for easy/medium; some 5x5
   for the bigger, showier patterns. */

import { SEQ_LEN, spiralOrder } from './shared.js';

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

/* 5x5 — asymmetric, trace-the-path growth: a spiral winding in, a snake
   weaving across the rows, or a diagonal line sweeping over. */
function genDots5(R, color) {
  const dotToken = { kind: 'circle', fill: color, scale: 0.8 };
  const mode = R.pick(['spiral', 'snake', 'sweep']);
  let cellsAt, rule;

  if (mode === 'spiral') {
    let order = spiralOrder(5);
    if (R.chance(0.5)) order = order.slice().reverse(); // wind outward from the centre instead
    const step = R.pick([4, 5]);
    const start = 2 + R.int(3);
    cellsAt = i => order.slice(0, Math.min(25, start + step * i));
    rule = 'The dots wind along a spiral, a few more added each panel.';
  } else if (mode === 'snake') {
    const order = [];
    for (let r = 0; r < 5; r++) {
      const row = [0, 1, 2, 3, 4].map(c => r * 5 + c);
      if (r % 2 === 1) row.reverse(); // weave back the other way each row
      order.push(...row);
    }
    const step = R.pick([4, 5]);
    const start = 2 + R.int(3);
    cellsAt = i => order.slice(0, Math.min(25, start + step * i));
    rule = 'The dots fill back and forth along the rows (a snake), a few more each panel.';
  } else {
    const dir = R.chance(0.5) ? 1 : -1;
    const startK = dir === 1 ? 0 : 8;
    cellsAt = i => {
      const k = startK + dir * i;
      const out = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (r + c === k) out.push(r * 5 + c);
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

export function genDots(R, level) {
  const color = level >= 3 ? R.pick(['blue', 'red', 'green']) : 'solid';
  return (level >= 3 && R.chance(0.6)) ? genDots5(R, color) : genDots3(R, color);
}
