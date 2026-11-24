// Builds one vertex-coloured BufferGeometry from several primitive parts, so a car or a person
// is a single draw call.
import * as THREE from 'three';

export function mergeColored(parts) {
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  for (const part of parts) {
    let g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    if (part.matrix) g.applyMatrix4(part.matrix);
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    c.set(part.color);
    for (let i = 0; i < p.length; i += 3) {
      pos.push(p[i], p[i + 1], p[i + 2]);
      nor.push(n[i], n[i + 1], n[i + 2]);
      col.push(c.r, c.g, c.b);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const s = new THREE.Vector3();
const v = new THREE.Vector3();

// A box part: size (w,h,d) centred at (x,y,z), optional rotation (rx, ry, rz).
export function boxPart(w, h, d, x, y, z, color, rx = 0, ry = 0, rz = 0) {
  e.set(rx, ry, rz); q.setFromEuler(e); s.set(1, 1, 1); v.set(x, y, z);
  return { geo: new THREE.BoxGeometry(w, h, d), color, matrix: new THREE.Matrix4().compose(v, q, s) };
}

export function cylPart(rTop, rBot, h, seg, x, y, z, color, rx = 0, ry = 0, rz = 0) {
  e.set(rx, ry, rz); q.setFromEuler(e); s.set(1, 1, 1); v.set(x, y, z);
  return { geo: new THREE.CylinderGeometry(rTop, rBot, h, seg), color, matrix: new THREE.Matrix4().compose(v, q, s) };
}

export function spherePart(r, x, y, z, color, sx = 1, sy = 1, sz = 1) {
  q.identity(); s.set(sx, sy, sz); v.set(x, y, z);
  return { geo: new THREE.SphereGeometry(r, 8, 6), color, matrix: m4.clone().compose(v, q, s) };
}

// A soft round sprite texture drawn on a canvas: glow halos, smoke puffs, fire.
export function makeGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.55)'));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
