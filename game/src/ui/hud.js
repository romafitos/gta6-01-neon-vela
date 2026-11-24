// HUD: money, wanted stars, respect rank, weapon, health/armor, district standing, mission
// objective, dispatch ticker, radio name, race status, crew abilities, garage menu, notices,
// WASTED / BUSTED / MISSION PASSED overlays and the controls help.
import { formatMoney } from '../core/mathutil.js';
import { districtAt, districtIndex } from '../world/districts.js';
import { WEAPONS } from '../combat/weapons.js';
import { ENGINE_COST, ARMOR_COST, PAINT_COST, REPAIR_COST } from '../systems/garage.js';
import { CREW_COST } from '../systems/crew.js';

// The help overlay text. Every key listed here is bound in code and checked by the audit.
export const HELP_LINES = [
  ['WASD / Arrows', 'walk / drive'], ['Mouse', 'aim · click to shoot'], ['Shift', 'sprint'],
  ['E/F', 'enter/exit car'], ['Q/Tab', 'weapon wheel (hold) · 1–6 weapons · mouse wheel'],
  ['C', 'call crew'], ['X / H / G', 'crew: suppress · heal · getaway car'],
  ['R', 'change radio'], ['M', 'map'], ['Space', 'handbrake'], ['Esc / P', 'pause'], ['F1', 'this help'],
];

const $ = (s) => document.querySelector(s);

