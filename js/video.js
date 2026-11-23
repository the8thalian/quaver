'use strict';
/* Quaver · video.js
   Makes an MP4 of the song: the sheet music scrolls with the music and the notes light up as they sound.
   Fast path: render audio offline, draw every frame, encode with WebCodecs (H.264 + AAC) and package with mp4-muxer.
   Fallback: record the canvas and audio in real time with MediaRecorder (MP4 where supported, otherwise WebM). */

const VID = { W: 1280, H: 720, FPS: 30, SW: 1200, TOP: 92, VIEW: 584 };
const MUXER_URL = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.min.js';
let videoBusy = false;

function progress(msg, done) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t);
  if (done) toast._t = setTimeout(() => t.classList.remove('show'), 3500);
}
function loadMuxer() {
  if (window.Mp4Muxer) return Promise.resolve(window.Mp4Muxer);
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = MUXER_URL;
    s.onload = () => (window.Mp4Muxer ? res(window.Mp4Muxer) : rej(new Error('The video library did not load.')));
    s.onerror = () => rej(new Error('Could not download the video library. Check your internet connection.'));
    document.head.appendChild(s);
  });
}
function svgToImage(markup) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); }; img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not draw the score.')); };
    img.src = url;
  });
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* everything the frames need: the score picture, note positions and note timings */
async function prepareVideo() {
  const { buffer, events, endT } = await renderWAV(48000, true);
  const vp = vpList(), lay = computeLayout(VID.SW, vp, true, S.concert), inner = buildMarkup(lay, false), fonts = await embedFonts();
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${VID.SW}" height="${lay.H}" viewBox="0 0 ${VID.SW} ${lay.H}"><style>${fonts}</style><rect width="${VID.SW}" height="${lay.H}" fill="#fdfdfb"/>${inner}</svg>`;
  const img = await svgToImage(markup);
  const sheet = document.createElement('canvas'); sheet.width = VID.SW; sheet.height = Math.max(1, lay.H);
  sheet.getContext('2d').drawImage(img, 0, 0);
  const shown = new Set(vp), evs = events.filter((e) => shown.has(e.p) && lay.geo[e.p] && lay.geo[e.p][e.i]).sort((a, b) => a.T - b.T);
  const duration = Math.min(buffer.duration, endT + 1.5);
  return { buffer, evs, lay, sheet, duration, label: currentLabel(), info: `♩ = ${S.tempo}` };
}
function frameDrawer(v) {
  const c = document.createElement('canvas'); c.width = VID.W; c.height = VID.H;
  const g = c.getContext('2d'), maxCam = Math.max(0, v.lay.H - VID.VIEW);
  let cam = null, ei = 0;
  const draw = (t) => {
    // which notes are sounding, and which system the music is on
    while (ei < v.evs.length && v.evs[ei].T2 < t - 2) ei++;
    const now = []; for (let k = ei; k < v.evs.length && v.evs[k].T <= t + 0.02; k++) if (v.evs[k].T2 > t) now.push(v.evs[k]);
    const recent = now.length ? now : v.evs.filter((e) => e.T <= t).slice(-1);
    if (recent.length) {
      const si = Math.min(...recent.map((e) => v.lay.geo[e.p][e.i].sys)), target = Math.max(0, Math.min(maxCam, v.lay.systems[si].y - 6));
      cam = cam === null ? target : cam + (target - cam) * 0.12;
    } else if (cam === null) cam = 0;
    g.fillStyle = '#fdfdfb'; g.fillRect(0, 0, VID.W, VID.H);
    // header
    g.fillStyle = '#17171d'; g.font = '500 34px Newsreader, Georgia, serif'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillText(S.title || 'Untitled piece', 40, 52);
    g.font = 'italic 17px Newsreader, Georgia, serif'; g.fillStyle = '#44444f'; g.textAlign = 'right';
    g.fillText([S.composer, v.label].filter(Boolean).join(' · '), VID.W - 40, 40);
    g.font = '600 15px "Instrument Sans", system-ui, sans-serif'; g.fillStyle = '#5b6480';
    g.fillText(`${v.info}   ${mmss(Math.max(0, t))} / ${mmss(v.duration)}`, VID.W - 40, 66);
    g.strokeStyle = '#e4e4ea'; g.lineWidth = 1; g.beginPath(); g.moveTo(40, 80.5); g.lineTo(VID.W - 40, 80.5); g.stroke();
    // the score window
    g.save(); g.beginPath(); g.rect(40, VID.TOP, VID.SW, VID.VIEW); g.clip();
    g.drawImage(v.sheet, 0, cam, VID.SW, Math.min(VID.VIEW, v.lay.H - cam), 40, VID.TOP, VID.SW, Math.min(VID.VIEW, v.lay.H - cam));
    now.forEach((e) => {
      const geo = v.lay.geo[e.p][e.i], ri = v.lay.rinfo && v.lay.rinfo[e.p] && v.lay.rinfo[e.p][e.i]; if (!ri) return;
      const x = 40 + geo.x, y1 = VID.TOP + Math.min(ri.yTop, ri.up && ri.stemEnd !== null ? ri.stemEnd : ri.yTop) - 8 - cam, y2 = VID.TOP + Math.max(ri.yLow, !ri.up && ri.stemEnd !== null ? ri.stemEnd : ri.yLow) + 8 - cam;
      const fade = Math.min(1, (t - e.T) / 0.06 + 0.4);
      g.fillStyle = `rgba(217,72,15,${0.22 * fade})`; g.beginPath(); (g.roundRect ? g.roundRect(x - 13, y1, 26, y2 - y1, 7) : g.rect(x - 13, y1, 26, y2 - y1)); g.fill();
      g.fillStyle = `rgba(217,72,15,${0.9 * fade})`; g.fillRect(x - 13, y2 + 3, 26, 3);
    });
    g.restore();
    // progress bar
    const p = Math.max(0, Math.min(1, t / v.duration));
    g.fillStyle = '#e4e6ee'; g.fillRect(40, VID.H - 22, VID.W - 80, 5);
    g.fillStyle = '#3347d6'; g.fillRect(40, VID.H - 22, (VID.W - 80) * p, 5);
    g.font = '500 12px "Instrument Sans", system-ui, sans-serif'; g.fillStyle = '#8b8b98'; g.textAlign = 'left'; g.fillText('Made with Quaver', 40, VID.H - 30);
  };
  return { canvas: c, draw };
}
async function pickCodecs() {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return null;
  let video = null, audioC = null;
  for (const codec of ['avc1.4d0028', 'avc1.42001f', 'avc1.640028']) {
    const cfg = { codec, width: VID.W, height: VID.H, bitrate: 3_500_000, framerate: VID.FPS, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) { video = cfg; break; } } catch (e) {}
  }
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) { audioC = { cfg, mux }; break; } } catch (e) {}
  }
  return video && audioC ? { video, audio: audioC } : null;
}
async function encodeMP4(v, codecs) {
  const M = await loadMuxer();
  const muxer = new M.Muxer({
    target: new M.ArrayBufferTarget(), fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width: VID.W, height: VID.H, frameRate: VID.FPS },
    audio: { codec: codecs.audio.mux, numberOfChannels: 2, sampleRate: 48000 }
  });
  let failure = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
  venc.configure(codecs.video);
  const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { failure = e; } });
  aenc.configure(codecs.audio.cfg);
  // audio
  const buf = v.buffer, total = Math.min(buf.length, Math.ceil(v.duration * buf.sampleRate)), L0 = buf.getChannelData(0), R0 = buf.getChannelData(1), STEP = 4800;
  for (let off = 0; off < total; off += STEP) {
    const n = Math.min(STEP, total - off), data = new Float32Array(n * 2);
    data.set(L0.subarray(off, off + n), 0); data.set(R0.subarray(off, off + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: buf.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / buf.sampleRate) * 1e6), data });
    aenc.encode(ad); ad.close();
  }
  // video
  const fd = frameDrawer(v), frames = Math.ceil(v.duration * VID.FPS);
  for (let f = 0; f < frames; f++) {
    if (failure) throw failure;
    fd.draw(f / VID.FPS);
    const frame = new VideoFrame(fd.canvas, { timestamp: Math.round((f * 1e6) / VID.FPS), duration: Math.round(1e6 / VID.FPS) });
    venc.encode(frame, { keyFrame: f % (VID.FPS * 2) === 0 }); frame.close();
    while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
    if (f % 15 === 0) { progress(`Making your video… ${Math.round((f / frames) * 100)}%`); await new Promise((r) => setTimeout(r, 0)); }
  }
  await venc.flush(); await aenc.flush();
  if (failure) throw failure;
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}
/* fallback: play the rendered audio silently into a recorder while drawing frames in real time */
async function recordRealtime(v) {
  const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  const mime = typeof MediaRecorder !== 'undefined' ? types.find((m) => MediaRecorder.isTypeSupported(m)) : null;
  if (!mime) throw new Error('This browser cannot make videos. Try a current Chrome, Edge or Safari.');
  const fd = frameDrawer(v), a = ctx(), dest = a.createMediaStreamDestination(), src = a.createBufferSource();
  src.buffer = v.buffer; src.connect(dest);
  const stream = fd.canvas.captureStream(VID.FPS); dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_500_000 }), chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => { rec.onstop = res; });
  fd.draw(0); rec.start(250); const t0 = a.currentTime + 0.15; src.start(t0);
  await new Promise((res) => {
    const tick = () => { const t = a.currentTime - t0; fd.draw(Math.max(0, t)); progress(`Recording your video in real time… ${Math.round(Math.min(1, t / v.duration) * 100)}%`); if (t >= v.duration) res(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  rec.stop(); await done;
  return new Blob(chunks, { type: mime.split(';')[0] });
}
async function exportVideo() {
  if (videoBusy) { toast('A video is already being made.'); return; }
  if (!S.parts.some((p) => p.notes.some((n) => n.type === 'note'))) { toast('Add some notes first.'); return; }
  videoBusy = true;
  try {
    progress('Making your video… rendering the sound');
    const v = await prepareVideo(), codecs = await pickCodecs();
    let blob, ext = 'mp4';
    if (codecs) blob = await encodeMP4(v, codecs);
    else { blob = await recordRealtime(v); ext = blob.type.includes('mp4') ? 'mp4' : 'webm'; }
    progress('Your video is ready.', true);
    await download(fileBase() + '.' + ext, blob, ext === 'mp4' ? `Video saved (${(blob.size / 1048576).toFixed(1)} MB MP4).` : 'Video saved as WebM: this browser cannot make MP4 files.');
    return blob;
  } catch (e) { progress('Could not make the video: ' + (e.message || e), true); throw e; }
  finally { videoBusy = false; }
}
