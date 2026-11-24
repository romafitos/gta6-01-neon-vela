// The one shared game object every system reads and writes, plus a tiny event bus.
export function createGame() {
  const listeners = new Map();
  return {
    scene: null, camera: null, renderer: null, input: null,
    time: 0,            // simulated seconds since the run began
    hour: 18.1,         // in-game clock (0..24)
    timeScale: 1,       // slowed while the weapon wheel is open
    paused: true,
    started: false,
    player: null,
    vehicles: [],
    actors: [],
    colliders: null,
    stats: { money: 500, respect: 0, kills: 0 },
    flags: {},
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    emit(name, data) {
      const list = listeners.get(name);
      if (list) for (const fn of list) fn(data);
    },
  };
}
