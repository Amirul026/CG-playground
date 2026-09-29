import * as THREE from 'three';
import { lerp, wrapAngle } from './helpers.js';
import { nightFactor, orbitLight, placeLight } from './lighting.js';
import { setNight, updateFacade, updateRoof } from './building.js';
import { play } from './playground.js';
import { flagMat, grassMat } from './world.js';

let timeScale = 1;  // Pause
function setTimeScale(v) { timeScale = v; }

// Light
function updateOrbitLight(dt) {
  if (orbitLight.auto) orbitLight.angle = wrapAngle(orbitLight.angle + dt * orbitLight.speed);
  placeLight(dt);
}

// Playground
function updatePlayground(t, dt) {
  for (const s of play.swings) {
    const swell = 0.8 + 0.2 * Math.sin(t * 0.13 + s.phase);
    s.pivot.rotation.x = s.amp * swell * Math.sin(s.omega * t + s.phase);
  }

  // Seesaw
  const raw = Math.sin(t * 1.25);
  const eased = Math.sign(raw) * Math.pow(Math.abs(raw), 0.6);
  play.seesaw.rotation.z = eased * 0.21;

  // Carousel
  const push = Math.max(0, Math.sin(t * 0.35));
  play.carouselSpin = lerp(play.carouselSpin, 0.4 + push * 1.6, Math.min(1, dt * 0.8));
  play.carousel.rotation.y += play.carouselSpin * dt;

  // Rider
  const r = play.springRider;
  r.rotation.z = Math.sin(t * 3.1) * 0.18;
  r.rotation.x = Math.sin(t * 2.3 + 1.0) * 0.06;
  r.position.y = 0.55 + Math.abs(Math.sin(t * 3.1)) * 0.03;
}

let clockT = 0;
function animate(dt) {
  const sdt = dt * timeScale;
  clockT += sdt;

  updateOrbitLight(sdt);
  updateFacade(sdt, clockT);
  setNight(nightFactor);
  updateRoof(sdt, clockT);
  updatePlayground(clockT, sdt);

  flagMat.uniforms.uTime.value = clockT;
  grassMat.uniforms.uTime.value = clockT;
}

export { animate, setTimeScale, timeScale, updateOrbitLight };
