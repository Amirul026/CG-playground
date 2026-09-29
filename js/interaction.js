import * as THREE from 'three';
import { UI, clamp, toast, toggleInfo, wrapAngle } from './helpers.js';
import { FOV, camera, onResize, perspCam, scene, setFOV, setProjection, usingPerspective } from './renderer.js';
import { LIGHT_COLOURS, dayAuto, dayPhase, orbitLight, setDayAuto, sun } from './lighting.js';
import { facade, requestSkin } from './building.js';
import { SKINS } from './textures.js';
import { setTimeScale, timeScale } from './animation.js';
import { skyMesh } from './world.js';

// Camera
const CAM_PRESETS = [
  { name: 'Orbit', target: [1, 9, -2], phi: 1.16, dist: 72, auto: true, minD: 34, maxD: 180, phiMin: 0.12, phiMax: 1.5 },
  { name: 'Playground', target: [0, 1.2, 35], phi: 1.08, dist: 30, auto: true, minD: 9, maxD: 90, phiMin: 0.12, phiMax: 1.5 },
  { name: 'Street', target: [1, 1.7, -3], look: [1, 10, -3], phi: 1.53, dist: 44, auto: true, minD: 36, maxD: 80, phiMin: 1.36, phiMax: 1.555 },
  { name: 'Overhead', target: [0, 0, 10], phi: 0.06, dist: 125, auto: false, minD: 60, maxD: 200, phiMin: 0.02, phiMax: 0.6 }
];
const CAM_MODES = CAM_PRESETS.map(p => p.name);

const orbit = {
  theta: 0.9,
  phi: 1.2,
  dist: 110,
  distGoal: 110,
  auto: true,  // Auto
  autoSpeed: 0.11,  // Speed
  target: new THREE.Vector3(1, 9, -2),
  targetGoal: new THREE.Vector3(1, 9, -2),
  look: null
};

// Controls
const ctl = {
  camMode: 0,
  dragging: false,
  intro: null,  // Intro
  dayTween: null
};

const keys = {};

function applyPreset(i, keepTheta) {
  const p = CAM_PRESETS[i];
  ctl.camMode = i;
  orbit.targetGoal.fromArray(p.target);
  orbit.look = p.look ? new THREE.Vector3().fromArray(p.look) : null;
  orbit.phi = p.phi;
  orbit.distGoal = p.dist;
  orbit.auto = p.auto;
  if (!keepTheta) orbit.theta = wrapAngle(orbit.theta);
}
function preset() { return CAM_PRESETS[ctl.camMode]; }

function setCamMode(i) {
  applyPreset(i, true);
  toast(`Camera <b>${CAM_MODES[i].toLowerCase()}</b>`);
}

// Pointer
let dragMoved = 0;
const pointers = new Map();
let pinchStart = 0, pinchDist = 0;

function initInteraction(canvas) {
  const el = canvas;
  el.style.touchAction = 'none';

  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      ctl.dragging = true; dragMoved = 0;
      orbit.auto = false; ctl.intro = null;
    }
    if (pointers.size === 2) {
      const p = [...pointers.values()];
      pinchStart = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      pinchDist = orbit.distGoal;
    }
  });

  el.addEventListener('pointermove', e => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    prev.x = e.clientX; prev.y = e.clientY;

    if (pointers.size === 2) {
      const p = [...pointers.values()];
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      if (pinchStart > 0) orbit.distGoal = clamp(pinchDist * (pinchStart / Math.max(d, 1)), preset().minD, preset().maxD);
      return;
    }
    if (!ctl.dragging) return;
    dragMoved += Math.abs(dx) + Math.abs(dy);

    orbit.theta += dx * 0.0055;
    orbit.phi = clamp(orbit.phi - dy * 0.0045, preset().phiMin, preset().phiMax);
  });

  const release = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = 0;
    if (pointers.size === 0) {
      if (ctl.dragging && dragMoved < 6) pickObject(e);
      ctl.dragging = false;
    }
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('contextmenu', e => e.preventDefault());

  el.addEventListener('wheel', e => {
    e.preventDefault();
    orbit.distGoal = clamp(orbit.distGoal * (1 + Math.sign(e.deltaY) * 0.09), preset().minD, preset().maxD);
  }, { passive: false });

  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    keys[e.key.toLowerCase()] = true;
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);

  // Buttons
  if (matchMedia('(pointer: coarse)').matches) {
    UI('touch').classList.remove('hidden');
    const hold = (id, key) => {
      const b = UI(id);
      const down = e => { e.preventDefault(); keys[key] = true; orbit.auto = false; };
      const up = e => { e.preventDefault(); keys[key] = false; };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
      b.addEventListener('pointercancel', up);
    };
    hold('tbLeft', 'arrowleft');
    hold('tbRight', 'arrowright');
    UI('tbSkin').onclick = () => nextSkin(1);
    UI('tbLight').onclick = () => toggleLightAuto();
    UI('tbCam').onclick = () => setCamMode((ctl.camMode + 1) % CAM_MODES.length);
    UI('tbNight').onclick = () => toggleNight();
  }
}

