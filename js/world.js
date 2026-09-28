import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, rng } from './helpers.js';
import { TEX } from './textures.js';
import { attachLawnShader, makeFlagMaterial, makeGrassMaterial, makeSkyMaterial } from './shaders.js';
import { scene } from './renderer.js';
import { addGlowHead, setSkyMaterial } from './lighting.js';

/* ----------------------------------------------------------------------------
   SITE PLAN (metres, y up, the building's front faces +z)
     building      x -22 … 24, z -17 … 15.6 (stairs included)
     forecourt     x -28 … 30, z -24 … 17
     path          x ±2,    z 17 … 22
     playground    x ±20,   z 22 … 48
   ---------------------------------------------------------------------------- */
const PLAZA = { x0: -28, x1: 30, z0: -24, z1: 17 };
const PLAY = { x0: -20, x1: 20, z0: 22, z1: 48 };

/* is a point on grass, clear of the paving, playground and a margin round them */
function isOpenLawn(x, z, margin) {
  const m = margin || 0;
  if (x > PLAZA.x0 - m && x < PLAZA.x1 + m && z > PLAZA.z0 - m && z < PLAZA.z1 + m) return false;
  if (x > PLAY.x0 - 1 - m && x < PLAY.x1 + 1 + m && z > PLAY.z0 - 1 - m && z < PLAY.z1 + 1 + m) return false;
  if (Math.abs(x) < 2.5 + m && z > 16 && z < 23) return false;
  return true;
}

/* tag every mesh under an object with a name the click picker can report */
function tag(obj, name) {
  obj.traverse(o => { o.userData.part = name; });
  return obj;
}

function shadowed(mesh, cast, receive) {
  mesh.castShadow = cast !== false;
  mesh.receiveShadow = receive !== false;
  return mesh;
}

/* a cylinder stretched between two points, used for legs, chains and bars */
const _up = new THREE.Vector3(0, 1, 0);
function rod(a, b, radius, mat, radial) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, radial || 10), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(_up, dir.normalize());
  return shadowed(m);
}

/* ============================================================================
   SKY AND GROUND
   ========================================================================== */
let skyMat, skyMesh, lawn;

function buildSky() {
  skyMat = makeSkyMaterial();
  skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 24), skyMat);
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -1;
  scene.add(skyMesh);
  setSkyMaterial(skyMat);
}

function buildGround() {
  const grass = TEX.grass.clone();
  grass.repeat.set(650, 650);                     // four metres per tile
  grass.needsUpdate = true;
  const mat = attachLawnShader(new THREE.MeshStandardMaterial({ map: grass, roughness: 1, metalness: 0 }), TEX.dirt);
  lawn = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), mat);
  lawn.rotation.x = -Math.PI / 2;
  lawn.receiveShadow = true;
  lawn.name = 'Lawn';
  lawn.userData.part = 'Lawn';
  scene.add(lawn);

  /* the plaza round the building */
  const pw = PLAZA.x1 - PLAZA.x0, pd = PLAZA.z1 - PLAZA.z0;
  const pav = TEX.redPaving.clone();
  pav.repeat.set(pw / 4, pd / 4);
  pav.needsUpdate = true;
  const pavMat = new THREE.MeshStandardMaterial({ map: pav, roughness: 0.85 });
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), pavMat);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set((PLAZA.x0 + PLAZA.x1) / 2, 0.03, (PLAZA.z0 + PLAZA.z1) / 2);
  plaza.receiveShadow = true;
  plaza.userData.part = 'Brick forecourt';
  scene.add(plaza);

  /* the path to the playground gate */
  const pth = TEX.paving.clone();
  pth.repeat.set(1, 6 / 4);
  pth.needsUpdate = true;
  const path = new THREE.Mesh(new THREE.PlaneGeometry(4, 6), new THREE.MeshStandardMaterial({ map: pth, roughness: 0.85 }));
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.03, 19.5);
  path.receiveShadow = true;
  path.userData.part = 'Path to the playground';
  scene.add(path);

  /* granite kerbs along the plaza edge */
  const kerbMat = new THREE.MeshStandardMaterial({ map: TEX.concreteLight, color: 0xbab5ad, roughness: 0.8 });
  const kerb = (x, z, w, d) => {
    const k = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, d), kerbMat));
    k.position.set(x, 0.07, z);
    k.userData.part = 'Kerb';
    scene.add(k);
  };
  kerb((PLAZA.x0 + PLAZA.x1) / 2, PLAZA.z0, pw + 0.3, 0.3);
  kerb(PLAZA.x0, (PLAZA.z0 + PLAZA.z1) / 2, 0.3, pd);
  kerb(PLAZA.x1, (PLAZA.z0 + PLAZA.z1) / 2, 0.3, pd);
  kerb((PLAZA.x0 - 2) / 2, PLAZA.z1, PLAZA.x0 * -1 - 2 + 0.3, 0.3);
  kerb((PLAZA.x1 + 2) / 2, PLAZA.z1, PLAZA.x1 - 2 + 0.3, 0.3);
}

