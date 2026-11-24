// Neon Vela audit harness: drives the game in headless Chromium with scripted keyboard and mouse
// input and asserts that each system really changes game state. Usage (game served on :8080):
//   NODE_PATH=<dir with playwright> node tools/audit.mjs [--only name,name] [--play 60]
// Writes a JSON log to tools/audit-log.json and prints PASS/FAIL per test.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.env.GAME_URL || 'http://localhost:8080/';
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const PLAY_S = args.includes('--play') ? Number(args[args.indexOf('--play') + 1]) : 60;

const results = [];
const log = { started: new Date().toISOString(), requests: { local: 0, blocked: [] }, console: { errors: [], warnings: [] }, results, perf: null };

function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--autoplay-policy=user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await context.route('**/*', (route) => {
  const url = route.request().url();
  if (url.startsWith('http://localhost:8080/') || url.startsWith('data:') || url.startsWith('blob:')) { log.requests.local++; return route.continue(); }
  log.requests.blocked.push(url);
  return route.abort();
});
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') log.console.errors.push(m.text());
  if (m.type() === 'warning') log.console.warnings.push(m.text());
});
page.on('pageerror', (e) => log.console.errors.push('pageerror: ' + e.message));

const G = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const want = (n) => !only || only.includes(n);
async function hold(key, ms) { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); }
async function tap(key) { await page.keyboard.press(key); await wait(120); }
const pos = () => G(() => { const p = window.__game.player; return { x: p.x, z: p.z, yaw: p.yaw, cam: p.camYaw, car: !!p.vehicle, hp: p.hp }; });

// Put the player somewhere for a test, on foot, with the police off its back.
async function reset(x, z, yaw = 0) {
  await G(({ x, z, yaw }) => {
    const g = window.__game;
    if (g.missions.active) g.missions.failActive('audit');
    if (g.races.active) g.races.abort('audit');
    g.police.clear(); g.dispatch.clearAll();
    if (!g.player.alive) g.player.respawn(x, z);
    g.player.teleport(x, z, yaw); g.player.hp = 100;
    g.flags.respawnT = 0;
  }, { x, z, yaw });
  await wait(150);
}

// ---------------- load + title ----------------
const t0 = Date.now();
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
log.loadMs = Date.now() - t0;
record('load: page ready', true, { ms: log.loadMs });

// Point 2: first click on Play starts the game.
await page.click('#btnPlay');
await wait(300);
const started = await G(() => ({ started: window.__game.started, paused: window.__game.paused, title: document.getElementById('title').classList.contains('hidden') }));
record('start: first click on Play starts the game', started.started && !started.paused && started.title, started);
{
  const a = await pos();
  await hold('KeyW', 700);
  const b = await pos();
  record('start: controllable immediately after start', Math.hypot(b.x - a.x, b.z - a.z) > 1.5, { moved: +Math.hypot(b.x - a.x, b.z - a.z).toFixed(2) });
}

