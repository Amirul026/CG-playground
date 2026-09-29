import * as THREE from 'three';
import { TAU, lerp, smoothstep } from './helpers.js';
import { SHADED } from './shaders.js';
import { camera, renderer, scene } from './renderer.js';

const SITE_CENTER = new THREE.Vector3(1, 0, -3);
const LIGHT_DISTANCE = 130;         

let sun = null;                      
let skyMat = null;
const glowHeads = [];                

const orbitLight = {
  angle: 0.6,          
  elevation: 0.72,    
  speed: 0.22,         
  auto: true,          
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

let ambientLight = null;

function initLights() {
  sun = new THREE.DirectionalLight(LIGHT_COLOURS[0].hex, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 280;
  sun.shadow.camera.left = -58; sun.shadow.camera.right = 58;
  sun.shadow.camera.top = 58; sun.shadow.camera.bottom = -58;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.4;
  sun.target.position.set(1, 0, 12);      
  scene.add(sun);
  scene.add(sun.target);

 
  ambientLight = new THREE.AmbientLight(0x9fb4e8, 0.18);
  scene.add(ambientLight);
}

function addGlowHead(mat) { glowHeads.push(mat); }
function setSkyMaterial(m) { skyMat = m; }

const lightDir = new THREE.Vector3();
const _col = new THREE.Color(), _moon = new THREE.Color(0x9fb4e8);

function placeLight(dt) {
  const a = orbitLight.angle, e = orbitLight.elevation;
  lightDir.set(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));
  sun.position.set(
    SITE_CENTER.x + lightDir.x * LIGHT_DISTANCE,
    lightDir.y * LIGHT_DISTANCE,
    SITE_CENTER.z + lightDir.z * LIGHT_DISTANCE
  );
 
  _col.setHex(LIGHT_COLOURS[orbitLight.colourIndex].hex).lerp(_moon, 1 - dayFactor);
  sun.color.lerp(_col, Math.min(1, dt * 4));
  sun.intensity = orbitLight.on ? lerp(0.75, 3.2, dayFactor) : 0;
  sun.castShadow = orbitLight.on && orbitLight.shadows;
}

let dayPhase = 0.30;             
let dayAuto = false;
let dayFactor = 1, nightFactor = 0;

const FOG_DAY = new THREE.Color(0xaec0cf);
const FOG_DUSK = new THREE.Color(0xc79470);
const FOG_NIGHT = new THREE.Color(0x151d31);
const ZEN_DAY = new THREE.Color(0x2c6cc2), ZEN_NIGHT = new THREE.Color(0x050b18);
const HOR_DAY = new THREE.Color(0xdde7ee), HOR_DUSK = new THREE.Color(0xf29a52), HOR_NIGHT = new THREE.Color(0x172239);
const _fog = new THREE.Color(), _sky = new THREE.Color();

function updateSky() {
  const h = Math.sin(dayPhase * TAU) * 0.92;         
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

  
  for (const m of glowHeads) m.emissiveIntensity = 0.1 + nightFactor * 3.0;

  
  if (ambientLight) {
    ambientLight.color.set(dayFactor > 0.5 ? 0xb8cfe8 : 0x9fb4e8);
    ambientLight.intensity = lerp(0.18, 0.06, dayFactor);  
  }
}

const _ambient = new THREE.Color();

function updateShaderLights() {
  
  const ambDay = 0.13, ambNight = 0.22;
  _ambient.copy(_sky).multiplyScalar(lerp(ambNight, ambDay, dayFactor));

  for (const m of SHADED) {
    const u = m.uniforms;
    u.uSunDir.value.copy(lightDir);
    u.uSunColor.value.copy(sun.color);
    u.uSunPower.value = sun.intensity * 0.21;   
    u.uSkyTint.value.copy(_sky).lerp(scene.fog.color, 0.4);
    u.uCamPos.value.copy(camera.position);
    u.uFogColor.value.copy(scene.fog.color);
    u.uFogDensity.value = scene.fog.density;
    u.uAmbient.value.copy(_ambient);
  }
}

function setDayAuto(v) { dayAuto = v; }
function setDayPhase(v) { dayPhase = v; }

export {
  LIGHT_COLOURS, SITE_CENTER, addGlowHead, dayAuto, dayFactor, dayPhase, initLights, lightDir,
  nightFactor, orbitLight, placeLight, setDayAuto, setDayPhase, setSkyMaterial, sun, updateShaderLights, updateSky
};
