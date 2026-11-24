// Low-poly car models: a painted body mesh, a merged detail mesh (glass, wheels, trim) and a
// light mesh (head/tail lights, police light bar) that glows unaffected by tone mapping.
import * as THREE from 'three';
import { mergeColored, boxPart, cylPart } from '../core/geometry.js';

export const CAR_KINDS = {
  sedan: { len: 4.5, wid: 2.0, hgt: 1.25, cab: 0.55, maxSpeed: 31, accel: 11, mass: 1.0, hp: 100, label: 'Solaris Sedan' },
  sports: { len: 4.4, wid: 2.05, hgt: 1.0, cab: 0.45, maxSpeed: 44, accel: 17, mass: 0.9, hp: 90, label: 'Vento GT' },
  muscle: { len: 4.7, wid: 2.1, hgt: 1.15, cab: 0.5, maxSpeed: 39, accel: 15, mass: 1.15, hp: 115, label: 'Bravado Rumbler' },
  van: { len: 5.2, wid: 2.2, hgt: 2.1, cab: 0.95, maxSpeed: 25, accel: 8, mass: 1.6, hp: 150, label: 'Coastline Van' },
  taxi: { len: 4.5, wid: 2.0, hgt: 1.25, cab: 0.55, maxSpeed: 31, accel: 11, mass: 1.0, hp: 100, label: 'Vela Cab' },
  police: { len: 4.7, wid: 2.05, hgt: 1.2, cab: 0.55, maxSpeed: 41, accel: 16, mass: 1.3, hp: 140, label: 'VPD Interceptor' },
  armored: { len: 5.6, wid: 2.4, hgt: 2.3, cab: 0.9, maxSpeed: 23, accel: 7, mass: 2.2, hp: 260, label: 'Ironclad Courier' },
};

const bodyCache = new Map();
const detailCache = new Map();
const lightCache = new Map();
const paintMats = new Map();

export const lightMats = {
  head: new THREE.MeshBasicMaterial({ color: 0xfff6d8, toneMapped: false }),
  tail: new THREE.MeshBasicMaterial({ color: 0xff2030, toneMapped: false }),
  red: new THREE.MeshBasicMaterial({ color: 0xff1030, toneMapped: false }),
  blue: new THREE.MeshBasicMaterial({ color: 0x1060ff, toneMapped: false }),
};
const detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.4 });
const wreckMat = new THREE.MeshStandardMaterial({ color: 0x1c1a19, roughness: 1 });

export function paintMaterial(hex) {
  if (!paintMats.has(hex)) {
    paintMats.set(hex, new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.28, metalness: 0.55, clearcoat: 1.0, clearcoatRoughness: 0.08 }));
  }
  return paintMats.get(hex);
}

function bodyGeometry(kind) {
  if (bodyCache.has(kind)) return bodyCache.get(kind);
  const k = CAR_KINDS[kind];
  const L = k.len, W = k.wid, H = k.hgt;
  const parts = [boxPart(W, H * 0.55, L, 0, 0.35 + H * 0.27, 0, 0xffffff)];
  if (kind === 'van' || kind === 'armored') {
    parts.push(boxPart(W * 0.98, H * 0.55, L * 0.72, 0, 0.35 + H * 0.78, -L * 0.12, 0xffffff));
  } else {
    parts.push(boxPart(W * 0.86, k.cab, L * 0.5, 0, 0.35 + H * 0.55 + k.cab / 2, -L * 0.05, 0xffffff));
    if (kind === 'sports') parts.push(boxPart(W * 0.9, 0.08, 0.5, 0, 0.35 + H * 0.62, -L / 2 + 0.25, 0xffffff));
  }
  const g = mergeColored(parts);
  bodyCache.set(kind, g);
  return g;
}

