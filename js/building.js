import * as THREE from 'three';
import { TAU, smoothstep } from './helpers.js';
import { BAY, SKINS, TEX } from './textures.js';
import { makeFacadeMaterial } from './shaders.js';
import { scene } from './renderer.js';
import { rod, shadowed, tag } from './world.js';

/* ----------------------------------------------------------------------------
   THE AUST CAMPUS, Tejgaon — built from street, drone, courtyard and
   satellite photographs.

   The campus is a ring of eight storey wings round a courtyard. The front,
   facing the street (+z), is the entrance:
     · a terracotta tower with AUST near the top,
     · beside it a glass block whose floor slabs stand proud of the glazing,
     · a lower white block set back in the middle, reached by a wide flight
       of stairs under a flat pergola that carries the bilingual name board,
     · on the right a big white block with square windows, its lower two
       floors cut away over columns, a louvred band under the roof and red
       brick panels,
     · and along the street a wall of concrete panels with a round opening
       holding a red disc.
   Inside, the courtyard walls are open corridors with white columns and
   parapets in front of brick, and stacked curved terraces fill one corner.

   Site plan (metres):
     tower          x -21 … -15,  z  -4 …   4
     glass block    x -15 …  -6,  z  -6 …   3
     centre block   x  -6 …   8,  z -12 …  -4     court in front, 3 m up
     right block    x   8 …  28,  z -12 …   6
     west wing      x -32 … -20,  z -70 …  -4
     east wing      x  22 …  34,  z -70 … -12
     back wing      x -20 …  22,  z -70 … -58
     courtyard      x -20 …  22,  z -58 … -12
     stairs         x  -4 …   6,  z   4 … 13.6
   ---------------------------------------------------------------------------- */
const STOREY = BAY.h;
const RING = 8;                          // storeys in the ring of wings
const TOWER_TOP = 9.5 * STOREY;          // the tower stands above everything
const COURT_Y = 3.0;

let building;
const facadeMats = {};                   // one facade shader per window layout
let trimMat, roofMat, whiteMat;
const roofFans = [];
let beaconMat, boardMat, towerGlassMat;
let seedCounter = 1;

/* the texture change the brief asks for */
const facade = {
  index: 0,           // colour scheme on the building now
  next: 0,            // scheme being wiped in
  busy: false,
  t: 0,
  dur: 3.4,           // seconds for the wipe to climb the building
  auto: true,         // change on a timer
  timer: 0,
  interval: 12        // seconds between automatic changes
};

/* ============================================================================
   WALL BUILDERS — a footprint is a list of runs; a run is a list of [x, z]
   points along which a wall is swept. Texture coordinates count bays along
   the wall and storeys up it, so one tile of a skin is one bay of a storey.
   ========================================================================== */
function arcPts(cx, cz, r, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}

