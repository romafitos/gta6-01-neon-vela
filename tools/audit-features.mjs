// Feature tests for the Neon Vela audit: every system is exercised and must change game state.
// Loaded by tools/audit.mjs. Simulation is advanced with game.step() for speed and determinism;
// player-facing keys (crew, garage, radio) are pressed through the real keyboard.

export async function runFeatures(t) {
  const { page, G, wait, tap, reset, record, want } = t;
  const home = await G(() => ({ x: window.__game.player.x, z: window.__game.player.z }));

  // Shared in-page helpers.
  await G(() => {
    const g = window.__game;
    g.__steps = (n) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
    g.__count = {};
    for (const ev of ['missionComplete', 'missionFailed', 'roadblock', 'heli', 'pit', 'ram', 'explosion', 'carOnFire', 'rankUp', 'turfTaken', 'raceFinished', 'checkpoint', 'saved', 'crewAbility', 'crewJoined', 'garagePurchase', 'dispatch']) {
      g.__count[ev] = 0; g.on(ev, () => g.__count[ev]++);
    }
  });

  // ---------- 1. Story missions ----------
  if (want('missions')) {
    const r = await G(() => {
      const g = window.__game, ms = g.missions, p = g.player;
      g.missions.done = [];
      if (ms.active) ms.failActive('audit');
      g.police.clear(); g.dispatch.clearAll();
      const out = [];
      const solve = (step) => {
        const k = step.kind;
        if (k === 'car') { const v = g.vehicleSys.spawn('sedan', p.x + 2.5, p.z, 0); g.colliders.resolveCircle(v, 1.6); p.enterNearest(); }
        else if (k === 'goto') {
          const tg = step.target(ms);
          if (p.vehicle) { const v = p.vehicle; v.x = tg.x; v.z = tg.z; v.speed = 0; p.x = tg.x; p.z = tg.z; }
          else if (step.label.includes('Drive')) { const v = g.vehicleSys.spawn('sedan', tg.x, tg.z, 0); p.teleport(tg.x + 2, tg.z); p.enterNearest(); v.x = tg.x; v.z = tg.z; }
          else p.teleport(tg.x, tg.z);
        } else if (k === 'steal') { const c = step.car; p.teleport(c.x + 2.6, c.z); p.enterNearest(); }
        else if (k === 'deliver') { const tg = step.target(ms); const v = p.vehicle; if (v) { v.x = tg.x; v.z = tg.z; v.speed = 0; } }
        else if (k === 'kill') { for (const f of step.foes) if (f.alive) g.combat.damageActor(f, 9999, 'player'); }
        else if (k === 'chase') g.vehicleSys.damage(step.car, 99999, 'player');
        else if (k === 'convoy') g.vehicleSys.damage(step.truck, 99999, 'player');
        else if (k === 'hold') { const tg = step.target(ms); if (p.vehicle) { p.vehicle.speed = 0; p.exitCar(); } p.teleport(tg.x, tg.z); }
        else if (k === 'defend') { const tg = step.target(ms); if (p.vehicle) { p.vehicle.speed = 0; p.exitCar(); } p.teleport(tg.x, tg.z); for (const f of step.foes) if (f.alive) g.combat.damageActor(f, 9999, 'player'); }
        else if (k === 'lose') { g.dispatch.clearAll(); g.police.clear(); }
      };
      for (let mi = 0; mi < ms.list.length; mi++) {
        const m = ms.list[mi];
        const nx = ms.next();
        const rec = { id: m.id, name: m.name, type: m.type, steps: [], ok: false };
        if (!nx || nx.id !== m.id) { rec.err = 'not unlocked in order'; out.push(rec); continue; }
        // Start by walking into the start marker.
        if (p.vehicle) { p.vehicle.speed = 0; p.exitCar(); }
        p.alive = true; p.hp = 100;
        ms.cooldown = 0;
        p.teleport(m.place.x + 1, m.place.z);
        g.__steps(3);
        rec.started = !!ms.active && ms.active.id === m.id;
        rec.startMarker = true;
        if (!rec.started) { rec.err = 'did not start from marker'; out.push(rec); continue; }
        const money0 = g.stats.money, resp0 = g.stats.respect;
        let guard = 0;
        while (ms.active && guard++ < 60) {
          const step = ms.step, kind = step.kind, idx = ms.stepIdx;
          const tgt = step.target(ms);
          const hasMarker = ms.markersOwned.length > 0 || ms.blips.length > 0 || !tgt;
          solve(step);
          let n = 0;
          while (ms.active && ms.stepIdx === idx && n < 2400) {
            g.__steps(30); n += 30;
            if (p.alive) p.hp = p.maxHp;
            if (ms.step && ms.step.kind === 'defend') solve(ms.step);
            if (ms.step && ms.step.kind === 'lose') solve(ms.step);
            if (ms.step && ms.step.kind === 'hold' && p.vehicle) solve(ms.step);
            if (!p.alive) { p.alive = true; p.hp = 100; g.flags.respawnT = 0; }
          }
          rec.steps.push({ kind, label: step.label, marker: hasMarker, gps: !!tgt, ok: ms.stepIdx !== idx || !ms.active });
        }
        rec.ok = ms.done.includes(m.id);
        rec.cash = g.stats.money - money0; rec.respect = g.stats.respect - resp0;
        rec.fail = ms.lastResult && !ms.lastResult.ok ? ms.lastResult.why : undefined;
        out.push(rec);
        if (!rec.ok) break;
        g.police.clear(); g.dispatch.clearAll();
      }
      return { missions: out, done: ms.done.slice(), completeEvents: g.__count.missionComplete };
    });
    const passed = r.missions.filter((m) => m.ok && m.cash > 0 && m.respect > 0);
    const types = [...new Set(passed.map((m) => m.type))];
    for (const m of r.missions) record(`mission ${m.id} "${m.name}" (${m.type}): starts at marker, ${m.steps.length} steps, rewards`, m.ok && m.cash > 0 && m.respect > 0 && m.steps.every((s) => s.marker), { steps: m.steps.map((s) => s.kind + (s.ok ? '' : '✗')).join('>'), cash: m.cash, respect: m.respect, err: m.err || m.fail });
    record('missions: 10 staged missions complete in order, each unlocking the next', passed.length === 10 && r.done.length === 10, { completed: passed.length, types });
  }

  // ---------- 2. Police dispatch ----------
  if (want('police')) {
    await reset(home.x, home.z);
    // Crime raises stars: real click shooting near witnesses.
    await G(() => { const g = window.__game, p = g.player; g.combat.select(1); g.combat.refill(); for (let i = 0; i < 3; i++) g.humans.spawn('civ', p.x + 4 + i, p.z + 3); });
    await page.mouse.move(640, 360); await page.mouse.down(); await wait(80); await page.mouse.up(); await wait(500);
    const s1 = await G(() => window.__game.police.stars);
    record('police: firing a gun near witnesses gives a wanted star', s1 >= 1, { stars: s1 });
    const r = await G(() => {
      const g = window.__game, p = g.player, out = {};
      const cop = g.humans.spawn('cop', p.x + 5, p.z);
      g.combat.damageActor(cop, 9999, 'player');
      out.afterCopKill = g.police.stars;
      g.police.setMin(3);
      const t0 = g.__count.dispatch;
      g.dispatch.rbT = 0;
      g.__steps(60);
      out.roadblocks = g.dispatch.roadblocks.length;
      out.roadblockCars = g.dispatch.roadblocks.reduce((s, rb) => s + rb.cars.length, 0);
      out.units3 = g.dispatch.units.length;
      g.police.setMin(5);
      g.__steps(600);
      out.units5 = g.dispatch.units.length;
      out.heli = !!g.dispatch.heli;
      // Searchlight tracks the player: move away 30 m and watch the light point follow.
      const h = g.dispatch.heli;
      if (h) {
        h.tx = p.x; h.tz = p.z; g.__steps(5);
        p.teleport(p.x + 30, p.z);
        const d0 = Math.hypot(h.tx - p.x, h.tz - p.z);
        g.__steps(120);
        const d1 = Math.hypot(h.tx - p.x, h.tz - p.z);
        g.__steps(180);
        out.light = { before: +d0.toFixed(1), after2s: +d1.toFixed(1), after5s: +Math.hypot(h.tx - p.x, h.tz - p.z).toFixed(1), lit: h.lit, spotIntensity: h.spot.intensity, coneVisible: h.cone.visible };
      }
      out.ticker = g.hud.tickerLog.slice(-4);
      out.tickerCount = g.__count.dispatch - t0;
      return out;
    });
    record('police: killing an officer raises to 3+ stars', r.afterCopKill >= 3, { stars: r.afterCopKill });
    record('police: roadblock with cruisers spawns ahead at 3 stars', r.roadblocks >= 1 && r.roadblockCars >= 2, { roadblocks: r.roadblocks, cars: r.roadblockCars });
    record('police: more units with more stars (3★→5★)', r.units5 > r.units3 && r.units5 >= 4, { units3: r.units3, units5: r.units5 });
    record('police: Air One helicopter at 4–5 stars', r.heli, {});
    record('police: Air One searchlight tracks the player in real time', r.light && r.light.after5s < 3 && r.light.after5s < r.light.before && r.light.spotIntensity > 0, r.light);
    record('police: dispatch radio ticker messages in HUD', r.tickerCount >= 3 && r.ticker.some((m) => /Unit \d+/.test(m)), r.ticker);
    // RAM / PIT: player drives, cruisers chase and make contact.
    const ram = await G(() => {
      const g = window.__game, p = g.player;
      g.police.clear(); g.dispatch.clearAll();
      if (p.vehicle) { p.vehicle.speed = 0; p.exitCar(); }
      // Avenue x = -216 runs north-south; drive its southbound lane.
      const lp = { x: -216 + 3.6, z: -150 };
      p.teleport(lp.x + 3, lp.z);
      const v = g.vehicleSys.spawn('sedan', lp.x, lp.z, 0); v.hp = v.maxHp = 5000;
      p.enterNearest();
      g.police.setMin(3);
      g.dispatch.rbT = 999;
      let t = 0;
      const pits0 = g.dispatch.pits, rams0 = g.dispatch.rams;
      while (t < 3600 && g.dispatch.pits + g.dispatch.rams - pits0 - rams0 < 2) {
        g.police.setMin(3);
        // Pull any far unit in behind the player so the chase starts quickly.
        for (const u of g.dispatch.units) if (Math.hypot(u.x - v.x, u.z - v.z) > 80) { u.x = v.x - Math.sin(v.yaw) * 25; u.z = v.z - Math.cos(v.yaw) * 25; u.yaw = v.yaw; u.speed = 10; }
        v.throttle = 0; v.speed = 9; v.steerIn = 0; v.x = lp.x;
        g.__steps(1); t++;
        if (v.z > 180) { v.z = -150; for (const u of g.dispatch.units) { u.x = v.x - Math.sin(v.yaw) * 25; u.z = v.z - 25; u.yaw = 0; } }
      }
      const out = { pits: g.dispatch.pits - pits0, rams: g.dispatch.rams - rams0, secs: +(t / 60).toFixed(1), hp: Math.round(v.hp), units: g.dispatch.units.length };
      v.speed = 0; p.exitCar();
      return out;
    });
    record('police: cruisers RAM/PIT the player car', ram.pits + ram.rams >= 1, ram);
    // Stars decay when out of sight, and not while seen.
    const decay = await G((home) => {
      const g = window.__game, p = g.player;
      if (p.vehicle) { p.vehicle.speed = 0; p.exitCar(); }
      g.police.clear(); g.dispatch.clearAll();
      p.teleport(home.x, home.z);
      g.flags.dispatchHold = true;
      g.police.setMin(2);
      // Seen: an officer with line of sight for 15 s keeps the stars.
      const cop = g.humans.spawn('cop', p.x + 6, p.z, { state: 'idle' });
      g.colliders.resolveCircle(cop, 0.5);
      cop.hp = 99999;
      const pHp = p.hp; p.hp = 1e9;
      g.__steps(900);
      const whileSeen = g.police.stars;
      g.humans.remove(cop);
      const t0 = g.time;
      let firstDrop = null;
      for (let i = 0; i < 4000 && g.police.stars > 0; i++) { g.__steps(1); if (firstDrop === null && g.police.stars < 2) firstDrop = +(g.time - t0).toFixed(1); }
      p.hp = pHp;
      g.flags.dispatchHold = false;
      return { whileSeen, firstDrop, end: g.police.stars, secs: +(g.time - t0).toFixed(1) };
    }, home);
    record('police: stars hold while seen, decay out of sight', decay.whileSeen === 2 && decay.end === 0, decay);
  }

  // ---------- 3. Crew + standing + ranks ----------
  if (want('crew')) {
    await reset(home.x, home.z);
    await G(() => { const g = window.__game; g.crew.members.forEach((a) => { a.alive = false; a.dead = true; }); g.crew.members = []; g.stats.money = 5000; g.crew.cd = { suppress: 0, heal: 0, getaway: 0 }; g.__crewSpent = 0; g.on('money', (m) => { if (m.reason === 'crew') g.__crewSpent -= m.n; }); g.__steps(2); });
    await tap('KeyC'); await tap('KeyC'); await tap('KeyC'); await wait(200);
    const c = await G(() => ({ n: window.__game.crew.members.length, spent: window.__game.__crewSpent }));
    record('crew: C recruits members ($250 each, up to 3)', c.n === 3 && c.spent === 750, { members: c.n, spent: c.spent });
    await tap('KeyX'); await wait(150);
    const sup = await G(() => window.__game.crew.suppressT);
    record('crew: X suppressive fire ability active', sup > 0, { suppressT: +sup.toFixed(2) });
    await G(() => { window.__game.player.hp = 40; });
    await tap('KeyH'); await wait(150);
    const hp = await G(() => window.__game.player.hp);
    record('crew: H heal ability restores health', hp >= 85, { hp });
    await tap('KeyG'); await wait(150);
    const ga = await G(() => {
      const g = window.__game, p = g.player, v = g.crew.getawayCar;
      if (!v) return { spawned: false };
      const d0 = Math.hypot(v.x - p.x, v.z - p.z);
      for (let i = 0; i < 1200 && v.driver; i++) g.step(1 / 60);
      return { spawned: true, startDist: +d0.toFixed(1), endDist: +Math.hypot(v.x - p.x, v.z - p.z).toFixed(1), parked: v.driver === null };
    });
    record('crew: G getaway driver brings a car to the player', ga.spawned && ga.parked && ga.endDist < 12 && ga.startDist > ga.endDist, ga);
    const fight = await G(() => {
      const g = window.__game, p = g.player;
      const foes = [];
      for (let i = 0; i < 3; i++) { const f = g.humans.spawn('gang', p.x + 10 + i, p.z + 2, { state: 'hostile' }); foes.push(f); }
      const hp0 = foes.reduce((s, f) => s + f.hp, 0);
      let crewKills = 0;
      g.on('actorKilled', (e) => { if (e.source === 'crew') crewKills++; });
      p.hp = 1e9;
      g.__steps(600);
      p.hp = 100;
      const hp1 = foes.reduce((s, f) => s + Math.max(0, f.hp), 0);
      return { foeHpBefore: hp0, foeHpAfter: hp1, crewKills };
    });
    record('crew: members shoot hostiles alongside the player', fight.foeHpAfter < fight.foeHpBefore && fight.crewKills >= 1, fight);
    const st = await G(() => {
      const g = window.__game, p = g.player;
      const di = g.missions && 0;
      void di;
      const idx = ['coral', 'strip', 'port', 'palm', 'beach'];
      const before = g.stats.standing.slice();
      const f = g.humans.spawn('gang', p.x + 3, p.z, { state: 'guard' });
      g.combat.damageActor(f, 9999, 'player');
      const after = g.stats.standing.slice();
      const changed = after.findIndex((v, i) => v !== before[i]);
      const hudText = document.querySelector('#district').textContent;
      const r0 = g.standing.rank().name;
      g.standing.addRespect(g.standing.nextRank().at - g.stats.respect + 1);
      const r1 = g.standing.rank().name;
      // Turf: push a district over 50 and collect income.
      const m0 = g.stats.money;
      g.standing.addStanding(1, 60 - g.stats.standing[1]);
      g.__steps(60 * 61);
      return { district: idx[changed], delta: after[changed] - before[changed], hudText, rankBefore: r0, rankAfter: r1, rankUps: g.__count.rankUp, turf: g.__count.turfTaken, income: g.stats.money - m0 };
    });
    record('standing: killing Ash Kings raises district standing (shown in HUD)', st.delta > 0 && /standing/.test(st.hudText), st);
    record('ranks: named respect ranks advance', st.rankAfter !== st.rankBefore || st.rankUps > 0, { before: st.rankBefore, after: st.rankAfter });
    record('standing: 50+ standing makes turf that pays income', st.turf >= 1 && st.income > 0, { turfEvents: st.turf, income: st.income });
    const mapShows = await G(() => { const g = window.__game; g.mapOpen = true; g.minimap.drawBig(); g.mapOpen = false; return true; });
    record('standing: city map renders district standing', mapShows, {});
  }

  // ---------- 4. Races + garage ----------
  if (want('races')) {
    await reset(home.x, home.z);
    const r = await G(() => {
      const g = window.__game, p = g.player, rs = g.races;
      const out = [];
      for (const race of rs.races) {
        if (g.missions.active) g.missions.failActive('audit');
        if (p.vehicle) { p.vehicle.speed = 0; p.exitCar(); }
        p.teleport(race.start.x + 3, race.start.z);
        const v = g.vehicleSys.spawn('sports', race.start.x, race.start.z, 0); v.hp = v.maxHp = 9999;
        p.enterNearest();
        rs.cooldown = 0;
        g.__steps(2);
        const started = !!rs.active && rs.active.race.id === race.id;
        if (!started) { out.push({ id: race.id, started }); continue; }
        const money0 = g.stats.money;
        g.__steps(200); // countdown + 0.3 s of racing
        const rivals0 = rs.active.rivals.map((q) => ({ x: q.car.x, z: q.car.z }));
        g.__steps(120);
        const rivalsMoved = rs.active.rivals.filter((q, i) => Math.hypot(q.car.x - rivals0[i].x, q.car.z - rivals0[i].z) > 5).length;
        const cps = race.cps.length;
        let hit = 0;
        for (let i = 0; i < cps && rs.active; i++) {
          const c = race.cps[rs.active.cp];
          v.x = c.x; v.z = c.z; v.speed = 0;
          g.__steps(2);
          hit++;
        }
        const res = rs.results[rs.results.length - 1];
        out.push({ id: race.id, started, cps, hit, rivalsMoved, place: res && res.place, prize: g.stats.money - money0, time: res && +res.time.toFixed(1) });
        p.vehicle && (p.vehicle.speed = 0);
        rs.cooldown = 0;
      }
      return out;
    });
    for (const q of r) record(`race "${q.id}": starts at marker, ${q.cps} checkpoints, 3 rivals race, timer, cash prize`, q.started && q.rivalsMoved === 3 && q.place === 1 && q.prize >= 1000 && q.time > 0, q);
    record('races: at least 2 street races work', r.filter((q) => q.place === 1 && q.prize > 0).length >= 2, { working: r.filter((q) => q.place === 1).length });
  }

  if (want('garage')) {
    await reset(home.x, home.z);
    await G(() => {
      const g = window.__game, p = g.player;
      g.garage.setLevels({ engine: 0, armor: 0, paint: 0 }); g.garage.dismissed = false;
      g.stats.money = 9000;
      const gp = { x: -36 + 72 * 5 - 288 - 5.5 + 0, z: 0 };
      void gp;
    });
    const gpos = await G(() => { const pl = window.__game.missions.list[3].place; return { x: pl.x, z: pl.z }; });
    await G((gp) => {
      const g = window.__game, p = g.player;
      p.teleport(gp.x + 3, gp.z);
      const v = g.vehicleSys.spawn('sedan', gp.x, gp.z, 0);
      p.enterNearest(); v.speed = 0;
      g.__steps(3);
      g.__garageCar = g.player.vehicle;
    }, gpos);
    await wait(400);
    const open = await G(() => window.__game.garage.open && !document.getElementById('garage').classList.contains('hidden'));
    const col0 = await G(() => window.__game.__garageCar.color);
    const m0 = await G(() => window.__game.stats.money);
    await tap('Digit1'); await tap('Digit2'); await tap('Digit3'); await wait(150);
    const after = await G(() => { const g = window.__game; return { lv: g.garage.levels(), money: g.stats.money, color: g.__garageCar.color, speed: g.garage.speedFactor(), armor: g.garage.armorFactor() }; });
    record('garage: opens when stopped at Chrome & Coral Customs', open, {});
    record('garage: engine + armor upgrades and respray bought with cash', after.lv.engine === 1 && after.lv.armor === 1 && after.color !== col0 && after.money < m0, { ...after, spent: m0 - after.money });
    const saved = await G(() => { const g = window.__game; g.save.write('audit'); const s = JSON.parse(localStorage.getItem('neonvela.save')); return s.garage; });
    record('garage: upgrades persisted in the save', saved.engine === 1 && saved.armor === 1 && saved.paint === after.lv.paint, saved);
    await G(() => { const g = window.__game; if (g.player.vehicle) { g.player.vehicle.speed = 0; g.player.exitCar(); } });
  }

  // ---------- 5. Weapons, wrecks, day/night, GPS ----------
  if (want('weapons')) {
    await reset(home.x, home.z, Math.PI);
    const w = await G(() => {
      const g = window.__game, p = g.player, out = [];
      g.combat.refill();
      for (let i = 0; i < g.combat.WEAPONS.length; i++) {
        const wpn = g.combat.WEAPONS[i];
        const fx = Math.sin(p.camYaw), fz = Math.cos(p.camYaw);
        const dummy = wpn.rocket ? g.vehicleSys.spawn('sedan', p.x + fx * 14, p.z + fz * 14, 0) : g.humans.spawn('gang', p.x + fx * (wpn.melee ? 1.2 : 6), p.z + fz * (wpn.melee ? 1.2 : 6), { state: 'guard', hp: 5000 });
        g.__steps(2);
        g.combat.select(i); g.combat.state.cd = 0; g.combat.state.reloadT = 0;
        p.yaw = p.camYaw;
        g.camera.position.set(p.x - fx * 4, 1.25, p.z - fz * 4); g.camera.lookAt(p.x + fx * 10, wpn.rocket ? 0.9 : 1.15, p.z + fz * 10);
        const hp0 = wpn.rocket ? dummy.hp : dummy.hp;
        const booms = g.__count.explosion;
        g.combat.fire();
        g.__steps(wpn.rocket ? 40 : 2);
        const dmg = wpn.rocket ? (dummy.wrecked || dummy.hp < hp0) : dummy.hp < hp0;
        out.push({ weapon: wpn.name, hit: dmg, explosion: wpn.rocket ? g.__count.explosion > booms : undefined });
        if (wpn.rocket) { if (!dummy.wrecked) g.vehicleSys.remove(dummy); } else g.humans.remove(dummy);
      }
      return out;
    });
    record(`weapons: ${w.length} weapons each fire and hit (${w.map((q) => q.weapon).join(', ')})`, w.length >= 5 && w.every((q) => q.hit), w);
  }

  if (want('wrecks')) {
    const wr = await G(() => {
      const g = window.__game, p = g.player;
      const v = g.vehicleSys.spawn('sedan', p.x + 20, p.z, 0);
      const f0 = g.__count.carOnFire, e0 = g.__count.explosion;
      g.vehicleSys.damage(v, v.maxHp * 0.8, 'world');
      const onFire = v.onFire;
      g.__steps(60 * 7);
      const exploded = v.wrecked && g.__count.explosion > e0;
      g.__steps(60 * 20);
      return { onFire, fireEvents: g.__count.carOnFire - f0, exploded, wreckStays: g.vehicles.includes(v), smoking: v.wrecked && v.removeAt - g.time > 100 };
    });
    record('wrecks: damaged cars catch fire, explode, and the wreck stays smoking', wr.onFire && wr.exploded && wr.wreckStays && wr.smoking, wr);
  }

  if (want('daynight')) {
    const dn = await G(() => {
      const g = window.__game;
      const h0 = g.hour, n0 = g.sky.night;
      g.flags.freezeClock = false;
      g.hour = 17.45; g.sky.update(g.hour, g.player);
      const dusk = { hour: g.hour, gold: +g.sky.gold.toFixed(2), night: +g.sky.night.toFixed(2) };
      g.__steps(60 * 60);
      const later = g.hour;
      g.hour = 22; g.sky.update(g.hour, g.player);
      const night = +g.sky.night.toFixed(2);
      g.hour = h0; g.sky.update(g.hour, g.player);
      return { startDefault: 17.45, dusk, hourAfter60s: +later.toFixed(3), nightAt22: night, n0 };
    });
    record('day/night: dusk default, clock advances, night falls', dn.dusk.gold > 0.3 && dn.hourAfter60s > 17.45 && dn.nightAt22 > 0.8, dn);
  }

  if (want('gps')) {
    const gps = await G(() => {
      const g = window.__game;
      g.gpsTarget = g.missions.target() || { x: 100, z: 100 };
      g.minimap.draw();
      return { points: g.minimap.lastRoute.length, length: Math.round(g.minimap.routeLen) };
    });
    record('minimap: GPS route line to the objective', gps.points >= 3 && gps.length > 0, gps);
  }

  // ---------- Save / load (reloads the page last) ----------
  if (want('save')) {
    const before = await G(() => {
      const g = window.__game;
      g.stats.money = 7777; g.stats.respect = 444; g.missions.done = ['m1', 'm2', 'm3'];
      g.stats.standing = g.stats.standing.map(() => 0);
      g.police.clear(); g.dispatch.clearAll(); g.player.hp = 1e9;
      g.garage.setLevels({ engine: 2, armor: 1, paint: 3 });
      const ok = g.save.write('audit');
      const c0 = g.save.count;
      g.__steps(60 * 31);
      return { ok, intervalSaves: g.save.count - c0, v: JSON.parse(localStorage.getItem('neonvela.save')).v };
    });
    await page.reload();
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    const label = await page.textContent('#btnPlay');
    await page.click('#btnPlay'); await wait(300);
    const loaded = await G(() => { const g = window.__game; return { status: g.saveStatus, money: g.stats.money, respect: g.stats.respect, done: g.missions.done.length, garage: g.garage.levels() }; });
    record('save: versioned autosave (interval) and Continue restores progress', before.ok && before.intervalSaves >= 1 && label === 'Continue' && loaded.status === 'loaded' && loaded.money === 7777 && loaded.done === 3 && loaded.garage.engine === 2, { before, label, loaded });
    await G(() => { window.__game.started = false; localStorage.setItem('neonvela.save', '{"v":3,"money":'); });
    await page.reload();
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    await page.click('#btnPlay'); await wait(300);
    const corrupt = await G(() => ({ status: window.__game.saveStatus, money: window.__game.stats.money, started: window.__game.started, kept: !!localStorage.getItem('neonvela.save.corrupt') }));
    record('save: corrupt save falls back to defaults without errors', corrupt.status === 'corrupt' && corrupt.money === 500 && corrupt.started, corrupt);
    await G(() => { localStorage.removeItem('neonvela.save'); localStorage.removeItem('neonvela.save.corrupt'); });
  }
}
