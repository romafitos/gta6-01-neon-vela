// Renders the entry's screenshots from the game's own code: loads each ?shot= scene from
// shots.json in headless Chromium at 1280x720 and saves a JPEG under 256 KiB in screenshots/.
//   PW_PATH=<playwright> node tools/shoot.mjs [name...]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const root = new URL('../', import.meta.url);
const shots = JSON.parse(readFileSync(new URL('shots.json', root), 'utf8'));
const pick = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-vsync'] });
for (const s of shots) {
  if (pick.length && !pick.some((p) => s.name.includes(p))) continue;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('http://localhost:8080/' + s.query);
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 240000 });
  await page.waitForTimeout(300);
  const file = new URL('screenshots/' + s.name, root);
  let q = 88;
  for (;;) {
    const buf = await page.screenshot({ type: 'jpeg', quality: q, timeout: 120000 });
    if (buf.length <= 250 * 1024 || q <= 40) { writeFileSync(file, buf); break; }
    q -= 6;
  }
  console.log(s.name, statSync(file).size, 'bytes, quality', q, errs.length ? errs : '');
  await page.close();
}
await browser.close();
