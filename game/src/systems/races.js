// Street races: drive into a race start in any car, beat three rival racers through the
// checkpoints, win cash. Best times are saved.
import { RACE_STARTS } from '../world/places.js';
import { nodeId, nodePos } from '../world/roads.js';
import { dist, dist2 } from '../core/mathutil.js';

const ROUTES = {
  strip: [[4, 2], [7, 2], [7, 4], [4, 4], [4, 2]],
  coast: [[8, 3], [8, 7], [6, 7], [6, 3], [8, 3]],
  port: [[1, 6], [3, 6], [3, 8], [0, 8], [0, 6], [1, 6]],
};
export const PRIZES = [1000, 400, 150];
const RIVALS = [
  { name: 'Kiko Ray', kind: 'sports', color: 0xffd23f, skill: 0.92 },
  { name: 'Vee Santos', kind: 'muscle', color: 0x8b5cf6, skill: 0.86 },
  { name: 'Dino Blaze', kind: 'sports', color: 0x10b981, skill: 0.8 },
];

function checkpoints(id) {
  const out = [];
  const corners = ROUTES[id].map(([i, j]) => nodePos(nodeId(i, j)));
  for (let k = 0; k < corners.length; k++) {
    if (k > 0) {
      const a = corners[k - 1], b = corners[k];
      out.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    }
    out.push(corners[k]);
  }
  return out;
}

export const RACES = RACE_STARTS.map((r) => ({ ...r, cps: checkpoints(r.id) }));