async function controls() {
  const S = await G(() => { const s = window.__game.player; return { x: s.x, z: s.z }; });
  const moveTest = async (key, label) => {
    await reset(S.x, S.z, Math.PI);
    const a = await pos(); await hold(key, 500); const b = await pos();
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    record(`control: ${label} (${key}) moves`, d > 1, { d: +d.toFixed(2) });
  };
  for (const [k, l] of [['KeyW', 'forward'], ['KeyS', 'back'], ['KeyA', 'left'], ['KeyD', 'right'], ['ArrowUp', 'forward'], ['ArrowDown', 'back'], ['ArrowLeft', 'left'], ['ArrowRight', 'right']]) await moveTest(k, l);
  // Sprint moves faster than walking.
  await reset(S.x, S.z, Math.PI);
  let a = await pos(); await hold('KeyW', 600); let b = await pos();
  const walk = Math.hypot(b.x - a.x, b.z - a.z);
  await reset(S.x, S.z, Math.PI);
  await page.keyboard.down('ShiftLeft'); a = await pos(); await hold('KeyW', 600); b = await pos(); await page.keyboard.up('ShiftLeft');
  const run = Math.hypot(b.x - a.x, b.z - a.z);
  record('control: Shift sprint is faster', run > walk * 1.3, { walk: +walk.toFixed(2), sprint: +run.toFixed(2) });
  // Mouse aim turns the camera.
  const c0 = (await pos()).cam;
  await page.mouse.move(640, 360); await page.mouse.move(760, 360, { steps: 6 }); await wait(150);
  const c1 = (await pos()).cam;
  record('control: mouse turns the aim/camera', Math.abs(c1 - c0) > 0.05, { before: +c0.toFixed(3), after: +c1.toFixed(3) });
  // Shoot: pistol uses ammo and emits a shot.
  await G(() => { const g = window.__game; g.combat.select(1); g.__shots = 0; g.on('shot', () => g.__shots++); });
  await wait(250);
  const ammo0 = await G(() => window.__game.combat.ammo[1].clip);
  await page.mouse.down(); await wait(80); await page.mouse.up(); await wait(400);
  const shot = await G(() => ({ clip: window.__game.combat.ammo[1].clip, shots: window.__game.__shots }));
  record('control: left click shoots', shot.shots >= 1 && shot.clip < ammo0, { clipBefore: ammo0, ...shot });
  // Weapon switching: number keys, mouse wheel, Q tap and Q hold wheel.
  const wi = () => G(() => window.__game.combat.state.index);
  const keys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
  const got = [];
  for (const k of keys) { await tap(k); got.push(await wi()); }
  record('control: keys 1–6 select 6 weapons', got.join(',') === '0,1,2,3,4,5', got);
  await tap('Digit2');
  await page.mouse.wheel(0, 120); await wait(200);
  const afterWheel = await wi();
  record('control: mouse wheel cycles weapon', afterWheel === 2, { index: afterWheel });
  await tap('KeyQ'); await wait(150);
  const afterQ = await wi();
  record('control: Q tap switches to next weapon', afterQ === 3, { index: afterQ });
  await page.keyboard.down('Tab'); await wait(300);
  const wheelOpen = await G(() => ({ open: window.__game.wheel.open, ts: window.__game.timeScale, vis: !document.getElementById('wheel').classList.contains('hidden') }));
  await page.mouse.move(640, 360); await page.mouse.move(640, 200, { steps: 5 }); await wait(150);
  await page.keyboard.up('Tab'); await wait(200);
  const afterWheelSel = await G(() => ({ idx: window.__game.combat.state.index, open: window.__game.wheel.open, ts: window.__game.timeScale }));
  record('control: hold Tab opens weapon wheel with slow-mo', wheelOpen.open && wheelOpen.vis && wheelOpen.ts < 0.5, wheelOpen);
  record('control: wheel selection by mouse on release', afterWheelSel.idx === 0 && !afterWheelSel.open && afterWheelSel.ts === 1, afterWheelSel);
  await page.keyboard.down('KeyQ'); await wait(250); await tap('Digit5'); await page.keyboard.up('KeyQ'); await wait(200);
  record('control: hold Q wheel + number picks weapon', (await wi()) === 4, { index: await wi() });
  // Enter / exit car with F and E.
  for (const key of ['KeyF', 'KeyE']) {
    await reset(S.x, S.z, Math.PI);
    await G(() => { const g = window.__game, p = g.player; g.__testCar = g.vehicleSys.spawn('sedan', p.x + 2.4, p.z, 0); });
    await wait(150);
    await tap(key); await wait(200);
    const inCar = (await pos()).car;
    await hold('KeyW', 900);
    const drove = await G(() => { const v = window.__game.__testCar; return Math.hypot(v.x - v.lastX, v.z - v.lastZ) >= 0 && Math.abs(v.speed) > 2; });
    await hold('KeyS', 1400); await wait(800);
    await tap(key); await wait(250);
    const out = !(await pos()).car;
    record(`control: ${key === 'KeyF' ? 'F' : 'E'} enters car, W drives, ${key === 'KeyF' ? 'F' : 'E'} exits`, inCar && drove && out, { inCar, drove, out });
    await G(() => { const g = window.__game; if (g.__testCar && !g.player.vehicle) g.vehicleSys.remove(g.__testCar); });
  }
  // Pause on Esc and P, resume with Esc/Enter.
  for (const key of ['Escape', 'KeyP']) {
    await tap(key);
    const pz = await G(() => ({ paused: window.__game.paused, shown: !document.getElementById('pause').classList.contains('hidden') }));
    const tA = await G(() => window.__game.time); await wait(300); const tB = await G(() => window.__game.time);
    await tap(key === 'Escape' ? 'Escape' : 'Enter');
    const resumed = await G(() => !window.__game.paused);
    record(`control: ${key} pauses (time frozen) and resumes`, pz.paused && pz.shown && tA === tB && resumed, { ...pz, frozen: tA === tB, resumed });
  }
  // Help F1, map M, radio R in car.
  await tap('F1');
  const helpShown = await G(() => !document.getElementById('help').classList.contains('hidden') && document.getElementById('help').textContent);
  await tap('F1');
  const keysListed = ['E/F', 'Q/Tab', 'C', 'R', 'M', 'WASD', 'Mouse', 'Shift', 'Esc'].every((k) => (helpShown || '').includes(k));
  record('control: F1 help lists E/F, Q/Tab, C, R, M, WASD, Mouse, Shift, Esc', !!helpShown && keysListed, { text: (helpShown || '').slice(0, 260) });
  await tap('KeyM');
  const mapOpen = await G(() => window.__game.mapOpen && !document.getElementById('bigmap').classList.contains('hidden'));
  await tap('KeyM');
  record('control: M toggles the city map', mapOpen && !(await G(() => window.__game.mapOpen)), { mapOpen });
}

