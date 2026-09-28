import * as THREE from 'three';

/* ============================================================================
   GLSL building blocks shared by the hand-written programs
   ========================================================================== */

const GLSL_NOISE = `
float hash21(vec2 p){ p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}`;

/* every lit program reads the one light; lighting.js writes it each frame */
const GLSL_LIGHTS = `
uniform vec3  uSunDir;      // toward the light that circles the building
uniform vec3  uSunColor;
uniform float uSunPower;
uniform vec3  uSkyTint;     // only for what glass reflects, it lights nothing
uniform vec3  uCamPos;
uniform vec3  uFogColor;
uniform float uFogDensity;

/* Blinn-Phong from the one light: a diffuse term and a specular term.
   There is no ambient term, because the scene has no other light */
vec3 shade(vec3 albedo, vec3 N, vec3 V, vec3 P, float shininess, float specular){
  vec3 L = normalize(uSunDir);
  float ndl = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  return uSunColor * uSunPower * ndl * (albedo + specular * pow(max(dot(N, H), 0.0), shininess));
}

vec3 addFog(vec3 col, float dist){
  float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  return mix(col, uFogColor, clamp(f, 0.0, 1.0));
}`;

const SHADED = [];
function registerShaded(mat) { SHADED.push(mat); return mat; }

function lightUniforms() {
  return {
    uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
    uSunColor: { value: new THREE.Color(1, 0.94, 0.82) },
    uSunPower: { value: 1.0 },
    uSkyTint: { value: new THREE.Color(0.45, 0.58, 0.75) },
    uCamPos: { value: new THREE.Vector3() },
    uFogColor: { value: new THREE.Color(0.66, 0.74, 0.8) },
    uFogDensity: { value: 0.0036 }
  };
}

