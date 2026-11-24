// Builds the city of Neon Vela: ground, roads, blocks, buildings with procedural windows,
// neon signs, palms, street lights, the beach, the sea and a seafront Ferris wheel.
// Every solid thing registers a collision box.
import * as THREE from 'three';
import { GRID, PITCH, ROAD_W, SIDEWALK, HALF, BEACH_X0, WATER_X, WORLD_MIN_X, WORLD_MAX_X, WORLD_MIN_Z, WORLD_MAX_Z, COLORS } from '../core/config.js';
import { hash2 } from '../core/rng.js';
import { lineCoord } from './roads.js';
import { districtAt } from './districts.js';
import { mergeColored, boxPart, cylPart, makeGlowTexture } from '../core/geometry.js';

const SIGN_WORDS = [
  ['VELA', '#ff2d95'], ['MOTEL', '#22e6ff'], ['CLUB 88', '#b84dff'], ['TACOS', '#ffb000'],
  ['PALMS', '#39ff88'], ['ARCADE', '#22e6ff'], ['HOTEL', '#ff2d95'], ['DINER', '#ffb000'],
];

function makeSignAtlas() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const g = cv.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  SIGN_WORDS.forEach(([word, color], i) => {
    const y = i * 64 + 32;
    g.fillStyle = 'rgba(10,6,20,0.85)';
    g.fillRect(8, i * 64 + 6, 496, 52);
    g.strokeStyle = color; g.lineWidth = 4;
    g.shadowColor = color; g.shadowBlur = 16;
    g.strokeRect(12, i * 64 + 10, 488, 44);
    g.font = 'bold 40px Arial, Helvetica, sans-serif';
    g.fillStyle = '#fff';
    g.fillText(word, 256, y + 2);
    g.shadowBlur = 0;
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeRoadTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#2b2b33'; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 900; i++) {
    const v = 30 + ((i * 97) % 40);
    g.fillStyle = `rgb(${v},${v},${v + 6})`;
    g.fillRect((i * 53) % 128, (i * 131) % 256, 2, 2);
  }
  g.fillStyle = '#e8e2d0';
  g.fillRect(6, 0, 3, 256); g.fillRect(119, 0, 3, 256);
  g.fillStyle = '#f3c13a';
  g.fillRect(61, 0, 2, 256); g.fillRect(65, 0, 2, 256);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Windows, lit rooms and shop fronts drawn in the building shader from world position,
// so a tower of any size gets correctly sized floors.
function makeBuildingMaterial(nightUniform) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.05 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = nightUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        mat4 nvM = modelMatrix;
        #ifdef USE_INSTANCING
          nvM = modelMatrix * instanceMatrix;
        #endif
        vWPos = (nvM * vec4(transformed, 1.0)).xyz;
        vWNorm = normalize(mat3(nvM) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight;
        varying vec3 vWPos;
        varying vec3 vWNorm;
        float nvWin = 0.0; float nvLit = 0.0; float nvShop = 0.0;
        float nvHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 nvAn = abs(vWNorm);
        if (nvAn.y < 0.5) {
          float u = nvAn.x > nvAn.z ? vWPos.z : vWPos.x;
          float fu = fract(u / 3.1);
          float fv = fract(vWPos.y / 3.5);
          float fl = floor(vWPos.y / 3.5);
          nvWin = step(0.16, fu) * step(fu, 0.84) * step(0.22, fv) * step(fv, 0.82) * step(1.0, fl);
          vec2 cell = vec2(floor(u / 3.1) + floor(vWPos.x * 0.07 + vWPos.z * 0.05) * 17.0, fl);
          nvLit = step(0.42, nvHash(cell));
          nvShop = step(0.5, vWPos.y) * step(vWPos.y, 3.0) * step(0.08, fu) * step(fu, 0.92);
          vec3 glass = vec3(0.10, 0.14, 0.20) + vec3(0.30, 0.22, 0.30) * (1.0 - uNight);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, nvWin * 0.88);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.10, 0.14), nvShop * 0.7);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, nvWin);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 warm = mix(vec3(1.0, 0.78, 0.48), vec3(0.75, 0.9, 1.0), step(0.75, nvHash(vec2(nvLit, floor(vWPos.y)))));
        totalEmissiveRadiance += nvWin * nvLit * warm * (0.05 + 1.5 * uNight);
        totalEmissiveRadiance += nvShop * vec3(1.0, 0.55, 0.75) * (0.12 + 0.8 * uNight);`);
  };
  return mat;
}

export function buildCity(game) {
  const { scene, colliders } = game;
  const nightUniform = { value: 0 };
  const instances = { build: [], crown: [], trim: [], palms: [], lights: [], containers: [] };
  const signs = [];
  const glowPts = [];
  const parks = [];

  // Ground under everything (grass and dusty lots), sand and sea.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_MAX_X - WORLD_MIN_X + 400, WORLD_MAX_Z - WORLD_MIN_Z + 400),
    new THREE.MeshStandardMaterial({ color: 0x5d6b4a, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((WORLD_MIN_X + BEACH_X0) / 2 - 100, -0.02, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(WATER_X - BEACH_X0 + 30, WORLD_MAX_Z - WORLD_MIN_Z + 300),
    new THREE.MeshStandardMaterial({ color: 0xe9cf9a, roughness: 0.95 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set((BEACH_X0 + WATER_X) / 2 + 10, 0.0, 0);
  sand.receiveShadow = true;
  scene.add(sand);

  const waterMat = new THREE.MeshStandardMaterial({ color: 0x0e7f96, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.94 });
  const waterTime = { value: 0 };
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec2 vWXZ;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float w1 = sin(vWXZ.x * 0.35 + uTime * 1.3) * 0.5 + sin(vWXZ.y * 0.21 - uTime * 0.9) * 0.5;
        float w2 = sin((vWXZ.x + vWXZ.y) * 0.9 + uTime * 2.1);
        normal = normalize(normal + vec3(w1 * 0.08 + w2 * 0.03, 0.0, w2 * 0.06) );`);
  };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 1400), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(WATER_X + 450, 0.05, 0);
  water.receiveShadow = true;
  scene.add(water);
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(3, 1400), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(WATER_X + 1, 0.07, 0);
  scene.add(foam);

  // Roads: one merged mesh of strips plus plain patches over intersections.
  const roadTex = makeRoadTexture();
  const roadParts = [];
  const len = GRID * PITCH + ROAD_W;
  for (let i = 0; i <= GRID; i++) {
    const c = lineCoord(i);
    const gx = new THREE.PlaneGeometry(ROAD_W, len, 1, 1);
    gx.rotateX(-Math.PI / 2);
    scaleUV(gx, 1, len / 24);
    gx.translate(c, 0.02, 0);
    roadParts.push(gx);
    const gz = new THREE.PlaneGeometry(ROAD_W, len, 1, 1);
    gz.rotateX(-Math.PI / 2);
    scaleUV(gz, 1, len / 24);
    gz.rotateY(Math.PI / 2);
    gz.translate(0, 0.025, c);
    roadParts.push(gz);
  }
  const roads = new THREE.Mesh(mergePlain(roadParts), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.88 }));
  roads.receiveShadow = true;
  scene.add(roads);
  const xParts = [];
  for (let i = 0; i <= GRID; i++) for (let j = 0; j <= GRID; j++) {
    const g = new THREE.PlaneGeometry(ROAD_W, ROAD_W);
    g.rotateX(-Math.PI / 2);
    g.translate(lineCoord(i), 0.03, lineCoord(j));
    xParts.push(g);
  }
  const crossings = new THREE.Mesh(mergePlain(xParts), new THREE.MeshStandardMaterial({ color: 0x2c2c34, roughness: 0.9 }));
  crossings.receiveShadow = true;
  scene.add(crossings);

  // City blocks.
  const slabParts = [];
  for (let bi = 0; bi < GRID; bi++) {
    for (let bj = 0; bj < GRID; bj++) {
      const cx = lineCoord(bi) + PITCH / 2, cz = lineCoord(bj) + PITCH / 2;
      const size = PITCH - ROAD_W;
      const d = districtAt(cx, cz);
      const h = hash2(bi * 7 + 3, bj * 11 + 5);
      const isPark = (d.id === 'palm' && h < 0.38) || h < 0.07 || (bi === 3 && bj === 4);
      slabParts.push(boxPart(size, 0.22, size, cx, 0.11, cz, isPark ? 0x4f8a3e : 0xb9b2a6));
      if (isPark) { parks.push({ cx, cz }); buildPark(cx, cz, size); continue; }
      buildBlock(bi, bj, cx, cz, d);
    }
  }
  const slabs = new THREE.Mesh(mergeColored(slabParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
  slabs.receiveShadow = true;
  scene.add(slabs);

  function buildPark(cx, cz, size) {
    const inner = size / 2 - SIDEWALK;
    for (let k = 0; k < 9; k++) {
      const px = cx + (hash2(cx + k, cz) - 0.5) * inner * 1.7;
      const pz = cz + (hash2(cx, cz + k * 3) - 0.5) * inner * 1.7;
      addPalm(px, pz, 7 + hash2(px, pz) * 5);
    }
    // Fountain in the middle.
    instances.build.push({ x: cx, z: cz, w: 6, d: 6, h: 1.0, color: 0xd8d2c4, solid: true });
  }

  function buildBlock(bi, bj, cx, cz, d) {
    const inner = (PITCH - ROAD_W) / 2 - SIDEWALK; // 24
    const lots = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    lots.forEach(([sx, sz], li) => {
      const r = hash2(bi * 13 + li, bj * 17 + li * 5);
      const r2 = hash2(bj * 19 + li, bi * 23 + 7);
      const lx = cx + sx * inner / 2, lz = cz + sz * inner / 2;
      let w = 12 + r * 8, dd = 12 + r2 * 8, h, color;
      if (d.id === 'strip') {
        h = 22 + r * r2 * 70 + r * 14;
        color = new THREE.Color().setHSL(0.6 + r2 * 0.25, 0.25, 0.32 + r * 0.25).getHex();
      } else if (d.id === 'coral') {
        h = 10 + r * 16;
        color = new THREE.Color().setHSL(0.02 + r2 * 0.12, 0.55, 0.72 + r * 0.12).getHex();
      } else if (d.id === 'port') {
        if (r < 0.3) { addContainers(lx, lz, r2); return; }
        w = 18 + r * 3; dd = 14 + r2 * 6; h = 6 + r * 6;
        color = [0x4a7a86, 0x9a5b45, 0x8d8a7a, 0x3f5d6b][Math.floor(r2 * 4)];
      } else {
        h = 6 + r * 9;
        color = new THREE.Color().setHSL(0.45 + r2 * 0.5, 0.45, 0.75 + r * 0.1).getHex();
        if (r2 > 0.6) addPalm(lx + w / 2 + 1.5, lz + dd / 2 + 1.5, 8 + r * 3);
      }
      if (bi === 4 && bj === 2 && li === 0) { w = 18; dd = 18; h = 118; color = 0x2a3550; }
      instances.build.push({ x: lx, z: lz, w, d: dd, h, color, solid: true });
      if (h > 14) {
        instances.crown.push({ x: lx, z: lz, w: w * 0.7, d: dd * 0.7, y: h, h: 2 + r * 3, color: new THREE.Color(color).multiplyScalar(0.8).getHex() });
      }
      if (d.id === 'strip' || d.id === 'coral' || r > 0.7) {
        const neon = COLORS.neon[Math.floor(r * 97) % COLORS.neon.length];
        instances.trim.push({ x: lx, z: lz, w: w + 0.3, d: dd + 0.3, y: Math.min(h, 3.4), color: neon });
        if (h > 14) instances.trim.push({ x: lx, z: lz, w: w + 0.3, d: dd + 0.3, y: h - 0.4, color: neon });
      }
      // A neon sign on the facade that faces the nearest road.
      if ((d.id === 'strip' || d.id === 'coral' || r2 > 0.55) && h > 7) {
        const wi = Math.floor(hash2(bi + li, bj) * SIGN_WORDS.length);
        const faceX = Math.abs(sx) >= Math.abs(sz);
        const sy = Math.min(h - 2, 6 + r * 6);
        if (faceX) signs.push({ x: lx + sx * (w / 2 + 0.06), y: sy, z: lz, ry: sx > 0 ? Math.PI / 2 : -Math.PI / 2, word: wi });
        else signs.push({ x: lx, y: sy, z: lz + sz * (dd / 2 + 0.06), ry: sz > 0 ? 0 : Math.PI, word: wi });
      }
    });
    // Street lights on two corners of every block.
    const o = (PITCH - ROAD_W) / 2 - 1;
    instances.lights.push({ x: cx - o, z: cz - o }, { x: cx + o, z: cz + o });
    // Palms along the Neon Strip and Ocean Drive kerbs.
    if (d.id === 'strip' || bi === GRID - 1) {
      for (let k = -1; k <= 1; k += 2) addPalm(cx + o, cz + k * 12, 9 + hash2(cx, k) * 3);
    }
  }

  function addContainers(lx, lz, r) {
    const cols = [0xc0392b, 0x2471a3, 0xd68910, 0x1e8449, 0x7d3c98];
    for (let k = 0; k < 4; k++) {
      const stack = 1 + Math.floor(hash2(lx + k, lz) * 3);
      for (let s = 0; s < stack; s++) {
        instances.containers.push({ x: lx - 7 + k * 4.6, z: lz + (r - 0.5) * 4, y: s * 2.6, color: cols[(k + s + Math.floor(r * 5)) % 5] });
      }
      colliders.add(lx - 7 + k * 4.6 - 1.25, lz + (r - 0.5) * 4 - 6, lx - 7 + k * 4.6 + 1.25, lz + (r - 0.5) * 4 + 6, stack * 2.6, 'container');
    }
  }

  function addPalm(x, z, h) {
    instances.palms.push({ x, z, h, lean: (hash2(x, z) - 0.5) * 0.3, rot: hash2(z, x) * 6.28 });
    colliders.add(x - 0.35, z - 0.35, x + 0.35, z + 0.35, h, 'palm');
  }

  // Beach: palms along the sand, lifeguard towers and the Ferris wheel on the pier.
  for (let z = -HALF + 10; z < HALF; z += 22) {
    addPalm(BEACH_X0 + 5 + hash2(z, 1) * 3, z + hash2(1, z) * 6, 9 + hash2(z, z) * 4);
  }
  const towerParts = [];
  for (const z of [-200, -60, 120, 240]) {
    const x = BEACH_X0 + 26;
    towerParts.push(boxPart(4, 0.4, 4, x, 3, z, 0xf2f2f2), boxPart(0.3, 3, 0.3, x - 1.6, 1.5, z - 1.6, 0xf2f2f2),
      boxPart(0.3, 3, 0.3, x + 1.6, 1.5, z - 1.6, 0xf2f2f2), boxPart(0.3, 3, 0.3, x - 1.6, 1.5, z + 1.6, 0xf2f2f2),
      boxPart(0.3, 3, 0.3, x + 1.6, 1.5, z + 1.6, 0xf2f2f2), boxPart(3.4, 2.2, 3.4, x, 4.3, z, 0xff4f7b), boxPart(4.2, 0.3, 4.2, x, 5.5, z, 0xffd23f));
    colliders.add(x - 2, z - 2, x + 2, z + 2, 6, 'tower');
  }
  const towersMesh = new THREE.Mesh(mergeColored(towerParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
  towersMesh.castShadow = true; towersMesh.receiveShadow = true;
  scene.add(towersMesh);

  // Pier and Ferris wheel.
  const pierZ = 40;
  const pier = new THREE.Mesh(new THREE.BoxGeometry(70, 0.6, 10), new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 }));
  pier.position.set(WATER_X + 30, 0.9, pierZ);
  pier.castShadow = true; pier.receiveShadow = true;
  scene.add(pier);
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(16, 0.5, 8, 48), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff2d95, emissiveIntensity: 0.6 }));
  wheel.add(rim);
  const spokeParts = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    spokeParts.push(boxPart(0.25, 32, 0.25, 0, 0, 0, 0xdedede, 0, 0, a));
    spokeParts.push(boxPart(1.8, 1.6, 1.8, Math.cos(a) * 16, Math.sin(a) * 16, 0, COLORS.neon[k % 5]));
  }
  wheel.add(new THREE.Mesh(mergeColored(spokeParts), new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0x331022, roughness: 0.5 })));
  wheel.position.set(WATER_X + 40, 19, pierZ);
  wheel.rotation.y = Math.PI / 2;
  scene.add(wheel);
  const legs = new THREE.Mesh(mergeColored([
    boxPart(0.8, 20, 0.8, 0, 10, -5, 0xcfcfcf, 0.25, 0, 0), boxPart(0.8, 20, 0.8, 0, 10, 5, 0xcfcfcf, -0.25, 0, 0),
  ]), new THREE.MeshStandardMaterial({ vertexColors: true }));
  legs.position.set(WATER_X + 40, 0, pierZ);
  legs.castShadow = true;
  scene.add(legs);
  glowPts.push({ x: WATER_X + 40, y: 19, z: pierZ, c: 0xff2d95, s: 40 });

  // --- Instanced meshes ---
  const buildMat = makeBuildingMaterial(nightUniform);
  const unitBox = new THREE.BoxGeometry(1, 1, 1); unitBox.translate(0, 0.5, 0);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  const bMesh = new THREE.InstancedMesh(unitBox, buildMat, instances.build.length + instances.crown.length);
  let n = 0;
  for (const b of instances.build) {
    m.makeScale(b.w, b.h, b.d); m.setPosition(b.x, 0.2, b.z);
    bMesh.setMatrixAt(n, m); bMesh.setColorAt(n++, col.set(b.color));
    if (b.solid) colliders.add(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2, b.h, 'building');
  }
  for (const c of instances.crown) {
    m.makeScale(c.w, c.h, c.d); m.setPosition(c.x, c.y + 0.2, c.z);
    bMesh.setMatrixAt(n, m); bMesh.setColorAt(n++, col.set(c.color));
  }
  bMesh.castShadow = true; bMesh.receiveShadow = true;
  scene.add(bMesh);

  const trimMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const trimMesh = new THREE.InstancedMesh(unitBox, trimMat, instances.trim.length * 4);
  n = 0;
  for (const t of instances.trim) {
    const sides = [[0, -t.d / 2, t.w, 0.25], [0, t.d / 2, t.w, 0.25], [-t.w / 2, 0, 0.25, t.d], [t.w / 2, 0, 0.25, t.d]];
    for (const [ox, oz, sw, sd] of sides) {
      m.makeScale(sw, 0.28, sd); m.setPosition(t.x + ox, t.y, t.z + oz);
      trimMesh.setMatrixAt(n, m); trimMesh.setColorAt(n++, col.set(t.color));
    }
    glowPts.push({ x: t.x, y: t.y, z: t.z - t.d / 2, c: t.color, s: 10 });
  }
  scene.add(trimMesh);

  const contMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5, 2.5, 12).translate(0, 1.35, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3 }), Math.max(1, instances.containers.length));
  instances.containers.forEach((c, k) => {
    m.makeTranslation(c.x, c.y + 0.2, c.z);
    contMesh.setMatrixAt(k, m); contMesh.setColorAt(k, col.set(c.color));
  });
  contMesh.castShadow = true; contMesh.receiveShadow = true;
  scene.add(contMesh);

  // Palms: a curved trunk and a crown of drooping fronds, both instanced.
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 1, 6); trunkGeo.translate(0, 0.5, 0);
  const frondParts = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    frondParts.push(boxPart(0.9, 0.08, 4.2, Math.sin(a) * 1.9, -0.6, Math.cos(a) * 1.9, k % 2 ? 0x2f8f3a : 0x3fa64a, 0.45 * (Math.cos(a) > 0 ? 1 : -1) * Math.abs(Math.cos(a)), a, -0.45 * Math.sin(a)));
  }
  frondParts.push(boxPart(0.7, 0.7, 0.7, 0, -0.2, 0, 0x6b4a2a));
  const frondGeo = mergeColored(frondParts);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x8b6b4a, roughness: 0.95 }), instances.palms.length);
  const crowns = new THREE.InstancedMesh(frondGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), instances.palms.length);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3();
  instances.palms.forEach((p, k) => {
    e.set(p.lean, p.rot, p.lean * 0.5); q.setFromEuler(e);
    s.set(1, p.h, 1); v.set(p.x, 0.2, p.z);
    m.compose(v, q, s); trunks.setMatrixAt(k, m);
    const top = new THREE.Vector3(0, p.h, 0).applyQuaternion(q).add(v);
    e.set(0, p.rot, 0); q.setFromEuler(e); s.set(1, 1, 1);
    m.compose(top, q, s); crowns.setMatrixAt(k, m);
  });
  trunks.castShadow = crowns.castShadow = true;
  scene.add(trunks, crowns);

  // Street lights.
  const poleGeo = mergeColored([
    cylPart(0.1, 0.14, 7, 6, 0, 3.5, 0, 0x3a3d44),
    boxPart(0.2, 0.15, 2.2, 0, 7, 1.0, 0x3a3d44),
    boxPart(0.5, 0.18, 0.8, 0, 6.88, 2.0, 0xfff1c0),
  ]);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0x000000, roughness: 0.6 }), instances.lights.length);
  instances.lights.forEach((p, k) => {
    const ry = Math.atan2(-Math.sign(p.x), -Math.sign(p.z));
    e.set(0, ry, 0); q.setFromEuler(e); s.set(1, 1, 1); v.set(p.x, 0.2, p.z);
    m.compose(v, q, s); poles.setMatrixAt(k, m);
    const tip = new THREE.Vector3(0, 6.8, 2.0).applyQuaternion(q).add(v);
    glowPts.push({ x: tip.x, y: tip.y, z: tip.z, c: 0xffd9a0, s: 7, street: true });
    colliders.add(p.x - 0.2, p.z - 0.2, p.x + 0.2, p.z + 0.2, 7, 'pole');
  });
  poles.castShadow = true;
  scene.add(poles);

  // Neon signs: one merged mesh using the sign atlas.
  const signGeo = [];
  for (const sg of signs) {
    const g = new THREE.PlaneGeometry(7, 0.875);
    const uv = g.attributes.uv;
    const v0 = 1 - (sg.word + 1) / 8, v1 = 1 - sg.word / 8;
    for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) > 0.5 ? v1 : v0);
    g.rotateY(sg.ry);
    g.translate(sg.x, sg.y, sg.z);
    signGeo.push(g);
    glowPts.push({ x: sg.x, y: sg.y, z: sg.z, c: new THREE.Color(SIGN_WORDS[sg.word][1]).getHex(), s: 12 });
  }
  const signMat = new THREE.MeshBasicMaterial({ map: makeSignAtlas(), toneMapped: false, transparent: true, side: THREE.DoubleSide });
  if (signGeo.length) scene.add(new THREE.Mesh(mergePlain(signGeo), signMat));

  // Glow halos for every neon and lamp: one Points draw call, brighter at night.
  const gp = new Float32Array(glowPts.length * 3), gc = new Float32Array(glowPts.length * 3);
  glowPts.forEach((p, k) => {
    gp.set([p.x, p.y, p.z], k * 3);
    col.set(p.c); gc.set([col.r, col.g, col.b], k * 3);
  });
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(gp, 3));
  glowGeo.setAttribute('color', new THREE.BufferAttribute(gc, 3));
  const glowMat = new THREE.PointsMaterial({ size: 9, map: makeGlowTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 });
  const glow = new THREE.Points(glowGeo, glowMat);
  glow.frustumCulled = false;
  scene.add(glow);

  // World edges: invisible walls, the waterline included.
  colliders.add(WORLD_MIN_X - 10, WORLD_MIN_Z - 10, WORLD_MIN_X, WORLD_MAX_Z + 10, 50, 'edge');
  colliders.add(WORLD_MAX_X, WORLD_MIN_Z - 10, WORLD_MAX_X + 10, WORLD_MAX_Z + 10, 50, 'water');
  colliders.add(WORLD_MIN_X - 10, WORLD_MIN_Z - 10, WORLD_MAX_X + 10, WORLD_MIN_Z, 50, 'edge');
  colliders.add(WORLD_MIN_X - 10, WORLD_MAX_Z, WORLD_MAX_X + 10, WORLD_MAX_Z + 10, 50, 'edge');

  return {
    parks,
    update(dt, night) {
      waterTime.value += dt;
      nightUniform.value = night;
      wheel.rotation.z += dt * 0.08;
      glowMat.opacity = 0.18 + night * 0.62;
      glowMat.size = 7 + night * 5;
      signMat.color.setScalar(0.75 + night * 0.9);
      trimMat.color.setScalar(0.7 + night * 0.8);
      rim.material.emissiveIntensity = 0.4 + night * 1.6;
      poles.material.emissive.setScalar(night * 0.6);
    },
  };
}

function scaleUV(g, su, sv) {
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
}

// Merge plain geometries (position, normal, uv) into one.
function mergePlain(list) {
  const pos = [], nor = [], uvs = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    uvs.push(...g.attributes.uv.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.computeBoundingSphere();
  return out;
}
