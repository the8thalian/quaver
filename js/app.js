'use strict';
/* Quaver · app.js
   The editor: selection, entering and editing notes, toolbar, parts, bars, menus, keyboard and start-up. Loaded last. */

const $ = (id) => document.getElementById(id);
const svg = $('score');
const STORE = 'quaver:v3';
let ap = 0, view = 'score', sel = -1, selA = -1, clip = null;
const tool = { dur: 'q', dots: false, acc: '', rest: false, dyn: '', hp: '', art: '', tie: false, tup: false, chord: false };
let undoStack = [], redoStack = [];

/* =====================  state helpers  ===================== */
const NT = () => S.parts[ap].notes;
function braceGroup(p) { const b = S.parts[p].brace; return b ? S.parts.map((q, i) => (q.brace === b ? i : -1)).filter((i) => i >= 0) : [p]; }
const vpList = () => (view === 'score' ? S.parts.map((_, i) => i) : braceGroup(view));
function selRange() { if (sel < 0 || sel >= NT().length) return null; const a = selA < 0 || selA >= NT().length ? sel : selA; return [Math.min(a, sel), Math.max(a, sel)]; }
const rangeIdx = () => { const r = selRange(), out = []; if (r) for (let i = r[0]; i <= r[1]; i++) out.push(i); return out; };
const currentLabel = () => (view === 'score' ? (playerGroups().length > 1 ? 'Full score' : '') : braceLabel(S.parts[view].name) + ' – part');
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2800); }
function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} }
function mutate(fn) { undoStack.push(JSON.stringify(S)); if (undoStack.length > 100) undoStack.shift(); redoStack = []; practiceMarks = {}; fn(); changed(); }
function restore(json) { S = JSON.parse(json); sel = selA = -1; changed(); syncMeta(); }
function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(S)); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(S)); restore(redoStack.pop()); }
function fixView() {
  if (ap >= S.parts.length) ap = S.parts.length - 1;
  if (view !== 'score' && view >= S.parts.length) view = 'score';
  if (view !== 'score') view = braceGroup(view)[0];
  if (playerGroups().length === 1) view = 'score';
  if (view !== 'score' && !braceGroup(view).includes(ap)) ap = view;
}
function reflowAll() { S.parts.forEach((p, i) => { p.notes = reflowBars(p.notes, isKit(i)); }); }
function changed() {
  fixView(); resetBarTable(); reflowAll(); resetBarTable();
  if (sel >= NT().length) sel = NT().length - 1; if (selA >= NT().length) selA = sel;
  render(); updateUI(); save();
}
function render() {
  const W = Math.max(260, Math.floor($('sheet').clientWidth));
  LAY = computeLayout(W, vpList(), false);
  svg.setAttribute('viewBox', `0 0 ${W} ${LAY.H}`); svg.setAttribute('width', W); svg.setAttribute('height', LAY.H);
  svg.innerHTML = buildMarkup(LAY, true) + '<g id="ghost" pointer-events="none" opacity=".4"></g>';
}
function blipN(p, n) { soundsOf(p, n).forEach((m) => blip(m, S.parts[p].inst)); }

