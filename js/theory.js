'use strict';
/* Quaver · theory.js
   Constants, instruments, music-theory helpers, the score model and bar maths.
   Loaded first; every other script uses these globals. */

/* Published on claude.ai? Its viewer defines window.claude before any script runs. There the page
   can't reach the microphone or other websites, and saves files and asks Claude through capabilities. */
const HOSTED = !!(window.claude && typeof window.claude.use === 'function');
function cap(name) { return HOSTED ? Promise.resolve(window.claude.use(name)).catch(() => null) : Promise.resolve(null); }

const INK = '#17171d', SEL = '#2f54eb', PLAYC = '#d9480f', GREY = '#8b8b98';
const DUR = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };
const DUR_NAME = { w: 'whole', h: 'half', q: 'quarter', e: 'eighth', s: 'sixteenth' };
const DUR_KEYS = ['w', 'h', 'q', 'e', 's'];
const LETTERS = 'CDEFGAB';
const SEMI = [0, 2, 4, 5, 7, 9, 11];
const CLEFS = {
  treble: { bottom: 30, glyph: '\u{1D11E}' }, bass: { bottom: 18, glyph: '\u{1D122}' },
  alto: { bottom: 24, glyph: '\u{1D121}' }, perc: { bottom: 30, glyph: '' }
};
const SHARP_LETTERS = [3, 0, 4, 1, 5, 2, 6], FLAT_LETTERS = [6, 2, 5, 1, 4, 0, 3];
const KEYPOS = { sharp: [38, 35, 39, 36, 33, 37, 34], flat: [34, 37, 33, 36, 32, 35, 31] };   // treble staff positions
const KOFF = { treble: 0, bass: -14, alto: -7, perc: 0 };                                     // shift per clef
const MAJ = { '-7': 'C♭', '-6': 'G♭', '-5': 'D♭', '-4': 'A♭', '-3': 'E♭', '-2': 'B♭', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F♯', 7: 'C♯' };
const MIN = { '-7': 'A♭', '-6': 'E♭', '-5': 'B♭', '-4': 'F', '-3': 'C', '-2': 'G', '-1': 'D', 0: 'A', 1: 'E', 2: 'B', 3: 'F♯', 4: 'C♯', 5: 'G♯', 6: 'D♯', 7: 'A♯' };
const TIMES = [[2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [2, 2], [3, 2], [3, 8], [5, 8], [6, 8], [7, 8], [9, 8], [12, 8]];

/* clef = clef in concert pitch; wclef = clef the player reads (if different);
   tr = semitones the written part sits above the sound; cs = octave shift kept even in concert pitch;
   sf = General MIDI sample set used for "realistic sounds". */
const INSTR = {
  piano:        { name: 'Piano', fam: 'Keyboards', clef: 'treble', prog: 0, gain: 1.0, sf: 'acoustic_grand_piano', grand: true },
  epiano:       { name: 'Electric piano', fam: 'Keyboards', clef: 'treble', prog: 4, gain: 0.8, sf: 'electric_piano_1', grand: true },
  harpsichord:  { name: 'Harpsichord', fam: 'Keyboards', clef: 'treble', prog: 6, gain: 0.9, sf: 'harpsichord', grand: true },
  organ:        { name: 'Organ', fam: 'Keyboards', clef: 'treble', prog: 19, gain: 0.55, sf: 'drawbar_organ', grand: true },
  accordion:    { name: 'Accordion', fam: 'Keyboards', clef: 'treble', prog: 21, gain: 0.6, sf: 'accordion' },
  celesta:      { name: 'Celesta', fam: 'Keyboards', clef: 'treble', prog: 8, gain: 0.9, tr: -12, cs: -12, sf: 'celesta' },
  violin:       { name: 'Violin', fam: 'Strings', clef: 'treble', prog: 40, gain: 0.6, sf: 'violin' },
  viola:        { name: 'Viola', fam: 'Strings', clef: 'alto', prog: 41, gain: 0.6, sf: 'viola' },
  cello:        { name: 'Cello', fam: 'Strings', clef: 'bass', prog: 42, gain: 0.7, sf: 'cello' },
  doublebass:   { name: 'Double bass', fam: 'Strings', clef: 'bass', prog: 43, gain: 0.85, tr: 12, cs: 12, syn: 'dbass', sf: 'contrabass' },
  strings:      { name: 'String ensemble', fam: 'Strings', clef: 'treble', prog: 48, gain: 0.7, syn: 'ensemble', sf: 'string_ensemble_1' },
  guitar:       { name: 'Guitar', fam: 'Plucked', clef: 'treble', prog: 25, gain: 1.0, tr: 12, cs: 12, sf: 'acoustic_guitar_nylon', tab: [64, 59, 55, 50, 45, 40] },
  eguitar:      { name: 'Electric guitar', fam: 'Plucked', clef: 'treble', prog: 27, gain: 0.9, tr: 12, cs: 12, sf: 'electric_guitar_clean', tab: [64, 59, 55, 50, 45, 40] },
  harp:         { name: 'Harp', fam: 'Plucked', clef: 'treble', prog: 46, gain: 1.0, sf: 'orchestral_harp', grand: true },
  bass:         { name: 'Acoustic bass', fam: 'Plucked', clef: 'bass', prog: 32, gain: 0.9, tr: 12, cs: 12, sf: 'acoustic_bass', tab: [43, 38, 33, 28] },
  ebass:        { name: 'Electric bass', fam: 'Plucked', clef: 'bass', prog: 33, gain: 0.85, tr: 12, cs: 12, sf: 'electric_bass_finger', tab: [43, 38, 33, 28] },
  piccolo:      { name: 'Piccolo', fam: 'Woodwinds', clef: 'treble', prog: 72, gain: 0.55, tr: -12, cs: -12, syn: 'flute', sf: 'piccolo' },
  flute:        { name: 'Flute', fam: 'Woodwinds', clef: 'treble', prog: 73, gain: 0.8, sf: 'flute' },
  oboe:         { name: 'Oboe', fam: 'Woodwinds', clef: 'treble', prog: 68, gain: 0.6, sf: 'oboe' },
  clarinet:     { name: 'Clarinet', fam: 'Woodwinds', clef: 'treble', prog: 71, gain: 0.55, tr: 2, sf: 'clarinet' },
  bassclarinet: { name: 'Bass clarinet', fam: 'Woodwinds', clef: 'bass', wclef: 'treble', prog: 71, gain: 0.8, tr: 14, syn: 'bassclar', sf: 'clarinet' },
  bassoon:      { name: 'Bassoon', fam: 'Woodwinds', clef: 'bass', prog: 70, gain: 0.7, sf: 'bassoon' },
  altosax:      { name: 'Alto saxophone', fam: 'Saxophones', clef: 'treble', prog: 65, gain: 0.6, tr: 9, sf: 'alto_sax' },
  tenorsax:     { name: 'Tenor saxophone', fam: 'Saxophones', clef: 'treble', prog: 66, gain: 0.6, tr: 14, cs: 12, sf: 'tenor_sax' },
  barisax:      { name: 'Baritone saxophone', fam: 'Saxophones', clef: 'bass', wclef: 'treble', prog: 67, gain: 0.65, tr: 21, sf: 'baritone_sax' },
  trumpet:      { name: 'Trumpet', fam: 'Brass', clef: 'treble', prog: 56, gain: 0.5, tr: 2, sf: 'trumpet' },
  horn:         { name: 'French horn', fam: 'Brass', clef: 'treble', prog: 60, gain: 0.6, tr: 7, sf: 'french_horn' },
  trombone:     { name: 'Trombone', fam: 'Brass', clef: 'bass', prog: 57, gain: 0.55, sf: 'trombone' },
  tuba:         { name: 'Tuba', fam: 'Brass', clef: 'bass', prog: 58, gain: 0.7, sf: 'tuba' },
  voice:        { name: 'Voice', fam: 'Voices', clef: 'treble', prog: 53, gain: 0.6, sf: 'voice_oohs' },
  tenorvoice:   { name: 'Tenor voice', fam: 'Voices', clef: 'treble', prog: 53, gain: 0.6, tr: 12, cs: 12, syn: 'voice', sf: 'voice_oohs' },
  bassvoice:    { name: 'Bass voice', fam: 'Voices', clef: 'bass', prog: 53, gain: 0.7, syn: 'lowvoice', sf: 'voice_oohs' },
  choir:        { name: 'Choir', fam: 'Voices', clef: 'treble', prog: 52, gain: 0.6, sf: 'choir_aahs' },
  marimba:      { name: 'Marimba', fam: 'Pitched percussion', clef: 'treble', prog: 12, gain: 1.0, sf: 'marimba', grand: true },
  xylophone:    { name: 'Xylophone', fam: 'Pitched percussion', clef: 'treble', prog: 13, gain: 0.9, tr: -12, cs: -12, sf: 'xylophone' },
  glockenspiel: { name: 'Glockenspiel', fam: 'Pitched percussion', clef: 'treble', prog: 9, gain: 0.7, tr: -24, cs: -24, sf: 'glockenspiel' },
  vibraphone:   { name: 'Vibraphone', fam: 'Pitched percussion', clef: 'treble', prog: 11, gain: 0.9, sf: 'vibraphone' },
  tubularbells: { name: 'Tubular bells', fam: 'Pitched percussion', clef: 'treble', prog: 14, gain: 0.7, sf: 'tubular_bells' },
  timpani:      { name: 'Timpani', fam: 'Pitched percussion', clef: 'bass', prog: 47, gain: 1.0, sf: 'timpani' },
  steeldrum:    { name: 'Steel drum', fam: 'Pitched percussion', clef: 'treble', prog: 114, gain: 0.8, sf: 'steel_drums' },
  drums:        { name: 'Drum kit', fam: 'Unpitched percussion', clef: 'perc', gain: 1.0, kit: true },
  handperc:     { name: 'Hand percussion', fam: 'Unpitched percussion', clef: 'perc', gain: 1.0, kit: true },
  synthlead:    { name: 'Synth lead', fam: 'Electronic', clef: 'treble', prog: 80, gain: 0.45, sf: 'lead_1_square' },
  synthpad:     { name: 'Synth pad', fam: 'Electronic', clef: 'treble', prog: 89, gain: 0.6, sf: 'pad_2_warm', grand: true },
  synthbass:    { name: 'Synth bass', fam: 'Electronic', clef: 'bass', prog: 38, gain: 0.7, sf: 'synth_bass_1' }
};
const FAMS = ['Keyboards', 'Strings', 'Plucked', 'Woodwinds', 'Saxophones', 'Brass', 'Voices', 'Pitched percussion', 'Unpitched percussion', 'Electronic'];
const TRN = { 2: 'B♭', 7: 'F', 9: 'E♭', 14: 'B♭', 21: 'E♭' };
/* percussion: staff position → [name, sound, General MIDI note, x notehead] */
const KITS = {
  drums: { 29: ['Hi-hat pedal', 'hhp', 44, true], 30: ['Hand clap', 'clap', 39, false], 31: ['Bass drum', 'kick', 36, false], 32: ['Low floor tom', 'tomF2', 41, false], 33: ['Floor tom', 'tomF', 43, false], 34: ['Side stick', 'rim', 37, true], 35: ['Snare drum', 'snare', 38, false], 36: ['Mid tom', 'tomM', 47, false], 37: ['High tom', 'tomH', 50, false], 38: ['Ride cymbal', 'ride', 51, true], 39: ['Closed hi-hat', 'hhc', 42, true], 40: ['Crash cymbal', 'crash', 49, true], 41: ['Open hi-hat', 'hho', 46, true] },
  handperc: { 29: ['Shaker', 'shaker', 70, true], 30: ['Low conga', 'congaL', 64, false], 31: ['High conga', 'congaH', 63, false], 32: ['Low bongo', 'bongoL', 61, false], 33: ['High bongo', 'bongo', 60, false], 34: ['Claves', 'claves', 75, true], 35: ['Woodblock', 'woodblock', 76, false], 36: ['Cowbell', 'cowbell', 56, false], 37: ['Tambourine', 'tamb', 54, true], 38: ['Triangle', 'triangle', 81, true] }
};
const ABBR = { eguitar: 'E. Gtr.', epiano: 'E. Pno.', harpsichord: 'Hpsd.', accordion: 'Acc.', doublebass: 'Db.', strings: 'Strings', bassclarinet: 'B. Cl.', altosax: 'A. Sax', tenorsax: 'T. Sax', barisax: 'Bar. Sax',
  horn: 'Hn.', trombone: 'Tbn.', tenorvoice: 'Tenor', bassvoice: 'Bass', glockenspiel: 'Glock.', xylophone: 'Xyl.', vibraphone: 'Vib.', tubularbells: 'T. Bells', steeldrum: 'St. Drum',
  handperc: 'Perc.', synthlead: 'Synth', synthpad: 'Pad', synthbass: 'Syn. Bass', piccolo: 'Picc.', bass: 'Ac. Bass', ebass: 'E. Bass', clarinet: 'Cl.', trumpet: 'Tpt.', bassoon: 'Bsn.', piano: 'Pno.' };
const DYN_LEVEL = { pp: 0.12, p: 0.2, mp: 0.3, mf: 0.42, f: 0.58, ff: 0.8 };
const DYNS = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
const ARTS = [['stac', 'Staccato'], ['acc', 'Accent'], ['ten', 'Tenuto'], ['ferm', 'Fermata'], ['trill', 'Trill'], ['mord', 'Mordent']];
const LEGAL = [
  { b: 4, d: 'w', dots: 0 }, { b: 3, d: 'h', dots: 1 }, { b: 2, d: 'h', dots: 0 }, { b: 1.5, d: 'q', dots: 1 }, { b: 1, d: 'q', dots: 0 },
  { b: 0.75, d: 'e', dots: 1 }, { b: 0.5, d: 'e', dots: 0 }, { b: 0.375, d: 's', dots: 1 }, { b: 0.25, d: 's', dots: 0 }
];
const EPS = 1e-6;
const mod = (a, b) => ((a % b) + b) % b;
const clampKey = (k) => Math.max(-7, Math.min(7, Math.round(+k || 0)));
const clampTempo = (t) => Math.max(30, Math.min(260, Math.round(+t || 100)));

/* user preferences (not part of the score) */
const prefs = { click: false, real: false, names: false, finger: false, loop: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('quaver:prefs') || '{}')); } catch (e) {}
function savePrefs() { try { localStorage.setItem('quaver:prefs', JSON.stringify(prefs)); } catch (e) {} }

