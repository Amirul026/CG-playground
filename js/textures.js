import * as THREE from 'three';
import { TAU, clamp, rng } from './helpers.js';

/* every texture in the scene is painted here with the 2D canvas API at load
   time, so nothing is downloaded and nothing comes from an outside source */

const TEX = {};

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h || w;
  return [c, c.getContext('2d')];
}

/* tileable value noise: the lattice wraps round, so every texture built on it
   repeats without a seam */
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

/* run fn over every pixel; fn writes r, g, b into px */
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

/* darken or lighten what is already on the canvas with a noise field */
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

/* ============================================================================
   BUILDING SKINS
   The AUST campus uses three kinds of wall, so there are three window
   layouts:
     ribbon   continuous glass between projecting floor slabs (the glass block)
     punched  white render with one square window per bay (the outer walls)
     gallery  open corridors round the courtyard: a white column at each end
              of the bay, a solid parapet, and the brick back wall of the
              corridor with its window
   Each layout is painted in five colour schemes. One texture tile is one bay
   of a storey, 3.2 m wide and 3.4 m high. Within a layout every scheme puts
   the glass in exactly the same place, which is what lets the facade shader
   wipe from one scheme to the next and lets one mask per layout light the
   rooms at night whichever scheme is on.
   ========================================================================== */
const BAY = { w: 3.2, h: 3.4 };
const LAYOUTS = {
  ribbon: { x0: 0.035, x1: 0.965, y0: 0.30, y1: 0.88, frame: 0.022, mullion: 0.02, transom: 0.72, split: 2 },
  punched: { x0: 0.30, x1: 0.70, y0: 0.36, y1: 0.80, frame: 0.03, mullion: 0.025, transom: 0.68, split: 2 },
  gallery: { x0: 0.50, x1: 0.84, y0: 0.42, y1: 0.86, frame: 0.03, mullion: 0.03, transom: 0.70, split: 1 }
};
const SKIN_SIZE = 512;

/* the window as canvas rectangles (canvas y runs down, texture v runs up) */
function windowRects(S, L) {
  const ox = L.x0 * S, oy = (1 - L.y1) * S;
  const ow = (L.x1 - L.x0) * S, oh = (L.y1 - L.y0) * S;
  const f = L.frame * S, m = L.mullion * S;
  const ix = ox + f, iy = oy + f, iw = ow - 2 * f, ih = oh - 2 * f;
  const yT = (1 - L.transom) * S;                      // the transom bar
  const panes = [[ix, iy, iw, yT - iy - m / 2]];       // top light above the transom
  if (L.split === 2) {
    panes.push([ix, yT + m / 2, iw / 2 - m / 2, iy + ih - yT - m / 2]);
    panes.push([ix + iw / 2 + m / 2, yT + m / 2, iw / 2 - m / 2, iy + ih - yT - m / 2]);
  } else {
    panes.push([ix, yT + m / 2, iw, iy + ih - yT - m / 2]);
  }
  return { outer: [ox, oy, ow, oh], panes };
}

function drawWindow(g, S, L, frameCol, glassTop, glassBottom) {
  const r = windowRects(S, L);
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
    g.fillStyle = 'rgba(255,255,255,.08)';               // a soft diagonal reflection
    g.beginPath();
    g.moveTo(p[0] + p[2] * 0.10, p[1] + p[3]);
    g.lineTo(p[0] + p[2] * 0.45, p[1]);
    g.lineTo(p[0] + p[2] * 0.62, p[1]);
    g.lineTo(p[0] + p[2] * 0.27, p[1] + p[3]);
    g.fill();
    g.restore();
  }
}

