// Money, respect ranks and district standing. Standing moves with what the player does in
// each district; a district at 50+ standing is Vela Syndicate turf and pays a passive income.
import { RESPECT_RANKS } from '../core/config.js';
import { DISTRICTS, districtIndex } from '../world/districts.js';
import { clamp } from '../core/mathutil.js';
import { randInt } from '../core/rng.js';

export function createStanding(game) {
  const s = game.stats;
  s.standing = s.standing || DISTRICTS.map(() => 0);
  let incomeT = 60;

  function addMoney(n, reason) {
    s.money = Math.max(0, s.money + n);
    game.emit('money', { n, reason, total: s.money });
  }

  function rankIndex(r = s.respect) {
    let i = 0;
    for (let k = 0; k < RESPECT_RANKS.length; k++) if (r >= RESPECT_RANKS[k].at) i = k;
    return i;
  }

  function addRespect(n) {
    const before = rankIndex();
    s.respect = Math.max(0, s.respect + n);
    const after = rankIndex();
    if (after > before) game.emit('rankUp', RESPECT_RANKS[after]);
  }

  function addStanding(idx, n) {
    if (idx < 0) return;
    const before = s.standing[idx];
    s.standing[idx] = clamp(before + n, -100, 100);
    game.emit('standing', { idx, before, after: s.standing[idx] });
    if (before < 50 && s.standing[idx] >= 50) game.emit('turfTaken', DISTRICTS[idx]);
    if (before >= 50 && s.standing[idx] < 50) game.emit('turfLost', DISTRICTS[idx]);
  }

  const owned = () => s.standing.filter((v) => v >= 50).length;

  game.on('actorKilled', ({ a, source }) => {
    if (source !== 'player' && source !== 'crew') return;
    const di = districtIndex(a.x, a.z);
    s.kills++;
    if (a.faction === 'gang') {
      addRespect(6); addStanding(di, 3);
      addMoney(randInt(25, 70), 'drop');
    } else if (a.faction === 'civ') {
      addStanding(di, -4);
    } else if (a.faction === 'cop') {
      addRespect(3); addStanding(di, 1);
    }
  });

  function update(dt) {
    incomeT -= dt;
    if (incomeT <= 0) {
      incomeT = 60;
      const n = owned();
      if (n > 0) addMoney(n * 60, 'turf');
    }
  }

  return {
    addMoney, addRespect, addStanding, rankIndex, owned, update,
    rank: () => RESPECT_RANKS[rankIndex()],
    nextRank: () => RESPECT_RANKS[Math.min(RESPECT_RANKS.length - 1, rankIndex() + 1)],
  };
}
