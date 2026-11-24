// The player's crew: C calls (recruits) up to three members for $250 each, or regroups the
// ones you have. Active abilities on cooldowns: X suppressive fire, H patch-up heal,
// G getaway driver (a crew member brings a fast car to your position).
import { dist, dist2 } from '../core/mathutil.js';
import { nearestNode, neighbors, lanePoint } from '../world/roads.js';
import { pick } from '../core/rng.js';

export const CREW_NAMES = ['Nico "Wire"', 'Lupe "Medic"', 'Tavo "Wheels"'];
export const CREW_COST = 250;
export const CREW_KEYS = { call: 'KeyC', suppress: 'KeyX', heal: 'KeyH', getaway: 'KeyG' };
const CD = { suppress: 20, heal: 25, getaway: 45 };

export function createCrew(game) {
  const crew = { members: [], suppressT: 0, cd: { suppress: 0, heal: 0, getaway: 0 }, getawayCar: null, uses: { suppress: 0, heal: 0, getaway: 0 } };

  function spawnMember(slot) {
    const p = game.player;
    const a = game.humans.spawn('crew', p.x + Math.cos(p.yaw) * (1.6 + slot), p.z - Math.sin(p.yaw) * (1.6 + slot), { weapon: slot === 1 ? 'rifle' : 'smg' });
    a.slot = slot; a.name = CREW_NAMES[slot];
    game.colliders.resolveCircle(a, 0.65);
    crew.members.push(a);
    return a;
  }

  crew.call = () => {
    crew.members = crew.members.filter((a) => a.alive);
    const p = game.player;
    if (crew.members.length < 3) {
      if (game.stats.money < CREW_COST) { game.emit('notice', `Recruiting costs $${CREW_COST}`); return false; }
      game.standing.addMoney(-CREW_COST, 'crew');
      const a = spawnMember(crew.members.length);
      game.emit('crewJoined', a);
      game.emit('notice', `${a.name} joined your crew`);
      return true;
    }
    for (const a of crew.members) {
      if (dist(a.x, a.z, p.x, p.z) > 12) { a.x = p.x + Math.cos(p.yaw) * 2; a.z = p.z - Math.sin(p.yaw) * 2; game.colliders.resolveCircle(a, 0.65); }
    }
    game.emit('notice', 'Crew, on me!');
    return true;
  };

  crew.restore = (n) => { for (let i = 0; i < n; i++) spawnMember(i); };

  crew.use = (what) => {
    crew.members = crew.members.filter((a) => a.alive);
    if (!crew.members.length) { game.emit('notice', 'No crew — press C to call one'); return false; }
    if (crew.cd[what] > 0) return false;
    const p = game.player;
    if (what === 'suppress') {
      crew.suppressT = 8;
      game.emit('notice', 'Crew: suppressive fire!');
    } else if (what === 'heal') {
      if (p.hp >= p.maxHp && p.armor >= 50) return false;
      p.hp = Math.min(p.maxHp, p.hp + 50); p.armor = Math.min(100, p.armor + 25);
      for (const a of crew.members) a.hp = Math.min(a.hp0, a.hp + 40);
      game.emit('notice', 'Crew patched you up (+50 HP)');
    } else if (what === 'getaway') {
      const from = nearestNode(p.x, p.z);
      let best = null;
      for (const to of neighbors(from)) {
        const lp = lanePoint(to, from, 0.35, {});
        if (!game.colliders.pointBlocked(lp.x, lp.z, 1.7) && (!best || dist2(lp.x, lp.z, p.x, p.z) > dist2(best.x, best.z, p.x, p.z))) best = lp;
      }
      if (!best) return false;
      const v = game.vehicleSys.spawn('sports', best.x, best.z, best.yaw, { driver: 'crew', color: 0x22e6ff, tag: 'getaway' });
      v.ai = {
        update(car, dt) {
          const d = dist(car.x, car.z, p.x, p.z);
          if (d < 7 || p.vehicle) { car.throttle = car.speed > 0.5 ? -1 : 0; car.steerIn = 0; car.brake = true; if (Math.abs(car.speed) < 0.5) { car.driver = null; car.ai = null; } return; }
          game.vehicleSys.driveToward(car, p.x, p.z, Math.min(24, d), dt);
        },
      };
      crew.getawayCar = v;
      game.emit('notice', `${pick(crew.members).name}: getaway car on its way!`);
    }
    crew.cd[what] = CD[what];
    crew.uses[what]++;
    game.emit('crewAbility', what);
    return true;
  };

  crew.update = (dt, input) => {
    crew.suppressT = Math.max(0, crew.suppressT - dt);
    for (const k in crew.cd) crew.cd[k] = Math.max(0, crew.cd[k] - dt);
    crew.members = crew.members.filter((a) => a.alive || game.actors.includes(a) && false);
    if (input && input.enabled && game.player.alive) {
      if (input.wasPressed(CREW_KEYS.call)) crew.call();
      if (input.wasPressed(CREW_KEYS.suppress)) crew.use('suppress');
      if (input.wasPressed(CREW_KEYS.heal)) crew.use('heal');
      if (input.wasPressed(CREW_KEYS.getaway)) crew.use('getaway');
    }
  };

  return crew;
}
