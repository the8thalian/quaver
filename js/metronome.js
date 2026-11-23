'use strict';
/* Quaver · metronome.js
   A metronome that runs on its own: tempo with its Italian name, tap tempo, beats you can accent
   or silence, subdivisions and three sounds. Clicks are scheduled on the audio clock a little
   ahead of time (from a worker, which keeps ticking when the tab is in the background), so the
   beat stays steady even while the page is busy drawing. */

const TEMPO_NAMES = [
  [40, 'Grave', 'very slow and solemn'], [60, 'Largo', 'slow and broad'], [66, 'Larghetto', 'fairly slow'],
  [76, 'Adagio', 'slow, at ease'], [108, 'Andante', 'at a walking pace'], [120, 'Moderato', 'at a moderate speed'],
  [156, 'Allegro', 'fast and bright'], [176, 'Vivace', 'lively'], [200, 'Presto', 'very fast'], [Infinity, 'Prestissimo', 'as fast as possible']
];
const tempoName = (bpm) => TEMPO_NAMES.find(([lim]) => bpm < lim);
const MT_MIN = 20, MT_MAX = 300, MT_STORE = 'quaver:metro', MT_SOUNDS = ['click', 'wood', 'beep'], MT_SWING = 24;
const MT_LEVEL = ['silent', 'normal', 'accented'];
const BEAT_WORD = { 1: 'quarter-note', 1.5: 'dotted-quarter', 2: 'half-note', 0.5: 'eighth-note', 0.25: 'sixteenth-note' };
const metro = {
  on: false, starting: false, bpm: 100, beats: 4, sub: 1, sound: 'click', vol: 0.8, accents: [2, 1, 1, 1],
  next: 0, beat: 0, subi: 0, count: 0, queue: [], last: null, out: null, timer: 0, frame: 0, taps: []
};
let metroWorker = null;
const stillMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

/* ---------- sound ---------- */
/* lvl: 2 accented beat, 1 normal beat, -1 subdivision */
const MT_GAIN = { click: 0.38, wood: 0.74, beep: 0.95 }; // keeps each sound's loudest peak near 0.7, well clear of clipping
function metroSound(a, out, t, lvl) {
  const hi = lvl === 2, sub = lvl < 0, v = (hi ? 1 : sub ? 0.32 : 0.62) * (MT_GAIN[metro.sound] || 0.5), g = a.createGain(); g.connect(out);
  if (metro.sound === 'wood') {
    const f = hi ? 1250 : sub ? 760 : 920, o = a.createOscillator();
    o.frequency.setValueAtTime(f * 1.05, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.012);
    g.gain.setValueAtTime(v * 0.9, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.07); o.connect(g); o.start(t); o.stop(t + 0.08);
    const n = a.createBufferSource(), bp = filt(a, 'bandpass', f * 2.2, 4), ng = a.createGain(); n.buffer = noise();
    ng.gain.setValueAtTime(v * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.02); n.connect(bp); bp.connect(ng); ng.connect(out); n.start(t, Math.random() * 1.5); n.stop(t + 0.03);
  } else if (metro.sound === 'beep') {
    const o = a.createOscillator(); o.frequency.value = hi ? 1760 : sub ? 660 : 880;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.55, t + 0.003); g.gain.setValueAtTime(v * 0.55, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(g); o.start(t); o.stop(t + 0.1);
  } else { // a short bright tick, like the escapement of a clockwork metronome
    const n = a.createBufferSource(), hp = filt(a, 'highpass', hi ? 2600 : sub ? 1400 : 1900, 0.7), pk = filt(a, 'peaking', hi ? 3600 : 2600, 4); pk.gain.value = 10; n.buffer = noise();
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0005, t + (sub ? 0.018 : 0.03)); n.connect(hp); hp.connect(pk); pk.connect(g); n.start(t, Math.random() * 1.5); n.stop(t + 0.04);
    const o = a.createOscillator(), og = a.createGain(); o.frequency.value = hi ? 1600 : sub ? 900 : 1150;
    og.gain.setValueAtTime(v * 0.5, t); og.gain.exponentialRampToValueAtTime(0.0005, t + 0.025); o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.03);
  }
}
function metroOut(a) { const out = a.createGain(); out.gain.value = metro.vol; out.connect(a.destination); return out; }
function metroFree(out) { try { out.disconnect(); } catch (e) {} }
/* one click right now, so taps and sound changes give feedback while the metronome is stopped */
function metroPreview(lvl) {
  if (metro.on) return;
  try { const a = ctx(); if (a.state !== 'running') return; const out = metroOut(a); metroSound(a, out, a.currentTime + 0.005, lvl); setTimeout(() => metroFree(out), 300); } catch (e) {}
}

