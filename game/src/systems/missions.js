// Story missions of Neon Vela. Each mission is a list of steps built from a few primitives
// (go to, steal, deliver, eliminate, chase, hold zone, survive waves, ambush convoy, lose the
// heat). One mission is offered at a time: its start marker shows on the minimap and in the world.
import { PLACES } from '../world/places.js';
import { dist, dist2 } from '../core/mathutil.js';
import { rand } from '../core/rng.js';
import { nearestNode, neighbors, nodePos, lanePoint, route } from '../world/roads.js';
import { districtIndex } from '../world/districts.js';

const C = { start: 0xffd23f, goal: 0x39ff88, enemy: 0xff4d4d, zone: 0x22e6ff };

// ---- step primitives ----
function goTo(place, label, opts = {}) {
  return {
    label, kind: 'goto',
    start(m) { this.t = opts.time || 0; m.marker(place.x, place.z, opts.radius ?? 4, C.goal); },
    update(m, dt) {
      const p = m.game.player;
      if (opts.time) { this.t -= dt; m.timer = this.t; if (this.t <= 0) return m.fail('Out of time'); }
      if (opts.needCar && !p.vehicle) return;
      if (dist2(p.x, p.z, place.x, place.z) < (opts.radius ?? 4) ** 2) return 'done';
    },
    target: () => place,
  };
}

function enterAnyCar(label) {
  return {
    label, kind: 'car',
    start(m) {
      // Make sure a free car waits nearby and mark it.
      const p = m.game.player;
      let v = m.game.vehicleSys.nearestFree(p.x, p.z, 40);
      if (!v || v.driver) { v = m.game.vehicleSys.spawn('sedan', p.x + 8, p.z + 1.2, Math.PI / 2, { color: 0x2ec4ff }); m.game.colliders.resolveCircle(v, 1.6); }
      this.car = v;
      m.blips.push({ obj: v, color: C.goal });
    },
    update(m) { if (m.game.player.vehicle) return 'done'; },
    target: (m) => { const v = m.game.vehicleSys.nearestFree(m.game.player.x, m.game.player.z, 80); return v ? { x: v.x, z: v.z } : null; },
  };
}

function stealCar(place, kind, label) {
  return {
    label, kind: 'steal',
    start(m) {
      this.car = m.game.vehicleSys.spawn(kind, place.x, place.z, place.yaw ?? 0, { driver: null, tag: 'mission' });
      m.own(this.car);
      m.blips.push({ obj: this.car, color: C.goal });
    },
    update(m) {
      if (this.car.wrecked) return m.fail('The car was destroyed');
      if (m.game.player.vehicle === this.car) return 'done';
    },
    target() { return this.car; },
  };
}

function deliverCar(stepWithCar, place, label) {
  return {
    label, kind: 'deliver',
    start(m) { m.marker(place.x, place.z, 5, C.goal); },
    update(m) {
      const car = stepWithCar.car, p = m.game.player;
      if (car.wrecked) return m.fail('The car was destroyed');
      if (p.vehicle === car && dist2(car.x, car.z, place.x, place.z) < 25) return 'done';
    },
    target: () => place,
  };
}

function eliminate(place, count, label, opts = {}) {
  return {
    label, kind: 'kill',
    start(m) {
      this.foes = [];
      for (let i = 0; i < count; i++) {
        const a = Math.PI * 2 * i / count, r = 5 + (i % 2) * 3;
        const g = m.game.humans.spawn('gang', place.x + Math.sin(a) * r, place.z + Math.cos(a) * r, { state: 'guard', tag: 'mission', hp: i === 0 && opts.boss ? 300 : undefined, weapon: i === 0 && opts.boss ? 'rifle' : undefined });
        m.game.colliders.resolveCircle(g, 0.5);
        if (i === 0 && opts.boss) g.boss = true;
        this.foes.push(g); m.own(g);
        m.blips.push({ obj: g, color: C.enemy });
      }
    },
    update(m) {
      const left = this.foes.filter((f) => f.alive).length;
      m.progress = `${count - left}/${count}`;
      if (left === 0) return 'done';
    },
    target() { const f = this.foes.find((q) => q.alive); return f || place; },
  };
}

