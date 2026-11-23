'use strict';
/* Quaver · render.js
   Turns the score into SVG: layout (bars, systems, columns) and drawing of every notation element. */

const STEP = 125, STAFF0 = 95, L = 20, R = 20, TAB_GAP = 11;
let LAY = null;
let practiceMarks = {};   // "p:i" → 'ok' | 'bad' after a practice run

/* ---------- what each part looks like in the current view ---------- */
function dshift(p, concert) { const I = INSTR[S.parts[p].inst]; return I.kit ? 0 : concert ? (I.cs || 0) : (I.tr || 0); }
function dclef(p, concert) {
  const part = S.parts[p], I = INSTR[part.inst];
  if (I.kit) return 'perc';
  return concert || (I.tr || 0) === (I.cs || 0) ? part.clef : (part.wclef || I.wclef || part.clef);
}
const writtenKey = (p, k, concert) => (isKit(p) ? 0 : transKey(keyOf(k), dshift(p, concert)));
function displayNotes(p, concert) {
  const notes = S.parts[p].notes, sh = dshift(p, concert);
  if (!sh) return notes;
  let pos = 0;
  return notes.map((n) => {
    const k = barAt(pos); pos += beats(n);
    if (n.type !== 'note') return n;
    const wk = transKey(keyOf(k), sh), m = Object.assign({}, n, spell(midiOf(n) + sh, wk));
    if (n.chord) m.chord = n.chord.map((c) => spell(midiOfP(c.pitch, c.alt) + sh, wk));
    return m;
  });
}
/* a note entered in the displayed (maybe transposed) staff → stored concert pitch */
function headToConcert(p, h, k, concert = S.concert) {
  if (isKit(p)) return { pitch: h.pitch, alt: 0 };
  const sh = dshift(p, concert); if (!sh) return h;
  return spell(midiOfP(h.pitch, h.alt) - sh, keyOf(k));
}
function toConcert(p, n, k) {
  if (n.type !== 'note') return n;
  const m = Object.assign({}, n, headToConcert(p, n, k));
  if (n.chord) m.chord = n.chord.map((c) => headToConcert(p, c, k));
  return m;
}
/* which accidentals must be printed: key signature + earlier accidentals in the bar + ties */
function shownAcc(p, dn, concert) {
  const out = new Array(dn.length).fill(null);
  if (isKit(p)) return out;
  const sh = dshift(p, concert); let pos = 0, bar = -1, seen = {}, tieFrom = null;
  dn.forEach((n, i) => {
    const k = barAt(pos); if (k !== bar) { bar = k; seen = {}; }
    pos += beats(n);
    if (n.type !== 'note') { tieFrom = null; return; }
    const wk = transKey(keyOf(k), sh);
    out[i] = heads(n).map((h) => {
      const cur = seen[h.pitch] !== undefined ? seen[h.pitch] : keyAlter(mod(h.pitch, 7), wk);
      seen[h.pitch] = h.alt;
      if (tieFrom && tieFrom.has(h.pitch)) return '';
      return h.alt === cur ? '' : h.alt > 0 ? '#' : h.alt < 0 ? 'b' : 'n';
    });
    tieFrom = n.tie ? new Set(heads(n).map((h) => h.pitch)) : null;
  });
  return out;
}
const hasSecond = (n) => { const ps = heads(n).map((h) => h.pitch).sort((a, b) => a - b); return ps.some((v, i) => i && v - ps[i - 1] === 1); };
function partRows(vp) {
  let y = 0;
  const rows = vp.map((p) => {
    const n = S.parts[p].notes, f = { lyr: n.some((x) => x.lyric), sym: n.some((x) => x.sym), tab: S.parts[p].tab && !!INSTR[S.parts[p].inst].tab };
    const top = f.sym ? 18 : 0, tabH = f.tab ? (INSTR[S.parts[p].inst].tab.length - 1) * TAB_GAP + 34 : 0;
    const row = { p, yRel: y + STAFF0 + top, f, h: STEP + top + (f.lyr ? 20 : 0) + tabH };
    y += row.h; return row;
  });
  return { rows, SH: y + 25 };
}