/* ============================================================================
   TREES — trunks and crowns are two instanced meshes, so sixty trees are two
   draw calls. The crown is an icosahedron pushed about by a hash of each
   vertex position, so shared corners move together and the ball stays closed.
   ========================================================================== */
let treeTrunks, treeCrowns;
const TREES = [];

function lumpyBall(radius, seed) {
  const g = new THREE.IcosahedronGeometry(radius, 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719 + seed) * 43758.5453;
    const k = 1 + ((h - Math.floor(h)) - 0.5) * 0.28;
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y * 0.9, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function buildTrees() {
  const rand = rng(4242);

  /* a hand placed avenue along the west side, then a scatter further out */
  for (let z = -20; z <= 44; z += 8) TREES.push({ x: -33 + (rand() - 0.5) * 1.5, z, s: 0.9 + rand() * 0.25 });
  for (let x = -24; x <= 24; x += 8) TREES.push({ x, z: -29 + (rand() - 0.5) * 1.5, s: 0.95 + rand() * 0.2 });
  let tries = 0;
  while (TREES.length < 90 && tries++ < 3000) {
    const a = rand() * TAU, r = 30 + Math.pow(rand(), 0.7) * 120;
    const x = Math.cos(a) * r, z = 8 + Math.sin(a) * r;
    if (!isOpenLawn(x, z, 5)) continue;
    if (TREES.some(t => (t.x - x) ** 2 + (t.z - z) ** 2 < 36)) continue;
    TREES.push({ x, z, s: 0.8 + rand() * 0.6 });
  }

  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.34, 3.4, 9);
  trunkGeo.translate(0, 1.7, 0);
  const crownGeo = lumpyBall(1.9, 3.1);
  const trunkMat = new THREE.MeshStandardMaterial({ map: TEX.bark, roughness: 0.95 });
  const crownMat = new THREE.MeshStandardMaterial({ map: TEX.leaf, roughness: 0.9 });

  treeTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREES.length);
  treeCrowns = new THREE.InstancedMesh(crownGeo, crownMat, TREES.length * 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const tint = new THREE.Color();

  TREES.forEach((t, i) => {
    q.setFromAxisAngle(_up, rand() * TAU);
    m.compose(p.set(t.x, 0, t.z), q, s.setScalar(t.s));
    treeTrunks.setMatrixAt(i, m);
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * TAU + rand();
      const off = k === 0 ? 0 : 0.9;
      p.set(t.x + Math.cos(a) * off * t.s, (3.9 + (k === 0 ? 1.0 : 0) + rand() * 0.4) * t.s, t.z + Math.sin(a) * off * t.s);
      s.setScalar(t.s * (k === 0 ? 1.15 : 0.9 + rand() * 0.2));
      m.compose(p, q, s);
      treeCrowns.setMatrixAt(i * 3 + k, m);
      tint.setHSL(0.24 + rand() * 0.06, 0.45, 0.42 + rand() * 0.12);
      treeCrowns.setColorAt(i * 3 + k, tint);
    }
  });
  for (const im of [treeTrunks, treeCrowns]) {
    im.castShadow = true; im.receiveShadow = true;
    im.userData.part = im === treeTrunks ? 'Tree trunk' : 'Tree';
    scene.add(im);
  }
}

/* ============================================================================
   GRASS TUFTS
   ========================================================================== */
