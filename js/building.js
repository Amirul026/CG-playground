import * as THREE from 'three';
import { smoothstep } from './helpers.js';
import { BAY, SKINS, TEX } from './textures.js';
import { makeFacadeMaterial } from './shaders.js';
import { scene } from './renderer.js';
import { rod, shadowed, tag } from './world.js';

const STOREY = BAY.h;
const TOWER_TOP = 8 * STOREY;          
const COURT_Y = 3.0;

let building, facadeMat;
const trimMats = [];
const roofFans = [];
let beaconMat;
let seedCounter = 1;

const facade = {
  index: 0,           
  next: 0,            
  busy: false,
  t: 0,
  dur: 3.4,           
  auto: true,         
  timer: 0,
  interval: 12        
};

function arcPts(cx, cz, r, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}
function bezierPts(p0, p1, p2, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return out;
}
function joinPts(...lists) {
  const out = [];
  for (const l of lists) for (const p of l) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-4) out.push(p);
  }
  return out;
}

function frameRun(run, centroid) {
  const n = run.length, s = [0], nx = [], nz = [];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
  for (let i = 0; i < n; i++) {
    const a = run[Math.max(0, i - 1)], b = run[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    nx.push(tz); nz.push(-tx);
  }

  const m = Math.floor(n / 2);
  const mx = (run[Math.max(0, m - 1)][0] + run[m][0]) / 2, mz = (run[Math.max(0, m - 1)][1] + run[m][1]) / 2;
  if (nx[m] * (mx - centroid[0]) + nz[m] * (mz - centroid[1]) < 0) {
    for (let i = 0; i < n; i++) { nx[i] = -nx[i]; nz[i] = -nz[i]; }
  }
  return { s, nx, nz, len: s[n - 1] };
}

function wallAlong(run, centroid, y0, floors, name) {
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
  const m = new THREE.Mesh(g, facadeMat);
  m.castShadow = true;
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

// Slab
function bandAlong(run, centroid, y, h, out, mat, name) {
  const f = frameRun(run, centroid);
  const inner = [], outer = [];
  for (let i = 0; i < run.length; i++) {
    inner.push([run[i][0] - f.nx[i] * 0.05, run[i][1] - f.nz[i] * 0.05]);
    outer.push([run[i][0] + f.nx[i] * out, run[i][1] + f.nz[i] * out]);
  }
  const at = (list, yy) => list.map(p => [p[0], yy, p[1]]);
  const g = new THREE.Group();
  for (const geo of [
    strip(at(outer, y), at(outer, y + h)),
    strip(at(inner, y + h), at(outer, y + h)),
    strip(at(inner, y), at(outer, y))
  ]) {
    geo.computeVertexNormals();
    g.add(shadowed(new THREE.Mesh(geo, mat)));
  }
  return tag(g, name || 'Floor slab edge');
}

// Roof
function roofCap(outline, y, mat) {
  const shape = new THREE.Shape(outline.map(p => new THREE.Vector2(p[0], -p[1])));
  const g = new THREE.ShapeGeometry(shape, 8);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);
  const m = new THREE.Mesh(g, mat);
  m.position.y = y;
  m.receiveShadow = true;
  m.userData.part = 'Roof';
  return m;
}

// Box
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

function trimMaterial() {
  const m = new THREE.MeshStandardMaterial({ map: TEX.concreteLight, color: SKINS[facade.index].trim, roughness: 0.75, side: THREE.DoubleSide });
  trimMats.push(m);
  return m;
}

// Block
function glazedBlock(runs, outline, centroid, floors, opts) {
  const g = new THREE.Group();
  const trim = trimMaterial();
  const H = floors * STOREY;
  for (const r of runs) {
    g.add(wallAlong(r, centroid, 0, floors, opts.name));
    for (let k = 1; k < floors; k++) g.add(bandAlong(r, centroid, k * STOREY - 0.12, 0.34, opts.band || 0.35, trim));
    g.add(bandAlong(r, centroid, H - 0.1, 1.1, opts.parapet || 0.45, trim, 'Parapet'));
  }
  g.add(roofCap(outline, H + 0.2, roofMat));
  return g;
}

let roofMat;

// Campus
function buildRedTower(g) {
  const terracotta = new THREE.MeshStandardMaterial({ map: TEX.terracotta, roughness: 0.8 });
  const slab = box(5, TOWER_TOP, 16, terracotta, 4);
  slab.position.set(-19.5, TOWER_TOP / 2, -1);
  slab.userData.part = 'Terracotta tower';
  g.add(slab);
  const cap = box(5.6, 0.5, 16.6, new THREE.MeshStandardMaterial({ map: TEX.concreteLight, color: 0xeeeeea, roughness: 0.7 }));
  cap.position.set(-19.5, TOWER_TOP + 0.25, -1);
  cap.userData.part = 'Terracotta tower';
  g.add(cap);

  // Windows
  const glass = new THREE.MeshStandardMaterial({ color: 0x5f8792, metalness: 0.35, roughness: 0.18, emissive: 0xffcf8f, emissiveIntensity: 0 });
  towerWindowMat = glass;
  for (let k = 0; k < 8; k++) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.9), glass);
    w.position.set(-20.6, k * STOREY + 1.7, 7.02);
    w.userData.part = 'Tower window';
    g.add(w);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 2.4), glass);
    s.position.set(-22.02, k * STOREY + 1.7, 3.5);
    s.rotation.y = -Math.PI / 2;
    s.userData.part = 'Tower window';
    g.add(s);
  }
}
let towerWindowMat;

