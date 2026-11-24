// Measures render cost in headless Chromium: average milliseconds per renderer.render call and
// per simulation step, with full and reduced graphics settings.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const query = process.argv[2] || '';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:8080/' + query);
await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
await page.click('#btnPlay');
await page.waitForTimeout(1000);
const r = await page.evaluate(() => {
  const g = window.__game;
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) g.renderer.render(g.scene, g.camera);
  g.renderer.getContext().finish();
  const render = (performance.now() - t0) / 5;
  const t1 = performance.now();
  for (let i = 0; i < 60; i++) g.step(1 / 60);
  const step = (performance.now() - t1) / 60;
  // Per-system cost: wrap each update for 60 steps.
  const parts = {};
  const sys = { player: [g.player, 'update'], combat: [g.combat, 'update'], vehicles: [g.vehicleSys, 'update'], humans: [g.humans, 'update'], police: [g.police, 'update'], dispatch: [g.dispatch, 'update'], missions: [g.missions, 'update'], races: [g.races, 'update'], fx: [g.fx, 'update'] };
  for (const [name, [obj, fn]] of Object.entries(sys)) {
    const orig = obj[fn];
    parts[name] = 0;
    obj[fn] = function (...a) { const t = performance.now(); const r = orig.apply(this, a); parts[name] += performance.now() - t; return r; };
  }
  for (let i = 0; i < 60; i++) g.step(1 / 60);
  for (const k in parts) parts[k] = +(parts[k] / 60).toFixed(3);
  return { parts, renderMs: +render.toFixed(1), stepMs: +step.toFixed(2), calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, px: g.renderer.getPixelRatio(), shadows: g.renderer.shadowMap.enabled };
});
console.log(JSON.stringify(r));
await browser.close();