/* the vertex stage most programs share: world position, world normal, uv */
const VERT_WORLD = `
varying vec2 vUv; varying vec3 vN; varying vec3 vWP;
void main(){
  vUv = uv;
  vN  = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/* ============================================================================
   SKY — a dome drawn from the view direction: a three stop gradient, the sun
   and its halo, a moon opposite the sun, stars and a drifting cloud layer
   ========================================================================== */
function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
      uDay: { value: 1 },
      uLightOn: { value: 1 },
      uHorizon: { value: new THREE.Color(0.86, 0.9, 0.93) },
      uZenith: { value: new THREE.Color(0.18, 0.43, 0.77) },
      uGround: { value: new THREE.Color(0.35, 0.37, 0.33) }
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      precision highp float;
      varying vec3 vDir;
      uniform float uTime, uDay, uLightOn;
      uniform vec3 uSunDir, uHorizon, uZenith, uGround;
      ${GLSL_NOISE}
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 S = normalize(uSunDir);

        vec3 mid = mix(uHorizon, uZenith, 0.45);
        vec3 col = h < 0.22 ? mix(uHorizon, mid, smoothstep(-0.05, 0.22, h))
                            : mix(mid, uZenith, smoothstep(0.22, 0.8, h));
        col = mix(uGround, col, smoothstep(-0.14, 0.01, h));

        /* the disc sits exactly in the direction of the scene's one light,
           so it travels round the sky as the light circles the building:
           the sun by day, the moon by night */
        float sd = max(dot(d, S), 0.0);
        float day = uDay * uLightOn, night = (1.0 - uDay) * uLightOn;
        col += uHorizon * pow(sd, 5.0) * 0.18 * day;               // warm halo
        col += vec3(1.0, 0.93, 0.78) * smoothstep(0.9986, 0.9997, sd) * 8.0 * day;
        col += vec3(1.0, 0.85, 0.6) * pow(sd, 300.0) * 1.5 * day;
        col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9990, 0.9996, sd) * 2.4 * night;
        col += vec3(0.3, 0.38, 0.6) * pow(sd, 60.0) * 0.25 * night;

        /* stars: one chance per cell of a grid on the dome, a small round
           point placed at random inside its cell, twinkling */
        if (h > 0.0) {
          vec2 g = d.xz / (h + 0.35) * 160.0;
          vec2 id = floor(g), f = fract(g) - 0.5;
          float r = hash21(id);
          vec2 off = (vec2(hash21(id + 7.1), hash21(id + 13.7)) - 0.5) * 0.6;
          float st = step(0.975, r) * (1.0 - smoothstep(0.03, 0.14, length(f - off)));
          float tw = 0.65 + 0.35 * sin(uTime * 2.5 + r * 60.0);
          col += vec3(0.9, 0.93, 1.0) * st * tw * (1.0 - uDay) * smoothstep(0.0, 0.15, h) * 1.8;
        }

        if (h > 0.01) {
          vec2 cp = d.xz / (h + 0.12) * 0.8 + vec2(uTime * 0.006, uTime * 0.0025);
          float c = smoothstep(0.48, 0.85, fbm(cp * 1.4)) * smoothstep(0.01, 0.28, h);
          vec3 lit = mix(vec3(0.42, 0.46, 0.56), vec3(1.0, 0.97, 0.92), uDay);
          vec3 dark = mix(vec3(0.14, 0.16, 0.22), vec3(0.62, 0.64, 0.7), uDay);
          col = mix(col, mix(dark, lit, 0.45 + 0.55 * pow(sd, 4.0)), c * 0.85);
        }

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
}

/* ============================================================================
   FACADE — the building's own program.
   Two skins are bound at once. uMix runs 0 → 1 and a wipe front climbs the
   building from the ground to the roof; below the front the new skin shows,
   above it the old one, and the front itself glows as it passes. The front is
   pushed about by noise so it reads as a painted edge rather than a ruler
   line. A shared mask marks glass and frame, so glass gets a sharper
   highlight and a sky reflection, and at night a random set of rooms light up.
   The walls are swept along curved footprints, so the program works from
   world position and normal rather than assuming a flat box.
   ========================================================================== */
function makeFacadeMaterial(skinA, mask, topY) {
  return registerShaded(new THREE.ShaderMaterial({
    uniforms: Object.assign(lightUniforms(), {
      uSkinA: { value: skinA },
      uSkinB: { value: skinA },
      uMask: { value: mask },
      uMix: { value: 0 },
      uTop: { value: topY },
      uNight: { value: 0 },
      uTime: { value: 0 }
    }),
    vertexShader: `
      attribute float aSeed;
      varying vec2 vUv; varying vec3 vN; varying vec3 vWP; varying float vSeed;
      void main(){
        vUv = uv;
        vSeed = aSeed;
        vN  = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWP = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv; varying vec3 vN; varying vec3 vWP; varying float vSeed;
      uniform sampler2D uSkinA, uSkinB, uMask;
      uniform float uMix, uTop, uNight, uTime;
      ${GLSL_LIGHTS}
      ${GLSL_NOISE}
      void main(){
        vec3 N = normalize(vN);
        vec3 V = normalize(uCamPos - vWP);
        vec4 m = texture2D(uMask, vUv);
        float glass = m.r;

        /* --- the wipe between the two skins --- */
        float h = vWP.y / uTop;
        float wob = (fbm(vec2(vWP.x + vWP.z, vWP.y) * 0.28 + uTime * 0.15) - 0.5) * 0.14;
        float front = uMix * 1.35 - 0.18;
        float hw = h + wob;
        float newSide = 1.0 - smoothstep(front - 0.012, front + 0.012, hw);
        vec3 albedo = mix(texture2D(uSkinA, vUv).rgb, texture2D(uSkinB, vUv).rgb, newSide);

        /* --- lighting: glass is darker, shinier and reflects the sky --- */
        float shin = mix(18.0, 160.0, glass);
        float spec = mix(0.06, 1.1, glass);
        vec3 col = shade(albedo * (1.0 - 0.3 * glass), N, V, vWP, shin, spec);

        vec3 R = reflect(-V, N);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 refl = mix(vec3(0.06, 0.07, 0.06), uSkyTint, smoothstep(-0.2, 0.4, R.y));
        col += refl * glass * (0.10 + 0.7 * fres);

        /* --- rooms that are lit at night. One random number per window,
               taken from the bay, the storey and a seed for each wall, so a
               window on a curved wall stays one colour all the way across --- */
        vec2 cell = floor(vUv);
        float sd = floor(vSeed + 0.5);          // whole numbers: interpolation must not wobble it
        float id = hash21(cell + vec2(sd * 37.0, sd * 11.0));
        float slot = floor(uTime / 40.0 + id * 5.0);                   // a few rooms switch every so often
        float on = step(0.45, hash21(vec2(id * 91.0, slot)));
        vec3 warm = mix(vec3(1.0, 0.72, 0.40), vec3(0.78, 0.86, 1.0), step(0.82, fract(id * 17.0)));
        float fy = fract(vUv.y);
        float roomGrad = 0.55 + 0.45 * smoothstep(0.3, 0.86, fy);      // ceiling light brighter at the top
        col = mix(col, warm * roomGrad * 1.35, glass * on * uNight * 0.92);

        /* --- the glowing edge of the wipe --- */
        float wiping = step(0.001, uMix) * step(uMix, 0.999);
        float seam = 1.0 - smoothstep(0.0, 0.022, abs(hw - front));
        col += vec3(1.0, 0.62, 0.30) * seam * wiping * 1.5;

        col = addFog(col, length(uCamPos - vWP));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
}

/* ============================================================================
   FLAG — a travelling wave in the vertex shader. The wave grows away from the
   pole (uv.x = 0) and the normal is rebuilt from the slope of the wave.
   ========================================================================== */
function makeFlagMaterial(map) {
  return registerShaded(new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: Object.assign(lightUniforms(), { map: { value: map }, uTime: { value: 0 } }),
    vertexShader: `
      varying vec2 vUv; varying vec3 vN; varying vec3 vWP;
      uniform float uTime;
      void main(){
        vUv = uv;
        vec3 p = position;
        float k = uv.x;
        float ph = uv.x * 7.0 - uTime * 5.5 + uv.y * 1.2;
        p.z += sin(ph) * 0.22 * k;
        p.y -= k * k * 0.18;                                     // sags a little at the fly end
        float slope = cos(ph) * 0.22 * k * 7.0 / 3.0;
        vec3 n = normalize(vec3(-slope, 0.0, 1.0));
        vN = normalize(mat3(modelMatrix) * n);
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWP = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv; varying vec3 vN; varying vec3 vWP;
      uniform sampler2D map;
      ${GLSL_LIGHTS}
      void main(){
        vec3 V = normalize(uCamPos - vWP);
        vec3 N = normalize(vN);
        if (dot(N, V) < 0.0) N = -N;                             // lit from both sides
        vec3 base = texture2D(map, vUv).rgb;
        vec3 col = shade(base, N, V, vWP, 12.0, 0.08);
        col = addFog(col, length(uCamPos - vWP));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
}

/* ============================================================================
   GRASS TUFTS — one instanced quad pair per tuft, bent by the wind. The bend
   grows with height (uv.y) so the roots stay planted.
   ========================================================================== */
function makeGrassMaterial(map) {
  return registerShaded(new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: Object.assign(lightUniforms(), { map: { value: map }, uTime: { value: 0 } }),
    vertexShader: `
      varying vec2 vUv; varying vec3 vWP;
      uniform float uTime;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        float bend = pow(uv.y, 1.6) * 0.38;
        float w = sin(uTime * 1.7 + wp.x * 0.2 + wp.z * 0.15) + 0.4 * sin(uTime * 3.9 + wp.z * 0.5);
        wp.x += w * bend * 0.35;
        wp.z += w * bend * 0.2;
        vWP = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv; varying vec3 vWP;
      uniform sampler2D map;
      ${GLSL_LIGHTS}
      void main(){
        vec4 t = texture2D(map, vUv);
        if (t.a < 0.45) discard;
        vec3 N = vec3(0.0, 1.0, 0.0);
        vec3 V = normalize(uCamPos - vWP);
        vec3 col = shade(t.rgb, N, V, vWP, 8.0, 0.0);
        col *= 0.75 + 0.25 * vUv.y;                              // darker near the soil
        col = addFog(col, length(uCamPos - vWP));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
}

/* ============================================================================
   LAWN — the standard material, extended. The grass texture is mixed with a
   copy of itself at a much larger scale so the repeat disappears, mowing
   stripes are laid across the lawn near the building, and the soil shows
   through where people walk to the playground gate.
   ========================================================================== */
function attachLawnShader(mat, dirtTex) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDirt = { value: dirtTex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldP;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDirt;
        varying vec3 vWorldP;
        ${GLSL_NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 w = vWorldP.xz;
          vec3 broad = texture2D(map, w * 0.011).rgb;
          diffuseColor.rgb *= 0.72 + broad * 0.62;

          /* mowing stripes, fading out away from the site */
          float near = 1.0 - smoothstep(60.0, 95.0, length(w - vec2(0.0, 12.0)));
          float stripe = step(0.5, fract(w.x / 7.0));
          diffuseColor.rgb *= 1.0 + (stripe - 0.5) * 0.13 * near;

          /* a worn patch in front of each bench and along the desire line to the gate */
          float n = fbm(w * 0.35);
          float wear = 0.0;
          wear = max(wear, 1.0 - smoothstep(0.6, 2.4, abs(w.x - 21.5) + max(0.0, abs(w.y - 26.0) - 7.0)));
          wear = max(wear, 1.0 - smoothstep(1.0, 3.2, length(w - vec2(-24.0, 36.0))));
          wear *= smoothstep(0.35, 0.65, n + 0.2);
          vec3 soil = texture2D(uDirt, w * 0.25).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, soil, clamp(wear, 0.0, 1.0));
        }`);
  };
  mat.customProgramCacheKey = () => 'lawn-v1';
  return mat;
}

/* ============================================================================
   PLAYGROUND FLOOR — the standard material again. The grey rubber texture is
   tinted by zone (green under the swings, blue under the slide...), laid out
   in tiles, and the games are painted on in the shader: a hopscotch and a
   grid of spots, so they stay crisp however close the camera gets.
   ========================================================================== */
function attachRubberShader(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldP;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldP;
        float gPaint = 0.0;
        float box(vec2 p, vec2 c, vec2 hs){ vec2 d = abs(p - c) - hs; return max(d.x, d.y); }
        float outline(float sd, float w){ return 1.0 - smoothstep(0.0, 0.02, abs(sd) - w); }`)
      .replace('#include <map_fragment>', `
        {
          vec2 w = vWorldP.xz;
          float grain = texture2D(map, w * 0.5).r;

          /* zones: terracotta by default, green and blue under the equipment */
          vec3 zone = vec3(0.62, 0.24, 0.16);
          if (box(w, vec2(-12.0, 42.0), vec2(5.0, 4.6)) < 0.0) zone = vec3(0.22, 0.46, 0.25);
          if (length(w - vec2(12.0, 29.0)) < 4.6) zone = vec3(0.22, 0.46, 0.25);
          if (box(w, vec2(11.5, 43.0), vec2(5.5, 3.0)) < 0.0) zone = vec3(0.16, 0.33, 0.56);
          if (length(w - vec2(3.0, 38.0)) < 3.3) zone = vec3(0.16, 0.33, 0.56);
          diffuseColor.rgb = zone * (0.62 + 0.75 * grain);

          /* one metre tiles */
          vec2 f = abs(fract(w) - 0.5);
          float grout = smoothstep(0.485, 0.5, max(f.x, f.y));
          diffuseColor.rgb *= 1.0 - grout * 0.3;

          /* hopscotch: single, single, double, single, double, half circle */
          float paint = 0.0;
          vec2 hp = w - vec2(0.0, 24.0);
          paint = max(paint, outline(box(hp, vec2(0.0, 0.5), vec2(0.5, 0.5)), 0.03));
          paint = max(paint, outline(box(hp, vec2(0.0, 1.5), vec2(0.5, 0.5)), 0.03));
          paint = max(paint, outline(box(hp, vec2(-0.5, 2.5), vec2(0.5, 0.5)), 0.03));
          paint = max(paint, outline(box(hp, vec2(0.5, 2.5), vec2(0.5, 0.5)), 0.03));
          paint = max(paint, outline(box(hp, vec2(0.0, 3.5), vec2(0.5, 0.5)), 0.03));
          paint = max(paint, outline(box(hp, vec2(-0.5, 4.5), vec2(0.5, 0.5)), 0.03));
          paint = max(paint, outline(box(hp, vec2(0.5, 4.5), vec2(0.5, 0.5)), 0.03));
          vec2 top = hp - vec2(0.0, 5.0);
          if (top.y > 0.0) paint = max(paint, outline(length(top) - 0.9, 0.03));

          /* a grid of coloured spots */
          vec3 spotCol = vec3(0.0);
          float spot = 0.0;
          vec2 sp = w - vec2(-6.5, 26.0);
          if (sp.x > -0.1 && sp.x < 4.1 && sp.y > -0.1 && sp.y < 4.1) {
            vec2 cell = floor(sp);
            vec2 c = fract(sp) - 0.5;
            spot = 1.0 - smoothstep(0.30, 0.33, length(c));
            int k = int(mod(cell.x, 4.0));
            spotCol = k == 0 ? vec3(0.85, 0.2, 0.15) : k == 1 ? vec3(0.95, 0.75, 0.15)
                    : k == 2 ? vec3(0.2, 0.55, 0.85) : vec3(0.3, 0.7, 0.3);
            if (cell.x > 3.5 || cell.y > 3.5) spot = 0.0;
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, spotCol, spot);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.9, 0.84), paint);
          gPaint = max(paint, spot);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.55, gPaint);`);
  };
  mat.customProgramCacheKey = () => 'rubber-v1';
  return mat;
}

export { SHADED, attachLawnShader, attachRubberShader, makeFacadeMaterial, makeFlagMaterial, makeGrassMaterial, makeSkyMaterial };
