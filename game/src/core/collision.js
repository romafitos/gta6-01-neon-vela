// Static world collision: axis-aligned boxes in a spatial hash. Circles (players, people, cars)
// are pushed out along the contact normal, which makes them slide along walls instead of sticking.
const CELL = 16;

export function createColliders() {
  const cells = new Map();
  const boxes = [];
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;

  function add(minX, minZ, maxX, maxZ, h = 10, tag = 'wall') {
    const b = { minX, minZ, maxX, maxZ, h, tag, id: boxes.length, alive: true };
    boxes.push(b);
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = key(cx, cz);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(b);
      }
    }
    return b;
  }

  function remove(b) { b.alive = false; }

  const seen = new Set();
  function query(minX, minZ, maxX, maxZ, out) {
    out.length = 0; seen.clear();
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const list = cells.get(key(cx, cz));
        if (!list) continue;
        for (const b of list) {
          if (b.alive && !seen.has(b.id)) { seen.add(b.id); out.push(b); }
        }
      }
    }
    return out;
  }

  const tmp = [];
  // Push a circle out of every box it overlaps. Returns the summed push (0 when free).
  function resolveCircle(p, r) {
    let pushed = 0, nx = 0, nz = 0;
    for (let iter = 0; iter < 3; iter++) {
      query(p.x - r, p.z - r, p.x + r, p.z + r, tmp);
      let any = false;
      for (const b of tmp) {
        const cx = p.x < b.minX ? b.minX : p.x > b.maxX ? b.maxX : p.x;
        const cz = p.z < b.minZ ? b.minZ : p.z > b.maxZ ? b.maxZ : p.z;
        let dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        any = true;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2), push = r - d + 0.001;
          dx /= d; dz /= d;
          p.x += dx * push; p.z += dz * push;
          pushed += push; nx += dx; nz += dz;
        } else {
          // Centre inside the box: leave by the nearest face.
          const l = p.x - b.minX, rr = b.maxX - p.x, t = p.z - b.minZ, bt = b.maxZ - p.z;
          const m = Math.min(l, rr, t, bt);
          if (m === l) { p.x = b.minX - r - 0.01; nx -= 1; }
          else if (m === rr) { p.x = b.maxX + r + 0.01; nx += 1; }
          else if (m === t) { p.z = b.minZ - r - 0.01; nz -= 1; }
          else { p.z = b.maxZ + r + 0.01; nz += 1; }
          pushed += m + r;
        }
      }
      if (!any) break;
    }
    const nl = Math.hypot(nx, nz);
    return { pushed, nx: nl ? nx / nl : 0, nz: nl ? nz / nl : 0 };
  }

  function pointBlocked(x, z, r = 0.3) {
    query(x - r, z - r, x + r, z + r, tmp);
    for (const b of tmp) {
      if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
    }
    return false;
  }

  // 2D line of sight: does the segment a->b cross a box taller than `minH`?
  function segmentBlocked(ax, az, bx, bz, minH = 3) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return false;
    query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), tmp);
    for (const b of tmp) {
      if (b.h < minH) continue;
      let t0 = 0, t1 = 1;
      const ok = clip(-dx, ax - b.minX) && clip(dx, b.maxX - ax) && clip(-dz, az - b.minZ) && clip(dz, b.maxZ - az);
      if (ok && t0 <= t1) return true;
      function clip(p, q) {
        if (Math.abs(p) < 1e-9) return q >= 0;
        const r = q / p;
        if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
        else { if (r < t0) return false; if (r < t1) t1 = r; }
        return true;
      }
    }
    return false;
  }

  return { add, remove, query, resolveCircle, pointBlocked, segmentBlocked, boxes };
}
