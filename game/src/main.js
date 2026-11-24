// Neon Vela — boot, title screen, menus and the fixed-step game loop that ties every system together.
import * as THREE from 'three';
import { createGame } from './core/state.js';
import { createInput } from './core/input.js';
import { createColliders } from './core/collision.js';
import { seedRandom } from './core/rng.js';
import { START_HOUR, DAY_LENGTH_S } from './core/config.js';
import { dist } from './core/mathutil.js';
import { createSky } from './world/sky.js';
import { buildCity } from './world/city.js';
import { PLACES } from './world/places.js';
import { createVehicles } from './vehicles/vehicles.js';
import { createHumans } from './actors/humans.js';
import { createPlayer } from './actors/player.js';
import { createCombat } from './combat/weapons.js';
import { createWanted } from './police/wanted.js';
import { createDispatch } from './police/dispatch.js';
import { createEffects } from './fx/effects.js';
import { createMarkers } from './fx/markers.js';
import { createAudio } from './audio/synth.js';
import { createStanding } from './systems/standing.js';
import { createGarage } from './systems/garage.js';
import { createCrew } from './systems/crew.js';
import { createMissions } from './systems/missions.js';
import { createRaces } from './systems/races.js';
import { createSave } from './systems/save.js';
import { createHud } from './ui/hud.js';
import { createMinimap } from './ui/minimap.js';
import { createWeaponWheel } from './ui/weaponwheel.js';
import { stageShot } from './shots/stage.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
// ?audit=1 is the automated test mode: same game, cheaper pixels so software GL keeps up.
// ?audit=1 is the automated test mode: software GL in a headless browser is slow, so the
// renderer drops to a low pixel ratio with no antialiasing or shadows while the game logic stays the same.
const AUDIT = params.get('audit') === '1';
seedRandom(Number(params.get('seed') || 7));

const game = createGame();
window.__game = game;
const canvas = document.getElementById('game');

// ---------- renderer & scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !AUDIT, powerPreference: 'high-performance', preserveDrawingBuffer: !!SHOT });
renderer.setPixelRatio(AUDIT ? 0.35 : Math.min(window.devicePixelRatio || 1, 1.5)); // test mode renders small
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = !AUDIT; // crisp shadows in play, off in the test mode
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 1400);
Object.assign(game, { renderer, scene, camera });
game.input = createInput(canvas);
game.colliders = createColliders();
game.hour = START_HOUR;

game.sky = createSky(game);
game.city = buildCity(game);
game.fx = createEffects(game);
game.markers = createMarkers(game);
game.audio = createAudio(game);
game.vehicleSys = createVehicles(game);
game.humans = createHumans(game);
game.player = createPlayer(game, PLACES.safehouse.x, PLACES.safehouse.z);
game.combat = createCombat(game);
game.police = createWanted(game);
game.dispatch = createDispatch(game);
game.standing = createStanding(game);
game.garage = createGarage(game);
game.crew = createCrew(game);
game.missions = createMissions(game);
game.races = createRaces(game);
game.save = createSave(game);
game.hud = createHud(game);
game.minimap = createMinimap(game, document.getElementById('minimap'), document.getElementById('bigmap'));
game.wheel = createWeaponWheel(game, document.getElementById('wheel'));

const $ = (id) => document.getElementById(id);
const ui = { title: $('title'), pause: $('pause'), hud: $('hud'), bigmap: $('bigmap'), play: $('btnPlay'), newGame: $('btnNew') };

// ---------- world population ----------
function populate() {
  const p = game.player;
  game.vehicleSys.spawnTraffic(26);
  game.humans.spawnCivilians(46, p);
  // Parked cars near the safehouse so the first mission has wheels close by.
  game.vehicleSys.spawn('sedan', p.x + 9, p.z + 1.4, Math.PI / 2, { color: 0x2ec4ff });
  game.vehicleSys.spawn('taxi', p.x - 12, p.z + 1.4, Math.PI / 2);
  // Ash Kings hang around their turf.
  for (const [x, z] of [[PLACES.portyard.x + 10, PLACES.portyard.z - 8], [PLACES.dock.x - 30, PLACES.dock.z - 20]]) {
    for (let k = 0; k < 3; k++) { const g = game.humans.spawn('gang', x + k * 2, z + (k % 2) * 2, { state: 'guard' }); game.colliders.resolveCircle(g, 0.6); }
  }
  p.camYaw = Math.PI; p.yaw = Math.PI;
  p.snapCamera(camera);
}

// Keep the streets alive around the player.
let populateT = 0;
function keepPopulated(dt) {
  populateT -= dt;
  if (populateT > 0) return;
  populateT = 2;
  const civs = game.actors.filter((a) => a.faction === 'civ' && a.alive).length;
  if (civs < 40) game.humans.spawnCivilians(4, game.player);
}