// A car that flees through the street grid, steering away from the player.
function chaseTarget(place, label, opts = {}) {
  return {
    label, kind: 'chase',
    start(m) {
      const game = m.game;
      const from = nearestNode(place.x, place.z), to = neighbors(from)[0];
      const lp = lanePoint(from, to, 0.4, {});
      const car = game.vehicleSys.spawn(opts.kind || 'sports', lp.x, lp.z, lp.yaw, { driver: 'target', tag: 'mission', hpMul: opts.hpMul ?? 1.2, color: 0xff2d95 });
      car.ai = {
        from, to, update(v, dt) {
          const tp = nodePos(this.to);
          if (dist2(v.x, v.z, tp.x, tp.z) < 64) {
            const p = game.player;
            const nb = neighbors(this.to).filter((n) => n !== this.from);
            nb.sort((a, b) => { const pa = nodePos(a), pb = nodePos(b); return dist2(pb.x, pb.z, p.x, p.z) - dist2(pa.x, pa.z, p.x, p.z); });
            this.from = this.to; this.to = rand() < 0.75 ? nb[0] : nb[nb.length - 1] ?? nb[0];
          }
          const aim = lanePoint(this.from, this.to, 0.9, {});
          const near = dist(v.x, v.z, game.player.x, game.player.z) < 60;
          game.vehicleSys.driveToward(v, aim.x, aim.z, near ? opts.speed ?? 27 : 15, dt);
        },
      };
      this.car = car; this.escapeT = 0;
      m.own(car);
      m.blips.push({ obj: car, color: C.enemy });
    },
    update(m, dt) {
      const p = m.game.player;
      if (this.car.wrecked) return 'done';
      const d = dist(p.x, p.z, this.car.x, this.car.z);
      m.progress = `${Math.round(d)} m`;
      if (d > 220) { this.escapeT += dt; if (this.escapeT > 6) return m.fail('The target got away'); } else this.escapeT = 0;
    },
    target() { return this.car; },
  };
}

// Stand in a circle for a number of seconds (cracking a vault, planting a bug).
function holdZone(place, seconds, label, opts = {}) {
  return {
    label, kind: 'hold',
    start(m) { this.t = 0; m.marker(place.x, place.z, opts.radius ?? 6, C.zone); if (opts.stars) m.game.police.setMin(opts.stars); },
    update(m, dt) {
      const p = m.game.player;
      if (dist2(p.x, p.z, place.x, place.z) < (opts.radius ?? 6) ** 2 && !p.vehicle) this.t += dt;
      m.progress = `${Math.min(100, Math.round(this.t / seconds * 100))}%`;
      if (this.t >= seconds) { if (opts.after) opts.after(m); return 'done'; }
    },
    target: () => place,
  };
}

// Turf defense: Ash Kings attack the zone in waves; stay close and drop every wave.
function defendWaves(place, waves, perWave, label) {
  return {
    label, kind: 'defend',
    start(m) { this.wave = 0; this.foes = []; this.outT = 0; this.gap = 2; m.marker(place.x, place.z, 14, C.zone); },
    spawnWave(m) {
      this.wave++;
      const game = m.game;
      for (let i = 0; i < perWave; i++) {
        const a = rand() * Math.PI * 2, r = 34 + rand() * 8;
        const g = game.humans.spawn('gang', place.x + Math.sin(a) * r, place.z + Math.cos(a) * r, { state: 'hostile', tag: 'mission' });
        game.colliders.resolveCircle(g, 0.5);
        g.goal = { x: place.x, z: place.z };
        this.foes.push(g); m.own(g);
        m.blips.push({ obj: g, color: C.enemy });
      }
      game.emit('notice', `Wave ${this.wave}/${waves} incoming`);
    },
    update(m, dt) {
      const p = m.game.player;
      const alive = this.foes.filter((f) => f.alive).length;
      if (alive === 0) {
        if (this.wave >= waves) return 'done';
        this.gap -= dt;
        if (this.gap <= 0) { this.spawnWave(m); this.gap = 3; }
      }
      m.progress = `wave ${this.wave}/${waves} · ${alive} left`;
      if (dist(p.x, p.z, place.x, place.z) > 40) {
        this.outT += dt; m.timer = 12 - this.outT;
        if (this.outT > 12) return m.fail('You abandoned the turf');
      } else { this.outT = 0; m.timer = null; }
    },
    target() { const f = this.foes.find((q) => q.alive); return f || place; },
  };
}