function buildGlassBlock(g) {
  // Footprint
  const outline = joinPts([[-17, -8], [-8, -8], [-8, 2]], arcPts(-12, 2, 4, 0, Math.PI / 2, 16), [[-17, 6]]);
  const runs = [
    [[-17, -8], [-8, -8]],
    joinPts([[-8, -8], [-8, -3], [-8, 2]], arcPts(-12, 2, 4, 0, Math.PI / 2, 16), [[-14.5, 6], [-17, 6]])
  ];
  g.add(glazedBlock(runs, outline, [-12.5, -1], 7, { name: 'Glass block', band: 0.4, parapet: 0.6 }));
}

function buildWhiteBlock(g) {
  const curve = bezierPts([8, 2], [8.4, 7.6], [15, 7.6], 20);
  const outline = joinPts([[8, -10], [8, 2]], curve, [[24, 7.6], [24, -10]]);
  const centroid = [16, -1.5];
  const runs = [
    joinPts([[8, -10], [8, -4], [8, 2]], curve, [[19.5, 7.6], [24, 7.6]]),
    [[24, 7.6], [24, -1], [24, -10]],
    [[24, -10], [16, -10], [8, -10]]
  ];
  g.add(glazedBlock(runs, outline, centroid, 6, { name: 'Curved white block', band: 0.7, parapet: 0.8 }));

  const front = runs[0];
  const f = frameRun(front, centroid);
  const from = front.findIndex((p, i) => f.s[i] / f.len > 0.34);
  const sub = front.slice(from);
  const trim = trimMats[trimMats.length - 1];
  g.add(bandAlong(sub, centroid, STOREY - 0.2, 0.5, 2.6, trim, 'Curved canopy'));
  const fs = frameRun(sub, centroid);
  const col = new THREE.MeshStandardMaterial({ map: TEX.concreteLight, color: 0xf4f4f0, roughness: 0.6 });
  for (const t of [0.12, 0.42, 0.72, 0.97]) {
    const i = Math.round(t * (sub.length - 1));
    const x = sub[i][0] + fs.nx[i] * 2.1, z = sub[i][1] + fs.nz[i] * 2.1;
    const c = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, STOREY - 0.2, 16), col));
    c.position.set(x, (STOREY - 0.2) / 2, z);
    c.userData.part = 'Column';
    g.add(c);
  }

  // Panel
  const panel = box(5.5, 3.0, 0.4, new THREE.MeshStandardMaterial({ map: TEX.terracotta, roughness: 0.8 }), 3);
  panel.position.set(20.5, 1.5, 7.85);
  panel.userData.part = 'Terracotta panel';
  g.add(panel);
}

