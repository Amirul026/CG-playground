import * as THREE from 'three';
import { TAU, clamp, rng } from './helpers.js';



const TEX = {};

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h || w;
  return [c, c.getContext('2d')];
}


function noise2(size, octaves, seed, gain, cells0) {
  const out = new Float32Array(size * size);
  const rand = rng(seed);
  const g = gain === undefined ? 0.5 : gain;
  let amp = 1, norm = 0, cells = cells0 || 4;

  for (let o = 0; o < octaves; o++) {
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = rand();
    const k = cells / size;
    for (let y = 0; y < size; y++) {
      const fy = y * k, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      const y1 = (y0 + 1) % cells;
      for (let x = 0; x < size; x++) {
        const fx = x * k, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % cells;
        const a = lat[y0 * cells + x0], b = lat[y0 * cells + x1];
        const c = lat[y1 * cells + x0], d = lat[y1 * cells + x1];
        out[y * size + x] += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * amp;
      }
    }
    norm += amp; amp *= g; cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}


function paintPixels(g, S, fn) {
  const img = g.createImageData(S, S), d = img.data, px = [0, 0, 0];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      fn(i, x, y, px);
      d[i * 4] = px[0]; d[i * 4 + 1] = px[1]; d[i * 4 + 2] = px[2]; d[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}


function grime(g, S, n, amount) {
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < S * S; i++) {
    const v = (n[i] - 0.5) * amount;
    d[i * 4] += v; d[i * 4 + 1] += v; d[i * 4 + 2] += v;
  }
  g.putImageData(img, 0, 0);
}

function makeTex(c, rx, ry, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx || 1, ry || rx || 1);
  t.anisotropy = 8;
  if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}


const BAY = { w: 3.2, h: 3.4 };
const WIN = { x0: 0.035, x1: 0.965, y0: 0.30, y1: 0.88, frame: 0.022, mullion: 0.02, transom: 0.72 };
const SKIN_SIZE = 512;

/* the window  */
function windowRects(S) {
  const ox = WIN.x0 * S, oy = (1 - WIN.y1) * S;
  const ow = (WIN.x1 - WIN.x0) * S, oh = (WIN.y1 - WIN.y0) * S;
  const f = WIN.frame * S, m = WIN.mullion * S;
  const ix = ox + f, iy = oy + f, iw = ow - 2 * f, ih = oh - 2 * f;
  const yT = (1 - WIN.transom) * S;                   
  const panes = [
    [ix, iy, iw, yT - iy - m / 2],                      
    [ix, yT + m / 2, iw / 2 - m / 2, iy + ih - yT - m / 2],
    [ix + iw / 2 + m / 2, yT + m / 2, iw / 2 - m / 2, iy + ih - yT - m / 2]
  ];
  return { outer: [ox, oy, ow, oh], panes };
}

function drawWindow(g, S, frameCol, glassTop, glassBottom) {
  const r = windowRects(S);
  g.fillStyle = frameCol;
  g.fillRect(r.outer[0], r.outer[1], r.outer[2], r.outer[3]);
  for (const p of r.panes) {
    const grd = g.createLinearGradient(0, p[1], 0, p[1] + p[3]);
    grd.addColorStop(0, glassTop);
    grd.addColorStop(1, glassBottom);
    g.fillStyle = grd;
    g.fillRect(p[0], p[1], p[2], p[3]);
    g.save();
    g.beginPath(); g.rect(p[0], p[1], p[2], p[3]); g.clip();
    g.fillStyle = 'rgba(255,255,255,.08)';
    g.beginPath();
    g.moveTo(p[0] + p[2] * 0.10, p[1] + p[3]);
    g.lineTo(p[0] + p[2] * 0.45, p[1]);
    g.lineTo(p[0] + p[2] * 0.62, p[1]);
    g.lineTo(p[0] + p[2] * 0.27, p[1] + p[3]);
    g.fill();
    g.restore();
  }
}


