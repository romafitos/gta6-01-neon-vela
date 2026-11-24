// Versioned autosave in localStorage: saved on mission complete, every 30 s and when the page
// is hidden or closed. A corrupt or unknown save falls back to defaults (and is kept aside).
import { SAVE_KEY, SAVE_VERSION, AUTOSAVE_S } from '../core/config.js';
import { DISTRICTS } from '../world/districts.js';

export function defaultSave() {
  return {
    v: SAVE_VERSION,
    money: 500, respect: 0,
    standing: DISTRICTS.map(() => 0),
    missionsDone: [],
    garage: { engine: 0, armor: 0, paint: 0 },
    raceBest: {},
    crew: 0,
    hour: null,
    savedAt: 0,
  };
}

function num(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

// Bring an older or partial save up to the current schema.
export function migrate(raw) {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') throw new Error('not an object');
  const v = num(raw.v, 1);
  if (v > SAVE_VERSION) throw new Error('save from a newer version');
  const out = { ...d };
  out.money = Math.max(0, num(raw.money ?? raw.cash, d.money));
  out.respect = Math.max(0, num(raw.respect, d.respect));
  if (Array.isArray(raw.standing)) out.standing = d.standing.map((x, i) => Math.max(-100, Math.min(100, num(raw.standing[i], 0))));
  if (Array.isArray(raw.missionsDone)) out.missionsDone = raw.missionsDone.filter((m) => typeof m === 'string');
  else if (typeof raw.mission === 'number') out.missionsDone = Array.from({ length: raw.mission }, (_, i) => 'm' + (i + 1)); // v1 kept an index
  const g = raw.garage || {};
  out.garage = { engine: Math.min(3, Math.max(0, num(g.engine, 0) | 0)), armor: Math.min(3, Math.max(0, num(g.armor, 0) | 0)), paint: Math.max(0, num(g.paint, 0) | 0) };
  out.raceBest = raw.raceBest && typeof raw.raceBest === 'object' ? raw.raceBest : {};
  out.crew = Math.min(3, Math.max(0, num(raw.crew, 0) | 0));
  out.hour = typeof raw.hour === 'number' ? raw.hour : null;
  out.savedAt = num(raw.savedAt, 0);
  out.v = SAVE_VERSION;
  return out;
}

export function createSave(game) {
  const store = (() => { try { return window.localStorage; } catch { return null; } })();
  const sv = { lastSave: 0, timer: AUTOSAVE_S, status: 'none', count: 0 };

  function read() {
    if (!store) return { data: defaultSave(), status: 'unavailable' };
    let text = null;
    try { text = store.getItem(SAVE_KEY); } catch { return { data: defaultSave(), status: 'unavailable' }; }
    if (!text) return { data: defaultSave(), status: 'none' };
    try {
      return { data: migrate(JSON.parse(text)), status: 'loaded' };
    } catch (err) {
      try { store.setItem(SAVE_KEY + '.corrupt', text); } catch { /* storage full: drop it */ }
      return { data: defaultSave(), status: 'corrupt', error: String(err.message || err) };
    }
  }

  function snapshot() {
    const s = game.stats;
    return {
      v: SAVE_VERSION,
      money: Math.round(s.money), respect: Math.round(s.respect),
      standing: s.standing.map((x) => Math.round(x)),
      missionsDone: game.missions ? game.missions.done.slice() : [],
      garage: game.garage ? game.garage.levels() : { engine: 0, armor: 0, paint: 0 },
      raceBest: game.races ? { ...game.races.best } : {},
      crew: game.crew ? game.crew.members.length : 0,
      hour: game.hour,
      savedAt: Date.now(),
    };
  }

  function write(reason) {
    if (!store || !game.started || game.flags.shot) return false;
    try {
      store.setItem(SAVE_KEY, JSON.stringify(snapshot()));
      sv.lastSave = game.time; sv.timer = AUTOSAVE_S; sv.count++;
      game.emit('saved', reason);
      return true;
    } catch {
      game.emit('saveFailed', reason);
      return false;
    }
  }

  function apply(data) {
    const s = game.stats;
    s.money = data.money; s.respect = data.respect; s.standing = data.standing.slice();
    if (game.missions) game.missions.done = data.missionsDone.slice();
    if (game.garage) game.garage.setLevels(data.garage);
    if (game.races) game.races.best = { ...data.raceBest };
    if (data.hour !== null) game.hour = data.hour;
    game.pendingCrew = data.crew;
  }

  function hasSave() { return read().status === 'loaded'; }

  function wipe() { try { store && store.removeItem(SAVE_KEY); } catch { /* ignore */ } }

  function update(dt) {
    if (!game.started) return;
    sv.timer -= dt;
    if (sv.timer <= 0) write('interval');
  }

  window.addEventListener('pagehide', () => write('unload'));
  window.addEventListener('beforeunload', () => write('unload'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) write('hidden'); });
  game.on('missionComplete', () => write('mission'));
  game.on('raceFinished', () => write('race'));
  game.on('garagePurchase', () => write('garage'));

  return Object.assign(sv, { read, write, apply, snapshot, hasSave, wipe, update });
}
