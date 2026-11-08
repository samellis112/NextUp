// Next Up logo: six shapes that morph into N E X T U P, one at a time, left to right.
// Mounts into every `.logo-hero` element. Plays once per page load (the first time a
// hero scrolls into view); later heroes and reduced-motion users get the finished word.
const SW = 11, M = 96, NS = 'http://www.w3.org/2000/svg';

function arc(cx, cy, r, a0, a1, n) {
  const o = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
    o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return o;
}
const circle = arc(50, 50, 38, -135, 225, 64);
const star = [];
for (let j = 0; j <= 10; j++) {
  const a = (-162 + 36 * j) * Math.PI / 180, r = j % 2 ? 18 : 44;
  star.push([50 + r * Math.cos(a), 56 + r * Math.sin(a)]);
}
const tri = [[14, 88], [50, 12], [86, 88], [14, 88]];

const CELLS = [
  { x: 0,   c: 'var(--mark-blue)',   s: tri,  l: [[22, 88], [22, 12], [78, 88], [78, 12]] },
  { x: 105, c: 'var(--mark-orange)', s: [[64, 12], [64, 36], [88, 36], [88, 64], [64, 64], [64, 88], [36, 88], [36, 64], [12, 64], [12, 36], [36, 36], [36, 12], [64, 12]],
    l: [[78, 12], [22, 12], [22, 50], [70, 50], [22, 50], [22, 88], [78, 88]] },
  { x: 210, c: 'var(--mark-grey)',   s: circle, l: [[20, 14], [50, 50], [80, 14], [50, 50], [20, 86], [50, 50], [80, 86]] },
  { x: 315, c: 'var(--mark-blue)',   s: star, l: [[18, 14], [82, 14], [50, 14], [50, 88]] },
  { x: 460, c: 'var(--mark-orange)', s: [[30, 16], [10, 50], [30, 84], [70, 84], [90, 50], [70, 16], [30, 16]],
    l: [[22, 12], [22, 58], ...arc(50, 58, 28, 180, 0, 24), [78, 12]] },
  { x: 565, c: 'var(--mark-grey)',   s: tri,  l: [[24, 88], [24, 12], [56, 12], ...arc(56, 32, 20, -90, 90, 16), [24, 52]] },
];

function resample(p, n) {
  const L = [0];
  for (let i = 1; i < p.length; i++) L.push(L[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  const tot = L[L.length - 1], out = [];
  let j = 1;
  for (let k = 0; k <= n; k++) {
    const d = tot * k / n;
    while (j < p.length - 1 && L[j] < d) j++;
    const t = (d - L[j - 1]) / ((L[j] - L[j - 1]) || 1);
    out.push([p[j - 1][0] + (p[j][0] - p[j - 1][0]) * t, p[j - 1][1] + (p[j][1] - p[j - 1][1]) * t]);
  }
  return out;
}
CELLS.forEach(c => { c.S = resample(c.s, M); c.L = resample(c.l, M); });

const clamp = v => Math.max(0, Math.min(1, v));
const inOut = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const back = t => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const T = { pop: .5, popStep: .12, hold: .9, morph: .7, morphStep: .42, gap: .3 };
const ms = i => T.popStep * 5 + T.pop + T.hold + i * T.morphStep + (i >= 4 ? T.gap : 0);
const END = ms(5) + T.morph;

function build(host) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-10 -10 685 120');
  svg.setAttribute('aria-hidden', 'true');
  const els = CELLS.map(c => {
    const g = document.createElementNS(NS, 'g'), p = document.createElementNS(NS, 'path');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke-width', SW);
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    p.style.stroke = c.c;
    g.appendChild(p);
    svg.appendChild(g);
    return { g, p };
  });
  host.textContent = '';
  host.appendChild(svg);
  return t => CELLS.forEach((c, i) => {
    const pop = clamp((t - T.popStep * i) / T.pop), mo = clamp((t - ms(i)) / T.morph), e = inOut(mo);
    const pts = c.S.map((a, k) => {
      const b = c.L[k];
      return (a[0] + (b[0] - a[0]) * e).toFixed(1) + ' ' + (a[1] + (b[1] - a[1]) * e).toFixed(1);
    });
    els[i].p.setAttribute('d', 'M' + pts.join('L'));
    const sc = (pop >= 1 ? 1 : back(pop)) * (1 + .12 * Math.sin(Math.PI * mo));
    els[i].g.setAttribute('opacity', pop > 0 ? 1 : 0);
    els[i].g.setAttribute('transform', `translate(${c.x + 50} 50) scale(${sc.toFixed(3)}) translate(-50 -50)`);
  });
}

const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
let played = false;

function play(render) {
  if (reduce) { render(END); return; }
  const t0 = performance.now();
  (function frame(now) {
    const t = (now - t0) / 1000;
    render(Math.min(t, END));
    if (t < END) requestAnimationFrame(frame);
  })(t0);
}

function mount(host) {
  const render = build(host);
  render(0);
  host.addEventListener('click', () => { if (!reduce) play(render); });
  host.classList.add('replayable');
  const start = () => {
    if (played) { render(END); return; }
    played = true;
    play(render);
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); start(); }
    }, { threshold: 0.5 });
    io.observe(host);
  } else {
    start();
  }
}

document.querySelectorAll('.logo-hero').forEach(mount);
