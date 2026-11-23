'use strict';
/* Quaver · extras.js
   Microphone transcription, practice mode, ear training and the Sonnet assistant. */

/* =====================  pitch detection (YIN)  ===================== */
function detectPitch(buf, sr) {
  const n = buf.length; let rms = 0; for (let i = 0; i < n; i++) rms += buf[i] * buf[i]; rms = Math.sqrt(rms / n);
  if (rms < 0.01) return { freq: 0, clarity: 0, rms };
  const minLag = Math.floor(sr / 1400), maxLag = Math.min(Math.floor(sr / 65), (n >> 1) - 1);
  const d = new Float32Array(maxLag + 2), W = n - maxLag - 1;
  for (let tau = 1; tau <= maxLag + 1; tau++) { let s = 0; for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; } d[tau] = s; }
  const cm = new Float32Array(maxLag + 2); cm[0] = 1; let run = 0;
  for (let tau = 1; tau <= maxLag + 1; tau++) { run += d[tau]; cm[tau] = run ? d[tau] * tau / run : 1; }
  let tau = -1;
  for (let t = Math.max(2, minLag); t < maxLag; t++) { if (cm[t] < 0.15) { while (t + 1 < maxLag && cm[t + 1] < cm[t]) t++; tau = t; break; } }
  if (tau < 0) return { freq: 0, clarity: 0, rms };
  const a = cm[tau - 1], b = cm[tau], c = cm[tau + 1], den = 2 * (a - 2 * b + c), shift = den ? (a - c) / den : 0;
  return { freq: sr / (tau + shift), clarity: 1 - b, rms };
}
const median = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
function segmentFrames(frames) {
  const notes = []; let cur = null, gap = 0;
  const dt = frames.length > 1 ? (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) : 0.025, maxGap = Math.max(2, Math.round(0.09 / dt));
  frames.forEach((f) => {
    const voiced = f.f > 0 && f.c >= 0.7, m = voiced ? 69 + 12 * Math.log2(f.f / 440) : null;
    if (voiced) {
      if (cur && Math.abs(m - median(cur.ms)) < 0.8) { cur.ms.push(m); cur.end = f.t; gap = 0; return; }
      if (cur) notes.push(cur);
      cur = { start: f.t, end: f.t, ms: [m] }; gap = 0;
    } else if (cur) { gap++; if (gap > maxGap) { notes.push(cur); cur = null; gap = 0; } }
  });
  if (cur) notes.push(cur);
  const res = notes.map((n) => ({ start: n.start, end: n.end + dt, midi: Math.round(median(n.ms)) })).filter((n) => n.end - n.start >= 0.07), merged = [];
  res.forEach((n) => { const l = merged[merged.length - 1]; if (l && l.midi === n.midi && n.start - l.end < 0.06) l.end = n.end; else merged.push(n); });
  return merged;
}
function transcribeFrames(frames, spb, grid, shift) {
  return quantizeEvents(segmentFrames(frames).map((n) => ({ start: n.start / spb, dur: (n.end - n.start) / spb, midis: [n.midi + shift] })), grid);
}