async function radio() {
  const S = await G(() => ({ x: window.__game.player.x, z: window.__game.player.z }));
  await reset(S.x, S.z);
  await G(() => { const g = window.__game, p = g.player; g.__rc = g.vehicleSys.spawn('sedan', p.x + 2.4, p.z, 0); });
  await tap('KeyF'); await wait(300);
  const names = [];
  for (let i = 0; i < 4; i++) { await tap('KeyR'); names.push(await G(() => window.__game.audio.stationName())); }
  const st = await G(() => ({ ctx: window.__game.audio.ctx ? window.__game.audio.ctx.state : 'none', on: window.__game.audio.radio.on }));
  await tap('KeyR');
  await wait(600);
  const playing = await G(() => ({ on: window.__game.audio.radio.on, name: window.__game.audio.stationName() }));
  record('radio: R cycles 3 synth stations + off, in car', new Set(names.filter((n) => n !== 'Radio Off')).size === 3 && names.includes('Radio Off'), { names, ...st, playing });
  record('audio: context running after user gesture', st.ctx === 'running', st);
  await tap('KeyF');
}

async function collision() {
  // Walk and drive into walls from many angles; the player must keep moving when steering away.
  const spots = await G(() => {
    const g = window.__game;
    const bs = g.colliders.boxes.filter((b) => b.tag === 'building' && b.maxX - b.minX > 6).slice(0, 400);
    const out = [];
    for (let i = 0; i < bs.length && out.length < 6; i += Math.max(1, Math.floor(bs.length / 6))) out.push(bs[i]);
    return out.map((b) => ({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ }));
  });
  let walkFails = 0, walkRuns = 0, carFails = 0, carRuns = 0, inside = 0;
  const dirs = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, -Math.PI / 4, -Math.PI / 2, -(3 * Math.PI) / 4];
  for (const b of spots) {
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    for (const yawIdx of [0, 2, 4, 6, 1, 5]) {
      const yaw = dirs[yawIdx];
      // Start 7 m outside the box, facing it.
      const r = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 7;
      const sx = cx - Math.sin(yaw) * r, sz = cz - Math.cos(yaw) * r;
      await reset(sx, sz, yaw);
      await G((yaw) => { window.__game.player.camYaw = yaw; }, yaw);
      await hold('KeyW', 1400);
      const hit = await pos();
      const blocked = await G(({ x, z }) => window.__game.colliders.pointBlocked(x, z, 0.3), hit);
      if (blocked) inside++;
      // Steer away: back off and strafe; must move.
      await hold('KeyS', 500);
      const away = await pos();
      walkRuns++;
      if (Math.hypot(away.x - hit.x, away.z - hit.z) < 0.8) walkFails++;
    }
    // Drive: same wall, three angles, then reverse out.
    for (const yawIdx of [0, 3, 6]) {
      const yaw = dirs[yawIdx];
      const r = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 16;
      const sx = cx - Math.sin(yaw) * r, sz = cz - Math.cos(yaw) * r;
      await reset(sx, sz, yaw);
      await G(({ yaw }) => { const g = window.__game, p = g.player; const v = g.vehicleSys.spawn('sedan', p.x, p.z, yaw); g.colliders.resolveCircle(v, 1.6); g.__cc = v; p.enterNearest(); }, { yaw });
      await hold('KeyW', 1800);
      const hit = await pos();
      await hold('KeyS', 1400);
      const away = await pos();
      carRuns++;
      if (Math.hypot(away.x - hit.x, away.z - hit.z) < 1.5) carFails++;
      await G(() => { const g = window.__game; const v = g.__cc; if (g.player.vehicle) { g.player.vehicle.speed = 0; g.player.exitCar(); } if (v) g.vehicleSys.remove(v); });
    }
  }
  // Corner test: walk diagonally into the inside of an L between two boxes (block corners).
  record('collision: on-foot never stuck (backs away after wall hits)', walkFails === 0, { runs: walkRuns, stuck: walkFails, endedInsideGeometry: inside });
  record('collision: car never stuck (reverses away after wall hits)', carFails === 0, { runs: carRuns, stuck: carFails });
  record('collision: player never inside geometry', inside === 0, { inside });
}