// Convoy ambush: an armored truck with two escorts drives a route; destroy the truck
// before it reaches its destination.
function convoy(fromPlace, toPlace, label) {
  return {
    label, kind: 'convoy',
    start(m) {
      const game = m.game;
      const a = nearestNode(fromPlace.x, fromPlace.z), b = nearestNode(toPlace.x, toPlace.z);
      const path = route(a, b);
      this.path = path; this.dest = nodePos(b);
      const yawOf = (i) => { const p0 = nodePos(path[0]), p1 = nodePos(path[1]); void i; return Math.atan2(p1.x - p0.x, p1.z - p0.z); };
      const p0 = nodePos(path[0]);
      const yaw = yawOf(0);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const kinds = ['muscle', 'armored', 'muscle'];
      this.cars = kinds.map((k, i) => {
        const off = (1 - i) * 9;
        const v = game.vehicleSys.spawn(k, p0.x + fx * off + fz * 3.6, p0.z + fz * off - fx * 3.6, yaw, { driver: 'convoy', faction: 'gang', tag: 'mission', hpMul: k === 'armored' ? 1.4 : 1, color: k === 'armored' ? 0x3a3f36 : 0x222222 });
        v.ai = { idx: 1, fireCd: 2, update: (car, dt) => this.drive(m, car, dt) };
        m.own(v);
        return v;
      });
      this.truck = this.cars[1];
      m.blips.push({ obj: this.truck, color: C.enemy });
      for (const v of [this.cars[0], this.cars[2]]) m.blips.push({ obj: v, color: 0xff9a3c });
    },
    drive(m, car, dt) {
      const game = m.game;
      const ai = car.ai;
      const node = nodePos(this.path[Math.min(ai.idx, this.path.length - 1)]);
      if (dist2(car.x, car.z, node.x, node.z) < 100 && ai.idx < this.path.length - 1) ai.idx++;
      const hostile = this.alerted;
      const speed = hostile ? 22 : 12;
      const truckGap = car === this.truck ? 0 : dist(car.x, car.z, this.truck.x, this.truck.z);
      game.vehicleSys.driveToward(car, node.x, node.z, car !== this.truck && truckGap > 18 && !this.truck.wrecked ? speed * 0.6 : speed, dt);
      if (game.vehicleSys.obstacleAhead(car, 7) && !hostile) car.throttle = car.speed > 1 ? -0.6 : 0;
      ai.fireCd -= dt;
      const p = game.player;
      if (hostile && car !== this.truck && ai.fireCd <= 0 && dist(car.x, car.z, p.x, p.z) < 30) {
        ai.fireCd = 1.1;
        game.combat.npcShoot({ x: car.x, z: car.z, yaw: car.yaw, faction: 'gang', weapon: 'smg' }, p);
      }
    },
    update(m) {
      if (!this.alerted && this.cars.some((c) => c.hp < c.maxHp || dist(c.x, c.z, m.game.player.x, m.game.player.z) < 14)) {
        this.alerted = true;
        m.game.emit('notice', 'The convoy spotted you!');
      }
      if (this.truck.wrecked) return 'done';
      m.progress = `truck ${Math.max(0, Math.round(this.truck.hp / this.truck.maxHp * 100))}%`;
      if (dist2(this.truck.x, this.truck.z, this.dest.x, this.dest.z) < 144 && this.truck.car !== null) {
        if (this.truck.ai.idx >= this.path.length - 1) return m.fail('The convoy made it through');
      }
    },
    target() { return this.truck; },
  };
}

function getWanted(stars, label) {
  return { label, kind: 'heat', start(m) { m.game.police.setMin(stars); }, update() { return 'done'; }, target: () => null };
}

function loseHeat(label) {
  return {
    label, kind: 'lose',
    start() {},
    update(m) { m.progress = `${m.game.police.stars}★`; if (m.game.police.stars === 0) return 'done'; },
    target: () => null,
  };
}

