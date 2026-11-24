// Vehicles: arcade driving physics, damage, fire and explosions, plus the AI steering every
// non-player driver uses (traffic, police, racers, convoys).
import { CAR_KINDS, buildCarMesh, wreckMesh, paintMaterial, lightMats } from './carmodel.js';
import { CAR_RADIUS, COLORS } from '../core/config.js';
import { clamp, wrapAngle, dist2 } from '../core/mathutil.js';
import { rand, pick } from '../core/rng.js';
import { neighbors, lanePoint, nearestNode, nodePos, randomNode } from '../world/roads.js';

let nextId = 1;

export function createVehicles(game) {
  const list = game.vehicles;

  function spawn(kind, x, z, yaw, opts = {}) {
    const k = CAR_KINDS[kind];
    const color = opts.color ?? (kind === 'police' ? 0x15161c : kind === 'taxi' ? 0xffc21a : kind === 'armored' ? 0x2b3a2f : pick(COLORS.paint));
    const mesh = buildCarMesh(kind, color);
    mesh.position.set(x, 0.2, z);
    mesh.rotation.y = yaw;
    game.scene.add(mesh);
    const v = {
      id: nextId++, kind, k, mesh, color,
      x, z, yaw, speed: 0, spin: 0, steer: 0,
      throttle: 0, steerIn: 0, brake: false,
      hp: k.hp * (opts.hpMul ?? 1), maxHp: k.hp * (opts.hpMul ?? 1),
      driver: opts.driver ?? null,      // 'player' | 'traffic' | 'cop' | 'racer' | 'convoy' | 'crew' | null
      ai: opts.ai ?? null,
      onFire: false, burnT: 0, wrecked: false, smokeT: 0,
      stuckT: 0, lastX: x, lastZ: z,
      faction: opts.faction ?? 'civ',
      tag: opts.tag ?? null,
      removeAt: 0,
    };
    list.push(v);
    return v;
  }

  function remove(v) {
    game.scene.remove(v.mesh);
    const i = list.indexOf(v);
    if (i >= 0) list.splice(i, 1);
  }

  function repaint(v, hex) {
    v.color = hex;
    v.mesh.userData.body.material = paintMaterial(hex);
  }

  // Apply damage; below a quarter the engine catches fire and blows a few seconds later.
  function damage(v, amount, source) {
    if (v.wrecked) return;
    const armor = v.driver === 'player' ? (game.garage ? game.garage.armorFactor() : 1) : 1;
    v.hp -= amount * armor;
    if (source === 'player') v.lastHitByPlayer = game.time;
    if (v.hp <= v.maxHp * 0.25 && !v.onFire) {
      v.onFire = true; v.burnT = 5.5;
      game.emit('carOnFire', v);
    }
    if (v.hp <= -v.maxHp * 0.3) explode(v);
  }

  function explode(v) {
    if (v.wrecked) return;
    v.wrecked = true; v.onFire = false; v.speed = 0; v.spin = 0;
    wreckMesh(v.mesh);
    v.mesh.position.y = 0.05;
    game.emit('explosion', { x: v.x, z: v.z, radius: 9, source: v.lastHitByPlayer && game.time - v.lastHitByPlayer < 10 ? 'player' : 'world', vehicle: v });
    v.removeAt = game.time + 240;
  }

  // Steering helper shared by all AI drivers: aim at (tx,tz) at targetSpeed.
  function driveToward(v, tx, tz, targetSpeed, dt) {
    const want = Math.atan2(tx - v.x, tz - v.z);
    const err = wrapAngle(want - v.yaw);
    v.steerIn = clamp(err * 2.2, -1, 1);
    const slow = Math.abs(err) > 0.9 ? 0.45 : Math.abs(err) > 0.4 ? 0.75 : 1;
    const desired = targetSpeed * slow;
    if (v.speed < desired - 0.5) v.throttle = 1;
    else if (v.speed > desired + 1.5) v.throttle = -0.6;
    else v.throttle = 0.15;
    v.brake = false;
    void dt;
  }

  function pickNextNode(cur, prev) {
    const nb = neighbors(cur).filter((n) => n !== prev);
    return nb.length ? pick(nb) : prev;
  }

  // Traffic follows the road graph lane by lane and brakes for anything in front.
  function updateTraffic(v, dt) {
    const ai = v.ai;
    const target = lanePoint(ai.from, ai.to, 0.82, tmpP);
    const d2 = dist2(v.x, v.z, target.x, target.z);
    if (d2 < 36) {
      const next = pickNextNode(ai.to, ai.from);
      ai.from = ai.to; ai.to = next;
    }
    const aim = lanePoint(ai.from, ai.to, 0.82, tmpP);
    let speed = ai.cruise;
    if (obstacleAhead(v, 9)) speed = 0;
    if (game.police && game.police.stars >= 3) speed *= 1.1;
    driveToward(v, aim.x, aim.z, speed, dt);
    if (speed === 0) { v.throttle = v.speed > 0.3 ? -1 : 0; }
  }

  function obstacleAhead(v, range) {
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    const test = (x, z, r) => {
      const dx = x - v.x, dz = z - v.z;
      const along = dx * fx + dz * fz;
      if (along < 1 || along > range) return false;
      const side = Math.abs(dx * fz - dz * fx);
      return side < r;
    };
    for (const o of list) {
      if (o !== v && test(o.x, o.z, 2.0)) return true;
    }
    const p = game.player;
    if (p && !p.vehicle && test(p.x, p.z, 1.6)) return true;
    for (const a of game.actors) if (a.alive && a.crossing && test(a.x, a.z, 1.3)) return true;
    return false;
  }

  const tmpP = {};

  function physics(v, dt) {
    if (v.wrecked) { v.speed *= 0.9; return; }
    const k = v.k;
    const upg = v.driver === 'player' && game.garage ? game.garage.speedFactor() : 1;
    const maxF = k.maxSpeed * upg, accel = k.accel * (0.6 + 0.4 * upg);
    const hpFactor = v.hp < v.maxHp * 0.25 ? 0.6 : 1;
    if (v.throttle > 0) {
      if (v.speed < 0) v.speed += 26 * dt * v.throttle;
      else v.speed += accel * v.throttle * hpFactor * (1 - v.speed / (maxF * hpFactor + 0.01) * 0.6) * dt;
    } else if (v.throttle < 0) {
      if (v.speed > 0.4) v.speed += 28 * v.throttle * dt;
      else v.speed += accel * 0.6 * v.throttle * dt;
    } else {
      v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 4 * dt);
    }
    if (v.brake) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 22 * dt);
    v.speed = clamp(v.speed, -12, maxF * hpFactor);
    v.steer += (v.steerIn - v.steer) * Math.min(1, dt * 8);
    const sp = Math.abs(v.speed);
    const turn = v.steer * 1.9 * clamp(sp / 5, 0, 1) * (1 - 0.45 * Math.min(1, sp / 40)) * (v.brake ? 1.5 : 1);
    v.yaw = wrapAngle(v.yaw + (turn * Math.sign(v.speed || 1) + v.spin) * dt);
    v.spin *= Math.exp(-2.5 * dt);
    v.x += Math.sin(v.yaw) * v.speed * dt;
    v.z += Math.cos(v.yaw) * v.speed * dt;

    // Walls: push out and slide; hard hits cost speed and health.
    const hit = game.colliders.resolveCircle(v, CAR_RADIUS);
    if (hit.pushed > 0.02) {
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      const head = -(fx * hit.nx + fz * hit.nz) * Math.sign(v.speed); // 1 = head-on
      const impact = Math.abs(v.speed) * Math.max(0, head);
      if (impact > 6) {
        damage(v, (impact - 6) * 1.6, v.driver === 'player' ? 'self' : 'world');
        game.emit('carCrash', { v, impact });
      }
      v.speed *= head > 0.5 ? 0.25 : 0.86;
    }
    // Unstuck guard: wheels turning but the car not moving for a while.
    const moved = Math.hypot(v.x - v.lastX, v.z - v.lastZ);
    if (Math.abs(v.throttle) > 0.1 && moved < 0.01) {
      v.stuckT += dt;
      if (v.stuckT > 1.2) {
        v.speed = -Math.sign(v.throttle) * 4;
        v.yaw += 0.6;
        v.stuckT = 0;
      }
    } else v.stuckT = 0;
    v.lastX = v.x; v.lastZ = v.z;
    // Second guard, over a longer window: wheels driven for 1.5 s with under 0.6 m of net travel
    // (the car jitters in a gap between two colliders) — lift it to the nearest open spot.
    if (v.driver === 'player' && Math.abs(v.throttle) > 0.1) {
      if (v.winT === undefined) { v.winT = 0; v.winX = v.x; v.winZ = v.z; }
      v.winT += dt;
      if (v.winT > 1.5) {
        if (Math.hypot(v.x - v.winX, v.z - v.winZ) < 0.6) freeSpot(v);
        v.winT = 0; v.winX = v.x; v.winZ = v.z;
      }
    } else v.winT = undefined;
  }

  // Search rings around a car for the nearest place it fits, and move it there.
  function freeSpot(v) {
    for (let r = 2; r <= 14; r += 2) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const x = v.x + Math.sin(a) * r, z = v.z + Math.cos(a) * r;
        if (!game.colliders.pointBlocked(x, z, CAR_RADIUS + 0.3)) {
          v.x = x; v.z = z; v.speed = 0; v.spin = 0;
          game.emit('carUnstuck', v);
          return true;
        }
      }
    }
    return false;
  }

  // Car-to-car contact: circles separate, the lighter car takes more of the shove.
  function carContacts(dt) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        const r = CAR_RADIUS * 2;
        if (d2 >= r * r || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, push = r - d;
        const ma = a.wrecked ? 3 : a.k.mass, mb = b.wrecked ? 3 : b.k.mass;
        const ta = mb / (ma + mb), tb = ma / (ma + mb);
        a.x -= nx * push * ta; a.z -= nz * push * ta;
        b.x += nx * push * tb; b.z += nz * push * tb;
        const va = a.speed * (Math.sin(a.yaw) * nx + Math.cos(a.yaw) * nz);
        const vb = b.speed * (Math.sin(b.yaw) * nx + Math.cos(b.yaw) * nz);
        const closing = va - vb;
        if (closing > 3) {
          const dmg = (closing - 3) * 1.4;
          damage(a, dmg * ta, b.driver === 'player' ? 'player' : 'world');
          damage(b, dmg * tb, a.driver === 'player' ? 'player' : 'world');
          game.emit('carHitCar', { a, b, closing, nx, nz });
          a.speed *= 0.7; b.speed *= 0.7;
        }
      }
    }
    void dt;
  }

  function spawnTraffic(count) {
    for (let n = 0; n < count; n++) {
      const from = randomNode();
      const nb = neighbors(from);
      const to = pick(nb);
      const p = lanePoint(from, to, rand() * 0.6 + 0.1, {});
      const kind = rand() < 0.15 ? 'taxi' : rand() < 0.12 ? 'van' : rand() < 0.1 ? 'sports' : rand() < 0.1 ? 'muscle' : 'sedan';
      const v = spawn(kind, p.x, p.z, p.yaw, { driver: 'traffic', ai: { from, to, cruise: 8 + rand() * 4 } });
      v.speed = v.ai.cruise * 0.8;
    }
  }

  // Keep traffic dense near the player: recycle cars that drift far away.
  function recycleTraffic() {
    const p = game.player;
    if (!p) return;
    for (const v of list) {
      if (v.driver !== 'traffic') continue;
      if (dist2(v.x, v.z, p.x, p.z) > 230 * 230) {
        let node = nearestNode(p.x + (rand() - 0.5) * 300, p.z + (rand() - 0.5) * 300);
        const np = nodePos(node);
        if (dist2(np.x, np.z, p.x, p.z) < 70 * 70) continue;
        const to = pick(neighbors(node));
        const lp = lanePoint(node, to, 0.3, {});
        if (game.colliders.pointBlocked(lp.x, lp.z, 1.5)) continue;
        v.x = lp.x; v.z = lp.z; v.yaw = lp.yaw; v.speed = 6;
        v.ai.from = node; v.ai.to = to;
      }
    }
  }

  let flash = 0, recycleT = 0;
  function update(dt) {
    for (const v of list) {
      if (v.driver === 'traffic' && v.ai && !v.wrecked) updateTraffic(v, dt);
      else if (v.ai && v.ai.update && !v.wrecked) v.ai.update(v, dt);
      else if (!v.driver && !v.wrecked) { v.throttle = 0; v.steerIn = 0; }
      physics(v, dt);
      if (v.onFire && !v.wrecked) {
        v.burnT -= dt;
        if (game.fx) game.fx.fire(v.x, 1.4, v.z, 1);
        if (v.burnT <= 0) explode(v);
      } else if (v.wrecked) {
        v.smokeT -= dt;
        if (v.smokeT <= 0 && game.fx) { game.fx.smoke(v.x, 1.2, v.z, 0.8); if (game.time < v.removeAt - 200) game.fx.fire(v.x, 0.9, v.z, 0.5); v.smokeT = 0.25; }
      } else if (v.hp < v.maxHp * 0.5) {
        v.smokeT -= dt;
        if (v.smokeT <= 0 && game.fx) { game.fx.smoke(v.x + Math.sin(v.yaw) * 1.8, 1.2, v.z + Math.cos(v.yaw) * 1.8, 0.45); v.smokeT = 0.3; }
      }
    }
    carContacts(dt);
    for (const v of list) {
      v.mesh.position.x = v.x; v.mesh.position.z = v.z;
      v.mesh.rotation.y = v.yaw;
      v.mesh.rotation.z = -v.steer * Math.min(1, Math.abs(v.speed) / 30) * 0.05;
    }
    flash += dt;
    const on = Math.floor(flash * 6) % 2 === 0;
    lightMats.red.color.setHex(on ? 0xff1030 : 0x330006);
    lightMats.blue.color.setHex(on ? 0x05050f : 0x1060ff);
    recycleT -= dt;
    if (recycleT <= 0) { recycleTraffic(); recycleT = 1; }
    for (let i = list.length - 1; i >= 0; i--) {
      const v = list[i];
      if (v.wrecked && game.time > v.removeAt && v.driver !== 'player') remove(v);
    }
  }

  function nearestFree(x, z, maxD) {
    let best = null, bd = maxD * maxD;
    for (const v of list) {
      if (v.wrecked || v.driver === 'player') continue;
      const d = dist2(x, z, v.x, v.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  return { spawn, remove, damage, explode, repaint, driveToward, update, spawnTraffic, nearestFree, obstacleAhead, list };
}

