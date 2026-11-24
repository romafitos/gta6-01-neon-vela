// Weapon wheel: hold Q or Tab to open (time slows to a quarter), point with the mouse or press
// 1–6, release to equip. A quick tap of Q/Tab just swaps to the next weapon.
import { WEAPONS } from '../combat/weapons.js';

export const WHEEL_KEYS = ['KeyQ', 'Tab'];

export function createWeaponWheel(game, el) {
  const n = WEAPONS.length;
  const R = 150;
  el.innerHTML = '';
  const segs = WEAPONS.map((w, i) => {
    const d = document.createElement('div');
    d.className = 'seg';
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    d.style.left = `${220 + Math.cos(a) * R}px`;
    d.style.top = `${220 + Math.sin(a) * R}px`;
    d.innerHTML = `<b>${i + 1}</b>${w.name}<div class="am"></div>`;
    d.addEventListener('mouseenter', () => { if (ww.open) ww.hover = i; });
    d.addEventListener('mousedown', (e) => { e.stopPropagation(); if (ww.open) { ww.hover = i; close(true); } });
    el.appendChild(d);
    return d;
  });
  const center = document.createElement('div');
  center.className = 'center';
  el.appendChild(center);

  const ww = { open: false, hover: 0, vx: 0, vy: 0, heldT: 0, moved: false, opens: 0 };

  function open() {
    ww.open = true; ww.opens++; ww.heldT = 0; ww.frames = 0; ww.vx = 0; ww.vy = 0; ww.moved = false;
    ww.hover = game.combat.state.index;
    game.wheelOpen = true;
    game.timeScale = 0.25;
    el.classList.remove('hidden');
    render();
  }

  function close(apply) {
    if (!ww.open) return;
    ww.open = false;
    game.wheelOpen = false;
    game.timeScale = 1;
    el.classList.add('hidden');
    if (!apply) return;
    if (!ww.moved && (ww.heldT < 0.22 || ww.frames <= 2)) game.combat.cycle(1);
    else game.combat.select(ww.hover);
  }

  function render() {
    segs.forEach((d, i) => {
      d.classList.toggle('on', i === ww.hover);
      const am = game.combat.ammo[i], w = WEAPONS[i];
      d.querySelector('.am').textContent = w.melee ? '—' : `${am.clip} / ${am.reserve}`;
    });
    center.innerHTML = `<b>${WEAPONS[ww.hover].name}</b>release to equip`;
  }

  ww.update = (realDt, input) => {
    const p = game.player;
    const canUse = p.alive && !p.vehicle && input.enabled;
    if (!ww.open) {
      if (canUse && input.wasPressed(...WHEEL_KEYS)) open();
      return;
    }
    ww.heldT += realDt; ww.frames++;
    ww.vx += input.mouseDX; ww.vy += input.mouseDY;
    const len = Math.hypot(ww.vx, ww.vy);
    if (len > 24) {
      ww.moved = true;
      const a = Math.atan2(ww.vy, ww.vx) + Math.PI / 2;
      ww.hover = ((Math.round(a / (Math.PI * 2 / n)) % n) + n) % n;
      if (len > 120) { ww.vx *= 120 / len; ww.vy *= 120 / len; }
    }
    for (let i = 0; i < n; i++) if (input.wasPressed(WEAPONS[i].key)) { ww.hover = i; ww.moved = true; }
    if (input.wheel) { ww.hover = (ww.hover + (input.wheel > 0 ? 1 : n - 1)) % n; ww.moved = true; }
    render();
    if (!input.isDown(...WHEEL_KEYS) || !canUse) close(canUse);
  };
  ww.close = close;
  ww.openWheel = open;
  return ww;
}