function buildBackBlock(g) {
  const outline = [[-8, -17], [8, -17], [8, -8], [-8, -8]];
  const runs = [[[-8, -8], [8, -8]], [[8, -8], [8, -17]], [[8, -17], [-8, -17]], [[-8, -17], [-8, -8]]];
  g.add(glazedBlock(runs, outline, [0, -12.5], 5, { name: 'Academic block', band: 0.3, parapet: 0.4 }));

  // Doors
  const doorMat = new THREE.MeshStandardMaterial({ map: TEX.door, roughness: 0.25, metalness: 0.3 });
  for (const x of [-4.8, 0, 4.8]) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.1), doorMat);
    d.position.set(x, COURT_Y + 1.55, -7.55);
    d.userData.part = 'Entrance doors';
    g.add(d);
  }
}

function buildCourtAndStairs(g) {
  const granite = new THREE.MeshStandardMaterial({ map: TEX.concreteLight, color: 0xdcd8d0, roughness: 0.7 });
  const court = box(16, COURT_Y, 14, granite, 3);
  court.position.set(0, COURT_Y / 2, -1);
  court.userData.part = 'Raised court';
  g.add(court);

  // Steps
  const steps = 12, rise = COURT_Y / steps, tread = 0.8;
  const stepMat = new THREE.MeshStandardMaterial({ map: TEX.concreteLight, color: 0xe4e1da, roughness: 0.65 });
  for (let i = 0; i < steps; i++) {
    const h = COURT_Y - i * rise;
    const s = box(14, h, tread, stepMat, 3);
    s.position.set(0, h / 2, 6 + i * tread + tread / 2);
    s.userData.part = 'Grand staircase';
    g.add(s);
  }

  // Planters
  const run = steps * tread;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(run, 0); shape.lineTo(run, 0.8); shape.lineTo(0, COURT_Y + 0.6); shape.closePath();
  const pGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false });
  pGeo.rotateY(-Math.PI / 2);
  const uv = pGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
  const pMat = new THREE.MeshStandardMaterial({ map: TEX.terracotta, roughness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ map: TEX.metalLight, metalness: 0.8, roughness: 0.3 });
  const leaf = new THREE.MeshStandardMaterial({ map: TEX.leaf, roughness: 0.9 });
  const bushGeo = new THREE.IcosahedronGeometry(0.7, 1);
  for (const x of [-7, 8.6]) {
    const p = shadowed(new THREE.Mesh(pGeo, pMat));
    p.position.set(x, 0, 6);
    p.userData.part = 'Planter';
    g.add(p);
    for (let k = 0; k < 6; k++) {
      const z = 6.6 + k * 1.6, y = (COURT_Y + 0.6) - (COURT_Y - 0.2) * (z - 6) / run;
      const b = shadowed(new THREE.Mesh(bushGeo, leaf));
      b.position.set(x - 0.8, y + 0.35, z);
      b.scale.set(1, 0.8 + (k % 3) * 0.15, 1.1);
      b.userData.part = 'Shrub';
      g.add(b);
    }
    // Rail
    const xi = x < 0 ? -6.95 : 6.95;
    const top = new THREE.Vector3(xi, COURT_Y + 0.9, 6), bottom = new THREE.Vector3(xi, 0.9, 6 + run);
    g.add(rod(top, bottom, 0.035, steel, 8));
    for (let k = 0; k <= 4; k++) {
      const p = top.clone().lerp(bottom, k / 4);
      g.add(rod(p, p.clone().setY(p.y - 0.9), 0.025, steel, 6));
    }
  }

  // Plant
  const climber = shadowed(new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), leaf));
  climber.scale.set(1.1, 3.4, 1.0);
  climber.position.set(-9.3, 3.4, 8.2);
  climber.userData.part = 'Climbing plant';
  g.add(climber);
}