/* mask: red = glass, green = frame. Linear data, not a colour */
function texWindowMask(layout) {
  const S = SKIN_SIZE, [c, g] = canvas2d(S);
  const r = windowRects(S, LAYOUTS[layout]);
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#00ff00'; g.fillRect(r.outer[0], r.outer[1], r.outer[2], r.outer[3]);
  g.fillStyle = '#ff0000';
  for (const p of r.panes) g.fillRect(p[0], p[1], p[2], p[3]);
  const t = makeTex(c, 1, 1, false);
  t.anisotropy = 4;
  return t;
}

/* --- the five wall finishes, each filling a whole tile --- */
function wallWhite(g, S) {
  const n = noise2(S, 5, 111, 0.55, 8);
  paintPixels(g, S, (i, x, y, px) => {
    const v = n[i] * 16;
    px[0] = 229 + v; px[1] = 229 + v; px[2] = 225 + v;
  });
  g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect(0, S - 3, S, 3);
}
function wallTerracotta(g, S) {
  g.fillStyle = '#d9cfc4'; g.fillRect(0, 0, S, S);
  const rand = rng(222), th = S / 18, tw = th * 3;
  for (let r = 0; r < 18; r++) {
    const off = (r % 2) * tw / 2;
    for (let x = -tw; x < S + tw; x += tw) {
      const t = rand();
      g.fillStyle = `rgb(${170 + t * 34 | 0},${74 + t * 20 | 0},${44 + t * 14 | 0})`;
      g.fillRect(x + off + 1.5, r * th + 1.5, tw - 3, th - 3);
    }
  }
  grime(g, S, noise2(S, 5, 223, 0.55, 8), 24);
}
function wallBlueGlass(g, S) {
  const grd = g.createLinearGradient(0, 0, S, S);
  grd.addColorStop(0, '#3d5a78'); grd.addColorStop(1, '#1f3148');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  g.fillStyle = '#b8c2cc';
  g.fillRect(0, 0, S, 5); g.fillRect(0, 0, 5, S);
  g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(0, S * 0.8, S, S * 0.08);
}
function wallSandstone(g, S) {
  const n = noise2(S, 6, 404, 0.58, 8);
  paintPixels(g, S, (i, x, y, px) => {
    const v = n[i] * 44;
    px[0] = 194 + v; px[1] = 164 + v * 0.9; px[2] = 120 + v * 0.7;
  });
  g.strokeStyle = 'rgba(92,70,40,.45)'; g.lineWidth = 3;
  for (let r = 0; r < 4; r++) {
    const y = r * S / 4;
    g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
    for (let x = (r % 2) * S / 6; x < S; x += S / 3) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + S / 4); g.stroke(); }
  }
}
function wallGranite(g, S) {
  const n = noise2(S, 6, 505, 0.6, 16);
  const rand = rng(506);
  paintPixels(g, S, (i, x, y, px) => {
    const speck = rand() > 0.93 ? 40 : 0;
    const v = 58 + n[i] * 30 + speck;
    px[0] = v; px[1] = v; px[2] = v * 1.04;
  });
}

/* brick for the back wall of the gallery corridors */
function brickRect(g, x0, y0, w, h, S) {
  g.fillStyle = '#b3a293'; g.fillRect(x0, y0, w, h);
  const rand = rng(77), bh = S / 26, bw = bh * 2.3;
  g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
  for (let r = 0; r * bh < h + bh; r++) {
    const off = (r % 2) * bw / 2;
    for (let x = x0 - bw; x < x0 + w + bw; x += bw) {
      const t = rand();
      g.fillStyle = `rgb(${138 + t * 36 | 0},${56 + t * 18 | 0},${40 + t * 12 | 0})`;
      g.fillRect(x + off + 1.5, y0 + r * bh + 1.5, bw - 3, bh - 3);
    }
  }
  g.restore();
}

