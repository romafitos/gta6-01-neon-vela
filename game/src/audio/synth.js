// All sound is synthesized with the Web Audio API: weapon shots, explosions, siren, engine,
// UI clicks and three radio stations. Nothing plays until the first user gesture unlocks audio.
export const STATIONS = [
  { name: 'Vela Wave 88.3', genre: 'synthwave', bpm: 104 },
  { name: 'Palm Bass 101.9', genre: 'street beats', bpm: 90 },
  { name: 'Coral Lounge 94.1', genre: 'chill', bpm: 78 },
];

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G

export function createAudio(game) {
  let ctx = null, master, sfxBus, radioBus, noiseBuf;
  let engine = null, siren = null;
  const radio = { station: 0, on: false, step: 0, nextT: 0, timer: null, gain: 0 };

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    radioBus = ctx.createGain(); radioBus.gain.value = 0; radioBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < data.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; data[i] = s / 0x3fffffff - 1; }
    radio.timer = setInterval(schedule, 40);
  }

  const ready = () => !!ctx && ctx.state === 'running';

  function noise(t, dur, freq, q, gain, dest = sfxBus, type = 'lowpass') {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
    return f;
  }

  function tone(t, freq, dur, type, gain, dest = sfxBus, slideTo = 0, attack = 0.005) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  const SHOTS = {
    pistol: () => { const t = ctx.currentTime; noise(t, 0.16, 2400, 0.8, 0.7); tone(t, 180, 0.09, 'square', 0.25, sfxBus, 60); },
    smg: () => { const t = ctx.currentTime; noise(t, 0.08, 3200, 1, 0.45); tone(t, 220, 0.05, 'square', 0.15, sfxBus, 90); },
    shotgun: () => { const t = ctx.currentTime; noise(t, 0.35, 1400, 0.6, 0.95); tone(t, 110, 0.2, 'sawtooth', 0.35, sfxBus, 40); },
    rifle: () => { const t = ctx.currentTime; noise(t, 0.2, 2800, 0.9, 0.75); tone(t, 260, 0.08, 'square', 0.22, sfxBus, 70); },
    launcher: () => { const t = ctx.currentTime; noise(t, 0.6, 700, 0.5, 0.6); tone(t, 90, 0.5, 'sawtooth', 0.25, sfxBus, 300); },
    fists: () => { const t = ctx.currentTime; noise(t, 0.08, 500, 1, 0.5); },
    npc: () => { const t = ctx.currentTime; noise(t, 0.12, 1800, 0.8, 0.25); },
  };

  function sfx(name, opt = {}) {
    if (!ready()) return;
    const t = ctx.currentTime;
    if (SHOTS[name]) return SHOTS[name]();
    switch (name) {
      case 'explosion': {
        const vol = opt.vol ?? 1;
        noise(t, 1.8, 900, 0.4, 1.1 * vol); noise(t, 0.5, 4000, 0.3, 0.5 * vol);
        tone(t, 70, 1.2, 'sine', 0.9 * vol, sfxBus, 28); break;
      }
      case 'crash': noise(t, 0.4, 600, 0.7, 0.7); tone(t, 90, 0.25, 'triangle', 0.4, sfxBus, 40); break;
      case 'click': tone(t, 880, 0.06, 'square', 0.12); break;
      case 'select': tone(t, 660, 0.07, 'triangle', 0.18); tone(t + 0.06, 990, 0.09, 'triangle', 0.18); break;
      case 'hurt': tone(t, 300, 0.15, 'sawtooth', 0.15, sfxBus, 120); break;
      case 'money': [988, 1319, 1568].forEach((f, i) => tone(t + i * 0.07, f, 0.18, 'square', 0.12)); break;
      case 'mission': [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.12, f, 0.4, 'triangle', 0.22)); break;
      case 'fail': [392, 330, 262].forEach((f, i) => tone(t + i * 0.16, f, 0.4, 'sawtooth', 0.15)); break;
      case 'checkpoint': tone(t, 1200, 0.12, 'square', 0.15); tone(t + 0.08, 1600, 0.16, 'square', 0.15); break;
      case 'door': noise(t, 0.12, 900, 2, 0.4); break;
      case 'heli': noise(t, 0.6, 180, 2, 0.15); break;
      default: tone(t, 440, 0.1, 'sine', 0.1);
    }
  }

  // Continuous engine hum tied to speed.
  function setEngine(on, speed = 0, maxSpeed = 40) {
    if (!ready()) return;
    if (on && !engine) {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'square';
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
      const g = ctx.createGain(); g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(sfxBus);
      o1.start(); o2.start();
      engine = { o1, o2, f, g };
    }
    if (!on && engine) {
      const e = engine; engine = null;
      e.g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      e.o1.stop(ctx.currentTime + 0.5); e.o2.stop(ctx.currentTime + 0.5);
      return;
    }
    if (engine) {
      const r = Math.min(1, Math.abs(speed) / maxSpeed);
      const gear = (r * 4) % 1;
      const f0 = 38 + r * 70 + gear * 45;
      engine.o1.frequency.setTargetAtTime(f0, ctx.currentTime, 0.05);
      engine.o2.frequency.setTargetAtTime(f0 * 0.5, ctx.currentTime, 0.05);
      engine.f.frequency.setTargetAtTime(400 + r * 1600, ctx.currentTime, 0.05);
      engine.g.gain.setTargetAtTime(0.06 + r * 0.08, ctx.currentTime, 0.08);
    }
  }

  // Two-tone police siren whose volume follows the nearest police unit.
  function setSiren(level) {
    if (!ready()) return;
    if (level > 0.01 && !siren) {
      const o = ctx.createOscillator(); o.type = 'square';
      const lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 0.9;
      const lg = ctx.createGain(); lg.gain.value = 280;
      lfo.connect(lg); lg.connect(o.frequency); o.frequency.value = 960;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(sfxBus);
      o.start(); lfo.start();
      siren = { o, lfo, g };
    }
    if (siren) {
      siren.g.gain.setTargetAtTime(Math.min(0.09, level * 0.09), ctx.currentTime, 0.2);
      if (level <= 0.01) {
        const s = siren; siren = null;
        s.g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        s.o.stop(ctx.currentTime + 0.6); s.lfo.stop(ctx.currentTime + 0.6);
      }
    }
  }

  // --- Radio: a 16th-note sequencer per station ---
  function playStep(st, step, t) {
    const spb = 60 / STATIONS[st].bpm / 4;
    const bar = Math.floor(step / 16) % 4, s = step % 16;
    const chord = PROG[bar];
    const dest = radioBus;
    if (st === 0) {
      if (s % 4 === 0) { tone(t, 120, 0.25, 'sine', 0.5, dest, 45); }
      if (s === 4 || s === 12) noise(t, 0.18, 1800, 0.7, 0.3, dest, 'bandpass');
      if (s % 2 === 1) noise(t, 0.04, 8000, 1, 0.08, dest, 'highpass');
      tone(t, NOTE(chord[0] - 24), spb * 0.9, 'sawtooth', 0.12, dest);
      const arp = chord[[0, 1, 2, 1][s % 4]] + (s >= 8 ? 12 : 0);
      tone(t, NOTE(arp), spb * 0.8, 'square', 0.05, dest);
      if (s === 0) chord.forEach((n) => tone(t, NOTE(n), spb * 15, 'sawtooth', 0.025, dest, 0, 0.3));
    } else if (st === 1) {
      if (s === 0 || s === 7 || s === 10) tone(t, 95, 0.35, 'sine', 0.6, dest, 38);
      if (s === 4 || s === 12) noise(t, 0.2, 2200, 0.6, 0.35, dest, 'bandpass');
      if (s % 2 === 0) noise(t, 0.03, 9000, 1, 0.07, dest, 'highpass');
      if (s === 0 || s === 10) tone(t, NOTE(chord[0] - 24), spb * 5, 'sine', 0.3, dest);
      if (s === 2 || s === 14) chord.forEach((n) => tone(t, NOTE(n), spb * 1.5, 'triangle', 0.05, dest));
    } else {
      if (s === 0) chord.forEach((n) => tone(t, NOTE(n), spb * 16, 'sawtooth', 0.02, dest, 0, 0.8));
      if (s === 0 || s === 8) tone(t, NOTE(chord[0] - 12), spb * 7, 'sine', 0.18, dest, 0, 0.05);
      if (s === 6 || s === 14) noise(t, 0.05, 3000, 2, 0.1, dest, 'bandpass');
      if (s % 3 === 0) tone(t, NOTE(chord[(s / 3) % 3] + 12), spb * 2.5, 'sine', 0.05, dest, 0, 0.02);
    }
  }

  function schedule() {
    if (!ctx || ctx.state !== 'running') return;
    const target = radio.on ? 0.55 : 0;
    radio.gain += (target - radio.gain) * 0.2;
    radioBus.gain.setTargetAtTime(target, ctx.currentTime, 0.3);
    if (!radio.on) { radio.nextT = 0; return; }
    if (radio.nextT < ctx.currentTime) radio.nextT = ctx.currentTime + 0.05;
    while (radio.nextT < ctx.currentTime + 0.18) {
      playStep(radio.station, radio.step, radio.nextT);
      radio.step++;
      radio.nextT += 60 / STATIONS[radio.station].bpm / 4;
    }
  }

  function setRadio(on) { radio.on = on && radio.station >= 0; }
  function nextStation() {
    radio.station = (radio.station + 1) % (STATIONS.length + 1);
    if (radio.station === STATIONS.length) { radio.station = -1; radio.on = false; }
    else radio.on = true;
    radio.step = 0;
    if (radio.station < 0) radio.station = -1;
    return radio.station >= 0 ? STATIONS[radio.station] : null;
  }
  function stationName() { return radio.station >= 0 ? STATIONS[radio.station].name : 'Radio Off'; }

  return { unlock, ready, sfx, setEngine, setSiren, setRadio, nextStation, stationName, radio, get ctx() { return ctx; } };
}