// Arch
function buildArch(g) {
  const half = 8.2, spring = 7.0, crown = 12.5;
  const R = (half * half + (crown - spring) ** 2) / (2 * (crown - spring));
  const cy = crown - R;
  const a0 = Math.asin((spring - cy) / R), a1 = Math.PI - a0;
  const zFront = 9, zBack = -6, L = zFront - zBack;

  const white = new THREE.MeshStandardMaterial({ map: TEX.concreteLight, color: 0xf6f6f2, roughness: 0.55 });
  const ring = (thick, depth) => {
    const s = new THREE.Shape();
    s.absarc(0, cy, R + thick / 2, a0, a1, false);
    s.absarc(0, cy, R - thick / 2, a1, a0, true);
    return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 48 });
  };

  const front = shadowed(new THREE.Mesh(ring(1.1, 1.0), white));
  front.position.z = zFront - 0.5;
  front.userData.part = 'Entrance arch';
  g.add(front);
  for (let z = zFront - 3.2; z > zBack - 0.1; z -= 3.0) {
    const r = shadowed(new THREE.Mesh(ring(0.45, 0.35), white));
    r.position.z = z;
    r.userData.part = 'Arch rib';
    g.add(r);
  }
  const ribs = 13;
  for (let i = 0; i < ribs; i++) {
    const a = a0 + (a1 - a0) * (i + 0.5) / ribs;
    const b = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, L), white));
    b.position.set(Math.cos(a) * R, cy + Math.sin(a) * R, zBack + L / 2);
    b.rotation.z = a - Math.PI / 2;
    b.userData.part = 'Arch rib';
    g.add(b);
  }
  const skinGeo = new THREE.CylinderGeometry(R + 0.16, R + 0.16, L, 64, 1, true, a0 + Math.PI / 2, a1 - a0);
  skinGeo.rotateX(Math.PI / 2);
  const skin = new THREE.Mesh(skinGeo, new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.32, roughness: 0.3, side: THREE.DoubleSide, depthWrite: false
  }));
  skin.position.set(0, cy, zBack + L / 2);
  skin.userData.part = 'Arch canopy';
  g.add(skin);

  // Piers
  for (const x of [-half, half]) {
    const p = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, spring + 0.3, 20), white));
    p.position.set(x, (spring + 0.3) / 2, zFront);
    p.userData.part = 'Arch pier';
    g.add(p);
  }

  // Nameboard
  const board = new THREE.Group();
  const back = box(12.6, 1.3, 0.25, white, 4);
  board.add(back);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(12.4, 1.12), new THREE.MeshStandardMaterial({
    map: TEX.archSign, roughness: 0.5, emissive: 0xffffff, emissiveMap: TEX.archSign, emissiveIntensity: 0
  }));
  signFaceMat = face.material;
  face.position.z = 0.13;
  board.add(face);
  board.position.set(0, crown + 0.55 + 0.65, zFront + 0.05);
  tag(board, 'Name board');
  g.add(board);

}
let signFaceMat;