/* =====================  microphone recording  ===================== */
const mic = { on: false };
function micMsg(t) { $('micmsg').textContent = t; }
async function openMic(msgFn) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msgFn('Microphone access is not available here. Open this page over https or from localhost in a current browser.'); return null; }
  audioSession('play-and-record');
  try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
  catch (e) { audioSession('playback'); msgFn(e && e.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in your browser settings, then try again.' : 'Could not open the microphone: ' + (e && e.message ? e.message : e)); return null; }
}
function showLive(r) {
  let name = '–', left = '50%';
  if (r.freq && r.clarity > 0.7) { const m = 69 + 12 * Math.log2(r.freq / 440), rm = Math.round(m); name = midiName(rm); left = (50 + (m - rm) * 90) + '%'; }
  document.querySelectorAll('.livenote').forEach((el) => { el.textContent = name; });
  document.querySelectorAll('.cents i').forEach((el) => { el.style.left = left; });
}
async function micStart() {
  if (isKit(ap)) { micMsg('The mic writes melodies. Select a pitched part (not drums) first, then press Record.'); return; }
  const stream = await openMic(micMsg); if (!stream) return;
  if (playing) stopPlay();
  metroStop();
  const a = ctx(), src = a.createMediaStreamSource(stream), an = a.createAnalyser(); an.fftSize = 2048; src.connect(an);
  const pos = totalBeats(NT()), k0 = barAt(pos + 0.001), spb = 60 / tempoOf(k0), cap = capOf(k0), count = $('mic-count').checked ? cap : 0;
  Object.assign(mic, { on: true, stream, src, an, buf: new Float32Array(an.fftSize), frames: [], spb, cap, t0: a.currentTime + 0.2 + count * spb, nextBeat: -count, part: ap });
  mic.timer = setInterval(micTick, 25);
  $('micgolbl').textContent = 'Stop'; $('micgo').classList.add('on'); $('micbtn').classList.add('on');
  micMsg(count ? 'Count-in… then sing or play.' : 'Recording… sing or play.');
}
function micTick() {
  const a = audio; if (!mic.on) return;
  while (mic.t0 + mic.nextBeat * mic.spb < a.currentTime + 0.15) { if (mic.nextBeat < 0 || $('mic-click').checked) clickAt(mic.t0 + mic.nextBeat * mic.spb, mod(mic.nextBeat, mic.cap) === 0); mic.nextBeat++; }
  mic.an.getFloatTimeDomainData(mic.buf);
  const r = detectPitch(mic.buf, a.sampleRate);
  if (a.currentTime >= mic.t0) { mic.frames.push({ t: a.currentTime - mic.t0 - 0.045, f: r.freq, c: r.clarity }); if ($('micmsg').textContent.startsWith('Count')) micMsg('Recording… sing or play.'); }
  showLive(r);
}
function micStop() {
  if (!mic.on) return; mic.on = false; clearInterval(mic.timer);
  try { mic.stream.getTracks().forEach((t) => t.stop()); mic.src.disconnect(); } catch (e) {}
  audioSession('playback');
  $('micgolbl').textContent = 'Record'; $('micgo').classList.remove('on'); $('micbtn').classList.remove('on'); showLive({});
  const evs = transcribeFrames(mic.frames, mic.spb, +$('mic-grid').value, +$('mic-oct').value);
  if (!evs.length) { micMsg('No clear notes were heard. Try again closer to the microphone, one note at a time.'); return; }
  insertTranscription(mic.part, evs);
}
function insertTranscription(p, evs) {
  ap = p;
  mutate(() => {
    const part = S.parts[p], used = totalBeats(part.notes), k = barAt(used), left = barStart(k) === used ? 0 : barStart(k + 1) - used;
    if (left > EPS) part.notes.push(...restsFor(left, used));
    part.notes.push(...eventsToNotes(evs, capOf(barAt(totalBeats(part.notes))), keyOf(barAt(totalBeats(part.notes)))));
    sel = selA = -1;
  });
  const cnt = evs.length;
  micMsg(`Added ${cnt} notes to ${S.parts[p].name}. Check the rhythm and fix anything with the tools. Undo removes it all.`);
  toast('Recording added to ' + S.parts[p].name);
}

/* a recording file (voice memo, MP3, WAV…) instead of the live microphone */
let fileBusy = false;
async function transcribeFile(f) {
  if (fileBusy) return;
  if (isKit(ap)) { micMsg('Transcribing writes melodies. Select a pitched part (not drums) first, then choose the recording.'); return; }
  fileBusy = true;
  try {
    micMsg('Reading the recording…');
    let buf;
    try { buf = await ctx().decodeAudioData(await f.arrayBuffer()); } catch (e) { micMsg('Couldn’t read that file. Choose an audio recording such as MP3, M4A, WAV or OGG.'); return; }
    const sr = buf.sampleRate, len = Math.min(buf.length, sr * 180), N = 2048, hop = Math.round(sr * 0.025);
    const x = new Float32Array(len); for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) x[i] += d[i] / buf.numberOfChannels; }
    const frames = [];
    for (let i = 0, n = 0; i + N <= len; i += hop, n++) {
      const r = detectPitch(x.subarray(i, i + N), sr); frames.push({ t: i / sr, f: r.freq, c: r.clarity });
      if (n % 60 === 59) { micMsg(`Listening… ${Math.round((100 * i) / len)}%`); await new Promise((r2) => setTimeout(r2)); }
    }
    const first = frames.findIndex((fr) => fr.f > 0 && fr.c >= 0.7);
    if (first < 0) { micMsg('No clear notes were heard in that recording. Sing or play one note at a time, close to the microphone.'); return; }
    const t0 = frames[first].t, k0 = barAt(totalBeats(NT()) + 0.001);
    const evs = transcribeFrames(frames.slice(first).map((fr) => ({ t: fr.t - t0, f: fr.f, c: fr.c })), 60 / tempoOf(k0), +$('mic-grid').value, +$('mic-oct').value);
    if (!evs.length) { micMsg('No clear notes were heard in that recording. Sing or play one note at a time, close to the microphone.'); return; }
    insertTranscription(ap, evs);
    if (buf.length > len) toast('Only the first 3 minutes were transcribed.');
  } finally { fileBusy = false; }
}

