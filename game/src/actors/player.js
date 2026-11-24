// The player: on-foot movement relative to the camera, sprinting, entering and leaving cars
// (carjacking included) and driving input, plus the follow camera for both modes.
import * as THREE from 'three';
import { buildHumanMesh, animateHuman } from './humans.js';
import { PLAYER_RADIUS } from '../core/config.js';
import { clamp, wrapAngle, damp, dist2 } from '../core/mathutil.js';

export const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  enter: ['KeyF', 'KeyE'],
  handbrake: ['Space'],
};

export function createPlayer(game, x, z) {
  const mesh = buildHumanMesh('player', 0x1d2b44);
  game.scene.add(mesh);
  const p = {
    x, z, yaw: 0, camYaw: Math.PI, camPitch: 0.12,
    hp: 100, maxHp: 100, armor: 0, alive: true, isPlayer: true,
    vehicle: null, mesh, moving: false, phase: 0, stamina: 1,
    camDist: 5.5, carCamYaw: 0, orbit: 0, lastMoveT: 0,
  };
  p.yaw = p.camYaw;
  const camPos = new THREE.Vector3(x, 4, z + 6);
  const look = new THREE.Vector3();

  function canStand(px, pz) { return !game.colliders.pointBlocked(px, pz, PLAYER_RADIUS + 0.05); }

  function enterNearest() {
    const v = game.vehicleSys.nearestFree(p.x, p.z, 4.2);
    if (!v || v.wrecked) return false;
    if (v.driver && v.driver !== 'player' && v.driver !== 'crew') {
      // Carjack: the driver is thrown out and runs.
      const side = { x: v.x + Math.cos(v.yaw) * 2.2, z: v.z - Math.sin(v.yaw) * 2.2 };
      const victim = game.humans.spawn(v.faction === 'cop' ? 'cop' : 'civ', side.x, side.z);
      game.colliders.resolveCircle(victim, PLAYER_RADIUS);
      if (victim.faction === 'civ') victim.panicT = 8;
      game.emit('crime', { type: v.driver === 'cop' ? 'copCarTheft' : 'carjack', x: v.x, z: v.z });
      game.emit('carjack', v);
    }
    v.driver = 'player';
    v.ai = null;
    p.vehicle = v;
    p.mesh.visible = false;
    p.carCamYaw = v.yaw;
    game.emit('enterCar', v);
    return true;
  }

  function exitCar() {
    const v = p.vehicle;
    if (!v) return false;
    if (Math.abs(v.speed) > 9) return false;
    const opts = [
      [Math.cos(v.yaw) * -2.3, Math.sin(v.yaw) * 2.3],
      [Math.cos(v.yaw) * 2.3, Math.sin(v.yaw) * -2.3],
      [Math.sin(v.yaw) * 3.4, Math.cos(v.yaw) * 3.4],
      [Math.sin(v.yaw) * -3.4, Math.cos(v.yaw) * -3.4],
    ];
    let placed = false;
    for (const [ox, oz] of opts) {
      if (canStand(v.x + ox, v.z + oz)) { p.x = v.x + ox; p.z = v.z + oz; placed = true; break; }
    }
    if (!placed) { p.x = v.x; p.z = v.z; game.colliders.resolveCircle(p, 2.2); }
    v.driver = null; v.throttle = 0; v.steerIn = 0; v.brake = true;
    p.vehicle = null;
    p.mesh.visible = true;
    p.camYaw = v.yaw;
    game.emit('exitCar', v);
    return true;
  }

  function updateOnFoot(dt, input) {
    const fwd = (input.isDown(...KEYS.forward) ? 1 : 0) - (input.isDown(...KEYS.back) ? 1 : 0);
    const str = (input.isDown(...KEYS.right) ? 1 : 0) - (input.isDown(...KEYS.left) ? 1 : 0);
    const sprint = input.isDown(...KEYS.sprint) && p.stamina > 0.05;
    let speed = sprint ? 7.6 : 4.4;
    if (fwd || str) {
      const len = Math.hypot(fwd, str);
      // Camera looks along camYaw; forward on screen is (sin camYaw, cos camYaw).
      const fx = Math.sin(p.camYaw), fz = Math.cos(p.camYaw);
      const rx = -fz, rz = fx;
      const mx = (fx * fwd + rx * str) / len, mz = (fz * fwd + rz * str) / len;
      p.x += mx * speed * dt; p.z += mz * speed * dt;
      p.yaw = game.combat && game.combat.aiming() ? p.camYaw : Math.atan2(mx, mz);
      p.moving = true; p.lastMoveT = game.time;
      p.stamina = clamp(p.stamina + (sprint ? -0.18 : 0.12) * dt, 0, 1);
    } else {
      p.moving = false;
      p.stamina = clamp(p.stamina + 0.2 * dt, 0, 1);
      if (game.combat && game.combat.aiming()) p.yaw = p.camYaw;
    }
    game.colliders.resolveCircle(p, PLAYER_RADIUS);
    // Never let the player stand inside a parked car.
    for (const v of game.vehicles) {
      const dx = p.x - v.x, dz = p.z - v.z, d2 = dx * dx + dz * dz, r = 1.9;
      if (d2 < r * r && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = v.x + dx / d * r; p.z = v.z + dz / d * r;
        if (Math.abs(v.speed) > 6 && v.driver !== 'player') {
          hurt(Math.abs(v.speed) * 2.2, 'car');
        }
      }
    }
    game.colliders.resolveCircle(p, PLAYER_RADIUS);
    p.phase += dt * (p.moving ? (sprint ? 13 : 9) : 0);
    p.mesh.position.set(p.x, 0.2 + (p.moving ? Math.abs(Math.sin(p.phase)) * 0.06 : 0), p.z);
    p.mesh.rotation.y = p.yaw;
    animateHuman(p.mesh, p.phase, p.moving, false);
  }

  function updateDriving(dt, input) {
    const v = p.vehicle;
    const up = input.isDown(...KEYS.forward), down = input.isDown(...KEYS.back);
    v.throttle = up ? 1 : down ? -1 : 0;
    v.steerIn = (input.isDown(...KEYS.left) ? 1 : 0) - (input.isDown(...KEYS.right) ? 1 : 0);
    v.brake = input.isDown(...KEYS.handbrake);
    p.x = v.x; p.z = v.z;
    if (v.wrecked || v.onFire && v.burnT < 1.2) {
      // Bail out of a burning car before it blows.
      if (v.onFire) exitCar();
    }
  }

  function hurt(amount, source) {
    if (!p.alive) return;
    if (p.armor > 0) {
      const a = Math.min(p.armor, amount * 0.7);
      p.armor -= a; amount -= a;
    }
    p.hp -= amount;
    game.emit('playerHurt', { amount, source });
    if (p.hp <= 0) {
      p.hp = 0; p.alive = false;
      game.emit('wasted', { source });
    }
  }

  function update(dt, input) {
    if (!p.alive) return;
    // Mouse look (both modes).
    const sens = 0.0026;
    if (input.enabled) {
      p.camYaw -= input.mouseDX * sens;
      p.camPitch = clamp(p.camPitch + input.mouseDY * sens, -0.35, 0.8);
    }
    if (input.enabled && input.wasPressed(...KEYS.enter)) {
      if (p.vehicle) exitCar(); else enterNearest();
    }
    if (p.vehicle) updateDriving(dt, input); else updateOnFoot(dt, input);
  }

  // Follow camera with collision pull-in against buildings.
  function updateCamera(dt, camera) {
    let tx, ty, tz, lx, ly, lz;
    if (p.vehicle) {
      const v = p.vehicle;
      p.carCamYaw += wrapAngle(v.yaw - p.carCamYaw) * Math.min(1, dt * 3.2);
      // Mouse orbit around the car eases back behind it.
      p.orbit = wrapAngle(p.camYaw - p.carCamYaw);
      if (game.time - (p.lastMouseT || 0) > 1.5) p.camYaw = p.carCamYaw + p.orbit * Math.exp(-dt * 2);
      const yaw = p.camYaw;
      const back = 9 + Math.min(4, Math.abs(v.speed) * 0.08);
      tx = v.x - Math.sin(yaw) * back; tz = v.z - Math.cos(yaw) * back; ty = 3.8 + p.camPitch * 4;
      lx = v.x + Math.sin(yaw) * 4; ly = 1.4; lz = v.z + Math.cos(yaw) * 4;
    } else {
      const yaw = p.camYaw, dist = p.camDist;
      const rx = -Math.cos(yaw) * 0.9, rz = Math.sin(yaw) * 0.9;
      tx = p.x - Math.sin(yaw) * dist * Math.cos(p.camPitch) + rx;
      tz = p.z - Math.cos(yaw) * dist * Math.cos(p.camPitch) + rz;
      ty = 1.9 + Math.sin(p.camPitch) * dist + 0.6;
      lx = p.x + Math.sin(yaw) * 6 + rx; ly = 1.7 - p.camPitch * 3; lz = p.z + Math.cos(yaw) * 6 + rz;
    }
    // Pull the camera in when a wall stands between it and the player.
    const px = p.x, pz = p.z;
    let f = 1;
    for (let s = 1; s <= 8; s++) {
      const t = s / 8;
      if (game.colliders.pointBlocked(px + (tx - px) * t, pz + (tz - pz) * t, 0.3)) { f = Math.max(0.15, (s - 1) / 8); break; }
    }
    tx = px + (tx - px) * f; tz = pz + (tz - pz) * f;
    camPos.set(damp(camPos.x, tx, 12, dt), damp(camPos.y, ty, 10, dt), damp(camPos.z, tz, 12, dt));
    if (dist2(camPos.x, camPos.z, tx, tz) > 400) camPos.set(tx, ty, tz);
    camera.position.copy(camPos);
    look.set(lx, ly, lz);
    camera.lookAt(look);
  }

  function snapCamera(camera) {
    camPos.set(p.x - Math.sin(p.camYaw) * 6, 3, p.z - Math.cos(p.camYaw) * 6);
    updateCamera(1, camera);
  }

  function teleport(x, z, yaw = p.camYaw) {
    if (p.vehicle) exitCar();
    p.x = x; p.z = z; p.camYaw = yaw; p.yaw = yaw;
    game.colliders.resolveCircle(p, PLAYER_RADIUS);
    p.mesh.position.set(p.x, 0.2, p.z);
  }

  function respawn(x, z) {
    p.alive = true; p.hp = p.maxHp; p.armor = 0;
    teleport(x, z);
    p.mesh.visible = true;
  }

  Object.assign(p, { update, updateCamera, snapCamera, hurt, enterNearest, exitCar, teleport, respawn });
  return p;
}