/* ---------- timing ---------- */
function metroTick() {
  const a = audio; if (!metro.on || !a || isOffline(a) || !metro.out) return;
  const horizon = a.currentTime + (document.hidden ? 1.5 : 0.12);
  while (metro.next < horizon) {
    metro.beat %= metro.beats;
    const lvl = metro.accents[metro.beat] || 0;
    if (lvl) metroSound(a, metro.out, metro.next, metro.subi ? -1 : lvl);
    if (!metro.subi) { metro.queue.push({ t: metro.next, beat: metro.beat, n: metro.count++ }); if (metro.queue.length > 64) metro.queue.shift(); }
    metro.next += 60 / metro.bpm / metro.sub;
    if (++metro.subi >= metro.sub) { metro.subi = 0; metro.beat = (metro.beat + 1) % metro.beats; }
  }
}
function metroTimers(on) {
  clearInterval(metro.timer); if (metroWorker) metroWorker.postMessage(0);
  if (!on) return;
  metro.timer = setInterval(metroTick, 25);
  try { // browsers slow down timers in background tabs, but not a worker's
    if (!metroWorker) {
      const src = 'let t=0;onmessage=(e)=>{clearInterval(t);if(e.data)t=setInterval(()=>postMessage(0),e.data)}';
      metroWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      metroWorker.onmessage = metroTick; metroWorker.onerror = () => { metroWorker = null; };
    }
    metroWorker.postMessage(25);
  } catch (e) { metroWorker = null; }
}
/* lights the beat you are hearing and swings the pendulum to meet the next one */
function metroFrame() {
  const a = audio; if (!metro.on || !a) return;
  const now = a.currentTime - (a.outputLatency || 0);
  let hit = null; while (metro.queue.length && metro.queue[0].t <= now) hit = metro.queue.shift();
  if (hit) { metro.last = hit; metroLight(hit.beat); }
  if (!stillMotion()) {
    let ang = -MT_SWING;
    if (metro.last) { const ph = Math.min(1, Math.max(0, (now - metro.last.t) * metro.bpm / 60)); ang = (metro.last.n % 2 ? 1 : -1) * MT_SWING * Math.cos(Math.PI * ph); }
    $('mt-arm').setAttribute('transform', `rotate(${ang.toFixed(2)} 32 70)`);
  }
  metro.frame = requestAnimationFrame(metroFrame);
}
function metroLight(i) {
  document.querySelectorAll('#mt-beats button').forEach((b, k) => b.classList.toggle('now', k === i));
  const led = $('mtled'); led.classList.add('beat'); clearTimeout(metroLight.t); metroLight.t = setTimeout(() => led.classList.remove('beat'), 90);
}

