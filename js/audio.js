'use strict';
/* Quaver · audio.js
   Instrument sounds (synthesized, or recorded samples on request), playback with repeats,
   tempo changes, swing, metronome, looping and a per-part mixer, plus WAV rendering. */

let audio = null, master = null, DEST = null, playing = false, timers = [], voices = [];
const isOffline = (a) => !!(window.OfflineAudioContext && a instanceof OfflineAudioContext);
function makeMaster(a) {
  const m = a.createGain(); m.gain.value = 0.62;
  const comp = a.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 8; comp.knee.value = 6; comp.attack.value = 0.002; comp.release.value = 0.15;
  m.connect(comp); comp.connect(a.destination); return m;
}
function ctx() {
  if (!audio) { audio = new (window.AudioContext || window.webkitAudioContext)(); master = makeMaster(audio); }
  if (!isOffline(audio) && audio.state === 'suspended') audio.resume();
  return audio;
}
let waves = {};
function wave(name, harm) { if (!waves[name]) waves[name] = ctx().createPeriodicWave(new Float32Array(harm.length), Float32Array.from(harm)); return waves[name]; }
let noiseBuf = null;
function noise() { if (!noiseBuf) { const a = ctx(); noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } return noiseBuf; }
const ksCache = {};
function ksBuffer(key, f, decay, bright) {
  if (ksCache[key]) return ksCache[key];
  const a = ctx(), sr = a.sampleRate, len = Math.floor(sr * 3.2), Nn = Math.max(2, Math.round(sr / f)), buf = a.createBuffer(1, len, sr), out = buf.getChannelData(0);
  const ring = new Float32Array(Nn); let prev = 0;
  for (let i = 0; i < Nn; i++) { const r = Math.random() * 2 - 1; prev += bright * (r - prev); ring[i] = prev; }
  let idx = 0;
  for (let i = 0; i < len; i++) { const nx = (idx + 1) % Nn; out[i] = ring[idx]; ring[idx] = decay * 0.5 * (ring[idx] + ring[nx]); idx = nx; }
  return (ksCache[key] = buf);
}
function env(g, t, dur, peak, att, endFrac, rel) {
  const hold = Math.max(att + 0.01, dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + att);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * endFrac), t + hold);
  g.gain.linearRampToValueAtTime(0.0001, t + hold + rel);
  return t + hold + rel + 0.05;
}
function osc(a, type, f, t, end, dest, detune) { const o = a.createOscillator(); if (type instanceof PeriodicWave) o.setPeriodicWave(type); else o.type = type; o.frequency.value = f; if (detune) o.detune.value = detune; o.connect(dest); o.start(t); o.stop(end); voices.push(o); return o; }
function vibrato(a, o, f, depth, rate, end) { const t = o._t || a.currentTime; const l = a.createOscillator(), lg = a.createGain(); l.frequency.value = rate; lg.gain.value = f * depth; l.connect(lg); lg.connect(o.frequency); l.start(); l.stop(end); voices.push(l); void t; }
function filt(a, type, f, q) { const b = a.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
function gainTo(a, dest) { const g = a.createGain(); g.connect(dest || DEST); return g; }
function struck(a, f, t, d, v, partials, ring, dest) {
  const g = gainTo(a, dest), dd = Math.max(d, ring || 0);
  partials.forEach(([r, amp, dec]) => { if (f * r > 16000) return; const pg = a.createGain(); pg.connect(g); const e = env(pg, t, dd, v * amp, 0.002, Math.exp(-dd / dec), 0.1); osc(a, 'sine', f * r, t, e, pg); });
}
function noiseHit(a, t, dec, v, type, freq, q) {
  const n = a.createBufferSource(), f = filt(a, type, freq, q), g = a.createGain(); n.buffer = noise();
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dec);
  n.connect(f); f.connect(g); g.connect(DEST); n.start(t); n.stop(t + dec + 0.02); voices.push(n);
}
function sweep(a, t, f0, f1, sw, dec, v, type = 'sine') {
  const o = a.createOscillator(), g = a.createGain(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + sw);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dec);
  o.connect(g); g.connect(DEST); o.start(t); o.stop(t + dec + 0.02); voices.push(o);
}
function breath(a, t, end, f, v, dest) { const n = a.createBufferSource(), bp = filt(a, 'bandpass', f, 1.5), g = a.createGain(); n.buffer = noise(); n.loop = true; g.gain.value = v; n.connect(bp); bp.connect(g); g.connect(dest); n.start(t); n.stop(end); voices.push(n); }
function bowed(a, f, t, d, v, att, vibRate, bright) {
  const g = gainTo(a), lp = filt(a, 'lowpass', Math.min(5000, f * (4 + 5 * bright)), 0.8); lp.connect(g);
  const end = env(g, t, d, v * 0.55, att, 0.85, 0.12);
  const o1 = osc(a, 'sawtooth', f, t, end, lp), o2 = osc(a, 'sawtooth', f, t, end, lp, 7); vibrato(a, o1, f, 0.005, vibRate, end); vibrato(a, o2, f, 0.005, vibRate, end);
}
function sax(a, f, t, d, v, formant, bright) {
  const g = gainTo(a), pk = filt(a, 'peaking', formant, 2), lp = filt(a, 'lowpass', Math.min(7000, f * bright), 1.2); pk.gain.value = 9; pk.connect(lp); lp.connect(g);
  const end = env(g, t, d, v * 0.45, 0.035, 0.88, 0.08), sq = a.createGain(); sq.gain.value = 0.35; sq.connect(pk);
  const o1 = osc(a, 'sawtooth', f, t, end, pk), o2 = osc(a, 'square', f, t, end, sq, 4);
  vibrato(a, o1, f, 0.006, 5.2, end); vibrato(a, o2, f, 0.006, 5.2, end); breath(a, t, end, formant * 1.6, v * 0.05, g);
}
function brass(a, f, t, d, v, att, c0, c1) {
  const g = gainTo(a), lp = filt(a, 'lowpass', f * c0, 1.5);
  lp.frequency.setValueAtTime(f * c0, t); lp.frequency.linearRampToValueAtTime(Math.min(6000, f * c1), t + att * 2); lp.connect(g);
  const end = env(g, t, d, v * 0.75, att, 0.85, 0.09), o = osc(a, 'sawtooth', f, t, end, lp); vibrato(a, o, f, 0.002, 5, end); return end;
}
function formantVoice(a, f, t, d, v, forms, n, att) {
  const g = gainTo(a), src = a.createGain(); const end = env(g, t, d, v, att, 0.9, 0.2);
  for (let k = 0; k < n; k++) { const o = osc(a, 'sawtooth', f, t, end, src, (k - (n - 1) / 2) * 8); vibrato(a, o, f, 0.007, 4.8 + k * 0.4, end); }
  forms.forEach(([fr, gn, q]) => { const bp = filt(a, 'bandpass', fr, q), bg = a.createGain(); bg.gain.value = gn; src.connect(bp); bp.connect(bg); bg.connect(g); });
}
const driveCurves = {};
function driveCurve(k) {   // soft clipping, like a slightly overdriven amp
  if (!driveCurves[k]) { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); } driveCurves[k] = c; }
  return driveCurves[k];
}
function pluck(a, key, f, t, d, v, decay, bright, endFrac, rel, lpf) {
  const s = a.createBufferSource(); s.buffer = ksBuffer(key, f, decay, bright); const g = gainTo(a);
  if (lpf) { const lp = filt(a, 'lowpass', lpf); s.connect(lp); lp.connect(g); } else s.connect(g);
  const end = env(g, t, d, v, 0.002, endFrac, rel); s.start(t); s.stop(end); voices.push(s);
}
const SYN = {
  piano(a, f, t, d, v, midi) {
    const g = gainTo(a), tau = 2.6 * (1 - (midi - 21) / 120) + 0.35, end = env(g, t, d, v, 0.004, Math.exp(-d / tau), 0.14);
    osc(a, wave('piano', [0, 1, 0.55, 0.32, 0.2, 0.12, 0.07, 0.05, 0.03]), f, t, end, g); osc(a, 'sine', f * 1.002, t, end, g, 3);
    noiseHit(a, t, 0.05, v * 0.15, 'bandpass', Math.min(4000, f * 3), 1);
  },
  epiano(a, f, t, d, v) {
    const g = gainTo(a), end = env(g, t, d, v, 0.003, Math.exp(-d / 1.6), 0.2), car = osc(a, 'sine', f, t, end, g), m = a.createOscillator(), mg = a.createGain();
    m.frequency.value = f; mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.15, t + 0.4); m.connect(mg); mg.connect(car.frequency); m.start(t); m.stop(end); voices.push(m);
  },
  harpsichord(a, f, t, d, v, midi) { pluck(a, 'hc' + midi, f, t, d, v * 0.9, 0.995, 0.95, 0.45, 0.06); },
  organ(a, f, t, d, v) { const g = gainTo(a), end = env(g, t, d, v * 0.9, 0.015, 1, 0.07); osc(a, wave('organ', [0, 1, 0.7, 0.45, 0.35, 0.2, 0.1, 0.05, 0.1]), f, t, end, g); osc(a, 'sine', f * 0.5, t, end, g); },
  accordion(a, f, t, d, v) { const g = gainTo(a), lp = filt(a, 'lowpass', Math.min(5000, f * 8), 0.7); lp.connect(g); const end = env(g, t, d, v * 0.55, 0.04, 0.95, 0.06), w = wave('reed', [0, 1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1]); osc(a, w, f, t, end, lp, -7); osc(a, w, f, t, end, lp, 7); },
  celesta(a, f, t, d, v) { struck(a, f, t, d, v * 1.1, [[1, 1, 0.9], [2, 0.35, 0.4], [3, 0.1, 0.2]], 0.8); },
  violin(a, f, t, d, v) { bowed(a, f, t, d, v, 0.09, 6.5, 0.7); },
  viola(a, f, t, d, v) { bowed(a, f, t, d, v, 0.1, 5.8, 0.72); },
  cello(a, f, t, d, v) { bowed(a, f, t, d, v, 0.14, 4.5, 0.8); },
  dbass(a, f, t, d, v) { bowed(a, f, t, d, v * 1.3, 0.15, 4.5, 0.45); },
  ensemble(a, f, t, d, v) { const g = gainTo(a), lp = filt(a, 'lowpass', Math.min(4500, f * 6), 0.5); lp.connect(g); const end = env(g, t, d, v * 0.3, 0.22, 0.9, 0.3); [-12, -5, 0, 5, 12].forEach((dt) => { const o = osc(a, 'sawtooth', f, t, end, lp, dt); vibrato(a, o, f, 0.003, 5 + dt / 10, end); }); },
  guitar(a, f, t, d, v, midi) { pluck(a, 'g' + midi, f, t, d, v * 1.2, 0.9965, 0.6, 0.35, 0.12); },
  /* electric: brighter pick attack, longer sustain, pickup "presence" boost and a little amp drive */
  eguitar(a, f, t, d, v, midi) {
    const s = a.createBufferSource(); s.buffer = ksBuffer('eg' + midi, f, 0.9985, 0.92);
    const hp = filt(a, 'highpass', 110, 0.7), pk = filt(a, 'peaking', 2400, 1.2), ws = a.createWaveShaper(), lp = filt(a, 'lowpass', 5200, 0.8), g = gainTo(a);
    pk.gain.value = 5; ws.curve = driveCurve(2.4); ws.oversample = '2x';
    s.connect(hp); hp.connect(pk); pk.connect(ws); ws.connect(lp); lp.connect(g);
    const end = env(g, t, d, v * 0.85, 0.003, 0.6, 0.12); s.start(t); s.stop(end); voices.push(s);
  },
  harp(a, f, t, d, v, midi) { pluck(a, 'h' + midi, f, t, Math.max(d, 0.9), v * 1.1, 0.9985, 0.35, 0.5, 0.5); },
  bass(a, f, t, d, v, midi) { pluck(a, 'b' + midi, f, t, d, v * 1.6, 0.997, 0.25, 0.4, 0.1, 900); },
  /* electric: brighter finger pluck, mid "growl" from the pickup, light drive, a sine underneath for punch, longer sustain */
  ebass(a, f, t, d, v, midi) {
    const s = a.createBufferSource(); s.buffer = ksBuffer('eb' + midi, f, 0.9988, 0.55);
    const hp = filt(a, 'highpass', 38, 0.7), pk = filt(a, 'peaking', 750, 1.4), ws = a.createWaveShaper(), lp = filt(a, 'lowpass', 2600, 0.9), g = gainTo(a);
    pk.gain.value = 6; ws.curve = driveCurve(1.6); ws.oversample = '2x';
    s.connect(hp); hp.connect(pk); pk.connect(ws); ws.connect(lp); lp.connect(g);
    const end = env(g, t, d, v * 1.5, 0.004, 0.55, 0.09); s.start(t); s.stop(end); voices.push(s);
    const sg = gainTo(a); env(sg, t, d, v * 0.5, 0.006, 0.5, 0.09); osc(a, 'sine', f, t, end, sg);
  },
  flute(a, f, t, d, v) { const g = gainTo(a), end = env(g, t, d, v * 0.9, 0.07, 0.9, 0.09); const o = osc(a, wave('flute', [0, 1, 0.22, 0.08, 0.03]), f, t, end, g); vibrato(a, o, f, 0.004, 5, end); breath(a, t, end, f * 2.5, v * 0.12, g); },
  oboe(a, f, t, d, v) { const g = gainTo(a), pk = filt(a, 'peaking', 1400, 3), lp = filt(a, 'lowpass', Math.min(6000, f * 9), 1); pk.gain.value = 12; pk.connect(lp); lp.connect(g); const end = env(g, t, d, v * 0.35, 0.04, 0.9, 0.06); const o = osc(a, 'sawtooth', f, t, end, pk); vibrato(a, o, f, 0.004, 5.5, end); },
  clarinet(a, f, t, d, v) { const g = gainTo(a), lp = filt(a, 'lowpass', Math.min(3200, f * 7)); lp.connect(g); const end = env(g, t, d, v * 0.8, 0.04, 0.92, 0.07); const o = osc(a, wave('clar', [0, 1, 0, 0.55, 0, 0.3, 0, 0.16, 0, 0.08]), f, t, end, lp); vibrato(a, o, f, 0.002, 5, end); },
  bassclar(a, f, t, d, v) { const g = gainTo(a), lp = filt(a, 'lowpass', Math.min(2000, f * 5)); lp.connect(g); const end = env(g, t, d, v * 0.9, 0.05, 0.92, 0.08); osc(a, wave('clar', [0, 1, 0, 0.55, 0, 0.3, 0, 0.16, 0, 0.08]), f, t, end, lp); breath(a, t, end, 900, v * 0.03, g); },
  bassoon(a, f, t, d, v) { const g = gainTo(a), pk = filt(a, 'peaking', 500, 2.5), lp = filt(a, 'lowpass', Math.min(3000, f * 5), 1); pk.gain.value = 10; pk.connect(lp); lp.connect(g); const end = env(g, t, d, v * 0.5, 0.05, 0.9, 0.07); const o = osc(a, 'sawtooth', f, t, end, pk); vibrato(a, o, f, 0.003, 5, end); },
  altosax(a, f, t, d, v) { sax(a, f, t, d, v, 1100, 8); },
  tenorsax(a, f, t, d, v) { sax(a, f, t, d, v, 800, 7); },
  barisax(a, f, t, d, v) { sax(a, f, t, d, v * 1.2, 520, 6); },
  trumpet(a, f, t, d, v) { brass(a, f, t, d, v, 0.035, 2, 7); },
  horn(a, f, t, d, v) { brass(a, f, t, d, v * 0.9, 0.07, 2.2, 3.2); },
  trombone(a, f, t, d, v) { brass(a, f, t, d, v, 0.05, 3, 5.5); },
  tuba(a, f, t, d, v) { const end = brass(a, f, t, d, v, 0.06, 2.2, 3.5); const g = gainTo(a); env(g, t, d, v * 0.4, 0.06, 0.9, 0.09); osc(a, 'sine', f, t, end, g); },
  voice(a, f, t, d, v) { formantVoice(a, f, t, d, v * 0.9, [[800, 1, 9], [1150, 0.5, 10], [2900, 0.22, 12]], 1, 0.08); },
  lowvoice(a, f, t, d, v) { formantVoice(a, f, t, d, v * 0.9, [[600, 1, 8], [1040, 0.45, 10], [2250, 0.15, 12]], 1, 0.08); },
  choir(a, f, t, d, v) { formantVoice(a, f, t, d, v * 0.5, [[400, 1, 6], [800, 0.45, 8], [2600, 0.12, 10]], 3, 0.18); },
  marimba(a, f, t, d, v) { struck(a, f, t, d, v * 1.3, [[1, 1, 0.3], [4, 0.18, 0.05]], 0.4); },
  xylophone(a, f, t, d, v) { struck(a, f, t, d, v * 1.2, [[1, 1, 0.18], [3, 0.25, 0.06], [6, 0.06, 0.03]], 0.3); },
  glockenspiel(a, f, t, d, v) { struck(a, f, t, d, v, [[1, 1, 1.4], [2.76, 0.3, 0.5], [5.4, 0.12, 0.25]], 1.2); },
  vibraphone(a, f, t, d, v) {
    const tg = gainTo(a), l = a.createOscillator(), lg = a.createGain(); tg.gain.value = 0.7; lg.gain.value = 0.3; l.frequency.value = 5.5;
    l.connect(lg); lg.connect(tg.gain); l.start(t); l.stop(t + Math.max(d, 1.5) + 0.3); voices.push(l);
    struck(a, f, t, d, v, [[1, 1, 2.5], [4, 0.15, 0.6]], 1.5, tg);
  },
  tubularbells(a, f, t, d, v) { struck(a, f, t, d, v * 0.8, [[0.5, 0.3, 2], [1, 1, 3], [1.19, 0.4, 2], [1.56, 0.35, 1.5], [2, 0.5, 1.5], [2.5, 0.25, 1], [3, 0.2, 0.8]], 2.5); },
  timpani(a, f, t, d, v) { struck(a, f, t, d, v * 1.2, [[1, 1, 1.2], [1.5, 0.5, 0.8], [2, 0.35, 0.6], [2.5, 0.15, 0.4]], 1.2); noiseHit(a, t, 0.08, v * 0.3, 'lowpass', 300, 1); },
  steeldrum(a, f, t, d, v) { struck(a, f, t, d, v, [[1, 1, 0.7], [2, 0.7, 0.4], [3, 0.25, 0.25], [4, 0.1, 0.15]], 0.6); },
  synthlead(a, f, t, d, v) { const g = gainTo(a), lp = filt(a, 'lowpass', Math.min(8000, f * 10), 4); lp.connect(g); const end = env(g, t, d, v * 0.35, 0.01, 0.9, 0.08); const o = osc(a, 'square', f, t, end, lp); osc(a, 'sawtooth', f, t, end, lp, 8); vibrato(a, o, f, 0.004, 5.5, end); },
  synthpad(a, f, t, d, v) { const g = gainTo(a), lp = filt(a, 'lowpass', Math.min(3000, f * 4), 1); lp.connect(g); const end = env(g, t, d, v * 0.3, 0.4, 0.95, 0.5); [-10, 0, 10].forEach((dt) => osc(a, 'sawtooth', f, t, end, lp, dt)); },
  synthbass(a, f, t, d, v) {
    const g = gainTo(a), lp = filt(a, 'lowpass', f * 12, 6); lp.frequency.setValueAtTime(f * 12, t); lp.frequency.exponentialRampToValueAtTime(f * 3, t + 0.15); lp.connect(g);
    const end = env(g, t, d, v * 0.6, 0.005, 0.7, 0.06); osc(a, 'square', f, t, end, lp); osc(a, 'sawtooth', f, t, end, lp, 6);
  }
};
function drumHit(inst, id, t, v) {
  const a = ctx(), kind = kitInfo(inst, id)[1];
  const F = { tomH: 220, tomM: 170, tomF: 110, tomF2: 88, congaH: 330, congaL: 230, bongo: 420, bongoL: 330 };
  switch (kind) {
    case 'kick': sweep(a, t, 160, 45, 0.12, 0.4, v * 1.6); noiseHit(a, t, 0.02, v * 0.3, 'lowpass', 2000, 0.7); break;
    case 'snare': noiseHit(a, t, 0.2, v * 0.9, 'highpass', 1200, 0.7); sweep(a, t, 240, 180, 0.03, 0.1, v * 0.7, 'triangle'); break;
    case 'tomH': case 'tomM': case 'tomF': case 'tomF2': sweep(a, t, F[kind] * 1.5, F[kind], 0.06, 0.45, v * 1.1); noiseHit(a, t, 0.03, v * 0.2, 'bandpass', 1500, 1); break;
    case 'hhc': noiseHit(a, t, 0.05, v * 0.5, 'highpass', 7500, 0.7); break;
    case 'hho': noiseHit(a, t, 0.45, v * 0.4, 'highpass', 7000, 0.7); break;
    case 'hhp': noiseHit(a, t, 0.035, v * 0.35, 'highpass', 6000, 0.7); break;
    case 'ride': noiseHit(a, t, 1.1, v * 0.22, 'highpass', 5500, 0.7); [1, 1.48, 2.13].forEach((r) => sweep(a, t, 520 * r, 520 * r, 0.01, 0.9, v * 0.04, 'square')); break;
    case 'crash': noiseHit(a, t, 1.6, v * 0.45, 'highpass', 3500, 0.5); break;
    case 'rim': noiseHit(a, t, 0.03, v * 0.6, 'bandpass', 1800, 4); sweep(a, t, 850, 800, 0.01, 0.04, v * 0.5); break;
    case 'clap': [0, 0.012, 0.024].forEach((dd) => noiseHit(a, t + dd, 0.03, v * 0.6, 'bandpass', 1200, 1.5)); noiseHit(a, t + 0.03, 0.18, v * 0.35, 'bandpass', 1200, 1.5); break;
    case 'congaH': case 'congaL': case 'bongo': case 'bongoL': sweep(a, t, F[kind] * 1.25, F[kind], 0.025, kind[0] === 'b' ? 0.16 : 0.28, v * 1.1); break;
    case 'woodblock': sweep(a, t, 1000, 950, 0.01, 0.07, v * 0.9); noiseHit(a, t, 0.02, v * 0.2, 'bandpass', 2000, 3); break;
    case 'claves': sweep(a, t, 2500, 2500, 0.01, 0.06, v * 0.8); break;
    case 'cowbell': { const g = a.createGain(), bp = filt(a, 'bandpass', 800, 3); g.gain.setValueAtTime(v * 0.5, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.35); bp.connect(g); g.connect(DEST); osc(a, 'square', 540, t, t + 0.36, bp); osc(a, 'square', 800, t, t + 0.36, bp); break; }
    case 'tamb': noiseHit(a, t, 0.25, v * 0.4, 'highpass', 6500, 0.7); [0.02, 0.05].forEach((dd) => noiseHit(a, t + dd, 0.08, v * 0.25, 'highpass', 7000, 0.7)); break;
    case 'shaker': noiseHit(a, t, 0.12, v * 0.35, 'highpass', 5000, 0.7); break;
    case 'triangle': [1, 2.76, 5.4].forEach((r, k) => sweep(a, t, 1250 * r, 1250 * r, 0.01, 1.6 - k * 0.4, v * (0.25 / (k + 1)))); break;
    default: noiseHit(a, t, 0.15, v * 0.6, 'highpass', 1500, 0.7);
  }
}