function texWindowMask() {
  const S = SKIN_SIZE, [c, g] = canvas2d(S);
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const r = windowRects(S);
  g.fillStyle = '#00ff00'; g.fillRect(r.outer[0], r.outer[1], r.outer[2], r.outer[3]);
  g.fillStyle = '#ff0000';
  for (const p of r.panes) g.fillRect(p[0], p[1], p[2], p[3]);
  const t = makeTex(c, 1, 1, false);
  t.anisotropy = 4;
  return t;
}


function spandrel(g, S, fill) {
  const top = (1 - WIN.y1) * S, bottom = (1 - WIN.y0) * S;
  fill(0, 0, S, top);                  
  fill(0, bottom, S, S - bottom);      
}


function skinWhite() {
  const S = SKIN_SIZE, [c, g] = canvas2d(S);
  const n = noise2(S, 5, 111, 0.55, 8);
  paintPixels(g, S, (i, x, y, px) => {
    const v = n[i] * 16;
    px[0] = 228 + v; px[1] = 229 + v; px[2] = 226 + v;
  });
  const bottom = (1 - WIN.y0) * S;
  g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(0, bottom + S * 0.03, S, 2);   // panel joint
  g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(0, S - 3, S, 3);
  drawWindow(g, S, '#e9ecec', '#7fa6ab', '#244a52');
  return makeTex(c);
}


function skinTerracotta() {
  const S = SKIN_SIZE, [c, g] = canvas2d(S);
  g.fillStyle = '#d9cfc4'; g.fillRect(0, 0, S, S);
  const rand = rng(222);
  spandrel(g, S, (x0, y0, w, h) => {
    const th = S / 18, tw = th * 3;
    for (let y = y0; y < y0 + h; y += th) {
      const off = (Math.round(y / th) % 2) * tw / 2;
      for (let x = -tw; x < S + tw; x += tw) {
        const t = rand();
        g.fillStyle = `rgb(${170 + t * 34 | 0},${74 + t * 20 | 0},${44 + t * 14 | 0})`;
        g.fillRect(x + off + 1.5, y + 1.5, tw - 3, Math.min(th, y0 + h - y) - 3);
      }
    }
  });
  grime(g, S, noise2(S, 5, 223, 0.55, 8), 24);
  drawWindow(g, S, '#3b3129', '#8c9aa2', '#2a343b');
  return makeTex(c);
}


function skinBlueGlass() {
  const S = SKIN_SIZE, [c, g] = canvas2d(S);
  const grd = g.createLinearGradient(0, 0, S, S);
  grd.addColorStop(0, '#3d5a78'); grd.addColorStop(1, '#1f3148');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(255,255,255,.06)';
  g.fillRect(0, (1 - WIN.y0) * S + S * 0.06, S, S * 0.08);
  g.fillStyle = '#b8c2cc';
  g.fillRect(0, (1 - WIN.y0) * S + 2, S, 5);
  g.fillRect(0, 0, S, 5);
  drawWindow(g, S, '#c3cbd3', '#7fa0c2', '#1c3350');
  return makeTex(c);
}


function skinSandstone() {
  const S = SKIN_SIZE, [c, g] = canvas2d(S);
  const n = noise2(S, 6, 404, 0.58, 8);
  paintPixels(g, S, (i, x, y, px) => {
    const v = n[i] * 44;
    px[0] = 194 + v; px[1] = 164 + v * 0.9; px[2] = 120 + v * 0.7;
  });
  g.strokeStyle = 'rgba(92,70,40,.5)'; g.lineWidth = 3;
  const bottom = (1 - WIN.y0) * S;
  for (const y of [bottom + (S - bottom) / 2, S - 1]) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  for (let x = S / 6; x < S; x += S / 3) {
    g.beginPath(); g.moveTo(x, bottom); g.lineTo(x, bottom + (S - bottom) / 2); g.stroke();
    g.beginPath(); g.moveTo(x + S / 6, bottom + (S - bottom) / 2); g.lineTo(x + S / 6, S); g.stroke();
  }
  drawWindow(g, S, '#5a4630', '#8aa0ad', '#26323b');
  return makeTex(c);
}