const SKINS = [
  { name: 'Campus white', wall: wallWhite, frame: '#e3e6e6', glass: ['#8fb0b5', '#2a4a52'], back: 'brick', trim: 0xf2f2ee },
  { name: 'Terracotta', wall: wallTerracotta, frame: '#3b3129', glass: ['#8c9aa2', '#2a343b'], back: '#e6dccb', trim: 0xe9e2d6 },
  { name: 'Blue glass', wall: wallBlueGlass, frame: '#c3cbd3', glass: ['#7fa0c2', '#1c3350'], back: '#22354d', trim: 0xc9d1d8 },
  { name: 'Sandstone', wall: wallSandstone, frame: '#5a4630', glass: ['#8aa0ad', '#26323b'], back: '#8a6a48', trim: 0xe8dcc4 },
  { name: 'Charcoal granite', wall: wallGranite, frame: '#161616', glass: ['#b39b78', '#3a2f24'], back: '#c7b08a', trim: 0x8d8f93 }
];

/* one tile: a scheme painted in a layout */
function buildSkin(skin, layout) {
  const S = SKIN_SIZE, [c, g] = canvas2d(S);
  const L = LAYOUTS[layout];
  skin.wall(g, S);

  if (layout === 'ribbon') {
    g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(0, (1 - L.y0) * S + S * 0.03, S, 2);
  } else if (layout === 'punched') {
    const r = windowRects(S, L).outer;
    g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(r[0] - 4, r[1] - 4, r[2] + 8, r[3] + 8);   // reveal
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(r[0] - S * 0.02, r[1] + r[3], r[2] + S * 0.04, S * 0.025);  // sill
  } else {
    /* the corridor: its back wall shows between the columns, above the parapet */
    const x0 = S * 0.075, x1 = S * 0.925, top = 0, bottom = (1 - 0.36) * S;
    if (skin.back === 'brick') brickRect(g, x0, top, x1 - x0, bottom - top, S);
    else { g.fillStyle = skin.back; g.fillRect(x0, top, x1 - x0, bottom - top); }
    const shade = g.createLinearGradient(0, top, 0, bottom);         // shadow under the slab above
    shade.addColorStop(0, 'rgba(0,0,0,.45)'); shade.addColorStop(0.35, 'rgba(0,0,0,.12)'); shade.addColorStop(1, 'rgba(0,0,0,.05)');
    g.fillStyle = shade; g.fillRect(x0, top, x1 - x0, bottom - top);
    /* a door on the back wall beside the window */
    g.fillStyle = 'rgba(40,30,25,.85)'; g.fillRect(S * 0.16, (1 - 0.82) * S, S * 0.22, 0.46 * S);
    /* parapet top and the edge of the floor slab */
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x0, bottom, x1 - x0, 4);
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, bottom + 4, S, 3);
    g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, S - S * 0.1, S, 2);
    g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(x0 - 3, 0, 3, bottom); g.fillRect(x1, 0, 3, bottom);
  }
  drawWindow(g, S, L, skin.frame, skin.glass[0], skin.glass[1]);
  return makeTex(c);
}
/* --- the solid terracotta panels of the red tower --- */
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

/* --- red brick paving of the forecourt, in herringbone --- */
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

/* --- the name board over the stairs: Bengali above English, white on navy --- */
function texNameBoard(bn, en) {
  const W = 2048, H = 300, [c, g] = canvas2d(W, H);
  g.fillStyle = '#1d3763'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#e9eef5'; g.lineWidth = 8; g.strokeRect(10, 10, W - 20, H - 20);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 104px "Nirmala UI", "Noto Sans Bengali", "Vrinda", "Shonar Bangla", sans-serif';
  g.fillText(bn, W / 2, 95, W - 120);
  g.font = 'bold 96px "Segoe UI", Arial, Helvetica, sans-serif';
  g.fillText(en, W / 2, 215, W - 120);
  return makeTex(c);
}