// Picker
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickObject(e) {
  ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  for (const h of hits) {
    let o = h.object;
    if (o === skyMesh || o.isSprite || o.isLine) continue;
    while (o && !o.userData.part) o = o.parent;
    if (!o) continue;
    toast(`<b>${o.userData.part}</b> &nbsp; ${h.distance.toFixed(1)} m from the camera`);
    return;
  }
}

// Keyboard
function onKey(e) {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();

  if (k === 'i' || k === 'tab') { e.preventDefault(); toggleInfo(); return; }
  if (UI('info').classList.contains('on') && k === 'escape') { toggleInfo(); return; }

  switch (k) {
    case 'arrowleft': case 'arrowright': case 'arrowup': case 'arrowdown':
      e.preventDefault();
    // Fallthrough
    case 'q': case 'e': case ',': case '.':
      orbit.auto = false; ctl.intro = null;
      break;
    case '-': case '_':
      orbit.distGoal = clamp(orbit.distGoal * 1.12, preset().minD, preset().maxD);
      toast(`Camera <b>${orbit.distGoal.toFixed(0)} m</b> from the target`);
      break;
    case '=': case '+':
      orbit.distGoal = clamp(orbit.distGoal * 0.89, preset().minD, preset().maxD);
      toast(`Camera <b>${orbit.distGoal.toFixed(0)} m</b> from the target`);
      break;
    case 'a':
      orbit.auto = !orbit.auto;
      toast(orbit.auto ? 'Camera <b>circling</b> on its own' : 'Camera <b>held</b> &mdash; arrows or drag to move it');
      break;
    case '1': case '2': case '3': case '4':
      setCamMode(+k - 1); break;
    case 'c':
      setCamMode((ctl.camMode + 1) % CAM_MODES.length); break;

    // Texture
    case 'b': nextSkin(e.shiftKey ? -1 : 1); break;
    case 'v':
      facade.auto = !facade.auto; facade.timer = 0;
      toast(facade.auto ? `Texture changes every <b>${facade.interval} s</b>` : 'Texture <b>held</b> &mdash; press B to change it');
      break;

    // Light
    case 'j': toggleLightAuto(); break;
    case 'z': case 'x':
      orbitLight.auto = false;
      orbitLight.angle = wrapAngle(orbitLight.angle + (k === 'z' ? -0.2 : 0.2));
      toast(`Light at <b>${Math.round(orbitLight.angle * 180 / Math.PI)}&deg;</b>`);
      break;
    case 'r': case 'f':
      orbitLight.elevation = clamp(orbitLight.elevation + (k === 'r' ? 0.08 : -0.08), 0.15, 1.4);
      toast(`Light <b>${Math.round(orbitLight.elevation * 180 / Math.PI)}&deg;</b> above the horizon`);
      break;
    case 'l':
      orbitLight.on = !orbitLight.on;
      toast(orbitLight.on ? 'Light <b>on</b>' : 'Light <b>off</b> &mdash; it is the only light, so the scene goes dark');
      break;
    case 'o':
      orbitLight.colourIndex = (orbitLight.colourIndex + 1) % LIGHT_COLOURS.length;
      toast(`Light colour <b>${LIGHT_COLOURS[orbitLight.colourIndex].name}</b>`);
      break;
    case 'k':
      orbitLight.shadows = !orbitLight.shadows;
      toast(orbitLight.shadows ? 'Light casts <b>shadows</b>' : 'Shadows <b>off</b>');
      break;

    // Misc
    case ' ':
      e.preventDefault();
      setTimeScale(timeScale ? 0 : 1);
      toast(timeScale ? 'Animation <b>running</b>' : 'Animation <b>paused</b>');
      break;
    case 'p':
      setProjection(!usingPerspective);
      toast(usingPerspective
        ? 'Projection <b>perspective</b> &mdash; far things get smaller'
        : 'Projection <b>orthographic</b> &mdash; parallel lines stay parallel');
      break;
    case '[': setFOV(clamp(FOV - 5, 20, 95)); perspCam.fov = FOV; perspCam.updateProjectionMatrix(); toast(`Field of view <b>${FOV}&deg;</b>`); break;
    case ']': setFOV(clamp(FOV + 5, 20, 95)); perspCam.fov = FOV; perspCam.updateProjectionMatrix(); toast(`Field of view <b>${FOV}&deg;</b>`); break;
    case 'n': toggleNight(); break;
    case 't':
      setDayAuto(!dayAuto); ctl.dayTween = null;
      toast(dayAuto ? 'Sun <b>moving</b>' : 'Sun <b>held</b>');
      break;
    case 'w': toggleWireframe(); break;
    case 'g': toggleHelpers(); break;
    case 'h': UI('hud').classList.toggle('off'); break;
    case '0':
      applyPreset(0); orbit.theta = 0.9;
      orbitLight.auto = true; orbitLight.elevation = 0.72; orbitLight.on = true;
      facade.auto = true; setTimeScale(1);
      toast('Scene <b>reset</b>');
      break;
  }
}

