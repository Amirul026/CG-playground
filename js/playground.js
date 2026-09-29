import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU } from './helpers.js';
import { TEX } from './textures.js';
import { attachRubberShader } from './shaders.js';
import { scene } from './renderer.js';
import { PLAY, makeBench, rod, shadowed, tag } from './world.js';

// Parts
const play = {
  swings: [],  // Swing
  seesaw: null,
  carousel: null,
  carouselSpin: 0,
  springRider: null
};

let paintRed, paintBlue, paintYellow, paintGreen, steel, wood;

function materials() {
  paintRed = new THREE.MeshStandardMaterial({ map: TEX.paintRed, roughness: 0.45, metalness: 0.2 });
  paintBlue = new THREE.MeshStandardMaterial({ map: TEX.paintBlue, roughness: 0.45, metalness: 0.2 });
  paintYellow = new THREE.MeshStandardMaterial({ map: TEX.paintYellow, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide });
  paintGreen = new THREE.MeshStandardMaterial({ map: TEX.paintGreen, roughness: 0.5, metalness: 0.2 });
  steel = new THREE.MeshStandardMaterial({ map: TEX.metalLight, roughness: 0.35, metalness: 0.85 });
  wood = new THREE.MeshStandardMaterial({ map: TEX.wood, roughness: 0.75 });
}

// Surface
function buildSurface() {
  const w = PLAY.x1 - PLAY.x0, d = PLAY.z1 - PLAY.z0;
  const mat = attachRubberShader(new THREE.MeshStandardMaterial({ map: TEX.rubber, roughness: 0.92 }));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((PLAY.x0 + PLAY.x1) / 2, 0.035, (PLAY.z0 + PLAY.z1) / 2);
  floor.receiveShadow = true;
  floor.userData.part = 'Rubber safety surface (custom shader)';
  scene.add(floor);
}

// Fence
function buildFence() {
  const x0 = PLAY.x0 - 0.4, x1 = PLAY.x1 + 0.4, z0 = PLAY.z0 - 0.4, z1 = PLAY.z1 + 0.4;
  const gate = 2.0;
  const posts = [];
  const along = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 2);
    for (let i = 0; i <= n; i++) posts.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]);
  };
  along(x0, z0, -gate, z0); along(gate, z0, x1, z0);
  along(x1, z0, x1, z1); along(x1, z1, x0, z1); along(x0, z1, x0, z0);

  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.15, 8);
  postGeo.translate(0, 0.575, 0);
  const im = new THREE.InstancedMesh(postGeo, paintGreen, posts.length);
  const m = new THREE.Matrix4();
  posts.forEach((p, i) => { m.makeTranslation(p[0], 0, p[1]); im.setMatrixAt(i, m); });
  im.castShadow = true;
  im.userData.part = 'Fence';
  scene.add(im);

  const rail = (ax, az, bx, bz) => {
    for (const y of [0.35, 1.1]) {
      const r = rod(new THREE.Vector3(ax, y, az), new THREE.Vector3(bx, y, bz), 0.035, paintGreen, 6);
      r.userData.part = 'Fence';
      scene.add(r);
    }
  };
  rail(x0, z0, -gate, z0); rail(gate, z0, x1, z0);
  rail(x1, z0, x1, z1); rail(x1, z1, x0, z1); rail(x0, z1, x0, z0);

  // Pickets
  const pickets = [];
  const pick = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / 0.25);
    for (let i = 1; i < n; i++) pickets.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]);
  };
  pick(x0, z0, -gate, z0); pick(gate, z0, x1, z0);
  pick(x1, z0, x1, z1); pick(x1, z1, x0, z1); pick(x0, z1, x0, z0);
  const picketGeo = new THREE.BoxGeometry(0.025, 0.8, 0.025);
  picketGeo.translate(0, 0.72, 0);
  const pim = new THREE.InstancedMesh(picketGeo, paintGreen, pickets.length);
  pickets.forEach((p, i) => { m.makeTranslation(p[0], 0, p[1]); pim.setMatrixAt(i, m); });
  pim.castShadow = true;
  pim.userData.part = 'Fence';
  scene.add(pim);

  // Gate
  const arch = new THREE.Group();
  for (const x of [-gate, gate]) arch.add(rod(new THREE.Vector3(x, 0, z0), new THREE.Vector3(x, 2.9, z0), 0.09, paintRed, 12));
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-gate, 2.9, z0), new THREE.Vector3(0, 3.7, z0), new THREE.Vector3(gate, 2.9, z0));
  arch.add(shadowed(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.09, 10, false), paintRed)));
  // Signboard
  const signMat = new THREE.MeshStandardMaterial({ map: TEX.playSign, roughness: 0.5 });
  for (const side of [-1, 1]) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.42), signMat);
    board.position.set(0, 2.55, z0 + side * 0.02);
    board.rotation.y = side < 0 ? Math.PI : 0;
    arch.add(board);
  }
  tag(arch, 'Playground gate');
  scene.add(arch);
}