/* --- building lettering on the tower, white on transparent --- */
function texLettering(text) {
  const [c, g] = canvas2d(512, 160);
  g.clearRect(0, 0, 512, 160);
  g.fillStyle = '#ffffff';
  g.font = 'bold 118px "Segoe UI", Arial, Helvetica, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 86);
  const t = makeTex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/* --- horizontal aluminium louvres over the top floor window band --- */
function texLouver() {
  const [c, g] = canvas2d(512, 128);
  g.fillStyle = '#6f7a80'; g.fillRect(0, 0, 512, 128);
  for (let y = 0; y < 128; y += 10) {
    const grd = g.createLinearGradient(0, y, 0, y + 10);
    grd.addColorStop(0, '#d8dde0'); grd.addColorStop(0.6, '#a9b1b6'); grd.addColorStop(1, '#5c666c');
    g.fillStyle = grd; g.fillRect(0, y, 512, 8);
  }
  g.fillStyle = '#e8ebec';
  for (let x = 0; x < 512; x += 64) g.fillRect(x, 0, 5, 128);        // mullions
  return makeTex(c);
}

/* --- precast concrete panels of the boundary wall --- */
function texConcretePanel() {
  const S = 256, [c, g] = canvas2d(S);
  const n = noise2(S, 5, 1250, 0.55, 4);
  paintPixels(g, S, (i, x, y, px) => {
    const v = 150 + n[i] * 36;
    px[0] = v; px[1] = v * 0.99; px[2] = v * 0.96;
  });
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.fillRect(0, 0, S, 3); g.fillRect(0, 0, 3, S);              // panel joints
  const rand = rng(1251);
  for (let k = 0; k < 40; k++) { g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(rand() * S, rand() * S, 2, 2); }
  return makeTex(c);
}

/* ============================================================================
   GROUND, PAVING AND PLAYGROUND SURFACES
   ========================================================================== */

/* --- square concrete pavers, each one a slightly different shade --- */
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

/* --- lawn --- */
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

/* --- bare soil, worn into the lawn by the shader --- */
function texDirt() {
  const S = 256, [c, g] = canvas2d(S);
  const n = noise2(S, 5, 800, 0.55, 4);
  paintPixels(g, S, (i, x, y, px) => {
    const v = n[i];
    px[0] = 96 + v * 60; px[1] = 76 + v * 46; px[2] = 54 + v * 32;
  });
  return makeTex(c);
}

/* --- sand for the sandpit --- */
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

/* --- poured rubber safety surface: coloured granules on a base colour --- */
function texRubber() {
  const S = 256, [c, g] = canvas2d(S);
  g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  const rand = rng(1000);
  for (let k = 0; k < 9000; k++) {
    const v = 110 + rand() * 120;
    g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
    g.fillRect(rand() * S, rand() * S, 1 + rand() * 2, 1 + rand() * 2);
  }
  /* the shader tints this grey, so every zone of the playground can share it */
  const t = makeTex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/* --- flat roof membrane with gravel ballast --- */
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

/* --- concrete for the canopy, plinth, stair house and step --- */
function texConcrete(base) {
  const S = 256, [c, g] = canvas2d(S);
  const n = noise2(S, 5, 1200 + base, 0.55, 4);
  paintPixels(g, S, (i, x, y, px) => {
    const v = base + n[i] * 40;
    px[0] = v; px[1] = v * 0.99; px[2] = v * 0.96;
  });
  const rand = rng(1201);
  for (let k = 0; k < 60; k++) {                  // little air holes
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath(); g.arc(rand() * S, rand() * S, 0.6 + rand(), 0, TAU); g.fill();
  }
  return makeTex(c);
}

/* --- timber planks for benches, the sandpit and the see-saw --- */
function texWood(r, gr, b) {
  const S = 256, [c, g] = canvas2d(S);
  const n = noise2(S, 4, 1300 + r, 0.5, 4);
  paintPixels(g, S, (i, x, y, px) => {
    const grain = Math.sin(y * 0.42 + n[i] * 12) * 0.5 + 0.5;
    const v = 0.78 + grain * 0.16 + (n[i] - 0.5) * 0.2;
    px[0] = r * v; px[1] = gr * v; px[2] = b * v;
  });
  g.fillStyle = 'rgba(40,20,5,.35)';
  for (let y = 0; y < S; y += S / 4) g.fillRect(0, y, S, 2);    // plank joints
  return makeTex(c);
}

/* --- powder coated steel for the play equipment --- */
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

/* --- galvanised steel for chains, posts and the roof plant --- */
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

/* --- louvred grille on the rooftop air handlers --- */
function texVent() {
  const S = 128, [c, g] = canvas2d(S);
  g.fillStyle = '#a9afb4'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#50565c';
  for (let y = 10; y < S - 10; y += 8) g.fillRect(10, y, S - 20, 4);
  g.strokeStyle = '#7d848a'; g.lineWidth = 4; g.strokeRect(4, 4, S - 8, S - 8);
  return makeTex(c);
}

/* --- photovoltaic panel: blue cells in an aluminium frame --- */
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

/* --- bark and leaves --- */
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

/* --- glass entrance doors in a steel frame --- */
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
  g.fillRect(108, 110, 8, 60); g.fillRect(140, 110, 8, 60);    // pull handles
  g.fillStyle = 'rgba(255,255,255,.75)';
  g.font = 'bold 12px ui-sans-serif, sans-serif'; g.textAlign = 'center';
  g.fillText('PUSH', 69, 100); g.fillText('PUSH', 187, 100);
  return makeTex(c);
}

/* --- building name board over the canopy --- */
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

/* --- the national flag of Bangladesh: a red disc on bottle green, 10 : 6,
   the disc a fifth of the length across and set a little toward the hoist --- */
function texFlag() {
  const W = 500, H = 300, [c, g] = canvas2d(W, H);
  g.fillStyle = '#006a4e'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f42a41';
  g.beginPath(); g.arc(W * 0.45, H / 2, W / 5, 0, TAU); g.fill();
  const t = makeTex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/* --- merry-go-round deck: six coloured segments --- */
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

/* --- a radial falloff for every glow sprite --- */
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

/* --- a single grass tuft cut out with alpha --- */
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
  BAY, LAYOUTS, SKINS, TEX, buildSkin, canvas2d, makeTex, texConcretePanel, texLettering, texLouver, texNameBoard, texRedPaving, texTerracotta,
  texBark, texCarousel, texConcrete, texDirt, texDoor, texFlag, texGlow, texGrass, texLeaf,
  texMetal, texPaint, texPaving, texPlaque, texRoof, texRubber, texSand, texSolar, texTuft, texVent,
  texWindowMask, texWood
};


/*

├── noise2()            tileable value noise, the base of most textures
├── windowRects()       where the glass sits in a layout
├── LAYOUTS             ribbon, punched and gallery window layouts
├── wallWhite() … wallGranite()   the five wall finishes (skins)
├── buildSkin()         one finish painted in one layout
├── texWindowMask()     glass / frame mask for one layout
├── texTerracotta()     the red tower
├── texRedPaving()      forecourt and courtyard
├── texNameBoard()      the Bengali and English name board over the stairs
├── texLettering()      AUST on the tower
├── texLouver()         louvres on the white block's top floor
├── texConcretePanel()  boundary wall
├── texPaving()         plaza and path
├── texGrass()          lawn
├── texDirt()           worn lawn
├── texSand()           sandpit
├── texRubber()         playground safety surface
├── texRoof()           roof membrane
├── texConcrete()       canopy, plinth, stair house
├── texWood()           benches, sandpit, see-saw
├── texPaint()          play equipment
├── texMetal()          chains, posts, roof plant
├── texVent()           air handler grille
├── texBark(), texLeaf()   trees
├── texDoor()           entrance doors
├── texPlaque()         playground gate sign
├── texFlag()           the flag of Bangladesh
├── texCarousel()       merry-go-round deck
├── texGlow()           light glow sprite
└── texTuft()           grass sprite

*/