function skinGranite() {
  const S = SKIN_SIZE, [c, g] = canvas2d(S);
  const n = noise2(S, 6, 505, 0.6, 16);
  const rand = rng(506);
  paintPixels(g, S, (i, x, y, px) => {
    const speck = rand() > 0.93 ? 40 : 0;
    const v = 58 + n[i] * 30 + speck;
    px[0] = v; px[1] = v; px[2] = v * 1.04;
  });
  g.fillStyle = 'rgba(255,255,255,.12)';
  g.fillRect(0, (1 - WIN.y0) * S + 3, S, 2);
  drawWindow(g, S, '#161616', '#b39b78', '#3a2f24');
  return makeTex(c);
}

const SKINS = [
  { name: 'Campus white', build: skinWhite, trim: 0xf2f2ee },
  { name: 'Terracotta', build: skinTerracotta, trim: 0xe9e2d6 },
  { name: 'Blue glass', build: skinBlueGlass, trim: 0xc9d1d8 },
  { name: 'Sandstone', build: skinSandstone, trim: 0xe8dcc4 },
  { name: 'Charcoal granite', build: skinGranite, trim: 0x8d8f93 }
];


function texTerracotta() {
  const S = 512, [c, g] = canvas2d(S);
  g.fillStyle = '#cdbfb0'; g.fillRect(0, 0, S, S);
  const rand = rng(630);
  const th = S / 16, tw = S / 4;
  for (let r = 0; r < 16; r++) {
    const off = (r % 2) * tw / 2;
    for (let x = -tw; x < S + tw; x += tw) {
      const t = rand();
      g.fillStyle = `rgb(${176 + t * 30 | 0},${78 + t * 18 | 0},${46 + t * 12 | 0})`;
      g.fillRect(x + off + 2, r * th + 2, tw - 4, th - 4);
    }
  }
  grime(g, S, noise2(S, 5, 631, 0.55, 8), 26);
  return makeTex(c);
}


function texRedPaving() {
  const S = 512, [c, g] = canvas2d(S);
  g.fillStyle = '#8f7f72'; g.fillRect(0, 0, S, S);
  const rand = rng(640), u = S / 16;
  for (let y = -4; y < 20; y++) for (let x = -4; x < 20; x++) {
    const t = rand();
    g.fillStyle = `rgb(${160 + t * 40 | 0},${70 + t * 22 | 0},${52 + t * 16 | 0})`;
    const bx = (x + y) * u, by = (y - x) * u;
    if ((x + y) % 2 === 0) g.fillRect(bx + 1, by + 1, 2 * u - 2, u - 2);
    else g.fillRect(bx + 1, by + 1, u - 2, 2 * u - 2);
  }
  grime(g, S, noise2(S, 5, 641, 0.55, 4), 34);
  return makeTex(c);
}


function texArchSign(text) {
  const [c, g] = canvas2d(2048, 160);
  g.fillStyle = '#f7f7f2'; g.fillRect(0, 0, 2048, 160);
  g.fillStyle = '#1f7a45'; g.fillRect(0, 0, 2048, 10); g.fillRect(0, 150, 2048, 10);
  g.fillStyle = '#1f7a45';
  g.font = 'bold 92px Georgia, "Times New Roman", serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 1024, 84, 1960);
  return makeTex(c);
}
//end b

//s p g 


function texPaving() {
  const S = 512, [c, g] = canvas2d(S);
  const rand = rng(606), cells = 8, cs = S / cells;
  g.fillStyle = '#6f6a63'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const t = rand();
    const v = 150 + t * 34;
    g.fillStyle = `rgb(${v | 0},${v * 0.97 | 0},${v * 0.92 | 0})`;
    g.fillRect(x * cs + 2, y * cs + 2, cs - 4, cs - 4);
  }
  grime(g, S, noise2(S, 5, 607, 0.55, 4), 40);
  return makeTex(c);
}