function buildRoofPlant(g) {
  const y = 6 * STOREY + 0.2;
  const concrete = new THREE.MeshStandardMaterial({ map: TEX.concrete, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ map: TEX.metalLight, metalness: 0.7, roughness: 0.4 });

  const stair = box(4, 3, 4, concrete, 3);
  stair.position.set(20.5, y + 1.5, -6);
  stair.userData.part = 'Stair house';
  g.add(stair);

  const tank = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.2, 28),
    new THREE.MeshStandardMaterial({ map: TEX.paintWhite, roughness: 0.5 })));
  tank.position.set(13, y + 1.3 + 1.1, -6);
  tank.userData.part = 'Water tank';
  g.add(tank);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(rod(new THREE.Vector3(13 + dx * 0.9, y, -6 + dz * 0.9), new THREE.Vector3(13 + dx * 0.9, y + 1.32, -6 + dz * 0.9), 0.08, metal));
  }

  const ventMat = new THREE.MeshStandardMaterial({ map: TEX.vent, metalness: 0.4, roughness: 0.5 });
  for (let i = 0; i < 3; i++) {
    const x = 12 + i * 2.6;
    const b = box(2.1, 1.1, 1.6, ventMat, 2.1);
    b.position.set(x, y + 0.55, 0.5);
    b.userData.part = 'Air handler';
    const fan = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.02, 0.14), metal);
      blade.position.x = 0.27; blade.rotation.x = 0.35;
      const arm = new THREE.Group(); arm.rotation.y = k * Math.PI / 2; arm.add(blade);
      fan.add(arm);
    }
    fan.position.set(x, y + 1.15, 0.5);
    tag(fan, 'Fan (animated)');
    roofFans.push(fan);
    g.add(b, fan);
  }

  const mast = new THREE.Vector3(22, y, 3);
  g.add(rod(mast, mast.clone().setY(y + 7), 0.07, metal));
  beaconMat = new THREE.MeshStandardMaterial({ color: 0x551111, emissive: 0xff2a1a, emissiveIntensity: 2 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), beaconMat);
  beacon.position.copy(mast).setY(y + 7.1);
  beacon.userData.part = 'Aircraft beacon';
  g.add(beacon);

  // Solar
  const solarMat = new THREE.MeshStandardMaterial({ map: TEX.solar, metalness: 0.3, roughness: 0.25 });
  const sy = 5 * STOREY + 0.2;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
    const p = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 1.5), solarMat));
    p.position.set(-5.4 + c * 3.6, sy + 0.55, -14.5 + r * 3.2);
    p.rotation.x = -0.45;
    p.userData.part = 'Solar panel';
    g.add(p);
  }
}

function buildBuilding() {
  facadeMat = makeFacadeMaterial(TEX.skins[0], TEX.windowMask, TOWER_TOP);
  roofMat = new THREE.MeshStandardMaterial({ map: TEX.roof, roughness: 0.95 });
  building = new THREE.Group();
  buildRedTower(building);
  buildGlassBlock(building);
  buildWhiteBlock(building);
  buildBackBlock(building);
  buildCourtAndStairs(building);
  buildArch(building);
  buildRoofPlant(building);
  scene.add(building);
}

// Wipe
function requestSkin(i) {
  if (facade.busy) return false;
  const n = SKINS.length;
  i = ((i % n) + n) % n;
  if (i === facade.index) return false;
  facade.next = i;
  facade.busy = true;
  facade.t = 0;
  facadeMat.uniforms.uSkinB.value = TEX.skins[i];
  return true;
}

const _ca = new THREE.Color(), _cb = new THREE.Color();
function updateFacade(dt, time) {
  const u = facadeMat.uniforms;
  u.uTime.value = time;
  if (facade.busy) {
    facade.t += dt;
    const p = Math.min(facade.t / facade.dur, 1);
    u.uMix.value = p;
    // Slabs
    _ca.setHex(SKINS[facade.index].trim);
    _cb.setHex(SKINS[facade.next].trim);
    const k = smoothstep(0.55, 0.95, p);
    for (const m of trimMats) m.color.copy(_ca).lerp(_cb, k);
    if (p >= 1) {
      facade.index = facade.next;
      u.uSkinA.value = TEX.skins[facade.index];
      // Sync
      u.uSkinB.value = TEX.skins[facade.index];
      u.uMix.value = 0;
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
  const on = ph < 0.12 || (ph > 0.3 && ph < 0.42);
  beaconMat.emissiveIntensity = on ? 6 : 0.2;
}

function setNight(v) {
  facadeMat.uniforms.uNight.value = v;
  signFaceMat.emissiveIntensity = v * 0.9;
  towerWindowMat.emissiveIntensity = v * 0.8;
}

export { COURT_Y, TOWER_TOP, buildBuilding, building, facade, facadeMat, requestSkin, setNight, updateFacade, updateRoof };