// Swings
function chain(length) {
  // Chain
  const parts = [];
  const pitch = 0.085, n = Math.floor(length / pitch);
  for (let i = 0; i < n; i++) {
    const g = new THREE.TorusGeometry(0.03, 0.007, 4, 8);
    g.scale(1, 1.6, 1);
    if (i % 2) g.rotateY(Math.PI / 2);
    g.translate(0, -i * pitch - pitch / 2, 0);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

function buildSwings() {
  const cx = -12, cz = 42, top = 2.65, half = 4.4;
  const g = new THREE.Group();
  for (const x of [-half, half]) {
    for (const s of [-1, 1]) g.add(rod(new THREE.Vector3(x, 0, s * 1.25), new THREE.Vector3(x, top, 0), 0.07, paintRed, 12));
    g.add(rod(new THREE.Vector3(x, 0.9, -0.83), new THREE.Vector3(x, 0.9, 0.83), 0.04, paintRed, 8));
  }
  g.add(rod(new THREE.Vector3(-half - 0.15, top, 0), new THREE.Vector3(half + 0.15, top, 0), 0.08, paintRed, 14));

  const chainGeo = chain(2.05);
  const seatMat = new THREE.MeshStandardMaterial({ map: TEX.rubberSeat, roughness: 0.8 });
  const specs = [
    { x: -2.6, amp: 0.55, phase: 0.0 },
    { x: 0.0, amp: 0.32, phase: 1.9 },
    { x: 2.6, amp: 0.66, phase: 3.6 }
  ];
  for (const s of specs) {
    const pivot = new THREE.Group();
    pivot.position.set(s.x, top - 0.06, 0);
    for (const cxo of [-0.23, 0.23]) {
      const c = new THREE.Mesh(chainGeo, steel);
      c.position.x = cxo;
      c.castShadow = true;
      pivot.add(c);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12), steel);
      hook.position.set(cxo, 0.04, 0);
      pivot.add(hook);
    }
    const seat = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 0.24), seatMat));
    seat.position.y = -2.08;
    pivot.add(seat);
    g.add(pivot);
    // Pendulum
    play.swings.push({ pivot, amp: s.amp, phase: s.phase, omega: Math.sqrt(9.81 / 2.1) });
  }
  g.position.set(cx, 0, cz);
  tag(g, 'Swing set (animated)');
  scene.add(g);
}

// Slide
function sweptChute(curve, halfW, wallH, segs) {
  // Profile
  const prof = [];
  prof.push([-halfW, wallH]);
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + i / 12 * Math.PI;
    prof.push([Math.cos(a) * halfW, Math.sin(a) * halfW * 0.55]);
  }
  prof.push([halfW, wallH]);

  const pos = [], uv = [], idx = [];
  const T = new THREE.Vector3(), side = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(), P = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    up.crossVectors(side, T).normalize().negate();  // Up
    if (up.y < 0) up.negate();
    for (let j = 0; j < prof.length; j++) {
      const [s, u] = prof[j];
      pos.push(P.x + side.x * s + up.x * u, P.y + side.y * s + up.y * u, P.z + side.z * s + up.z * u);
      uv.push(j / (prof.length - 1), t * 4);
    }
  }
  const cols = prof.length;
  for (let i = 0; i < segs; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = a + cols;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildSlide() {
  const g = new THREE.Group();
  const deckH = 2.0, half = 0.8;
  for (const [x, z] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
    g.add(rod(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 3.1, z), 0.07, paintBlue, 12));
  }
  const deck = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 1.7), wood));
  deck.position.y = deckH;
  g.add(deck);
  for (const z of [-half, half]) {
    const panel = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 0.04), paintYellow));
    panel.position.set(0, deckH + 0.4, z);
    g.add(panel);
  }
  const roof = shadowed(new THREE.Mesh(new THREE.ConeGeometry(1.45, 0.9, 4), paintRed));
  roof.position.y = 3.55; roof.rotation.y = Math.PI / 4;
  g.add(roof);

  // Ladder
  const lb = new THREE.Vector3(-2.2, 0, 0), lt = new THREE.Vector3(-half, deckH, 0);
  for (const s of [-0.3, 0.3]) g.add(rod(lb.clone().setZ(s), lt.clone().setZ(s), 0.04, steel, 8));
  for (let i = 1; i < 8; i++) {
    const p = lb.clone().lerp(lt, i / 8);
    g.add(rod(p.clone().setZ(-0.3), p.clone().setZ(0.3), 0.025, steel, 6));
  }

  // Chute
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(half, deckH + 0.05, 0),
    new THREE.Vector3(1.8, deckH - 0.15, 0),
    new THREE.Vector3(3.6, 1.05, 0),
    new THREE.Vector3(5.1, 0.42, 0),
    new THREE.Vector3(6.1, 0.34, 0)
  ]);
  const chute = shadowed(new THREE.Mesh(sweptChute(curve, 0.36, 0.28, 60), paintYellow));
  chute.userData.part = 'Slide chute (swept geometry)';
  g.add(chute);
  const endP = curve.getPointAt(1);
  g.add(rod(new THREE.Vector3(endP.x - 0.3, 0, 0), new THREE.Vector3(endP.x - 0.3, endP.y - 0.1, 0), 0.06, paintBlue, 10));

  g.position.set(8.2, 0, 43);
  tag(g, 'Slide');
  chute.userData.part = 'Slide chute (swept geometry)';
  scene.add(g);
}