function texGrass() {
  const S = 256, [c, g] = canvas2d(S);
  const n = noise2(S, 5, 700, 0.55, 4), m = noise2(S, 3, 701, 0.5, 2);
  paintPixels(g, S, (i, x, y, px) => {
    const v = n[i], t = m[i];
    px[0] = 58 + v * 52 + t * 22; px[1] = 92 + v * 64 + t * 26; px[2] = 40 + v * 30;
  });
  const rand = rng(702);
  for (let k = 0; k < 1600; k++) {
    const x = rand() * S, y = rand() * S, len = 3 + rand() * 6;
    g.strokeStyle = `rgba(${60 + rand() * 50 | 0},${100 + rand() * 60 | 0},${40 + rand() * 30 | 0},.5)`;
    g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 3, y - len); g.stroke();
  }
  const flowers = ['#f4efd0', '#f0d64a', '#e8b8d8'];
  for (let k = 0; k < 90; k++) {
    g.fillStyle = flowers[(rand() * flowers.length) | 0];
    g.globalAlpha = 0.5 + rand() * 0.4;
    g.beginPath(); g.arc(rand() * S, rand() * S, 0.8 + rand() * 1.2, 0, TAU); g.fill();
  }
  g.globalAlpha = 1;
  return makeTex(c);
}


function texDirt() {
  const S = 256, [c, g] = canvas2d(S);
  const n = noise2(S, 5, 800, 0.55, 4);
  paintPixels(g, S, (i, x, y, px) => {
    const v = n[i];
    px[0] = 96 + v * 60; px[1] = 76 + v * 46; px[2] = 54 + v * 32;
  });
  return makeTex(c);
}


function texSand() {
  const S = 256, [c, g] = canvas2d(S);
  const n = noise2(S, 5, 900, 0.6, 8);
  const rand = rng(901);
  paintPixels(g, S, (i, x, y, px) => {
    const v = n[i] * 40 + (rand() - 0.5) * 26;
    px[0] = 206 + v; px[1] = 182 + v; px[2] = 132 + v * 0.8;
  });
  return makeTex(c);
}


function texRubber() {
  const S = 256, [c, g] = canvas2d(S);
  g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  const rand = rng(1000);
  for (let k = 0; k < 9000; k++) {
    const v = 110 + rand() * 120;
    g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
    g.fillRect(rand() * S, rand() * S, 1 + rand() * 2, 1 + rand() * 2);
  }
  
  const t = makeTex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}


function texRoof() {
  const S = 256, [c, g] = canvas2d(S);
  const n = noise2(S, 5, 1100, 0.6, 8);
  const rand = rng(1101);
  paintPixels(g, S, (i, x, y, px) => {
    const v = 96 + n[i] * 40 + (rand() - 0.5) * 30;
    px[0] = v; px[1] = v * 0.98; px[2] = v * 0.95;
  });
  return makeTex(c);
}


function texConcrete(base) {
  const S = 256, [c, g] = canvas2d(S);
  const n = noise2(S, 5, 1200 + base, 0.55, 4);
  paintPixels(g, S, (i, x, y, px) => {
    const v = base + n[i] * 40;
    px[0] = v; px[1] = v * 0.99; px[2] = v * 0.96;
  });
  const rand = rng(1201);
  for (let k = 0; k < 60; k++) {                 
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath(); g.arc(rand() * S, rand() * S, 0.6 + rand(), 0, TAU); g.fill();
  }
  return makeTex(c);
}


