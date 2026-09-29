import * as THREE from 'three';
import { UI, clamp, lerp, nextFrame, smoothstep, step, toast, toggleInfo, wrapAngle } from './helpers.js';
import {
  SKINS, TEX, texArchSign, texRedPaving, texTerracotta, texBark, texCarousel, texConcrete, texDirt, texDoor, texFlag, texGlow, texGrass, texLeaf,
  texMetal, texPaint, texPaving, texPlaque, texRoof, texRubber, texSand, texSolar, texTuft, texVent,
  texWindowMask, texWood
} from './textures.js';
import { camera, initRenderer, orthoCam, perspCam, renderer, scene, syncOrthoFrustum, usingPerspective } from './renderer.js';
import { dayAuto, dayPhase, initLights, orbitLight, placeLight, setDayPhase, updateShaderLights, updateSky } from './lighting.js';
import { buildBenches, buildFlag, buildGrassTufts, buildGround, buildSky, buildStreetLamps, buildTrees, skyMesh } from './world.js';
import { buildBuilding, facade } from './building.js';
import { buildPlayground } from './playground.js';
import { animate } from './animation.js';
import { CAM_MODES, applyPreset, ctl, initInteraction, keys, orbit, preset } from './interaction.js';

// Team
const TEAM = [
  { name: 'Eusha Ahmed Mahi', id: '20220104032' },
  { name: 'Amirul Momin Utshaw', id: '20220104042' }
];

// Requirements
const REQUIREMENTS = [
  ['Custom shaders',
    '<code>shaders.js</code> &mdash; makeSkyMaterial, makeFacadeMaterial, makeFlagMaterial, makeGrassMaterial, attachLawnShader, attachRubberShader',
    'Four complete GLSL programs plus two that extend the standard material. The facade program does its own Blinn&ndash;Phong lighting, the texture wipe, glass reflections and the lit rooms at night. The flag is moved in the vertex shader. The playground games are painted by the fragment shader, so press <b>W</b>, zoom in and they stay sharp.'],
  ['Lighting',
    '<code>lighting.js</code> &mdash; initLights, updateSky, updateShaderLights',
    'One light source only: a directional light whose position circles the building, with a 2048&sup2; shadow map. There is no ambient, hemisphere or environment light, so every surface is lit by that one light and the faces turned away from it fall into shade. Every hand-written shader does its own Blinn&ndash;Phong from the same light. By night the same light becomes moonlight; the windows, lamp heads and name board glow but light nothing. Press <b>G</b> to see the light helper, <b>N</b> for night.'],
  ['Perspective projection',
    '<code>renderer.js</code> &mdash; initRenderer, syncOrthoFrustum',
    'THREE.PerspectiveCamera at a 50&deg; field of view. <b>P</b> swaps in an orthographic camera on the same position so the two can be compared; <b>[</b> <b>]</b> change the field of view.'],
  ['Texture for each object',
    '<code>textures.js</code> &mdash; the TEX library',
    'About thirty textures, all painted onto canvases at load time from tileable value noise and 2D drawing: five ribbon-window facade skins and a window mask, terracotta panels, herringbone brick paving, lawn, soil, sand, rubber, roof, concrete, timber, paint, steel, bark, leaves, doors, the name boards, the flag of Bangladesh and the merry-go-round deck.'],
  ['Animation',
    '<code>animation.js</code> &mdash; updateOrbitLight, updatePlayground, <code>building.js</code> updateFacade, updateRoof',
    'The light circles the building, the facade wipes to a new skin every 12 s, the swings move as pendulums (&omega; = &radic;(g / L)), the see-saw rocks, the merry-go-round is pushed and coasts, the spring rider bounces, the roof fans spin, the beacon blinks, the flag waves and the grass sways. <b>Space</b> pauses it all.'],
  ['Mouse and keyboard',
    '<code>interaction.js</code> &mdash; initInteraction, onKey, pickObject',
    'Drag to turn the camera, wheel or pinch to zoom, click any object to have it named by a ray cast. The keyboard list is on the start screen and in the hints bar.'],
  ['Task &mdash; a building [with texture]',
    '<code>building.js</code> &mdash; wallAlong, bandAlong, buildRedTower, buildGlassBlock, buildWhiteBlock, buildCourtAndStairs, buildArch',
    'Modelled on the AUST main entrance: an eight storey terracotta tower, a glass block with a rounded corner, a curved white block whose first floor sweeps out over columns, a twelve step grand staircase with planters and rails up to a raised court, and a segmental ribbed arch with a translucent canopy carrying the university name board. The glazed walls are swept along curved footprints by hand, with texture coordinates counting bays and storeys.'],
  ['Task &mdash; a playground [with texture]',
    '<code>playground.js</code>',
    'Rubber safety floor, fence with a gate arch, swings on chains, a slide whose chute is swept along a curve by hand, see-saw, merry-go-round, climbing dome built from the edges of an icosahedron, sandpit, spring rider and benches.'],
  ['Task &mdash; the camera moves around the building',
    '<code>main.js</code> updateCamera, <code>interaction.js</code> onKey',
    'By default the camera circles the building on its own. <b>&larr; &rarr;</b> (or <b>Q</b> <b>E</b>) move it round, <b>&uarr; &darr;</b> raise and lower it, <b>&minus;</b> <b>=</b> move it in and out, <b>A</b> hands it back to the automatic circle. <b>1</b>&ndash;<b>4</b> pick orbit, playground, street level and overhead.'],
  ['Task &mdash; the texture of the building changes',
    '<code>building.js</code> requestSkin, updateFacade, <code>shaders.js</code> makeFacadeMaterial',
    'Two skins are bound to the facade shader at once and a glowing, noise-edged front climbs the building from the ground to the roof, swapping one for the other. It happens every 12 s; <b>B</b> changes it now, <b>V</b> turns the timer off and on.'],
  ['Task &mdash; the light rotates around the building',
    '<code>animation.js</code> updateOrbitLight, <code>interaction.js</code> pointermove',
    'The scene\'s only light circles the building on its own, so each face comes into the light in turn and the shadows sweep round the site. Nothing marks it in the scene; the sun (or the moon at night) drawn by the sky shader sits in the light\'s direction, so it travels round the sky with it. <b>J</b> holds it or lets it run, <b>Z</b> <b>X</b> step it round by hand, <b>R</b> <b>F</b> raise and lower it, <b>O</b> changes its colour, <b>L</b> turns it off.']
];