// Seesaw
function buildSeesaw() {
  const g = new THREE.Group();
  // Stand
  const tri = new THREE.Shape();
  tri.moveTo(-0.35, 0); tri.lineTo(0.35, 0); tri.lineTo(0.06, 0.55); tri.lineTo(-0.06, 0.55); tri.closePath();
  const baseGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.36, bevelEnabled: false });
  baseGeo.translate(0, 0, -0.18);
  const base = shadowed(new THREE.Mesh(baseGeo, paintBlue));
  g.add(base);
  const axle = rod(new THREE.Vector3(0, 0.55, -0.25), new THREE.Vector3(0, 0.55, 0.25), 0.05, steel, 10);
  g.add(axle);

  const pivot = new THREE.Group();
  pivot.position.y = 0.6;
  const plank = shadowed(new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.08, 0.32), wood));
  pivot.add(plank);
  for (const x of [-1.75, 1.75]) {
    const seat = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.36), paintRed));
    seat.position.set(x * 1.02, 0.07, 0);
    pivot.add(seat);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 16, Math.PI), paintRed);
    handle.position.set(x * 0.82, 0.05, 0);
    handle.rotation.y = Math.PI / 2;
    handle.castShadow = true;
    pivot.add(handle);
  }
  g.add(pivot);
  play.seesaw = pivot;
  g.position.set(-3.5, 0, 40);
  tag(g, 'See-saw (animated)');
  scene.add(g);
}

// Carousel
function buildCarousel() {
  const g = new THREE.Group();
  const hub = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.3, 16), steel));
  hub.position.y = 0.15;
  g.add(hub);

  const spin = new THREE.Group();
  const deckSide = new THREE.MeshStandardMaterial({ map: TEX.paintRed, roughness: 0.5 });
  const deckTop = new THREE.MeshStandardMaterial({ map: TEX.carousel, roughness: 0.6 });
  const deck = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.12, 48), [deckSide, deckTop, deckSide]));
  deck.position.y = 0.36;
  spin.add(deck);
  const post = rod(new THREE.Vector3(0, 0.4, 0), new THREE.Vector3(0, 1.25, 0), 0.06, steel, 10);
  spin.add(post);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), paintYellow);
  knob.position.y = 1.28;
  spin.add(knob);

  // Rails
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * TAU + TAU / 12;
    const out = new THREE.Vector3(Math.cos(a) * 1.55, 0.42, Math.sin(a) * 1.55);
    const bend = new THREE.Vector3(Math.cos(a) * 1.35, 0.95, Math.sin(a) * 1.35);
    const inner = new THREE.Vector3(Math.cos(a) * 0.06, 1.1, Math.sin(a) * 0.06);
    const c = new THREE.CatmullRomCurve3([out, out.clone().setY(0.8), bend, inner]);
    spin.add(shadowed(new THREE.Mesh(new THREE.TubeGeometry(c, 20, 0.03, 8, false), steel)));
  }
  g.add(spin);
  play.carousel = spin;
  g.position.set(3, 0, 38);
  tag(g, 'Merry-go-round (animated)');
  scene.add(g);
}

