// Minimap (corner, centred on the player) and the full-screen map (M). Both draw from one
// pre-rendered street plan, overlaid with district standing, blips and the GPS route line.
import { HALF, WATER_X, PITCH, ROAD_W, GRID, BEACH_X0 } from '../core/config.js';
import { DISTRICTS, districtAt } from '../world/districts.js';
import { PLACES } from '../world/places.js';
import { nearestNode, route, nodePos, lineCoord } from '../world/roads.js';

const X0 = -HALF - 20, Z0 = -HALF - 20, W = Math.ceil(WATER_X + 60 - X0), H = Math.ceil(HALF + 20 - Z0);

function buildPlan() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#1a2233'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8cf94'; g.fillRect(BEACH_X0 - X0, 0, WATER_X - BEACH_X0, H);
  g.fillStyle = '#1572a8'; g.fillRect(WATER_X - X0, 0, W, H);
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
    const x = lineCoord(i) + ROAD_W / 2 - X0, z = lineCoord(j) + ROAD_W / 2 - Z0;
    g.fillStyle = '#2e3a52'; g.fillRect(x, z, PITCH - ROAD_W, PITCH - ROAD_W);
  }
  g.fillStyle = '#5b6a86';
  for (let i = 0; i <= GRID; i++) {
    const v = lineCoord(i);
    g.fillRect(v - ROAD_W / 2 - X0, -HALF - ROAD_W / 2 - Z0, ROAD_W, HALF * 2 + ROAD_W);
    g.fillRect(-HALF - ROAD_W / 2 - X0, v - ROAD_W / 2 - Z0, HALF * 2 + ROAD_W, ROAD_W);
  }
  return c;
}