/* ---------- layout ---------- */
function keySigWidth(vp, k, concert) { return Math.max(0, ...vp.map((p) => Math.abs(writtenKey(p, k, concert)))) * 10; }
function computeLayout(W, vp, trim, concert = S.concert) {
  const multi = vp.length > 1, labelW = multi ? 64 : 0, X0 = L + labelW;
  const DN = {}, CL = {}, AC = {};
  vp.forEach((p) => { DN[p] = displayNotes(p, concert); CL[p] = dclef(p, concert); AC[p] = shownAcc(p, DN[p], concert); });
  const pms = vp.map((p) => splitMeasures(S.parts[p].notes));
  let nM = Math.max(...pms.map((a) => a.length));
  if (trim && nM > 1 && vp.every((p, j) => !pms[j][nM - 1] || !pms[j][nM - 1].items.length)) nM--;
  const Ms = [];
  for (let k = 0; k < nM; k++) {
    const b = S.bars[k] || {}, cap = capOf(k);
    const M = { k, cap, b, parts: vp.map((p, j) => pms[j][k] || { start: S.parts[p].notes.length, items: [], beats: 0 }) };
    M.keyCh = k > 0 && keyOf(k) !== keyOf(k - 1);
    M.tsCh = k > 0 && (tsOf(k)[0] !== tsOf(k - 1)[0] || tsOf(k)[1] !== tsOf(k - 1)[1]);
    M.keyW = M.keyCh ? Math.max(keySigWidth(vp, k, concert), keySigWidth(vp, k - 1, concert)) + 10 : 0;
    M.pre = (b.repStart ? 14 : 0) + M.keyW + (M.tsCh ? 30 : 0);
    M.post = b.repEnd ? 12 : 0;
    const map = new Map();
    M.parts.forEach((pm, j) => {
      const p = vp[j], dn = DN[p], ac = AC[p]; let pos = 0; pm.col = {};
      pm.items.forEach((i) => {
        const n = dn[i], key = Math.round(pos * 96);
        let c = map.get(key);
        if (!c) { c = { on: pos, acc: 0, dot: false, len: 0, disp: false, txt: 0 }; map.set(key, c); }
        c.acc = Math.max(c.acc, ac[i] ? ac[i].filter(Boolean).length : 0);
        if (n.dots) c.dot = true; if (n.chord && hasSecond(n)) c.disp = true;
        c.len = Math.max(c.len, beats(n));
        c.txt = Math.max(c.txt, (n.lyric ? n.lyric.length * 7.2 : 0), (n.sym ? n.sym.length * 8.5 : 0));
        pm.col[i] = c; pos += beats(n);
      });
    });
    M.cols = [...map.values()].sort((a, b2) => a.on - b2.on);
    M.cols.forEach((c, idx) => {
      const gap = idx < M.cols.length - 1 ? M.cols[idx + 1].on - c.on : c.len;
      c.accW = c.acc ? 12 + 8 * Math.min(c.acc, 3) : 0;
      c.nw = Math.max(26 + 30 * Math.sqrt(Math.max(gap, 0.2)) + c.accW + (c.dot ? 8 : 0) + (c.disp ? 12 : 0), c.txt + 10);
    });
    M.natural = Math.max(88, 24 + M.pre + M.post + M.cols.reduce((a, c) => a + c.nw, 0));
    Ms.push(M);
  }
  const lastM = Ms[Ms.length - 1], filled = Math.max(...lastM.parts.map((pm) => pm.beats));
  if (filled < lastM.cap - EPS) { const nat = Math.max(filled ? lastM.natural + Math.min(170, (lastM.cap - filled) * 34) : 170, lastM.natural); lastM.extra = filled ? nat - lastM.natural : 0; lastM.natural = nat; }
  const prefix = (k, first) => 50 + (keySigWidth(vp, k, concert) ? keySigWidth(vp, k, concert) + 8 : 0) + (first ? 36 : 6);
  const systems = []; let sys = { ms: [], w: 0 };
  Ms.forEach((M) => {
    const k0 = sys.ms.length ? sys.ms[0].k : M.k, avail = W - L - R - labelW - prefix(k0, systems.length === 0);
    if (sys.ms.length && sys.w + M.natural > avail) { systems.push(sys); sys = { ms: [], w: 0 }; }
    sys.ms.push(M); sys.w += M.natural;
  });
  systems.push(sys);
  const { rows, SH } = partRows(vp), geo = {};
  vp.forEach((p) => { geo[p] = []; });
  systems.forEach((sy, si) => {
    sy.y = si * SH; sy.k0 = sy.ms[0].k; sy.prefix = prefix(sy.k0, si === 0);
    sy.yBot = rows.map((r) => sy.y + r.yRel);
    const avail = W - L - R - labelW - sy.prefix;
    let scale = avail / sy.w;
    if (si === systems.length - 1) scale = Math.min(scale, 1.3);
    scale = Math.max(scale, 0.5);
    let x = X0 + sy.prefix;
    sy.ms.forEach((M) => {
      M.sys = si; M.x = x; M.w = M.natural * scale; x += M.w;
      const sum = M.cols.reduce((a, c) => a + c.nw, 0) || 1, f = Math.max(0.3, (M.w - 24 - M.pre - M.post - (M.extra || 0) * scale) / sum);
      let cum = 0;
      M.cols.forEach((c) => { const w = c.nw * f, accW = c.accW * f * 0.9; c.cx = M.x + 14 + M.pre + cum + accW + (w - accW - (c.dot ? 6 : 0) - (c.disp ? 10 : 0)) / 2; cum += w; });
      M.parts.forEach((pm, j) => pm.items.forEach((i) => { geo[vp[j]][i] = { x: pm.col[i].cx, sys: si, M, j }; }));
    });
    sy.xEnd = x;
  });
  return { W, vp, systems, geo, Ms, SH, rows, H: systems.length * SH + 12, X0, notes: DN, clefs: CL, acc: AC, concert };
}

