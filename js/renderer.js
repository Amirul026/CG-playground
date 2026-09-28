import * as THREE from 'three';
import { UI } from './helpers.js';

let renderer, scene, camera, perspCam, orthoCam;
let usingPerspective = true;
let FOV = 50;                       // field of view of the perspective camera, degrees

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  UI('viewport').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xa9bccb, 0.0036);

  /* the projection the brief asks for: a perspective camera */
  const aspect = window.innerWidth / window.innerHeight;
  perspCam = new THREE.PerspectiveCamera(FOV, aspect, 0.2, 3000);
  orthoCam = new THREE.OrthographicCamera(-30 * aspect, 30 * aspect, 30, -30, 0.2, 3000);
  camera = perspCam;
}

/* the orthographic box is sized from the perspective frustum at the distance
   of the target, so pressing P keeps the building roughly the same size */
function syncOrthoFrustum(distance) {
  const aspect = window.innerWidth / window.innerHeight;
  const halfH = Math.tan(THREE.MathUtils.degToRad(perspCam.fov) * 0.5) * distance;
  orthoCam.left = -halfH * aspect; orthoCam.right = halfH * aspect;
  orthoCam.top = halfH; orthoCam.bottom = -halfH;
  orthoCam.updateProjectionMatrix();
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  perspCam.aspect = w / h;
  perspCam.updateProjectionMatrix();
}

function setFOV(v) { FOV = v; }
function setProjection(p) {
  usingPerspective = p;
  camera = usingPerspective ? perspCam : orthoCam;
}

export { FOV, camera, initRenderer, onResize, orthoCam, perspCam, renderer, scene, setFOV, setProjection, syncOrthoFrustum, usingPerspective };