function detailGeometry(kind) {
  if (detailCache.has(kind)) return detailCache.get(kind);
  const k = CAR_KINDS[kind];
  const L = k.len, W = k.wid, H = k.hgt;
  const glass = 0x16202c, rubber = 0x121214, chrome = 0xc8ccd2;
  const parts = [];
  const cabY = 0.35 + H * 0.55 + k.cab / 2;
  if (kind === 'van' || kind === 'armored') {
    parts.push(boxPart(W * 0.9, H * 0.3, 0.06, 0, 0.35 + H * 0.82, L * 0.24 + 0.01, glass, -0.15, 0, 0));
    parts.push(boxPart(0.06, H * 0.26, L * 0.2, W * 0.495, 0.35 + H * 0.82, L * 0.12, glass));
    parts.push(boxPart(0.06, H * 0.26, L * 0.2, -W * 0.495, 0.35 + H * 0.82, L * 0.12, glass));
  } else {
    parts.push(boxPart(W * 0.8, k.cab * 0.8, 0.06, 0, cabY, L * 0.2 + 0.02, glass, -0.5, 0, 0));
    parts.push(boxPart(W * 0.8, k.cab * 0.8, 0.06, 0, cabY, -L * 0.3 - 0.02, glass, 0.5, 0, 0));
    parts.push(boxPart(0.05, k.cab * 0.7, L * 0.44, W * 0.435, cabY, -L * 0.05, glass));
    parts.push(boxPart(0.05, k.cab * 0.7, L * 0.44, -W * 0.435, cabY, -L * 0.05, glass));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(cylPart(0.42, 0.42, 0.32, 10, sx * (W / 2 - 0.12), 0.42, sz * L * 0.32, rubber, 0, 0, Math.PI / 2));
    parts.push(cylPart(0.24, 0.24, 0.34, 8, sx * (W / 2 - 0.1), 0.42, sz * L * 0.32, chrome, 0, 0, Math.PI / 2));
  }
  parts.push(boxPart(W * 1.01, 0.18, 0.2, 0, 0.42, L / 2, 0x222226));
  parts.push(boxPart(W * 1.01, 0.18, 0.2, 0, 0.42, -L / 2, 0x222226));
  if (kind === 'taxi') parts.push(boxPart(0.9, 0.25, 0.4, 0, cabY + k.cab / 2 + 0.12, -L * 0.05, 0xfff2a8));
  if (kind === 'police') {
    parts.push(boxPart(W * 1.0, 0.36, L * 0.3, 0, 0.35 + H * 0.3, 0.1, 0xf4f4f4));
  }
  if (kind === 'armored') parts.push(boxPart(W * 1.02, 0.25, L * 0.6, 0, 0.35 + H * 0.45, -L * 0.1, 0x3a3f44));
  const g = mergeColored(parts);
  detailCache.set(kind, g);
  return g;
}

function lightGeometries(kind) {
  if (lightCache.has(kind)) return lightCache.get(kind);
  const k = CAR_KINDS[kind];
  const L = k.len, W = k.wid, H = k.hgt;
  const y = 0.35 + H * 0.38;
  const head = mergeColored([boxPart(0.42, 0.16, 0.06, W * 0.33, y, L / 2 + 0.02, 0xffffff), boxPart(0.42, 0.16, 0.06, -W * 0.33, y, L / 2 + 0.02, 0xffffff)]);
  const tail = mergeColored([boxPart(0.45, 0.14, 0.06, W * 0.33, y, -L / 2 - 0.02, 0xffffff), boxPart(0.45, 0.14, 0.06, -W * 0.33, y, -L / 2 - 0.02, 0xffffff)]);
  let red = null, blue = null;
  if (kind === 'police') {
    const top = 0.35 + H * 0.55 + k.cab + 0.1;
    red = mergeColored([boxPart(0.6, 0.18, 0.3, 0.35, top, -L * 0.05, 0xffffff)]);
    blue = mergeColored([boxPart(0.6, 0.18, 0.3, -0.35, top, -L * 0.05, 0xffffff)]);
  }
  const out = { head, tail, red, blue };
  lightCache.set(kind, out);
  return out;
}

export function buildCarMesh(kind, color) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(bodyGeometry(kind), paintMaterial(color));
  body.castShadow = true; body.receiveShadow = true;
  const detail = new THREE.Mesh(detailGeometry(kind), detailMat);
  detail.castShadow = true;
  const lg = lightGeometries(kind);
  group.add(body, detail, new THREE.Mesh(lg.head, lightMats.head), new THREE.Mesh(lg.tail, lightMats.tail));
  if (lg.red) {
    const r = new THREE.Mesh(lg.red, lightMats.red), b = new THREE.Mesh(lg.blue, lightMats.blue);
    group.add(r, b);
    group.userData.bar = [r, b];
  }
  group.userData.body = body;
  group.userData.detail = detail;
  return group;
}

export function wreckMesh(group) {
  group.userData.body.material = wreckMat;
  group.userData.detail.material = wreckMat;
  for (const c of group.children) if (c.material && c.material.isMeshBasicMaterial) c.visible = false;
}