export function createMinimap(game, canvas, bigCanvas) {
  const plan = buildPlan();
  const g = canvas.getContext('2d');
  const gb = bigCanvas.getContext('2d');
  const mm = { range: 120, routeLen: 0, lastRoute: [] };

  function gpsPoints() {
    const t = game.gpsTarget;
    if (!t) return [];
    const p = game.player;
    const a = nearestNode(p.x, p.z), b = nearestNode(t.x, t.z);
    const path = route(a, b).map(nodePos);
    const pts = [{ x: p.x, z: p.z }, ...path, { x: t.x, z: t.z }];
    mm.lastRoute = pts;
    mm.routeLen = pts.reduce((s, q, i) => i ? s + Math.hypot(q.x - pts[i - 1].x, q.z - pts[i - 1].z) : 0, 0);
    return pts;
  }

  function blips() {
    const out = [];
    const ms = game.missions;
    if (ms) {
      for (const b of ms.blips) if (b.obj && (b.obj.alive !== false) && !b.obj.wrecked) out.push({ x: b.obj.x, z: b.obj.z, c: b.color, r: 4 });
      const t = ms.target();
      if (t) out.push({ x: t.x, z: t.z, c: ms.active ? '#39ff88' : '#ffd23f', r: 6, star: !ms.active });
    }
    for (const v of game.vehicles) if (v.faction === 'cop' && !v.wrecked) out.push({ x: v.x, z: v.z, c: Math.floor(game.time * 4) % 2 ? '#ff3344' : '#3388ff', r: 3.5 });
    for (const a of game.actors) if (a.alive && a.faction === 'cop') out.push({ x: a.x, z: a.z, c: '#5aa0ff', r: 2.2 });
    for (const a of game.actors) if (a.alive && a.faction === 'crew') out.push({ x: a.x, z: a.z, c: '#22e6ff', r: 2.6 });
    if (game.dispatch && game.dispatch.heli) out.push({ x: game.dispatch.heli.x, z: game.dispatch.heli.z, c: '#ffffff', r: 5, heli: true });
    if (game.races) {
      if (game.races.active) { const t = game.races.target(); if (t) out.push({ x: t.x, z: t.z, c: '#b84dff', r: 6 }); }
      else if (!(ms && ms.active)) for (const r of game.races.races) out.push({ x: r.start.x, z: r.start.z, c: '#b84dff', r: 4, flag: true });
    }
    out.push({ x: PLACES.garage.x, z: PLACES.garage.z, c: '#ffb000', r: 4, sq: true });
    out.push({ x: PLACES.safehouse.x, z: PLACES.safehouse.z, c: '#ff2d95', r: 4, sq: true });
    return out;
  }

  function drawBlip(ctx, x, y, b) {
    ctx.fillStyle = typeof b.c === 'number' ? '#' + b.c.toString(16).padStart(6, '0') : b.c;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    ctx.beginPath();
    if (b.sq) ctx.rect(x - b.r, y - b.r, b.r * 2, b.r * 2);
    else ctx.arc(x, y, b.r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    if (b.star || b.flag) { ctx.fillStyle = '#000'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(b.flag ? 'R' : '!', x, y + 3); }
  }

  function drawRoute(ctx, pts, toX, toY, width) {
    if (pts.length < 2) return;
    ctx.strokeStyle = '#b84dff'; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.95;
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(toX(q.x), toY(q.z)) : ctx.moveTo(toX(q.x), toY(q.z))));
    ctx.stroke(); ctx.globalAlpha = 1;
  }

  function drawPlayer(ctx, x, y, size) {
    const p = game.player;
    const yaw = p.vehicle ? p.vehicle.yaw : p.camYaw;
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI - yaw);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * 0.7, size * 0.8); ctx.lineTo(0, size * 0.4); ctx.lineTo(-size * 0.7, size * 0.8); ctx.closePath();
    ctx.fill(); ctx.stroke(); ctx.restore();
  }

  mm.draw = () => {
    const p = game.player;
    const cw = canvas.width, ch = canvas.height, s = cw / (mm.range * 2);
    g.save();
    g.fillStyle = '#0c1220'; g.fillRect(0, 0, cw, ch);
    g.beginPath(); g.arc(cw / 2, ch / 2, cw / 2 - 2, 0, Math.PI * 2); g.clip();
    g.imageSmoothingEnabled = false;
    g.drawImage(plan, p.x - mm.range - X0, p.z - mm.range - Z0, mm.range * 2, mm.range * 2, 0, 0, cw, ch);
    const toX = (x) => (x - p.x) * s + cw / 2, toY = (z) => (z - p.z) * s + ch / 2;
    drawRoute(g, gpsPoints(), toX, toY, 4);
    for (const b of blips()) {
      let x = toX(b.x), y = toY(b.z);
      const dx = x - cw / 2, dy = y - ch / 2, d = Math.hypot(dx, dy), lim = cw / 2 - 8;
      if (d > lim) { if (!b.star && b.r < 6) continue; x = cw / 2 + dx / d * lim; y = ch / 2 + dy / d * lim; }
      drawBlip(g, x, y, b);
    }
    drawPlayer(g, cw / 2, ch / 2, 8);
    g.restore();
    g.strokeStyle = game.police && game.police.stars ? (Math.floor(game.time * 3) % 2 ? '#ff3344' : '#3388ff') : 'rgba(255,255,255,0.7)';
    g.lineWidth = 3; g.beginPath(); g.arc(cw / 2, ch / 2, cw / 2 - 2, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.fillText('N', cw / 2, 14);
  };

  mm.drawBig = () => {
    const cw = bigCanvas.width, ch = bigCanvas.height;
    const s = Math.min(cw / W, ch / H) * 0.96;
    const ox = (cw - W * s) / 2, oz = (ch - H * s) / 2;
    gb.clearRect(0, 0, cw, ch);
    gb.fillStyle = 'rgba(5,8,16,0.9)'; gb.fillRect(0, 0, cw, ch);
    gb.drawImage(plan, ox, oz, W * s, H * s);
    const toX = (x) => ox + (x - X0) * s, toY = (z) => oz + (z - Z0) * s;
    // District standing tint and labels.
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      const cx = lineCoord(i) + PITCH / 2, cz = lineCoord(j) + PITCH / 2;
      const d = districtAt(cx, cz), di = DISTRICTS.indexOf(d), st = game.stats.standing[di] || 0;
      gb.fillStyle = st >= 50 ? 'rgba(255,45,149,0.35)' : st > 0 ? `rgba(255,45,149,${st / 300})` : st < 0 ? 'rgba(255,90,31,0.25)' : 'rgba(0,0,0,0)';
      gb.fillRect(toX(lineCoord(i) + ROAD_W / 2), toY(lineCoord(j) + ROAD_W / 2), (PITCH - ROAD_W) * s, (PITCH - ROAD_W) * s);
    }
    gb.textAlign = 'center';
    for (const [di, d] of DISTRICTS.entries()) {
      const st = Math.round(game.stats.standing[di] || 0);
      gb.fillStyle = '#fff'; gb.font = `bold ${Math.round(16 * s * 2)}px sans-serif`;
      gb.fillText(d.name.toUpperCase(), toX(d.cx), toY(d.cz));
      gb.font = `${Math.round(12 * s * 2)}px sans-serif`;
      gb.fillStyle = st >= 50 ? '#ff7ac0' : '#cfd8ea';
      gb.fillText(`Standing ${st}${st >= 50 ? ' · YOUR TURF' : ''}`, toX(d.cx), toY(d.cz) + 18 * s * 2);
    }
    drawRoute(gb, mm.lastRoute.length ? mm.lastRoute : gpsPoints(), toX, toY, 3);
    for (const b of blips()) drawBlip(gb, toX(b.x), toY(b.z), b);
    drawPlayer(gb, toX(game.player.x), toY(game.player.z), 9);
    gb.fillStyle = '#fff'; gb.font = 'bold 18px sans-serif'; gb.fillText('NEON VELA — CITY MAP (M to close)', cw / 2, 26);
  };

  void HALF;
  return mm;
}