/* tangent, outward normal and running length at every point of a run */
function frameRun(run, centroid) {
  const n = run.length, s = [0], nx = [], nz = [];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
  for (let i = 0; i < n; i++) {
    const a = run[Math.max(0, i - 1)], b = run[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    nx.push(tz); nz.push(-tx);
  }
  const m = Math.max(1, Math.floor(n / 2));
  const mx = (run[m - 1][0] + run[m][0]) / 2, mz = (run[m - 1][1] + run[m][1]) / 2;
  if (nx[m] * (mx - centroid[0]) + nz[m] * (mz - centroid[1]) < 0) {
    for (let i = 0; i < n; i++) { nx[i] = -nx[i]; nz[i] = -nz[i]; }
  }
  return { s, nx, nz, len: s[n - 1] };
}

/* a wall swept along a run, drawn by the facade shader of its layout */
function wallAlong(run, centroid, y0, floors, name, layout) {
  const f = frameRun(run, centroid);
  const bays = Math.max(1, Math.round(f.len / BAY.w));
  const H = floors * STOREY;
  const pos = [], nor = [], uv = [], seed = [], idx = [];
  const sd = seedCounter++;
  for (let i = 0; i < run.length; i++) {
    const u = f.s[i] / f.len * bays;
    for (const k of [0, 1]) {
      pos.push(run[i][0], y0 + k * H, run[i][1]);
      nor.push(f.nx[i], 0, f.nz[i]);
      uv.push(u, k * floors);
      seed.push(sd);
    }
  }
  /* wind the triangles so their front faces point along the outward normal */
  const tx = run[1][0] - run[0][0], tz = run[1][1] - run[0][1];
  const flip = (-tz * f.nx[0] + tx * f.nz[0]) < 0;
  for (let i = 0; i < run.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, facadeMats[layout]);
  m.castShadow = true;
  m.receiveShadow = false;
  m.userData.part = name + ' (facade shader)';
  return m;
}

function strip(A, B) {
  const pos = [], idx = [];
  for (let i = 0; i < A.length; i++) pos.push(...A[i], ...B[i]);
  for (let i = 0; i < A.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/* a slab edge standing proud of the wall: outer face, top and underside */
function bandAlong(run, centroid, y, h, out, mat, name) {
  const f = frameRun(run, centroid);
  const inner = [], outer = [];
  for (let i = 0; i < run.length; i++) {
    inner.push([run[i][0] - f.nx[i] * 0.05, run[i][1] - f.nz[i] * 0.05]);
    outer.push([run[i][0] + f.nx[i] * out, run[i][1] + f.nz[i] * out]);
  }
  const at = (list, yy) => list.map(p => [p[0], yy, p[1]]);
  const g = new THREE.Group();
  for (const geo of [strip(at(outer, y), at(outer, y + h)), strip(at(inner, y + h), at(outer, y + h)), strip(at(inner, y), at(outer, y))]) {
    geo.computeVertexNormals();
    g.add(shadowed(new THREE.Mesh(geo, mat)));
  }
  return tag(g, name || 'Floor slab edge');
}

function roofCap(outline, y) {
  const shape = new THREE.Shape(outline.map(p => new THREE.Vector2(p[0], -p[1])));
  const g = new THREE.ShapeGeometry(shape, 8);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);
  const m = new THREE.Mesh(g, roofMat);
  m.position.y = y;
  m.receiveShadow = true;
  m.userData.part = 'Roof';
  return m;
}

/* box whose uv are in metres / scale on every face, so textures keep their size */
function box(w, h, d, mat, scale) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, k = scale || 4;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0] / k, uv.getY(i) * dims[f][1] / k);
  }
  return shadowed(new THREE.Mesh(g, mat));
}

/* a plane with its own texture laid on a wall, a few centimetres proud */
function panel(w, h, mat, x, y, z, ry, name) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry || 0;
  m.receiveShadow = true;
  m.userData.part = name;
  return m;
}

/* the four walls of a rectangle, named by the way they face */
function rectRuns(x0, z0, x1, z1) {
  return {
    front: [[x0, z1], [x1, z1]],
    back: [[x1, z0], [x0, z0]],
    east: [[x1, z1], [x1, z0]],
    west: [[x0, z0], [x0, z1]]
  };
}

/* a rectangular block: a layout per face (or none for a hidden face),
   slab edges on ribbon faces, a parapet all round and a roof */
function block(spec) {
  const g = new THREE.Group();
  const { x0, x1, z0, z1, floors } = spec;
  const c = [(x0 + x1) / 2, (z0 + z1) / 2];
  const runs = rectRuns(x0, z0, x1, z1);
  const H = floors * STOREY;
  for (const k of ['front', 'back', 'east', 'west']) {
    const layout = spec.faces[k];
    if (layout) {
      g.add(wallAlong(runs[k], c, 0, floors, spec.name, layout));
      if (layout === 'ribbon') {
        for (let f = 1; f < floors; f++) g.add(bandAlong(runs[k], c, f * STOREY - 0.12, 0.34, spec.band || 0.5, trimMat));
      }
    }
    g.add(bandAlong(runs[k], c, H - 0.1, 1.1, 0.3, trimMat, 'Parapet'));
  }
  g.add(roofCap([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], H + 0.2));
  return g;
}

/* ============================================================================
   THE PARTS OF THE CAMPUS
   ========================================================================== */