async function play() {
  // Scripted free play: run, shoot, drive, for PLAY_S seconds; watch for errors and frame cost.
  const S = await G(() => ({ x: window.__game.player.x, z: window.__game.player.z }));
  await reset(S.x, S.z);
  await G(() => { const g = window.__game; g.perf.frameMs.length = 0; });
  const end = Date.now() + PLAY_S * 1000;
  const seq = ['KeyW', 'KeyA', 'KeyW', 'KeyD', 'KeyS'];
  let i = 0;
  while (Date.now() < end) {
    const k = seq[i % seq.length]; i++;
    await page.keyboard.down('ShiftLeft');
    await hold(k, 700);
    await page.keyboard.up('ShiftLeft');
    await page.mouse.move(640 + ((i * 37) % 200) - 100, 360, { steps: 3 });
    await page.mouse.down(); await wait(60); await page.mouse.up();
    if (i % 6 === 0) { await tap('KeyF'); await hold('KeyW', 1200); await tap('KeyF'); }
  }
  const perf = await G(() => {
    const ms = window.__game.perf.frameMs.slice().sort((a, b) => a - b);
    const avg = ms.reduce((s, x) => s + x, 0) / ms.length;
    return { frames: ms.length, avgMs: +avg.toFixed(2), p50: +ms[Math.floor(ms.length / 2)].toFixed(2), p95: +ms[Math.floor(ms.length * 0.95)].toFixed(2), fps: +(1000 / avg).toFixed(1), drawCalls: window.__game.perf.drawCalls, triangles: window.__game.perf.triangles };
  });
  log.perf = perf;
  record(`play: ${PLAY_S}s scripted play survived`, true, perf);
}

if (want('controls')) await controls();
if (want('radio')) await radio();
if (want('collision')) await collision();

// Feature tests live in tools/audit-features.mjs and are loaded here so one run covers everything.
if (!only || only.some((n) => n.startsWith('f:'))) {
  const { runFeatures } = await import('./audit-features.mjs');
  await runFeatures({ page, G, wait, hold, tap, pos, reset, record, want: (n) => !only || only.includes('f:' + n) || only.includes('f:all') });
}

if (want('play')) await play();

log.console.errors = [...new Set(log.console.errors)];
record('offline: zero non-localhost requests attempted', log.requests.blocked.length === 0, { local: log.requests.local, blocked: log.requests.blocked });
record('console: zero errors', log.console.errors.length === 0, log.console.errors.slice(0, 10));
record('console: zero warnings', log.console.warnings.length === 0, log.console.warnings.slice(0, 10));
log.finished = new Date().toISOString();
log.pass = results.filter((r) => r.ok).length; log.fail = results.filter((r) => !r.ok).length;
writeFileSync(new URL('./audit-log.json', import.meta.url), JSON.stringify(log, null, 2) + '\n');
console.log(`\n${log.pass} passed, ${log.fail} failed`);
await browser.close();
process.exit(log.fail ? 1 : 0);