/* =====================  pointer: click, drag, double-click  ===================== */
function pointer(ev) { const r = svg.getBoundingClientRect(); return { x: (ev.clientX - r.left) * (LAY.W / r.width), y: (ev.clientY - r.top) * (LAY.H / r.height) }; }
function noteAt(pt) {
  let best = null, bd = 1e9;
  LAY.vp.forEach((p) => LAY.notes[p].forEach((n, i) => {
    const g = LAY.geo[p][i]; if (!g) return;
    const yBot = LAY.systems[g.sys].yBot[g.j], bottom = CLEFS[LAY.clefs[p]].bottom;
    const ys = n.type === 'rest' ? [yBot - 20] : heads(n).map((h) => yBot - (h.pitch - bottom) * 5);
    ys.forEach((y) => { const dx = Math.abs(pt.x - g.x), dy = Math.abs(pt.y - y), ok = n.type === 'rest' ? dx < 12 && dy < 20 : dx < 12 && dy < 8; if (ok && dx + dy < bd) { bd = dx + dy; best = { p, i }; } });
  }));
  return best;
}
function target(pt) {
  const si = Math.max(0, Math.min(LAY.systems.length - 1, Math.floor(pt.y / LAY.SH))), sy = LAY.systems[si];
  let j = 0, bd = 1e9; sy.yBot.forEach((yb, q) => { const d = Math.abs(pt.y - (yb - 20)); if (d < bd) { bd = d; j = q; } });
  const p = LAY.vp[j], yBot = sy.yBot[j], bottom = CLEFS[LAY.clefs[p]].bottom;
  let M = sy.ms[sy.ms.length - 1]; for (const mm of sy.ms) { if (pt.x < mm.x + mm.w) { M = mm; break; } }
  const pm = M.parts[j]; let kk = 0; pm.items.forEach((i) => { if (LAY.geo[p][i].x < pt.x) kk++; });
  let pitch = Math.max(bottom - 9, Math.min(bottom + 17, bottom + Math.round((yBot - pt.y) / 5)));
  if (isKit(p)) pitch = kitSnap(S.parts[p].inst, pitch);
  const prev = kk > 0 ? LAY.geo[p][pm.items[kk - 1]].x : null, next = kk < pm.items.length ? LAY.geo[p][pm.items[kk]].x : null;
  let gx;
  if (prev !== null && next !== null) gx = (prev + next) / 2;
  else if (prev !== null) gx = Math.min(prev + 30, M.x + M.w - 10);
  else if (next !== null) gx = Math.max(next - 26, M.x + M.pre + 12);
  else gx = M.x + M.pre + Math.min(40, (M.w - M.pre) / 2);
  let near = -1, nd = 15; pm.items.forEach((i) => { const d = Math.abs(LAY.geo[p][i].x - pt.x); if (d < nd) { nd = d; near = i; } });
  return { p, j, yBot, bottom, M, k: M.k, pitch, index: pm.start + kk, gx, near };
}
function toolNote(pitch, p, k) {
  const kit = isKit(p);
  const n = tool.rest ? { type: 'rest', pitch: 0, alt: 0, dur: tool.dur, dots: tool.dots ? 1 : 0 }
    : { type: 'note', pitch, alt: kit ? 0 : tool.acc ? altOfAcc(tool.acc) : keyAlter(mod(pitch, 7), writtenKey(p, k, S.concert)), dur: tool.dur, dots: tool.dots ? 1 : 0 };
  if (tool.tup) n.tup = 3;
  if (tool.dyn) n.dyn = tool.dyn; if (tool.hp) n.hp = tool.hp; if (tool.art) n.art = tool.art; if (tool.tie && n.type === 'note') n.tie = true;
  return n;
}
function resetOneShots() { Object.assign(tool, { dots: false, acc: '', rest: false, dyn: '', hp: '', art: '', tie: false }); }
let drag = null;
svg.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || !LAY) return;
  const pt = pointer(ev), hit = tool.chord ? null : noteAt(pt);
  if (hit) {
    drag = { p: hit.p, i: hit.i, y0: pt.y, snap: JSON.stringify(S), orig: JSON.parse(JSON.stringify(S.parts[hit.p].notes[hit.i])), steps: 0, shift: ev.shiftKey, canDrag: ev.pointerType !== 'touch' };
    if (drag.canDrag) try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
  } else drag = { shift: ev.shiftKey };
});
svg.addEventListener('pointermove', (ev) => {
  if (!LAY) return; const pt = pointer(ev);
  if (drag && drag.orig) {
    if (drag.canDrag && drag.orig.type === 'note') { const steps = Math.round((drag.y0 - pt.y) / 5); if (steps !== drag.steps) { drag.steps = steps; applyDrag(drag); } }
    return;
  }
  const gh = $('ghost'); if (!gh || ev.pointerType === 'touch') return;
  if (!tool.chord && noteAt(pt)) { gh.innerHTML = ''; return; }
  const t = target(pt), xh = isKit(t.p) ? (pp) => kitInfo(S.parts[t.p].inst, pp)[3] : null;
  if (tool.chord && t.near >= 0) { gh.innerHTML = noteGlyph({ type: 'note', pitch: t.pitch, alt: 0, dur: 'q', dots: 0 }, LAY.geo[t.p][t.near].x, t.yBot, { col: SEL, bottom: t.bottom, xhead: xh, beamed: true, stemEnd: t.yBot - (t.pitch - t.bottom) * 5 }).svg; return; }
  const n = toolNote(t.pitch, t.p, t.k);
  gh.innerHTML = n.type === 'rest' ? restGlyph(n, t.gx, t.yBot, SEL) : noteGlyph(n, t.gx, t.yBot, { col: SEL, bottom: t.bottom, acc: [tool.acc || ''], xhead: xh }).svg;
});
svg.addEventListener('pointerleave', () => { const gh = $('ghost'); if (gh) gh.innerHTML = ''; });
svg.addEventListener('pointerup', (ev) => {
  const d = drag; drag = null; if (!d || !LAY) return;
  if (d.orig) {
    if (d.steps) { undoStack.push(d.snap); redoStack = []; ap = d.p; sel = selA = d.i; changed(); syncMeta(); return; }
    selectNote(d.p, d.i, d.shift); return;
  }
  clickEmpty(pointer(ev));
});
svg.addEventListener('dblclick', (ev) => {
  const hit = noteAt(pointer(ev)); if (!hit) return;
  const m = splitMeasures(S.parts[hit.p].notes).find((x) => x.items.includes(hit.i)); if (!m) return;
  ap = hit.p; selA = m.items[0]; sel = m.items[m.items.length - 1]; changed(); syncMeta();
});
function applyDrag(d) {
  const part = S.parts[d.p], n = part.notes[d.i], o = d.orig, k = barAt(notePos(part.notes, d.i));
  if (isKit(d.p)) { const ids = kitIds(part.inst).sort((a, b) => a - b), ix = ids.indexOf(kitSnap(part.inst, o.pitch)); n.pitch = ids[Math.max(0, Math.min(ids.length - 1, ix + d.steps))]; }
  else {
    const mv = (h) => { const pitch = Math.max(7, Math.min(63, h.pitch + d.steps)); return { pitch, alt: keyAlter(mod(pitch, 7), keyOf(k)) }; };
    const m = mv(o); n.pitch = m.pitch; n.alt = m.alt; if (o.chord) n.chord = o.chord.map(mv);
  }
  ap = d.p; sel = selA = d.i; resetBarTable(); render(); updateUI(); blipN(d.p, n);
}
function selectNote(p, i, shift) {
  if (shift && p === ap && sel >= 0) { if (selA < 0) selA = sel; sel = i; }
  else { ap = p; sel = selA = i; }
  changed(); syncMeta(); const n = NT()[i]; if (n && n.type === 'note' && !shift) blipN(p, n);
}
function clickEmpty(pt) {
  const t = target(pt);
  if (tool.chord && t.near >= 0) { toggleChordTone(t.p, t.near, t.pitch, t.k); return; }
  ap = t.p;
  const n = toConcert(t.p, toolNote(t.pitch, t.p, t.k), t.k);
  mutate(() => {
    const notes = S.parts[t.p].notes, used = totalBeats(notes), at = barStart(t.k);
    if (used < at - EPS) { notes.push(...restsFor(at - used, used)); notes.push(n); } else notes.splice(t.index, 0, n);
    sel = selA = -1;
  });
  resetOneShots(); updateUI(); syncMeta();
  if (n.type === 'note') blipN(t.p, n);
}
function toggleChordTone(p, i, dispPitch, k) {
  const part = S.parts[p], kit = isKit(p);
  const h = kit ? { pitch: kitSnap(part.inst, dispPitch), alt: 0 } : headToConcert(p, { pitch: dispPitch, alt: tool.acc ? altOfAcc(tool.acc) : keyAlter(mod(dispPitch, 7), writtenKey(p, k, S.concert)) }, k);
  let added = true;
  mutate(() => {
    const n = part.notes[i];
    if (n.type === 'rest') { n.type = 'note'; n.pitch = h.pitch; n.alt = h.alt; ap = p; sel = selA = i; return; }
    const hs = heads(n), ix = hs.findIndex((x) => x.pitch === h.pitch);
    if (ix >= 0) { if (hs.length === 1) return; hs.splice(ix, 1); added = false; } else hs.push(h);
    hs.sort((a, b) => a.pitch - b.pitch); n.pitch = hs[0].pitch; n.alt = hs[0].alt;
    if (hs.length > 1) n.chord = hs.slice(1); else delete n.chord;
    ap = p; sel = selA = i;
  });
  syncMeta(); if (added) blip(kit ? h.pitch : midiOfP(h.pitch, h.alt), part.inst);
}