function buildTower(g) {
  const terracotta = new THREE.MeshStandardMaterial({ map: TEX.terracotta, roughness: 0.8 });
  const t = box(6, TOWER_TOP, 8, terracotta, 4);
  t.position.set(-18, TOWER_TOP / 2, 0);
  t.userData.part = 'Terracotta tower';
  g.add(t);
  const cap = box(6.3, 0.4, 8.3, whiteMat);
  cap.position.set(-18, TOWER_TOP + 0.2, 0);
  g.add(cap);

  /* AUST in white letters near the top, on the front and on the side */
  const letters = new THREE.MeshStandardMaterial({ map: TEX.lettering, transparent: true, roughness: 0.4 });
  g.add(panel(5.2, 1.6, letters, -18, TOWER_TOP - 3.2, 4.03, 0, 'AUST lettering'));
  g.add(panel(5.2, 1.6, letters, -21.03, TOWER_TOP - 3.2, 0, -Math.PI / 2, 'AUST lettering'));

  /* a few tall slit windows down the side */
  towerGlassMat = new THREE.MeshStandardMaterial({ color: 0x5f8792, roughness: 0.18, metalness: 0.3, emissive: 0xffcf8f, emissiveIntensity: 0 });
  for (let k = 0; k < 8; k++) g.add(panel(0.7, 2.2, towerGlassMat, -21.02, k * STOREY + 1.8, 2.3, -Math.PI / 2, 'Tower window'));
  /* the doorway at the foot */
  g.add(panel(2.4, 2.8, new THREE.MeshStandardMaterial({ map: TEX.door, roughness: 0.3 }), -18, 1.4, 4.02, 0, 'Tower door'));
}

function buildGlassBlock(g) {
  g.add(block({ name: 'Glass block', x0: -15, x1: -6, z0: -6, z1: 3, floors: RING, band: 0.8,
    faces: { front: 'ribbon', east: 'ribbon', back: 'ribbon', west: null } }));
}

function buildCentreBlock(g) {
  g.add(block({ name: 'Centre block', x0: -6, x1: 8, z0: -12, z1: -4, floors: 4, band: 0.4,
    faces: { front: 'ribbon', back: 'gallery', east: null, west: 'punched' } }));

  /* the raised court between the blocks, with the planted roof garden on the
     centre block's lip, as in the drone photograph */
  const granite = new THREE.MeshStandardMaterial({ map: TEX.concreteLight, color: 0xdcd8d0, roughness: 0.7 });
  const court = box(14, COURT_Y, 8, granite, 3);
  court.position.set(1, COURT_Y / 2, 0);
  court.userData.part = 'Raised court';
  g.add(court);
  const leaf = new THREE.MeshStandardMaterial({ map: TEX.leaf, roughness: 0.9 });
  const garden = box(13.6, 0.7, 1.4, leaf, 1.5);
  garden.position.set(1, 4 * STOREY + 0.55, -4.6);
  garden.userData.part = 'Roof garden';
  g.add(garden);
}

function buildRightBlock(g) {
  const x0 = 8, x1 = 28, z0 = -12, z1 = 6, cut = 18, lift = 2 * STOREY;
  const c = [18, -3];
  /* upper floors come all the way forward; the lower two are cut away at
     the corner nearest the stairs and stand on columns */
  g.add(wallAlong([[cut, z1], [x1, z1]], c, 0, RING, 'Right block', 'punched'));
  g.add(wallAlong([[x0, z1], [cut, z1]], c, lift, RING - 2, 'Right block', 'punched'));
  g.add(wallAlong([[x0, z0], [x0, 0]], c, 0, RING, 'Right block', 'punched'));
  g.add(wallAlong([[x0, 0], [x0, z1]], c, lift, RING - 2, 'Right block', 'punched'));
  g.add(wallAlong([[x1, z1], [x1, z0]], c, 0, RING, 'Right block', 'punched'));
  g.add(wallAlong([[x1, z0], [x0, z0]], c, 0, RING, 'Right block', 'gallery'));
  /* glazed walls of the space under the overhang */
  g.add(wallAlong([[x0, 0], [cut, 0]], c, 0, 2, 'Right block, ground floor', 'ribbon'));
  g.add(wallAlong([[cut, 0], [cut, z1]], [cut + 6, 3], 0, 2, 'Right block, ground floor', 'ribbon'));
  const soffit = new THREE.Mesh(new THREE.PlaneGeometry(cut - x0, z1), whiteMat);
  soffit.rotation.x = Math.PI / 2;
  soffit.position.set((x0 + cut) / 2, lift, z1 / 2);
  soffit.userData.part = 'Overhang';
  g.add(soffit);
  for (const x of [8.6, 13.3, 17.6]) {
    const col = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, lift, 18), whiteMat));
    col.position.set(x, lift / 2, 5.4);
    col.userData.part = 'Column';
    g.add(col);
  }
  const runs = rectRuns(x0, z0, x1, z1);
  for (const k in runs) g.add(bandAlong(runs[k], c, RING * STOREY - 0.1, 1.1, 0.3, trimMat, 'Parapet'));
  g.add(roofCap([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], RING * STOREY + 0.2));

  /* the details that make it this building */
  const brick = new THREE.MeshStandardMaterial({ map: TEX.terracotta, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x5c7f8a, roughness: 0.15, metalness: 0.3 });
  const louver = new THREE.MeshStandardMaterial({ map: TEX.louver, roughness: 0.45, metalness: 0.2 });
  g.add(panel(4.2, 2 * STOREY, brick, 20.6, lift + STOREY, z1 + 0.04, 0, 'Brick panel'));
  g.add(panel(4.2, 2 * STOREY - 0.6, glass, 14.4, lift + STOREY, z1 + 0.04, 0, 'Tall window'));
  g.add(panel(5.4, 3.0, brick, 25, 1.5, z1 + 0.04, 0, 'Brick base'));
  g.add(panel(4.5, 2 * STOREY, brick, x0 - 0.04, lift + STOREY, 2.8, -Math.PI / 2, 'Brick panel'));
  g.add(panel(14, 2.2, louver, 18, (RING - 1) * STOREY + 1.6, z1 + 0.05, 0, 'Louvred window band'));
}