/* ---------- drawing primitives ---------- */
function accGlyph(kind, x, y, col, s = 1) {
  const a = `stroke="${col}" fill="none"`; let p;
  if (kind === '#') p = `<path d="M-2.6 -9.5V10M2.6 -10.5V9" ${a} stroke-width="1.2"/><path d="M-5.5 -1.2L5.5 -4.2M-5.5 4.2L5.5 1.2" ${a} stroke-width="2.6"/>`;
  else if (kind === 'b') p = `<path d="M-3 -14V5" ${a} stroke-width="1.4"/><path d="M-3 5C1 3.5 7 0 4.8 -4.2C3 -7 -0.5 -5 -3 -2" ${a} stroke-width="1.6"/>`;
  else p = `<path d="M-3 -10V3.5M3 -3.5V10" ${a} stroke-width="1.3"/><path d="M-3 -1.5L3 -3.5M-3 4.5L3 2.5" ${a} stroke-width="2"/>`;
  return `<g transform="translate(${x} ${y}) scale(${s})">${p}</g>`;
}
const ledger = (x1, x2, y, col) => `<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="1.4"/>`;
const esc = (s) => String(s).replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]));
function clefSvg(clef, X0, yBot) {
  if (clef === 'perc') return `<rect x="${X0 + 12}" y="${yBot - 30}" width="4" height="20" fill="${INK}"/><rect x="${X0 + 20}" y="${yBot - 30}" width="4" height="20" fill="${INK}"/>`;
  const y = clef === 'treble' ? yBot - 10 : clef === 'bass' ? yBot - 30 : yBot - 20, fs = clef === 'treble' ? 62 : 46;
  return `<text x="${X0 + 6}" y="${y}" font-family="'Noto Music','Apple Symbols','Segoe UI Symbol',serif" font-size="${fs}" fill="${INK}">${CLEFS[clef].glyph}</text>`;
}
function keySigSvg(clef, key, x, yBot, cancel) {
  const bottom = CLEFS[clef].bottom; let s = '';
  if (!key && cancel) { for (let k = 0; k < Math.abs(cancel); k++) { const d = (cancel > 0 ? KEYPOS.sharp[k] : KEYPOS.flat[k]) + KOFF[clef]; s += accGlyph('n', x + k * 10, yBot - (d - bottom) * 5, INK, 0.85); } return s; }
  for (let k = 0; k < Math.abs(key); k++) { const d = (key > 0 ? KEYPOS.sharp[k] : KEYPOS.flat[k]) + KOFF[clef]; s += accGlyph(key > 0 ? '#' : 'b', x + k * 10, yBot - (d - bottom) * 5, INK, 0.85); }
  return s;
}
const timeSigSvg = (ts, x, yBot) => { const f = `font-family="Newsreader, Georgia, serif" font-weight="700" font-size="29" text-anchor="middle" fill="${INK}"`; return `<text x="${x}" y="${yBot - 21}" ${f}>${ts[0]}</text><text x="${x}" y="${yBot - 1}" ${f}>${ts[1]}</text>`; };
function braceSvg(x, y1, y2) {
  const m = (y1 + y2) / 2, h = y2 - y1;
  return `<path d="M${x} ${y1}C${x - 10} ${y1 + h * 0.08} ${x + 2} ${m - h * 0.16} ${x - 9} ${m}C${x + 2} ${m + h * 0.16} ${x - 10} ${y2 - h * 0.08} ${x} ${y2}C${x - 6} ${y2 - h * 0.12} ${x + 5} ${m + h * 0.14} ${x - 6} ${m}C${x + 5} ${m - h * 0.14} ${x - 6} ${y1 + h * 0.12} ${x} ${y1}Z" fill="${INK}"/>`;
}

