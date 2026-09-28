/* toast, loader bar*/

const UI = id => document.getElementById(id);

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const wrapAngle = a => ((a % TAU) + TAU) % TAU;

/* c short path a b */
function angleLerp(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

/* seeded random numbers t g*/
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

/* the loader is the ring round the enter button on the start sheet */
function step(pct, label) {
  UI('enter').style.setProperty('--p', pct);
  UI('loadTxt').innerHTML = `<b>${pct}%</b> &nbsp;${label}`;
}

let toastTimer = null;
function toast(html) {
  const t = UI('toast');
  t.innerHTML = html;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function toggleInfo() {
  UI('info').classList.toggle('on');          
}

export { TAU, UI, angleLerp, clamp, lerp, nextFrame, rng, smoothstep, step, toast, toggleInfo, wrapAngle };