/* =====================  practice mode  ===================== */
const practice = { on: false };
function prMsg(t) { $('prmsg').textContent = t; }
async function practiceStart() {
  if (isKit(ap)) { prMsg('Practice listens for pitches, so pick a pitched part.'); return; }
  if (!NT().some((n) => n.type === 'note')) { prMsg('This part has no notes to practise yet.'); return; }
  const stream = await openMic(prMsg); if (!stream) return;
  if (playing) stopPlay();
  metroStop();
  practiceMarks = {}; render();
  const a = ctx(), src = a.createMediaStreamSource(stream), an = a.createAnalyser(); an.fftSize = 2048; src.connect(an);
  const p = ap, range = selRange(), plan = buildPlan(), full = playOrder(plan.nBars);
  let order = full;
  if (range && range[1] > range[0]) { const b1 = barAt(notePos(NT(), range[0])), b2 = barAt(notePos(NT(), range[1])); order = []; for (let k = b1; k <= b2; k++) order.push(k); }
  const accompany = $('pr-acc').checked;
  const saved = S.parts.map((pt) => pt.mute);
  if (!accompany) S.parts.forEach((pt, i) => { if (i !== p) pt.mute = true; });
  const r = scheduleRun({ t0: a.currentTime + 0.2, order, countIn: true, click: $('pr-click').checked, silentPart: $('pr-hear').checked ? undefined : p });
  S.parts.forEach((pt, i) => { pt.mute = saved[i]; });
  Object.assign(practice, { on: true, stream, src, an, buf: new Float32Array(2048), frames: [], p, expected: r.events.filter((e) => e.p === p), endT: r.endT });
  practice.timer = setInterval(() => {
    practice.an.getFloatTimeDomainData(practice.buf);
    const res = detectPitch(practice.buf, a.sampleRate); practice.frames.push({ t: a.currentTime - 0.045, f: res.freq, c: res.clarity }); showLive(res);
    if (a.currentTime > practice.endT + 0.3) practiceStop();
  }, 25);
  playing = true; playSession = null; trackRun(r); setPlayUI();
  $('prgo').textContent = 'Stop'; prMsg('Count-in… then play along. Your notes turn green or red when you finish.');
}
function judgePractice(frames, expected) {
  return expected.map((e) => {
    const a = e.T + (e.T2 - e.T) * 0.2, b = e.T + (e.T2 - e.T) * 0.85;
    const ms = frames.filter((fr) => fr.t >= a && fr.t <= b && fr.f > 0 && fr.c >= 0.7).map((fr) => 69 + 12 * Math.log2(fr.f / 440));
    if (ms.length < 2) return Object.assign({}, e, { ok: false, heard: null });
    const m = Math.round(median(ms)); return Object.assign({}, e, { ok: e.midis.includes(m), heard: m });
  });
}
function practiceStop() {
  if (!practice.on) return; practice.on = false; clearInterval(practice.timer);
  try { practice.stream.getTracks().forEach((t) => t.stop()); practice.src.disconnect(); } catch (e) {}
  audioSession('playback');
  stopPlay(); showLive({}); $('prgo').textContent = 'Start practising';
  const res = judgePractice(practice.frames, practice.expected.filter((e) => e.T2 <= audio.currentTime + 0.05));
  showPracticeResult(practice.p, res);
}
function showPracticeResult(p, res) {
  practiceMarks = {}; res.forEach((r) => { const key = `${p}:${r.i}`; if (practiceMarks[key] !== 'bad') practiceMarks[key] = r.ok ? 'ok' : 'bad'; });   // wrong on any pass = red
  render();
  const ok = res.filter((r) => r.ok).length, miss = res.filter((r) => !r.ok).slice(0, 4);
  if (!res.length) { prMsg('Nothing was judged. Try again and play along from the count-in.'); return; }
  prMsg(`${ok} of ${res.length} notes right (${Math.round((ok / res.length) * 100)}%). ` + (miss.length ? 'To fix: ' + miss.map((r) => `bar ${r.bar + 1} ${r.heard ? 'you played ' + midiName(r.heard) + ', written ' + midiName(r.midis[0]) : 'not heard'}`).join('; ') + '.' : 'Perfect!'));
}

