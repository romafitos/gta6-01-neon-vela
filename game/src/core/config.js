// World dimensions and tuning shared by every system of Neon Vela.
export const GRID = 8;            // city blocks per side
export const PITCH = 72;          // distance between road centre lines
export const ROAD_W = 16;         // asphalt width
export const SIDEWALK = 4;        // kerb strip around each block
export const HALF = (GRID / 2) * PITCH; // road lines run from -HALF to +HALF
export const BEACH_X0 = HALF + ROAD_W / 2;   // sand starts east of Ocean Drive
export const WATER_X = HALF + 52;            // waterline
export const WORLD_MIN_X = -HALF - 14;
export const WORLD_MAX_X = WATER_X - 1.5;
export const WORLD_MIN_Z = -HALF - 14;
export const WORLD_MAX_Z = HALF + 14;

export const PLAYER_RADIUS = 0.45;
export const CAR_RADIUS = 1.55;

export const START_HOUR = 17.45;  // golden hour: low sun over the city, neon warming up
export const DAY_LENGTH_S = 1440; // one in-game day lasts 24 real minutes

export const SAVE_KEY = 'neonvela.save';
export const SAVE_VERSION = 3;
export const AUTOSAVE_S = 30;

export const RESPECT_RANKS = [
  { name: 'Street Rat', at: 0 },
  { name: 'Runner', at: 100 },
  { name: 'Hustler', at: 300 },
  { name: 'Enforcer', at: 650 },
  { name: 'Lieutenant', at: 1100 },
  { name: 'Underboss', at: 1700 },
  { name: 'Kingpin of Vela', at: 2500 },
];

export const COLORS = {
  neon: [0xff2d95, 0x22e6ff, 0xb84dff, 0xffb000, 0x39ff88],
  paint: [0xff4f7b, 0x2ec4ff, 0xffd23f, 0xf7f7f2, 0x1d1d24, 0x8b5cf6, 0x10b981, 0xff7a1a],
};
