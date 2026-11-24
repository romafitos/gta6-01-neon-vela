// Seeded pseudo-random numbers (mulberry32) so staged screenshots and tests replay the same way.
let state = 0x9e3779b9;

export function seedRandom(seed) {
  state = (seed >>> 0) || 1;
}

export function rand() {
  state = (state + 0x6d2b79f5) | 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(a, b) {
  return a + (b - a) * rand();
}

export function randInt(a, b) {
  return Math.floor(randRange(a, b + 1));
}

export function pick(list) {
  return list[Math.floor(rand() * list.length)];
}

// Stable hash for things that must not depend on call order (building colours, window lights).
export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