let S = null;   // the score being edited

/* ---------- pitch ---------- */
const beats = (n) => DUR[n.dur] * (n.dots ? 1.5 : 1) * (n.tup ? 2 / 3 : 1);
function keyAlter(letter, k) {
  if (k > 0 && SHARP_LETTERS.slice(0, k).includes(letter)) return 1;
  if (k < 0 && FLAT_LETTERS.slice(0, -k).includes(letter)) return -1;
  return 0;
}
const altOfAcc = (acc) => ({ '#': 1, b: -1, n: 0 }[acc]);
const midiOfP = (pitch, alt) => 12 * (Math.floor(pitch / 7) + 1) + SEMI[mod(pitch, 7)] + (alt || 0);
const midiOf = (n) => midiOfP(n.pitch, n.alt || 0);
const heads = (n) => [{ pitch: n.pitch, alt: n.alt || 0 }].concat(n.chord || []);
const midisOf = (n) => heads(n).map((h) => midiOfP(h.pitch, h.alt || 0));
function pitchName(pitch, alt, ascii) {
  const a = alt > 0 ? (ascii ? '#' : '♯') : alt < 0 ? (ascii ? 'b' : '♭') : '';
  return LETTERS[mod(pitch, 7)] + a + Math.floor(pitch / 7);
}
const noteName = (n, ascii) => pitchName(n.pitch, n.alt || 0, ascii);
function midiName(m) { return ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'][mod(m, 12)] + (Math.floor(m / 12) - 1); }
/* spell a MIDI number as a staff position + alteration that fits the key */
function spell(midi, key) {
  const pc = mod(midi, 12); let L_ = -1, alter = 0;
  for (let l = 0; l < 7; l++) { if (mod(SEMI[l] + keyAlter(l, key), 12) === pc) { L_ = l; alter = keyAlter(l, key); break; } }
  if (L_ < 0) {
    const sharpT = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
    const flatT = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
    [L_, alter] = (key < 0 ? flatT : sharpT)[pc];
  }
  const oct = Math.round((midi - SEMI[L_] - alter) / 12) - 1;
  return { pitch: oct * 7 + L_, alt: alter };
}
function transKey(k, t) { if (mod(t, 12) === 0) return k; let f = k + mod(t * 7, 12); while (f > 6) f -= 12; while (f < -6) f += 12; return f; }

/* ---------- instruments ---------- */
const isKit = (p) => !!INSTR[S.parts[p].inst].kit;
const kitIds = (inst) => Object.keys(KITS[inst] || KITS.drums).map(Number);
const kitSnap = (inst, id) => kitIds(inst).reduce((a, b) => (Math.abs(b - id) < Math.abs(a - id) ? b : a));
function kitInfo(inst, id) { const K = KITS[inst] || KITS.drums; return K[id] || K[kitSnap(inst, id)]; }
const soundsOf = (p, n) => (isKit(p) ? heads(n).map((h) => h.pitch) : midisOf(n));
const instLabel = (k) => INSTR[k].name + (TRN[INSTR[k].tr] ? ` (in ${TRN[INSTR[k].tr]})` : '');
function instOptions() {
  return FAMS.map((f) => `<optgroup label="${f}">` + Object.keys(INSTR).filter((k) => INSTR[k].fam === f).map((k) => `<option value="${k}">${instLabel(k)}</option>`).join('') + '</optgroup>').join('');
}

/* ---------- bars: time signature, key and tempo can change from any bar ---------- */
const BT = { start: [0], cap: [], ts: [], key: [], tempo: [] };
function resetBarTable() { BT.start = [0]; BT.cap = []; BT.ts = []; BT.key = []; BT.tempo = []; }
function ensureBars(k) {
  while (BT.cap.length <= k) {
    const j = BT.cap.length, b = S.bars && S.bars[j];
    const ts = b && b.ts ? b.ts : j ? BT.ts[j - 1] : S.ts;
    const key = b && b.key !== undefined ? b.key : j ? BT.key[j - 1] : S.key;
    const tempo = b && b.tempo ? b.tempo : j ? BT.tempo[j - 1] : S.tempo;
    BT.ts.push(ts); BT.key.push(key); BT.tempo.push(tempo);
    BT.cap.push(ts[0] * 4 / ts[1]); BT.start.push(BT.start[j] + BT.cap[j]);
  }
}
const capOf = (k) => (ensureBars(k), BT.cap[k]);
const tsOf = (k) => (ensureBars(k), BT.ts[k]);
const keyOf = (k) => (ensureBars(k), BT.key[k]);
const tempoOf = (k) => (ensureBars(k), BT.tempo[k]);
const barStart = (k) => (ensureBars(k), BT.start[k]);
function barAt(pos) {
  while (BT.start[BT.start.length - 1] <= pos + EPS) ensureBars(BT.cap.length);
  let lo = 0, hi = BT.cap.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (BT.start[m] <= pos + EPS) lo = m; else hi = m - 1; }
  return lo;
}
const beatUnitOf = (k) => { const ts = tsOf(k); return ts[1] === 8 && ts[0] % 3 === 0 ? 1.5 : ts[1] === 2 ? 2 : 1; };
function splitMeasures(notes) {
  const ms = []; let cur = { start: 0, items: [], beats: 0 };
  notes.forEach((n, i) => {
    cur.items.push(i); cur.beats += beats(n);
    if (cur.beats >= capOf(ms.length) - 1e-4) { ms.push(cur); cur = { start: i + 1, items: [], beats: 0 }; }
  });
  ms.push(cur); return ms;
}
const notePos = (notes, i) => { let pos = 0; for (let j = 0; j < i; j++) pos += beats(notes[j]); return pos; };
const totalBeats = (notes) => notes.reduce((s, n) => s + beats(n), 0);

