// People of Neon Vela: civilians, VPD officers, Ash Kings gang members and the player's crew.
// One shared actor shape, a few AI behaviours, and a body built from a torso and two swinging legs.
import * as THREE from 'three';
import { mergeColored, boxPart, spherePart } from '../core/geometry.js';
import { PITCH, ROAD_W, GRID, PLAYER_RADIUS } from '../core/config.js';
import { rand, pick, randRange } from '../core/rng.js';
import { dist, dist2, clamp, wrapAngle, approachAngle } from '../core/mathutil.js';
import { lineCoord } from '../world/roads.js';

const SKIN = [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69, 0xffdbac];
const OUTFIT = {
  civ: [0xff7aa2, 0x4fc3f7, 0xffe082, 0xa5d6a7, 0xffffff, 0xce93d8, 0xff8a65],
  cop: [0x1f3b73],
  gang: [0x3a3a3a],
  crew: [0xff2d95],
  player: [0xf5f5f5],
};
const geoCache = new Map();
const legGeo = mergeColored([boxPart(0.2, 0.9, 0.24, 0, -0.45, 0, 0xffffff)]);
const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
const legMats = new Map();

function torsoGeometry(faction, shirt, skin) {
  const key = faction + shirt + '-' + skin;
  if (geoCache.has(key)) return geoCache.get(key);
  const parts = [
    boxPart(0.56, 0.68, 0.3, 0, 1.25, 0, shirt),
    spherePart(0.17, 0, 1.78, 0, skin, 1, 1.12, 1),
    boxPart(0.15, 0.6, 0.16, 0.37, 1.22, 0, skin, 0, 0, 0.12),
    boxPart(0.15, 0.6, 0.16, -0.37, 1.22, 0, skin, 0, 0, -0.12),
    boxPart(0.58, 0.14, 0.32, 0, 0.92, 0, 0x222222),
  ];
  if (faction === 'cop') {
    parts.push(boxPart(0.4, 0.1, 0.42, 0, 1.97, 0.04, 0x0d1a33), boxPart(0.12, 0.12, 0.04, 0.14, 1.42, 0.16, 0xffd54f));
  } else if (faction === 'gang') {
    parts.push(boxPart(0.6, 0.12, 0.34, 0, 1.5, 0, 0xff5a1f), spherePart(0.18, 0, 1.86, 0, 0x111111, 1, 0.6, 1));
  } else if (faction === 'crew') {
    parts.push(boxPart(0.6, 0.12, 0.34, 0, 1.52, 0, 0x22e6ff), boxPart(0.36, 0.06, 0.36, 0, 1.97, 0.06, 0x111111));
  } else if (faction === 'player') {
    parts.push(boxPart(0.6, 0.66, 0.06, 0, 1.25, 0.15, 0x2b8cff), spherePart(0.18, 0, 1.87, -0.02, 0x2a1a10, 1, 0.55, 1));
  } else {
    parts.push(spherePart(0.18, 0, 1.86, -0.02, pick([0x2a1a10, 0x6b4423, 0xd4a017, 0x111111]), 1, 0.55, 1));
  }
  const g = mergeColored(parts);
  geoCache.set(key, g);
  return g;
}

export function buildHumanMesh(faction, pants = 0x2d3446) {
  const shirt = pick(OUTFIT[faction] || OUTFIT.civ);
  const skin = pick(SKIN);
  const group = new THREE.Group();
  const torso = new THREE.Mesh(torsoGeometry(faction, shirt, skin), mat);
  torso.castShadow = true;
  if (!legMats.has(pants)) legMats.set(pants, new THREE.MeshStandardMaterial({ color: pants, roughness: 0.85 }));
  const lm = legMats.get(pants);
  const legL = new THREE.Mesh(legGeo, lm), legR = new THREE.Mesh(legGeo, lm);
  legL.position.set(0.13, 0.9, 0); legR.position.set(-0.13, 0.9, 0);
  legL.castShadow = legR.castShadow = true;
  group.add(torso, legL, legR);
  group.userData.legs = [legL, legR];
  return group;
}