// ---------- respawn after WASTED / BUSTED ----------
function afterDeath(kind) {
  game.flags.respawnT = 3.2;
  game.flags.respawnKind = kind;
  if (game.player.vehicle && kind === 'busted') game.player.exitCar();
}
game.on('wasted', () => afterDeath('wasted'));
game.on('busted', () => { if (game.player.alive && !game.flags.respawnT) { game.player.alive = false; afterDeath('busted'); } });

function doRespawn() {
  const kind = game.flags.respawnKind;
  const place = kind === 'busted' ? PLACES.precinct : PLACES.hospital;
  const fee = Math.min(game.stats.money, kind === 'busted' ? 300 : 200);
  game.standing.addMoney(-fee, kind);
  game.police.clear();
  game.dispatch.clearAll();
  game.player.respawn(place.x, place.z);
  game.player.snapCamera(camera);
  game.flags.respawnT = 0;
  game.combat.refill();
}

// ---------- audio hooks ----------
game.on('shot', (s) => game.audio.sfx(s.weapon.id));
game.on('npcShot', (s) => { if (s.d < 60) game.audio.sfx('npc'); });
game.on('boom', (b) => game.audio.sfx('explosion', { vol: Math.max(0.2, 1 - dist(b.x, b.z, game.player.x, game.player.z) / 120) }));
game.on('carCrash', (c) => { if (c.v.driver === 'player') game.audio.sfx('crash'); });
game.on('missionComplete', () => game.audio.sfx('mission'));
game.on('missionFailed', () => game.audio.sfx('fail'));
game.on('checkpoint', () => game.audio.sfx('checkpoint'));
game.on('money', (m) => { if (m.n > 0 && m.reason !== 'turf') game.audio.sfx('money'); });
game.on('playerHurt', () => game.audio.sfx('hurt'));
game.on('weaponChanged', () => game.audio.sfx('click'));
game.on('garagePurchase', () => game.audio.sfx('select'));
game.on('enterCar', () => { game.audio.sfx('door'); if (game.audio.radio.station >= 0) { game.audio.setRadio(true); game.hud.showRadio(game.audio.stationName()); } });
game.on('exitCar', () => { game.audio.sfx('door'); game.audio.setRadio(false); game.audio.setEngine(false); });

// ---------- menus ----------
function start(fresh) {
  if (game.started) return;
  game.audio.unlock();
  game.audio.sfx('select');
  const loaded = game.save.read();
  if (fresh) game.save.wipe();
  else if (loaded.status === 'loaded') game.save.apply(loaded.data);
  game.saveStatus = fresh ? 'new' : loaded.status;
  game.started = true; game.paused = false;
  ui.title.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  if (game.pendingCrew) { game.crew.restore(game.pendingCrew); game.pendingCrew = 0; }
  game.hud.flashHelp(8);
  game.hud.notice(game.saveStatus === 'loaded' ? 'Save loaded — welcome back to Vela' : game.saveStatus === 'corrupt' ? 'Save was damaged — starting fresh' : 'Welcome to Neon Vela', 3);
  game.input.requestLock();
  canvas.focus();
}

function setPaused(on) {
  if (!game.started) return;
  game.paused = on;
  ui.pause.classList.toggle('hidden', !on);
  if (on) { game.wheel.close(false); game.audio.setEngine(false); game.audio.setSiren(0); if (document.pointerLockElement) document.exitPointerLock(); }
  else { game.input.requestLock(); game.audio.unlock(); }
}

ui.play.addEventListener('click', (e) => { e.stopPropagation(); start(false); });
ui.newGame.addEventListener('click', (e) => { e.stopPropagation(); start(true); });
$('btnResume').addEventListener('click', () => setPaused(false));
$('btnHelp').addEventListener('click', () => game.hud.toggleHelp());
canvas.addEventListener('mousedown', () => { if (game.started && !game.paused) { game.input.requestLock(); game.audio.unlock(); } });
let hadLock = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (hadLock && !locked && game.started && !game.paused) setPaused(true);
  hadLock = locked;
});
window.addEventListener('keydown', (e) => {
  if (!game.started) {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); start(false); }
    return;
  }
  if (e.code === 'Escape' || e.code === 'KeyP') { setPaused(!game.paused); return; }
  if (game.paused && e.code === 'Enter') { setPaused(false); return; }
  if (e.code === 'F1') { e.preventDefault(); game.hud.toggleHelp(); }
  if (e.code === 'KeyM') { game.mapOpen = !game.mapOpen; ui.bigmap.classList.toggle('hidden', !game.mapOpen); }
  if (e.code === 'KeyR' && game.player.vehicle && !game.paused) {
    const st = game.audio.nextStation();
    game.hud.showRadio(st ? st.name : 'Radio Off');
    game.radioChanges = (game.radioChanges || 0) + 1;
  }
});
window.addEventListener('mousemove', (e) => { if (e.movementX || e.movementY || !document.pointerLockElement) game.player.lastMouseT = game.time; });
window.addEventListener('resize', () => {
  if (SHOT) return;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
});

