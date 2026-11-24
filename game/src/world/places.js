// Fixed locations of Neon Vela: safehouse, garage, hospital, race starts and mission contacts.
// Every marker stands on asphalt beside the kerb, so it is reachable on foot and by car.
import { PITCH } from '../core/config.js';
import { lineCoord } from './roads.js';

// Middle of the horizontal road on line j between columns i and i+1; side -1 north kerb, +1 south.
export function midH(i, j, side = 1) {
  return { x: lineCoord(i) + PITCH / 2, z: lineCoord(j) + side * 5.5 };
}
// Middle of the vertical road on line i between rows j and j+1; side -1 west kerb, +1 east.
export function midV(i, j, side = 1) {
  return { x: lineCoord(i) + side * 5.5, z: lineCoord(j) + PITCH / 2 };
}

export const PLACES = {
  safehouse: { ...midH(2, 5, 1), name: 'Safehouse — Marisol Lofts' },
  garage: { ...midV(5, 1, -1), name: 'Chrome & Coral Customs' },
  hospital: { ...midH(4, 4, -1), name: 'Santa Lumen Hospital' },
  precinct: { ...midV(3, 4, 1), name: 'VPD Precinct 7' },
  pier: { ...midV(8, 4, 1), name: 'Marisol Pier' },
  store: { ...midH(6, 3, 1), name: 'Sunrise 24/7 Mart' },
  vault: { ...midH(1, 1, 1), name: 'Coral Trust Bank' },
  dock: { ...midV(8, 7, 1), name: 'Port Slip 9' },
  strip: { ...midH(5, 2, 1), name: 'Neon Strip Boulevard' },
  portyard: { ...midH(1, 7, -1), name: 'Old Port Yard' },
};

export const RACE_STARTS = [
  { id: 'strip', name: 'Neon Strip Sprint', start: midH(3, 2, 1) },
  { id: 'coast', name: 'Coastline Run', start: midV(8, 2, -1) },
  { id: 'port', name: 'Port Loop', start: midH(0, 6, 1) },
];
