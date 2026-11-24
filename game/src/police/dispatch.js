// VPD dispatch: patrol units that route through the streets, RAM and PIT the player's car,
// deploy officers, roadblocks ahead of the player from three stars, and the Air One helicopter
// with a live searchlight from four. Radio chatter goes to the HUD ticker.
import * as THREE from 'three';
import { dist, dist2, clamp, wrapAngle } from '../core/mathutil.js';
import { rand, randInt, pick } from '../core/rng.js';
import { nearestNode, route, nodePos, neighbors, lanePoint, N } from '../world/roads.js';
import { districtAt } from '../world/districts.js';
import { mergeColored, boxPart, cylPart, makeGlowTexture } from '../core/geometry.js';

const UNITS_FOR_STARS = [0, 1, 2, 3, 4, 5];

function compass(dx, dz) {
  const a = Math.atan2(dx, -dz);
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}

export function createDispatch(game) {
  const units = [];
  const roadblocks = [];
  const d = { units, roadblocks, heli: null, rbT: 8, spawnT: 0, pits: 0, rams: 0, chatterT: 6 };
  const say = (msg) => game.emit('dispatch', msg);
  let unitNo = 10;

  function playerHeading() {
    const p = game.player;
    if (p.vehicle) return { x: Math.sin(p.vehicle.yaw), z: Math.cos(p.vehicle.yaw), speed: p.vehicle.speed };
    return { x: Math.sin(p.yaw), z: Math.cos(p.yaw), speed: p.moving ? 5 : 0 };
  }

  function spawnUnit() {
    const p = game.player;
    for (let tries = 0; tries < 12; tries++) {
      const ang = rand() * Math.PI * 2, r = 90 + rand() * 70;
      const node = nearestNode(p.x + Math.sin(ang) * r, p.z + Math.cos(ang) * r);
      const to = pick(neighbors(node));
      const lp = lanePoint(node, to, 0.3, {});
      if (dist2(lp.x, lp.z, p.x, p.z) < 60 * 60) continue;
      if (game.colliders.pointBlocked(lp.x, lp.z, 1.6)) continue;
      const v = game.vehicleSys.spawn('police', lp.x, lp.z, lp.yaw, { driver: 'cop', faction: 'cop' });
      v.unit = { no: unitNo++, role: units.length % 2 ? 'pit' : 'ram', deployed: false, fireCd: 2, pitCd: 0 };
      v.ai = { update: copDrive };
      units.push(v);
      say(`Unit ${v.unit.no} responding, ${v.unit.role === 'pit' ? 'PIT-trained' : 'ram'} interceptor en route`);
      return v;
    }
    return null;
  }

  // Police driving: route through the grid while far, chase directly when close,
  // then RAM (straight into the target) or PIT (into the rear quarter, spinning it out).
  function copDrive(v, dt) {
    const p = game.player;
    const u = v.unit;
    const tx = p.x, tz = p.z;
    const dd = dist(v.x, v.z, tx, tz);
    u.pitCd -= dt;
    if (game.police.stars === 0) {
      // Stand down: drive off and despawn once far away.
      const away = { x: v.x + Math.sin(v.yaw) * 30, z: v.z + Math.cos(v.yaw) * 30 };
      game.vehicleSys.driveToward(v, away.x, away.z, 14, dt);
      return;
    }
    if (!p.vehicle && dd < 18) {
      v.throttle = v.speed > 0.5 ? -1 : 0; v.steerIn = 0; v.brake = true;
      if (!u.deployed && Math.abs(v.speed) < 2) {
        u.deployed = true;
        for (let k = 0; k < 2; k++) {
          const side = k ? 1 : -1;
          const o = game.humans.spawn('cop', v.x + Math.cos(v.yaw) * 2.4 * side, v.z - Math.sin(v.yaw) * 2.4 * side);
          game.colliders.resolveCircle(o, 0.5);
        }
        say(`Unit ${u.no} on scene, officers on foot`);
      }
      return;
    }
    const los = dd < 55 && !game.colliders.segmentBlocked(v.x, v.z, tx, tz);
    if (los) {
      let ax = tx, az = tz, sp = 40;
      if (p.vehicle) {
        const pv = p.vehicle;
        const fx = Math.sin(pv.yaw), fz = Math.cos(pv.yaw);
        if (u.role === 'pit' && dd < 22) {
          const side = wrapAngle(Math.atan2(v.x - pv.x, v.z - pv.z) - pv.yaw) > 0 ? 1 : -1;
          ax = pv.x - fx * 1.6 + fz * side * 1.4; az = pv.z - fz * 1.6 - fx * side * 1.4;
          sp = Math.abs(pv.speed) + 7;
        } else {
          ax = pv.x + fx * Math.min(8, Math.abs(pv.speed) * 0.4); az = pv.z + fz * Math.min(8, Math.abs(pv.speed) * 0.4);
          sp = Math.abs(pv.speed) + 10;
        }
      } else sp = clamp(dd * 0.8, 6, 30);
      game.vehicleSys.driveToward(v, ax, az, Math.min(sp, 42), dt);
      // Passenger fire from three stars.
      u.fireCd -= dt;
      if (game.police.stars >= 3 && dd < 28 && u.fireCd <= 0) {
        u.fireCd = 1.3 + rand();
        game.combat.npcShoot({ x: v.x, z: v.z, yaw: Math.atan2(tx - v.x, tz - v.z), faction: 'cop', weapon: 'smg' }, p);
      }
    } else {
      const from = nearestNode(v.x, v.z), to = nearestNode(tx, tz);
      const path = route(from, to);
      const next = path.length > 1 ? path[1] : path[0];
      const np = nodePos(next);
      const reached = dist2(v.x, v.z, np.x, np.z) < 100 && path.length > 1;
      const aim = reached && path.length > 2 ? nodePos(path[2]) : np;
      game.vehicleSys.driveToward(v, aim.x, aim.z, 30, dt);
    }
  }

  // Contact between a cop car and the player's car: PIT spins it, RAM smashes it.
  game.on('carHitCar', ({ a, b, closing }) => {
    const pv = game.player.vehicle;
    if (!pv) return;
    const cop = a === pv ? b : b === pv ? a : null;
    if (!cop || !cop.unit || cop.unit.pitCd > 0) return;
    cop.unit.pitCd = 2.5;
    const rel = wrapAngle(Math.atan2(cop.x - pv.x, cop.z - pv.z) - pv.yaw);
    const rear = Math.abs(rel) > Math.PI * 0.45;
    if (cop.unit.role === 'pit' && rear) {
      pv.spin += (rel > 0 ? -1 : 1) * (3.2 + closing * 0.15);
      pv.speed *= 0.55;
      d.pits++;
      game.emit('pit', { cop, pv });
      say(`Unit ${cop.unit.no}: PIT maneuver executed!`);
    } else {
      game.vehicleSys.damage(pv, 6 + closing * 1.2, 'cop');
      d.rams++;
      game.emit('ram', { cop, pv });
      say(`Unit ${cop.unit.no} ramming the suspect vehicle`);
    }
  });

  // Roadblock: two cruisers parked across the road ahead of the player, officers behind them.
  function spawnRoadblock() {
    const p = game.player;
    const h = playerHeading();
    const ahead = 70 + Math.min(40, Math.abs(h.speed) * 1.5);
    const node = nearestNode(p.x + h.x * ahead, p.z + h.z * ahead);
    const np = nodePos(node);
    if (dist2(np.x, np.z, p.x, p.z) < 40 * 40) return null;
    // Block the approach from the player's side.
    let best = null, bd = 1e9;
    for (const nb of neighbors(node)) {
      const q = nodePos(nb);
      const dd = dist2(q.x, q.z, p.x, p.z);
      if (dd < bd) { bd = dd; best = q; }
    }
    if (!best) return null;
    const ax = Math.sign(best.x - np.x), az = Math.sign(best.z - np.z);
    const cx = np.x + ax * 14, cz = np.z + az * 14;
    const yaw = Math.atan2(az, -ax) ;
    const rb = { x: cx, z: cz, cars: [], officers: [], props: [], t: 70 };
    for (const off of [-3.4, 3.4]) {
      const x = cx + -az * off, z = cz + ax * off;
      const v = game.vehicleSys.spawn('police', x, z, yaw + (off > 0 ? 0.25 : -0.25), { driver: null, faction: 'cop' });
      v.roadblock = true;
      rb.cars.push(v);
    }
    for (const off of [-7, 7]) {
      const x = cx + -az * off, z = cz + ax * off;
      const m = new THREE.Mesh(barrierGeo, barrierMat);
      m.position.set(x, 0.2, z); m.rotation.y = yaw;
      game.scene.add(m);
      rb.props.push(m);
    }
    for (let k = 0; k < 2; k++) {
      const o = game.humans.spawn('cop', cx - ax * 3 + -az * (k ? 2 : -2), cz - az * 3 + ax * (k ? 2 : -2), { weapon: 'rifle' });
      game.colliders.resolveCircle(o, 0.5);
      rb.officers.push(o);
    }
    roadblocks.push(rb);
    const dist0 = Math.round(Math.sqrt(dist2(cx, cz, p.x, p.z)));
    say(`Roadblock set on ${districtAt(cx, cz).name}, ${dist0} m ${compass(cx - p.x, cz - p.z)} of suspect`);
    game.emit('roadblock', rb);
    return rb;
  }

  const barrierGeo = mergeColored([
    boxPart(3.2, 0.35, 0.25, 0, 0.9, 0, 0xff6a00), boxPart(3.2, 0.35, 0.26, 0, 0.5, 0, 0xffffff),
    boxPart(0.15, 1.1, 0.5, -1.4, 0.55, 0, 0x333333), boxPart(0.15, 1.1, 0.5, 1.4, 0.55, 0, 0x333333),
  ]);
  const barrierMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });

  function removeRoadblock(rb) {
    for (const v of rb.cars) if (!v.wrecked) game.vehicleSys.remove(v);
    for (const m of rb.props) game.scene.remove(m);
    for (const o of rb.officers) if (o.alive) o.removeAt = game.time;
    roadblocks.splice(roadblocks.indexOf(rb), 1);
  }

  // Air One: rotor helicopter that circles the player with a searchlight that tracks them.
  function spawnHeli() {
    const p = game.player;
    const group = new THREE.Group();
    const body = new THREE.Mesh(mergeColored([
      boxPart(2.4, 2.0, 4.6, 0, 0, 0, 0x1b2a4a), boxPart(2.2, 1.2, 1.6, 0, 0.1, 2.4, 0x9fd3ff),
      boxPart(0.6, 0.6, 5.5, 0, 0.4, -4.5, 0x1b2a4a), boxPart(0.2, 1.6, 1.0, 0, 1.0, -7.0, 0xffffff),
      boxPart(2.5, 0.3, 4.6, 0, -0.2, 0, 0xffffff), boxPart(0.15, 0.6, 3.6, 1.2, -1.3, 0, 0x222222), boxPart(0.15, 0.6, 3.6, -1.2, -1.3, 0, 0x222222),
      cylPart(0.15, 0.15, 0.8, 6, 0, 1.4, 0, 0x333333),
    ]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3 }));
    body.castShadow = true;
    const rotor = new THREE.Mesh(mergeColored([boxPart(11, 0.08, 0.4, 0, 0, 0, 0x111111), boxPart(0.4, 0.08, 11, 0, 0, 0, 0x111111)]), new THREE.MeshStandardMaterial({ vertexColors: true }));
    rotor.position.y = 1.85;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2030, toneMapped: false }));
    beacon.position.set(0, -1.0, 2.0);
    group.add(body, rotor, beacon);
    const spot = new THREE.SpotLight(0xf2f6ff, 900, 120, 0.2, 0.35, 1.6);
    spot.castShadow = false;
    group.add(spot);
    game.scene.add(group);
    game.scene.add(spot.target);
    // Visible light cone (additive) and a bright ground disc.
    const coneGeo = new THREE.ConeGeometry(1, 1, 24, 1, true);
    coneGeo.translate(0, -0.5, 0);
    const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xcfe4ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({ map: makeGlowTexture(), color: 0xe8f2ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    disc.rotation.x = -Math.PI / 2;
    game.scene.add(cone, disc);
    const ang = rand() * 6.28;
    const heli = {
      group, rotor, spot, cone, disc, beacon,
      x: p.x + Math.sin(ang) * 120, z: p.z + Math.cos(ang) * 120, y: 34,
      orbit: ang, tx: p.x, tz: p.z, leaving: false, fireCd: 3, lit: false, name: 'Air One',
    };
    d.heli = heli;
    say('Air One is airborne, searchlight on, suspect ' + (game.player.vehicle ? 'in vehicle' : 'on foot'));
    game.emit('heli', heli);
    return heli;
  }

  function updateHeli(dt) {
    const h = d.heli;
    if (!h) return;
    const p = game.player;
    h.orbit += dt * 0.25;
    const R = h.leaving ? 260 : 26;
    const gx = p.x + Math.sin(h.orbit) * R, gz = p.z + Math.cos(h.orbit) * R;
    const k = Math.min(1, dt * (h.leaving ? 0.4 : 0.9));
    h.x += (gx - h.x) * k; h.z += (gz - h.z) * k;
    h.group.position.set(h.x, h.y, h.z);
    h.group.rotation.y = Math.atan2(p.x - h.x, p.z - h.z);
    h.group.rotation.z = Math.sin(game.time * 0.7) * 0.05;
    h.rotor.rotation.y += dt * 28;
    h.beacon.visible = Math.floor(game.time * 2) % 2 === 0;
    // Searchlight point chases the player at limited speed (so it can lose them).
    const sx = p.x - h.tx, sz = p.z - h.tz, sd = Math.hypot(sx, sz);
    const sp = 11 * dt;
    if (sd > 0.01 && !h.leaving) { h.tx += sx / sd * Math.min(sd, sp); h.tz += sz / sd * Math.min(sd, sp); }
    const blocked = game.colliders.segmentBlocked(h.tx, h.tz, p.x, p.z, 25);
    h.lit = !h.leaving && sd < 7 && !blocked;
    h.spot.position.set(0, -1.2, 1.2);
    h.spot.target.position.set(h.tx, 0, h.tz);
    const top = new THREE.Vector3(h.x, h.y - 1.5, h.z);
    const len = top.distanceTo(new THREE.Vector3(h.tx, 0, h.tz));
    h.cone.position.copy(top);
    h.cone.scale.set(6.5, len, 6.5);
    h.cone.lookAt(h.tx, 0, h.tz);
    h.cone.rotateX(-Math.PI / 2);
    h.disc.position.set(h.tx, 0.12, h.tz);
    h.disc.scale.setScalar(7);
    h.cone.material.opacity = 0.1 + game.sky.night * 0.14;
    h.fireCd -= dt;
    if (game.police.stars >= 5 && h.lit && h.fireCd <= 0) {
      h.fireCd = 2.6;
      game.combat.npcShoot({ x: h.x, z: h.z, yaw: 0, faction: 'cop', weapon: 'rifle' }, p);
    }
    if (h.leaving && dist2(h.x, h.z, p.x, p.z) > 220 * 220) removeHeli();
  }

  function removeHeli() {
    const h = d.heli;
    if (!h) return;
    game.scene.remove(h.group, h.cone, h.disc, h.spot.target);
    h.spot.dispose();
    d.heli = null;
  }

  d.heliSees = () => !!(d.heli && d.heli.lit);

  game.on('starsChanged', ({ from, to, decay }) => {
    const p = game.player;
    const dist0 = districtAt(p.x, p.z).name;
    if (to > from) say(`All units: ${to}-star suspect in ${dist0}, approach with caution`);
    else if (to === 0) say('Suspect lost. All units resume patrol');
    else if (decay) say(`Visual lost on suspect, last seen in ${dist0}`);
  });

  function update(dt) {
    const stars = game.police.stars;
    const p = game.player;
    for (let i = units.length - 1; i >= 0; i--) {
      const v = units[i];
      const far = dist2(v.x, v.z, p.x, p.z) > 260 * 260;
      if (v.wrecked || !game.vehicles.includes(v) || far || (stars === 0 && dist2(v.x, v.z, p.x, p.z) > 120 * 120)) {
        if (!v.wrecked && game.vehicles.includes(v)) game.vehicleSys.remove(v);
        units.splice(i, 1);
      } else if (v.driver !== 'cop') units.splice(i, 1);
    }
    const want = UNITS_FOR_STARS[stars];
    d.spawnT -= dt;
    if (units.length < want && d.spawnT <= 0 && !game.flags.dispatchHold) { spawnUnit(); d.spawnT = 2.5; }
    if (stars >= 3) {
      d.rbT -= dt;
      if (d.rbT <= 0 && roadblocks.length < 2) { if (spawnRoadblock()) d.rbT = 24; else d.rbT = 3; }
    }
    for (let i = roadblocks.length - 1; i >= 0; i--) {
      const rb = roadblocks[i];
      rb.t -= dt;
      if (rb.t <= 0 || dist2(rb.x, rb.z, p.x, p.z) > 230 * 230 || stars === 0) removeRoadblock(rb);
    }
    if (stars >= 4 && !d.heli) spawnHeli();
    if (stars < 4 && d.heli && !d.heli.leaving) { d.heli.leaving = true; say('Air One returning to base'); }
    updateHeli(dt);
    // Background chatter while wanted.
    d.chatterT -= dt;
    if (stars > 0 && d.chatterT <= 0 && units.length) {
      d.chatterT = 7 + rand() * 5;
      const u = pick(units);
      const h = playerHeading();
      const dir = compass(h.x, h.z);
      const lines = [
        `Unit ${u.unit.no} requesting backup, suspect heading ${dir}`,
        `Unit ${u.unit.no}: suspect ${p.vehicle ? 'vehicle' : 'on foot'} in ${districtAt(p.x, p.z).name}, heading ${dir}`,
        `Dispatch to all units: suspect armed and dangerous, ${stars}-star response authorized`,
        `Unit ${randInt(20, 60)} moving to intercept on ${districtAt(p.x, p.z).name}`,
      ];
      say(pick(lines));
    }
  }

  function clearAll() {
    for (const v of [...units]) if (game.vehicles.includes(v)) game.vehicleSys.remove(v);
    units.length = 0;
    for (const rb of [...roadblocks]) removeRoadblock(rb);
    removeHeli();
    for (const a of game.actors) if (a.faction === 'cop') a.removeAt = game.time;
  }

  void N;
  return Object.assign(d, { update, spawnUnit, spawnRoadblock, spawnHeli, clearAll });
}