function buildWings(g) {
  g.add(block({ name: 'West wing', x0: -32, x1: -20, z0: -70, z1: -4, floors: RING,
    faces: { west: 'punched', east: 'gallery', back: 'punched', front: 'punched' } }));
  g.add(block({ name: 'East wing', x0: 22, x1: 34, z0: -70, z1: -12, floors: RING,
    faces: { east: 'punched', west: 'gallery', back: 'punched', front: 'punched' } }));
  g.add(block({ name: 'Back wing', x0: -20, x1: 22, z0: -70, z1: -58, floors: RING,
    faces: { front: 'gallery', back: 'punched', east: null, west: null } }));
}

function buildStairs(g) {
  const steps = 12, rise = COURT_Y / steps, tread = 0.8, run = steps * tread;
  const stepMat = new THREE.MeshStandardMaterial({ map: TEX.concreteLight, color: 0xe4e1da, roughness: 0.65 });
  for (let i = 0; i < steps; i++) {
    const h = COURT_Y - i * rise;
    const s = box(10, h, tread, stepMat, 3);
    s.position.set(1, h / 2, 4 + i * tread + tread / 2);
    s.userData.part = 'Stairs';
    g.add(s);
  }
  /* sloping beds either side, planted */
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(run, 0); shape.lineTo(run, 0.6); shape.lineTo(0, COURT_Y + 0.5); shape.closePath();
  const pGeo = new THREE.ExtrudeGeometry(shape, { depth: 2, bevelEnabled: false });
  pGeo.rotateY(-Math.PI / 2);
  const uv = pGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
  const pMat = new THREE.MeshStandardMaterial({ map: TEX.terracotta, roughness: 0.8 });
  const leaf = new THREE.MeshStandardMaterial({ map: TEX.leaf, roughness: 0.9 });
  const bush = new THREE.IcosahedronGeometry(0.8, 1);
  const steel = new THREE.MeshStandardMaterial({ map: TEX.metalLight, roughness: 0.35 });
  for (const x of [-4, 8]) {
    const p = shadowed(new THREE.Mesh(pGeo, pMat));
    p.position.set(x, 0, 4);
    p.userData.part = 'Planter';
    g.add(p);
    for (let k = 0; k < 6; k++) {
      const z = 4.8 + k * 1.6, y = (COURT_Y + 0.5) - (COURT_Y - 0.1) * (z - 4) / run;
      const b = shadowed(new THREE.Mesh(bush, leaf));
      b.position.set(x - 1, y + 0.4, z);
      b.scale.set(1, 0.75 + (k % 3) * 0.2, 1.1);
      b.userData.part = 'Shrub';
      g.add(b);
    }
    const xi = x < 0 ? -3.95 : 5.95;
    const top = new THREE.Vector3(xi, COURT_Y + 0.9, 4), bottom = new THREE.Vector3(xi, 0.9, 4 + run);
    g.add(rod(top, bottom, 0.035, steel, 8));
    for (let k = 0; k <= 4; k++) {
      const p = top.clone().lerp(bottom, k / 4);
      g.add(rod(p, p.clone().setY(p.y - 0.9), 0.025, steel, 6));
    }
  }
}

