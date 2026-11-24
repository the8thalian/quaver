'use strict';
/* Quaver · io.js
   MIDI and MusicXML import/export, compressed .mxl reading, images, printing and score files. */

/* Saves a file and shows okMsg once it is saved. Resolves true if saved (or handed to the browser).
   On claude.ai the viewer confirms each save, and only some file types are allowed, so
   MIDI, MusicXML and WAV go inside a .zip there. */
const SAVE_OK = /\.(png|jpe?g|gif|webp|mp4|webm|txt|json|md|csv|html|svg|pdf|zip)$/i;
async function download(name, blob, okMsg) {
  if (HOSTED) {
    const dl = await cap('downloads');
    if (dl) {
      const zipped = !SAVE_OK.test(name), filename = zipped ? name + '.zip' : name;
      try {
        await dl.save({ filename, data: zipped ? await zipFiles([{ name, blob }]) : blob });
        toast(zipped ? `Saved ${filename}. Open the .zip to get your ${name.split('.').pop().toUpperCase()} file.` : okMsg || 'Saved.');
        return true;
      } catch (e) {
        const code = e && e.code;
        if (code === 'declined') toast('Not saved.');
        else if (code === 'rate_limited') toast('Another save is still waiting for your answer.');
        else if (code === 'too_large') toast('That file is too large to save here. Try a shorter piece.');
        else if (code === 'extension_not_enabled' || code === 'rejected_extension') toast(`This view can't save ${zipped ? '.zip' : 'these'} files, so ${name.split('.').pop().toUpperCase()} export isn't available here.`);
        else toast('Saving files isn\'t available in this view.');
        return false;
      }
    }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  if (okMsg) toast(okMsg);
  return true;
}
/* a minimal .zip writer (files stored, not compressed) */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function zipFiles(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer()), nm = enc.encode(f.name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [12, 0x21, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, nm.length, 2]].forEach(([o, v, s]) => (s === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true)));
    const c = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [14, 0x21, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, nm.length, 2], [42, off, 4]].forEach(([o, v, s]) => (s === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true)));
    parts.push(h.buffer, nm, data); central.push(c.buffer, nm); off += 30 + nm.length + data.length;
  }
  const size = central.reduce((s, b) => s + b.byteLength, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}