function fillTeam() {
  UI('teamStart').innerHTML = TEAM.map(t => `<b>${t.name}</b> &nbsp;${t.id}`).join('<br>');
  UI('teamInfo').innerHTML = TEAM.map(t => `<b>${t.name}</b> ${t.id}`).join(' &nbsp;&middot;&nbsp; ');
  UI('reqRows').innerHTML = REQUIREMENTS.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
  UI('fSwatches').innerHTML = SKINS.map(() => '<i></i>').join('');
}

// HUD
let fpsAcc = 0, fpsCount = 0, fpsShown = 60, hudTimer = 0, fpsLast = 0;

function updateHUD(dt) {
  const now = performance.now();
  if (fpsLast) fpsAcc += (now - fpsLast) / 1000;
  fpsLast = now; fpsCount++;
  hudTimer += dt;
  if (hudTimer < 0.12) return;
  hudTimer = 0;
  if (fpsAcc > 0.05) { fpsShown = Math.max(1, Math.round(fpsCount / fpsAcc)); fpsAcc = 0; fpsCount = 0; }

  UI('tCam').textContent = CAM_MODES[ctl.camMode] + (orbit.auto ? ' · auto' : '');
  UI('tAngle').textContent = Math.round(wrapAngle(orbit.theta) * 180 / Math.PI) + '°';
  UI('tProj').textContent = usingPerspective ? `Perspective ${Math.round(perspCam.fov)}°` : 'Orthographic';
  UI('tLight').textContent = Math.round(orbitLight.angle * 180 / Math.PI) + '°'
    + (orbitLight.on ? (orbitLight.auto ? '' : ' · held') : ' · off');
  UI('tLightH').textContent = Math.round(orbitLight.elevation * 180 / Math.PI) + '°';

  const hour = ((((dayPhase + 0.25) % 1) + 1) % 1) * 24;
  UI('tSun').textContent = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor(hour % 1 * 60)).padStart(2, '0')}`;
  UI('tFps').textContent = fpsShown + ' fps';

  // Facade
  const shown = facade.busy ? facade.next : facade.index;
  UI('fName').textContent = SKINS[shown].name;
  const sw = UI('fSwatches').children;
  for (let i = 0; i < sw.length; i++) sw[i].classList.toggle('on', i === shown);
  if (facade.busy) {
    UI('fMeter').style.width = (facade.t / facade.dur * 100).toFixed(1) + '%';
    UI('fSub').textContent = 'changing…';
  } else if (facade.auto) {
    UI('fMeter').style.width = (facade.timer / facade.interval * 100).toFixed(1) + '%';
    UI('fSub').textContent = `next change in ${Math.ceil(facade.interval - facade.timer)} s · B now`;
  } else {
    UI('fMeter').style.width = '0%';
    UI('fSub').textContent = 'timer off · B to change';
  }
}

// Camera
const KEY_SWING = 1.1;  // Speed
const KEY_LIFT = 0.7;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), _goal = new THREE.Vector3();
let camReady = false;

function updateCamera(dt) {
  const p = preset();

  const kSwing = (keys['arrowleft'] || keys['q'] ? 1 : 0) - (keys['arrowright'] || keys['e'] ? 1 : 0);
  const kLift = (keys['arrowup'] || keys[','] ? 1 : 0) - (keys['arrowdown'] || keys['.'] ? 1 : 0);
  if (running && (kSwing || kLift)) {
    orbit.auto = false;
    orbit.theta += kSwing * dt * KEY_SWING;
    orbit.phi = clamp(orbit.phi - kLift * dt * KEY_LIFT, p.phiMin, p.phiMax);
  }

  if (!running) {
    orbit.theta += dt * 0.06;  // Title
  } else if (ctl.intro) {
    // Intro
    const it = ctl.intro;
    it.t += dt;
    const k = smoothstep(0, 1, Math.min(it.t / it.dur, 1));
    orbit.dist = orbit.distGoal = lerp(it.fromDist, p.dist, k);
    orbit.phi = lerp(it.fromPhi, p.phi, k);
    orbit.theta += dt * lerp(0.35, orbit.autoSpeed, k);
    if (it.t >= it.dur) {
      ctl.intro = null;
      toast('The camera circles the building &mdash; <b>&larr; &rarr;</b> or drag to take over, <b>B</b> changes the texture');
    }
  } else if (orbit.auto) {
    orbit.theta += dt * orbit.autoSpeed * (ctl.camMode === 1 ? 1.4 : 1);
  }

  orbit.dist += (orbit.distGoal - orbit.dist) * Math.min(1, dt * 2.5);
  orbit.target.lerp(orbit.targetGoal, Math.min(1, dt * 2.2));

  const sp = Math.sin(orbit.phi), cp = Math.cos(orbit.phi);
  _goal.set(
    orbit.target.x + Math.cos(orbit.theta) * sp * orbit.dist,
    orbit.target.y + cp * orbit.dist,
    orbit.target.z + Math.sin(orbit.theta) * sp * orbit.dist
  );
  _goal.y = Math.max(_goal.y, 1.2);  // Ground

  const look = orbit.look || orbit.target;
  if (!camReady) { camPos.copy(_goal); camLook.copy(look); camReady = true; }
  const k = ctl.dragging ? 1 : Math.min(1, dt * 6);
  camPos.lerp(_goal, k);
  camLook.lerp(look, Math.min(1, dt * 4));

  // Projection
  perspCam.position.copy(camPos); perspCam.lookAt(camLook);
  orthoCam.position.copy(camPos); orthoCam.lookAt(camLook);
  syncOrthoFrustum(Math.max(camPos.distanceTo(camLook), 5));
}

// Loop
let clock, running = false;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (ctl.dayTween) {
    const tw = ctl.dayTween;
    tw.t += dt;
    const p = clamp(tw.t / tw.dur, 0, 1);
    setDayPhase(lerp(tw.from, tw.to, p * p * (3 - 2 * p)));
    if (p >= 1) ctl.dayTween = null;
  } else if (dayAuto) {
    setDayPhase(dayPhase + dt * 0.012);
  }

  updateSky();
  animate(dt);
  updateCamera(dt);
  skyMesh.position.set(camera.position.x, 0, camera.position.z);
  skyMesh.material.uniforms.uTime.value += dt;
  updateShaderLights();

  renderer.render(scene, camera);
  if (running) updateHUD(dt);
}

// Startup
function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

async function buildTextures() {
  step(10, 'glazing the ribbon windows'); await nextFrame();
  TEX.skins = SKINS.map(s => s.build());
  TEX.windowMask = texWindowMask();
  TEX.terracotta = texTerracotta();
  TEX.redPaving = texRedPaving();

  step(26, 'pouring concrete'); await nextFrame();
  TEX.paving = texPaving();
  TEX.concrete = texConcrete(128);
  TEX.concreteLight = texConcrete(196);
  TEX.roof = texRoof();

  step(40, 'sowing the lawn'); await nextFrame();
  TEX.grass = texGrass();
  TEX.dirt = texDirt();
  TEX.tuft = texTuft();
  TEX.sand = texSand();

  step(52, 'painting the swings'); await nextFrame();
  TEX.rubber = texRubber();
  TEX.paintRed = texPaint('#c9402f');
  TEX.paintBlue = texPaint('#2f6fb7');
  TEX.paintYellow = texPaint('#f2b441');
  TEX.paintGreen = texPaint('#2f6b4a');
  TEX.paintWhite = texPaint('#dfe4e8');
  TEX.rubberSeat = texPaint('#2c2e33');
  TEX.carousel = texCarousel();

  step(64, 'rolling steel'); await nextFrame();
  TEX.metalDark = texMetal('#3a3f46');
  TEX.metalLight = texMetal('#a3aab2');
  TEX.vent = texVent();
  TEX.solar = texSolar();
  TEX.wood = texWood(168, 112, 70);

  step(74, 'planting trees'); await nextFrame();
  TEX.bark = texBark();
  TEX.leaf = texLeaf();

  step(80, 'printing the signs'); await nextFrame();
  TEX.door = texDoor();
  TEX.archSign = texArchSign('Ahsanullah University of Science And Technology');
  TEX.playSign = texPlaque('PLAYGROUND');
  TEX.flag = texFlag();
  TEX.glow = texGlow();
}

async function boot() {
  if (!hasWebGL()) { UI('fatal').classList.remove('hidden'); return; }
  fillTeam();

  step(4, 'starting the renderer'); await nextFrame();
  initRenderer();

  await buildTextures();

  step(84, 'lighting the sky'); await nextFrame();
  buildSky();
  initLights();
  placeLight(1);
  buildGround();

  step(90, 'raising the towers and the arch'); await nextFrame();
  buildBuilding();

  step(94, 'building the playground'); await nextFrame();
  buildPlayground();

  step(97, 'dressing the site'); await nextFrame();
  buildTrees();
  buildGrassTufts();
  buildStreetLamps();
  buildBenches();
  buildFlag();
  initInteraction(renderer.domElement);

  scene.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m && m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.3);
    }
  });

  step(100, 'ready');
  UI('enterTxt').innerHTML = 'Enter<br>&#8629;';
  UI('enter').disabled = false;
  UI('loadTxt').innerHTML = '<b>Ready.</b><br>Click the circle or press Enter';

  applyPreset(0);
  orbit.dist = orbit.distGoal = 105;
  orbit.phi = 1.25;
  clock = new THREE.Clock();
  updateSky();
  frame();
}

function enterScene() {
  if (running) return;
  UI('start').classList.add('away');
  UI('hud').classList.add('on');
  running = true;
  applyPreset(0, true);
  ctl.intro = { t: 0, dur: 4.2, fromDist: orbit.dist, fromPhi: orbit.phi };
}

UI('enter').addEventListener('click', enterScene);
window.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !running && !UI('enter').disabled) { e.preventDefault(); enterScene(); }
});
UI('infoClose').addEventListener('click', toggleInfo);
UI('info').addEventListener('click', e => { if (e.target === UI('info')) toggleInfo(); });

boot();