/* =====================  ear training  ===================== */
const INTERVALS = ['Minor 2nd', 'Major 2nd', 'Minor 3rd', 'Major 3rd', 'Perfect 4th', 'Tritone', 'Perfect 5th', 'Minor 6th', 'Major 6th', 'Minor 7th', 'Major 7th', 'Octave'];
const PCS = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'];
const CHORDS = [['Major', [0, 4, 7]], ['Minor', [0, 3, 7]], ['Diminished', [0, 3, 6]], ['Augmented', [0, 4, 8]], ['Dominant 7th', [0, 4, 7, 10]], ['Major 7th', [0, 4, 7, 11]], ['Minor 7th', [0, 3, 7, 10]]];
const ear = { q: null, right: 0, total: 0, streak: 0, answered: false };
function earPlay() {
  const q = ear.q; if (!q) return; const t = ctx().currentTime + 0.05;
  if (q.mode === 'int') { tone('piano', q.root, t, 0.7, 0.45); tone('piano', q.root + q.ans, t + 0.8, 0.7, 0.45); tone('piano', q.root, t + 1.7, 1, 0.35); tone('piano', q.root + q.ans, t + 1.7, 1, 0.35); }
  else if (q.mode === 'note') { tone('piano', 60, t, 0.8, 0.45); tone('piano', 60 + q.ans, t + 1.1, 1, 0.45); }
  else { const iv = CHORDS[q.ans][1]; iv.forEach((x, i) => tone('piano', q.root + x, t + i * 0.25, 0.4, 0.35)); iv.forEach((x) => tone('piano', q.root + x, t + iv.length * 0.25 + 0.2, 1.4, 0.3)); }
}
function earNew() {
  const mode = $('earmode').value; ear.answered = false;
  if (mode === 'int') ear.q = { mode, root: 55 + Math.floor(Math.random() * 13), ans: 1 + Math.floor(Math.random() * 12) };
  else if (mode === 'note') ear.q = { mode, ans: Math.floor(Math.random() * 12) };
  else ear.q = { mode, root: 52 + Math.floor(Math.random() * 12), ans: Math.floor(Math.random() * CHORDS.length) };
  const names = mode === 'int' ? INTERVALS : mode === 'note' ? PCS : CHORDS.map((c) => c[0]);
  $('earchoices').innerHTML = '';
  names.forEach((nm, i) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = nm; b.onclick = () => earAnswer(mode === 'int' ? i + 1 : i, b); $('earchoices').appendChild(b); });
  $('earmsg').textContent = mode === 'note' ? 'You hear C, then a mystery note. Which note is it?' : mode === 'int' ? 'Two notes, one after the other, then together. What is the interval?' : 'A chord, broken then together. What kind is it?';
  earPlay();
}
function earAnswer(v, btn) {
  if (!ear.q || ear.answered) return; ear.answered = true; ear.total++;
  const good = v === ear.q.ans; if (good) { ear.right++; ear.streak++; } else ear.streak = 0;
  btn.classList.add(good ? 'ok' : 'bad');
  const names = ear.q.mode === 'int' ? INTERVALS : ear.q.mode === 'note' ? PCS : CHORDS.map((c) => c[0]), right = ear.q.mode === 'int' ? names[ear.q.ans - 1] : names[ear.q.ans];
  $('earmsg').textContent = (good ? 'Correct! ' : `Not quite: it was ${right}. `) + 'Press Next for another.';
  $('earscore').textContent = `${ear.right} / ${ear.total}` + (ear.streak > 1 ? ` · streak ${ear.streak}` : '');
}