function texWood(r, gr, b) {
  const S = 256, [c, g] = canvas2d(S);
  const n = noise2(S, 4, 1300 + r, 0.5, 4);
  paintPixels(g, S, (i, x, y, px) => {
    const grain = Math.sin(y * 0.42 + n[i] * 12) * 0.5 + 0.5;
    const v = 0.78 + grain * 0.16 + (n[i] - 0.5) * 0.2;
    px[0] = r * v; px[1] = gr * v; px[2] = b * v;
  });
  g.fillStyle = 'rgba(40,20,5,.35)';
  for (let y = 0; y < S; y += S / 4) g.fillRect(0, y, S, 2);    
  return makeTex(c);
}


function texPaint(hex) {
  const S = 128, [c, g] = canvas2d(S);
  g.fillStyle = hex; g.fillRect(0, 0, S, S);
  grime(g, S, noise2(S, 4, hex.length * 97 + parseInt(hex.slice(1), 16) % 997, 0.5, 4), 18);
  const rand = rng(1400);
  g.strokeStyle = 'rgba(255,255,255,.18)';
  for (let k = 0; k < 14; k++) {                  // scuffs from little shoes
    g.lineWidth = 0.6 + rand();
    const x = rand() * S, y = rand() * S;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 20, y + (rand() - 0.5) * 6); g.stroke();
  }
  return makeTex(c);
}


function texMetal(base) {
  const S = 256, [c, g] = canvas2d(S);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  const rand = rng(1500);
  for (let k = 0; k < 240; k++) {
    const x = rand() * S;
    g.strokeStyle = `rgba(255,255,255,${0.02 + rand() * 0.06})`;
    g.lineWidth = 0.5 + rand() * 1.5;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rand() - 0.5) * 4, S); g.stroke();
  }
  grime(g, S, noise2(S, 4, 1501, 0.5, 4), 20);
  return makeTex(c);
}


function texVent() {
  const S = 128, [c, g] = canvas2d(S);
  g.fillStyle = '#a9afb4'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#50565c';
  for (let y = 10; y < S - 10; y += 8) g.fillRect(10, y, S - 20, 4);
  g.strokeStyle = '#7d848a'; g.lineWidth = 4; g.strokeRect(4, 4, S - 8, S - 8);
  return makeTex(c);
}


function texSolar() {
  const S = 256, [c, g] = canvas2d(S);
  g.fillStyle = '#c9ced3'; g.fillRect(0, 0, S, S);
  const cols = 6, rows = 4, pad = 6;
  const cw = (S - pad * 2) / cols, ch = (S - pad * 2) / rows;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const grd = g.createLinearGradient(0, pad + y * ch, 0, pad + (y + 1) * ch);
    grd.addColorStop(0, '#2d4f86'); grd.addColorStop(1, '#16284a');
    g.fillStyle = grd;
    g.fillRect(pad + x * cw + 1.5, pad + y * ch + 1.5, cw - 3, ch - 3);
    g.fillStyle = 'rgba(210,220,240,.25)';
    g.fillRect(pad + x * cw + cw / 2, pad + y * ch + 1.5, 1, ch - 3);
  }
  return makeTex(c);
}


function texBark() {
  const S = 256, [c, g] = canvas2d(S);
  const n = noise2(S, 5, 1600, 0.6, 4);
  paintPixels(g, S, (i, x, y, px) => {
    const ridge = Math.abs(Math.sin(x * 0.16 + n[i] * 8));
    const v = 44 + ridge * 38 + n[i] * 30;
    px[0] = v * 1.12; px[1] = v * 0.92; px[2] = v * 0.72;
  });
  return makeTex(c, 2, 2);
}
function texLeaf() {
  const S = 256, [c, g] = canvas2d(S);
  g.fillStyle = '#2d5424'; g.fillRect(0, 0, S, S);
  const rand = rng(1700);
  for (let k = 0; k < 2400; k++) {
    const t = rand();
    g.fillStyle = `rgba(${40 + t * 60 | 0},${82 + t * 80 | 0},${28 + t * 34 | 0},.7)`;
    g.beginPath(); g.ellipse(rand() * S, rand() * S, 2 + rand() * 5, 1.4 + rand() * 3, rand() * TAU, 0, TAU); g.fill();
  }
  return makeTex(c);
}