if (game.save.hasSave()) { ui.play.textContent = 'Continue'; ui.newGame.classList.remove('hidden'); }

// ---------- simulation ----------
function step(dt) {
  const input = game.input;
  const p = game.player;
  input.enabled = !game.paused && p.alive && !game.mapOpen;
  game.time += dt;
  if (!game.flags.freezeClock) game.hour = (game.hour + dt * 24 / DAY_LENGTH_S) % 24;
  p.update(dt, input);
  game.combat.update(dt, input);
  game.crew.update(dt, input);
  game.garage.update(input);
  game.vehicleSys.update(dt);
  game.humans.update(dt);
  game.police.update(dt);
  game.dispatch.update(dt);
  game.missions.update(dt);
  game.races.update(dt);
  game.standing.update(dt);
  game.save.update(dt);
  game.fx.update(dt);
  if (!SHOT) keepPopulated(dt);
  if (game.flags.respawnT) { game.flags.respawnT -= dt; if (game.flags.respawnT <= 0) doRespawn(); }
  input.endFrame();
}
game.step = step;

const perf = { frames: 0, frameMs: [], last: performance.now(), fps: 0, drawCalls: 0, triangles: 0 };
game.perf = perf;
let acc = 0, prev = performance.now();

function render(realDt) {
  const p = game.player;
  game.sky.update(game.hour, p);
  game.city.update(realDt, game.sky.night);
  game.markers.update(game.time);
  p.updateCamera(Math.min(realDt, 0.05), camera);
  if (game.shake > 0) { camera.position.x += (Math.random() - 0.5) * game.shake * 0.4; camera.position.y += (Math.random() - 0.5) * game.shake * 0.3; }
  renderer.render(scene, camera);
  perf.drawCalls = renderer.info.render.calls; perf.triangles = renderer.info.render.triangles;
  if (game.started || SHOT) {
    game.hud.update(realDt);
    game.minimap.draw();
    if (game.mapOpen) game.minimap.drawBig();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min(AUDIT ? 0.25 : 0.1, (now - prev) / 1000);
  prev = now;
  perf.frames++; perf.frameMs.push(realDt * 1000); if (perf.frameMs.length > 600) perf.frameMs.shift();
  if (game.started && !game.paused) {
    game.wheel.update(realDt, game.input);
    acc += realDt * game.timeScale;
    let n = 0;
    const maxSteps = AUDIT ? 15 : 4;
    while (acc >= 1 / 60 && n < maxSteps) { step(1 / 60); acc -= 1 / 60; n++; }
    if (n === maxSteps) acc = 0;
    // Engine hum and siren follow the action.
    const v = game.player.vehicle;
    if (v) game.audio.setEngine(true, v.speed, v.k.maxSpeed); else game.audio.setEngine(false);
    let near = 1e9;
    for (const c of game.dispatch.units) near = Math.min(near, dist(c.x, c.z, game.player.x, game.player.z));
    game.audio.setSiren(game.police.stars > 0 ? Math.max(0, 1 - near / 140) : 0);
  } else if (!game.started) {
    // Title screen: a slow orbit over the city at sunset.
    const t = now / 1000;
    game.player.camYaw = Math.PI + Math.sin(t * 0.05) * 0.6;
    game.time += realDt * 0.2;
  }
  // Test mode on software GL: the 3D view is redrawn twice a second so input and simulation
  // run at real speed; everything else (HUD, minimap, logic) updates every frame.
  if (AUDIT && now - lastRender < 500) { if (game.started) game.hud.update(realDt); return; }
  lastRender = now;
  render(realDt);
}
let lastRender = 0;

populate();
if (SHOT) {
  ui.title.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  game.started = true; game.paused = false;
  renderer.setSize(1280, 720, false);
  canvas.style.width = '1280px'; canvas.style.height = '720px';
  camera.aspect = 1280 / 720; camera.updateProjectionMatrix();
  stageShot(game, SHOT);
  game.shake = 0;
  game.paused = true;
  for (let k = 0; k < 3; k++) render(1 / 60);
  requestAnimationFrame(() => { render(1 / 60); window.__shotReady = true; });
} else {
  requestAnimationFrame(frame);
  window.__ready = true;
}