/* =====================  Sonnet  ===================== */
const MODEL = 'claude-sonnet-5-5';
const chatLog = []; let busy = false;
const DRUM_ALIAS = { kick: 31, bd: 31, bass: 31, snare: 35, sn: 35, sd: 35, rim: 34, sidestick: 34, clap: 30, hh: 39, hhc: 39, hihat: 39, closedhihat: 39, hho: 41, openhihat: 41, oh: 41, hhp: 29, pedal: 29, ride: 38, crash: 40, tom1: 37, tomh: 37, hightom: 37, tom2: 36, tomm: 36, midtom: 36, tom3: 33, tomf: 33, floortom: 33, lowfloortom: 32 };
function headToken(p, n, h) {
  if (isKit(p)) return kitInfo(S.parts[p].inst, h.pitch)[1];
  return pitchName(h.pitch, h.alt, true);
}
function noteToken(p, n) {
  let head;
  if (n.type === 'rest') head = 'R';
  else { const hs = heads(n).map((h) => headToken(p, n, h)); head = hs.length > 1 ? '[' + hs.join(',') + ']' : hs[0]; }
  const clean = (s) => String(s).replace(/[{},\s]+/g, '');
  const marks = [n.dyn, n.hp, n.art, n.sym && 'sym=' + clean(n.sym), n.lyric && 'lyric=' + clean(n.lyric)].filter(Boolean);
  return `${head}:${n.dur}${n.dots ? '.' : ''}${n.tup ? '3' : ''}${n.tie ? '~' : ''}${marks.length ? '{' + marks.join(',') + '}' : ''}`;
}
function scoreToText() {
  let t = `Title: ${S.title || 'Untitled'}\nComposer: ${S.composer || 'unknown'}\nKey: ${MAJ[S.key]} major (${S.key} sharps(+)/flats(-)), Time: ${S.ts.join('/')}, Tempo: ${S.tempo} bpm${S.swing ? ', swing feel' : ''}\n`;
  const ch = Object.entries(S.bars).map(([k, b]) => `bar ${+k + 1}: ${[b.key !== undefined && 'key ' + b.key, b.ts && 'time ' + b.ts.join('/'), b.tempo && 'tempo ' + b.tempo, b.repStart && 'repeat start', b.repEnd && 'repeat end', b.ending && 'ending ' + b.ending, b.mark && 'mark ' + b.mark].filter(Boolean).join(', ')}`);
  if (ch.length) t += 'Bar settings: ' + ch.join('; ') + '\n';
  t += 'All pitches are concert (sounding) pitch.\n';
  S.parts.forEach((part, p) => {
    t += `\nPart ${p} "${part.name}" (instrument key: ${part.inst}, ${INSTR[part.inst].kit ? 'drum kit' : part.clef + ' clef'})\n`;
    splitMeasures(part.notes).forEach((m, k) => { if (m.items.length) t += `Bar ${k + 1}: ${m.items.map((i) => noteToken(p, part.notes[i])).join(' ')}\n`; });
  });
  return t;
}
/* parse Sonnet's note text back into notes */
function parseNotation(str, inst) {
  const kit = !!INSTR[inst].kit, out = [], errors = [];
  str.replace(/\|/g, ' ').split(/\s+/).filter(Boolean).forEach((tok) => {
    const m = /^(\[[^\]]+\]|R|[A-Ga-g][#b]?-?\d|[A-Za-z0-9]+):([whqes])(\.?)(3?)(~?)(\{[^}]*\})?$/.exec(tok);
    if (!m) { errors.push(tok); return; }
    const n = { type: 'note', pitch: 0, alt: 0, dur: m[2], dots: m[3] ? 1 : 0 };
    if (m[4]) n.tup = 3; if (m[5]) n.tie = true;
    if (m[1] === 'R') { n.type = 'rest'; delete n.tie; }
    else {
      const parts = m[1].startsWith('[') ? m[1].slice(1, -1).split(',') : [m[1]], hs = [];
      parts.forEach((h) => {
        h = h.trim();
        if (kit) { const key = h.toLowerCase().replace(/[^a-z0-9]/g, ''); const byKind = Object.entries(KITS[inst]).find(([, v]) => v[1].toLowerCase() === key || v[0].toLowerCase().replace(/[^a-z0-9]/g, '') === key); const id = byKind ? +byKind[0] : DRUM_ALIAS[key]; if (id !== undefined) hs.push({ pitch: kitSnap(inst, id), alt: 0 }); return; }
        const pm = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(h); if (!pm) return;
        hs.push({ pitch: +pm[3] * 7 + LETTERS.indexOf(pm[1].toUpperCase()), alt: pm[2] === '#' ? 1 : pm[2] === 'b' ? -1 : 0 });
      });
      if (!hs.length) { errors.push(tok); return; }
      hs.sort((a, b) => a.pitch - b.pitch); n.pitch = hs[0].pitch; n.alt = hs[0].alt; if (hs.length > 1) n.chord = hs.slice(1);
    }
    if (m[6]) m[6].slice(1, -1).split(',').map((s) => s.trim()).forEach((mk) => {
      if (DYNS.includes(mk)) n.dyn = mk; else if (mk === 'cresc' || mk === 'dim') n.hp = mk;
      else if (ARTS.some((a) => a[0] === mk)) n.art = mk; else if (mk.startsWith('sym=')) n.sym = mk.slice(4); else if (mk.startsWith('lyric=')) n.lyric = mk.slice(6);
    });
    out.push(n);
  });
  return { notes: out, errors };
}
const SYSTEM = `You are Sonnet, a music research, composing and arranging assistant built into a sheet music editor called Quaver. The user's current score is attached to each message in Quaver's text notation.
NOTATION: each note is HEAD:LENGTH. HEAD is a pitch like C4, F#3, Bb5 (octave 4 = middle C octave), a chord like [C4,E4,G4], R for a rest, or for drum kits a sound name: kick, snare, rim, clap, hhc (closed hi-hat), hho (open hi-hat), hhp (hi-hat pedal), ride, crash, tomH, tomM, tomF. LENGTH is w h q e s (whole…sixteenth). Add "." for dotted, "3" for a triplet note, "~" to tie into the next note, and optional marks in braces: {mf,cresc,stac,sym=Am7,lyric=la}. Bars may be separated with |. Marks: dynamics pp p mp mf f ff; cresc dim; stac acc ten ferm trill mord.
Pitches are concert pitch. Each bar must add up to the time signature.

You can do three things:
1. Research and explain: use web search when available for facts about the piece, composer or style; explain the theory in plain language. If unsure, say so.
2. Suggest markings on existing notes: end with ONE fenced \`\`\`json block: an array (max 14) of {"part": index, "bar": 1-based, "beat": 1-based (default 1), "kind": "dyn"|"hairpin"|"articulation", "value": "...", "reason": "..."}.
3. Write music (harmonize, bass lines, drum grooves, counter-melodies, arrangements): end with ONE fenced \`\`\`quaver block containing JSON: {"parts": [{"part": existing index OR "new", "name": "Bass", "inst": instrument key, "startBar": 1-based (default: after the existing music, or 1 for a new part), "replace": true|false, "notes": "C3:q E3:q G3:h | ..."}]}.
Instrument keys: ${Object.keys(INSTR).join(', ')}.
Keep prose short. Never invent bars that do not exist when suggesting markings.`;
function addMsg(cls, text) { const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = text; $('chat').appendChild(d); $('chat').scrollTop = 1e9; return d; }
function findNote(p, bar, beat) {
  const part = S.parts[p]; if (!part) return -1;
  const m = splitMeasures(part.notes)[bar - 1]; if (!m || !m.items.length) return -1;
  let pos = 0, best = m.items[0];
  for (const i of m.items) { if (pos <= (beat || 1) - 1 + EPS) best = i; pos += beats(part.notes[i]); }
  return best;
}
const SUG_OK = { dyn: DYNS, hairpin: ['cresc', 'dim'], articulation: ARTS.map((a) => a[0]) };
function applySuggestions(list) {
  let done = 0;
  mutate(() => {
    list.forEach((s) => {
      if (!SUG_OK[s.kind] || !SUG_OK[s.kind].includes(s.value)) return;
      const i = findNote(+s.part, +s.bar, +s.beat); if (i < 0) return;
      const n = S.parts[+s.part].notes[i], key = s.kind === 'dyn' ? 'dyn' : s.kind === 'hairpin' ? 'hp' : 'art';
      if (key === 'art' && n.type === 'rest' && s.value !== 'ferm') return;
      n[key] = s.value; done++;
    });
  });
  toast(done ? `Added ${done} marking${done > 1 ? 's' : ''}. Undo reverts them.` : 'Nothing could be applied (those bars or notes do not exist).');
}
function applyComposition(block) {
  let added = 0; const msgs = [];
  mutate(() => {
    (block.parts || []).forEach((b) => {
      let p = b.part === 'new' || b.part === undefined || b.part === null ? -1 : +b.part;
      if (p < 0 || !S.parts[p]) {
        if (S.parts.length >= 16) { msgs.push('No room for another part (16 is the maximum).'); return; }
        const inst = INSTR[b.inst] ? b.inst : 'piano'; S.parts.push(newPart(inst, b.name || INSTR[inst].name)); p = S.parts.length - 1;
      }
      const part = S.parts[p], { notes, errors } = parseNotation(String(b.notes || ''), part.inst);
      if (errors.length) msgs.push(`Skipped ${errors.length} unreadable note${errors.length > 1 ? 's' : ''} for ${part.name}.`);
      if (!notes.length) return;
      const used = totalBeats(part.notes), startBar = b.startBar ? Math.max(1, +b.startBar) - 1 : barAt(used) + (barStart(barAt(used)) < used - EPS ? 1 : 0);
      const at = barStart(startBar);
      if (used < at - EPS) part.notes.push(...restsFor(at - used, used));
      let idx = 0, pos = 0; while (idx < part.notes.length && pos < at - EPS) { pos += beats(part.notes[idx]); idx++; }
      if (b.replace) { const len = totalBeats(notes); let j = idx, rem = 0; while (j < part.notes.length && rem < len - EPS) { rem += beats(part.notes[j]); j++; } part.notes.splice(idx, j - idx, ...notes); }
      else part.notes.splice(idx, 0, ...notes);
      added += notes.length; ap = p;
    });
    sel = selA = -1;
  });
  toast(added ? `Added ${added} notes from Sonnet. Undo removes them.` + (msgs.length ? ' ' + msgs.join(' ') : '') : msgs.join(' ') || 'Sonnet’s music could not be read.');
}
function renderSuggestions(list) {
  const box = document.createElement('div'); box.className = 'sugg';
  const label = (s) => `${S.parts[+s.part] ? S.parts[+s.part].name : 'Part ' + s.part}, bar ${s.bar}${s.beat && +s.beat !== 1 ? ' beat ' + s.beat : ''}: ${s.kind === 'dyn' ? s.value : s.kind === 'hairpin' ? (s.value === 'cresc' ? 'crescendo' : 'diminuendo') : (ARTS.find((a) => a[0] === s.value) || [0, s.value])[1].toLowerCase()}${s.reason ? ' – ' + s.reason : ''}`;
  list.forEach((s) => { const row = document.createElement('div'); row.className = 'item'; const sp = document.createElement('span'); sp.textContent = label(s); const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Add'; b.onclick = () => { applySuggestions([s]); b.disabled = true; b.textContent = 'Added'; }; row.append(sp, b); box.appendChild(row); });
  if (list.length > 1) { const all = document.createElement('button'); all.className = 'btn primary'; all.textContent = 'Add all ' + list.length; all.onclick = () => { applySuggestions(list); all.disabled = true; }; box.appendChild(all); }
  $('chat').appendChild(box); $('chat').scrollTop = 1e9;
}
function renderComposition(block) {
  const box = document.createElement('div'); box.className = 'sugg';
  (block.parts || []).forEach((b) => {
    const target = b.part === 'new' || !S.parts[+b.part] ? `New part: ${b.name || (INSTR[b.inst] || INSTR.piano).name}` : S.parts[+b.part].name;
    const { notes, errors } = parseNotation(String(b.notes || ''), b.part === 'new' || !S.parts[+b.part] ? (INSTR[b.inst] ? b.inst : 'piano') : S.parts[+b.part].inst);
    const row = document.createElement('div'); row.className = 'item'; const sp = document.createElement('span');
    sp.textContent = `${target}: ${notes.length} notes${b.startBar ? ' from bar ' + b.startBar : ''}${b.replace ? ' (replaces what is there)' : ''}${errors.length ? ` · ${errors.length} unreadable` : ''}`;
    const pv = document.createElement('button'); pv.className = 'btn'; pv.textContent = 'Listen';
    pv.onclick = () => { const inst = b.part === 'new' || !S.parts[+b.part] ? (INSTR[b.inst] ? b.inst : 'piano') : S.parts[+b.part].inst, kit = !!INSTR[inst].kit; let t = ctx().currentTime + 0.1; const spb = 60 / S.tempo; notes.slice(0, 32).forEach((n) => { const d = beats(n) * spb; if (n.type === 'note') heads(n).forEach((h) => tone(inst, kit ? h.pitch : midiOfP(h.pitch, h.alt), t, d * 0.95, 0.42)); t += d; }); };
    row.append(sp, pv); box.appendChild(row);
  });
  const add = document.createElement('button'); add.className = 'btn primary'; add.textContent = 'Add to score'; add.onclick = () => { applyComposition(block); add.disabled = true; add.textContent = 'Added'; };
  box.appendChild(add); $('chat').appendChild(box); $('chat').scrollTop = 1e9;
}
/* On claude.ai Sonnet asks Claude through the page (the viewer's own Claude account, no API key). */
let sonnetCtl = null, sonnetOff = false;
const SAMPLE_ERRORS = {
  rate_limited: 'Too many requests right now. Wait a minute, then send again.',
  session_expired: 'Sign in to Claude again, then send your message again.',
  refused: 'Sonnet can’t help with that request. Try asking another way.',
  prompt_too_large: 'This score is too long to send in one message. Select fewer bars or ask about one part.',
  empty_completion: 'Sonnet didn’t write anything. Try asking for less at a time.',
};
function setSonnetBusy(on) { busy = on; const b = $('chatsend'); b.textContent = on ? 'Stop' : 'Send'; b.disabled = false; b.classList.toggle('primary', !on); }
async function askHosted(q) {
  if (busy || sonnetOff) return;
  const sample = await cap('sample');
  if (!sample) { addMsg('err', 'Sonnet can’t answer here. Open Quaver on claude.ai or in the Claude app to use it.'); return; }
  setSonnetBusy(true);
  addMsg('user', q); chatLog.push({ role: 'user', content: q });
  const wait = addMsg('bot', 'Sonnet is thinking…'), ctl = (sonnetCtl = new AbortController());
  const turns = chatLog.slice(-12).map((m, i, arr) => (i === arr.length - 1 ? { role: 'user', content: q + '\n\n--- Current score ---\n' + scoreToText() } : m));
  try {
    const res = await sample([{ role: 'user', content: SYSTEM }, ...turns], {
      model: MODEL, modelTier: 'default', cache: false, signal: ctl.signal,
      onText: ({ text }) => { wait.textContent = text.split('```')[0].trim() || 'Sonnet is writing music…'; $('chat').scrollTop = 1e9; },
    });
    handleReply(res.text, wait);
    if (res.truncated) addMsg('err', 'The answer was cut short. Ask for less at a time.');
  } catch (e) {
    const code = e && e.code;
    chatLog.pop();
    if (code === 'cancelled') { if (e.text) wait.textContent = e.text.split('```')[0].trim() + ' …(stopped)'; else wait.remove(); }
    else {
      wait.remove();
      if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code)) {
        sonnetOff = true; $('chatin').disabled = true; $('chips').hidden = true;
        addMsg('err', 'Sonnet is off because Quaver isn’t allowed to use Claude here. The rest of Quaver works as usual.');
      } else addMsg('err', code === 'rate_limited' && e.reason === 'usage_limit' ? 'You’ve reached your Claude usage limit. Try again later.' : SAMPLE_ERRORS[code] || 'Sonnet couldn’t answer just now. Send your message again.');
    }
  } finally { sonnetCtl = null; setSonnetBusy(false); }
}
async function ask(q) {
  if (HOSTED) return askHosted(q);
  const key = $('apikey').value.trim();
  if (!key) { addMsg('err', 'Paste your Anthropic API key above first.'); return; }
  if (busy) return; busy = true; $('chatsend').disabled = true;
  try { if ($('keysave').checked) localStorage.setItem('quaver:apikey', key); else localStorage.removeItem('quaver:apikey'); } catch (e) {}
  addMsg('user', q); chatLog.push({ role: 'user', content: q });
  const wait = addMsg('bot', 'Sonnet is thinking…');
  const messages = chatLog.map((m, i) => (i === chatLog.length - 1 ? { role: 'user', content: q + '\n\n--- Current score ---\n' + scoreToText() } : m));
  const call = (withSearch) => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify(Object.assign({ model: MODEL, max_tokens: 6000, system: SYSTEM, messages }, withSearch ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }] } : {}))
  });
  try {
    let withSearch = $('websearch').checked, res = await call(withSearch), data = await res.json();
    if (!res.ok && withSearch && res.status === 400) { $('websearch').checked = false; res = await call(false); data = await res.json(); if (res.ok) addMsg('err', 'Web search is not enabled for this API key, so Sonnet answered from its own knowledge.'); }
    if (!res.ok) throw new Error((data && data.error && data.error.message) || ('Request failed (' + res.status + ')'));
    handleReply((data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''), wait);
  } catch (e) {
    wait.remove(); chatLog.pop();
    addMsg('err', /Failed to fetch|NetworkError/i.test(String(e.message)) ? 'Could not reach Anthropic. Check your connection and API key.' : String(e.message));
  } finally { busy = false; $('chatsend').disabled = false; }
}
function handleReply(text, wait) {
  let list = [], comp = null;
  const jm = text.match(/```json\s*([\s\S]*?)```/);
  if (jm) { try { const arr = JSON.parse(jm[1]); if (Array.isArray(arr)) list = arr.slice(0, 14).filter((s) => s && typeof s === 'object'); } catch (e) {} text = text.replace(jm[0], '').trim(); }
  const qm = text.match(/```quaver\s*([\s\S]*?)```/);
  if (qm) { try { comp = JSON.parse(qm[1]); } catch (e) { comp = null; } text = text.replace(qm[0], '').trim(); }
  wait.textContent = text || '(No text in the reply.)'; chatLog.push({ role: 'assistant', content: text });
  if (list.length) renderSuggestions(list);
  if (comp && Array.isArray(comp.parts) && comp.parts.length) renderComposition(comp);
}