/* ---------- recorded samples (General MIDI sound set, downloaded on request) ---------- */
const SF_BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/';
const SF_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const sfMaps = {}, sfBufs = {}, sfFailed = {};
const sfKey = (m) => SF_NAMES[mod(m, 12)] + (Math.floor(m / 12) - 1);
function loadSoundfont(name) {
  if (!sfMaps[name]) {
    sfMaps[name] = fetch(SF_BASE + name + '-mp3.js').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then((t) => { const map = {}; t.replace(/"([A-G]b?-?\d)":\s*"(data:audio\/mp3;base64,[^"]+)"/g, (m0, k, v) => { map[k] = v; return ''; }); return map; });
  }
  return sfMaps[name];
}
async function loadSamples(pairs, onProgress) {
  let done = 0, failed = 0;
  for (const [inst, m] of pairs) {
    const name = INSTR[inst].sf, key = name + ':' + m;
    if (!name || sfBufs[key] || sfFailed[name]) { done++; continue; }
    try {
      const map = await loadSoundfont(name), uri = map[sfKey(m)];
      if (uri) { const ab = await (await fetch(uri)).arrayBuffer(); sfBufs[key] = await new Promise((res, rej) => ctx().decodeAudioData(ab, res, rej)); }
    } catch (e) { sfFailed[name] = true; failed++; }
    done++; if (onProgress) onProgress(done, pairs.length);
  }
  return failed;
}
async function preloadForScore() {
  const pairs = new Map();
  S.parts.forEach((part, p) => {
    if (isKit(p) || !INSTR[part.inst].sf) return;
    part.notes.forEach((n) => { if (n.type === 'note') midisOf(n).forEach((m) => { [m, m + 1, m + 2].forEach((x) => pairs.set(part.inst + ':' + x, [part.inst, x])); }); });
  });
  const list = [...pairs.values()]; if (!list.length) return 0;
  const missing = list.filter(([inst, m]) => !sfBufs[INSTR[inst].sf + ':' + m] && !sfFailed[INSTR[inst].sf]);
  if (missing.length) toast(`Loading recorded sounds… (${missing.length} notes)`);
  const failed = await loadSamples(missing);
  if (failed) toast('Some recordings could not be downloaded, so those instruments use built-in sounds.');
  return failed;
}
function sampleTone(inst, midi, t, d, v) {
  const buf = sfBufs[INSTR[inst].sf + ':' + midi]; if (!buf) return false;
  const a = ctx(), s = a.createBufferSource(), g = gainTo(a); s.buffer = buf; s.connect(g);
  g.gain.setValueAtTime(v * 1.3, t); g.gain.setValueAtTime(v * 1.3, t + d); g.gain.linearRampToValueAtTime(0.0001, t + d + 0.25);
  s.start(t); s.stop(t + d + 0.3); voices.push(s); return true;
}

function tone(inst, midi, t, dur, vel, dest) {
  const a = ctx(), I = INSTR[inst] || INSTR.piano; DEST = dest || master;
  if (I.kit) { drumHit(inst, midi, t, vel * I.gain); return; }
  if (prefs.real && sampleTone(inst, midi, t, Math.max(0.06, dur), vel)) return;
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  (SYN[I.syn || inst] || SYN.piano)(a, f, t, Math.max(0.06, dur), vel * I.gain, midi);
}
function clickAt(t, accent) { const a = ctx(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = accent ? 1500 : 1000; g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04); o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.05); voices.push(o); }