/* ---------- start / stop ---------- */
async function metroStart() {
  if (metro.on || metro.starting) return;
  if (mic.on || practice.on) { mtMsg('The recording already has its own click. Stop it first, then start the metronome.'); return; }
  let a; try { a = ctx(); } catch (e) { toast('Audio is not available in this browser.'); return; }
  if (isBusy()) stopAny(); // the score and the metronome don't play over each other
  const token = (metro.starting = {}), ok = await soundReady();
  if (metro.starting !== token || metro.on) return; // stopped while the sound was starting
  metro.starting = false;
  if (!ok) { toast(SOUND_BLOCKED); return; }
  metro.out = metroOut(a);
  Object.assign(metro, { on: true, next: a.currentTime + 0.06, beat: 0, subi: 0, count: 0, queue: [], last: null });
  metroTick(); metroTimers(true); metroUI();
  cancelAnimationFrame(metro.frame); metro.frame = requestAnimationFrame(metroFrame);
}
function metroStop() {
  metro.starting = false;
  if (!metro.on) return;
  metro.on = false; metroTimers(false); cancelAnimationFrame(metro.frame);
  const out = metro.out; metro.out = null;
  if (out) { // clicks already queued fade out instead of sounding after Stop
    try { const t = out.context.currentTime; out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0, t, 0.008); } catch (e) {}
    setTimeout(() => metroFree(out), 120);
  }
  metroUI();
}
const metroToggle = () => (metro.on ? metroStop() : metroStart());
function metroUI() {
  const go = $('mt-go'); go.textContent = metro.on ? 'Stop' : 'Start'; go.classList.toggle('on', metro.on);
  $('mtled').classList.toggle('on', metro.on);
  $('metrobtn').title = metro.on ? 'Metronome is running (M or Esc stops it)' : 'Metronome (M)';
  if (!metro.on) { document.querySelectorAll('#mt-beats .now').forEach((b) => b.classList.remove('now')); $('mt-arm').setAttribute('transform', 'rotate(0 32 70)'); }
}

/* ---------- settings ---------- */
function mtMsg(t) { $('mt-msg').textContent = t; }
function metroSave() { try { localStorage.setItem(MT_STORE, JSON.stringify({ bpm: metro.bpm, beats: metro.beats, sub: metro.sub, sound: metro.sound, vol: metro.vol, accents: metro.accents })); } catch (e) {} }
function metroLoad() {
  let s = null; try { s = JSON.parse(localStorage.getItem(MT_STORE) || 'null'); } catch (e) {}
  if (!s || typeof s !== 'object') return;
  if (+s.bpm) metro.bpm = Math.max(MT_MIN, Math.min(MT_MAX, Math.round(+s.bpm)));
  if (+s.beats >= 1 && +s.beats <= 12) metro.beats = Math.round(+s.beats);
  if ([1, 2, 3, 4].includes(+s.sub)) metro.sub = +s.sub;
  if (MT_SOUNDS.includes(s.sound)) metro.sound = s.sound;
  if (s.vol >= 0 && s.vol <= 1) metro.vol = +s.vol;
  metro.accents = Array.from({ length: metro.beats }, (_, i) => (Array.isArray(s.accents) && [0, 1, 2].includes(s.accents[i]) ? s.accents[i] : i ? 1 : 2));
}
function setMetroBpm(v, typing) {
  const b = Math.max(MT_MIN, Math.min(MT_MAX, Math.round(+v || metro.bpm)));
  metro.bpm = b; if (!typing) $('mt-bpm').value = b; $('mt-slider').value = b;
  const [, name, gloss] = tempoName(b), el = $('mt-name'); el.querySelector('span').textContent = name; el.querySelector('small').textContent = gloss;
  metroSave();
}
function setMetroBeats(n) {
  n = Math.max(1, Math.min(12, Math.round(+n) || 4));
  metro.accents = Array.from({ length: n }, (_, i) => (i < metro.accents.length ? metro.accents[i] : 1));
  metro.beats = n; metro.beat %= n; $('mt-count').value = n; drawBeats(); metroSave();
}
function setMetroSub(s) { metro.sub = [1, 2, 3, 4].includes(+s) ? +s : 1; $('mt-sub').value = metro.sub; metroSave(); }
function drawBeats() {
  const box = $('mt-beats'); box.textContent = '';
  metro.accents.forEach((l, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = i + 1; b.dataset.l = l;
    b.title = `Beat ${i + 1}: ${MT_LEVEL[l]}. Click to change.`; b.setAttribute('aria-label', `Beat ${i + 1}, ${MT_LEVEL[l]}`);
    b.onclick = () => { metro.accents[i] = (metro.accents[i] + 2) % 3; drawBeats(); metroSave(); if (metro.accents[i]) metroPreview(metro.accents[i]); };
    box.appendChild(b);
  });
}
function metroTap() {
  const now = performance.now(), T = metro.taps;
  if (T.length && now - T[T.length - 1] > 2000) T.length = 0;
  T.push(now); if (T.length > 8) T.shift();
  metroPreview(T.length === 1 ? 2 : 1);
  if (T.length < 2) { mtMsg('Keep tapping at the speed you want…'); return; }
  setMetroBpm(60000 / ((T[T.length - 1] - T[0]) / (T.length - 1)));
  mtMsg(T.length < 4 ? 'Keep tapping…' : `Tapped ${metro.bpm} BPM (${tempoName(metro.bpm)[1]}).`);
}
/* the selected bar's tempo and time signature (or bar 1's), counted in its natural beat */
function metroFromScore() {
  const k = sel >= 0 ? barAt(notePos(NT(), sel)) : 0, ts = tsOf(k);
  let u = beatUnitOf(k), n = capOf(k) / u;
  if (Math.abs(n - Math.round(n)) > 1e-6) { u = 4 / ts[1]; n = ts[0]; } // 5/8, 7/8 …: count every eighth
  n = Math.max(1, Math.min(12, Math.round(n)));
  metro.accents = Array.from({ length: n }, (_, i) => (i ? 1 : 2));
  setMetroBeats(n); setMetroBpm(tempoOf(k) / u);
  if (u === 1.5) setMetroSub(3); else if (metro.sub === 3) setMetroSub(1);
  mtMsg(`Matched bar ${k + 1}: ${ts[0]}/${ts[1]}, ${n} ${BEAT_WORD[u] || ''} beat${n > 1 ? 's' : ''} at ${metro.bpm} BPM.`);
}
function metroToScore() {
  const u = beatUnitOf(0), t = clampTempo(metro.bpm * u);
  if (t === S.tempo) { mtMsg('The score already starts at this tempo.'); return; }
  mutate(() => { S.tempo = t; }); syncMeta();
  toast(`The score now starts at ♩ = ${t}. Undo changes it back.`);
}