/* ---------------------------------------------------------------------------
   THE PERGOLA — a flat frame over the top of the stairs, from the glass
   block to the right block. A deep front beam carries the name board; behind
   it beams criss-cross back to the centre block, and creepers hang from it.
   --------------------------------------------------------------------------- */
function buildPergola(g) {
  const y = 7.4, zF = 5.2, zB = -4, xL = -6, xR = 8;
  const front = box(xR - xL, 0.7, 0.6, whiteMat);
  front.position.set((xL + xR) / 2, y, zF);
  front.userData.part = 'Pergola';
  g.add(front);
  const back = box(xR - xL, 0.4, 0.4, whiteMat);
  back.position.set((xL + xR) / 2, y, zB);
  g.add(back);

  /* beams criss-crossing from the front beam back to the centre block */
  const beam = (a, b) => {
    const r = rod(a, b, 0.14, whiteMat, 4);
    r.userData.part = 'Pergola';
    g.add(r);
  };
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const x = xL + 0.6 + (xR - xL - 1.2) * i / n;
    beam(new THREE.Vector3(x, y, zF), new THREE.Vector3(x, y, zB));
    if (i < n) {
      const x2 = xL + 0.6 + (xR - xL - 1.2) * (i + 1) / n;
      if (i % 2) beam(new THREE.Vector3(x, y - 0.1, zF), new THREE.Vector3(x2, y - 0.1, (zF + zB) / 2));
      else beam(new THREE.Vector3(x2, y - 0.1, zF), new THREE.Vector3(x, y - 0.1, (zF + zB) / 2));
    }
  }
  for (const z of [2.5, -0.5]) beam(new THREE.Vector3(xL, y + 0.1, z), new THREE.Vector3(xR, y + 0.1, z));

  /* the name board stands on the front beam */
  boardMat = new THREE.MeshStandardMaterial({ map: TEX.nameBoard, roughness: 0.5, emissive: 0xffffff, emissiveMap: TEX.nameBoard, emissiveIntensity: 0 });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(12.4, 1.8), boardMat);
  board.position.set((xL + xR) / 2, y + 1.3, zF + 0.32);
  board.userData.part = 'Name board';
  g.add(board);
  const boardBack = box(12.6, 2.0, 0.2, whiteMat);
  boardBack.position.set((xL + xR) / 2, y + 1.3, zF + 0.2);
  g.add(boardBack);

  /* creepers hanging from the ends of the pergola */
  const leaf = new THREE.MeshStandardMaterial({ map: TEX.leaf, roughness: 0.9 });
  for (const [x, s] of [[-5.3, 1], [7.3, 0.8]]) {
    const cr = shadowed(new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), leaf));
    cr.scale.set(0.9, 3.2 * s, 0.8);
    cr.position.set(x, y - 2.6 * s, zF + 0.4);
    cr.userData.part = 'Creeper';
    g.add(cr);
  }
}

/* ---------------------------------------------------------------------------
   CURVED TERRACES in the courtyard corner — four quarter-round decks, each
   smaller than the one below, with white curved parapets
   --------------------------------------------------------------------------- */
function buildTerraces(g) {
  const cx = -20, cz = -6;
  const deckMat = new THREE.MeshStandardMaterial({ map: TEX.redPaving, roughness: 0.85, side: THREE.DoubleSide });
  for (let k = 0; k < 4; k++) {
    const R = 10 - k * 1.8, y = (k + 1) * STOREY;
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.absarc(0, 0, R, 0, Math.PI / 2, false);
    s.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false, curveSegments: 32 });
    geo.rotateX(Math.PI / 2);                 // shape (x, y) → (x, -, y); y becomes +z
    geo.scale(1, 1, -1);                      // open toward -z, into the courtyard
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);
    const deck = new THREE.Mesh(geo, deckMat);
    deck.position.set(cx, y, cz);
    deck.receiveShadow = true; deck.castShadow = true;
    deck.userData.part = 'Curved terrace';
    g.add(deck);
    const edge = arcPts(cx, cz, R, 0, -Math.PI / 2, 32);
    g.add(bandAlong(edge, [cx, cz], y - 0.35, 1.45, 0.15, trimMat, 'Curved terrace'));
    /* the wall under each deck, set back from its edge */
    g.add(wallAlong(arcPts(cx, cz, R - 1.4, 0, -Math.PI / 2, 32), [cx, cz], y - STOREY, 1, 'Terrace', 'ribbon'));
  }
}

