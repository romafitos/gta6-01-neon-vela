// Chrome & Coral Customs: engine, armor and paint upgrades for whatever car the player drives,
// bought with cash and kept in the save.
import { COLORS } from '../core/config.js';
import { PLACES } from '../world/places.js';
import { dist2 } from '../core/mathutil.js';

export const ENGINE_COST = [700, 1400, 2400];
export const ARMOR_COST = [600, 1200, 2000];
export const PAINT_COST = 150;
export const REPAIR_COST = 100;
const SPEED = [1, 1.12, 1.24, 1.36];
const ARMOR = [1, 0.8, 0.62, 0.45];

export function createGarage(game) {
  const lv = { engine: 0, armor: 0, paint: 0 };
  const g = { open: false, lv, lastMsg: '' };

  g.levels = () => ({ ...lv });
  g.setLevels = (o) => { lv.engine = o.engine | 0; lv.armor = o.armor | 0; lv.paint = o.paint | 0; };
  g.speedFactor = () => SPEED[lv.engine];
  g.armorFactor = () => ARMOR[lv.armor];
  g.paintColor = () => COLORS.paint[lv.paint % COLORS.paint.length];

  function pay(cost) {
    if (game.stats.money < cost) { g.lastMsg = 'Not enough cash'; game.emit('garageMsg', g.lastMsg); return false; }
    game.standing.addMoney(-cost, 'garage');
    return true;
  }

  g.buy = (what) => {
    const v = game.player.vehicle;
    if (!g.open || !v) return false;
    let ok = false;
    if (what === 'engine' && lv.engine < 3 && pay(ENGINE_COST[lv.engine])) { lv.engine++; ok = true; }
    else if (what === 'armor' && lv.armor < 3 && pay(ARMOR_COST[lv.armor])) { lv.armor++; ok = true; }
    else if (what === 'paint' && pay(PAINT_COST)) {
      lv.paint = (lv.paint + 1) % COLORS.paint.length;
      // Never "respray" to the colour the car already wears.
      if (g.paintColor() === v.color) lv.paint = (lv.paint + 1) % COLORS.paint.length;
      game.vehicleSys.repaint(v, g.paintColor()); ok = true;
    } else if (what === 'repair' && v.hp < v.maxHp && pay(REPAIR_COST)) {
      v.hp = v.maxHp; v.onFire = false; ok = true;
    }
    if (ok) {
      g.lastMsg = `${what} done`;
      game.emit('garagePurchase', { what, levels: g.levels() });
    }
    return ok;
  };

  g.near = () => {
    const p = game.player;
    return dist2(p.x, p.z, PLACES.garage.x, PLACES.garage.z) < 7 * 7;
  };

  g.update = (input) => {
    const p = game.player;
    const can = p.vehicle && g.near() && Math.abs(p.vehicle.speed) < 3 && !p.vehicle.wrecked;
    if (!g.open && can && !g.dismissed) { g.open = true; game.emit('garageOpen'); }
    if (g.open && !can) { g.open = false; game.emit('garageClose'); }
    if (!g.near()) g.dismissed = false;
    if (g.open && input) {
      if (input.wasPressed('Digit1')) g.buy('engine');
      if (input.wasPressed('Digit2')) g.buy('armor');
      if (input.wasPressed('Digit3')) g.buy('paint');
      if (input.wasPressed('Digit4')) g.buy('repair');
      if (input.wasPressed('Backspace', 'Digit0')) { g.open = false; g.dismissed = true; game.emit('garageClose'); }
    }
  };

  return g;
}