function texDoor() {
  const [c, g] = canvas2d(256, 256);
  g.fillStyle = '#3b3f45'; g.fillRect(0, 0, 256, 256);
  const pane = (x, y, w, h) => {
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, '#6d8699'); grd.addColorStop(1, '#1d2833');
    g.fillStyle = grd; g.fillRect(x, y, w, h);
  };
  pane(14, 14, 110, 228); pane(132, 14, 110, 228);
  g.fillStyle = '#c9ced3';
  g.fillRect(108, 110, 8, 60); g.fillRect(140, 110, 8, 60);    
  g.fillStyle = 'rgba(255,255,255,.75)';
  g.font = 'bold 12px ui-sans-serif, sans-serif'; g.textAlign = 'center';
  g.fillText('PUSH', 69, 100); g.fillText('PUSH', 187, 100);
  return makeTex(c);
}


function texPlaque(text) {
  const [c, g] = canvas2d(1024, 96);
  g.fillStyle = '#20252c'; g.fillRect(0, 0, 1024, 96);
  g.fillStyle = '#f2ede4';
  g.font = '600 50px ui-sans-serif, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 50);
  g.fillStyle = '#e58a5c'; g.fillRect(0, 88, 1024, 8);
  return makeTex(c);
}


function texFlag() {
  const W = 500, H = 300, [c, g] = canvas2d(W, H);
  g.fillStyle = '#006a4e'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f42a41';
  g.beginPath(); g.arc(W * 0.45, H / 2, W / 5, 0, TAU); g.fill();
  const t = makeTex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}


function texCarousel() {
  const S = 512, [c, g] = canvas2d(S);
  const cols = ['#e2553d', '#f2b441', '#3f9fd6', '#6cbf5a', '#9a6bd0', '#f07aa6'];
  for (let k = 0; k < 6; k++) {
    g.fillStyle = cols[k];
    g.beginPath(); g.moveTo(S / 2, S / 2);
    g.arc(S / 2, S / 2, S / 2, k / 6 * TAU, (k + 1) / 6 * TAU); g.fill();
  }
  g.strokeStyle = '#f6f1e6'; g.lineWidth = 10;
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 8, 0, TAU); g.stroke();
  g.fillStyle = '#e8e3da'; g.beginPath(); g.arc(S / 2, S / 2, 42, 0, TAU); g.fill();
  grime(g, S, noise2(S, 4, 1800, 0.5, 4), 16);
  return makeTex(c);
}


function texGlow() {
  const S = 128, [c, g] = canvas2d(S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.22, 'rgba(255,236,200,.6)');
  grd.addColorStop(0.55, 'rgba(255,220,170,.14)');
  grd.addColorStop(1, 'rgba(255,210,150,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  const t = makeTex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}


function texTuft() {
  const S = 128, [c, g] = canvas2d(S);
  const rand = rng(1900);
  for (let k = 0; k < 24; k++) {
    const x = 10 + rand() * (S - 20), h = 40 + rand() * 70, lean = (rand() - 0.5) * 30, t = rand();
    g.strokeStyle = `rgb(${46 + t * 40 | 0},${84 + t * 60 | 0},${30 + t * 30 | 0})`;
    g.lineWidth = 2 + rand() * 2.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, S);
    g.quadraticCurveTo(x + lean * 0.4, S - h * 0.55, x + lean, S - h); g.stroke();
  }
  const t = makeTex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export {
  BAY, SKINS, TEX, WIN, canvas2d, makeTex, texArchSign, texRedPaving, texTerracotta,
  texBark, texCarousel, texConcrete, texDirt, texDoor, texFlag, texGlow, texGrass, texLeaf,
  texMetal, texPaint, texPaving, texPlaque, texRoof, texRubber, texSand, texSolar, texTuft, texVent,
  texWindowMask, texWood
};