/* ---------------------------------------------------------------------------
   THE STREET WALL — precast panels with the round opening and the red disc
   --------------------------------------------------------------------------- */
function buildGateWall(g) {
  const tex = TEX.concretePanel;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  const H = 3.4, T = 0.45, z = 16.0;
  const segment = (xa, xb, hole) => {
    const s = new THREE.Shape();
    s.moveTo(xa, 0); s.lineTo(xb, 0); s.lineTo(xb, H); s.lineTo(xa, H); s.closePath();
    if (hole) {
      const h = new THREE.Path();
      h.absarc(hole.x, hole.y, hole.r, 0, TAU, true);
      s.holes.push(h);
    }
    const geo = new THREE.ExtrudeGeometry(s, { depth: T, bevelEnabled: false, curveSegments: 40 });
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.7, uv.getY(i) / 1.7);
    const m = shadowed(new THREE.Mesh(geo, mat));
    m.position.z = z - T / 2;
    m.userData.part = 'Boundary wall';
    g.add(m);
  };
  segment(-16, -3, null);
  segment(3, 18, { x: 9, y: 1.75, r: 1.45 });
  const disc = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.12, 48),
    new THREE.MeshStandardMaterial({ color: 0xd8262f, roughness: 0.45 })));
  disc.rotation.x = Math.PI / 2;
  disc.position.set(9, 1.75, z);
  disc.userData.part = 'Red disc in the wall';
  g.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.08, 10, 60), new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.5 }));
  ring.position.set(9, 1.75, z + T / 2);
  g.add(ring);
}

function buildRoofPlant(g) {
  const y = RING * STOREY + 0.2;
  const concrete = new THREE.MeshStandardMaterial({ map: TEX.concrete, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ map: TEX.metalLight, roughness: 0.4 });

  const stair = box(4, 3, 4, concrete, 3);
  stair.position.set(12, y + 1.5, -7);
  stair.userData.part = 'Stair house';
  g.add(stair);

  const tank = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.2, 28),
    new THREE.MeshStandardMaterial({ map: TEX.paintWhite, roughness: 0.5 })));
  tank.position.set(24, y + 1.3 + 1.1, -7);
  tank.userData.part = 'Water tank';
  g.add(tank);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(rod(new THREE.Vector3(24 + dx * 0.9, y, -7 + dz * 0.9), new THREE.Vector3(24 + dx * 0.9, y + 1.32, -7 + dz * 0.9), 0.08, metal));
  }

  const ventMat = new THREE.MeshStandardMaterial({ map: TEX.vent, roughness: 0.5 });
  for (let i = 0; i < 3; i++) {
    const x = 15 + i * 2.6;
    const b = box(2.1, 1.1, 1.6, ventMat, 2.1);
    b.position.set(x, y + 0.55, -1);
    b.userData.part = 'Air handler';
    const fan = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.02, 0.14), metal);
      blade.position.x = 0.27; blade.rotation.x = 0.35;
      const arm = new THREE.Group(); arm.rotation.y = k * Math.PI / 2; arm.add(blade);
      fan.add(arm);
    }
    fan.position.set(x, y + 1.15, -1);
    tag(fan, 'Fan (animated)');
    roofFans.push(fan);
    g.add(b, fan);
  }

  const mast = new THREE.Vector3(26, y, 3);
  g.add(rod(mast, mast.clone().setY(y + 7), 0.07, metal));
  beaconMat = new THREE.MeshStandardMaterial({ color: 0x551111, emissive: 0xff2a1a, emissiveIntensity: 2 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), beaconMat);
  beacon.position.copy(mast).setY(y + 7.1);
  beacon.userData.part = 'Aircraft beacon';
  g.add(beacon);

  /* solar panels on the back wing, as on the satellite view */
  const solarMat = new THREE.MeshStandardMaterial({ map: TEX.solar, roughness: 0.25 });
  for (let r = 0; r < 2; r++) for (let c = 0; c < 8; c++) {
    const p = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 1.5), solarMat));
    p.position.set(-14 + c * 4.4, y + 0.55, -66.5 + r * 3.4);
    p.rotation.x = -0.45;
    p.userData.part = 'Solar panel';
    g.add(p);
  }
}