// ---- the story ----
export function buildMissions() {
  const P = PLACES;
  const near = (pl, dx, dz) => ({ x: pl.x + dx, z: pl.z + dz, yaw: 0 });
  const m4steal = stealCar(near(P.strip, 0, 0), 'sports', 'Steal the Vortex GT from the Strip');
  const m10car = stealCar(near(P.dock, 0, 0), 'armored', 'Take the Syndicate armored car');
  return [
    { id: 'm1', name: 'Welcome to Vela', giver: 'Rosa', place: P.safehouse, cash: 300, respect: 40, type: 'intro',
      intro: 'Rosa: "Fresh off the bus? Grab some wheels and meet me at the Strip."',
      steps: () => [enterAnyCar('Get a car (F/E near any car)'), goTo(P.strip, 'Drive to Neon Strip Boulevard', { needCar: true, radius: 6 })] },
    { id: 'm2', name: 'Midnight Tacos', giver: 'Rosa', place: P.strip, cash: 450, respect: 50, type: 'delivery',
      intro: 'Rosa: "Pick up the package at the Sunrise Mart. Hot food, hot delivery — 90 seconds."',
      steps: () => [goTo(P.store, 'Pick up the package at Sunrise 24/7 Mart', { radius: 5 }), goTo(P.pier, 'Deliver to Marisol Pier before it gets cold', { time: 90, radius: 6 })] },
    { id: 'm3', name: 'Ash in the Yard', giver: 'Rosa', place: P.pier, cash: 650, respect: 80, type: 'eliminate',
      intro: 'Rosa: "The Ash Kings are squatting in Old Port Yard. Clear them out."',
      steps: () => [goTo(P.portyard, 'Drive to the Old Port Yard', { radius: 22 }), eliminate(P.portyard, 6, 'Take out the Ash Kings crew'), loseHeat('Lose the cops')] },
    { id: 'm4', name: 'Hot Wheels', giver: 'Dex', place: P.garage, cash: 800, respect: 90, type: 'theft',
      intro: 'Dex: "A Vortex GT sits on the Strip. Bring it to my shop without a scratch."',
      steps: () => [m4steal, deliverCar(m4steal, P.garage, 'Deliver the Vortex GT to Chrome & Coral Customs'), loseHeat('Lose the cops before the drop')] },
    { id: 'm5', name: 'Tail Light', giver: 'Dex', place: P.garage, cash: 900, respect: 110, type: 'chase',
      intro: 'Dex: "A snitch is racing to the VPD with our ledger. Stop that car."',
      steps: () => [chaseTarget(P.precinct, 'Chase down and wreck the snitch\'s car')] },
    { id: 'm6', name: 'Coral Trust Job', giver: 'Marisol', place: P.safehouse, cash: 2500, respect: 200, type: 'heist',
      intro: 'Marisol: "The Coral Trust vault. Crack it, take the cash, vanish."',
      steps: () => [goTo(P.vault, 'Get to Coral Trust Bank', { radius: 6 }), holdZone(P.vault, 15, 'Crack the vault — stay in the zone', { stars: 2, radius: 6, after: (m) => m.game.police.setMin(3) }), loseHeat('Escape with the cash — lose the cops'), goTo(P.safehouse, 'Stash the cash at the safehouse', { radius: 5 })] },
    { id: 'm7', name: 'Hold the Pier', giver: 'Marisol', place: P.safehouse, cash: 1400, respect: 160, type: 'turf',
      intro: 'Marisol: "The Ash Kings want Marisol Pier back. Hold it."',
      steps: () => [goTo(P.pier, 'Get to Marisol Pier', { radius: 10 }), defendWaves(P.pier, 3, 4, 'Defend the pier against the waves')] },
    { id: 'm8', name: 'Iron Convoy', giver: 'Marisol', place: P.pier, cash: 1800, respect: 180, type: 'convoy',
      intro: 'Marisol: "An Ash Kings armored truck rolls from the port. Ambush it."',
      steps: () => [convoy(P.portyard, P.coral ?? P.vault, 'Ambush the convoy — destroy the armored truck'), loseHeat('Lose the heat')] },
    { id: 'm9', name: 'Precinct Breakout', giver: 'Rosa', place: P.hospital, cash: 1600, respect: 200, type: 'pursuit',
      intro: 'Rosa: "They pinched our driver. Draw every unit in Vela away from Precinct 7."',
      steps: () => [goTo(P.precinct, 'Go to VPD Precinct 7', { radius: 8 }), getWanted(4, 'Raise hell'), holdZone(P.precinct, 6, 'Keep VPD busy outside the precinct', { radius: 18 }), loseHeat('Escape the 4-star manhunt')] },
    { id: 'm10', name: 'Kingpin of Vela', giver: 'Marisol', place: P.safehouse, cash: 5000, respect: 400, type: 'finale',
      intro: 'Marisol: "Ash King himself is at Port Slip 9. End it — and take his armored car."',
      steps: () => [goTo(P.dock, 'Go to Port Slip 9', { radius: 20 }), eliminate(near(P.dock, -8, 0), 6, 'Take down the Ash King and his guards', { boss: true }), m10car, deliverCar(m10car, P.safehouse, 'Drive the armored car to the safehouse'), loseHeat('Lose the cops')] },
  ];
}

