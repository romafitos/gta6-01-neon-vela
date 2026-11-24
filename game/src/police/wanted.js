// Wanted level: crimes raise heat and stars; police sight keeps them; staying out of sight
// long enough drops a star at a time.
import { dist2 } from '../core/mathutil.js';

const MIN_STARS = { shotsFired: 1, carjack: 1, copCarTheft: 2, assaultCop: 2, murder: 1, copKill: 3, explosion: 2, mission: 0 };
const HEAT = { shotsFired: 4, carjack: 12, copCarTheft: 30, assaultCop: 25, murder: 30, copKill: 70, explosion: 35, mission: 0 };
const THRESH = [0, 1, 45, 110, 210, 340];

export function createWanted(game) {
  const w = {
    stars: 0, heat: 0, lastSeen: -99, seen: false, searchT: 0,
    lastSeenX: 0, lastSeenZ: 0, crimes: 0,
  };

  function witnessed(x, z) {
    for (const a of game.actors) {
      if (!a.alive) continue;
      if ((a.faction === 'civ' || a.faction === 'cop') && dist2(a.x, a.z, x, z) < 45 * 45) return true;
    }
    for (const v of game.vehicles) if (v.faction === 'cop' && !v.wrecked && dist2(v.x, v.z, x, z) < 70 * 70) return true;
    return w.stars > 0;
  }

  function setMin(n) {
    if (n > w.stars) {
      const old = w.stars;
      w.stars = Math.min(5, n);
      w.heat = Math.max(w.heat, THRESH[w.stars]);
      w.lastSeen = game.time;
      game.emit('starsChanged', { from: old, to: w.stars });
    }
  }

  game.on('crime', (c) => {
    if (game.flags.noPolice) return;
    if (!witnessed(c.x, c.z)) return;
    w.crimes++;
    w.heat += HEAT[c.type] ?? 5;
    let target = Math.max(w.stars, MIN_STARS[c.type] ?? 1);
    while (target < 5 && w.heat >= THRESH[target + 1]) target++;
    w.lastSeenX = c.x; w.lastSeenZ = c.z;
    setMin(target);
    w.lastSeen = game.time;
  });

  function clear() {
    const old = w.stars;
    w.stars = 0; w.heat = 0; w.searchT = 0;
    if (old) game.emit('starsChanged', { from: old, to: 0 });
  }

  function update(dt) {
    if (w.stars === 0) { w.seen = false; return; }
    const p = game.player;
    let seen = false;
    for (const a of game.actors) {
      if (a.alive && a.faction === 'cop' && dist2(a.x, a.z, p.x, p.z) < 50 * 50 && !game.colliders.segmentBlocked(a.x, a.z, p.x, p.z)) { seen = true; break; }
    }
    if (!seen) for (const v of game.vehicles) {
      if (v.faction === 'cop' && !v.wrecked && v.driver === 'cop' && dist2(v.x, v.z, p.x, p.z) < 65 * 65 && !game.colliders.segmentBlocked(v.x, v.z, p.x, p.z)) { seen = true; break; }
    }
    if (!seen && game.dispatch && game.dispatch.heliSees()) seen = true;
    w.seen = seen;
    if (seen) {
      w.lastSeen = game.time; w.lastSeenX = p.x; w.lastSeenZ = p.z; w.searchT = 0;
    } else {
      w.searchT += dt;
      const need = 7 + w.stars * 1.6;
      if (w.searchT > need) {
        const old = w.stars;
        w.stars--; w.heat = THRESH[w.stars]; w.searchT = 0;
        game.emit('starsChanged', { from: old, to: w.stars, decay: true });
      }
    }
  }

  return Object.assign(w, { update, clear, setMin });
}
