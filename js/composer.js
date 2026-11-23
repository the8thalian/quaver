'use strict';
/* Quaver · composer.js
   Writes an original piece from scratch, the way a songwriter builds one:
   a form (A A' B A''), a chord progression for the style, a melody grown from a repeated rhythmic motif
   (mostly stepwise, chord tones on strong beats, cadences at phrase ends), then accompaniment, bass and drums.
   Everything is rule-based and runs in the browser; a seed makes each piece reproducible. */

function makeRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const cpick = (r, arr) => arr[Math.floor(r() * arr.length)];
function weighted(r, items) {
  const tot = items.reduce((s, x) => s + Math.max(0, x[1]), 0); if (tot <= 0) return items[0][0];
  let u = r() * tot; for (const [v, w] of items) { u -= Math.max(0, w); if (u <= 0) return v; } return items[items.length - 1][0];
}

const C_MAJ = [0, 2, 4, 5, 7, 9, 11], C_MIN = [0, 2, 3, 5, 7, 8, 10];
const Q_INT = { maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10], '5': [0, 7], sus4: [0, 5, 7], add9: [0, 4, 7, 14], m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14] };
const Q_LET = { maj: [0, 2, 4], min: [0, 2, 4], dim: [0, 2, 4], '7': [0, 2, 4, 6], maj7: [0, 2, 4, 6], m7: [0, 2, 4, 6], m7b5: [0, 2, 4, 6], '5': [0, 4], sus4: [0, 3, 4], add9: [0, 2, 4, 1], m9: [0, 2, 4, 6, 1], maj9: [0, 2, 4, 6, 1] };
const Q_SYM = { maj: '', min: 'm', dim: 'dim', '7': '7', maj7: 'maj7', m7: 'm7', m7b5: 'm7b5', '5': '5', sus4: 'sus4', add9: 'add9', m9: 'm9', maj9: 'maj9' };
const KEYS_MAJ = [[0, 0, 0], [7, 4, 1], [2, 1, 2], [9, 5, 3], [5, 3, -1], [10, 6, -2], [3, 2, -3]];   // [tonic pitch class, letter, key signature]
const KEYS_MIN = [[9, 5, 0], [4, 2, 1], [11, 6, 2], [2, 1, -1], [7, 4, -2], [0, 0, -3]];
function parseRoman(rn, minor) {
  const m = /^([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(°|ø)?(maj9|maj7|m9|7|5|sus4|add9)?$/.exec(rn);
  if (!m) throw new Error('Unknown chord ' + rn);
  const deg = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'].indexOf(m[2].toUpperCase()), upper = m[2] === m[2].toUpperCase();
  let q = m[3] === '°' ? 'dim' : m[3] === 'ø' ? 'm7b5' : upper ? 'maj' : 'min';
  const s = m[4];
  if (s === '7') q = q === 'maj' ? '7' : q === 'min' ? 'm7' : 'm7b5';
  else if (s) q = s === 'add9' && !upper ? 'min' : s === 'maj9' || s === 'm9' || s === 'maj7' || s === '5' || s === 'sus4' || s === 'add9' ? s : q;
  return { deg, acc: m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0, q };
}

/* ---------- styles ---------- */
const COMPOSE_STYLES = {
  pop: {
    name: 'Pop', tempo: [96, 116], ts: [4, 4],
    prog: { maj: ['I V vi IV', 'vi IV I V', 'I vi IV V', 'I V IV V', 'IV I V vi'], min: ['i VI III VII', 'i iv VI V', 'i VII VI VII', 'VI VII i i'] },
    bridge: { maj: ['IV V iii vi', 'vi V IV V', 'IV IV I V', 'ii V I vi'], min: ['VI VII i i', 'iv VI VII V', 'III VII VI V'] },
    final: { maj: [['V', 'I'], ['IV', 'I']], min: [['V', 'i'], ['VII', 'i']] },
    rhythms: [[1, 0.5, 0.5, 1, 1], [0.5, 0.5, 1, 0.5, 0.5, 1], [1.5, 0.5, 1, 1], [1, 1, 0.5, 0.5, 1], [0.5, 1, 0.5, 2], [-0.5, 0.5, 1, 1, 1]],
    cadence: [[2, 2], [3, -1], [1, 1, 2], [2, 1, -1]],
    parts: [{ inst: 'voice', name: 'Melody', role: 'mel', lo: 62, hi: 77 }, { inst: 'piano', name: 'Piano', role: 'pianoPop' }, { inst: 'ebass', name: 'Bass', role: 'bassPop' }, { inst: 'drums', name: 'Drums', role: 'drums', kit: 'pop' }]
  },
  rock: {
    name: 'Rock', tempo: [116, 138], ts: [4, 4],
    prog: { maj: ['I bVII IV I', 'I IV V IV', 'I V IV IV', 'vi IV I V'], min: ['i VII VI VII', 'i iv VII i', 'i VI VII i'] },
    bridge: { maj: ['IV V IV V', 'vi IV V V', 'bVI bVII I I'], min: ['VI VII i i', 'iv iv VI VII', 'III VII iv V'] },
    final: { maj: [['V', 'I'], ['bVII', 'I']], min: [['VII', 'i'], ['V', 'i']] },
    rhythms: [[1, 0.5, 0.5, 1, 1], [0.5, 0.5, 0.5, 0.5, 2], [1.5, 0.5, 1.5, 0.5], [-0.5, 0.5, 0.5, 0.5, 1, 1], [1, 1, 2]],
    cadence: [[2, 2], [3, -1], [0.5, 0.5, 1, 2]],
    parts: [{ inst: 'eguitar', name: 'Lead guitar', role: 'mel', lo: 59, hi: 79 }, { inst: 'eguitar', name: 'Rhythm guitar', role: 'power', tab: true }, { inst: 'ebass', name: 'Bass', role: 'bassRock', tab: true }, { inst: 'drums', name: 'Drums', role: 'drums', kit: 'rock' }]
  },
  jazz: {
    name: 'Jazz', tempo: [120, 160], ts: [4, 4], swing: true,
    prog: { maj: ['ii7 V7 Imaj7 Imaj7', 'Imaj7 vi7 ii7 V7', 'iii7 vi7 ii7 V7', 'Imaj7 IV7 iii7 VI7'], min: ['iiø7 V7 i7 i7', 'i7 iv7 iiø7 V7', 'i7 VImaj7 iiø7 V7'] },
    bridge: { maj: ['IVmaj7 iv7 iii7 VI7', 'ii7 V7 iii7 VI7', 'vi7 II7 ii7 V7'], min: ['iv7 VII7 IIImaj7 VImaj7', 'VImaj7 iiø7 V7 i7'] },
    final: { maj: [['V7', 'Imaj7'], ['ii7', 'Imaj7']], min: [['V7', 'i7'], ['iiø7', 'i7']] },
    rhythms: [[1.5, 0.5, 1, 1], [0.5, 1, 0.5, 2], [1, 0.5, 0.5, 1.5, 0.5], [-0.5, 0.5, 0.5, 0.5, 1, 1], [0.5, 0.5, 0.5, 0.5, 2], [-1, 0.5, 0.5, 0.5, 1.5]],
    cadence: [[2, 2], [1.5, 0.5, 2], [3, -1]],
    parts: [{ inst: 'altosax', name: 'Alto sax', role: 'mel', lo: 58, hi: 77 }, { inst: 'piano', name: 'Piano', role: 'compJazz', single: true }, { inst: 'doublebass', name: 'Bass', role: 'walk' }, { inst: 'drums', name: 'Drums', role: 'drums', kit: 'jazz' }]
  },
  classical: {
    name: 'Classical', tempo: [84, 108], ts: [4, 4],
    prog: { maj: ['I IV V I', 'I vi ii V', 'I ii V I', 'I V vi iii'], min: ['i iv V i', 'i VI iv V', 'i VI ii° V'] },
    bridge: { maj: ['vi iii IV V', 'IV V iii vi', 'ii V I IV'], min: ['III VII i V', 'VI III iv V', 'iv i V i'] },
    final: { maj: [['V7', 'I']], min: [['V7', 'i']] },
    rhythms: [[1, 1, 1, 1], [0.5, 0.5, 1, 1, 1], [1.5, 0.5, 1, 1], [1, 0.5, 0.5, 2], [2, 1, 1], [1, 1, 0.5, 0.5, 1]],
    cadence: [[2, 2], [3, 1], [1, 1, 2]],
    parts: [{ inst: 'violin', name: 'Violin I', role: 'mel', lo: 67, hi: 86 }, { inst: 'violin', name: 'Violin II', role: 'innerHi' }, { inst: 'viola', name: 'Viola', role: 'innerLo' }, { inst: 'cello', name: 'Cello', role: 'bassClassical' }]
  },
  lofi: {
    name: 'Lo-fi chill', tempo: [70, 86], ts: [4, 4], swing: true,
    prog: { maj: ['Imaj7 vi7 ii7 V7', 'IVmaj7 iii7 vi7 Imaj7', 'IVmaj7 V7 iii7 vi7', 'ii7 V7 Imaj7 IVmaj7'], min: ['i7 iv7 VII7 IIImaj7', 'i7 VImaj7 iv7 V7', 'i7 iv7 i7 V7'] },
    bridge: { maj: ['vi7 ii7 IVmaj7 V7', 'IVmaj7 iv7 iii7 vi7'], min: ['VImaj7 VII7 IIImaj7 V7', 'iv7 VII7 i7 i7'] },
    final: { maj: [['V7', 'Imaj7'], ['IVmaj7', 'Imaj7']], min: [['V7', 'i7'], ['VII7', 'i7']] },
    rhythms: [[-1, 0.5, 0.5, 1, 1], [1.5, 0.5, -1, 1], [-0.5, 0.5, 1, 2], [1, 0.5, 0.5, -2], [0.5, 0.5, 1, -1, 1]],
    cadence: [[2, -2], [3, -1], [-1, 1, 2]],
    parts: [{ inst: 'vibraphone', name: 'Vibes', role: 'mel', lo: 64, hi: 81 }, { inst: 'epiano', name: 'Keys', role: 'padLofi' }, { inst: 'synthbass', name: 'Bass', role: 'bassLofi' }, { inst: 'drums', name: 'Drums', role: 'drums', kit: 'lofi' }]
  },
  waltz: {
    name: 'Folk waltz', tempo: [126, 150], ts: [3, 4],
    prog: { maj: ['I V V I', 'I IV V I', 'I vi IV V', 'I I IV V'], min: ['i iv V i', 'i VI iv V', 'i VII VI V'] },
    bridge: { maj: ['IV I V I', 'vi IV V V', 'IV V iii vi'], min: ['III VII i V', 'VI III iv V'] },
    final: { maj: [['V', 'I']], min: [['V', 'i']] },
    rhythms: [[1, 1, 1], [2, 1], [1.5, 0.5, 1], [0.5, 0.5, 1, 1], [1, 0.5, 0.5, 1]],
    cadence: [[3], [2, 1], [2, -1]],
    parts: [{ inst: 'flute', name: 'Flute', role: 'mel', lo: 67, hi: 86 }, { inst: 'guitar', name: 'Guitar', role: 'oompah' }, { inst: 'bass', name: 'Bass', role: 'bassWaltz' }]
  },
  film: {
    name: 'Film score', tempo: [64, 78], ts: [4, 4],
    prog: { maj: ['I V vi IV', 'vi IV I V', 'I iii IV IV', 'IV I V vi'], min: ['i VI III VII', 'i VI iv V', 'VI III VII i'] },
    bridge: { maj: ['vi IV I V', 'IV V vi vi', 'bVI bVII I I'], min: ['VI VII i i', 'iv VI VII V'] },
    final: { maj: [['IV', 'I'], ['V', 'I']], min: [['VII', 'i'], ['V', 'i']] },
    rhythms: [[2, 2], [3, 1], [1, 1, 2], [1.5, 0.5, 2], [2, 1, 1]],
    cadence: [[4], [2, 2], [3, 1]],
    parts: [{ inst: 'horn', name: 'Horn', role: 'mel', lo: 55, hi: 72 }, { inst: 'strings', name: 'Strings', role: 'padFilm' }, { inst: 'cello', name: 'Cellos', role: 'bassFilm' }, { inst: 'timpani', name: 'Timpani', role: 'timp' }]
  }
};
const TITLE_A = { maj: ['Golden', 'Morning', 'Bright', 'Paper', 'Summer', 'Velvet', 'Silver', 'Open', 'Sunlit', 'Wandering', 'Little', 'Painted', 'Electric', 'Kind'], min: ['Midnight', 'Hollow', 'Distant', 'Winter', 'Quiet', 'Fading', 'Rainy', 'Lonely', 'Northern', 'Ashen', 'Last', 'Silent', 'Broken', 'Grey'] };
const TITLE_N = ['Lanterns', 'Avenue', 'Harbor', 'Sky', 'Letters', 'Garden', 'Echoes', 'Rooftops', 'Tides', 'Road', 'Fields', 'Lights', 'River', 'Dreams', 'Stations', 'Clouds', 'Window', 'Trains', 'Shore', 'Hours'];

/* ---------- helpers ---------- */
function spellAs(midi, letter, key) {
  const oct = Math.round((midi - SEMI[letter]) / 12) - 1, pitch = oct * 7 + letter, alt = midi - midiOfP(pitch, 0);
  return alt < -1 || alt > 1 ? spell(midi, key) : { pitch, alt };
}
const nearPc = (pc, near, lo, hi) => { let m = near + mod(pc - near + 6, 12) - 6; while (m < lo) m += 12; while (m > hi) m -= 12; return m; };
function voicing(ch, lo, hi, prev, opt = {}) {
  let tones = ch.tones.slice();
  if (opt.rootless && tones.length >= 4) tones = tones.slice(1);
  if (opt.triad) tones = tones.slice(0, Math.min(3, tones.length));
  if (opt.max && tones.length > opt.max) tones = tones.filter((t, k) => k !== 2).slice(0, opt.max);
  const cands = [];
  for (let inv = 0; inv < tones.length; inv++) for (let oct = 0; oct < 2; oct++) {
    const order = tones.slice(inv).concat(tones.slice(0, inv)), v = []; let m = lo + mod(order[0].pc - lo, 12) + oct * 12;
    order.forEach((t, k) => { if (k) m = m + 1 + mod(t.pc - (m + 1), 12); v.push({ midi: m, letter: t.letter }); });
    if (v[v.length - 1].midi <= hi) cands.push(v);
  }
  if (!cands.length) { let m = lo + mod(tones[0].pc - lo, 12); cands.push(tones.map((t, k) => { if (k) m = m + 1 + mod(t.pc - (m + 1), 12); return { midi: m, letter: t.letter }; })); }
  const cost = (v) => {
    if (!prev) return Math.abs((v[0].midi + v[v.length - 1].midi) / 2 - (lo + hi) / 2);
    return v.reduce((c, x) => c + Math.min(...prev.map((y) => Math.abs(x.midi - y.midi))), 0) + Math.abs(v.length - prev.length) * 2;
  };
  return cands.sort((a, b) => cost(a) - cost(b))[0];
}
const toneAt = (ch, k) => ch.tones[Math.min(k, ch.tones.length - 1)];
function bassHead(ch, which, near, lo, hi) { const t = which === 'root' ? ch.tones[0] : which === 'fifth' ? ch.tones.find((x, k) => Q_LET[ch.q][k] === 4) || ch.tones[0] : ch.tones[1]; return { midi: nearPc(t.pc, near, lo, hi), letter: t.letter }; }
const ev = (d, heads, x) => ({ d, heads, x });

/* ---------- melody ---------- */
function genMelody(r, bars, ctx) {
  const { tonicPc, tonicLetter, minor, lo, hi, st, cap } = ctx, sc = minor ? C_MIN : C_MAJ, lead = mod(tonicPc + 11, 12);
  const tm = lo + mod(tonicPc - lo, 12), raw = (d) => tm + 12 * Math.floor(d / 7) + sc[mod(d, 7)];
  let dMin = 0; while (raw(dMin - 1) >= lo) dMin--; let dMax = 0; while (raw(dMax + 1) <= hi) dMax++;
  const mid = (d, ch) => raw(d) + (minor && mod(d, 7) === 6 && ch.pcs.includes(lead) ? 1 : 0);
  const isCT = (d, ch) => ch.pcs.includes(mod(mid(d, ch), 12));
  const out = new Array(bars.length), memo = {};
  const center = Math.round((dMin + dMax) / 2) - 1;
  let cur = (() => { const ch = bars[0].ch, c = []; for (let d = dMin; d <= dMax; d++) if (isCT(d, ch)) c.push(d); return c.sort((a, b) => Math.abs(a - center) - Math.abs(b - center))[0]; })();
  let prevInt = 0;
  const genBar = (bi, rh, target, cadence) => {
    const ch = bars[bi].ch, evs = []; let pos = 0;
    rh.forEach((len, k) => {
      if (len < 0) { evs.push(ev(-len, null)); pos += -len; return; }
      const strong = len >= 1.5 || Math.abs(pos) < 1e-6 || (cap === 4 && Math.abs(pos - 2) < 1e-6);
      const lastNote = rh.slice(k + 1).every((x) => x < 0);
      let choice;
      if (cadence && lastNote) {
        const c = []; for (let d = dMin; d <= dMax; d++) if (isCT(d, ch) && (cadence !== 'home' || mod(mid(d, ch), 12) === tonicPc)) c.push(d);
        const score = (d) => Math.abs(d - target) + (cadence === 'root' && mod(mid(d, ch), 12) !== ch.rootPc ? 3 : 0) + Math.abs(d - cur) * 0.5;
        choice = c.sort((a, b) => score(a) - score(b))[0];
      } else {
        const items = [];
        for (let d = Math.max(dMin, cur - 5); d <= Math.min(dMax, cur + 5); d++) {
          const iv = Math.abs(d - cur), ct = isCT(d, ch); let w = [1.0, 3.2, 2.1, 1.0, 0.7, 0.3][iv];
          w *= strong ? (ct ? 3 : 0.15) : (ct ? 1.4 : iv === 1 ? 1.1 : 0.3);
          if (Math.abs(prevInt) >= 3) w *= Math.sign(d - cur) === -Math.sign(prevInt) && iv <= 2 ? 1.9 : Math.sign(d - cur) === Math.sign(prevInt) ? 0.35 : 1;
          if (iv === 0 && prevInt === 0) w *= 0.35;
          w *= Math.exp(-Math.abs(d - target) / 3.2);
          if (mod(cur, 7) === 6 && d === cur + 1) w *= 2.2;
          if (Math.abs(mid(d, ch) - mid(cur, ch)) === 6) w *= 0.15;
          items.push([d, w]);
        }
        choice = weighted(r, items);
      }
      prevInt = choice - cur; cur = choice; pos += len;
      evs.push(Object.assign(ev(len, [{ midi: mid(choice, ch), letter: mod(tonicLetter + choice, 7) }]), { deg: choice }));
    });
    return evs;
  };
  const secs = []; bars.forEach((b, bi) => { (secs[b.si] = secs[b.si] || { sec: b.sec, idx: [] }).idx.push(bi); });
  const finalRh = ctx.st.cadence.filter((c) => c[c.length - 1] >= 2);
  secs.forEach(({ sec, idx }) => {
    const L = sec.letter, base = memo[L];
    let reuse = 0; if (base) while (reuse < 3 && bars[idx[reuse]].ch.rn === bars[base.idx[reuse]].ch.rn) reuse++;
    const rhy = base ? base.rhy : { R1: cpick(r, st.rhythms), R2: cpick(r, st.rhythms), RC: cpick(r, st.cadence) };
    const s0 = cur, tg = L === 'B' ? [s0 + 2, s0 + 4, s0 + 3] : L === 'C' ? [s0 - 1, s0 + 2, s0 + 3] : [s0 + 1, s0 + 3, s0 + 1];
    idx.forEach((bi, b) => {
      if (b < reuse) { out[bi] = base.out[b].map((e) => Object.assign({}, e)); const le = [...out[bi]].reverse().find((e) => e.heads); if (le) { prevInt = le.deg - cur; cur = le.deg; } return; }
      const rh = b === 3 ? (sec.last ? (finalRh.length ? cpick(r, finalRh) : [cap]) : rhy.RC) : b === 1 ? rhy.R2 : rhy.R1;
      let target = tg[Math.min(b, 2)], cadence = null;
      if (b === 3) { const ch = bars[bi].ch, tonicChord = ch.rootPc === tonicPc; target = tonicChord ? Math.max(dMin, Math.min(dMax, Math.round(cur / 7) * 7)) : cur; cadence = sec.last ? 'home' : tonicChord ? 'root' : 'ct'; }
      out[bi] = genBar(bi, rh, target, cadence);
    });
    if (!base) memo[L] = { idx, out: idx.map((bi) => out[bi]), rhy };
  });
  return out;
}

/* ---------- accompaniment roles: each returns one array of events per bar (or { rh, lh } for piano) ---------- */
const perSection = (r, bars, choices) => { const m = {}; return (bi) => { const L = bars[bi].sec.letter; if (!m[L]) m[L] = cpick(r, choices); return m[L]; }; };
const ROLES = {
  pianoPop(r, bars, ctx) {
    const pat = perSection(r, bars, [[1, 1, 1, 1], [1.5, 1.5, 1], [2, 1, 1], [1, 0.5, 0.5, 1, 1], [2, 2]]);
    let prev = null, low = 43; const rh = [], lh = [];
    bars.forEach((b, bi) => {
      const v = voicing(b.ch, 55, 72, prev, { triad: true }); prev = v;
      rh.push((b.lastBar ? [ctx.cap] : pat(bi)).map((d) => ev(d, v)));
      const root = bassHead(b.ch, 'root', low, 36, 50); low = root.midi;
      lh.push(b.lastBar ? [ev(ctx.cap, [root, { midi: root.midi + 12, letter: root.letter }])] : [ev(2, [root, { midi: root.midi + 12, letter: root.letter }]), ev(2, [bassHead(b.ch, r() < 0.5 ? 'fifth' : 'root', root.midi, 36, 50)])]);
    });
    return { rh, lh };
  },
  bassPop(r, bars, ctx) {
    const pat = perSection(r, bars, ['a', 'b', 'c']); let near = 40;
    return bars.map((b, bi) => {
      const root = bassHead(b.ch, 'root', near, 28, 48); near = root.midi;
      if (b.lastBar) return [ev(ctx.cap, [root])];
      const nx = bars[bi + 1] ? bars[bi + 1].ch : b.ch, app = { midi: nearPc(nx.tones[0].pc, root.midi, 28, 48) - 1, letter: null };
      const p = pat(bi);
      if (p === 'a') return [ev(1.5, [root]), ev(0.5, [root]), ev(2, [bassHead(b.ch, 'fifth', root.midi, 28, 48)])];
      if (p === 'b') return [ev(1, [root]), ev(1, [root]), ev(1, [bassHead(b.ch, 'fifth', root.midi, 28, 48)]), ev(1, [app])];
      return [ev(2, [root]), ev(1.5, [{ midi: root.midi + 12, letter: root.letter }]), ev(0.5, [app])];
    });
  },
  power(r, bars, ctx) {
    const pat = perSection(r, bars, ['eighths', 'push', 'eighths']); let near = 45;
    return bars.map((b, bi) => {
      const root = bassHead(b.ch, 'root', near, 40, 52); near = root.midi;
      const pw = [root, { midi: root.midi + 7, letter: mod(root.letter + 4, 7) }, { midi: root.midi + 12, letter: root.letter }];
      if (b.lastBar) return [ev(ctx.cap, pw, { art: 'ferm' })];
      return pat(bi) === 'push' ? [ev(1.5, pw), ev(0.5, pw), ev(1, pw), ev(1, pw)] : [0, 1, 2, 3, 4, 5, 6, 7].map(() => ev(0.5, pw));
    });
  },
  bassRock(r, bars, ctx) {
    let near = 40;
    return bars.map((b) => { const root = bassHead(b.ch, 'root', near, 28, 45); near = root.midi; return b.lastBar ? [ev(ctx.cap, [root])] : [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ev(0.5, [k === 6 && r() < 0.4 ? { midi: root.midi + 12, letter: root.letter } : root])); });
  },
  compJazz(r, bars, ctx) {
    const pats = [[-0.5, 1, -1, 1, -0.5], [1.5, -1, 1, -0.5], [-1, 1.5, -1.5], [2, -1, 1], [-0.5, 1.5, -0.5, 1.5]]; let prev = null;
    return bars.map((b) => {
      const v = voicing(b.ch, 55, 71, prev, { rootless: true, max: 4 }); prev = v;
      if (b.lastBar) return [ev(ctx.cap, v, { art: 'ferm' })];
      return cpick(r, pats).map((d) => (d < 0 ? ev(-d, null) : ev(d, v)));
    });
  },
  walk(r, bars, ctx) {
    let near = 38;
    return bars.map((b, bi) => {
      const root = bassHead(b.ch, 'root', near, 28, 50);
      if (b.lastBar) return [ev(ctx.cap, [root], { art: 'ferm' })];
      const third = bassHead(b.ch, 'third', root.midi + 4, 28, 52), fifth = bassHead(b.ch, 'fifth', root.midi + 7, 28, 52);
      const nx = bars[bi + 1] ? bars[bi + 1].ch : b.ch, nextRoot = nearPc(nx.tones[0].pc, fifth.midi, 28, 50), app = { midi: nextRoot + (r() < 0.5 ? -1 : 1), letter: null };
      near = nextRoot;
      return r() < 0.5 ? [ev(1, [root]), ev(1, [third]), ev(1, [fifth]), ev(1, [app])] : [ev(1, [root]), ev(1, [fifth]), ev(1, [third]), ev(1, [app])];
    });
  },
  innerHi(r, bars, ctx) { return ROLES._inner(r, bars, ctx, 'hi'); },
  innerLo(r, bars, ctx) { return ROLES._inner(r, bars, ctx, 'lo'); },
  _inner(r, bars, ctx, which) {
    if (!ctx.innerCache) {
      const pat = perSection(r, bars, [[2, 2], [2, 2], [1, 1, 1, 1], [3, 1]]); let prev = null; ctx.innerCache = { hi: [], lo: [] };
      bars.forEach((b, bi) => {
        const v = voicing(b.ch, 55, 76, prev, { triad: true }); prev = v;
        const rh = b.lastBar ? [ctx.cap] : pat(bi), x = b.lastBar ? { art: 'ferm' } : undefined;
        ctx.innerCache.hi.push(rh.map((d) => ev(d, [v[v.length - 1]], x)));
        ctx.innerCache.lo.push(rh.map((d) => ev(d, [{ midi: v[Math.max(0, v.length - 2)].midi - (v[Math.max(0, v.length - 2)].midi > 67 ? 12 : 0), letter: v[Math.max(0, v.length - 2)].letter }], x)));
      });
    }
    return ctx.innerCache[which];
  },
  bassClassical(r, bars, ctx) {
    const pat = perSection(r, bars, ['halves', 'quarters', 'halves']); let near = 43;
    return bars.map((b, bi) => {
      const root = bassHead(b.ch, 'root', near, 36, 55); near = root.midi;
      if (b.lastBar) return [ev(ctx.cap, [root], { art: 'ferm' })];
      const fifth = bassHead(b.ch, 'fifth', root.midi, 36, 55);
      return pat(bi) === 'quarters' ? [ev(1, [root]), ev(1, [fifth]), ev(1, [{ midi: root.midi + 12 <= 55 ? root.midi + 12 : root.midi, letter: root.letter }]), ev(1, [fifth])] : [ev(2, [root]), ev(2, [fifth])];
    });
  },
  padLofi(r, bars, ctx) {
    const pat = perSection(r, bars, [[2, 2], [3, 1], [4], [1.5, 2.5]]); let prev = null, low = 43; const rh = [], lh = [];
    bars.forEach((b, bi) => {
      const v = voicing(b.ch, 57, 74, prev, { rootless: b.ch.tones.length >= 4, max: 4 }); prev = v;
      const p = b.lastBar ? [ctx.cap] : pat(bi);
      rh.push(p.map((d) => (d === 2.5 ? [ev(2, v), ev(0.5, v)] : [ev(d, v)])).flat());
      const root = bassHead(b.ch, 'root', low, 36, 50); low = root.midi;
      lh.push([ev(ctx.cap, [root])]);
    });
    return { rh, lh };
  },
  bassLofi(r, bars, ctx) {
    let near = 36;
    return bars.map((b, bi) => {
      const root = bassHead(b.ch, 'root', near, 28, 45); near = root.midi;
      if (b.lastBar) return [ev(ctx.cap, [root])];
      const nx = bars[bi + 1] ? bars[bi + 1].ch : b.ch;
      return r() < 0.5 ? [ev(1.5, [root]), ev(1, [{ midi: root.midi + 12, letter: root.letter }]), ev(1.5, [bassHead(b.ch, 'fifth', root.midi, 28, 45)])]
        : [ev(2, [root]), ev(1.5, [bassHead(b.ch, 'fifth', root.midi, 28, 45)]), ev(0.5, [{ midi: nearPc(nx.tones[0].pc, root.midi, 28, 45) - 1, letter: null }])];
    });
  },
  oompah(r, bars, ctx) {
    let prev = null, near = 45;
    return bars.map((b, bi) => {
      const v = voicing(b.ch, 55, 67, prev, { triad: true }); prev = v;
      const bass = bassHead(b.ch, bi % 2 ? 'fifth' : 'root', near, 40, 52); near = bass.midi;
      return b.lastBar ? [ev(ctx.cap, [bass].concat(v), { art: 'ferm' })] : [ev(1, [bass]), ev(1, v), ev(1, v)];
    });
  },
  bassWaltz(r, bars, ctx) { let near = 36; return bars.map((b) => { const root = bassHead(b.ch, 'root', near, 28, 45); near = root.midi; return [ev(ctx.cap, [root], b.lastBar ? { art: 'ferm' } : undefined)]; }); },
  padFilm(r, bars, ctx) {
    let prev = null;
    return bars.map((b) => {
      const v = voicing(b.ch, 52, 76, prev, { triad: true }), wide = v.concat([{ midi: v[0].midi + 12, letter: v[0].letter }]).filter((x) => x.midi <= 79); prev = v;
      return b.lastBar ? [ev(ctx.cap, wide, { art: 'ferm' })] : b.sec.letter === 'B' ? [ev(2, wide), ev(2, wide)] : [ev(ctx.cap, wide)];
    });
  },
  bassFilm(r, bars, ctx) { let near = 40; return bars.map((b) => { const root = bassHead(b.ch, 'root', near, 36, 52); near = root.midi; return [ev(ctx.cap, [root], b.lastBar ? { art: 'ferm' } : undefined)]; }); },
  timp(r, bars, ctx) {
    let near = 45;
    return bars.map((b) => {
      const root = bassHead(b.ch, 'root', near, 41, 55); near = root.midi;
      if (b.lastBar) return [ev(1, [root], { dyn: 'f' }), ev(1, [root]), ev(2, [root], { art: 'ferm' })];
      if (b.b === 0) return [ev(1, [root]), ev(3, null)];
      if (b.b === 3) return [ev(1, [bassHead(b.ch, 'fifth', root.midi, 41, 55)]), ev(1, [root]), ev(2, null)];
      return [ev(ctx.cap, null)];
    });
  },
  drums(r, bars, ctx, pd) {
    const K = { kick: 31, snare: 35, hhc: 39, hho: 41, hhp: 29, ride: 38, crash: 40, tomH: 37, tomM: 36, tomF: 33 };
    const groove = {
      pop: (b) => ({ kick: b % 2 ? [0, 3, 4] : [0, 4], snare: [2, 6], hhc: [0, 1, 2, 3, 4, 5, 6, 7] }),
      rock: (b, sec) => ({ kick: [0, 3, 4], snare: [2, 6], [sec === 'B' ? 'ride' : 'hhc']: [0, 1, 2, 3, 4, 5, 6, 7] }),
      lofi: (b) => ({ kick: [0, 5], snare: [2, 6], hhc: [0, 1, 2, 3, 4, 5, 6], hho: b % 2 ? [7] : [] }),
      jazz: () => ({ ride: [0, 2, 3, 4, 6, 7], hhp: [2, 6] })
    }[pd.kit];
    return bars.map((b, bi) => {
      if (b.lastBar) return [ev(ctx.cap, [{ midi: K.crash }, { midi: K.kick }], { art: 'ferm' })];
      const g = groove(bi, b.sec.letter), steps = Array.from({ length: 8 }, () => []);
      Object.entries(g).forEach(([nm, list]) => list.forEach((s) => steps[s].push(K[nm])));
      if (b.b === 0) { steps[0] = steps[0].filter((x) => x !== K.hhc && x !== K.ride); steps[0].push(K.crash); }
      const fill = b.b === 3 && !b.sec.last && pd.kit !== 'jazz';
      const use = fill ? 4 : 8, out = [];
      for (let s = 0; s < use; s++) {
        if (steps[s].length) out.push(ev(0.5, steps[s].map((m) => ({ midi: m }))));
        else if (out.length && out[out.length - 1].heads && [0.5, 1, 1.5].includes(out[out.length - 1].d)) out[out.length - 1].d += 0.5;
        else out.push(ev(0.5, null));
      }
      if (fill) [K.snare, K.snare, K.tomH, K.tomH, K.tomM, K.tomM, K.tomF, K.tomF].forEach((m) => out.push(ev(0.25, [{ midi: m }])));
      if (pd.kit === 'jazz' && b.b === 3 && !b.sec.last) out.push(...out.splice(-1, 1, ev(0.5, [{ midi: K.ride }, { midi: K.snare }])).slice(1));
      return out;
    });
  }
};

/* ---------- events → Quaver notes ---------- */
const DUR_OF = { 4: ['w', 0], 3: ['h', 1], 2: ['h', 0], 1.5: ['q', 1], 1: ['q', 0], 0.75: ['e', 1], 0.5: ['e', 0], 0.25: ['s', 0] };
function eventsToPart(barsEv, key, kit) {
  const out = [], firstOfBar = [];
  barsEv.forEach((evs, bi) => {
    firstOfBar[bi] = out.length;
    evs.forEach((e) => {
      const pieces = DUR_OF[e.d] ? [DUR_OF[e.d]] : (() => { const p = []; let rem = e.d; while (rem > 1e-6) { const leg = LEGAL.find((l) => l.b <= rem + 1e-6) || LEGAL[LEGAL.length - 1]; p.push([leg.d, leg.dots]); rem -= leg.b; } return p; })();
      pieces.forEach((pc, pi) => {
        let n;
        if (!e.heads) n = { type: 'rest', pitch: 0, alt: 0, dur: pc[0], dots: pc[1] };
        else {
          const seen = new Set(), hs = e.heads.map((h) => (kit ? { pitch: h.midi, alt: 0 } : h.letter != null ? spellAs(h.midi, h.letter, key) : spell(h.midi, key)))
            .filter((h) => { const k = h.pitch + ':' + h.alt; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.pitch - b.pitch);
          n = { type: 'note', pitch: hs[0].pitch, alt: hs[0].alt, dur: pc[0], dots: pc[1] };
          if (hs.length > 1) n.chord = hs.slice(1);
          if (!kit && pi < pieces.length - 1) n.tie = true;
        }
        if (pi === 0 && e.x) Object.assign(n, e.x);
        out.push(n);
      });
    });
  });
  return { notes: out, firstOfBar };
}

/* ---------- the whole piece ---------- */
function composePiece(o = {}) {
  const seed = (o.seed || Math.floor(Math.random() * 1e9)) >>> 0, r = makeRng(seed);
  const styleKey = COMPOSE_STYLES[o.style] ? o.style : cpick(r, Object.keys(COMPOSE_STYLES)), st = COMPOSE_STYLES[styleKey];
  const minor = o.mood === 'min' ? true : o.mood === 'maj' ? false : r() < 0.45, mode = minor ? 'min' : 'maj';
  const [tonicPc, tonicLetter, fifths] = cpick(r, minor ? KEYS_MIN : KEYS_MAJ);
  const ts = st.ts, cap = ts[0] * 4 / ts[1], tempo = Math.round(st.tempo[0] + r() * (st.tempo[1] - st.tempo[0]));
  const nBars = [8, 16, 32].includes(+o.bars) ? +o.bars : 16;
  const form = nBars === 8 ? ['A', 'A2'] : nBars === 16 ? ['A', 'A2', 'B', 'A3'] : ['A', 'A2', 'B', 'A3', 'C', 'C2', 'B2', 'A3'];
  const progA = cpick(r, st.prog[mode]).split(' '), progB = cpick(r, st.bridge[mode]).split(' ');
  let progC = cpick(r, st.bridge[mode].concat(st.prog[mode])).split(' '); if (progC.join() === progB.join() || progC.join() === progA.join()) progC = progA.slice(1).concat(progA[0]);
  const fin = cpick(r, st.final[mode]), sc = minor ? C_MIN : C_MAJ;
  const sections = form.map((f, si) => {
    const letter = f[0], last = si === form.length - 1, rns = (letter === 'A' ? progA : letter === 'B' ? progB : progC).slice();
    if (last || f === 'A2') { rns[2] = fin[0]; rns[3] = fin[1]; }
    return { label: f, letter, rns, last };
  });
  const realize = (rn) => {
    const c = parseRoman(rn, minor), rootPc = mod(tonicPc + sc[c.deg] + c.acc, 12), rootLetter = mod(tonicLetter + c.deg, 7);
    const tones = Q_INT[c.q].map((iv, k) => ({ pc: mod(rootPc + iv, 12), letter: mod(rootLetter + Q_LET[c.q][k], 7) }));
    const alt = mod(rootPc - SEMI[rootLetter] + 6, 12) - 6;
    return { rn, q: c.q, rootPc, rootLetter, tones, pcs: tones.map((t) => t.pc), sym: LETTERS[rootLetter] + (alt > 0 ? '#' : alt < 0 ? 'b' : '') + Q_SYM[c.q] };
  };
  const bars = [];
  sections.forEach((sec, si) => sec.rns.forEach((rn, b) => bars.push({ ch: realize(rn), sec, si, b, lastBar: sec.last && b === 3 })));
  const ctx = { tonicPc, tonicLetter, minor, st, cap, key: fifths };
  const parts = [], gid = 'g' + seed.toString(36);
  st.parts.forEach((pd) => {
    if (pd.role === 'mel') {
      const mel = genMelody(r, bars, Object.assign({}, ctx, { lo: pd.lo, hi: pd.hi })), { notes, firstOfBar } = eventsToPart(mel, fifths, false);
      bars.forEach((b, bi) => { const n = notes[firstOfBar[bi]]; if (n) n.sym = b.ch.sym; });
      // dynamics shape: start mf, swell into the B section, softer return, warm ending
      const at = (bi, f, v) => { const n = notes[firstOfBar[bi]]; if (n) n[f] = v; };
      at(0, 'dyn', 'mf');
      sections.forEach((sec, si) => {
        const b0 = si * 4;
        if (sec.letter === 'B') { at(b0, 'dyn', 'f'); if (si > 0) at(b0 - 2, 'hp', 'cresc'); }
        if (sec.letter === 'C') at(b0, 'dyn', 'mp');
        if (sec.letter === 'A' && si > 1) at(b0, 'dyn', 'mp');
        if (sec.last) at(b0 + 2, 'hp', si ? 'cresc' : 'dim');
      });
      const lastN = [...notes].reverse().find((n) => n.type === 'note'); if (lastN) { lastN.art = 'ferm'; if (nBars > 8) lastN.dyn = 'f'; }
      parts.push(newPart(pd.inst, pd.name, { notes }));
      return;
    }
    const res = ROLES[pd.role](r, bars, ctx, pd), kit = !!INSTR[pd.inst].kit;
    if (res.rh) {
      const rh = eventsToPart(res.rh, fifths, false).notes, lh = eventsToPart(res.lh, fifths, false).notes;
      [rh, lh].forEach((ns) => { if (ns[0]) ns[0].dyn = 'mp'; const l = [...ns].reverse().find((n) => n.type === 'note'); if (l) l.art = 'ferm'; });
      parts.push(newPart(pd.inst, pd.name + ' (RH)', { brace: gid, notes: rh }), newPart(pd.inst, pd.name + ' (LH)', { brace: gid, clef: 'bass', wclef: 'bass', notes: lh }));
    } else {
      const { notes } = eventsToPart(res, fifths, kit);
      const f = notes.find((n) => n.type === 'note'); if (f && !f.dyn) f.dyn = pd.role === 'timp' ? 'p' : 'mp';
      parts.push(newPart(pd.inst, pd.name, { notes, tab: !!pd.tab }));
    }
  });
  const title = cpick(r, TITLE_A[mode]) + ' ' + (styleKey === 'waltz' && r() < 0.5 ? 'Waltz' : cpick(r, TITLE_N));
  const score = { title, composer: 'Quaver composer', key: fifths, ts, tempo, concert: true, swing: !!st.swing, bars: { [nBars - 1]: { tempo: Math.round(tempo * 0.86) } }, parts };
  return { score: normalize(score), info: { style: st.name, key: (minor ? MIN[fifths] + ' minor' : MAJ[fifths] + ' major'), bars: nBars, tempo, seed, progression: progA.join(' – ') } };
}