// Dome
function buildDome() {
  const R = 3.0;
  const ico = new THREE.IcosahedronGeometry(R, 1);
  const edges = new THREE.EdgesGeometry(ico, 1);
  const ep = edges.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const cut = -0.18 * R;
  const bars = [], joints = new Map();
  let minY = Infinity;

  for (let i = 0; i < ep.count; i += 2) {
    a.fromBufferAttribute(ep, i); b.fromBufferAttribute(ep, i + 1);
    if (a.y < cut || b.y < cut) continue;
    bars.push([a.clone(), b.clone()]);
    minY = Math.min(minY, a.y, b.y);
    for (const v of [a, b]) joints.set(`${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`, v.clone());
  }

  const parts = [];
  const q = new THREE.Quaternion(), d = new THREE.Vector3();
  for (const [p0, p1] of bars) {
    d.subVectors(p1, p0);
    const g = new THREE.CylinderGeometry(0.04, 0.04, d.length(), 8);
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    g.applyQuaternion(q);
    g.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2 - minY, (p0.z + p1.z) / 2);
    parts.push(g);
  }
  for (const v of joints.values()) {
    const g = new THREE.SphereGeometry(0.075, 10, 8);
    g.translate(v.x, v.y - minY, v.z);
    parts.push(g);
  }
  const dome = shadowed(new THREE.Mesh(mergeGeometries(parts), paintRed));
  dome.position.set(12, 0, 29);
  dome.userData.part = 'Climbing dome (merged geometry)';
  scene.add(dome);
}

// Sandpit
function buildSandpit() {
  const g = new THREE.Group();
  const S = 5;
  for (const [w, d, x, z] of [[S + 0.3, 0.3, 0, S / 2], [S + 0.3, 0.3, 0, -S / 2], [0.3, S, S / 2, 0], [0.3, S, -S / 2, 0]]) {
    const b = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, 0.35, d), wood));
    b.position.set(x, 0.175, z);
    g.add(b);
  }
  const sandGeo = new THREE.PlaneGeometry(S - 0.1, S - 0.1, 24, 24);
  const p = sandGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const r = Math.hypot(x - 0.6, y + 0.4);
    p.setZ(i, Math.max(0, 0.22 - r * 0.07) + Math.sin(x * 2.1) * Math.cos(y * 1.7) * 0.02);
  }
  sandGeo.computeVertexNormals();
  const sandTex = TEX.sand.clone(); sandTex.repeat.set(2, 2); sandTex.needsUpdate = true;
  const sand = new THREE.Mesh(sandGeo, new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = 0.2;
  sand.receiveShadow = true;
  g.add(sand);

  const bucket = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.12, 0.26, 16, 1, true), paintBlue));
  bucket.material = bucket.material.clone(); bucket.material.side = THREE.DoubleSide;
  bucket.position.set(-1.1, 0.36, 0.7);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), paintBlue);
  bottom.rotation.x = -Math.PI / 2; bottom.position.set(-1.1, 0.235, 0.7);
  const spade = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.2), paintYellow));
  spade.position.set(-0.6, 0.27, 1.1); spade.rotation.set(0.2, 0.6, 0);
  const handle = rod(new THREE.Vector3(-0.6, 0.27, 1.0), new THREE.Vector3(-0.35, 0.45, 0.65), 0.018, paintYellow, 6);
  g.add(bucket, bottom, spade, handle);

  g.position.set(-12, 0, 29);
  tag(g, 'Sandpit');
  scene.add(g);
}

// Rider
function buildSpringRider() {
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 120; i++) {
    const a = i / 120 * TAU * 5;
    pts.push(new THREE.Vector3(Math.cos(a) * 0.14, 0.05 + i / 120 * 0.45, Math.sin(a) * 0.14));
  }
  const coil = shadowed(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 240, 0.025, 6, false), steel));
  g.add(coil);
  const plate = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 20), steel));
  plate.position.y = 0.03;
  g.add(plate);

  const rider = new THREE.Group();
  rider.position.y = 0.55;
  const body = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), paintYellow));
  body.scale.set(1.4, 0.8, 0.8);
  body.position.y = 0.15;
  const head = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), paintYellow));
  head.position.set(0.42, 0.5, 0);
  const beak = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0xe8752a, roughness: 0.5 })));
  beak.rotation.z = -Math.PI / 2; beak.position.set(0.64, 0.48, 0);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
  for (const z of [-0.12, 0.12]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), eyeMat);
    eye.position.set(0.55, 0.57, z);
    rider.add(eye);
  }
  const grip = rod(new THREE.Vector3(0.3, 0.55, -0.22), new THREE.Vector3(0.3, 0.55, 0.22), 0.02, paintRed, 6);
  rider.add(body, head, beak, grip);
  g.add(rider);
  play.springRider = rider;
  g.position.set(-8.5, 0, 32.5);
  g.rotation.y = -0.6;
  tag(g, 'Spring rider (animated)');
  scene.add(g);
}

function buildPlayground() {
  materials();
  buildSurface();
  buildFence();
  buildSwings();
  buildSlide();
  buildSeesaw();
  buildCarousel();
  buildDome();
  buildSandpit();
  buildSpringRider();

  for (const x of [-8, 8]) {
    const b = makeBench();
    b.position.set(x, 0.035, 23.2);
    scene.add(b);
  }
}

export { buildPlayground, play };