/* =====================  editing commands  ===================== */
function setDur(d) { tool.dur = d; const idx = rangeIdx(); if (idx.length) mutate(() => idx.forEach((i) => { NT()[i].dur = d; })); else updateUI(); }
function toggleTup() { const idx = rangeIdx(); if (idx.length) { const on = !NT()[idx[0]].tup; mutate(() => idx.forEach((i) => { if (on) NT()[i].tup = 3; else delete NT()[i].tup; })); } else { tool.tup = !tool.tup; updateUI(); } }
function toggleMod(kind, val) {
  const idx = rangeIdx();
  if (!idx.length) {
    if (kind === 'dot') tool.dots = !tool.dots; else if (kind === 'rest') tool.rest = !tool.rest; else tool.acc = tool.acc === val ? '' : val;
    updateUI(); return;
  }
  const first = NT()[idx[0]], kit = isKit(ap);
  mutate(() => idx.forEach((i) => {
    const n = NT()[i], k = barAt(notePos(NT(), i));
    if (kind === 'dot') n.dots = first.dots ? 0 : 1;
    else if (kind === 'rest') {
      if (first.type === 'rest') { n.type = 'note'; if (!n.pitch) { n.pitch = kit ? 35 : CLEFS[S.parts[ap].clef].bottom + 4; n.alt = kit ? 0 : keyAlter(mod(n.pitch, 7), keyOf(k)); } }
      else { n.type = 'rest'; delete n.tie; delete n.chord; delete n.slur; }
    } else if (kind === 'acc' && n.type === 'note' && !kit) {
      const want = altOfAcc(val), dn = LAY && LAY.notes[ap] && LAY.notes[ap][i] ? LAY.notes[ap][i] : n, dk = writtenKey(ap, k, S.concert), dh = heads(dn);
      const all = dh.every((h) => h.alt === want), nh = dh.map((h) => headToConcert(ap, { pitch: h.pitch, alt: all ? keyAlter(mod(h.pitch, 7), dk) : want }, k));
      n.pitch = nh[0].pitch; n.alt = nh[0].alt; if (nh.length > 1) n.chord = nh.slice(1);
    }
  }));
}
function setAttr(kind, val) {
  const idx = rangeIdx();
  if (!idx.length) { tool[kind] = tool[kind] === val ? (kind === 'tie' ? false : '') : val; updateUI(); return; }
  const on = NT()[idx[0]][kind] === val, targets = kind === 'dyn' || kind === 'hp' ? [idx[0]] : idx;
  mutate(() => targets.forEach((i) => {
    const n = NT()[i];
    if (n.type === 'rest' && ((kind === 'art' && val !== 'ferm') || kind === 'tie')) return;
    if (on) delete n[kind]; else n[kind] = val;
  }));
}
function toggleSlur() {
  const r = selRange(); if (!r || r[1] === r[0]) { toast('Select two or more notes (click, then Shift+click) to slur them.'); return; }
  mutate(() => { const n = NT()[r[0]]; if (n.slur === r[1] - r[0]) delete n.slur; else n.slur = r[1] - r[0]; });
}
function movePitch(delta) {
  const idx = rangeIdx().filter((i) => NT()[i].type === 'note'); if (!idx.length) return;
  const kit = isKit(ap), inst = S.parts[ap].inst;
  mutate(() => idx.forEach((i) => {
    const n = NT()[i], k = barAt(notePos(NT(), i));
    if (kit) { const ids = kitIds(inst).sort((a, b) => a - b), ix = ids.indexOf(kitSnap(inst, n.pitch)); n.pitch = ids[Math.max(0, Math.min(ids.length - 1, ix + Math.sign(delta)))]; return; }
    const mv = (h) => { const pitch = Math.max(7, Math.min(63, h.pitch + delta)); return { pitch, alt: keyAlter(mod(pitch, 7), keyOf(k)) }; };
    const m = mv(n); n.pitch = m.pitch; n.alt = m.alt; if (n.chord) n.chord = n.chord.map(mv);
  }));
  blipN(ap, NT()[idx[0]]);
}
function deleteSel() {
  if (!NT().length) return;
  const r = selRange();
  mutate(() => { if (r) { NT().splice(r[0], r[1] - r[0] + 1); sel = selA = Math.min(r[0], NT().length - 1); } else NT().pop(); });
}
function copySel(cut) {
  const r = selRange(); if (!r) { toast('Select notes first: click one, Shift+click another, or double-click for a whole bar.'); return; }
  clip = { notes: JSON.parse(JSON.stringify(NT().slice(r[0], r[1] + 1))), kit: isKit(ap) };
  toast(`${cut ? 'Cut' : 'Copied'} ${r[1] - r[0] + 1} note${r[1] > r[0] ? 's' : ''}.`);
  if (cut) deleteSel(); else updateUI();
}
function pasteClip(at) {
  if (!clip) { toast('Nothing copied yet.'); return; }
  if (clip.kit !== isKit(ap)) { toast(clip.kit ? 'Drum notes can only go into a drum part.' : 'Pitched notes cannot go into a drum part.'); return; }
  const r = selRange(), where = at !== undefined ? at : r ? r[1] + 1 : NT().length, copy = JSON.parse(JSON.stringify(clip.notes));
  mutate(() => { NT().splice(where, 0, ...copy); selA = where; sel = Math.min(NT().length - 1, where + copy.length - 1); });
}
function duplicateSel() {
  const r = selRange(); if (!r) { toast('Select the notes or bar to repeat first.'); return; }
  clip = { notes: JSON.parse(JSON.stringify(NT().slice(r[0], r[1] + 1))), kit: isKit(ap) }; pasteClip(r[1] + 1);
}
function typeNote(letterIdx, asChord) {
  const DN = (LAY && LAY.notes[ap]) || NT(), kit = isKit(ap), inst = S.parts[ap].inst;
  if (asChord) {
    const i = sel >= 0 ? sel : DN.length - 1;
    if (i < 0 || DN[i].type !== 'note') { toast('Select a note to add a chord tone to.'); return; }
    let pitch = Math.max(...heads(DN[i]).map((h) => h.pitch)) + 1; while (mod(pitch, 7) !== letterIdx) pitch++;
    toggleChordTone(ap, i, pitch, barAt(notePos(NT(), i))); return;
  }
  const ref = sel >= 0 && DN[sel] && DN[sel].type === 'note' ? DN[sel].pitch : ([...DN].reverse().find((n) => n.type === 'note') || { pitch: CLEFS[dclef(ap, S.concert)].bottom + 4 }).pitch;
  let best = 0, bd = 1e9;
  for (let oct = 0; oct < 9; oct++) { const d = oct * 7 + letterIdx; if (Math.abs(d - ref) < bd) { bd = Math.abs(d - ref); best = d; } }
  if (kit) best = kitSnap(inst, best);
  const pos = sel >= 0 ? notePos(NT(), sel + 1) : totalBeats(NT()), k = barAt(pos);
  const n = toConcert(ap, toolNote(best, ap, k), k);
  mutate(() => { const at = sel >= 0 ? sel + 1 : NT().length; NT().splice(at, 0, n); if (sel >= 0) sel = selA = at; });
  resetOneShots(); updateUI();
  if (n.type === 'note') blipN(ap, n);
}

/* =====================  lyrics & chord symbols  ===================== */
let textSnap = null;
function textField(id, key) {
  const el = $(id);
  el.addEventListener('focus', () => { textSnap = JSON.stringify(S); if (sel < 0 && NT().length) { sel = selA = 0; render(); updateUI(); } });
  el.addEventListener('blur', () => { if (textSnap && textSnap !== JSON.stringify(S)) { undoStack.push(textSnap); redoStack = []; updateUI(); } textSnap = null; });
  el.addEventListener('input', () => {
    if (sel < 0) return; const n = NT()[sel]; if (!n) return;
    const v = el.value.trim(); if (v) n[key] = v; else delete n[key];
    resetBarTable(); render(); save();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Tab' || (e.key === ' ' && !e.shiftKey)) {
      e.preventDefault(); const dir = e.shiftKey ? -1 : 1; let i = sel + dir;
      while (i >= 0 && i < NT().length && NT()[i].type !== 'note') i += dir;
      if (i >= 0 && i < NT().length) { sel = selA = i; render(); updateUI(); el.value = NT()[i][key] || ''; el.select(); }
    } else if (e.key === 'Escape') el.blur();
  });
}