export function createHud(game) {
  const el = {
    hud: $('#hud'), money: $('#money'), stars: $('#stars'), rank: $('#rank'), respect: $('#respectBar i'),
    wname: $('#weapon .wname'), ammo: $('#weapon .ammo'), weapon: $('#weapon'),
    hp: $('#hpBar i'), arm: $('#armBar i'),
    dname: $('#district b'), dstand: $('#district span'), dbar: $('#standBar i'),
    obj: $('#objective'), mname: $('#objective .mname'), mstep: $('#objective .mstep'), mprog: $('#objective .mprog'),
    ticker: $('#ticker'), radio: $('#radio'), notice: $('#notice'), crew: $('#crewBar'),
    speedo: $('#speedo'), race: $('#raceHud'), rpos: $('#raceHud .pos'), rinfo: $('#raceHud .info'),
    garage: $('#garage'), overlay: $('#overlay'), big: $('#overlay .big'), sub: $('#overlay .sub'),
    help: $('#help'), vignette: $('#vignette'), crosshair: $('#crosshair'),
  };
  const hud = { tickerLog: [], notices: [], noticeT: 0, tickerT: 0, radioT: 0, overlayT: 0, helpT: 0, hurtT: 0, el };

  el.help.innerHTML = '<h4>CONTROLS</h4>' + HELP_LINES.map(([k, v]) => `<kbd>${k}</kbd> ${v}`).join(' &nbsp;·&nbsp; ');

  hud.notice = (text, secs = 3) => { el.notice.textContent = text; hud.noticeT = secs; };
  hud.showOverlay = (big, sub, color, secs = 3.5) => {
    el.big.textContent = big; el.big.style.color = color; el.sub.textContent = sub || '';
    el.overlay.classList.remove('hidden'); hud.overlayT = secs;
  };
  hud.toggleHelp = (force) => {
    const show = force ?? el.help.classList.contains('hidden');
    el.help.classList.toggle('hidden', !show);
    hud.helpT = show ? 9999 : 0;
  };
  hud.flashHelp = (secs) => { el.help.classList.remove('hidden'); hud.helpT = secs; };
  hud.showRadio = (name) => { el.radio.textContent = name; el.radio.classList.remove('hidden'); hud.radioT = 3; };

  game.on('dispatch', (msg) => {
    hud.tickerLog.push(msg);
    if (hud.tickerLog.length > 30) hud.tickerLog.shift();
    el.ticker.textContent = msg; el.ticker.classList.remove('hidden'); hud.tickerT = 6;
  });
  game.on('notice', (t) => hud.notice(t));
  game.on('missionStart', (m) => hud.notice(`${m.name}\n${m.intro || ''}`, 5));
  game.on('missionComplete', (m) => hud.showOverlay('MISSION PASSED', `${m.name}  ·  +${formatMoney(m.cash)}  ·  +${m.respect} respect`, '#ffd23f', 4));
  game.on('missionFailed', ({ m, why }) => hud.showOverlay('MISSION FAILED', `${m.name}: ${why}`, '#ff5a5a', 3.5));
  game.on('wasted', () => hud.showOverlay('WASTED', 'Waking up at Santa Lumen Hospital…', '#ff3b3b', 3.5));
  game.on('busted', () => hud.showOverlay('BUSTED', 'Released from VPD Precinct 7…', '#5aa0ff', 3.5));
  game.on('rankUp', (r) => hud.notice(`RANK UP — ${r.name}`, 4));
  game.on('turfTaken', (d) => hud.notice(`${d.name} is now Vela Syndicate turf!`, 4));
  game.on('raceFinished', (r) => hud.showOverlay(r.ok ? (r.place === 1 ? 'RACE WON' : `FINISHED P${r.place}`) : 'RACE OVER', r.ok ? `${r.time.toFixed(1)} s  ·  prize ${formatMoney(r.prize)}` : '', r.ok ? '#e3b8ff' : '#aaa', 3.5));
  game.on('playerHurt', () => { hud.hurtT = 0.35; });
  game.on('saved', (why) => { if (why === 'mission') hud.notice('Game saved', 1.5); });

  function starsHtml(n, flash) {
    let s = '';
    for (let i = 0; i < 5; i++) s += i < n ? '<b>★</b>' : '★';
    el.stars.classList.toggle('flash', flash);
    return s;
  }

  let lastStars = -1, lastFlash = false;
  hud.update = (dt) => {
    const p = game.player, s = game.stats;
    el.money.textContent = formatMoney(s.money);
    const stars = game.police.stars, flash = stars > 0 && !game.police.seen && Math.floor(game.time * 3) % 2 === 0;
    if (stars !== lastStars || flash !== lastFlash) { el.stars.innerHTML = starsHtml(stars, flash); lastStars = stars; lastFlash = flash; }
    const rank = game.standing.rank(), next = game.standing.nextRank();
    el.rank.textContent = `${rank.name} · ${Math.round(s.respect)} respect`;
    el.respect.style.width = next.at > rank.at ? `${Math.min(100, (s.respect - rank.at) / (next.at - rank.at) * 100)}%` : '100%';
    const w = game.combat.weapon(), am = game.combat.ammo[game.combat.state.index];
    el.wname.textContent = p.vehicle ? (p.vehicle.k.label || 'Car') : w.name;
    el.ammo.textContent = p.vehicle ? `${Math.round(Math.max(0, p.vehicle.hp) / p.vehicle.maxHp * 100)}%` : w.melee ? '' : game.combat.state.reloadT > 0 ? 'RELOADING' : `${am.clip} / ${am.reserve}`;
    el.hp.style.width = `${Math.max(0, p.hp / p.maxHp * 100)}%`;
    el.arm.style.width = `${Math.max(0, p.armor)}%`;
    const d = districtAt(p.x, p.z), di = districtIndex(p.x, p.z), st = Math.round(s.standing[di] || 0);
    el.dname.textContent = d.name; el.dname.style.color = d.color;
    el.dstand.textContent = `standing ${st > 0 ? '+' : ''}${st}${st >= 50 ? ' · YOUR TURF' : ''}`;
    el.dbar.style.left = st >= 0 ? '50%' : `${50 + st / 2}%`;
    el.dbar.style.width = `${Math.abs(st) / 2}%`;
    el.dbar.style.background = st >= 0 ? '#ff2d95' : '#ff7a1a';
    // Objective panel: active mission, race or the next job.
    const ms = game.missions;
    if (ms.active) {
      el.obj.classList.remove('hidden');
      el.mname.textContent = `${ms.active.name}  (${ms.done.length + 1}/${ms.list.length})`;
      el.mstep.textContent = ms.step ? ms.step.label : '';
      el.mprog.innerHTML = [ms.progress, ms.timer != null && ms.timer > 0 ? `<span class="mtimer">${ms.timer.toFixed(1)} s</span>` : ''].filter(Boolean).join(' · ');
    } else if (game.races.active) {
      el.obj.classList.remove('hidden');
      el.mname.textContent = game.races.active.race.name;
      el.mstep.textContent = 'Hit every checkpoint first';
      el.mprog.textContent = '';
    } else {
      const nx = ms.next();
      el.obj.classList.toggle('hidden', !nx);
      if (nx) { el.mname.textContent = `Next job (${ms.done.length + 1}/${ms.list.length}): ${nx.name}`; el.mstep.textContent = `Meet ${nx.giver} at the yellow marker`; el.mprog.textContent = 'Purple R markers: street races · orange square: garage'; }
    }
    const ra = game.races.active;
    el.race.classList.toggle('hidden', !ra);
    if (ra) {
      el.rpos.textContent = ra.t < 0 ? String(Math.ceil(-ra.t)) : `P${ra.place || 1}/4`;
      el.rinfo.textContent = `Checkpoint ${ra.cp}/${ra.race.cps.length}  ·  ${Math.max(0, ra.t).toFixed(1)} s`;
    }
    if (p.vehicle) {
      el.speedo.classList.remove('hidden');
      el.speedo.innerHTML = `${Math.round(Math.abs(p.vehicle.speed) * 3.6)}<small> km/h</small>`;
    } else el.speedo.classList.add('hidden');
    // Crew panel.
    const c = game.crew;
    const ab = (key, name, k) => `<div class="ab"><span><kbd>${key}</kbd> ${name}</span><span class="${c.cd[k] > 0 ? 'cd' : 'rdy'}">${c.cd[k] > 0 ? Math.ceil(c.cd[k]) + 's' : 'ready'}</span></div>`;
    el.crew.innerHTML = c.members.length
      ? `<div><b>CREW ${c.members.length}/3</b>${c.suppressT > 0 ? ' · <span class="rdy">SUPPRESSING</span>' : ''}</div>` + ab('X', 'Suppress', 'suppress') + ab('H', 'Heal', 'heal') + ab('G', 'Getaway', 'getaway')
      : `<div><kbd>C</kbd> call crew (${formatMoney(CREW_COST)})</div>`;
    // Garage.
    const g = game.garage;
    el.garage.classList.toggle('hidden', !g.open);
    if (g.open) {
      const lv = g.lv;
      const cost = (arr, l) => (l >= 3 ? 'MAX' : formatMoney(arr[l]));
      el.garage.innerHTML = `<h3>CHROME &amp; CORAL CUSTOMS</h3>
        <div class="row"><span><kbd>1</kbd> Engine ${lv.engine}/3</span><span>${cost(ENGINE_COST, lv.engine)}</span></div>
        <div class="row"><span><kbd>2</kbd> Armor ${lv.armor}/3</span><span>${cost(ARMOR_COST, lv.armor)}</span></div>
        <div class="row"><span><kbd>3</kbd> Respray</span><span>${formatMoney(PAINT_COST)}</span></div>
        <div class="row"><span><kbd>4</kbd> Repair</span><span>${formatMoney(REPAIR_COST)}</span></div>
        <div class="row"><span><kbd>0</kbd> Leave</span><span>${g.lastMsg || ''}</span></div>`;
    }
    el.crosshair.classList.toggle('hidden', !!p.vehicle || !game.started || game.paused || w.melee);
    // Timers.
    hud.noticeT -= dt; if (hud.noticeT <= 0) el.notice.textContent = '';
    hud.tickerT -= dt; if (hud.tickerT <= 0) el.ticker.classList.add('hidden');
    hud.radioT -= dt; if (hud.radioT <= 0) el.radio.classList.add('hidden');
    hud.overlayT -= dt; if (hud.overlayT <= 0) el.overlay.classList.add('hidden');
    if (hud.helpT < 9000) { hud.helpT -= dt; if (hud.helpT <= 0) el.help.classList.add('hidden'); }
    hud.hurtT -= dt;
    const low = p.hp < 30 ? 0.5 + Math.sin(game.time * 6) * 0.2 : 0;
    el.vignette.style.boxShadow = `inset 0 0 160px rgba(255,0,40,${Math.max(low, hud.hurtT > 0 ? 0.6 : 0)})`;
  };

  void WEAPONS;
  return hud;
}
