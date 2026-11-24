// Weapons and damage: six player weapons (hitscan, shotgun spread, rockets), NPC gunfire,
// explosions and the crimes they report to the police.
import * as THREE from 'three';
import { raySphere, rayBox, dist2, dist } from '../core/mathutil.js';
import { rand } from '../core/rng.js';

export const WEAPONS = [
  { id: 'fists', name: 'Fists', key: 'Digit1', dmg: 18, rate: 0.45, range: 2.0, melee: true, clip: Infinity },
  { id: 'pistol', name: 'Vela 9 Pistol', key: 'Digit2', dmg: 26, rate: 0.28, range: 70, spread: 0.012, clip: 15, reserve: 120 },
  { id: 'smg', name: 'Riptide SMG', key: 'Digit3', dmg: 14, rate: 0.085, range: 55, spread: 0.035, clip: 32, reserve: 320, auto: true },
  { id: 'shotgun', name: 'Breaker Shotgun', key: 'Digit4', dmg: 13, rate: 0.85, range: 26, spread: 0.09, pellets: 8, clip: 8, reserve: 48 },
  { id: 'rifle', name: 'Tidewater Rifle', key: 'Digit5', dmg: 32, rate: 0.13, range: 110, spread: 0.008, clip: 30, reserve: 240, auto: true },
  { id: 'launcher', name: 'Flarebird Launcher', key: 'Digit6', dmg: 0, rate: 1.2, range: 120, rocket: true, clip: 1, reserve: 8 },
];