/* =====================  bars: repeats, endings, marks, changes  ===================== */
function curBar() { const r = selRange(); return r ? barAt(notePos(NT(), r[0])) : -1; }
function setBar(fn) { const k = curBar(); if (k < 0) { toast('Select a note in the bar you want to change.'); return; } mutate(() => { const b = S.bars[k] || {}; fn(b, k); Object.keys(b).forEach((f) => { if (b[f] === undefined || b[f] === false || b[f] === '') delete b[f]; }); if (Object.keys(b).length) S.bars[k] = b; else delete S.bars[k]; }); }
function nextMark() { const used = Object.values(S.bars).map((b) => b.mark).filter(Boolean); for (let c = 65; c < 91; c++) { const m = String.fromCharCode(c); if (!used.includes(m)) return m; } return 'Z'; }

/* =====================  toolbar  ===================== */
function durIcon(d) {
  const filled = d !== 'w' && d !== 'h'; let s = `<svg viewBox="0 0 24 32" fill="none" stroke="currentColor" aria-hidden="true">`;
  if (d === 'w') s += `<ellipse cx="12" cy="20" rx="7.4" ry="5" stroke-width="2.2"/>`;
  else {
    s += `<ellipse cx="9" cy="24" rx="6" ry="4.4" transform="rotate(-20 9 24)" ${filled ? 'fill="currentColor"' : ''} stroke-width="${filled ? 1 : 1.8}"/><line x1="14.4" y1="23.4" x2="14.4" y2="3" stroke-width="1.6"/>`;
    if (d === 'e' || d === 's') s += `<path d="M14.4 3c1.2 8 11 11 8.5 22" stroke-width="2.4" transform="translate(-1 0) scale(1 .9)"/>`;
    if (d === 's') s += `<path d="M14.4 9c1.2 8 11 11 8.5 22" stroke-width="2.4" transform="translate(-1 0) scale(1 .78)"/>`;
  }
  return s + '</svg>';
}
const miniSvg = (inner) => `<svg viewBox="0 0 24 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">${inner}</svg>`;
const EXPR_ICON = {
  cresc: miniSvg('<path d="M3 9 21 3M3 9l18 6"/>'), dim: miniSvg('<path d="M3 3l18 6M3 15l18 -6"/>'),
  stac: miniSvg('<circle cx="12" cy="9" r="2.2" fill="currentColor" stroke="none"/>'), acc: miniSvg('<path d="M6 4l12 5-12 5"/>'),
  ten: miniSvg('<path d="M5 9h14" stroke-width="2.4"/>'), ferm: miniSvg('<path d="M3 13Q12 -2 21 13"/><circle cx="12" cy="10" r="1.6" fill="currentColor" stroke="none"/>'),
  trill: `<svg viewBox="0 0 24 18" aria-hidden="true"><text x="12" y="14" text-anchor="middle" font-family="Newsreader,Georgia,serif" font-style="italic" font-weight="700" font-size="15" fill="currentColor">tr</text></svg>`,
  mord: miniSvg('<path d="M3 11l3-6 3 6 3-6 3 6 3-6 3 6" stroke-linejoin="round"/>'), tie: miniSvg('<path d="M3 5Q12 18 21 5"/>'),
  slur: miniSvg('<path d="M2 14Q12 -2 22 14" stroke-width="2"/>')
};
function buildToolbar() {
  DUR_KEYS.forEach((d, k) => {
    const b = document.createElement('button'); b.className = 'tool'; b.dataset.dur = d; b.setAttribute('aria-pressed', 'false');
    b.title = `${DUR_NAME[d][0].toUpperCase() + DUR_NAME[d].slice(1)} note (${k + 1})`; b.innerHTML = durIcon(d) + `<span>${DUR_NAME[d]}</span>`;
    b.addEventListener('click', () => setDur(d)); $('durs').appendChild(b);
  });
  const tup = document.createElement('button'); tup.className = 'tool'; tup.id = 't-tup'; tup.title = 'Triplet: three notes in the time of two (T)'; tup.setAttribute('aria-pressed', 'false');
  tup.innerHTML = `<svg viewBox="0 0 24 32" aria-hidden="true"><text x="12" y="13" text-anchor="middle" font-family="Newsreader,Georgia,serif" font-style="italic" font-weight="700" font-size="13" fill="currentColor">3</text><path d="M3 10V6h5M16 6h5v4" stroke="currentColor" fill="none" stroke-width="1.2"/><g fill="currentColor"><ellipse cx="5" cy="26" rx="3.2" ry="2.4"/><ellipse cx="12" cy="26" rx="3.2" ry="2.4"/><ellipse cx="19" cy="26" rx="3.2" ry="2.4"/></g></svg><span>triplet</span>`;
  tup.onclick = toggleTup; $('durs').appendChild(tup);
  $('t-rest').innerHTML = `<svg viewBox="0 0 24 32" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4 8 11l5.5 6L8 23" stroke-width="3"/><path d="M8 23q9-2 4 7" stroke-width="2.4"/></svg><span>rest</span>`;
  $('t-dot').innerHTML = `<svg viewBox="0 0 24 32"><ellipse cx="8" cy="22" rx="5" ry="3.7" transform="rotate(-20 8 22)" fill="currentColor"/><line x1="12.6" y1="21.4" x2="12.6" y2="5" stroke="currentColor" stroke-width="1.5"/><circle cx="19" cy="22" r="2.2" fill="currentColor"/></svg><span>dotted</span>`;
  const acc = (k) => `<svg viewBox="-9 -16 18 32" aria-hidden="true">${accGlyph(k, 0, 0, 'currentColor', 1.25)}</svg>`;
  $('t-sharp').innerHTML = acc('#') + '<span>sharp</span>'; $('t-flat').innerHTML = acc('b') + '<span>flat</span>'; $('t-natural').innerHTML = acc('n') + '<span>natural</span>';
  $('t-chord').innerHTML = `<svg viewBox="0 0 24 32" aria-hidden="true"><g fill="currentColor"><ellipse cx="9" cy="26" rx="5" ry="3.6" transform="rotate(-20 9 26)"/><ellipse cx="9" cy="18" rx="5" ry="3.6" transform="rotate(-20 9 18)"/><ellipse cx="9" cy="10" rx="5" ry="3.6" transform="rotate(-20 9 10)"/></g><line x1="13.6" y1="26" x2="13.6" y2="1" stroke="currentColor" stroke-width="1.5"/></svg><span>chord</span>`;
  $('t-rest').onclick = () => toggleMod('rest'); $('t-dot').onclick = () => toggleMod('dot');
  $('t-sharp').onclick = () => toggleMod('acc', '#'); $('t-flat').onclick = () => toggleMod('acc', 'b'); $('t-natural').onclick = () => toggleMod('acc', 'n');
  $('t-chord').onclick = () => { tool.chord = !tool.chord; updateUI(); toast(tool.chord ? 'Chord mode: click above or below a note to add or remove a chord tone.' : 'Chord mode off.'); };
  const mk = (parent, kind, val, html, title) => {
    const b = document.createElement('button'); b.className = 'tool mini'; b.dataset.k = kind; b.dataset.v = String(val); b.title = title; b.setAttribute('aria-label', title); b.setAttribute('aria-pressed', 'false'); b.innerHTML = html;
    b.onclick = () => (kind === 'slur' ? toggleSlur() : setAttr(kind, val === 'true' ? true : val)); parent.appendChild(b);
  };
  DYNS.forEach((d) => mk($('dynrow'), 'dyn', d, `<span class="dyn">${d}</span>`, `Dynamic: ${d}`));
  mk($('dynrow'), 'hp', 'cresc', EXPR_ICON.cresc, 'Crescendo (getting louder)'); mk($('dynrow'), 'hp', 'dim', EXPR_ICON.dim, 'Diminuendo (getting softer)');
  ARTS.forEach(([v, name]) => mk($('artrow'), 'art', v, EXPR_ICON[v], name));
  mk($('artrow'), 'tie', 'true', EXPR_ICON.tie, 'Tie to the next note');
  mk($('artrow'), 'slur', 'x', EXPR_ICON.slur, 'Slur the selected notes (S)');

  const keyOpts = (none) => (none ? `<option value="">Key: no change</option>` : '') + Array.from({ length: 15 }, (_, q) => q - 7).map((k) => `<option value="${k}">${MAJ[k]} major / ${MIN[k]} minor${k ? `  (${Math.abs(k)}${k > 0 ? '♯' : '♭'})` : ''}</option>`).join('');
  const tsOpts = (none) => (none ? `<option value="">Time: no change</option>` : '') + TIMES.map(([a, b]) => `<option value="${a}/${b}">${a}/${b} time</option>`).join('');
  $('key').innerHTML = keyOpts(false); $('ts').innerHTML = tsOpts(false); $('b-key').innerHTML = keyOpts(true); $('b-ts').innerHTML = tsOpts(true);
  $('pinst').innerHTML = instOptions();
  $('templatelist').innerHTML = TEMPLATES.map(([id, name]) => `<button data-tpl="${id}">${name}</button>`).join('');

  $('clef').onchange = (e) => mutate(() => {
    const p = S.parts[ap], I = INSTR[p.inst], same = (I.tr || 0) === (I.cs || 0);
    if (S.concert || same) p.clef = e.target.value; if (!S.concert || same) p.wclef = e.target.value;
  });
  $('key').onchange = (e) => mutate(() => { S.key = +e.target.value; });
  $('ts').onchange = (e) => mutate(() => { S.ts = e.target.value.split('/').map(Number); });
  $('tempo').oninput = (e) => { S.tempo = clampTempo(e.target.value); $('tempoview').textContent = S.tempo; resetBarTable(); save(); };
  $('title').oninput = (e) => { S.title = e.target.value; save(); };
  $('composer').oninput = (e) => { S.composer = e.target.value; save(); };
  $('s-up').onclick = () => movePitch(1); $('s-down').onclick = () => movePitch(-1); $('s-del').onclick = deleteSel;
  $('s-copy').onclick = () => copySel(false); $('s-paste').onclick = () => pasteClip(); $('s-dup').onclick = duplicateSel;
  textField('lyric', 'lyric'); textField('sym', 'sym');
  // bar tools
  $('b-rs').onclick = () => setBar((b) => { b.repStart = !b.repStart; });
  $('b-re').onclick = () => setBar((b) => { b.repEnd = !b.repEnd; if (b.repEnd) b.times = +$('b-times').value; else delete b.times; });
  $('b-times').onchange = () => setBar((b) => { if (b.repEnd) b.times = +$('b-times').value; });
  $('b-e1').onclick = () => setBar((b) => { b.ending = b.ending === 1 ? undefined : 1; });
  $('b-e2').onclick = () => setBar((b) => { b.ending = b.ending === 2 ? undefined : 2; });
  $('b-mark').onclick = () => setBar((b) => { b.mark = b.mark ? undefined : nextMark(); });
  $('b-key').onchange = (e) => setBar((b, k) => { b.key = e.target.value === '' || k === 0 ? undefined : +e.target.value; if (k === 0 && e.target.value !== '') S.key = +e.target.value; });
  $('b-ts').onchange = (e) => setBar((b, k) => { const v = e.target.value; b.ts = v === '' || k === 0 ? undefined : v.split('/').map(Number); if (k === 0 && v) S.ts = v.split('/').map(Number); });
  $('b-tempo').onchange = (e) => setBar((b, k) => { const v = e.target.value; if (k === 0) { if (v) S.tempo = clampTempo(v); b.tempo = undefined; } else b.tempo = v ? clampTempo(v) : undefined; });
  // part controls
  $('pname').oninput = (e) => { S.parts[ap].name = e.target.value || INSTR[S.parts[ap].inst].name; save(); renderTabs(); render(); };
  $('pinst').onchange = (e) => {
    mutate(() => { braceGroup(ap).forEach((q) => { const p = S.parts[q], I = INSTR[e.target.value]; if (braceLabel(p.name) === INSTR[p.inst].name) p.name = p.name.replace(INSTR[p.inst].name, I.name); p.inst = e.target.value; if (I.kit || !p.brace) { p.clef = I.clef; p.wclef = I.wclef || I.clef; } if (!I.tab) p.tab = false; }); });
    syncMeta(); const I = INSTR[S.parts[ap].inst]; blip(I.kit ? 35 : midiOfP(CLEFS[I.clef].bottom + 2, 0) - (I.cs || 0));
  };
  $('pvol').oninput = (e) => { S.parts[ap].vol = +e.target.value; save(); };
  $('ppan').oninput = (e) => { S.parts[ap].pan = +e.target.value; save(); };
  $('pmute').onclick = () => mutate(() => { S.parts[ap].mute = !S.parts[ap].mute; });
  $('psolo').onclick = () => mutate(() => { S.parts[ap].solo = !S.parts[ap].solo; });
  $('ptab').onclick = () => mutate(() => { S.parts[ap].tab = !S.parts[ap].tab; });
  $('pgrand').onclick = () => {
    const g = braceGroup(ap);
    if (g.length > 1) { mutate(() => g.forEach((q) => { S.parts[q].brace = ''; })); toast('Staves split into separate parts.'); return; }
    if (S.parts.length >= 16) { toast('That is the maximum of 16 parts.'); return; }
    mutate(() => {
      const p = S.parts[ap], id = 'g' + Math.random().toString(36).slice(2, 8), base = braceLabel(p.name);
      p.brace = id; p.name = base + ' (RH)';
      S.parts.splice(ap + 1, 0, newPart(p.inst, base + ' (LH)', { brace: id, clef: 'bass', wclef: 'bass', vol: p.vol, pan: p.pan }));
    });
    syncMeta(); toast('Grand staff: the lower staff is a bass-clef part for the left hand.');
  };
  $('pdel').onclick = () => {
    if (S.parts.length < 2) return;
    mutate(() => { const b = S.parts[ap].brace; S.parts.splice(ap, 1); if (b) { const rest = S.parts.filter((q) => q.brace === b); if (rest.length === 1) rest[0].brace = ''; } ap = Math.max(0, ap - 1); view = 'score'; sel = selA = -1; });
    syncMeta();
  };
  $('concert').onclick = () => { S.concert = !S.concert; changed(); syncMeta(); toast(S.concert ? 'Showing concert pitch: the notes you hear.' : 'Showing written pitch: what each player reads.'); };
  // header
  $('undo').onclick = undo; $('redo').onclick = redo; $('play').onclick = togglePlay; $('pbstop').onclick = stopAny;
  $('loopbtn').onclick = () => { prefs.loop = !prefs.loop; savePrefs(); updateUI(); toast(prefs.loop ? 'Loop on: playback repeats the selected bars (or the whole piece).' : 'Loop off.'); if (playing) { stopPlay(); togglePlay(); } };
  $('templatelist').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tpl]'); if (!b) return; $('newmenu').open = false;
    if (isBusy()) stopAny();
    mutate(() => { S = makeTemplate(b.dataset.tpl); ap = 0; view = 'score'; sel = selA = -1; });
    syncMeta(); toast('New score. Undo brings your old one back.');
  });
  [['opt-click', 'click'], ['opt-real', 'real'], ['opt-names', 'names'], ['opt-finger', 'finger']].forEach(([id, key]) => {
    $(id).checked = !!prefs[key];
    $(id).onchange = (e) => { prefs[key] = e.target.checked; savePrefs(); render(); if (key === 'real' && prefs.real) preloadForScore().then((f) => { if (!f) toast('Recorded sounds ready.'); }); };
  });
  $('opt-swing').onchange = (e) => { S.swing = e.target.checked; save(); };
  // panels
  const panel = (btn, id, onClose) => { $(btn).onclick = () => { const p = $(id); p.hidden = !p.hidden; $(btn).setAttribute('aria-pressed', p.hidden ? 'false' : 'true'); if (p.hidden && onClose) onClose(); }; };
  panel('micbtn', 'micpanel', () => { if (mic.on) micStop(); });
  panel('practicebtn', 'practicepanel', () => { if (practice.on) practiceStop(); });
  panel('earbtn', 'earpanel');
  $('micgo').onclick = () => (mic.on ? micStop() : micStart());
  $('prgo').onclick = () => (practice.on ? practiceStop() : practiceStart());
  $('prclear').onclick = () => { practiceMarks = {}; render(); prMsg('Marks cleared.'); };
  $('earnext').onclick = earNew; $('earreplay').onclick = earPlay;
  $('micfile').onclick = () => $('micfileinput').click();
  $('micfileinput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) transcribeFile(f); });
  if (HOSTED) adaptForClaude();
  // original-music composer
  const doCompose = () => {
    let res;
    try { res = composePiece({ style: $('cp-style').value, mood: $('cp-mood').value, bars: $('cp-bars').value }); }
    catch (e) { toast('Could not compose: ' + e.message); return; }
    if (isBusy()) stopAny();
    mutate(() => { S = res.score; ap = 0; view = 'score'; sel = selA = -1; });
    syncMeta();
    const i = res.info;
    $('cpmsg').textContent = `“${S.title}”: ${i.style} in ${i.key}, ${i.bars} bars at ♩ = ${i.tempo}. Main chords: ${i.progression}. Press Compose another for a new piece, or Undo to get your previous score back.`;
    toast(`Composed “${S.title}”.`);
    if ($('cp-play').checked) togglePlay();
  };
  $('composebtn').onclick = () => { $('composepanel').hidden = false; doCompose(); };
  $('cp-go').onclick = doCompose;
  $('cp-sonnet').onclick = () => {
    const st = $('cp-style'), style = st.value === 'any' ? 'any style you like' : st.options[st.selectedIndex].text + ' style', mood = { any: '', maj: ', bright and in a major key', min: ', dark and in a minor key' }[$('cp-mood').value];
    $('sonnet').hidden = false; $('sonnetbtn').setAttribute('aria-pressed', 'true');
    $('chatin').value = `Compose an original ${$('cp-bars').value}-bar piece in ${style}${mood}. Write it as new parts ("part": "new") for melody, chords, bass and drums (if the style uses them), all starting at bar 1, with dynamics and chord symbols. Give the melody a memorable repeated motif and a strong ending.`;
    $('chatin').focus(); toast('Press Send. Sonnet’s parts are added to the current score, so start a New score first for a clean page.');
  };
  $('sonnetbtn').onclick = () => { const d = $('sonnet'); d.hidden = !d.hidden; $('sonnetbtn').setAttribute('aria-pressed', d.hidden ? 'false' : 'true'); if (!d.hidden) $('chatin').focus(); };
  $('sonnetclose').onclick = () => { $('sonnet').hidden = true; $('sonnetbtn').setAttribute('aria-pressed', 'false'); };
  $('compose').onsubmit = (e) => { e.preventDefault(); if (sonnetCtl) { sonnetCtl.abort(); return; } const q = $('chatin').value.trim(); if (!q) return; $('chatin').value = ''; ask(q); };
  $('chatin').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('compose').requestSubmit(); } });
  ['Suggest dynamics for this piece', 'Harmonize the melody', 'Write a bass line', 'Add a drum groove', 'Arrange this for sax quartet', 'Explain the theory'].forEach((t) => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = t; b.onclick = () => ask(t); $('chips').appendChild(b); });
  try { const k = localStorage.getItem('quaver:apikey'); if (k) { $('apikey').value = k; $('keysave').checked = true; } } catch (e) {}
  addMsg('bot', "Hi, I'm Sonnet. I can research this piece, suggest dynamics and ornaments, and write music for you: harmonies, bass lines, drum grooves or whole arrangements.");
  // import / export
  $('importbtn').onclick = () => $('fileinput').click();
  $('fileinput').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const sc = await importFile(f);
      if (isBusy()) stopAny();
      mutate(() => { S = sc; ap = 0; view = 'score'; sel = selA = -1; }); syncMeta();
      toast(`Imported ${sc.parts.length} part${sc.parts.length > 1 ? 's' : ''}, ${playBars()} bars.`);
    } catch (err) { toast(err.message || 'Could not import that file.'); }
  });
  document.querySelectorAll('#exportmenu .menu-list button').forEach((b) => b.addEventListener('click', async () => {
    $('exportmenu').open = false; const a = b.dataset.act;
    try {
      if (a === 'png') await exportPNG();
      else if (a === 'print') { const t = document.title; document.title = fileBase(); window.print(); document.title = t; }
      else if (a === 'printall') await printAll();
      else if (a === 'midi') await download(fileBase() + '.mid', new Blob([buildMIDI()], { type: 'audio/midi' }), 'MIDI file saved.');
      else if (a === 'musicxml') await download(fileBase() + '.musicxml', new Blob([buildMusicXML()], { type: 'application/vnd.recordare.musicxml+xml' }), 'MusicXML saved. Open it in MuseScore, Finale, Sibelius or Dorico.');
      else if (a === 'video') await exportVideo().catch(() => {});
      else if (a === 'wav') { toast('Rendering audio…'); const buf = await renderWAV(); await download(fileBase() + '.wav', wavBlob(buf), 'Audio saved.'); }
      else if (a === 'json') await download(fileBase() + '.quaver.json', new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }), 'Score file saved.');
    } catch (err) { toast('Export failed: ' + (err.message || err)); }
  }));
  document.addEventListener('click', (e) => { document.querySelectorAll('details.menu[open]').forEach((m) => { if (!m.contains(e.target)) m.open = false; }); });
}
function renderTabs() {
  const tabs = $('tabs'); tabs.innerHTML = '';
  const groups = playerGroups();
  const add = (label, selected, cls, fn) => { const b = document.createElement('button'); b.className = 'tab ' + (cls || ''); b.textContent = label; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', selected ? 'true' : 'false'); b.onclick = fn; tabs.appendChild(b); };
  if (groups.length > 1) add('Full score', view === 'score', '', () => { view = 'score'; sel = selA = -1; changed(); syncMeta(); });
  groups.forEach((g) => add(braceLabel(S.parts[g[0]].name), view === g[0] || (groups.length === 1), g.includes(ap) ? 'active-part' : '', () => { view = g[0]; if (!g.includes(ap)) ap = g[0]; sel = selA = -1; changed(); syncMeta(); }));
  const s = document.createElement('select'); s.className = 'addsel'; s.setAttribute('aria-label', 'Add a part');
  s.innerHTML = '<option value="">+ Add part…</option>' + instOptions();
  s.onchange = () => {
    const k = s.value; if (!k) return; if (S.parts.length >= 16) { toast('That is the maximum of 16 parts.'); return; }
    const uniq = (base) => { let n = base, c = 2; while (S.parts.some((p) => braceLabel(p.name) === n)) n = base + ' ' + c++; return n; };
    mutate(() => { const name = uniq(INSTR[k].name); if (INSTR[k].grand) S.parts.push(...grandParts(k, name)); else S.parts.push(newPart(k, name)); ap = S.parts.length - (INSTR[k].grand ? 2 : 1); view = 'score'; sel = selA = -1; });
    syncMeta();
  };
  tabs.appendChild(s);
}
function syncMeta() {
  $('title').value = S.title || ''; $('composer').value = S.composer || '';
  $('clef').value = dclef(ap, S.concert); $('clef').disabled = isKit(ap); $('clef').querySelector('[value=perc]').disabled = !isKit(ap);
  $('key').value = S.key; $('ts').value = S.ts.join('/'); $('tempo').value = S.tempo; $('tempoview').textContent = S.tempo;
  $('pname').value = S.parts[ap].name; $('pinst').value = S.parts[ap].inst; $('pvol').value = S.parts[ap].vol; $('ppan').value = S.parts[ap].pan;
  $('opt-swing').checked = !!S.swing;
}
const press = (el, on) => el.setAttribute('aria-pressed', on ? 'true' : 'false');
function updateUI() {
  const r = selRange(), n = r ? NT()[r[0]] : null, part = S.parts[ap];
  const cur = n || { dur: tool.dur, dots: tool.dots ? 1 : 0, alt: 0, type: tool.rest ? 'rest' : 'note', dyn: tool.dyn, hp: tool.hp, art: tool.art, tie: tool.tie, tup: tool.tup };
  document.querySelectorAll('#durs .tool[data-dur]').forEach((b) => press(b, b.dataset.dur === (n ? n.dur : tool.dur)));
  press($('t-tup'), !!cur.tup); press($('t-rest'), cur.type === 'rest'); press($('t-dot'), !!cur.dots); press($('t-chord'), tool.chord);
  const accShown = n ? (LAY && LAY.acc[ap] && LAY.acc[ap][r[0]] ? LAY.acc[ap][r[0]][0] : '') : tool.acc;
  press($('t-sharp'), accShown === '#'); press($('t-flat'), accShown === 'b'); press($('t-natural'), accShown === 'n');
  document.querySelectorAll('.tool.mini[data-k]').forEach((b) => { const k = b.dataset.k; press(b, k === 'slur' ? !!(n && n.slur) : b.dataset.v === 'true' ? !!cur.tie : cur[k] === b.dataset.v); });
  $('undo').disabled = !undoStack.length; $('redo').disabled = !redoStack.length;
  $('s-up').disabled = $('s-down').disabled = $('s-copy').disabled = $('s-dup').disabled = !r;
  $('s-paste').disabled = !clip; $('s-del').disabled = !NT().length; $('s-del').textContent = r ? (r[1] > r[0] ? 'Delete notes' : 'Delete note') : 'Delete last';
  $('lyric').disabled = $('sym').disabled = !r || isKit(ap);
  if (document.activeElement !== $('lyric')) $('lyric').value = n && n.lyric ? n.lyric : '';
  if (document.activeElement !== $('sym')) $('sym').value = n && n.sym ? n.sym : '';
  const k = curBar(), b = k >= 0 ? S.bars[k] || {} : {};
  $('barlabel').textContent = k >= 0 ? `Bar ${k + 1}` : 'Bar –';
  ['b-rs', 'b-re', 'b-e1', 'b-e2', 'b-mark', 'b-key', 'b-ts', 'b-tempo', 'b-times'].forEach((id) => { $(id).disabled = k < 0; });
  press($('b-rs'), !!b.repStart); press($('b-re'), !!b.repEnd); press($('b-e1'), b.ending === 1); press($('b-e2'), b.ending === 2); press($('b-mark'), !!b.mark);
  $('b-mark').textContent = b.mark ? 'Mark ' + b.mark : 'Mark';
  $('b-times').value = String(b.times || 2);
  $('b-key').value = k === 0 ? String(S.key) : b.key !== undefined ? String(b.key) : '';
  $('b-ts').value = k === 0 ? S.ts.join('/') : b.ts ? b.ts.join('/') : '';
  if (document.activeElement !== $('b-tempo')) $('b-tempo').value = k === 0 ? S.tempo : b.tempo || '';
  press($('pmute'), part.mute); press($('psolo'), part.solo); press($('ptab'), part.tab); $('ptab').hidden = !INSTR[part.inst].tab;
  press($('pgrand'), braceGroup(ap).length > 1); $('pgrand').hidden = !!INSTR[part.inst].kit;
  $('pdel').disabled = S.parts.length < 2; press($('concert'), S.concert); press($('loopbtn'), prefs.loop);
  $('viewlabel').textContent = currentLabel();
  renderTabs();
  const txt = $('statustxt');
  if (r && r[1] > r[0]) {
    const b1 = barAt(notePos(NT(), r[0])) + 1, b2 = barAt(notePos(NT(), r[1])) + 1;
    txt.innerHTML = `<b>${r[1] - r[0] + 1} notes</b> selected · ${b1 === b2 ? 'bar ' + b1 : 'bars ' + b1 + '–' + b2} · ${esc(part.name)}`;
  } else if (n) {
    let name;
    if (n.type === 'rest') name = 'Rest';
    else if (isKit(ap)) name = heads(n).map((h) => kitInfo(part.inst, h.pitch)[0]).join(' + ');
    else { const d = LAY && LAY.notes[ap] ? LAY.notes[ap][r[0]] : n, sh = dshift(ap, S.concert); name = heads(d).map((h) => pitchName(h.pitch, h.alt)).join(' ') + (sh ? ` <small>(sounds ${heads(n).map((h) => pitchName(h.pitch, h.alt)).join(' ')})</small>` : ''); }
    txt.innerHTML = `<b>${name}</b> · ${n.dots ? 'dotted ' : ''}${DUR_NAME[n.dur]}${n.tup ? ' triplet' : ''} · bar ${barAt(notePos(NT(), r[0])) + 1} · ${esc(part.name)}`;
  } else {
    const extra = [tool.dyn, tool.hp && (tool.hp === 'cresc' ? 'crescendo' : 'diminuendo'), tool.art && ARTS.find((a) => a[0] === tool.art)[1].toLowerCase(), tool.tie && 'tie'].filter(Boolean).join(', ');
    const nxt = tool.rest ? 'rest' : `${tool.dots ? 'dotted ' : ''}${DUR_NAME[tool.dur]}${tool.tup ? ' triplet' : ''}${tool.acc ? ' ' + { '#': 'sharp', b: 'flat', n: 'natural' }[tool.acc] : ''} note`;
    txt.innerHTML = tool.chord ? `<b>Chord mode</b>: click above or below a note in <b>${esc(part.name)}</b> to stack a note` : `Next click places ${/^[aeiou]/.test(nxt) ? 'an' : 'a'} <b>${nxt}</b>${extra ? ' with ' + extra : ''} in <b>${esc(part.name)}</b>`;
  }
}

/* =====================  published on claude.ai  ===================== */
/* The page there can't use the microphone, fetch recordings from other sites or open the print
   dialog, so those controls step aside; Sonnet uses the viewer's Claude account instead of a key. */
function adaptForClaude() {
  const hide = (el) => { if (el) el.hidden = true; };
  hide($('micgo')); hide($('mic-count').closest('label')); hide($('mic-click').closest('label')); hide(document.querySelector('#micpanel .meter'));
  $('micmsg').textContent = 'This version of Quaver can’t use your microphone, so record yourself with any voice memo app, one note at a time at the score’s tempo, then choose Transcribe a recording. It writes into the selected part.';
  hide($('practicebtn'));
  hide($('opt-real').closest('label')); prefs.real = false;
  document.querySelectorAll('#exportmenu [data-act="print"], #exportmenu [data-act="printall"]').forEach(hide);
  document.querySelectorAll('#exportmenu [data-act="midi"] small, #exportmenu [data-act="musicxml"] small, #exportmenu [data-act="wav"] small').forEach((s) => { s.textContent += ' (saved inside a .zip)'; });
  ['apikey', 'keysave', 'websearch'].forEach((id) => hide($(id).closest('label')));
  document.querySelector('#sonnet .cfg small').textContent = 'Sonnet reads your score, suggests dynamics and ornaments, and writes new music (harmonies, bass lines, drum grooves, arrangements) that you add with one click. It uses your Claude account, and Claude asks you to allow it the first time.';
}

/* =====================  keyboard  ===================== */
const TEXT_INPUTS = /^(text|search|email|url|password|number|tel|)$/;
const typingIn = (el) => { const tag = (el.tagName || '').toLowerCase(); return tag === 'textarea' || el.isContentEditable || (tag === 'input' && TEXT_INPUTS.test((el.getAttribute('type') || '').toLowerCase())); };
document.addEventListener('keydown', (e) => {
  // while music plays, Esc stops it from anywhere, and so does Space unless you're typing words
  if (isBusy() && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'Escape' || (e.key === ' ' && !typingIn(e.target)))) {
    e.preventDefault(); stopAny(); return;
  }
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  const k = e.key, md = e.metaKey || e.ctrlKey, lk = k.toLowerCase();
  if (md && lk === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (md && lk === 'y') { e.preventDefault(); redo(); return; }
  if (md && lk === 'c') { e.preventDefault(); copySel(false); return; }
  if (md && lk === 'x') { e.preventDefault(); copySel(true); return; }
  if (md && lk === 'v') { e.preventDefault(); pasteClip(); return; }
  if (md && lk === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (md || e.altKey) return;
  if (/^[a-g]$/.test(lk)) { e.preventDefault(); typeNote(LETTERS.indexOf(lk.toUpperCase()), e.shiftKey); }
  else if (/^[1-5]$/.test(k)) setDur(DUR_KEYS[+k - 1]);
  else if (lk === 't') toggleTup();
  else if (lk === 'r') toggleMod('rest'); else if (k === '.') toggleMod('dot');
  else if (k === '+' || k === '=') toggleMod('acc', '#'); else if (k === '-' || k === '_') toggleMod('acc', 'b'); else if (lk === 'n') toggleMod('acc', 'n');
  else if (lk === 's') toggleSlur();
  else if (lk === 'l') { e.preventDefault(); $('lyric').focus(); } else if (lk === 'k') { e.preventDefault(); $('sym').focus(); }
  else if (k === 'ArrowUp') { e.preventDefault(); movePitch(e.shiftKey ? 7 : 1); } else if (k === 'ArrowDown') { e.preventDefault(); movePitch(e.shiftKey ? -7 : -1); }
  else if (k === 'ArrowRight' || k === 'ArrowLeft') {
    e.preventDefault(); if (!NT().length) return;
    const dir = k === 'ArrowRight' ? 1 : -1, ni = sel < 0 ? (dir > 0 ? 0 : NT().length - 1) : Math.max(0, Math.min(NT().length - 1, sel + dir));
    if (e.shiftKey && sel >= 0) { if (selA < 0) selA = sel; sel = ni; } else sel = selA = ni;
    changed(); const n = NT()[sel]; if (n.type === 'note' && !e.shiftKey) blipN(ap, n);
  }
  else if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); deleteSel(); }
  else if (k === 'Escape') { sel = selA = -1; tool.chord = false; changed(); }
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
});
document.addEventListener('keyup', (e) => { if (e.key === ' ' && /^(button|summary)$/i.test(e.target.tagName)) e.preventDefault(); });