const fileBase = () => (S.title || 'score').trim().replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'score';
const xesc = (s) => String(s).replace(/[<&>"']/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/* ---------- instrument guessing for imports ---------- */
/* part names → instruments, in English and the usual Italian, German, French and Spanish spellings (scores often keep them),
   instruments before voice types, so "Sassofono contralto" is an alto sax and not a contralto singer */
const SAX = '(?:sax|sass|saks)';
const NAME_RULES = [
  [/drum|kit\b|percussion|snare|cymbal|batteria|schlagzeug|batterie/, 'drums'], [/conga|bongo|tambourine|shaker|cowbell|woodblock|claves|triangle/, 'handperc'],
  [/timpani|timp\b|pauke|timbales\b/, 'timpani'], [/xylo|silofono/, 'xylophone'], [/glock/, 'glockenspiel'], [/vibra/, 'vibraphone'], [/tubular|chimes|campane/, 'tubularbells'], [/steel/, 'steeldrum'], [/marimba|mallet/, 'marimba'],
  [new RegExp(`bar[iy]\\S*\\.? ?${SAX}|${SAX}\\S*\\.? ?bar[iy]`), 'barisax'], [new RegExp(`tenor\\S*\\.? ?${SAX}|${SAX}\\S*\\.? ?ten`), 'tenorsax'], [new RegExp(SAX), 'altosax'],
  [/bass ?clar|b\. ?cl|clarinetto basso|bassklarinette|clarinette basse|clarinete bajo/, 'bassclarinet'], [/clar|klarin/, 'clarinet'], [/oboe|hautbois|english horn|cor anglais|corno inglese|englischhorn/, 'oboe'],
  [/bassoon|fagott?o?|basson|fagot/, 'bassoon'], [/picc|ottavino/, 'piccolo'], [/fl[uûö]t|flaut|recorder|blockfl/, 'flute'],
  [/trombone|posaune|tromb[oó]n/, 'trombone'], [/tuba|sousaphone/, 'tuba'], [/trump|cornet|flugel|tromba|trompet/, 'trumpet'], [/horn|corno|\bcor\b|trompa/, 'horn'],
  [/contrabass|contrabb|kontrabass|contrebasse|contrabajo|double bass|string bass|upright/, 'doublebass'], [/viola|bratsche|\balto\b.*(?:viol|string)/, 'viola'], [/cello|violoncell/, 'cello'], [/vio|fiddle|geige/, 'violin'], [/strings|string ens|archi\b|streicher/, 'strings'],
  [/electric guitar|el\. ?gtr|e\. ?gtr|e-?guitar|distortion|overdrive|(lead|rhythm) gu?i?ta?r|strat|telecaster|les paul|chitarra elettrica|e-?gitarre|guitare [eé]lectrique/, 'eguitar'],
  [/synth.*bass/, 'synthbass'], [/acoustic bass|ac\. ?bass/, 'bass'], [/bass guitar|electric bass|e\. ?bass|el\. ?bass|fretless|slap bass|^bass$|basso elettrico|e-?bass/, 'ebass'], [/\bpad\b/, 'synthpad'], [/synth|^lead$/, 'synthlead'],
  [/harpsi|clavicembalo|cembalo|clavecin/, 'harpsichord'], [/celesta/, 'celesta'], [/rhodes|e\.? ?piano|electric piano/, 'epiano'], [/pian|keyb|klavier/, 'piano'], [/accord|akkord|fisarmonica/, 'accordion'], [/organ|orgel|orgue/, 'organ'],
  [/harp|arpa|harfe|harpe/, 'harp'], [/guit|chitar|gitar|banjo|mandolin|ukulele|\blute/, 'guitar'],
  [/choir|chorus|satb|\bcoro\b|\bchor\b|ch[oœ]ur/, 'choir'], [/tenor/, 'tenorvoice'], [/\bbass\b|baritone|baritono|bariton/, 'bassvoice'], [/voice|vocal|sopran|alto|mezzo|sing|melody|voce|stimme|voix|canto/, 'voice']
];
function instFromName(name, prog) {
  const s = (name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); // "barítono" reads as "baritono"
  if (s) for (const [re, k] of NAME_RULES) if (re.test(s)) return k;
  if (typeof prog === 'number') {
    const exact = Object.keys(INSTR).find((k) => INSTR[k].prog === prog); if (exact) return exact;
    if (prog < 8) return 'piano'; if (prog < 16) return 'marimba'; if (prog < 24) return 'organ'; if (prog < 26) return 'guitar'; if (prog < 32) return 'eguitar'; if (prog === 32) return 'bass'; if (prog < 38) return 'ebass'; if (prog < 40) return 'synthbass';
    if (prog < 48) return 'violin'; if (prog < 56) return 'strings'; if (prog < 64) return 'trumpet'; if (prog < 72) return 'altosax'; if (prog < 80) return 'flute';
    if (prog < 88) return 'synthlead'; if (prog < 96) return 'synthpad';
  }
  return 'piano';
}

/* ---------- MIDI ---------- */
function parseMIDI(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let p = 0;
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(p++)); return s; };
  if (str(4) !== 'MThd') throw new Error('That is not a MIDI file'); p += 6;   // skip length + format
  const nt = dv.getUint16(p); p += 2; const div = dv.getUint16(p); p += 2;
  if (div & 0x8000) throw new Error('This MIDI file uses SMPTE timing, which is not supported');
  const res = { tpq: div, tempo: 120, ts: [4, 4], key: 0, tracks: [] }; let gotT = false, gotS = false, gotK = false;
  const vlqR = () => { let v = 0, b; do { b = dv.getUint8(p++); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  for (let t = 0; t < nt && p < dv.byteLength; t++) {
    if (str(4) !== 'MTrk') break; const len = dv.getUint32(p); p += 4; const endp = p + len;
    const tr = { name: '', prog: null, progs: {}, notes: [] }; let tick = 0, run = 0; const on = {};
    while (p < endp) {
      tick += vlqR(); let st = dv.getUint8(p);
      if (st < 0x80) st = run; else { p++; if (st < 0xf0) run = st; }
      if (st === 0xff) {
        const type = dv.getUint8(p++), l = vlqR();
        if (type === 0x03) { let s = ''; for (let i = 0; i < l; i++) s += String.fromCharCode(dv.getUint8(p + i)); tr.name = s.trim(); }
        else if (type === 0x51 && !gotT) { res.tempo = Math.round(60000000 / ((dv.getUint8(p) << 16) | (dv.getUint8(p + 1) << 8) | dv.getUint8(p + 2))); gotT = true; }
        else if (type === 0x58 && !gotS) { res.ts = [dv.getUint8(p), 2 ** dv.getUint8(p + 1)]; gotS = true; }
        else if (type === 0x59 && !gotK) { res.key = dv.getInt8(p); gotK = true; }
        p += l;
      } else if (st === 0xf0 || st === 0xf7) p += vlqR();
      else {
        const hi = st & 0xf0, ch = st & 0x0f;
        if (hi === 0xc0 || hi === 0xd0) { const d1 = dv.getUint8(p++); if (hi === 0xc0 && ch !== 9) { if (tr.prog === null) tr.prog = d1; if (tr.progs[ch] === undefined) tr.progs[ch] = d1; } }
        else {
          const d1 = dv.getUint8(p++), d2 = dv.getUint8(p++), k = ch + ':' + d1;
          if (hi === 0x90 && d2 > 0) on[k] = tick;
          else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) { if (on[k] !== undefined) { tr.notes.push({ s: on[k], e: tick, m: d1, ch, dr: ch === 9 }); delete on[k]; } }
        }
      }
    }
    p = endp; if (tr.notes.length) res.tracks.push(tr);
  }
  return res;
}
/* group notes that start together into chords, then keep one line of chords */
function chordEvents(list, tpq) {
  const ns = list.map((n) => ({ start: n.s / tpq, end: n.e / tpq, m: n.m })).sort((a, b) => a.start - b.start), groups = [];
  ns.forEach((n) => { const g = groups[groups.length - 1]; if (g && Math.abs(n.start - g.start) < 0.08) { if (!g.midis.includes(n.m)) g.midis.push(n.m); g.end = Math.max(g.end, n.end); } else groups.push({ start: n.start, end: n.end, midis: [n.m] }); });
  groups.forEach((g, i) => { const nx = groups[i + 1]; if (nx && g.end > nx.start) g.end = nx.start; });
  return groups.filter((g) => g.end - g.start > 0.01).map((g) => ({ start: g.start, dur: g.end - g.start, midis: g.midis.slice(0, 6) }));
}
function drumPart(list, tpq, cap, name) {
  const gm2id = { 35: 31, 40: 35, 45: 36, 48: 37, 52: 40, 53: 38, 55: 40, 57: 40, 59: 38 };
  Object.entries(KITS.drums).forEach(([id, v]) => { gm2id[v[2]] = +id; });
  const evs = chordEvents(list.map((n) => ({ s: n.s, e: n.s + tpq * 0.1, m: gm2id[n.m] !== undefined ? gm2id[n.m] : 35 })), tpq);
  evs.forEach((e, i) => { e.dur = Math.min(2, (evs[i + 1] ? evs[i + 1].start : e.start + 1) - e.start); });
  return { name: name || 'Drum kit', inst: 'drums', clef: 'perc', notes: eventsToNotes(quantizeEvents(evs, 0.25), cap, 0, true, true) };
}
function midiToScore(m, fname) {
  const key = clampKey(m.key), ts = m.ts, cap = ts[0] * 4 / ts[1], parts = [];
  const line = (list, inst, name, extra) => {
    const evs = quantizeEvents(chordEvents(list, m.tpq), 0.25), I = INSTR[inst];
    const all = evs.flatMap((e) => e.midis), avg = all.reduce((s, x) => s + x, 0) / Math.max(1, all.length) + (I.cs || 0);
    return Object.assign({ name, inst, clef: I.clef === 'alto' ? 'alto' : avg < 57 ? 'bass' : 'treble', wclef: I.wclef, notes: eventsToNotes(evs, cap, key) }, extra || {});
  };
  m.tracks.forEach((tr, ti) => {
    const pitched = tr.notes.filter((n) => !n.dr), drums = tr.notes.filter((n) => n.dr);
    // one track can hold several instruments on different channels (every "type 0" file does): give each its own part
    const chans = [...new Set(pitched.map((n) => n.ch))].sort((a, b) => a - b);
    chans.forEach((ch) => {
      if (parts.length >= 16) return;
      const list = chans.length > 1 ? pitched.filter((n) => n.ch === ch) : pitched, prog = tr.progs[ch] !== undefined ? tr.progs[ch] : tr.prog;
      let inst = instFromName(chans.length > 1 ? '' : tr.name, prog); if (INSTR[inst].kit) inst = 'piano';
      const name = (chans.length > 1 ? '' : tr.name) || INSTR[inst].name;
      // a keyboard track that plays in both hands becomes a grand staff, split at middle C
      const hiN = list.filter((n) => n.m >= 60).length, loN = list.length - hiN;
      if (INSTR[inst].grand && hiN >= list.length * 0.15 && loN >= list.length * 0.15 && parts.length < 15) {
        const brace = 'm' + ti + '_' + ch;
        parts.push(line(list.filter((n) => n.m >= 60), inst, name + ' (RH)', { brace, clef: 'treble' }), line(list.filter((n) => n.m < 60), inst, name + ' (LH)', { brace, clef: 'bass', wclef: 'bass' }));
      } else parts.push(line(list, inst, name));
    });
    if (drums.length && parts.length < 16) parts.push(drumPart(drums, m.tpq, cap, pitched.length ? '' : tr.name));
  });
  if (!parts.length) throw new Error('No notes found in that MIDI file');
  return normalize({ title: (fname || '').replace(/\.[^.]+$/, ''), key, ts, tempo: m.tempo, parts });
}
function vlq(v) { const b = [v & 0x7f]; while ((v >>= 7)) b.unshift((v & 0x7f) | 0x80); return b; }
function trackBytes(evs, name) {
  evs.sort((a, b) => a.t - b.t || (a.o || 0) - (b.o || 0));
  const out = []; if (name) { const nm = Array.from(name).map((c) => c.charCodeAt(0) & 127); out.push(0, 0xff, 0x03, nm.length, ...nm); }
  let last = 0; evs.forEach((e) => { out.push(...vlq(e.t - last), ...e.b); last = e.t; }); out.push(0, 0xff, 0x2f, 0);
  return out;
}
function linearEvents(p) {
  const notes = S.parts[p].notes, lev = levels(notes), ev = []; let pos = 0;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i], b = beats(n);
    if (n.type !== 'note') { pos += b; continue; }
    let d = b, j = i;
    while (!isKit(p) && notes[j].tie && notes[j + 1] && notes[j + 1].type === 'note' && sameSounds(p, notes[j], notes[j + 1])) { j++; d += beats(notes[j]); }
    ev.push({ i, start: pos, dur: d, midis: soundsOf(p, n), vel: lev[i] * (n.art === 'acc' ? 1.35 : 1) });
    pos += d; i = j;
  }
  return ev;
}
function buildMIDI() {
  const TPQ = 480, tracks = [], meta = [], nBars = playBars();
  for (let k = 0; k <= nBars; k++) {
    const t = Math.round(barStart(k) * TPQ), b = S.bars[k] || {};
    if (k === 0 || b.tempo) { const mpq = Math.round(60000000 / tempoOf(k)); meta.push({ t, b: [0xff, 0x51, 3, (mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255] }); }
    if (k === 0 || b.ts) { const ts = tsOf(k); meta.push({ t, b: [0xff, 0x58, 4, ts[0], Math.round(Math.log2(ts[1])), 24, 8] }); }
    if (k === 0 || b.key !== undefined) meta.push({ t, b: [0xff, 0x59, 2, keyOf(k) & 255, 0] });
  }
  tracks.push(trackBytes(meta, S.title || ''));
  S.parts.forEach((part, p) => {
    const kit = isKit(p), ch = kit ? 9 : ((p % 15) >= 9 ? (p % 15) + 1 : p % 15), evs = kit ? [] : [{ t: 0, o: 0, b: [0xc0 | ch, INSTR[part.inst].prog] }];
    evs.push({ t: 0, o: 0, b: [0xb0 | ch, 7, Math.round(part.vol * 127)] }, { t: 0, o: 0, b: [0xb0 | ch, 10, Math.round((part.pan + 1) * 63.5)] });
    linearEvents(p).forEach((e) => {
      const vel = Math.max(20, Math.min(127, Math.round(e.vel * 150)));
      e.midis.forEach((mm) => { const nn = kit ? kitInfo(part.inst, mm)[2] : mm; evs.push({ t: Math.round(e.start * TPQ), o: 1, b: [0x90 | ch, nn, vel] }, { t: Math.round((e.start + e.dur) * TPQ), o: 0, b: [0x80 | ch, nn, 0] }); });
    });
    tracks.push(trackBytes(evs, part.name));
  });
  const bytes = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, TPQ >> 8, TPQ & 255];
  tracks.forEach((t) => { const n = t.length; bytes.push(0x4d, 0x54, 0x72, 0x6b, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...t); });
  return new Uint8Array(bytes);
}