let grassMat;
function buildGrassTufts() {
  const a = new THREE.PlaneGeometry(0.9, 0.62); a.translate(0, 0.31, 0);
  const b = a.clone(); b.rotateY(Math.PI / 2);
  const geo = mergeGeometries([a, b]);
  grassMat = makeGrassMaterial(TEX.tuft);

  const N = 3200, rand = rng(777);
  const mesh = new THREE.InstancedMesh(geo, grassMat, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let n = 0;
  for (let tries = 0; n < N && tries < N * 5; tries++) {
    const ang = rand() * TAU, r = 3 + Math.sqrt(rand()) * 95;
    const x = Math.cos(ang) * r, z = 10 + Math.sin(ang) * r;
    if (!isOpenLawn(x, z, 0.6)) continue;
    q.setFromAxisAngle(_up, rand() * TAU);
    s.set(0.8 + rand() * 0.7, 0.6 + rand() * 0.9, 1);
    m.compose(p.set(x, 0, z), q, s);
    mesh.setMatrixAt(n++, m);
  }
  mesh.count = n;
  mesh.frustumCulled = false;
  mesh.userData.part = 'Long grass';
  scene.add(mesh);
}

/* ============================================================================
   STREET LAMPS — the heads glow at night, but they are not light sources:
   the only light in the scene is the one circling the building
   ========================================================================== */
function buildStreetLamps() {
  const poleMat = new THREE.MeshStandardMaterial({ map: TEX.metalDark, metalness: 0.7, roughness: 0.4 });
  const spots = [[-26.5, -20], [28.5, -20], [-26.5, 14.5], [28.5, 14.5], [-22.5, 30], [22.5, 42]];
  for (const [x, z] of spots) {
    const g = new THREE.Group();
    const base = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.5, 12),
      new THREE.MeshStandardMaterial({ map: TEX.concrete, roughness: 0.9 })));
    base.position.y = 0.25;
    const pole = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 5.4, 10), poleMat));
    pole.position.y = 3.0;
    const dir = x < 0 ? 1 : -1;                           // arm points in toward the site
    const arm = rod(new THREE.Vector3(0, 5.5, 0), new THREE.Vector3(dir * 1.1, 5.75, 0), 0.05, poleMat);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, emissive: 0xffd49a, emissiveIntensity: 0.2, roughness: 0.4 });
    const head = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.36), headMat));
    head.position.set(dir * 1.25, 5.7, 0);
    g.add(base, pole, arm, head);
    g.position.set(x, 0, z);
    tag(g, 'Street lamp');
    scene.add(g);
    addGlowHead(headMat);
  }
}

/* ============================================================================
   BENCHES
   ========================================================================== */
let benchWood, benchIron;
function makeBench() {
  if (!benchWood) {
    benchWood = new THREE.MeshStandardMaterial({ map: TEX.wood, roughness: 0.75 });
    benchIron = new THREE.MeshStandardMaterial({ map: TEX.metalDark, metalness: 0.6, roughness: 0.45 });
  }
  const g = new THREE.Group();
  for (const x of [-0.8, 0.8]) {
    const leg = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.5), benchIron));
    leg.position.set(x, 0.225, 0);
    const back = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.06), benchIron));
    back.position.set(x, 0.72, -0.24); back.rotation.x = -0.18;
    g.add(leg, back);
  }
  for (let i = 0; i < 3; i++) {
    const slat = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.14), benchWood));
    slat.position.set(0, 0.47, -0.17 + i * 0.17);
    g.add(slat);
  }
  for (let i = 0; i < 2; i++) {
    const slat = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.04), benchWood));
    slat.position.set(0, 0.68 + i * 0.2, -0.27 - i * 0.035); slat.rotation.x = -0.18;
    g.add(slat);
  }
  return tag(g, 'Bench');
}

function buildBenches() {
  const place = (x, z, ry) => { const b = makeBench(); b.position.set(x, 0.03, z); b.rotation.y = ry; scene.add(b); };
  place(-20, 12, 0);
  place(-16, 12, 0);
  place(20, 13.5, 0);
  place(24, 13.5, 0);
  place(-24, 36, Math.PI / 2);
}

/* ============================================================================
   FLAG POLE ON THE FORECOURT, flying the flag of Bangladesh — the flag
   itself is the wave shader in shaders.js
   ========================================================================== */
let flagMat;
function buildFlag() {
  const g = new THREE.Group();
  const pole = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 12, 12),
    new THREE.MeshStandardMaterial({ map: TEX.metalLight, metalness: 0.85, roughness: 0.3 })));
  pole.position.y = 6;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xe0b44a, metalness: 0.9, roughness: 0.25 }));
  cap.position.y = 12.05;
  const base = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.35, 16),
    new THREE.MeshStandardMaterial({ map: TEX.concrete, roughness: 0.9 })));
  base.position.y = 0.17;

  flagMat = makeFlagMaterial(TEX.flag);
  const flagGeo = new THREE.PlaneGeometry(3, 1.8, 30, 12);      // 10 : 6
  flagGeo.translate(1.5, 0, 0);                      // hinge on the pole side
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(0.08, 10.8, 0);
  flag.castShadow = true;
  flag.userData.part = 'Flag of Bangladesh (vertex shader wave)';

  g.add(pole, cap, base, flag);
  tag(pole, 'Flag pole'); tag(base, 'Flag pole');
  g.position.set(-12, 0, 11);
  scene.add(g);
}

export { PLAZA, PLAY, TREES, benchIron, buildBenches, buildFlag, buildGrassTufts, buildGround, buildSky, buildStreetLamps, buildTrees, flagMat, grassMat, isOpenLawn, lawn, makeBench, rod, shadowed, skyMat, skyMesh, tag };