/* a note or chord on one stem. o: { bottom, acc[], up, stemEnd, beamed, xhead(pitch), col } */
function noteGlyph(n, x, yBot, o = {}) {
  const bottom = o.bottom, col = o.col || INK, accs = o.acc || [];
  const hs = heads(n).map((h, k) => ({ pitch: h.pitch, alt: h.alt, acc: accs[k] || '', y: yBot - (h.pitch - bottom) * 5, dx: 0 })).sort((a, b) => a.pitch - b.pitch);
  const yTop = Math.min(...hs.map((h) => h.y)), yLow = Math.max(...hs.map((h) => h.y));
  const up = o.up !== undefined ? o.up : (yTop + yLow) / 2 > yBot - 20;
  // seconds: push one head to the other side of the stem
  if (up) { let prev = null; hs.forEach((h) => { if (prev && h.pitch - prev.pitch === 1 && !prev.dx) h.dx = 11.5; prev = h; }); }
  else { let prev = null; [...hs].reverse().forEach((h) => { if (prev && prev.pitch - h.pitch === 1 && !prev.dx) h.dx = -11.5; prev = h; }); }
  let s = '';
  const minOff = hs[0].pitch - bottom, maxOff = hs[hs.length - 1].pitch - bottom;
  const lx1 = x - 10 + Math.min(0, ...hs.map((h) => h.dx)), lx2 = x + 10 + Math.max(0, ...hs.map((h) => h.dx));
  if (minOff <= -2) for (let k = -2; k >= minOff; k -= 2) s += ledger(lx1, lx2, yBot - k * 5, col);
  if (maxOff >= 10) for (let k = 10; k <= maxOff; k += 2) s += ledger(lx1, lx2, yBot - k * 5, col);
  // accidentals, stacked into columns when close together
  const colsY = [[], [], []], accBase = x - 16 + Math.min(0, ...hs.map((h) => h.dx));
  [...hs].reverse().forEach((h) => {
    if (!h.acc) return;
    let c = 0; while (c < 2 && colsY[c].some((y) => Math.abs(y - h.y) < 26)) c++;
    colsY[c].push(h.y); s += accGlyph(h.acc, accBase - c * 9, h.y, col);
  });
  const filled = n.dur !== 'w' && n.dur !== 'h';
  hs.forEach((h) => {
    const hx = x + h.dx;
    if (o.xhead && o.xhead(h.pitch)) s += `<path d="M${hx - 5} ${h.y - 5}L${hx + 5} ${h.y + 5}M${hx - 5} ${h.y + 5}L${hx + 5} ${h.y - 5}" stroke="${col}" stroke-width="1.8"/>`;
    else if (n.dur === 'w') s += `<ellipse cx="${hx}" cy="${h.y}" rx="7.4" ry="5" fill="none" stroke="${col}" stroke-width="2.2"/>`;
    else s += `<ellipse cx="${hx}" cy="${h.y}" rx="6.2" ry="4.5" transform="rotate(-20 ${hx} ${h.y})" fill="${filled ? col : 'none'}" stroke="${col}" stroke-width="${filled ? 1 : 1.8}"/>`;
    if (n.dots) s += `<circle cx="${x + 12 + Math.max(0, ...hs.map((q) => q.dx))}" cy="${mod(h.pitch - bottom, 2) === 0 ? h.y - 5 : h.y}" r="2" fill="${col}"/>`;
  });
  let stemEnd = null;
  if (n.dur !== 'w') {
    const sx = up ? x + 5.6 : x - 5.6;
    stemEnd = o.stemEnd;
    if (stemEnd === undefined) stemEnd = up ? Math.min(yTop - 34, yBot - 20) : Math.max(yLow + 34, yBot - 20);
    s += `<line x1="${sx}" x2="${sx}" y1="${up ? yLow : yTop}" y2="${stemEnd}" stroke="${col}" stroke-width="1.5"/>`;
    if (!o.beamed && (n.dur === 'e' || n.dur === 's')) {
      const flag = (e) => (up ? `<path d="M${sx} ${e}c1.2 8 11 12 8.5 24" fill="none" stroke="${col}" stroke-width="2.4"/>` : `<path d="M${sx} ${e}c1.2 -8 11 -12 8.5 -24" fill="none" stroke="${col}" stroke-width="2.4"/>`);
      s += flag(stemEnd); if (n.dur === 's') s += flag(stemEnd + (up ? 7 : -7));
    }
  }
  return { svg: s, up, yTop, yLow, hs, stemEnd };
}
function restGlyph(n, x, yBot, col = INK) {
  const m = yBot - 20; let s = '';
  const st = `stroke="${col}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  if (n.dur === 'w') s += `<rect x="${x - 6.5}" y="${yBot - 30}" width="13" height="5" fill="${col}"/>`;
  else if (n.dur === 'h') s += `<rect x="${x - 6.5}" y="${m - 5}" width="13" height="5" fill="${col}"/>`;
  else if (n.dur === 'q') s += `<path d="M${x + 2} ${m - 15}L${x - 3.5} ${m - 7.5}L${x + 3} ${m - 1}L${x - 3.5} ${m + 6}" ${st} stroke-width="3"/><path d="M${x - 3.5} ${m + 6}Q${x + 5} ${m + 4} ${x + 1} ${m + 13}" ${st} stroke-width="2.4"/>`;
  else {
    const flags = n.dur === 's' ? 2 : 1, top = m - 7 - (flags === 2 ? 3 : 0), bot = m + 10 + (flags === 2 ? 3 : 0);
    s += `<line x1="${x + 4.5 + (flags === 2 ? 1 : 0)}" y1="${top - 3}" x2="${x - 3 - (flags === 2 ? 1 : 0)}" y2="${bot}" stroke="${col}" stroke-width="1.8" stroke-linecap="round"/>`;
    for (let f = 0; f < flags; f++) { const cy = top + f * 8, cx = x - 3.2 + f * 1.6; s += `<circle cx="${cx}" cy="${cy + 1}" r="2.6" fill="${col}"/><path d="M${cx + 1} ${cy + 3}Q${cx + 5} ${cy + 2} ${cx + 8} ${cy - 3}" ${st} stroke-width="1.8"/>`; }
  }
  if (n.dots) s += `<circle cx="${x + 13}" cy="${m - 5}" r="2" fill="${col}"/>`;
  return s;
}

/* ---------- fingering hints ---------- */
const TRUMPET_VALVES = { 54: '123', 55: '13', 56: '23', 57: '12', 58: '1', 59: '2', 60: '0', 61: '123', 62: '13', 63: '23', 64: '12', 65: '1', 66: '2', 67: '0', 68: '23', 69: '12', 70: '1', 71: '2', 72: '0', 73: '12', 74: '1', 75: '2', 76: '0', 77: '1', 78: '2', 79: '0', 80: '23', 81: '12', 82: '1', 83: '2', 84: '0' };
const TROMBONE_POS = { 40: '7', 41: '6', 42: '5', 43: '4', 44: '3', 45: '2', 46: '1', 47: '7', 48: '6', 49: '5', 50: '4', 51: '3', 52: '2', 53: '1', 54: '5', 55: '4', 56: '3', 57: '2', 58: '1', 59: '4', 60: '3', 61: '2', 62: '1', 63: '3', 64: '2', 65: '1', 66: '2', 67: '4', 68: '3', 69: '2', 70: '1' };
function fingeringFor(p, n) {
  const inst = S.parts[p].inst;
  if (inst === 'trumpet') { const v = TRUMPET_VALVES[midiOf(n) + 2]; return v === undefined ? '' : v === '0' ? 'o' : v; }
  if (inst === 'trombone') return TROMBONE_POS[midiOf(n)] || '';
  return '';
}
/* guitar / bass tab: each pitch to a string and fret */
function tabFrets(midis, tuning) {
  const used = new Set(), out = [];
  midis.slice().sort((a, b) => b - a).forEach((m) => {
    let best = -1, bf = 99;
    tuning.forEach((t, s) => { const f = m - t; if (f >= 0 && f <= 19 && !used.has(s) && f < bf) { bf = f; best = s; } });
    if (best >= 0) { used.add(best); out.push({ s: best, f: bf }); }
  });
  return out;
}

/* dynamics, hairpins, articulations, ornaments, ties, lyrics, chord symbols, hints */
function exprMarks(p, i, x, r, yBot, lay, si, row) {
  const notes = lay.notes[p], n = notes[i], g = lay.geo[p], sy = lay.systems[si], j = g[i].j;
  const stroke = `stroke="${INK}" fill="none"`; let s = '';
  const up = r.up, yTop = r.yTop, yLow = r.yLow;
  const ay = up ? yLow + 11 : yTop - 11, top = Math.min(yBot - 52, up && r.stemEnd !== null ? r.stemEnd - 8 : yTop - 16);
  if (n.type === 'note') {
    if (n.art === 'stac') s += `<circle cx="${x}" cy="${ay}" r="1.9" fill="${INK}"/>`;
    if (n.art === 'acc') s += `<path d="M${x - 5.5} ${ay - 3.5}L${x + 5.5} ${ay}L${x - 5.5} ${ay + 3.5}" ${stroke} stroke-width="1.6"/>`;
    if (n.art === 'ten') s += `<line x1="${x - 6}" x2="${x + 6}" y1="${ay}" y2="${ay}" stroke="${INK}" stroke-width="2"/>`;
    if (n.art === 'trill') s += `<text x="${x - 2}" y="${top}" text-anchor="middle" font-family="Newsreader,Georgia,serif" font-style="italic" font-weight="700" font-size="17" fill="${INK}">tr</text><path d="M${x + 7} ${top - 5}q2.5 -4 5 0t5 0t5 0" ${stroke} stroke-width="1.3"/>`;
    if (n.art === 'mord') s += `<path d="M${x - 8} ${top}l3.2 -5l3.2 5l3.2 -5l3.2 5l3.2 -5" ${stroke} stroke-width="1.6" stroke-linejoin="round"/>`;
  }
  if (n.art === 'ferm') s += `<path d="M${x - 9} ${top + 2}Q${x} ${top - 12} ${x + 9} ${top + 2}" ${stroke} stroke-width="1.6"/><circle cx="${x}" cy="${top - 1}" r="1.8" fill="${INK}"/>`;
  const lowY = up || r.stemEnd === null ? yLow : r.stemEnd, dy = Math.max(yBot + 27, lowY + 16);
  if (n.dyn) s += `<text x="${x}" y="${dy}" text-anchor="middle" font-family="Newsreader,Georgia,serif" font-style="italic" font-weight="700" font-size="19" fill="${INK}">${n.dyn}</text>`;
  if (n.hp) {
    let k = i + 1; while (k < notes.length && !(notes[k].dyn || notes[k].hp)) k++;
    const x1 = x - 5 + (n.dyn ? 16 : 0); let x2;
    if (k < notes.length && g[k] && g[k].sys === si) x2 = g[k].x - (notes[k].dyn ? 12 : 8);
    else if (k >= notes.length && g[notes.length - 1].sys === si) x2 = g[notes.length - 1].x + 24;
    else x2 = sy.xEnd - 8;
    x2 = Math.max(x2, x1 + 16); const yc = dy - 5;
    s += n.hp === 'cresc' ? `<path d="M${x1} ${yc}L${x2} ${yc - 5.5}M${x1} ${yc}L${x2} ${yc + 5.5}" ${stroke} stroke-width="1.2"/>` : `<path d="M${x1} ${yc - 5.5}L${x2} ${yc}M${x1} ${yc + 5.5}L${x2} ${yc}" ${stroke} stroke-width="1.2"/>`;
  }
  if (n.tie && i + 1 < notes.length && n.type === 'note' && notes[i + 1].type === 'note') {
    const nx = g[i + 1].sys === si ? g[i + 1].x : sy.xEnd - 6, dir = up ? 1 : -1, nextP = new Set(heads(notes[i + 1]).map((h) => h.pitch));
    r.hs.forEach((h, hi) => {
      if (!nextP.has(h.pitch)) return;
      const d = r.hs.length > 1 ? (hi < r.hs.length / 2 ? 1 : -1) : dir, ty = h.y + d * 7;
      s += `<path d="M${x + 4} ${ty}Q${(x + nx) / 2} ${ty + d * (8 + Math.min(6, (nx - x) / 14))} ${nx - 4} ${ty}" ${stroke} stroke-width="1.5"/>`;
    });
  }
  if (n.lyric) s += `<text x="${x}" y="${yBot + 50}" text-anchor="middle" font-family="Newsreader,Georgia,serif" font-size="15" fill="${INK}">${esc(n.lyric)}</text>`;
  if (n.sym) s += `<text x="${x - 6}" y="${yBot - 60}" font-family="Newsreader,Georgia,serif" font-weight="700" font-size="16" fill="${INK}">${esc(n.sym).replace(/b(?=\d|$|m|\/)/g, '♭').replace(/#/g, '♯')}</text>`;
  if (n.type === 'note' && prefs.names && !isKit(p)) {
    const ny = up ? yLow + 17 : yTop - 11;
    s += `<text x="${x}" y="${ny}" text-anchor="middle" font-family="'Instrument Sans',sans-serif" font-size="9.5" font-weight="600" fill="#5b6480">${heads(n).length > 1 ? '' : LETTERS[mod(n.pitch, 7)] + (n.alt > 0 ? '♯' : n.alt < 0 ? '♭' : '')}</text>`;
  }
  if (n.type === 'note' && prefs.finger) {
    const fg = fingeringFor(p, S.parts[p].notes[i]);
    if (fg) s += `<text x="${x}" y="${Math.min(yBot - 50, top - 14)}" text-anchor="middle" font-family="'Instrument Sans',sans-serif" font-size="10" fill="#1d6a3a">${fg}</text>`;
  }
  // tablature numbers
  if (row.f.tab && n.type === 'note') {
    const tuning = INSTR[S.parts[p].inst].tab, tabTop = yBot + 40 + (row.f.lyr ? 20 : 0);
    tabFrets(midisOf(S.parts[p].notes[i]), tuning).forEach(({ s: str, f }) => {
      const y = tabTop + str * TAB_GAP; s += `<rect x="${x - 6}" y="${y - 6}" width="12" height="12" fill="#fdfdfb"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-family="'Instrument Sans',sans-serif" font-size="11" font-weight="600" fill="${INK}">${f}</text>`;
    });
  }
  return s;
}

function beamGroups(notes, pm, k) {
  const groups = []; let g = null, pos = 0; const unit = beatUnitOf(k);
  pm.items.forEach((i) => {
    const n = notes[i], ok = n.type === 'note' && (n.dur === 'e' || n.dur === 's'), bi = Math.floor((pos + 1e-4) / unit);
    if (ok) { if (g && g.bi === bi) g.idx.push(i); else { g = { bi, idx: [i] }; groups.push(g); } } else g = null;
    pos += beats(n);
  });
  return groups.filter((x) => x.idx.length > 1);
}
const abbr = (part) => (part.name.length <= 8 ? part.name : part.name === INSTR[part.inst].name && ABBR[part.inst] ? ABBR[part.inst] : part.name.slice(0, 7) + '.');
const braceLabel = (name) => name.replace(/\s*\((RH|LH)\)\s*$/i, '');

function buildMarkup(lay, interactive) {
  const { W, vp, X0, rows } = lay, multi = vp.length > 1;
  const range = interactive && typeof selRange === 'function' ? selRange() : null;
  let out = '', slurs = [];
  let lastM = lay.Ms[lay.Ms.length - 1];
  if (lay.Ms.length > 1 && lastM.parts.every((pm) => !pm.items.length)) lastM = lay.Ms[lay.Ms.length - 2];
  const allEmpty = vp.every((p) => !S.parts[p].notes.length);
  const rinfo = {}; vp.forEach((p) => { rinfo[p] = []; });
  // brace groups among visible staves
  const groupOf = (j) => { const b = S.parts[vp[j]].brace; return b ? vp.map((p, q) => (S.parts[p].brace === b ? q : -1)).filter((q) => q >= 0) : [j]; };
  lay.systems.forEach((sy, si) => {
    const last = si === lay.systems.length - 1, x2 = last ? sy.xEnd : W - R;
    if (multi) out += `<line x1="${X0}" x2="${X0}" y1="${sy.yBot[0] - 40}" y2="${sy.yBot[vp.length - 1]}" stroke="${INK}" stroke-width="1.6"/><line x1="${X0 - 6}" x2="${X0 - 6}" y1="${sy.yBot[0] - 41}" y2="${sy.yBot[vp.length - 1] + 1}" stroke="${INK}" stroke-width="3.4"/>`;
    vp.forEach((p, j) => {
      const part = S.parts[p], notes = lay.notes[p], clef = lay.clefs[p], bottom = CLEFS[clef].bottom, yBot = sy.yBot[j], kit = isKit(p), row = rows[j];
      const grp = groupOf(j), inBrace = grp.length > 1;
      for (let k = 0; k < 5; k++) out += `<line x1="${X0}" x2="${x2}" y1="${yBot - k * 10}" y2="${yBot - k * 10}" stroke="${INK}" stroke-width="1"/>`;
      out += `<line x1="${X0}" x2="${X0}" y1="${yBot - 40}" y2="${yBot}" stroke="${INK}" stroke-width="1.6"/>`;
      if (inBrace && grp[0] === j) {
        const yEnd = sy.yBot[grp[grp.length - 1]];
        out += braceSvg(X0 - 12, yBot - 40, yEnd);
        if (multi) out += `<text x="${L}" y="${(yBot - 40 + yEnd) / 2 + 4}" font-family="'Instrument Sans',sans-serif" font-size="11.5" font-weight="${p === ap && interactive ? 700 : 500}" fill="${grp.some((q) => vp[q] === ap) && interactive ? SEL : INK}">${esc(abbr({ name: braceLabel(part.name), inst: part.inst }))}</text>`;
      } else if (multi && !inBrace) out += `<text x="${L}" y="${yBot - 16}" font-family="'Instrument Sans',sans-serif" font-size="11.5" font-weight="${p === ap && interactive ? 700 : 500}" fill="${p === ap && interactive ? SEL : INK}">${esc(abbr(part))}</text>`;
      out += clefSvg(clef, X0, yBot);
      const wk0 = writtenKey(p, sy.k0, lay.concert);
      out += keySigSvg(clef, wk0, X0 + 56, yBot, 0);
      if (si === 0) out += timeSigSvg(tsOf(0), X0 + 50 + (keySigWidth(vp, 0, lay.concert) ? keySigWidth(vp, 0, lay.concert) + 8 : 0) + 12, yBot);
      // tab staff
      if (row.f.tab) {
        const strings = INSTR[part.inst].tab.length, tabTop = yBot + 40 + (row.f.lyr ? 20 : 0);
        for (let s2 = 0; s2 < strings; s2++) out += `<line x1="${X0}" x2="${x2}" y1="${tabTop + s2 * TAB_GAP}" y2="${tabTop + s2 * TAB_GAP}" stroke="${INK}" stroke-width="0.9"/>`;
        out += `<line x1="${X0}" x2="${X0}" y1="${tabTop}" y2="${tabTop + (strings - 1) * TAB_GAP}" stroke="${INK}" stroke-width="1.4"/>`;
        ['T', 'A', 'B'].forEach((ch, q) => { out += `<text x="${X0 + 14}" y="${tabTop + 9 + q * ((strings - 1) * TAB_GAP - 4) / 3}" font-family="'Instrument Sans',sans-serif" font-weight="700" font-size="11" fill="${INK}">${ch}</text>`; });
        sy.ms.forEach((M) => { const bx = M.x + M.w; out += `<line x1="${bx}" x2="${bx}" y1="${tabTop}" y2="${tabTop + (strings - 1) * TAB_GAP}" stroke="${INK}" stroke-width="1"/>`; });
      }
      sy.ms.forEach((M) => {
        const pm = M.parts[j], b = M.b, over = pm.beats > M.cap + 1e-3, isLast = M === lastM, bx = M.x + M.w;
        const vline = (x, w, c = INK, dash = '') => `<line x1="${x}" x2="${x}" y1="${yBot - 40}" y2="${yBot}" stroke="${c}" stroke-width="${w}"${dash}/>`;
        const dots = (x) => `<circle cx="${x}" cy="${yBot - 25}" r="2.2" fill="${INK}"/><circle cx="${x}" cy="${yBot - 15}" r="2.2" fill="${INK}"/>`;
        if (b.repStart) out += vline(M.x + 2, 3.4) + vline(M.x + 6.5, 1.2) + dots(M.x + 11);
        if (b.repEnd) out += dots(bx - 11) + vline(bx - 6.5, 1.2) + vline(bx - 2, 3.4);
        else if (isLast) out += vline(bx - 5, 1.2) + vline(bx - 1.5, 3.4);
        else if (M.parts.every((q) => !q.items.length) && M.k > 0) out += vline(bx, 1, GREY, ' stroke-dasharray="2 3"');
        else out += vline(bx, over ? 1.8 : 1.2, over ? PLAYC : INK, over ? ' stroke-dasharray="3 2"' : '');
        if (inBrace && grp[0] === j && grp.length > 1) out += `<line x1="${bx - (b.repEnd || isLast ? 1.5 : 0)}" x2="${bx - (b.repEnd || isLast ? 1.5 : 0)}" y1="${yBot}" y2="${sy.yBot[grp[grp.length - 1]] - 40}" stroke="${INK}" stroke-width="${b.repEnd || isLast ? 3.4 : 1.2}"/>`;
        // key / time changes inside the bar
        let px = M.x + (b.repStart ? 14 : 0) + 4;
        if (M.keyCh && sy.ms[0] !== M) { out += keySigSvg(clef, writtenKey(p, M.k, lay.concert), px, yBot, writtenKey(p, M.k - 1, lay.concert)); px += M.keyW; }
        else if (M.keyCh) px += M.keyW;
        if (M.tsCh) out += timeSigSvg(tsOf(M.k), px + 12, yBot);
        // top-staff decorations: bar numbers, rehearsal marks, tempo changes, endings
        if (j === 0) {
          const ty = yBot - 40 - (row.f.sym ? 18 : 0);
          if (sy.ms[0] === M && si > 0 && !b.mark) out += `<text x="${M.x + 2}" y="${ty - 8}" font-family="'Instrument Sans',sans-serif" font-size="11" fill="${GREY}">${M.k + 1}</text>`;
          let tx = M.x + 4;
          if (b.mark) { const w = 10 + b.mark.length * 10; out += `<rect x="${M.x}" y="${ty - 50}" width="${w}" height="22" fill="none" stroke="${INK}" stroke-width="1.4"/><text x="${M.x + w / 2}" y="${ty - 33}" text-anchor="middle" font-family="'Instrument Sans',sans-serif" font-weight="700" font-size="15" fill="${INK}">${esc(b.mark)}</text>`; tx += w + 8; }
          if (b.tempo && M.k > 0) out += `<text x="${tx}" y="${ty - 34}" font-family="'Noto Music',serif" font-size="16" fill="${INK}">♩ <tspan font-family="Newsreader,Georgia,serif" font-size="14" font-weight="700">= ${b.tempo}</tspan></text>`;
          if (b.ending) {
            const prev = S.bars[M.k - 1], next = S.bars[M.k + 1], startHere = !prev || prev.ending !== b.ending || sy.ms[0] === M;
            const endHere = !next || next.ending !== b.ending, ey = ty - 22;
            out += `<line x1="${M.x + 2}" x2="${bx - 3}" y1="${ey}" y2="${ey}" stroke="${INK}" stroke-width="1.3"/>`;
            if (startHere) out += `<line x1="${M.x + 2}" x2="${M.x + 2}" y1="${ey}" y2="${ey + 14}" stroke="${INK}" stroke-width="1.3"/><text x="${M.x + 7}" y="${ey + 14}" font-family="Newsreader,Georgia,serif" font-size="14" font-weight="700" fill="${INK}">${b.ending}.</text>`;
            if (endHere && b.ending === 1) out += `<line x1="${bx - 3}" x2="${bx - 3}" y1="${ey}" y2="${ey + 14}" stroke="${INK}" stroke-width="1.3"/>`;
          }
        }
        if (multi && !pm.items.length && M.parts.some((q) => q.items.length)) out += restGlyph({ dur: 'w', dots: 0 }, M.x + M.pre + (M.w - M.pre) / 2, yBot, INK);
        if (range && p === ap) pm.items.forEach((i) => { if (i >= range[0] && i <= range[1]) { const g = lay.geo[p][i]; out += `<rect x="${g.x - 15}" y="${yBot - 62}" width="30" height="86" rx="6" fill="${SEL}" opacity=".10"/>`; } });
        // beams
        const gmap = new Map();
        beamGroups(notes, pm, M.k).forEach((g) => {
          const ext = g.idx.map((i) => { const ys = heads(notes[i]).map((h) => yBot - (h.pitch - bottom) * 5); return [Math.min(...ys), Math.max(...ys)]; });
          const all = ext.flat(), mid = all.reduce((a, c) => a + c, 0) / all.length;
          g.up = kit || mid > yBot - 20;
          g.beamY = g.up ? Math.min(...ext.map((e) => e[0])) - 34 : Math.max(...ext.map((e) => e[1])) + 34;
          g.beamY = g.up ? Math.min(g.beamY, yBot - 26) : Math.max(g.beamY, yBot - 14);
          g.idx.forEach((i) => gmap.set(i, g));
        });
        pm.items.forEach((i) => {
          const n = notes[i], x = lay.geo[p][i].x, pk = practiceMarks[`${p}:${i}`];
          const cls = 'nt' + (interactive && range && p === ap && i >= range[0] && i <= range[1] ? ' sel' : '') + (pk ? ' ' + pk : '');
          out += `<g class="${cls}" data-k="${p}:${i}">`;
          let r;
          if (n.type === 'rest') { out += restGlyph(n, x, yBot, INK); r = { up: true, yTop: yBot - 30, yLow: yBot - 10, hs: [], stemEnd: null }; }
          else {
            const grp2 = gmap.get(i), xo = { bottom, acc: lay.acc[p][i], xhead: kit ? (pitch) => kitInfo(part.inst, pitch)[3] : null };
            if (kit) xo.up = true;
            r = noteGlyph(n, x, yBot, grp2 ? Object.assign(xo, { up: grp2.up, stemEnd: grp2.beamY, beamed: true }) : xo);
            out += r.svg;
          }
          out += exprMarks(p, i, x, r, yBot, lay, si, row) + '</g>';
          rinfo[p][i] = { x, si, yTop: r.yTop, yLow: r.yLow, up: r.up, stemEnd: r.stemEnd, yBot };
          if (n.slur) slurs.push([p, i, Math.min(notes.length - 1, i + n.slur)]);
        });
        const seen = new Set();
        gmap.forEach((grp2) => {
          if (seen.has(grp2)) return; seen.add(grp2);
          const xs = grp2.idx.map((i) => lay.geo[p][i].x + (grp2.up ? 5.6 : -5.6)), th = 4.6;
          const rect = (a, b2, y) => `<rect x="${a - 0.75}" y="${grp2.up ? y : y - th}" width="${b2 - a + 1.5}" height="${th}" fill="${INK}"/>`;
          out += rect(xs[0], xs[xs.length - 1], grp2.beamY);
          const o2 = grp2.up ? 7.2 : -7.2; let k = 0;
          while (k < grp2.idx.length) {
            if (notes[grp2.idx[k]].dur !== 's') { k++; continue; }
            let q = k; while (q + 1 < grp2.idx.length && notes[grp2.idx[q + 1]].dur === 's') q++;
            if (q > k) out += rect(xs[k], xs[q], grp2.beamY + o2);
            else { const d = k < grp2.idx.length - 1 ? 1 : -1; out += rect(Math.min(xs[k], xs[k] + 9 * d), Math.max(xs[k], xs[k] + 9 * d), grp2.beamY + o2); }
            k = q + 1;
          }
        });
        // triplet numbers
        let tg = [];
        const flushTup = () => {
          if (!tg.length) return;
          const xs = tg.map((i) => lay.geo[p][i].x), ri = tg.map((i) => rinfo[p][i]), anyUp = ri.some((q) => q.up);
          const yTop = Math.min(yBot - 46, ...ri.map((q) => (q.up && q.stemEnd !== null ? q.stemEnd : q.yTop))) - 8, mx = (xs[0] + xs[xs.length - 1]) / 2;
          const beamed = tg.every((i) => gmap.has(i));
          if (!beamed) out += `<path d="M${xs[0] - 5} ${yTop + 5}V${yTop}H${mx - 7}M${mx + 7} ${yTop}H${xs[xs.length - 1] + 7}V${yTop + 5}" ${`stroke="${INK}" fill="none"`} stroke-width="1"/>`;
          out += `<text x="${mx}" y="${yTop + 4}" text-anchor="middle" font-family="Newsreader,Georgia,serif" font-style="italic" font-weight="700" font-size="13" fill="${INK}">3</text>`;
          tg = []; void anyUp;
        };
        let acc = 0, target = 0;
        pm.items.forEach((i) => {
          const n = notes[i];
          if (!n.tup) { flushTup(); acc = 0; return; }
          if (!tg.length) { target = DUR[n.dur] * (n.dots ? 1.5 : 1) * 2; acc = 0; }
          tg.push(i); acc += beats(n);
          if (acc >= target - 1e-3) { flushTup(); acc = 0; }
        });
        flushTup();
      });
    });
  });
  // slurs (may cross systems)
  slurs.forEach(([p, a, b]) => {
    const A = rinfo[p][a], B = rinfo[p][b]; if (!A || !B || a === b) return;
    const below = A.up, curve = (x1, y1, x2, y2) => { const d = below ? 1 : -1, h = Math.min(22, 8 + (x2 - x1) / 10), mx = (x1 + x2) / 2; return `<path d="M${x1} ${y1}Q${mx} ${Math.max(y1, y2) * (d > 0 ? 1 : 0) + Math.min(y1, y2) * (d > 0 ? 0 : 1) + d * h} ${x2} ${y2}Q${mx} ${(d > 0 ? Math.max(y1, y2) : Math.min(y1, y2)) + d * (h - 2.5)} ${x1} ${y1}Z" fill="${INK}"/>`; };
    const yA = below ? A.yLow + 9 : (A.up && A.stemEnd !== null ? A.stemEnd - 6 : A.yTop - 9), yB = below ? B.yLow + 9 : (B.up && B.stemEnd !== null ? B.stemEnd - 6 : B.yTop - 9);
    if (A.si === B.si) out += curve(A.x, yA, B.x, yB);
    else { out += curve(A.x, yA, lay.systems[A.si].xEnd - 4, yA); out += curve(lay.X0 + lay.systems[B.si].prefix, yB, B.x, yB); }
  });
  if (allEmpty) { const sy = lay.systems[0], M = sy.ms[0]; out += `<text x="${M.x + 6}" y="${sy.yBot[0] + 34}" font-family="'Instrument Sans',sans-serif" font-size="13" fill="${GREY}">Click the staff to add a note, or type A–G</text>`; }
  lay.rinfo = rinfo;
  return out;
}
