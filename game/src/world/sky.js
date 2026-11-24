// Sky dome, sun, lights, fog and the reflection environment, all driven by the in-game hour.
import * as THREE from 'three';
import { clamp, lerp } from '../core/mathutil.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform float uStars;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uGlow * pow(sd, 6.0) * 0.9 + uGlow * pow(sd, 48.0) * 0.8;
  col += vec3(1.0, 0.92, 0.75) * smoothstep(0.9993, 0.9998, sd) * 6.0;   // sun disc
  float band = exp(-abs(h - 0.02) * 18.0);
  col += uGlow * band * 0.35;                                             // warm haze at the horizon
  vec3 cell = floor(d * 180.0);
  float star = step(0.9965, hash(cell)) * uStars * smoothstep(0.05, 0.4, h);
  col += vec3(star);
  if (d.y < 0.0) col = mix(col, uHorizon * 0.55, clamp(-d.y * 4.0, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const PALETTE = {
  day: { zenith: 0x2f6fd0, horizon: 0xb7dcff, glow: 0xfff1c9, sun: 0xfff3dd, hemi: 0xbfdcff, ground: 0x8a7b62, fog: 0xbcd6ef },
  gold: { zenith: 0x3b3f9a, horizon: 0xff9150, glow: 0xffb35c, sun: 0xffa45c, hemi: 0xffb7a0, ground: 0x6a4a5a, fog: 0xe0906a },
  night: { zenith: 0x050716, horizon: 0x2a1840, glow: 0x50306a, sun: 0x8fa6ff, hemi: 0x3a3f7a, ground: 0x1a1426, fog: 0x1d1530 },
};

function mixColor(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

export function createSky(game) {
  const { scene, renderer } = game;
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uStars: { value: 0 },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);
  scene.fog = new THREE.Fog(0xffffff, 120, 520);

  // Reflection environment: a copy of the sky dome rendered into a PMREM.
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), skyMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget = null;
  let envHour = -99;

  const sky = { night: 0, gold: 0, sunDir: uniforms.uSunDir.value, sun, hemi };

  sky.update = (hour, focus) => {
    // Sun path: rises at 6, sets at 18.6, sets in the west (-x), over the city.
    const ang = ((hour - 6.3) / 12.3) * Math.PI;
    const elev = Math.sin(ang);
    const dir = uniforms.uSunDir.value.set(-Math.cos(ang), elev, 0.35).normalize();
    const night = clamp((-elev + 0.05) / 0.25, 0, 1);
    const gold = clamp(1 - Math.abs(elev - 0.08) / 0.32, 0, 1) * (1 - night);
    sky.night = night; sky.gold = gold;
    const day = PALETTE.day, g = PALETTE.gold, n = PALETTE.night;
    const pick = (k) => mixColor(mixColor(day[k], g[k], gold), n[k], night);
    uniforms.uZenith.value.copy(pick('zenith'));
    uniforms.uHorizon.value.copy(pick('horizon'));
    uniforms.uGlow.value.copy(pick('glow')).multiplyScalar(1 - night * 0.7);
    uniforms.uStars.value = night;
    hemi.color.copy(pick('hemi'));
    hemi.groundColor.copy(pick('ground'));
    hemi.intensity = lerp(1.1, 0.55, night);
    sun.color.copy(night > 0.5 ? new THREE.Color(PALETTE.night.sun) : pick('sun'));
    sun.intensity = lerp(lerp(2.6, 3.4, gold), 0.35, night);
    scene.fog.color.copy(pick('fog'));
    scene.fog.near = lerp(140, 70, night);
    scene.fog.far = lerp(560, 330, night);
    // Light direction: never flatter than ~16 degrees so shadows stay crisp and readable.
    const lightDir = night > 0.5 ? new THREE.Vector3(0.4, 0.8, 0.3).normalize()
      : new THREE.Vector3(dir.x, Math.max(dir.y, 0.28), dir.z).normalize();
    const fx = focus ? focus.x : 0, fz = focus ? focus.z : 0;
    sun.target.position.set(fx, 0, fz);
    sun.position.set(fx + lightDir.x * 160, lightDir.y * 160, fz + lightDir.z * 160);
    dome.position.set(fx, 0, fz);
    renderer.toneMappingExposure = lerp(lerp(1.0, 1.08, gold), 0.95, night);

    if (Math.abs(hour - envHour) > 0.35) {
      envHour = hour;
      if (envTarget) envTarget.dispose();
      envTarget = pmrem.fromScene(envScene, 0.02);
      scene.environment = envTarget.texture;
    }
  };
  return sky;
}