/* a lawn with trees in the middle of the courtyard */
function buildCourtyard(g) {
  const grass = TEX.grass.clone();
  grass.repeat.set(6, 5); grass.needsUpdate = true;
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(24, 20), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(3, 0.05, -38);
  lawn.receiveShadow = true;
  lawn.userData.part = 'Courtyard lawn';
  g.add(lawn);
}

function buildBuilding() {
  for (const layout of ['ribbon', 'punched', 'gallery']) {
    facadeMats[layout] = makeFacadeMaterial(TEX.skins[layout][0], TEX.masks[layout], TOWER_TOP);
  }
  trimMat = new THREE.MeshStandardMaterial({ map: TEX.concreteLight, color: SKINS[0].trim, roughness: 0.75, side: THREE.DoubleSide });
  roofMat = new THREE.MeshStandardMaterial({ map: TEX.roof, roughness: 0.95 });
  whiteMat = new THREE.MeshStandardMaterial({ map: TEX.concreteLight, color: 0xf4f4f0, roughness: 0.6, side: THREE.DoubleSide });

  building = new THREE.Group();
  buildTower(building);
  buildGlassBlock(building);
  buildCentreBlock(building);
  buildRightBlock(building);
  buildWings(building);
  buildStairs(building);
  buildPergola(building);
  buildTerraces(building);
  buildGateWall(building);
  buildRoofPlant(building);
  buildCourtyard(building);
  scene.add(building);
}

/* start wiping a new scheme up the campus; ignored while a wipe is running */
function requestSkin(i) {
  if (facade.busy) return false;
  const n = SKINS.length;
  i = ((i % n) + n) % n;
  if (i === facade.index) return false;
  facade.next = i;
  facade.busy = true;
  facade.t = 0;
  for (const k in facadeMats) facadeMats[k].uniforms.uSkinB.value = TEX.skins[k][i];
  return true;
}

const _ca = new THREE.Color(), _cb = new THREE.Color();
function updateFacade(dt, time) {
  for (const k in facadeMats) facadeMats[k].uniforms.uTime.value = time;
  if (facade.busy) {
    facade.t += dt;
    const p = Math.min(facade.t / facade.dur, 1);
    for (const k in facadeMats) facadeMats[k].uniforms.uMix.value = p;
    _ca.setHex(SKINS[facade.index].trim);
    _cb.setHex(SKINS[facade.next].trim);
    trimMat.color.copy(_ca).lerp(_cb, smoothstep(0.55, 0.95, p));
    if (p >= 1) {
      facade.index = facade.next;
      for (const k in facadeMats) {
        facadeMats[k].uniforms.uSkinA.value = TEX.skins[k][facade.index];
        facadeMats[k].uniforms.uMix.value = 0;
      }
      facade.busy = false;
      facade.timer = 0;
    }
  } else if (facade.auto) {
    facade.timer += dt;
    if (facade.timer >= facade.interval) requestSkin(facade.index + 1);
  }
}

function updateRoof(dt, time) {
  for (let i = 0; i < roofFans.length; i++) roofFans[i].rotation.y += dt * (9 + i * 1.7);
  const ph = time % 2.0;
  beaconMat.emissiveIntensity = (ph < 0.12 || (ph > 0.3 && ph < 0.42)) ? 6 : 0.2;
}

/* night: the shader lights the rooms and a few surfaces glow. None of these
   is a light source; they are emissive, so they light nothing around them */
function setNight(v) {
  for (const k in facadeMats) facadeMats[k].uniforms.uNight.value = v;
  boardMat.emissiveIntensity = v * 0.9;
  towerGlassMat.emissiveIntensity = v * 0.8;
}

export { COURT_Y, TOWER_TOP, buildBuilding, building, facade, requestSkin, setNight, updateFacade, updateRoof };
