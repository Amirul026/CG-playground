import * as THREE from 'three';
import { lerp, wrapAngle } from './helpers.js';
import { nightFactor, orbitLight, placeLight } from './lighting.js';
import { setNight, updateFacade, updateRoof } from './building.js';
import { play } from './playground.js';
import { flagMat, grassMat } from './world.js';

/* one place for every moving thing in the scene; main.js calls animate()
   once a frame with the frame time and the running clock */

let timeScale = 1;                  // Space pauses the animations
function setTimeScale(v) { timeScale = v; }

/* ---------------------------------------------------------------------------
   THE LIGHT — requirement 4, and the only light in the scene. While it runs
   on its own its angle advances at orbitLight.speed; J holds it, Z / X step
   it by hand. lighting.js placeLight turns the angle into a position on the
   circle round the building.
   --------------------------------------------------------------------------- */
function updateOrbitLight(dt) {
  if (orbitLight.auto) orbitLight.angle = wrapAngle(orbitLight.angle + dt * orbitLight.speed);
  placeLight(dt);
}

/* ---------------------------------------------------------------------------
   PLAYGROUND
   --------------------------------------------------------------------------- */
function updatePlayground(t, dt) {
  /* each swing is a pendulum: theta(t) = A sin(omega t + phase), where
     omega = sqrt(g / L), with a slow swell on the amplitude */
  for (const s of play.swings) {
    const swell = 0.8 + 0.2 * Math.sin(t * 0.13 + s.phase);
    s.pivot.rotation.x = s.amp * swell * Math.sin(s.omega * t + s.phase);
  }

  /* the see-saw rests on the ground at each end of its travel for a moment */
  const raw = Math.sin(t * 1.25);
  const eased = Math.sign(raw) * Math.pow(Math.abs(raw), 0.6);
  play.seesaw.rotation.z = eased * 0.21;

  /* the merry-go-round is pushed up to speed, coasts, and is pushed again */
  const push = Math.max(0, Math.sin(t * 0.35));
  play.carouselSpin = lerp(play.carouselSpin, 0.4 + push * 1.6, Math.min(1, dt * 0.8));
  play.carousel.rotation.y += play.carouselSpin * dt;

  /* the spring rider bobs and rocks */
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