/* Keep every bar the right length: a note that runs past the barline is split and tied into the next bar. */
function legalPieces(len, pos) {
  const pieces = []; let rem = len;
  while (rem > EPS) {
    const left = barStart(barAt(pos) + 1) - pos;
    let chunk = Math.min(rem, left);
    while (chunk > EPS) { const leg = LEGAL.find((l) => l.b <= chunk + EPS) || LEGAL[LEGAL.length - 1]; pieces.push(leg); chunk -= leg.b; rem -= leg.b; pos += leg.b; }
  }
  return pieces;
}
function reflowBars(notes, kit) {
  const out = []; let pos = 0, split = false;
  for (const n of notes) {
    const b = beats(n), left = barStart(barAt(pos) + 1) - pos;
    if (b <= left + 1e-4 || n.tup) { out.push(n); pos += b; continue; }
    split = true;
    const pieces = legalPieces(b, pos);
    pieces.forEach((leg, k) => {
      const first = k === 0, last = k === pieces.length - 1; let m;
      if (n.type === 'rest' || (kit && !first)) m = { type: 'rest', pitch: 0, alt: 0, dur: leg.d, dots: leg.dots };
      else {
        m = Object.assign({}, n, { dur: leg.d, dots: leg.dots });
        if (!first) { delete m.dyn; delete m.hp; delete m.lyric; delete m.sym; delete m.slur; if (m.art !== 'ferm') delete m.art; }
        if (!last && m.art === 'ferm') delete m.art;
        if (!kit) { if (last) { if (n.tie) m.tie = true; else delete m.tie; } else m.tie = true; }
      }
      out.push(m); pos += leg.b;
    });
  }
  return split ? out : notes;
}
function restsFor(len, pos) { return legalPieces(len, pos).map((leg) => ({ type: 'rest', pitch: 0, alt: 0, dur: leg.d, dots: leg.dots })); }

