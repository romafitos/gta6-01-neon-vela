// Visual effects from pooled buffers: fire, smoke, sparks, muzzle flashes, tracers,
// explosion fireballs with a light flash and tumbling debris.
import * as THREE from 'three';
import { rand } from '../core/rng.js';

const VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha; vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (420.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  gl_FragColor = vec4(vColor * a, a);
}`;

function makePool(scene, count, additive) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const size = new Float32Array(count), alpha = new Float32Array(count);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.CustomBlending,
  });
  if (!additive) { mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor; }
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  const parts = [];
  for (let i = 0; i < count; i++) parts.push({ life: 0, max: 1, x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, r: 1, g: 1, b: 1, r1: 1, g1: 1, b1: 1, a0: 1, drag: 0, grav: 0 });
  let head = 0;
  return {
    geo, parts,
    emit(o) {
      const p = parts[head]; head = (head + 1) % count;
      Object.assign(p, { drag: 0, grav: 0, r1: o.r, g1: o.g, b1: o.b }, o);
      p.life = p.max;
    },
    update(dt) {
      for (let i = 0; i < count; i++) {
        const p = parts[i];
        if (p.life <= 0) { alpha[i] = 0; continue; }
        p.life -= dt;
        const t = 1 - Math.max(0, p.life) / p.max;
        p.vx *= 1 - p.drag * dt; p.vz *= 1 - p.drag * dt; p.vy = p.vy * (1 - p.drag * dt) + p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        col[i * 3] = p.r + (p.r1 - p.r) * t; col[i * 3 + 1] = p.g + (p.g1 - p.g) * t; col[i * 3 + 2] = p.b + (p.b1 - p.b) * t;
        size[i] = p.s0 + (p.s1 - p.s0) * t;
        alpha[i] = p.a0 * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
    },
  };
}

export function createEffects(game) {
  const scene = game.scene;
  const glow = makePool(scene, 1400, true);
  const smokePool = makePool(scene, 700, false);

  // Tracers: a pool of line segments faded by darkening (additive black is invisible).
  const TR = 80;
  const trPos = new Float32Array(TR * 6), trCol = new Float32Array(TR * 6);
  const trGeo = new THREE.BufferGeometry();
  trGeo.setAttribute('position', new THREE.BufferAttribute(trPos, 3).setUsage(THREE.DynamicDrawUsage));
  trGeo.setAttribute('color', new THREE.BufferAttribute(trCol, 3).setUsage(THREE.DynamicDrawUsage));
  const tracers = new THREE.LineSegments(trGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  tracers.frustumCulled = false;
  scene.add(tracers);
  const trLife = new Float32Array(TR), trBase = new Float32Array(TR * 3);
  let trHead = 0;

  // Debris chunks.
  const DB = 60;
  const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.25, 0.4), new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.9 }), DB);
  debris.castShadow = true;
  debris.frustumCulled = false;
  scene.add(debris);
  const dbs = Array.from({ length: DB }, () => ({ life: 0, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, spin: 0 }));
  let dbHead = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), v3 = new THREE.Vector3();

  const flash = new THREE.PointLight(0xffa040, 0, 45, 1.6);
  scene.add(flash);
  let flashT = 0;
  game.shake = 0;

  const fx = {
    fire(x, y, z, scale = 1) {
      for (let k = 0; k < 2; k++) {
        glow.emit({ x: x + (rand() - 0.5) * scale, y, z: z + (rand() - 0.5) * scale, vx: (rand() - 0.5), vy: 2.5 + rand() * 2, vz: (rand() - 0.5), max: 0.55 + rand() * 0.3, s0: 1.6 * scale, s1: 0.4, r: 1.0, g: 0.75, b: 0.25, r1: 0.9, g1: 0.18, b1: 0.04, a0: 0.9 });
      }
      if (rand() < 0.4) fx.smoke(x, y + 1, z, scale * 0.8);
    },
    smoke(x, y, z, scale = 1) {
      const g = 0.18 + rand() * 0.1;
      smokePool.emit({ x: x + (rand() - 0.5) * scale, y, z: z + (rand() - 0.5) * scale, vx: (rand() - 0.5) * 0.8 + 0.6, vy: 1.6 + rand(), vz: (rand() - 0.5) * 0.8, max: 2.6 + rand() * 1.5, s0: 1.2 * scale, s1: 5.5 * scale, r: g, g, b: g * 1.05, a0: 0.55, drag: 0.4 });
    },
    sparks(x, y, z) {
      for (let k = 0; k < 6; k++) glow.emit({ x, y, z, vx: (rand() - 0.5) * 9, vy: rand() * 6, vz: (rand() - 0.5) * 9, max: 0.35, s0: 0.25, s1: 0.1, r: 1, g: 0.85, b: 0.4, a0: 1, grav: -18 });
    },
    impact(x, y, z) {
      fx.sparks(x, y, z);
      smokePool.emit({ x, y, z, vx: 0, vy: 0.6, vz: 0, max: 0.8, s0: 0.4, s1: 1.4, r: 0.55, g: 0.52, b: 0.48, a0: 0.5 });
    },
    hitPuff(x, y, z) {
      for (let k = 0; k < 4; k++) smokePool.emit({ x, y, z, vx: (rand() - 0.5) * 2, vy: rand() * 1.5, vz: (rand() - 0.5) * 2, max: 0.5, s0: 0.3, s1: 0.9, r: 0.75, g: 0.72, b: 0.7, a0: 0.6 });
    },
    muzzle(x, y, z, kind) {
      const big = kind === 'shotgun' || kind === 'launcher';
      glow.emit({ x, y, z, max: 0.06, s0: big ? 1.6 : 0.9, s1: 0.3, r: 1, g: 0.9, b: 0.55, a0: 1 });
    },
    tracer(a, b, color) {
      const i = trHead; trHead = (trHead + 1) % TR;
      trPos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
      const c = new THREE.Color(color);
      trBase.set([c.r, c.g, c.b], i * 3);
      trLife[i] = 0.09;
    },
    explosion(x, y, z, radius = 8) {
      game.shake = Math.max(game.shake, 1);
      flash.position.set(x, y + 2, z); flash.intensity = 1600; flashT = 0.5;
      for (let k = 0; k < 70; k++) {
        const a = rand() * Math.PI * 2, u = rand() * 2 - 1, s = 4 + rand() * 10;
        const r = Math.sqrt(1 - u * u);
        glow.emit({ x, y: y + 0.5, z, vx: Math.cos(a) * r * s, vy: Math.abs(u) * s + 2, vz: Math.sin(a) * r * s, max: 0.6 + rand() * 0.6, s0: radius * 0.55, s1: 0.8, r: 1, g: 0.9, b: 0.55, r1: 0.85, g1: 0.2, b1: 0.03, a0: 1, drag: 3 });
      }
      glow.emit({ x, y: y + 1, z, max: 0.25, s0: radius * 3.2, s1: radius * 1.5, r: 1, g: 0.95, b: 0.8, a0: 1 });
      for (let k = 0; k < 26; k++) {
        smokePool.emit({ x: x + (rand() - 0.5) * 3, y: y + rand() * 2, z: z + (rand() - 0.5) * 3, vx: (rand() - 0.5) * 6, vy: 3 + rand() * 4, vz: (rand() - 0.5) * 6, max: 3 + rand() * 2.5, s0: 3, s1: 11, r: 0.12, g: 0.11, b: 0.11, a0: 0.75, drag: 1.2 });
      }
      for (let k = 0; k < 12; k++) {
        glow.emit({ x, y: y + 0.5, z, vx: (rand() - 0.5) * 20, vy: 6 + rand() * 10, vz: (rand() - 0.5) * 20, max: 1.2, s0: 0.35, s1: 0.15, r: 1, g: 0.7, b: 0.3, a0: 1, grav: -14 });
        const d = dbs[dbHead]; dbHead = (dbHead + 1) % DB;
        Object.assign(d, { life: 4, x, y: y + 0.5, z, vx: (rand() - 0.5) * 16, vy: 6 + rand() * 9, vz: (rand() - 0.5) * 16, rx: rand() * 6, ry: rand() * 6, spin: (rand() - 0.5) * 14 });
      }
      game.emit('boom', { x, z });
    },
    update(dt) {
      glow.update(dt);
      smokePool.update(dt);
      for (let i = 0; i < TR; i++) {
        if (trLife[i] > 0) {
          trLife[i] -= dt;
          const k = Math.max(0, trLife[i] / 0.09) * 2.2;
          for (let j = 0; j < 2; j++) trCol.set([trBase[i * 3] * k, trBase[i * 3 + 1] * k, trBase[i * 3 + 2] * k], i * 6 + j * 3);
        } else if (trCol[i * 6] !== 0) trCol.fill(0, i * 6, i * 6 + 6);
      }
      trGeo.attributes.position.needsUpdate = true;
      trGeo.attributes.color.needsUpdate = true;
      for (let i = 0; i < DB; i++) {
        const d = dbs[i];
        if (d.life > 0) {
          d.life -= dt;
          d.vy -= 22 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
          if (d.y < 0.3) { d.y = 0.3; d.vy *= -0.3; d.vx *= 0.6; d.vz *= 0.6; d.spin *= 0.6; }
          d.rx += d.spin * dt; d.ry += d.spin * 0.7 * dt;
        } else d.y = -50;
        e.set(d.rx, d.ry, 0); q.setFromEuler(e); v3.set(d.x, d.y, d.z);
        m4.compose(v3, q, one); debris.setMatrixAt(i, m4);
      }
      debris.instanceMatrix.needsUpdate = true;
      if (flashT > 0) { flashT -= dt; flash.intensity = Math.max(0, flashT / 0.5) * 1600; } else flash.intensity = 0;
      game.shake = Math.max(0, game.shake - dt * 2.2);
    },
  };
  return fx;
}