/* ---------- playback plan ---------- */
function levels(notes) {
  const out = new Array(notes.length); let cur = DYN_LEVEL.mf;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]; if (n.dyn) cur = DYN_LEVEL[n.dyn];
    if (n.hp) {
      let j = i + 1; while (j < notes.length && !(notes[j].dyn || notes[j].hp)) j++;
      const target = j < notes.length && notes[j].dyn ? DYN_LEVEL[notes[j].dyn] : (n.hp === 'cresc' ? Math.min(0.9, cur * 1.7) : cur * 0.55), start = cur;
      for (let k = i; k < j; k++) out[k] = start + (target - start) * (k - i) / (j - i);
      cur = target; i = j - 1; continue;
    }
    out[i] = cur;
  }
  return out;
}
const sameSounds = (p, a, b) => { const x = soundsOf(p, a).slice().sort().join(','), y = soundsOf(p, b).slice().sort().join(','); return x === y; };
function playBars() { return Math.max(1, ...S.parts.map((p) => splitMeasures(p.notes).filter((m) => m.items.length).length)); }
function playOrder(nBars) {
  const order = []; let k = 0, pass = 1, repStart = 0, lastEnding = false, guard = 0; const done = {};
  while (k < nBars && guard++ < 10000) {
    const b = S.bars[k] || {};
    if (b.repStart) repStart = k;
    if (b.ending && b.ending !== pass) { k++; continue; }
    if (!b.ending && lastEnding) pass = 1;
    lastEnding = !!b.ending;
    order.push(k);
    if (b.repEnd) { done[k] = (done[k] || 0) + 1; if (done[k] < (b.times || 2)) { pass = done[k] + 1; k = repStart; lastEnding = false; continue; } }
    k++;
  }
  return order;
}
function buildPlan() {
  const parts = S.parts.map((part) => {
    const ms = splitMeasures(part.notes), byBar = [];
    ms.forEach((m, k) => { let pos = 0; byBar[k] = m.items.map((i) => { const e = { i, on: pos }; pos += beats(part.notes[i]); return e; }); });
    const legato = new Set(); part.notes.forEach((n, i) => { if (n.slur) for (let q = i; q < i + n.slur; q++) legato.add(q); });
    return { byBar, lev: levels(part.notes), legato };
  });
  const ferm = [];
  S.parts.forEach((part, p) => parts[p].byBar.forEach((evs, k) => evs.forEach((e) => {
    const n = part.notes[e.i]; if (n.art !== 'ferm') return;
    const at = Math.round((e.on + beats(n)) * 96) / 96, m = (ferm[k] = ferm[k] || {}); m[at] = Math.max(m[at] || 0, beats(n) * 0.9);
  })));
  return { parts, ferm, nBars: playBars() };
}
function beatToSec(k, b, plan) {
  const spb = 60 / tempoOf(k); let sb = b;
  if (S.swing && tsOf(k)[1] === 4) { const fl = Math.floor(b + 1e-9), fr = b - fl; sb = fl + (fr <= 0.5 ? fr * (4 / 3) : 2 / 3 + (fr - 0.5) * (2 / 3)); }
  let extra = 0; const fm = plan.ferm[k]; if (fm) for (const at in fm) if (+at <= b + 1e-6) extra += fm[at];
  return (sb + extra) * spb;
}
/* schedules bars [order[startIdx] …] from time t0; returns the end time and every note event */
function scheduleRun(o) {
  const a = ctx(), plan = buildPlan(), order = o.order || playOrder(plan.nBars), start = o.startIdx || 0;
  const solos = S.parts.some((p) => p.solo), events = [];
  const active = new Set(S.parts.map((p, i) => i).filter((i) => (solos ? S.parts[i].solo : !S.parts[i].mute) && i !== o.silentPart));
  const buses = S.parts.map((part) => { const g = a.createGain(); g.gain.value = part.vol; if (a.createStereoPanner) { const pn = a.createStereoPanner(); pn.pan.value = part.pan; g.connect(pn); pn.connect(master); } else g.connect(master); return g; });
  let T = o.t0; const barTimes = [];
  if (o.countIn) { const k0 = order[start] || 0, spb = 60 / tempoOf(k0), u = beatUnitOf(k0); for (let b = 0; b < capOf(k0) - EPS; b += u) clickAt(T + b * spb, b < EPS); T += capOf(k0) * spb; }
  const skip = new Set();
  for (let oi = start; oi < order.length; oi++) {
    const k = order[oi], sb = oi === start ? (o.startBeat || 0) : 0, base = T - beatToSec(k, sb, plan), spb = 60 / tempoOf(k);
    barTimes.push({ k, T });
    if (o.click) { const u = beatUnitOf(k); for (let b = 0; b < capOf(k) - EPS; b += u) if (b >= sb - EPS) clickAt(base + beatToSec(k, b, plan), b < EPS); }
    S.parts.forEach((part, p) => {
      const evs = plan.parts[p].byBar[k]; if (!evs) return;
      evs.forEach((e) => {
        if (e.on < sb - EPS) return;
        const key = p + ':' + e.i; if (skip.has(key)) { skip.delete(key); return; }
        const n = part.notes[e.i]; if (n.type !== 'note') return;
        const endB = e.on + beats(n); let j = e.i, extra = 0;
        while (part.notes[j].tie && part.notes[j + 1] && part.notes[j + 1].type === 'note' && sameSounds(p, part.notes[j], part.notes[j + 1])) { j++; extra += beats(part.notes[j]) * spb; skip.add(p + ':' + j); }
        const T1 = base + beatToSec(k, e.on, plan), T2 = base + beatToSec(k, Math.min(endB, capOf(k)), plan) + Math.max(0, endB - capOf(k)) * spb + extra;
        const kL = keyOf(k), ev = { p, i: e.i, bar: k, T: T1, T2, midis: soundsOf(p, n), vel: plan.parts[p].lev[e.i] * (n.art === 'acc' ? 1.35 : 1), art: n.art, legato: plan.parts[p].legato.has(e.i), kL };
        events.push(ev);
        if (active.has(p)) playEvent(ev, part.inst, buses[p], isKit(p), n);
        if (!o.offline && o.highlight !== false) {
          timers.push(setTimeout(() => { const el = svg.querySelector(`[data-k="${key}"]`); if (el) { el.classList.add('pl'); const r = el.getBoundingClientRect(); if (r.bottom > innerHeight || r.top < 0) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, Math.max(0, (T1 - a.currentTime) * 1000)));
          timers.push(setTimeout(() => { const el = svg.querySelector(`[data-k="${key}"]`); if (el) el.classList.remove('pl'); }, Math.max(0, (T2 - a.currentTime) * 1000)));
        }
      });
    });
    T = base + beatToSec(k, capOf(k), plan);
  }
  return { t0: o.t0, endT: T, events, order, barTimes, nBars: plan.nBars };
}
function playEvent(ev, inst, bus, kit, n) {
  let d = ev.T2 - ev.T;
  if (ev.art === 'stac') d = Math.min(d * 0.45, 0.3); else if (ev.art !== 'ferm' && !ev.legato) d *= 0.95;
  ev.midis.forEach((m) => {
    const upper = kit ? m : midiOfP(spell(m, ev.kL).pitch + 1, keyAlter(mod(spell(m, ev.kL).pitch + 1, 7), ev.kL));
    if (ev.art === 'trill') { const step = 0.085; let k = 0; for (let tt = 0; tt < d - 0.02; tt += step, k++) tone(inst, k % 2 ? upper : m, ev.T + tt, step * 1.05, ev.vel * 0.85, bus); }
    else if (ev.art === 'mord') { const s2 = 0.05; tone(inst, m, ev.T, s2, ev.vel, bus); tone(inst, upper, ev.T + s2, s2, ev.vel, bus); tone(inst, m, ev.T + 2 * s2, Math.max(0.08, d - 2 * s2), ev.vel, bus); }
    else tone(inst, m, ev.T, d, ev.vel, bus);
  });
  void n;
}

/* ---------- play / stop / loop ---------- */
let playSession = null, starting = null, pbFrame = 0;
const isBusy = () => playing || !!starting;
/* the one "stop" every button and key uses: also ends practice mode cleanly */
function stopAny() {
  if (typeof practice !== 'undefined' && practice.on) practiceStop(); else stopPlay();
}
async function togglePlay() {
  if (isBusy()) { stopAny(); return; }
  if (!S.parts.some((p) => p.notes.length)) { toast('Add a few notes first.'); return; }
  try { ctx(); } catch (e) { toast('Audio is not available in this browser.'); return; }
  const token = (starting = {}); setPlayUI();
  if (prefs.real) await preloadForScore();
  if (starting !== token) return; // stopped while the sounds were loading
  starting = null;
  const plan = buildPlan(), full = playOrder(plan.nBars), range = selRange();
  let order = full, startIdx = 0, startBeat = 0;
  if (range && prefs.loop && range[1] > range[0]) {
    const notes = NT(), b1 = barAt(notePos(notes, range[0])), b2 = barAt(notePos(notes, range[1]));
    order = []; for (let k = b1; k <= b2; k++) order.push(k);
  } else if (range) {
    const notes = NT(), pos = notePos(notes, range[0]), k = barAt(pos);
    startIdx = Math.max(0, full.indexOf(k)); startBeat = pos - barStart(k);
  }
  playing = true;
  playSession = { start: audio.currentTime + 0.15, loop: !!prefs.loop, chunks: [] };
  runChunk(audio.currentTime + 0.15, { order, startIdx, startBeat, click: prefs.click });
  setPlayUI();
}
function runChunk(t0, o) {
  const r = scheduleRun(Object.assign({ t0 }, o)); trackRun(r);
  if (prefs.loop) timers.push(setTimeout(() => { if (playing) runChunk(r.endT, Object.assign({}, o, { startIdx: 0, startBeat: 0 })); }, Math.max(0, (r.endT - audio.currentTime - 0.5) * 1000)));
  else timers.push(setTimeout(stopPlay, Math.max(0, (r.endT - audio.currentTime) * 1000) + 300));
}
/* remembers when each bar starts so the Stop bar can show where you are */
function trackRun(r, loop) {
  if (!playSession) playSession = { start: r.t0, loop: !!loop, chunks: [] };
  playSession.chunks.push(r); if (playSession.chunks.length > 3) playSession.chunks.shift();
}
function stopPlay() {
  starting = null;
  timers.forEach(clearTimeout); timers = [];
  const vs = voices; voices = [];
  if (audio && master && !isOffline(audio) && vs.length) {
    // fade out over a few milliseconds instead of cutting off (which clicks), then free everything
    const old = master, t = audio.currentTime;
    try { old.gain.cancelScheduledValues(t); old.gain.setValueAtTime(old.gain.value, t); old.gain.linearRampToValueAtTime(0, t + 0.05); } catch (e) {}
    master = makeMaster(audio);
    setTimeout(() => { vs.forEach((v) => { try { v.stop(); } catch (e) {} }); try { old.disconnect(); } catch (e) {} }, 90);
  } else vs.forEach((v) => { try { v.stop(); } catch (e) {} });
  playing = false; playSession = null; setPlayUI(); svg.querySelectorAll('.pl').forEach((el) => el.classList.remove('pl'));
}
function setPlayUI() {
  const busy = isBusy();
  $('playlabel').textContent = busy ? 'Stop' : 'Play';
  $('playicon').innerHTML = busy ? '<rect x="6" y="6" width="12" height="12" rx="1.5"/>' : '<path d="M7 4.5v15l12-7.5z"/>';
  $('play').title = busy ? 'Stop (Space or Esc)' : 'Play (Space)';
  const bar = $('playbar'); if (!bar) return;
  bar.hidden = !busy; document.body.classList.toggle('isplaying', busy);
  cancelAnimationFrame(pbFrame);
  if (busy) updatePlaybar();
}
function updatePlaybar() {
  const s = playSession, label = $('pbbar'), time = $('pbtime'), fill = $('pbfill');
  if (starting || !s || !audio) { label.textContent = starting ? 'Loading sounds…' : 'Starting…'; time.textContent = ''; fill.style.width = '0'; }
  else {
    const now = audio.currentTime;
    let c = s.chunks[0]; for (const r of s.chunks) if (r.t0 <= now) c = r;
    let b = null; for (const bt of c.barTimes) if (bt.T <= now + 0.02) b = bt;
    label.textContent = b ? `Bar ${b.k + 1} of ${c.nBars}` : 'Count-in…';
    const el = Math.max(0, now - s.start);
    time.textContent = s.loop ? `${clock(el)} · looping` : `${clock(el)} / ${clock(Math.max(0, c.endT - s.start))}`;
    fill.style.width = (100 * Math.min(1, Math.max(0, (now - c.t0) / Math.max(0.01, c.endT - c.t0)))).toFixed(2) + '%';
  }
  pbFrame = requestAnimationFrame(updatePlaybar);
}
function clock(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function blip(midi, inst) { try { if (!playing && !(typeof mic !== 'undefined' && mic.on)) tone(inst || S.parts[ap].inst, midi, ctx().currentTime + 0.01, 0.45, 0.4); } catch (e) {} }

/* ---------- audio file export ---------- */
/* renders the whole piece offline; with withEvents it also returns when each note sounds (for the video) */
async function renderWAV(sr = 44100, withEvents = false) {
  if (playing) stopPlay();
  ctx();
  if (prefs.real) await preloadForScore();
  const plan = buildPlan(), order = playOrder(plan.nBars);
  const total = order.reduce((s, k) => s + beatToSec(k, capOf(k), plan), 0) + 3;
  const off = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
  const saved = { audio, master, waves }; let run;
  audio = off; master = makeMaster(off); waves = {};
  try { run = scheduleRun({ t0: 0.05, order, offline: true }); }
  finally { audio = saved.audio; master = saved.master; waves = saved.waves; voices = []; }
  const buffer = await off.startRendering();
  return withEvents ? { buffer, events: run.events, endT: run.endT } : buffer;
}
function wavBlob(buf) {
  const ch = buf.numberOfChannels, len = buf.length, data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true);
  data.setUint16(22, ch, true); data.setUint32(24, buf.sampleRate, true); data.setUint32(28, buf.sampleRate * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  w(36, 'data'); data.setUint32(40, len * ch * 2, true);
  const chans = []; for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let o = 44; for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c][i])); data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return new Blob([data], { type: 'audio/wav' });
}