/* called from app.js once the page helpers exist */
function initMetronome() {
  metroLoad();
  const cnt = $('mt-count'); for (let i = 1; i <= 12; i++) cnt.add(new Option(String(i), String(i)));
  setMetroBpm(metro.bpm); setMetroBeats(metro.beats); setMetroSub(metro.sub);
  $('mt-sound').value = metro.sound; $('mt-vol').value = metro.vol; $('mt-play').checked = !!prefs.click;
  $('mt-go').onclick = metroToggle;
  $('mt-down').onclick = () => setMetroBpm(metro.bpm - 1); $('mt-up').onclick = () => setMetroBpm(metro.bpm + 1);
  $('mt-slider').oninput = (e) => setMetroBpm(e.target.value);
  $('mt-bpm').oninput = (e) => { const v = +e.target.value; if (v >= MT_MIN && v <= MT_MAX) setMetroBpm(v, true); };
  $('mt-bpm').onchange = (e) => setMetroBpm(e.target.value);
  $('mt-count').onchange = (e) => setMetroBeats(e.target.value);
  $('mt-sub').onchange = (e) => setMetroSub(e.target.value);
  $('mt-sound').onchange = (e) => { metro.sound = MT_SOUNDS.includes(e.target.value) ? e.target.value : 'click'; metroSave(); metroPreview(2); };
  $('mt-vol').oninput = (e) => { metro.vol = +e.target.value; if (metro.out) metro.out.gain.setTargetAtTime(metro.vol, metro.out.context.currentTime, 0.02); metroSave(); };
  $('mt-vol').onchange = () => metroPreview(1);
  // tap on press, not release, so the timing follows your finger (keys are handled with the shortcuts)
  $('mt-tap').addEventListener('pointerdown', (e) => { if (e.button === 0) metroTap(); });
  $('mt-from').onclick = metroFromScore; $('mt-to').onclick = metroToScore;
  $('mt-play').onchange = (e) => { prefs.click = e.target.checked; savePrefs(); $('opt-click').checked = prefs.click; };
}