export function createCombat(game) {
  const ammo = WEAPONS.map((w) => ({ clip: w.clip, reserve: w.reserve ?? 0 }));
  const state = { index: 1, cd: 0, lastShot: -10, reloadT: 0, rockets: [] };
  const ray = new THREE.Vector3(), origin = new THREE.Vector3();
  const rocketGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.9, 6).rotateX(Math.PI / 2);
  const rocketMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, toneMapped: false });

  const weapon = () => WEAPONS[state.index];

  function select(i) {
    if (i < 0 || i >= WEAPONS.length || i === state.index) return false;
    state.index = i; state.cd = 0.15; state.reloadT = 0;
    game.emit('weaponChanged', WEAPONS[i]);
    return true;
  }

  function cycle(dir) { select((state.index + dir + WEAPONS.length) % WEAPONS.length); }

  function aiming() { return !weapon().melee && game.time - state.lastShot < 1.2; }

  function crimeAt(x, z, type) { game.emit('crime', { type, x, z }); }

  // Closest thing along a ray: people, cars, then walls.
  function castRay(ox, oy, oz, dx, dy, dz, range, ignore) {
    let best = { t: range, kind: 'none', obj: null };
    for (const a of game.actors) {
      if (!a.alive || a === ignore || !a.mesh.visible) continue;
      if (dist2(a.x, a.z, ox, oz) > (range + 2) * (range + 2)) continue;
      const t = raySphere(ox, oy, oz, dx, dy, dz, a.x, 1.15, a.z, 0.55);
      if (t > 0 && t < best.t) best = { t, kind: 'actor', obj: a };
    }
    for (const v of game.vehicles) {
      if (v === ignore || v.driver === 'player' && ignore === game.player) continue;
      if (dist2(v.x, v.z, ox, oz) > (range + 4) * (range + 4)) continue;
      const t = raySphere(ox, oy, oz, dx, dy, dz, v.x, 0.9, v.z, 1.7);
      if (t > 0 && t < best.t) best = { t, kind: 'vehicle', obj: v };
    }
    const p = game.player;
    if (ignore !== p && p.alive && !p.vehicle) {
      const t = raySphere(ox, oy, oz, dx, dy, dz, p.x, 1.15, p.z, 0.55);
      if (t > 0 && t < best.t) best = { t, kind: 'player', obj: p };
    }
    const ex = ox + dx * best.t, ez = oz + dz * best.t;
    const boxes = game.colliders.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), []);
    for (const b of boxes) {
      if (b.tag === 'edge' || b.tag === 'water') continue;
      const t = rayBox(ox, oy, oz, dx, dy, dz, b);
      if (t > 0.05 && t < best.t) best = { t, kind: 'wall', obj: b };
    }
    if (dy < -0.001) {
      const tg = -oy / dy;
      if (tg > 0 && tg < best.t) best = { t: tg, kind: 'ground', obj: null };
    }
    return best;
  }

  function damageActor(a, dmg, source) {
    if (!a.alive) return;
    a.hp -= dmg;
    if (game.fx) game.fx.hitPuff(a.x, 1.2, a.z);
    if (a.faction === 'gang' && source !== 'gang') game.humans.alertGang(a);
    if (a.faction === 'civ') a.panicT = 7;
    if (source === 'player' || source === 'crew') {
      if (a.faction === 'cop') crimeAt(a.x, a.z, 'assaultCop');
    }
    if (a.hp <= 0) {
      game.humans.kill(a, source);
      if (source === 'player') {
        if (a.faction === 'cop') crimeAt(a.x, a.z, 'copKill');
        else if (a.faction === 'civ') crimeAt(a.x, a.z, 'murder');
      }
    }
  }

  function applyHit(hit, dmg, source) {
    if (hit.kind === 'actor') damageActor(hit.obj, dmg, source);
    else if (hit.kind === 'vehicle') {
      game.vehicleSys.damage(hit.obj, dmg * 0.55, source);
      if (game.fx) game.fx.sparks(hit.obj.x, 1, hit.obj.z);
      if (source === 'player' && hit.obj.faction === 'cop') crimeAt(hit.obj.x, hit.obj.z, 'assaultCop');
    } else if (hit.kind === 'player') {
      game.player.hurt(dmg, source);
    }
  }

  function aimRay(out, dir) {
    const cam = game.camera;
    cam.getWorldDirection(dir);
    // Start the ray at the player's depth so walls behind the player never block it.
    const p = game.player;
    const camToP = (p.x - cam.position.x) * dir.x + (p.z - cam.position.z) * dir.z;
    out.copy(cam.position).addScaledVector(dir, Math.max(0, camToP));
  }

  function fire() {
    const w = weapon();
    const p = game.player;
    const am = ammo[state.index];
    if (w.melee) {
      state.cd = w.rate; state.lastShot = game.time;
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      let hitAny = false;
      for (const a of game.actors) {
        if (!a.alive || a.faction === 'crew') continue;
        const dx = a.x - p.x, dz = a.z - p.z, d = Math.hypot(dx, dz);
        if (d < w.range && (dx * fx + dz * fz) / (d || 1) > 0.4) { damageActor(a, w.dmg, 'player'); hitAny = true; }
      }
      game.emit('shot', { weapon: w, melee: true, hit: hitAny });
      return;
    }
    if (am.clip <= 0) {
      if (am.reserve > 0 && state.reloadT <= 0) state.reloadT = 1.1;
      else if (am.reserve <= 0) game.emit('dryFire', w);
      state.cd = 0.25;
      return;
    }
    am.clip--;
    state.cd = w.rate; state.lastShot = game.time;
    p.yaw = p.camYaw;
    aimRay(origin, ray);
    const gun = new THREE.Vector3(p.x + Math.sin(p.yaw) * 0.5 - Math.cos(p.yaw) * 0.25, 1.35, p.z + Math.cos(p.yaw) * 0.5 + Math.sin(p.yaw) * 0.25);
    if (game.fx) game.fx.muzzle(gun.x, gun.y, gun.z, w.id);
    game.emit('shot', { weapon: w });
    crimeAt(p.x, p.z, 'shotsFired');
    game.humans.panicAround(p.x, p.z, 35);
    if (w.rocket) {
      const m = new THREE.Mesh(rocketGeo, rocketMat);
      m.position.copy(gun);
      const dir = ray.clone();
      m.lookAt(gun.clone().add(dir));
      game.scene.add(m);
      state.rockets.push({ m, dir, life: 3 });
      return;
    }
    const pellets = w.pellets || 1;
    for (let k = 0; k < pellets; k++) {
      const dx = ray.x + (rand() - 0.5) * w.spread * 2, dy = ray.y + (rand() - 0.5) * w.spread * 2, dz = ray.z + (rand() - 0.5) * w.spread * 2;
      const l = Math.hypot(dx, dy, dz);
      const hit = castRay(origin.x, origin.y, origin.z, dx / l, dy / l, dz / l, w.range, p);
      const end = new THREE.Vector3(origin.x + dx / l * hit.t, origin.y + dy / l * hit.t, origin.z + dz / l * hit.t);
      if (game.fx) game.fx.tracer(gun, end, w.id === 'rifle' ? 0xfff2a0 : 0xffd27a);
      if (hit.kind === 'wall' || hit.kind === 'ground') { if (game.fx) game.fx.impact(end.x, end.y, end.z); }
      else applyHit(hit, w.dmg, 'player');
    }
  }

  function npcShoot(a, target) {
    const tx = target.x, tz = target.z;
    const d = dist(a.x, a.z, tx, tz);
    const from = new THREE.Vector3(a.x + Math.sin(a.yaw) * 0.5, 1.35, a.z + Math.cos(a.yaw) * 0.5);
    const accuracy = (a.faction === 'cop' ? 0.55 : a.faction === 'crew' ? 0.6 : 0.45) * Math.max(0.15, 1 - d / 45);
    const hitIt = rand() < accuracy;
    const end = new THREE.Vector3(tx + (hitIt ? 0 : (rand() - 0.5) * 3), hitIt ? 1.2 : 0.6 + rand() * 1.5, tz + (hitIt ? 0 : (rand() - 0.5) * 3));
    if (game.fx) { game.fx.tracer(from, end, a.faction === 'crew' ? 0x7af7ff : 0xffb07a); game.fx.muzzle(from.x, from.y, from.z, 'npc'); }
    game.emit('npcShot', { a, d: dist(a.x, a.z, game.player.x, game.player.z) });
    if (!hitIt) return;
    const dmg = a.weapon === 'smg' ? 5 : a.weapon === 'rifle' ? 11 : 8;
    if (target.isPlayer) {
      if (target.vehicle) game.vehicleSys.damage(target.vehicle, dmg * 0.8, a.faction);
      else target.hurt(dmg, a.faction);
    } else damageActor(target, dmg * (a.faction === 'crew' ? 2.2 : 1), a.faction);
  }

  game.on('explosion', (e) => {
    if (game.fx) game.fx.explosion(e.x, 1.2, e.z, e.radius);
    for (const a of game.actors) {
      if (!a.alive) continue;
      const d = dist(a.x, a.z, e.x, e.z);
      if (d < e.radius) damageActor(a, 140 * (1 - d / e.radius) + 20, e.source);
    }
    for (const v of game.vehicles) {
      if (v === e.vehicle || v.wrecked) continue;
      const d = dist(v.x, v.z, e.x, e.z);
      if (d < e.radius) {
        game.vehicleSys.damage(v, 90 * (1 - d / e.radius) + 10, e.source);
        v.spin += (rand() - 0.5) * 4;
      }
    }
    const p = game.player;
    const dp = dist(p.x, p.z, e.x, e.z);
    if (dp < e.radius && !p.vehicle) p.hurt(70 * (1 - dp / e.radius), 'explosion');
    if (e.source === 'player') crimeAt(e.x, e.z, 'explosion');
    game.humans.panicAround(e.x, e.z, 45);
  });

  function update(dt, input) {
    const p = game.player;
    state.cd -= dt;
    if (state.reloadT > 0) {
      state.reloadT -= dt;
      if (state.reloadT <= 0) {
        const am = ammo[state.index], w = weapon();
        const need = w.clip - am.clip, take = Math.min(need, am.reserve);
        am.clip += take; am.reserve -= take;
        game.emit('reloaded', w);
      }
    }
    if (p.alive && !p.vehicle && input.enabled && !game.wheelOpen) {
      for (let i = 0; i < WEAPONS.length; i++) if (input.wasPressed(WEAPONS[i].key)) select(i);
      if (input.wheel) cycle(input.wheel > 0 ? 1 : -1);
      const w = weapon();
      const want = w.auto ? input.fire : input.firePressed;
      if (want && state.cd <= 0 && state.reloadT <= 0) fire();
    }
    for (let i = state.rockets.length - 1; i >= 0; i--) {
      const r = state.rockets[i];
      const step = 48 * dt;
      const pos = r.m.position;
      const hit = castRay(pos.x, pos.y, pos.z, r.dir.x, r.dir.y, r.dir.z, step, p);
      r.life -= dt;
      if (game.fx) game.fx.smoke(pos.x, pos.y, pos.z, 0.25);
      if (hit.kind !== 'none' || r.life <= 0) {
        const hx = pos.x + r.dir.x * hit.t, hz = pos.z + r.dir.z * hit.t;
        game.emit('explosion', { x: hx, z: hz, radius: 8, source: 'player' });
        if (hit.kind === 'vehicle') game.vehicleSys.damage(hit.obj, 400, 'player');
        game.scene.remove(r.m);
        state.rockets.splice(i, 1);
      } else pos.addScaledVector(r.dir, step);
    }
  }

  function refill() {
    WEAPONS.forEach((w, i) => { ammo[i].clip = w.clip; ammo[i].reserve = w.reserve ?? 0; });
  }

  return { WEAPONS, ammo, state, weapon, select, cycle, aiming, update, npcShoot, damageActor, castRay, refill, fire };
}
