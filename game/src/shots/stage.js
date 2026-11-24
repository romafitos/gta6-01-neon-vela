// Screenshot staging: ?shot=chase|mission|wheel|race builds one scene deterministically
// (fixed seed, fixed dusk hour, scripted simulation steps) and sets window.__shotReady.
import { PLACES, RACE_STARTS } from '../world/places.js';
import { nodeId, nodePos, lanePoint } from '../world/roads.js';

export const SHOTS = ['chase', 'mission', 'wheel', 'race'];

function sim(game, seconds, before) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) { if (before) before(t); game.step(dt); }
}

export function stageShot(game, name) {
  game.flags.shot = name;
  game.hour = 18.05;
  game.flags.freezeClock = true;
  const p = game.player;
  const input = game.input;
  if (name === 'chase') {
    // A stolen muscle car flees down a boulevard with 4 stars: cruisers on its tail, a roadblock ahead, Air One overhead.
    game.missions.done = ['m1', 'm2', 'm3', 'm4'];
    const lp = lanePoint(nodeId(2, 3), nodeId(5, 3), 0.18, {});
    const car = game.vehicleSys.spawn('muscle', lp.x, lp.z, lp.yaw, { color: 0xff2d95 });
    p.teleport(lp.x - 6, lp.z);
    p.enterNearest();
    p.camYaw = car.yaw; p.carCamYaw = car.yaw;
    game.missions.start('m5');
    game.police.setMin(4);
    game.dispatch.spawnHeli();
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    for (let k = 0; k < 2; k++) {
      const v = game.dispatch.spawnUnit();
      if (v) { v.x = car.x - fx * (12 + k * 9) + fz * (k ? 3 : -3); v.z = car.z - fz * (12 + k * 9) - fx * (k ? 3 : -3); v.yaw = car.yaw; v.speed = 24; }
    }
    sim(game, 1.5, () => { input.down.add('KeyW'); });
    game.dispatch.rbT = 0;
    sim(game, 1.2, () => { input.down.add('KeyW'); });
    const h = game.dispatch.heli;
    if (h) { h.tx = p.x; h.tz = p.z; h.x = p.x + fx * 12 + fz * 18; h.z = p.z + fz * 12 - fx * 18; }
    sim(game, 0.3, () => { input.down.add('KeyW'); });
    game.emit('dispatch', 'Unit 12 requesting backup, suspect heading east on Neon Strip');
  } else if (name === 'mission') {
    // Hold the Pier: crew in suppressive fire against an Ash Kings wave, a car burning.
    game.missions.done = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
    game.stats.money = 4280; game.stats.respect = 720;
    const pier = PLACES.pier;
    p.teleport(pier.x - 3, pier.z + 2, -Math.PI / 2);
    game.stats.money += 750;
    for (let i = 0; i < 3; i++) game.crew.call();
    game.missions.start('m7');
    sim(game, 0.6);
    const step = game.missions.step;
    if (step && step.kind === 'goto') sim(game, 0.2);
    sim(game, 3.0);
    game.crew.use('suppress');
    const wreck = game.vehicleSys.spawn('sedan', pier.x - 20, pier.z + 6, 0.6);
    game.vehicleSys.damage(wreck, wreck.maxHp * 0.8, 'player');
    p.camYaw = Math.PI / 2 + 0.6; p.camPitch = 0.16;
    sim(game, 1.6, (t) => { if (t > 0.6) { input.fire = true; input.firePressed = true; } });
    input.fire = false;
    game.combat.select(4);
    sim(game, 0.4, () => { input.fire = true; });
    input.fire = false;
  } else if (name === 'wheel') {
    // On foot on the Neon Strip at dusk with the weapon wheel open and traffic passing.
    game.missions.done = ['m1', 'm2'];
    game.stats.money = 1840; game.stats.respect = 230;
    const s = PLACES.strip;
    p.teleport(s.x, s.z - 2, Math.PI * 0.72);
    p.camPitch = 0.05;
    game.crew.call();
    sim(game, 2.0);
    game.wheel.openWheel();
    game.wheel.hover = 3;
    sim(game, 0.2);
  } else if (name === 'race') {
    // Coastline Run: three rivals alongside, beach and ocean, garage upgrades fitted.
    game.missions.done = ['m1', 'm2', 'm3'];
    game.garage.setLevels({ engine: 2, armor: 1, paint: 1 });
    const r = RACE_STARTS.find((q) => q.id === 'coast');
    const car = game.vehicleSys.spawn('sports', r.start.x, r.start.z, 0, { color: game.garage.paintColor() });
    p.teleport(r.start.x - 4, r.start.z);
    p.enterNearest();
    game.races.start('coast');
    sim(game, 3.0);
    sim(game, 2.4, () => { input.down.add('KeyW'); });
    p.camYaw = car.yaw + 0.5;
    game.audio.radio.station = 0;
    game.hud.showRadio('Vela Wave 88.3');
  }
  input.down.clear();
  input.endFrame();
  void nodePos;
}