/* =====================  start-up  ===================== */
(function boot() {
  let loaded = null;
  try { loaded = normalize(JSON.parse(localStorage.getItem(STORE) || 'null')) || normalize(JSON.parse(localStorage.getItem('quaver:v2') || 'null')); } catch (e) {}
  S = loaded || normalize(demoScore());
  buildToolbar(); resetBarTable(); fixView(); syncMeta();
  let lastW = 0;
  new ResizeObserver(() => requestAnimationFrame(() => { const w = $('sheet').clientWidth; if (w !== lastW) { lastW = w; render(); updateUI(); } })).observe($('sheet'));
  changed();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);
})();
window.Quaver = {
  get S() { return S; }, get LAY() { return LAY; }, setScore(s) { S = normalize(s); ap = 0; view = 'score'; sel = selA = -1; changed(); syncMeta(); },
  detectPitch, transcribeFrames, eventsToNotes, spell, parseMIDI, midiToScore, xmlToScore, buildMIDI, buildMusicXML, scoreToText, parseNotation, applySuggestions, applyComposition, handleReply,
  playOrder, buildPlan, scheduleRun, renderWAV, judgePractice, showPracticeResult, levels, normalize, makeTemplate, select(p, a, b) { ap = p; selA = a; sel = b === undefined ? a : b; changed(); syncMeta(); }
};