/* ---------- performance data → notation (mic, MIDI import, Sonnet) ---------- */
function quantizeEvents(evs, g) {
  const out = []; let end = 0;
  evs.slice().sort((a, b) => a.start - b.start).forEach((e) => {
    let s = Math.max(0, Math.round(e.start / g) * g), f = Math.round((e.start + e.dur) / g) * g;
    if (s < end) s = end; if (f <= s) f = s + g; if (f - s < 0.25) f = s + 0.25;
    out.push({ start: s, dur: f - s, midis: e.midis || [e.midi] }); end = f;
  });
  return out;
}
/* fixed-bar-length version used before a score is loaded */
function eventsToNotes(evs, cap, key, pad = true, kit = false) {
  const out = []; let pos = 0;
  const barLeft = () => { const r = mod(pos, cap); return r < EPS || cap - r < EPS ? cap : cap - r; };
  function emit(len, midis) {
    let rem = len; const pieces = [];
    while (rem > EPS) { let chunk = Math.min(rem, barLeft()); while (chunk > EPS) { const leg = LEGAL.find((l) => l.b <= chunk + EPS) || LEGAL[LEGAL.length - 1]; pieces.push(leg); chunk -= leg.b; pos += leg.b; rem -= leg.b; } }
    pieces.forEach((leg, k) => {
      const asRest = !midis || (kit && k > 0);
      let n;
      if (asRest) n = { type: 'rest', pitch: 0, alt: 0, dur: leg.d, dots: leg.dots };
      else {
        const hs = midis.slice().sort((a, b) => a - b).map((m) => (kit ? { pitch: m, alt: 0 } : spell(m, key)));
        n = { type: 'note', pitch: hs[0].pitch, alt: hs[0].alt, dur: leg.d, dots: leg.dots };
        if (hs.length > 1) n.chord = hs.slice(1);
        if (!kit && k < pieces.length - 1) n.tie = true;
      }
      out.push(n);
    });
  }
  evs.forEach((e) => { if (e.start > pos + EPS) emit(e.start - pos, null); emit(Math.max(0.25, e.dur), e.midis || [e.midi]); });
  const r = mod(pos, cap); if (pad && r > EPS && cap - r > EPS) emit(cap - r, null);
  return out;
}

