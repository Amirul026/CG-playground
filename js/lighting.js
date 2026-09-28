import * as THREE from 'three';
import { TAU, lerp, smoothstep } from './helpers.js';
import { SHADED } from './shaders.js';
import { camera, renderer, scene } from './renderer.js';

/* ----------------------------------------------------------------------------
   ONE LIGHT. The brief says the light position rotates around the building,
   so the scene has exactly one light source: a directional light whose
   position circles the building. There is no ambient light, no hemisphere
   light, no environment map, no lamp posts that light anything. The side of
   the building facing away from the light is in its own shadow, and as the
   light goes round, each face comes into the light in turn.

   Nothing marks the light in the scene itself; the sun disc painted by the
   sky shader sits in the light's direction, so you can see where the light
   is by looking at the sky.
   ---------------------------------------------------------------------------- */

/* the centre of the building footprint; the light and the camera both circle it */
const SITE_CENTER = new THREE.Vector3(1, 0, -22);
const LIGHT_DISTANCE = 170;          // how far out the light sits, metres

let sun = null;                      // the one light
let skyMat = null;
const glowHeads = [];                // street lamp heads: they glow, they do not light

/* --- the light the brief asks for: its position rotates around the building --- */
const orbitLight = {
  angle: 0.6,          // radians around the building
  elevation: 0.72,     // radians above the horizon
  speed: 0.22,         // radians per second while it runs on its own
  auto: true,          // false while it is held or stepped by hand (J, Z / X)
  on: true,
  shadows: true,
  colourIndex: 0
};
const LIGHT_COLOURS = [
  { name: 'sunlight', hex: 0xfff0da },
  { name: 'golden', hex: 0xffc27a },
  { name: 'cool white', hex: 0xe4ecff },
  { name: 'rose', hex: 0xff9fb8 }
];

function initLights() {
  sun = new THREE.DirectionalLight(LIGHT_COLOURS[0].hex, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 360;
  sun.shadow.camera.left = -78; sun.shadow.camera.right = 78;
  sun.shadow.camera.top = 78; sun.shadow.camera.bottom = -78;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.4;
  sun.target.position.set(2, 0, -11);     // middle of campus + playground, so both stay in the shadow map
  scene.add(sun);
  scene.add(sun.target);
}

function addGlowHead(mat) { glowHeads.push(mat); }
function setSkyMaterial(m) { skyMat = m; }

/* the unit vector from the site toward the light */
const lightDir = new THREE.Vector3();
const _col = new THREE.Color(), _moon = new THREE.Color(0x9fb4e8);

/* place the light on its circle; called every frame by animation.js */
function placeLight(dt) {
  const a = orbitLight.angle, e = orbitLight.elevation;
  lightDir.set(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));
  sun.position.set(
    SITE_CENTER.x + lightDir.x * LIGHT_DISTANCE,
    lightDir.y * LIGHT_DISTANCE,
    SITE_CENTER.z + lightDir.z * LIGHT_DISTANCE
  );
  /* by day the chosen colour, by night the same light turns into moonlight */
  _col.setHex(LIGHT_COLOURS[orbitLight.colourIndex].hex).lerp(_moon, 1 - dayFactor);
  sun.color.lerp(_col, Math.min(1, dt * 4));
  sun.intensity = orbitLight.on ? lerp(0.75, 3.2, dayFactor) : 0;
  sun.castShadow = orbitLight.on && orbitLight.shadows;
}

/* ============================================================================
   TIME OF DAY — day and night change only the colour and strength of the one
   light and the colours of the sky and the fog; where the light is, is
   decided by the orbit above
   ========================================================================== */
let dayPhase = 0.30;              // 0 sunrise · 0.25 noon · 0.5 sunset · 0.75 midnight
let dayAuto = false;
let dayFactor = 1, nightFactor = 0;

const FOG_DAY = new THREE.Color(0xaec0cf);
const FOG_DUSK = new THREE.Color(0xc79470);
const FOG_NIGHT = new THREE.Color(0x151d31);
const ZEN_DAY = new THREE.Color(0x2c6cc2), ZEN_NIGHT = new THREE.Color(0x050b18);
const HOR_DAY = new THREE.Color(0xdde7ee), HOR_DUSK = new THREE.Color(0xf29a52), HOR_NIGHT = new THREE.Color(0x172239);
const _fog = new THREE.Color(), _sky = new THREE.Color();

function updateSky() {
  const h = Math.sin(dayPhase * TAU) * 0.92;         // how high the day is
  dayFactor = smoothstep(-0.08, 0.22, h);
  nightFactor = 1 - smoothstep(-0.05, 0.12, h);
  const dusk = 1 - smoothstep(0.0, 0.32, Math.abs(h));

  _fog.copy(FOG_NIGHT).lerp(FOG_DAY, dayFactor).lerp(FOG_DUSK, dusk * dayFactor * 0.8);
  scene.fog.color.copy(_fog);
  renderer.setClearColor(_fog);
  _sky.copy(ZEN_NIGHT).lerp(ZEN_DAY, dayFactor);

  if (skyMat) {
    const u = skyMat.uniforms;
    u.uSunDir.value.copy(lightDir);
    u.uDay.value = dayFactor;
    u.uLightOn.value = orbitLight.on ? 1 : 0;
    u.uZenith.value.copy(_sky);
    u.uHorizon.value.copy(HOR_NIGHT).lerp(HOR_DAY, dayFactor).lerp(HOR_DUSK, dusk * dayFactor);
    u.uGround.value.copy(_fog);
  }

  /* lamp heads and the like glow at night; they are emissive, not lights */
  for (const m of glowHeads) m.emissiveIntensity = 0.1 + nightFactor * 3.0;
}

/* push the one light into every hand-written shader */
function updateShaderLights() {
  for (const m of SHADED) {
    const u = m.uniforms;
    u.uSunDir.value.copy(lightDir);
    u.uSunColor.value.copy(sun.color);
    u.uSunPower.value = sun.intensity * 0.36;
    u.uSkyTint.value.copy(_sky).lerp(scene.fog.color, 0.4);
    u.uCamPos.value.copy(camera.position);
    u.uFogColor.value.copy(scene.fog.color);
    u.uFogDensity.value = scene.fog.density;
  }
}

function setDayAuto(v) { dayAuto = v; }
function setDayPhase(v) { dayPhase = v; }

export {
  LIGHT_COLOURS, SITE_CENTER, addGlowHead, dayAuto, dayFactor, dayPhase, initLights, lightDir,
  nightFactor, orbitLight, placeLight, setDayAuto, setDayPhase, setSkyMaterial, sun, updateShaderLights, updateSky
};
