// The street grid as a graph: intersections are nodes, road segments are edges.
// Traffic, police and the GPS route all drive on it.
import { GRID, PITCH, HALF } from '../core/config.js';
import { rand } from '../core/rng.js';

export const N = GRID + 1;
export const LANE = 3.6; // offset of a lane from the road centre line

export function lineCoord(i) { return -HALF + i * PITCH; }
export function nodeId(i, j) { return i * N + j; }
export function nodeI(id) { return Math.floor(id / N); }
export function nodeJ(id) { return id % N; }
export function nodePos(id) { return { x: lineCoord(nodeI(id)), z: lineCoord(nodeJ(id)) }; }

export function neighbors(id) {
  const i = nodeI(id), j = nodeJ(id), out = [];
  if (i > 0) out.push(nodeId(i - 1, j));
  if (i < GRID) out.push(nodeId(i + 1, j));
  if (j > 0) out.push(nodeId(i, j - 1));
  if (j < GRID) out.push(nodeId(i, j + 1));
  return out;
}

export function nearestNode(x, z) {
  const i = Math.max(0, Math.min(GRID, Math.round((x + HALF) / PITCH)));
  const j = Math.max(0, Math.min(GRID, Math.round((z + HALF) / PITCH)));
  return nodeId(i, j);
}

// Breadth-first route between two nodes (grid is unweighted, so BFS is shortest).
export function route(from, to) {
  if (from === to) return [from];
  const prev = new Map([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === to) break;
    for (const nb of neighbors(cur)) {
      if (!prev.has(nb)) { prev.set(nb, cur); queue.push(nb); }
    }
  }
  if (!prev.has(to)) return [from];
  const path = [];
  for (let c = to; c !== -1; c = prev.get(c)) path.push(c);
  return path.reverse();
}

// Point on the right-hand lane of the segment a->b at fraction t.
export function lanePoint(a, b, t, out = {}) {
  const pa = nodePos(a), pb = nodePos(b);
  const dx = Math.sign(pb.x - pa.x), dz = Math.sign(pb.z - pa.z);
  // Right of the heading (dx,dz) on the ground plane is (-dz, dx).
  out.x = pa.x + (pb.x - pa.x) * t - dz * LANE;
  out.z = pa.z + (pb.z - pa.z) * t + dx * LANE;
  out.yaw = Math.atan2(dx, dz);
  return out;
}

export function randomNode() {
  return nodeId(Math.floor(rand() * N), Math.floor(rand() * N));
}

// True when (x,z) lies on asphalt (within a road strip).
export function onRoad(x, z, halfWidth = 8) {
  const fx = ((x + HALF) % PITCH + PITCH) % PITCH;
  const fz = ((z + HALF) % PITCH + PITCH) % PITCH;
  const nearX = Math.min(fx, PITCH - fx) < halfWidth && x >= -HALF - halfWidth && x <= HALF + halfWidth;
  const nearZ = Math.min(fz, PITCH - fz) < halfWidth && z >= -HALF - halfWidth && z <= HALF + halfWidth;
  return (nearX && z >= -HALF - halfWidth && z <= HALF + halfWidth) || (nearZ && x >= -HALF - halfWidth && x <= HALF + halfWidth);
}