/* ---------- the score object ---------- */
function migrateNote(n, key, kit) {
  const m = Object.assign({}, n);
  const fix = (h) => { const a = altOfAcc(h.acc); const alt = h.alt !== undefined ? +h.alt || 0 : a !== undefined ? a : keyAlter(mod(h.pitch, 7), key); return Math.max(-1, Math.min(1, alt)); };
  m.pitch = Math.round(+m.pitch || 0);
  m.alt = m.type === 'note' && !kit ? fix(m) : 0; delete m.acc;
  if (Array.isArray(m.chord) && m.chord.length) m.chord = m.chord.map((c) => ({ pitch: Math.round(+c.pitch || 0), alt: kit ? 0 : fix(c) })); else delete m.chord;
  if (!DUR[m.dur]) m.dur = 'q';
  m.dots = m.dots ? 1 : 0;
  if (m.tup) m.tup = 3; else delete m.tup;
  return m;
}
function newPart(inst, name, extra) {
  const I = INSTR[inst];
  return Object.assign({ name: name || I.name, inst, clef: I.clef, wclef: I.wclef || I.clef, notes: [], mute: false, solo: false, vol: 0.8, pan: 0, brace: '', tab: false }, extra || {});
}
function grandParts(inst, name) {
  const id = 'g' + Math.random().toString(36).slice(2, 8);
  return [newPart(inst, name + ' (RH)', { brace: id }), newPart(inst, name + ' (LH)', { brace: id, clef: 'bass', wclef: 'bass' })];
}
function blankScore(parts) { return { title: '', composer: '', key: 0, ts: [4, 4], tempo: 100, concert: true, swing: false, bars: {}, parts: parts || grandParts('piano', 'Piano') }; }
function normalize(o) {
  if (!o || typeof o !== 'object') return null;
  if (!o.parts && Array.isArray(o.notes)) o = Object.assign({}, o, { parts: [{ name: 'Part 1', inst: 'piano', clef: o.clef || 'treble', notes: o.notes }] });
  if (!Array.isArray(o.parts) || !o.parts.length) return null;
  const key = clampKey(o.key);
  const s = {
    title: String(o.title || ''), composer: String(o.composer || ''), key,
    ts: Array.isArray(o.ts) && o.ts.length === 2 ? o.ts.map(Number) : [4, 4], tempo: clampTempo(o.tempo),
    concert: o.concert !== false, swing: !!o.swing, bars: {}, parts: []
  };
  if (o.bars && typeof o.bars === 'object') {
    for (const [k, b] of Object.entries(o.bars)) {
      if (!b || isNaN(+k)) continue; const c = {};
      if (b.key !== undefined && b.key !== null && b.key !== '') c.key = clampKey(b.key);
      if (Array.isArray(b.ts) && b.ts.length === 2) c.ts = b.ts.map(Number);
      if (b.tempo) c.tempo = clampTempo(b.tempo);
      if (b.repStart) c.repStart = true; if (b.repEnd) c.repEnd = true;
      if (b.times) c.times = Math.max(2, Math.min(8, +b.times));
      if (b.ending) c.ending = Math.max(1, Math.min(4, +b.ending));
      if (b.mark) c.mark = String(b.mark).slice(0, 3);
      if (Object.keys(c).length) s.bars[+k] = c;
    }
  }
  s.parts = o.parts.slice(0, 16).map((p, i) => {
    const inst = INSTR[p.inst] ? p.inst : 'piano', I = INSTR[inst], kit = !!I.kit, ok = (c) => CLEFS[c] && c !== 'perc';
    const clef = kit ? 'perc' : ok(p.clef) ? p.clef : I.clef;
    return {
      name: String(p.name || I.name || 'Part ' + (i + 1)), inst, clef, wclef: kit ? 'perc' : ok(p.wclef) ? p.wclef : (I.wclef || clef),
      notes: (Array.isArray(p.notes) ? p.notes : []).filter((n) => n && (n.type === 'note' || n.type === 'rest')).map((n) => migrateNote(n, key, kit)),
      mute: !!p.mute, solo: !!p.solo, vol: p.vol === undefined ? 0.8 : Math.max(0, Math.min(1, +p.vol)), pan: Math.max(-1, Math.min(1, +p.pan || 0)),
      brace: String(p.brace || ''), tab: !!p.tab && !!I.tab
    };
  });
  return s;
}