// Pose: swing legs with gait phase; fall flat when dead.
export function animateHuman(mesh, phase, moving, dead) {
  const [l, r] = mesh.userData.legs;
  const sw = moving ? Math.sin(phase) * 0.6 : 0;
  l.rotation.x = sw; r.rotation.x = -sw;
  if (dead) { mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.38; }
}

let nextId = 1;

export function createHumans(game) {
  const actors = game.actors;

  function spawn(faction, x, z, opts = {}) {
    const mesh = buildHumanMesh(faction, faction === 'cop' ? 0x16213e : faction === 'gang' ? 0x1b1b1b : undefined);
    mesh.position.set(x, 0.2, z);
    game.scene.add(mesh);
    const a = {
      id: nextId++, faction, mesh, x, z, yaw: rand() * 6.28, phase: rand() * 6,
      hp: opts.hp ?? (faction === 'gang' ? 70 : faction === 'cop' ? 80 : faction === 'crew' ? 120 : 40),
      alive: true, state: opts.state ?? (faction === 'civ' ? 'wander' : faction === 'crew' ? 'follow' : 'chase'),
      weapon: opts.weapon ?? (faction === 'civ' ? null : faction === 'gang' ? pick(['pistol', 'smg']) : faction === 'crew' ? 'smg' : 'pistol'),
      fireCd: randRange(0.5, 1.5), panicT: 0, target: null, goal: null, moving: false,
      removeAt: 0, tag: opts.tag ?? null, arrestT: 0, crossing: false,
      ring: null, corner: 0, speedMul: opts.speedMul ?? 1,
    };
    a.hp0 = a.hp;
    actors.push(a);
    return a;
  }

  function remove(a) {
    game.scene.remove(a.mesh);
    const i = actors.indexOf(a);
    if (i >= 0) actors.splice(i, 1);
  }

  function kill(a, source) {
    if (!a.alive) return;
    a.alive = false; a.hp = 0;
    animateHuman(a.mesh, 0, false, true);
    a.removeAt = game.time + 25;
    game.emit('actorKilled', { a, source });
  }

  // Sidewalk ring of the block nearest a point; civilians walk its corners.
  function ringFor(x, z) {
    const bi = clamp(Math.floor((x - lineCoord(0)) / PITCH), 0, GRID - 1);
    const bj = clamp(Math.floor((z - lineCoord(0)) / PITCH), 0, GRID - 1);
    const cx = lineCoord(bi) + PITCH / 2, cz = lineCoord(bj) + PITCH / 2;
    const h = (PITCH - ROAD_W) / 2 - 1.6;
    return [[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]];
  }

  function spawnCivilians(count, around) {
    for (let n = 0; n < count; n++) {
      const x = around.x + (rand() - 0.5) * 220, z = around.z + (rand() - 0.5) * 220;
      const ring = ringFor(x, z);
      const c = Math.floor(rand() * 4);
      const a = spawn('civ', ring[c][0], ring[c][1]);
      a.ring = ring; a.corner = (c + 1) % 4;
    }
  }

  function moveActor(a, tx, tz, speed, dt) {
    const dx = tx - a.x, dz = tz - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.2) { a.moving = false; return d; }
    const want = Math.atan2(dx, dz);
    a.yaw = approachAngle(a.yaw, want, dt * 8);
    const step = Math.min(d, speed * dt);
    a.x += Math.sin(a.yaw) * step; a.z += Math.cos(a.yaw) * step;
    const hit = game.colliders.resolveCircle(a, PLAYER_RADIUS);
    // Slide around corners: when pushed, sidestep along the wall.
    if (hit.pushed > 0.01) {
      const side = wrapAngle(want - Math.atan2(-hit.nx, -hit.nz)) > 0 ? 1 : -1;
      a.x += -hit.nz * side * speed * dt * 0.8;
      a.z += hit.nx * side * speed * dt * 0.8;
    }
    a.moving = true;
    return d;
  }

  // Who is this actor hostile to right now?
  function hostileTargets(a) {
    const out = [];
    const p = game.player;
    const wanted = game.police ? game.police.stars : 0;
    if (a.faction === 'gang' && a.state === 'hostile') {
      if (p.alive) out.push(p);
      for (const o of actors) if (o.alive && o.faction === 'crew') out.push(o);
    } else if (a.faction === 'cop' && wanted > 0) {
      if (p.alive) out.push(p);
      for (const o of actors) if (o.alive && o.faction === 'crew') out.push(o);
    } else if (a.faction === 'crew') {
      for (const o of actors) {
        if (!o.alive) continue;
        if (o.faction === 'gang' && o.state === 'hostile') out.push(o);
        if (o.faction === 'cop' && wanted > 0) out.push(o);
      }
    }
    return out;
  }

  function nearest(a, list, maxD) {
    let best = null, bd = maxD * maxD;
    for (const t of list) {
      const d = dist2(a.x, a.z, t.x, t.z);
      if (d < bd && !game.colliders.segmentBlocked(a.x, a.z, t.x, t.z)) { bd = d; best = t; }
    }
    return best;
  }

  function tryShoot(a, target, dt, rateMul = 1) {
    a.fireCd -= dt * rateMul;
    if (a.fireCd > 0 || !a.weapon) return;
    a.fireCd = a.weapon === 'smg' ? 0.25 : a.weapon === 'rifle' ? 0.6 : 0.9;
    a.yaw = Math.atan2(target.x - a.x, target.z - a.z);
    game.combat.npcShoot(a, target);
  }

  function updateCiv(a, dt) {
    const p = game.player;
    if (a.panicT > 0) {
      a.panicT -= dt;
      const ax = a.x - p.x, az = a.z - p.z, d = Math.hypot(ax, az) || 1;
      moveActor(a, a.x + ax / d * 5, a.z + az / d * 5, 4.6, dt);
      return;
    }
    if (!a.ring) { a.ring = ringFor(a.x, a.z); a.corner = 0; }
    const [tx, tz] = a.ring[a.corner];
    if (moveActor(a, tx, tz, 1.4, dt) < 0.6) a.corner = (a.corner + (rand() < 0.85 ? 1 : 3)) % 4;
  }

  function updateCop(a, dt) {
    const p = game.player;
    const stars = game.police ? game.police.stars : 0;
    if (stars === 0) {
      // Stand down: walk back to the car, then vanish when far from the player.
      a.state = 'idle';
      if (dist2(a.x, a.z, p.x, p.z) > 90 * 90) a.removeAt = game.time;
      return;
    }
    const targets = hostileTargets(a);
    const t = nearest(a, targets, stars >= 2 ? 34 : 6);
    const dp = dist(a.x, a.z, p.x, p.z);
    if (stars <= 1 && !p.vehicle) {
      if (dp > 1.4) moveActor(a, p.x, p.z, 4.2, dt);
      else {
        a.moving = false;
        a.arrestT += dt;
        if (a.arrestT > 2.2) game.emit('busted', { by: a });
      }
      return;
    }
    a.arrestT = 0;
    if (t && dist(a.x, a.z, t.x, t.z) < 30) {
      a.moving = false;
      if (dp > 14 && t === p) moveActor(a, p.x, p.z, 3.5, dt);
      tryShoot(a, t, dt);
    } else moveActor(a, p.x, p.z, 4.8, dt);
  }

  function updateGang(a, dt) {
    const p = game.player;
    if (a.state === 'guard') {
      a.moving = false;
      if (dist2(a.x, a.z, p.x, p.z) < 26 * 26 && !game.colliders.segmentBlocked(a.x, a.z, p.x, p.z)) alertGang(a);
      return;
    }
    const t = nearest(a, hostileTargets(a), 40);
    if (t) {
      const d = dist(a.x, a.z, t.x, t.z);
      if (d > 18) moveActor(a, t.x, t.z, 3.8 * a.speedMul, dt);
      else a.moving = false;
      tryShoot(a, t, dt);
    } else if (a.goal) moveActor(a, a.goal.x, a.goal.z, 3.8 * a.speedMul, dt);
    else moveActor(a, p.x, p.z, 3.8 * a.speedMul, dt);
  }

  function alertGang(src) {
    for (const o of actors) {
      if (o.alive && o.faction === 'gang' && o.state === 'guard' && dist2(o.x, o.z, src.x, src.z) < 40 * 40) o.state = 'hostile';
    }
    src.state = 'hostile';
  }

  function updateCrew(a, dt) {
    const p = game.player;
    if (p.vehicle) {
      // Riding along: hidden inside the car.
      a.mesh.visible = false;
      a.x = p.vehicle.x; a.z = p.vehicle.z;
      return;
    }
    if (!a.mesh.visible) {
      a.mesh.visible = true;
      const off = (a.slot ?? 0) * 1.4 + 1.6;
      a.x = p.x + Math.cos(p.yaw) * off; a.z = p.z - Math.sin(p.yaw) * off;
      game.colliders.resolveCircle(a, PLAYER_RADIUS + 0.2);
    }
    const t = nearest(a, hostileTargets(a), 34);
    const rate = game.crew && game.crew.suppressT > 0 ? 3 : 1;
    if (t) tryShoot(a, t, dt, rate);
    const slot = a.slot ?? 0;
    const ang = p.yaw + Math.PI + (slot - 1) * 0.7;
    const fx = p.x + Math.sin(ang) * 3.2, fz = p.z + Math.cos(ang) * 3.2;
    const d = dist(a.x, a.z, fx, fz);
    if (d > 30) { a.x = fx; a.z = fz; game.colliders.resolveCircle(a, PLAYER_RADIUS + 0.2); }
    else if (d > 1.2) moveActor(a, fx, fz, d > 6 ? 6.5 : 3.6, dt);
    else a.moving = false;
  }

  function update(dt) {
    const p = game.player;
    for (const a of actors) {
      if (!a.alive) {
        if (game.time > a.removeAt) a.dead = true;
        continue;
      }
      if (a.faction === 'civ') updateCiv(a, dt);
      else if (a.faction === 'cop') updateCop(a, dt);
      else if (a.faction === 'gang') updateGang(a, dt);
      else if (a.faction === 'crew') updateCrew(a, dt);
      // Being hit by a moving car.
      for (const v of game.vehicles) {
        if (Math.abs(v.speed) < 5 || v.wrecked) continue;
        if (dist2(a.x, a.z, v.x, v.z) < 2.2 * 2.2 && a.mesh.visible) {
          a.hp -= Math.abs(v.speed) * 4;
          a.x += Math.sin(v.yaw) * 2; a.z += Math.cos(v.yaw) * 2;
          if (a.hp <= 0) kill(a, v.driver === 'player' ? 'player' : 'world');
          else if (a.faction === 'civ') a.panicT = 6;
        }
      }
      a.phase += dt * (a.moving ? 9 : 0);
      a.mesh.position.set(a.x, 0.2 + (a.moving ? Math.abs(Math.sin(a.phase)) * 0.05 : 0), a.z);
      a.mesh.rotation.y = a.yaw;
      animateHuman(a.mesh, a.phase, a.moving, false);
      if (a.faction === 'civ' && dist2(a.x, a.z, p.x, p.z) > 180 * 180) a.dead = true;
      if (a.removeAt && game.time >= a.removeAt && a.faction === 'cop') a.dead = true;
    }
    for (let i = actors.length - 1; i >= 0; i--) if (actors[i].dead) remove(actors[i]);
  }

  function panicAround(x, z, r) {
    for (const a of actors) if (a.alive && a.faction === 'civ' && dist2(a.x, a.z, x, z) < r * r) a.panicT = 6 + rand() * 3;
  }

  return { spawn, remove, kill, update, spawnCivilians, panicAround, alertGang, moveActor, ringFor };
}