/* ---------- MusicXML import ---------- */
const XML_TYPES = { whole: 'w', half: 'h', quarter: 'q', eighth: 'e', '16th': 's', '32nd': 's', '64th': 's', breve: 'w' };
const KIND_SYM = { major: '', minor: 'm', augmented: '+', diminished: 'dim', dominant: '7', 'major-seventh': 'maj7', 'minor-seventh': 'm7', 'diminished-seventh': 'dim7', 'augmented-seventh': '+7', 'half-diminished': 'm7b5', 'major-sixth': '6', 'minor-sixth': 'm6', 'dominant-ninth': '9', 'major-ninth': 'maj9', 'minor-ninth': 'm9', 'suspended-fourth': 'sus4', 'suspended-second': 'sus2', power: '5' };
/* rests that add up to b beats, largest first */
function xmlRests(b) {
  const out = []; let rem = b;
  while (rem > EPS) { const leg = LEGAL.find((l) => l.b <= rem + EPS); if (!leg) break; out.push({ type: 'rest', pitch: 0, alt: 0, dur: leg.d, dots: leg.dots }); rem -= leg.b; }
  return out;
}
function xmlToScore(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Couldn’t read that MusicXML file. It may be damaged or cut short; try exporting or downloading it again.');
  if (!doc.querySelector('score-partwise')) throw new Error('Only “partwise” MusicXML is supported');
  const tx = (el, q) => { const e = el.querySelector(q); return e ? e.textContent.trim() : ''; };
  const names = {}; doc.querySelectorAll('part-list > score-part').forEach((sp) => { names[sp.getAttribute('id')] = { name: tx(sp, 'part-name'), prog: tx(sp, 'midi-program') ? +tx(sp, 'midi-program') - 1 : null }; });
  let key0 = null, ts0 = null, tempo0 = 0, anyTrans = false; const bars = {}; const parts = [];
  const bar = (k) => (bars[k] = bars[k] || {});
  doc.querySelectorAll('score-partwise > part').forEach((partEl, pi) => {
    const info = names[partEl.getAttribute('id')] || { name: '' };
    let div = 1, trans = 0, ckey = 0, lastKey = null, lastTs = null, nStaves = 1; const staves = {}, kitSt = {}, clefs = {}, voiceOf = {}, lastNote = {}, pend = {}, slurOpen = {};
    let ending = null;
    partEl.querySelectorAll(':scope > measure').forEach((me, mi) => {
      const mpos = {}; // beats written so far in this bar, per staff
      Array.from(me.children).forEach((el) => {
        const tag = el.tagName;
        if (tag === 'attributes') {
          if (el.querySelector('divisions')) div = +tx(el, 'divisions') || div;
          if (el.querySelector('staves')) nStaves = Math.max(1, Math.min(4, +tx(el, 'staves') || 1));
          if (el.querySelector('transpose')) { trans = (+tx(el, 'transpose > chromatic') || 0) + 12 * (+tx(el, 'transpose > octave-change') || 0); if (trans) anyTrans = true; }
          if (el.querySelector('key > fifths')) {
            ckey = transKey(+tx(el, 'key > fifths') || 0, trans);
            if (pi === 0) { if (key0 === null) key0 = ckey; else if (ckey !== lastKey) bar(mi).key = ckey; }
            lastKey = ckey;
          }
          if (el.querySelector('time > beats')) {
            const t = [+tx(el, 'time > beats') || 4, +tx(el, 'time > beat-type') || 4];
            if (pi === 0) { if (!ts0) ts0 = t; else if (!lastTs || t[0] !== lastTs[0] || t[1] !== lastTs[1]) bar(mi).ts = t; }
            lastTs = t;
          }
          el.querySelectorAll('clef').forEach((c) => { const num = c.getAttribute('number') || '1', sg = tx(c, 'sign'); clefs[num] = sg === 'F' ? 'bass' : sg === 'C' ? 'alto' : sg === 'percussion' ? 'perc' : 'treble'; });
        } else if (tag === 'direction') {
          const st = tx(el, ':scope > staff') || '1', pd = (pend[st] = pend[st] || {});
          const dt = el.querySelector('dynamics');
          if (dt && dt.firstElementChild) { const d = dt.firstElementChild.tagName; pd.dyn = DYN_LEVEL[d] ? d : d === 'ppp' ? 'pp' : d === 'fff' ? 'ff' : /^s?f/.test(d) ? 'f' : ''; }
          const w = el.querySelector('wedge'); if (w) { const t = w.getAttribute('type'); if (t === 'crescendo') pd.hp = 'cresc'; else if (t === 'diminuendo') pd.hp = 'dim'; }
          const so = el.querySelector('sound[tempo]');
          if (so && pi === 0) { const tm = clampTempo(+so.getAttribute('tempo')); if (mi === 0 && !tempo0) tempo0 = tm; else if (mi > 0) bar(mi).tempo = tm; }
          const rh = el.querySelector('rehearsal'); if (rh && pi === 0) bar(mi).mark = rh.textContent.trim().slice(0, 3);
        } else if (tag === 'harmony') {
          const st = tx(el, ':scope > staff') || '1', step = tx(el, 'root > root-step'), alt = +tx(el, 'root > root-alter') || 0, kindEl = el.querySelector('kind');
          if (step) { const kind = kindEl ? (kindEl.getAttribute('text') !== null ? kindEl.getAttribute('text') : (KIND_SYM[kindEl.textContent.trim()] !== undefined ? KIND_SYM[kindEl.textContent.trim()] : '')) : ''; (pend[st] = pend[st] || {}).sym = step + (alt > 0 ? '#' : alt < 0 ? 'b' : '') + kind; }
        } else if (tag === 'barline' && pi === 0) {
          const rp = el.querySelector('repeat');
          if (rp) { if (rp.getAttribute('direction') === 'forward') bar(mi).repStart = true; else { bar(mi).repEnd = true; if (rp.getAttribute('times')) bar(mi).times = +rp.getAttribute('times'); } }
          const en = el.querySelector('ending');
          if (en) { const num = parseInt(en.getAttribute('number'), 10) || 1, t = en.getAttribute('type'); if (t === 'start') ending = { num, from: mi }; else if (ending) { for (let q = ending.from; q <= mi; q++) bar(q).ending = ending.num; ending = null; } }
        } else if (tag === 'forward') { // an invisible rest in the voice we're reading (unlabelled ones are covered by the bar-end fill)
          const staff = tx(el, ':scope > staff') || '1', voice = tx(el, ':scope > voice');
          if (!voice || voiceOf[staff] !== voice) return;
          const list = staves[staff] || (staves[staff] = []);
          xmlRests((+tx(el, ':scope > duration') || 0) / div).forEach((r) => { list.push(r); mpos[staff] = (mpos[staff] || 0) + beats(r); });
        } else if (tag === 'note') {
          // grace and cue notes take no time in the bar; reading them as real notes pushed every later bar out of line
          if (el.querySelector(':scope > grace, :scope > cue')) return;
          const staff = tx(el, ':scope > staff') || '1', voice = tx(el, ':scope > voice') || '1';
          if (voiceOf[staff] === undefined) voiceOf[staff] = voice; if (voiceOf[staff] !== voice) return;
          const list = staves[staff] || (staves[staff] = []);
          const isChord = !!el.querySelector(':scope > chord'), isRest = !!el.querySelector(':scope > rest'), unp = el.querySelector(':scope > unpitched');
          let head = null;
          if (unp) { kitSt[staff] = true; head = { pitch: (+tx(unp, 'display-octave') || 5) * 7 + Math.max(0, LETTERS.indexOf(tx(unp, 'display-step'))), alt: 0 }; }
          else if (!isRest) {
            const L_ = LETTERS.indexOf(tx(el, 'pitch > step')), oct = +tx(el, 'pitch > octave'), alter = Math.round(+tx(el, 'pitch > alter') || 0);
            if (L_ < 0) return;
            head = trans ? spell(12 * (oct + 1) + SEMI[L_] + alter + trans, ckey) : { pitch: oct * 7 + L_, alt: Math.max(-1, Math.min(1, alter)) };
          }
          if (isChord && lastNote[staff] && head) { const ln = lastNote[staff]; ln.chord = (ln.chord || []).concat([head]); return; }
          const durDiv = +tx(el, ':scope > duration') || 0, type = XML_TYPES[tx(el, ':scope > type')], dots = el.querySelectorAll(':scope > dot').length;
          const tup = +tx(el, 'time-modification > actual-notes') === 3 && +tx(el, 'time-modification > normal-notes') === 2;
          let pieces;
          if (type && !el.querySelector(':scope > rest[measure="yes"]')) pieces = [{ d: type, dots: Math.min(1, dots) }];
          else { let rem = el.querySelector(':scope > rest[measure="yes"]') && lastTs ? lastTs[0] * 4 / lastTs[1] : durDiv / div; pieces = []; while (rem > EPS) { const leg = LEGAL.find((l) => l.b <= rem + EPS) || LEGAL[LEGAL.length - 1]; pieces.push({ d: leg.d, dots: leg.dots }); rem -= leg.b; } }
          pieces.forEach((pc, k) => {
            const n = isRest ? { type: 'rest', pitch: 0, alt: 0, dur: pc.d, dots: pc.dots } : Object.assign({ type: 'note', dur: pc.d, dots: pc.dots }, head);
            if (tup) n.tup = 3;
            if (k === 0) {
              const pd = pend[staff] || {}; ['dyn', 'hp', 'sym'].forEach((f) => { if (pd[f]) { n[f] = pd[f]; delete pd[f]; } });
              if (el.querySelector('articulations > staccato')) n.art = 'stac'; else if (el.querySelector('articulations > accent')) n.art = 'acc'; else if (el.querySelector('articulations > tenuto')) n.art = 'ten';
              if (el.querySelector('notations > fermata')) n.art = 'ferm'; else if (el.querySelector('ornaments > trill-mark')) n.art = 'trill'; else if (el.querySelector('ornaments > mordent, ornaments > inverted-mordent')) n.art = 'mord';
              const ly = el.querySelector('lyric');
              if (ly && tx(ly, 'text')) { const syl = tx(ly, 'syllabic'); n.lyric = tx(ly, 'text') + (syl === 'begin' || syl === 'middle' ? '-' : ''); }
              el.querySelectorAll('notations > slur').forEach((sl) => { const t = sl.getAttribute('type'); if (t === 'start') slurOpen[staff] = list.length; else if (t === 'stop' && slurOpen[staff] !== undefined) { const a = slurOpen[staff]; if (list[a] && list.length > a) list[a].slur = list.length - a; delete slurOpen[staff]; } });
            }
            if (!isRest && (el.querySelector('tie[type="start"]') || k < pieces.length - 1)) n.tie = true;
            list.push(n); if (!isRest) lastNote[staff] = n;
            mpos[staff] = (mpos[staff] || 0) + beats(n);
          });
        }
      });
      // keep every staff in step: fill short bars with rests, and pad a pickup bar at the front so bar lines land in the right places
      for (let s = 1; s <= nStaves; s++) staves[s] = staves[s] || [];
      const cap = lastTs ? lastTs[0] * 4 / lastTs[1] : 4, keys = Object.keys(staves), most = Math.max(0, ...keys.map((s) => mpos[s] || 0));
      const implicit = me.getAttribute('implicit') === 'yes', pickup = mi === 0 && most > EPS && most < cap - EPS;
      const target = pickup || implicit ? most : cap;
      keys.forEach((s) => {
        const short = target - (mpos[s] || 0);
        if (short > EPS) staves[s].push(...xmlRests(short));
        if (pickup) { const lead = xmlRests(cap - most); staves[s].unshift(...lead); if (slurOpen[s] !== undefined) slurOpen[s] += lead.length; }
      });
    });
    const keys = Object.keys(staves).sort(), brace = keys.filter((sk) => staves[sk].some((n) => n.type === 'note')).length > 1 ? 'x' + pi : '';
    keys.forEach((sk) => {
      if (!staves[sk].some((n) => n.type === 'note')) return;
      const xclef = clefs[sk] || (sk === '2' ? 'bass' : 'treble'), isK = kitSt[sk] || xclef === 'perc';
      let inst = instFromName(info.name, info.prog);
      if (isK && !INSTR[inst].kit) inst = 'drums'; if (!isK && INSTR[inst].kit) inst = 'piano';
      const clef = isK ? 'perc' : trans ? INSTR[inst].clef : xclef;
      parts.push({ name: (info.name || 'Part') + (keys.length > 1 ? (sk === '1' ? ' (RH)' : ' (LH)') : ''), inst, clef, wclef: isK ? 'perc' : xclef, notes: staves[sk], brace });
    });
  });
  if (!parts.length) throw new Error('No notes found in that MusicXML file');
  const creator = doc.querySelector('creator[type="composer"]');
  // show it the way the file was written: a file of transposed parts (a bari sax in treble clef, say) opens with
  // Concert pitch off; one saved as a concert-pitch score (MusicXML 4's <concert-score/>) opens with it on
  const concert = !!doc.querySelector('concert-score') || !anyTrans;
  return normalize({ title: tx(doc, 'work-title') || tx(doc, 'movement-title'), composer: creator ? creator.textContent.trim() : '', key: key0 || 0, ts: ts0 || [4, 4], tempo: tempo0 || 100, concert, bars, parts });
}
async function unzipMXL(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf); let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('That does not look like a .mxl file');
  const cnt = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const entries = [];
  for (let i = 0; i < cnt; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    entries.push({ name: new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen)), method, csize, lho }); p += 46 + nlen + elen + clen;
  }
  const ent = entries.find((x) => !x.name.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(x.name));
  if (!ent) throw new Error('No score found inside that .mxl file');
  const nlen = dv.getUint16(ent.lho + 26, true), elen = dv.getUint16(ent.lho + 28, true), st = ent.lho + 30 + nlen + elen, data = u8.subarray(st, st + ent.csize);
  if (ent.method === 0) return new TextDecoder().decode(data);
  return await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
}
/* what to do with files Quaver can't open, by extension */
const IMPORT_HINTS = [
  [/\.(mscz|mscx)$/, 'That’s a MuseScore file. In MuseScore choose File › Export, pick MusicXML, then import the file it saves.'],
  [/\.(sib|musx|mus|dorico|dorico\w*|sty|ptb|gp\d?|gpx)$/, 'Quaver can’t open that program’s own files. Export it as MusicXML (or MIDI) from that program first, then import that.'],
  [/\.pdf$/, 'Quaver can’t read PDFs, which are pictures of the music. Turn it into MusicXML first with a sheet-music scanning app, then import that.'],
  [/\.(png|jpe?g|gif|webp|heic|tiff?|bmp)$/, 'Quaver can’t read photos of sheet music. Turn it into MusicXML first with a sheet-music scanning app, then import that.'],
  [/\.(mp3|m4a|wav|aiff?|ogg|oga|aac|flac|webm|opus|caf)$/, 'That’s a recording. Use Mic › Transcribe a recording instead: it turns a melody into notes.'],
  [/\.(zip)$/, 'That’s a zip file. Unzip it first, then import the .musicxml, .mxl or .mid file inside.']
];
async function importFile(f) {
  const name = f.name.toLowerCase(); let sc;
  const hint = IMPORT_HINTS.find(([re]) => re.test(name)); if (hint) throw new Error(hint[1]);
  let head = ''; try { head = new TextDecoder().decode(new Uint8Array(await f.slice(0, 512).arrayBuffer())); } catch (e) {}
  try {
    // go by what's inside when the name doesn't say (downloads often lose or change their extension)
    if (/\.json$/.test(name) || (!/\.\w+$/.test(name) && /^\s*\{/.test(head))) sc = normalize(JSON.parse(await f.text()));
    else if (/\.(midi?|kar)$/.test(name) || head.startsWith('MThd')) sc = midiToScore(parseMIDI(new Uint8Array(await f.arrayBuffer())), f.name);
    else if (/\.mxl$/.test(name) || head.startsWith('PK')) sc = xmlToScore(await unzipMXL(await f.arrayBuffer()));
    else if (/\.(xml|musicxml)$/.test(name) || /<score-(partwise|timewise)/.test(head) || /^\s*<\?xml/.test(head)) sc = xmlToScore(await f.text());
    else throw new Error('Quaver can import MusicXML (.musicxml, .xml, .mxl), MIDI (.mid) and Quaver score files (.json).');
  } catch (e) {
    if (e && e.constructor === Error) throw e; // our own messages; anything else is a crash on a damaged or unusual file
    throw new Error('Couldn’t read that file. It may be damaged, or saved in a way Quaver can’t read yet. If you can, export it again as MusicXML.');
  }
  if (!sc) throw new Error('That file has no score Quaver can read.');
  return sc;
}

/* ---------- MusicXML export (written pitch, as players read it) ---------- */
const XML_TYPE_NAME = { w: 'whole', h: 'half', q: 'quarter', e: 'eighth', s: '16th' };
const XML_ART = { stac: '<articulations><staccato/></articulations>', acc: '<articulations><accent/></articulations>', ten: '<articulations><tenuto/></articulations>', ferm: '<fermata type="upright"/>', trill: '<ornaments><trill-mark/></ornaments>', mord: '<ornaments><mordent/></ornaments>' };
function symToHarmony(sym) {
  const m = /^([A-G])([#b♯♭]?)(.*)$/.exec(sym.trim()); if (!m) return '';
  const alt = /[#♯]/.test(m[2]) ? 1 : /[b♭]/.test(m[2]) ? -1 : 0, rest = m[3];
  const kind = /^maj7/.test(rest) ? 'major-seventh' : /^m7b5|ø/.test(rest) ? 'half-diminished' : /^dim7/.test(rest) ? 'diminished-seventh' : /^dim/.test(rest) ? 'diminished' : /^(m|min)7/.test(rest) ? 'minor-seventh' : /^(m|min)(?!aj)/.test(rest) ? 'minor' : /^(aug|\+)/.test(rest) ? 'augmented' : /^7/.test(rest) ? 'dominant' : /^sus4/.test(rest) ? 'suspended-fourth' : /^6/.test(rest) ? 'major-sixth' : 'major';
  return `<harmony><root><root-step>${m[1]}</root-step>${alt ? `<root-alter>${alt}</root-alter>` : ''}</root><kind text="${xesc(rest)}">${kind}</kind></harmony>`;
}
function buildMusicXML() {
  const DIV = 24, ids = S.parts.map((_, p) => 'P' + (p + 1));
  let x = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="4.0">`;
  x += `<work><work-title>${xesc(S.title || 'Untitled')}</work-title></work><identification>${S.composer ? `<creator type="composer">${xesc(S.composer)}</creator>` : ''}<encoding><software>Quaver</software></encoding></identification><part-list>`;
  S.parts.forEach((part, p) => {
    const I = INSTR[part.inst];
    x += `<score-part id="${ids[p]}"><part-name>${xesc(part.name)}</part-name><score-instrument id="${ids[p]}-I1"><instrument-name>${xesc(I.name)}</instrument-name></score-instrument><midi-instrument id="${ids[p]}-I1"><midi-channel>${I.kit ? 10 : (p % 15) + 1 >= 10 ? (p % 15) + 2 : (p % 15) + 1}</midi-channel>${I.kit ? '' : `<midi-program>${(I.prog || 0) + 1}</midi-program>`}<volume>${Math.round(part.vol * 100)}</volume><pan>${Math.round(part.pan * 90)}</pan></midi-instrument></score-part>`;
  });
  x += '</part-list>';
  const nBars = Math.max(...S.parts.map((pt) => splitMeasures(pt.notes).filter((m) => m.items.length).length), 1);
  S.parts.forEach((part, p) => {
    const I = INSTR[part.inst], kit = !!I.kit, dn = displayNotes(p, false), ac = shownAcc(p, dn, false), clef = dclef(p, false), ms = splitMeasures(part.notes), tr = I.tr || 0;
    let wedgeOpen = false, slurEnd = -1;
    x += `<part id="${ids[p]}">`;
    for (let k = 0; k < nBars; k++) {
      const m = ms[k] || { items: [] }, b = S.bars[k] || {};
      x += `<measure number="${k + 1}">`;
      if (b.repStart || b.ending) { x += `<barline location="left">${b.ending && (!S.bars[k - 1] || S.bars[k - 1].ending !== b.ending) ? `<ending number="${b.ending}" type="start">${b.ending}.</ending>` : ''}${b.repStart ? '<repeat direction="forward"/>' : ''}</barline>`; }
      const keyChange = k === 0 || b.key !== undefined, tsChange = k === 0 || b.ts;
      if (keyChange || tsChange) {
        x += '<attributes>';
        if (k === 0) x += `<divisions>${DIV}</divisions>`;
        if (keyChange && !kit) x += `<key><fifths>${transKey(keyOf(k), tr)}</fifths></key>`;
        if (tsChange) x += `<time><beats>${tsOf(k)[0]}</beats><beat-type>${tsOf(k)[1]}</beat-type></time>`;
        if (k === 0) {
          x += clef === 'perc' ? '<clef><sign>percussion</sign></clef>' : clef === 'bass' ? '<clef><sign>F</sign><line>4</line></clef>' : clef === 'alto' ? '<clef><sign>C</sign><line>3</line></clef>' : '<clef><sign>G</sign><line>2</line></clef>';
          if (tr) { const oc = -Math.trunc(tr / 12), ch = -(tr + 12 * oc); x += `<transpose><diatonic>${Math.round(ch * 7 / 12)}</diatonic><chromatic>${ch}</chromatic>${oc ? `<octave-change>${oc}</octave-change>` : ''}</transpose>`; }
        }
        x += '</attributes>';
      }
      if (p === 0 && b.mark) x += `<direction placement="above"><direction-type><rehearsal>${xesc(b.mark)}</rehearsal></direction-type></direction>`;
      if (p === 0 && (k === 0 || b.tempo)) x += `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempoOf(k)}</per-minute></metronome></direction-type><sound tempo="${tempoOf(k)}"/></direction>`;
      if (!m.items.length) x += `<note><rest measure="yes"/><duration>${Math.round(capOf(k) * DIV)}</duration><voice>1</voice></note>`;
      m.items.forEach((i) => {
        const n = dn[i], orig = part.notes[i];
        if (n.sym) x += symToHarmony(n.sym);
        if (wedgeOpen && (n.dyn || n.hp)) { x += '<direction><direction-type><wedge type="stop"/></direction-type></direction>'; wedgeOpen = false; }
        if (n.dyn) x += `<direction placement="below"><direction-type><dynamics><${n.dyn}/></dynamics></direction-type></direction>`;
        if (n.hp) { x += `<direction placement="below"><direction-type><wedge type="${n.hp === 'cresc' ? 'crescendo' : 'diminuendo'}"/></direction-type></direction>`; wedgeOpen = true; }
        const dur = Math.round(beats(n) * DIV), prevTie = i > 0 && part.notes[i - 1].tie && part.notes[i - 1].type === 'note';
        const hs = n.type === 'rest' ? [null] : heads(n).map((h, hi) => ({ h, acc: ac[i] ? ac[i][hi] : '' })).sort((a, b2) => a.h.pitch - b2.h.pitch);
        hs.forEach((hh, hi) => {
          x += '<note>' + (hi ? '<chord/>' : '');
          if (!hh) x += '<rest/>';
          else if (kit) x += `<unpitched><display-step>${LETTERS[mod(hh.h.pitch, 7)]}</display-step><display-octave>${Math.floor(hh.h.pitch / 7)}</display-octave></unpitched>`;
          else x += `<pitch><step>${LETTERS[mod(hh.h.pitch, 7)]}</step>${hh.h.alt ? `<alter>${hh.h.alt}</alter>` : ''}<octave>${Math.floor(hh.h.pitch / 7)}</octave></pitch>`;
          x += `<duration>${dur}</duration>`;
          if (hh && prevTie) x += '<tie type="stop"/>'; if (hh && n.tie) x += '<tie type="start"/>';
          x += `<voice>1</voice><type>${XML_TYPE_NAME[n.dur]}</type>${n.dots ? '<dot/>' : ''}`;
          if (hh && hh.acc) x += `<accidental>${{ '#': 'sharp', b: 'flat', n: 'natural' }[hh.acc]}</accidental>`;
          if (n.tup) x += '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
          if (kit && hh && kitInfo(part.inst, hh.h.pitch)[3]) x += '<notehead>x</notehead>';
          let nt = '';
          if (hh && prevTie) nt += '<tied type="stop"/>'; if (hh && n.tie) nt += '<tied type="start"/>';
          if (!hi) { if (orig.slur) { nt += '<slur type="start" number="1"/>'; slurEnd = i + orig.slur; } else if (i === slurEnd) { nt += '<slur type="stop" number="1"/>'; slurEnd = -1; } if (n.art) nt += XML_ART[n.art]; }
          if (nt) x += `<notations>${nt}</notations>`;
          if (!hi && n.lyric) { const t = n.lyric.replace(/-$/, ''), cont = /-$/.test(n.lyric), prevCont = i > 0 && /-$/.test(part.notes[i - 1].lyric || ''); x += `<lyric number="1"><syllabic>${cont ? (prevCont ? 'middle' : 'begin') : prevCont ? 'end' : 'single'}</syllabic><text>${xesc(t)}</text></lyric>`; }
          x += '</note>';
        });
      });
      const nextB = S.bars[k + 1];
      if (b.repEnd || (b.ending && (!nextB || nextB.ending !== b.ending)) || k === nBars - 1) {
        x += '<barline location="right">' + (k === nBars - 1 && !b.repEnd ? '<bar-style>light-heavy</bar-style>' : '');
        if (b.ending && (!nextB || nextB.ending !== b.ending)) x += `<ending number="${b.ending}" type="${b.ending === 1 ? 'stop' : 'discontinue'}"/>`;
        if (b.repEnd) x += `<repeat direction="backward"${b.times && b.times !== 2 ? ` times="${b.times}"` : ''}/>`;
        x += '</barline>';
      }
      x += '</measure>';
    }
    x += '</part>';
  });
  return x + '</score-partwise>';
}

/* ---------- images and printing ---------- */
let fontCSS = null;
async function embedFonts() {
  if (fontCSS !== null) return fontCSS;
  // the fonts bundled with the site (needed on claude.ai, which can't fetch from Google)
  try { const r = await fetch('fonts/embed.css'); if (r.ok) { const t = await r.text(); if (t.includes('@font-face')) return (fontCSS = t); } } catch (e) {}
  try {
    const css = await (await fetch($('fontcss').href)).text();
    const blocks = (css.match(/@font-face\s*{[^}]*}/g) || []).filter((b) => /Noto Music/.test(b) || ((/Newsreader/.test(b) || /Instrument Sans/.test(b)) && /unicode-range:\s*U\+0000-00FF/.test(b)));
    let out = '';
    for (const b of blocks) { const url = b.match(/url\((https:[^)]+)\)/)[1], blob = await (await fetch(url)).blob(); const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); }); out += b.replace(url, data); }
    fontCSS = out;
  } catch (e) { fontCSS = ''; }
  return fontCSS;
}
async function viewSVG(vp, label, W, embed, concert = S.concert) {
  const lay = computeLayout(W, vp, true, concert), inner = buildMarkup(lay, false), head = 96, fonts = embed ? await embedFonts() : '', H = lay.H + head + 10;
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${fonts}</style><rect width="${W}" height="${H}" fill="#fdfdfb"/>
    <text x="${W / 2}" y="46" text-anchor="middle" font-family="Newsreader, Georgia, serif" font-weight="500" font-size="34" fill="${INK}">${esc(S.title || 'Untitled piece')}</text>
    <text x="${W / 2}" y="70" text-anchor="middle" font-family="Newsreader, Georgia, serif" font-style="italic" font-size="17" fill="#33333d">${esc(label || '')}</text>
    <text x="${W - R}" y="88" text-anchor="end" font-family="Newsreader, Georgia, serif" font-style="italic" font-size="16" fill="#44444f">${esc(S.composer || '')}</text>
    <text x="${L}" y="88" font-family="'Noto Music', serif" font-size="18" fill="#33333d">♩ <tspan font-family="Newsreader, Georgia, serif" font-size="15">= ${S.tempo}</tspan></text>
    <g transform="translate(0 ${head})">${inner}</g></svg>`;
  return { markup, W, H };
}
async function exportPNG() {
  toast('Preparing image…');
  const { markup, W, H } = await viewSVG(vpList(), currentLabel(), LAY.W, true), img = new Image(), url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  img.onload = () => { const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2; const g = c.getContext('2d'); g.scale(2, 2); g.drawImage(img, 0, 0); URL.revokeObjectURL(url); c.toBlob((b) => download(fileBase() + '.png', b, 'Image saved.'), 'image/png'); };
  img.onerror = () => toast('Could not create the image.'); img.src = url;
}
function playerGroups() {
  const seen = new Set(), out = [];
  S.parts.forEach((p, i) => { if (seen.has(i)) return; const g = p.brace ? S.parts.map((q, j) => (q.brace === p.brace ? j : -1)).filter((j) => j >= 0) : [i]; g.forEach((j) => seen.add(j)); out.push(g); });
  return out;
}
async function printAll() {
  const host = $('printall'); host.innerHTML = '';
  const groups = playerGroups(), views = groups.length > 1 ? [[S.parts.map((_, i) => i), S.concert ? 'Full score (concert pitch)' : 'Full score (transposed)', S.concert], ...groups.map((g) => [g, braceLabel(S.parts[g[0]].name) + ' – part', false])] : [[groups[0], '', false]];
  for (const [vp, label, conc] of views) { const { markup } = await viewSVG(vp, label, 900, false, conc); const d = document.createElement('div'); d.className = 'page'; d.innerHTML = markup; host.appendChild(d); }
  document.body.classList.add('printall'); const t = document.title; document.title = fileBase();
  window.print(); document.title = t; document.body.classList.remove('printall'); host.innerHTML = '';
}