function nextSkin(dir) {
  const ok = requestSkin(facade.index + dir);
  const i = ((facade.index + dir) % SKINS.length + SKINS.length) % SKINS.length;
  toast(ok ? `Building texture &rarr; <b>${SKINS[i].name}</b>` : 'Wait for the wipe to reach the roof');
}

function toggleLightAuto() {
  orbitLight.auto = !orbitLight.auto;
  toast(orbitLight.auto
    ? 'Light <b>circling</b> the building on its own'
    : 'Light <b>held</b> &mdash; Z / X step it round, R / F raise and lower it');
}

function toggleNight() {
  const now = ((dayPhase % 1) + 1) % 1;
  const goal = (now > 0.08 && now < 0.52) ? 0.78 : 0.24;
  let delta = (goal - now + 1) % 1;
  if (delta < 0.02) delta += 1;
  ctl.dayTween = { from: dayPhase, to: dayPhase + delta, t: 0, dur: 3.0 };
  setDayAuto(false);
  toast(goal > 0.5 ? 'Moving the sun to <b>night</b>' : 'Moving the sun to <b>day</b>');
}

let wireOn = false;
function toggleWireframe() {
  wireOn = !wireOn;
  scene.traverse(o => {
    if (!o.isMesh || o === skyMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) if (m && 'wireframe' in m) m.wireframe = wireOn;
  });
  toast(wireOn ? '<b>Wireframe</b> &mdash; every surface is triangles' : 'Solid shading');
}

let helpers = null, helpersOn = false;
function toggleHelpers() {
  if (!helpers) {
    helpers = new THREE.Group();
    helpers.add(new THREE.DirectionalLightHelper(sun, 6, 0xffd27a));
    helpers.add(new THREE.CameraHelper(sun.shadow.camera));
    helpers.add(new THREE.AxesHelper(8));
    scene.add(helpers);
  }
  helpersOn = !helpersOn;
  helpers.visible = helpersOn;
  toast(helpersOn ? '<b>Light helper</b> visible &mdash; the line points at the light' : 'Helpers hidden');
}

export { CAM_MODES, CAM_PRESETS, applyPreset, ctl, initInteraction, keys, orbit, preset };