export function createRaces(game) {
  const rs = { races: RACES, active: null, best: {}, results: [], startMarkers: [], cpMarker: null, wins: 0, cooldown: 0 };

  function showStarts(on) {
    for (const m of rs.startMarkers) game.markers.remove(m);
    rs.startMarkers = [];
    if (on) for (const r of RACES) {
      const m = game.markers.add(r.start.x, r.start.z, { radius: 4, color: 0xb84dff, kind: 'raceStart', label: r.name, height: 26 });
      m.raceId = r.id;
      rs.startMarkers.push(m);
    }
  }

  rs.start = (id) => {
    const p = game.player;
    const race = RACES.find((r) => r.id === id);
    if (!race || rs.active || !p.vehicle || (game.missions && game.missions.active)) return false;
    showStarts(false);
    const first = race.cps[0];
    const yaw = Math.atan2(first.x - race.start.x, first.z - race.start.z);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const v = p.vehicle;
    v.x = race.start.x; v.z = race.start.z; v.yaw = yaw; v.speed = 0;
    const rivals = RIVALS.map((r, i) => {
      const side = i === 1 ? -1 : 1, back = i === 0 ? 0 : 6;
      const car = game.vehicleSys.spawn(r.kind, v.x + fz * 3.6 * side * (i === 0 ? -1 : 1) - fx * back, v.z - fx * 3.6 * side * (i === 0 ? -1 : 1) - fz * back, yaw, { driver: 'racer', color: r.color, tag: 'race' });
      game.colliders.resolveCircle(car, 1.6);
      const st = { name: r.name, car, cp: 0, done: false, time: 0, skill: r.skill };
      car.ai = { update: (c, dt) => driveRival(st, c, dt) };
      return st;
    });
    rs.active = { race, rivals, cp: 0, t: -3, finished: [], playerDone: false };
    rs.cpMarker = game.markers.add(first.x, first.z, { radius: 9, color: 0xb84dff, kind: 'race' });
    game.emit('raceStart', race);
    return true;
  };

  function driveRival(st, car, dt) {
    const a = rs.active;
    if (!a || a.t < 0 || st.done) { car.throttle = 0; car.brake = true; return; }
    const cp = a.race.cps[st.cp];
    const next = a.race.cps[st.cp + 1];
    const d = dist(car.x, car.z, cp.x, cp.z);
    // Slow down for the corner when the next checkpoint turns.
    let speed = 36 * st.skill;
    if (next && d < 25) {
      const turn = Math.abs(Math.atan2(next.x - cp.x, next.z - cp.z) - Math.atan2(cp.x - car.x, cp.z - car.z));
      if (turn > 0.6 && turn < 5.6) speed = 15;
    }
    game.vehicleSys.driveToward(car, cp.x, cp.z, speed, dt);
    if (d < 10) {
      st.cp++;
      if (st.cp >= a.race.cps.length) { st.done = true; st.time = a.t; a.finished.push(st.name); }
    }
  }

  function playerPlace() {
    const a = rs.active;
    const p = game.player;
    const score = (cp, x, z) => {
      const c = a.race.cps[Math.min(cp, a.race.cps.length - 1)];
      return cp * 10000 - dist(x, z, c.x, c.z);
    };
    const me = a.playerDone ? Infinity : score(a.cp, p.x, p.z);
    let place = 1;
    for (const r of a.rivals) {
      if (r.done && !a.playerDone) place++;
      else if (!r.done && !a.playerDone && score(r.cp, r.car.x, r.car.z) > me) place++;
    }
    return place;
  }

  function finish(won, place) {
    const a = rs.active;
    game.markers.remove(rs.cpMarker); rs.cpMarker = null;
    for (const r of a.rivals) if (game.vehicles.includes(r.car)) game.vehicleSys.remove(r.car);
    const prize = place <= 3 ? PRIZES[place - 1] : 0;
    if (won && prize) game.standing.addMoney(prize, 'race');
    if (won) {
      game.standing.addRespect(place === 1 ? 40 : 15);
      const prev = rs.best[a.race.id];
      if (!prev || a.t < prev) rs.best[a.race.id] = Math.round(a.t * 100) / 100;
      if (place === 1) rs.wins++;
    }
    const res = { id: a.race.id, place, time: a.t, prize: won ? prize : 0, ok: won };
    rs.results.push(res);
    rs.active = null; rs.cooldown = 5;
    game.emit('raceFinished', res);
  }

  rs.abort = (why) => { if (rs.active) { finish(false, 99); game.emit('notice', `Race abandoned: ${why}`); } };
  game.on('wasted', () => rs.abort('wasted'));
  game.on('busted', () => rs.abort('busted'));

  rs.update = (dt) => {
    const p = game.player;
    rs.cooldown -= dt;
    const a = rs.active;
    if (!a) {
      const free = !(game.missions && game.missions.active);
      if (free && !rs.startMarkers.length) showStarts(true);
      if (!free && rs.startMarkers.length) showStarts(false);
      if (free && p.vehicle && rs.cooldown <= 0) {
        for (const r of RACES) if (dist2(p.x, p.z, r.start.x, r.start.z) < 25) { rs.start(r.id); break; }
      }
      return;
    }
    a.t += dt;
    if (a.t < 0) { p.vehicle && (p.vehicle.speed = 0); return; }
    if (!p.vehicle) { a.offT = (a.offT || 0) + dt; if (a.offT > 10) return rs.abort('left the car'); } else a.offT = 0;
    if (!a.playerDone) {
      const cp = a.race.cps[a.cp];
      if (dist2(p.x, p.z, cp.x, cp.z) < 100) {
        a.cp++;
        game.emit('checkpoint', a.cp);
        if (a.cp >= a.race.cps.length) {
          a.playerDone = true;
          const place = a.finished.length + 1;
          return finish(true, place);
        }
        const n = a.race.cps[a.cp];
        game.markers.remove(rs.cpMarker);
        rs.cpMarker = game.markers.add(n.x, n.z, { radius: 9, color: a.cp === a.race.cps.length - 1 ? 0xffffff : 0xb84dff, kind: 'race' });
      }
    }
    a.place = playerPlace();
    if (a.t > 240) rs.abort('too slow');
  };

  rs.target = () => {
    if (!rs.active) return null;
    const c = rs.active.race.cps[rs.active.cp];
    return c ? { x: c.x, z: c.z } : null;
  };

  return rs;
}