export function createMissions(game) {
  const list = buildMissions();
  const ms = {
    list, done: [], active: null, stepIdx: 0, step: null,
    timer: null, progress: '', blips: [], owned: [], markersOwned: [], startMarker: null,
    lastResult: null, cooldown: 0,
    game,
  };

  ms.marker = (x, z, r, color) => { const mk = game.markers.add(x, z, { radius: r, color, kind: 'mission' }); ms.markersOwned.push(mk); return mk; };
  ms.own = (o) => ms.owned.push(o);
  ms.fail = (why) => { ms.failReason = why; return 'fail'; };

  ms.next = () => list.find((m) => !ms.done.includes(m.id)) || null;

  function clearStep() {
    for (const mk of ms.markersOwned) game.markers.remove(mk);
    ms.markersOwned = [];
    ms.timer = null; ms.progress = '';
  }

  function cleanup() {
    clearStep();
    for (const o of ms.owned) {
      if (o.mesh && o.k) { if (!o.wrecked && o.driver !== 'player' && game.vehicles.includes(o)) game.vehicleSys.remove(o); }
      else if (o.mesh && o.faction) { if (o.alive) o.removeAt = game.time, o.dead = true; }
    }
    ms.owned = []; ms.blips = [];
  }

  function beginStep() {
    clearStep();
    ms.step = ms.steps[ms.stepIdx];
    ms.step.start(ms);
    game.emit('objective', ms.step.label);
  }

  ms.start = (id) => {
    const m = list.find((q) => q.id === id);
    if (!m || ms.active) return false;
    ms.active = m; ms.steps = m.steps(); ms.stepIdx = 0; ms.failReason = '';
    if (ms.startMarker) { game.markers.remove(ms.startMarker); ms.startMarker = null; }
    game.emit('missionStart', m);
    beginStep();
    return true;
  };

  function complete() {
    const m = ms.active;
    cleanup();
    ms.done.push(m.id);
    ms.active = null; ms.step = null;
    game.standing.addMoney(m.cash, 'mission');
    game.standing.addRespect(m.respect);
    game.standing.addStanding(districtIndex(m.place.x, m.place.z), 15);
    ms.lastResult = { id: m.id, ok: true };
    ms.cooldown = 3;
    game.emit('missionComplete', m);
  }

  ms.failActive = (why) => {
    if (!ms.active) return;
    const m = ms.active;
    cleanup();
    ms.active = null; ms.step = null;
    ms.lastResult = { id: m.id, ok: false, why };
    ms.cooldown = 4;
    game.emit('missionFailed', { m, why });
  };

  game.on('wasted', () => ms.failActive('You were wasted'));
  game.on('busted', () => ms.failActive('You were busted'));

  ms.update = (dt) => {
    ms.cooldown -= dt;
    if (ms.active) {
      const r = ms.step.update(ms, dt);
      if (r === 'fail') ms.failActive(ms.failReason || 'Mission failed');
      else if (r === 'done') {
        ms.stepIdx++;
        if (ms.stepIdx >= ms.steps.length) complete();
        else beginStep();
      }
      return;
    }
    const nx = ms.next();
    if (!nx) { if (ms.startMarker) { game.markers.remove(ms.startMarker); ms.startMarker = null; } return; }
    if (!ms.startMarker || ms.startMarker.mid !== nx.id) {
      if (ms.startMarker) game.markers.remove(ms.startMarker);
      ms.startMarker = game.markers.add(nx.place.x, nx.place.z, { radius: 3.2, color: C.start, kind: 'missionStart', label: nx.name });
      ms.startMarker.mid = nx.id;
    }
    const p = game.player;
    if (ms.cooldown <= 0 && p.alive && !(game.races && game.races.active) && dist2(p.x, p.z, nx.place.x, nx.place.z) < 3.4 * 3.4 + (p.vehicle ? 8 : 0)) ms.start(nx.id);
  };

  // Where the GPS should point right now.
  ms.target = () => {
    if (ms.active) { const t = ms.step.target(ms); return t ? { x: t.x, z: t.z } : null; }
    const nx = ms.next();
    return nx ? { x: nx.place.x, z: nx.place.z } : null;
  };

  return ms;
}