/* ---------- templates and the demo ---------- */
const TEMPLATES = [
  ['blank', 'Piano (grand staff)', () => grandParts('piano', 'Piano')],
  ['single', 'Single staff', () => [newPart('piano')]],
  ['lead', 'Lead sheet (melody + chords)', () => [newPart('voice', 'Melody')]],
  ['jazz', 'Jazz combo', () => [newPart('altosax'), newPart('tenorsax'), newPart('trumpet'), ...grandParts('piano', 'Piano'), newPart('doublebass'), newPart('drums')], { swing: true }],
  ['saxq', 'Saxophone quartet', () => [newPart('altosax', 'Alto sax 1'), newPart('altosax', 'Alto sax 2'), newPart('tenorsax'), newPart('barisax')]],
  ['rock', 'Rock band', () => [newPart('voice', 'Vocals'), newPart('eguitar', 'Electric guitar', { tab: true }), newPart('ebass', 'Electric bass', { tab: true }), newPart('drums')]],
  ['strq', 'String quartet', () => [newPart('violin', 'Violin I'), newPart('violin', 'Violin II'), newPart('viola'), newPart('cello')]],
  ['brass', 'Brass quintet', () => [newPart('trumpet', 'Trumpet 1'), newPart('trumpet', 'Trumpet 2'), newPart('horn'), newPart('trombone'), newPart('tuba')]],
  ['choir', 'SATB choir', () => [newPart('voice', 'Soprano'), newPart('voice', 'Alto'), newPart('tenorvoice', 'Tenor'), newPart('bassvoice', 'Bass')]],
  ['band', 'Concert band', () => [newPart('piccolo'), newPart('flute'), newPart('oboe'), newPart('clarinet', 'Clarinet 1'), newPart('clarinet', 'Clarinet 2'), newPart('bassclarinet'), newPart('bassoon'), newPart('altosax'), newPart('tenorsax'), newPart('barisax'), newPart('trumpet', 'Trumpet 1'), newPart('trumpet', 'Trumpet 2'), newPart('horn'), newPart('trombone'), newPart('tuba'), newPart('drums', 'Percussion')]]
];
function makeTemplate(id) {
  const t = TEMPLATES.find((x) => x[0] === id) || TEMPLATES[0];
  return Object.assign(blankScore(t[2]()), t[3] || {});
}
function demoScore() {
  const q = (p, x) => Object.assign({ type: 'note', pitch: p, alt: 0, dur: 'q', dots: 0 }, x || {});
  const words = 'Freu- de, schö- ner Göt- ter- fun- ken, Toch- ter aus E- ly- si- um, Wir be- tre- ten feu- er- trun- ken, Himm- li- sche, dein Hei- lig- tum!'.split(' ');
  const mel = [
    q(30, { dyn: 'mf', sym: 'C' }), q(30), q(31), q(32), q(32, { sym: 'G' }), q(31), q(30), q(29),
    q(28, { hp: 'cresc', sym: 'C' }), q(28), q(29), q(30), q(30, { dots: 1, dyn: 'f', art: 'acc', sym: 'G' }), q(29, { dur: 'e' }), q(29, { dur: 'h' }),
    q(30, { dyn: 'p', sym: 'C' }), q(30), q(31), q(32), q(32, { sym: 'G' }), q(31), q(30), q(29),
    q(28, { hp: 'cresc', sym: 'C' }), q(28), q(29), q(30), q(29, { dots: 1, dyn: 'f', sym: 'G' }), q(28, { dur: 'e' }), q(28, { dur: 'h', art: 'ferm', sym: 'C' })
  ];
  mel.forEach((n, i) => { n.lyric = words[i]; });
  const bassLine = [21, 18, 21, 18, 21, 18, 21].map((p) => q(p, { dur: 'w' })).concat([q(18, { dur: 'h' }), q(21, { dur: 'h' })]);
  return {
    title: 'Ode to Joy', composer: 'L. van Beethoven', key: 0, ts: [4, 4], tempo: 100, concert: true, swing: false, bars: { 0: { repStart: true }, 3: { repEnd: true } },
    parts: [newPart('violin', 'Violin', { notes: mel }), newPart('cello', 'Cello', { notes: bassLine })]
  };
}
