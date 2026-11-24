// Neon Vela's five districts. Standing in each one moves with what the player does there.
import { HALF } from '../core/config.js';

export const DISTRICTS = [
  { id: 'coral', name: 'Coral Heights', color: '#ff8a5c', rival: 'Ash Kings', cx: -HALF / 2, cz: -HALF / 2 },
  { id: 'strip', name: 'Neon Strip', color: '#ff2d95', rival: 'Ash Kings', cx: HALF / 2 - 20, cz: -HALF / 2 },
  { id: 'port', name: 'Old Port', color: '#22e6ff', rival: 'Ash Kings', cx: -HALF / 2, cz: HALF / 2 },
  { id: 'palm', name: 'Palmetto Park', color: '#39ff88', rival: 'Ash Kings', cx: HALF / 2 - 20, cz: HALF / 2 },
  { id: 'beach', name: 'Vela Beach', color: '#ffd23f', rival: 'Ash Kings', cx: HALF + 26, cz: 0 },
];

export function districtAt(x, z) {
  if (x > HALF - 6) return DISTRICTS[4];
  if (z < 0) return x < 0 ? DISTRICTS[0] : DISTRICTS[1];
  return x < 0 ? DISTRICTS[2] : DISTRICTS[3];
}

export function districtIndex(x, z) {
  return DISTRICTS.indexOf(districtAt(x, z));
}
