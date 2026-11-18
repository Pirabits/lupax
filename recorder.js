// Window / desktop recording and desktop screenshots, via chrome.desktopCapture.
import { hydrateIcons, icon } from './lib/icons.js';
import { putItem, deleteItem } from './lib/db.js';
import { getSettings, QUALITY } from './lib/settings.js';
import { pickMimeType, clock, stamp } from './lib/format.js';
import { composeWithCamera } from './lib/compose.js';
import { chunkSink, stoppedEarlyNotice } from './lib/record-sink.js';
import { thumbnail } from './lib/thumb.js';

hydrateIcons();
const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
const mode = q.get('mode') === 'screenshot' ? 'screenshot' : 'video';
const source = q.get('source') === 'window' ? 'window' : 'desktop';
const S = (await getSettings()).record;
let rec = null, timer = 0, t0 = 0, pausedAt = 0, pausedTotal = 0;

$('#title').textContent = mode === 'screenshot' ? 'Desktop screenshot' : source === 'window' ? 'Record a window' : 'Record your screen';
$('#desc').textContent = mode === 'screenshot' ? 'Pick a screen or window — one frame is captured.' : 'Pick what to share. Recording starts after the countdown.';

const fail = (e) => {
  $('#err').textContent = e?.message || String(e);
  $('#stage').innerHTML = '';
  $('#retry').hidden = false;
};
$('#retry').onclick = () => { $('#retry').hidden = true; $('#err').textContent = ''; choose(); };
chrome.runtime.onMessage.addListener((m, sender) => {
  if (m?.target !== 'recorder') return;
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return; // extension contexts only, never page scripts
  if (m.type === 'stop') stop();
  if (m.type === 'pause') setPaused(true);
  if (m.type === 'resume') setPaused(false);
});

function choose() {
  const sources = mode === 'screenshot' ? ['screen', 'window'] : source === 'window' ? ['window'] : ['screen'];
  if (mode === 'video' && S.systemAudio) sources.push('audio');
  $('#stage').innerHTML = '<span class="spin"></span>';
  chrome.desktopCapture.chooseDesktopMedia(sources, (streamId, opts) => {
    if (!streamId) return window.close(); // cancelled
    (mode === 'screenshot' ? screenshot(streamId) : record(streamId, opts)).catch(fail);
  });
}

async function screenshot(streamId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId, maxWidth: 7680, maxHeight: 4320 } },
  });
  let blob;
  try {
    const bmp = await new ImageCapture(stream.getVideoTracks()[0]).grabFrame();
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    blob = await c.convertToBlob({ type: 'image/png' });
  } finally {
    stream.getTracks().forEach((t) => t.stop()); // ends Chrome's sharing indicator even when the grab fails
  }
  // handed to the worker through history; if the worker never takes it, don't leave it there as a stray screenshot
  const id = await putItem({ kind: 'image', format: 'png', name: `desktop-${stamp()}.png`, blob, temp: true });
  try {
    await chrome.runtime.sendMessage({ type: 'desktop-shot', id });
  } catch (e) {
    await deleteItem(id).catch(() => {});
    throw e;
  }
  window.close();
}

async function record(streamId, opts) {
  const qv = QUALITY[S.quality] || QUALITY[1080];
  const desktop = { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId };
  const streams = [];
  let audioCtx = null, composer = null, sink = null, granted = false;
  const release = () => {
    composer?.stop();
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    audioCtx?.close().catch(() => {});
  };
  try {
    const screen = await navigator.mediaDevices.getUserMedia({
      audio: opts?.canRequestAudioTrack ? { mandatory: desktop } : false,
      video: { mandatory: { ...desktop, maxWidth: qv.w, maxHeight: qv.h, maxFrameRate: S.fps } },
    });
    streams.push(screen);
    // "Stop sharing" can be clicked at any point, including during the countdown
    let shareEnded = false;
    screen.getVideoTracks()[0].addEventListener('ended', () => { shareEnded = true; stop(); });
    const assertSharing = () => { if (shareEnded) throw new Error('Screen sharing stopped before the recording started.'); };

    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    let hasAudio = false;
    if (screen.getAudioTracks().length) { audioCtx.createMediaStreamSource(screen).connect(dest); hasAudio = true; }
    if (S.mic) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        streams.push(mic);
        audioCtx.createMediaStreamSource(mic).connect(dest);
        hasAudio = true;
      } catch (e) { $('#err').textContent = `Microphone unavailable: ${e.message}`; }
    }
    let video = screen.getVideoTracks()[0];
    if (S.webcam) {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        streams.push(cam);
        composer = composeWithCamera(video, cam.getVideoTracks()[0], { position: S.webcamPosition });
        video = composer.track;
      } catch (e) { $('#err').textContent = `Camera unavailable: ${e.message}`; }
    }

    // countdown
    for (let n = S.countdown; n > 0 && !shareEnded; n--) {
      $('#stage').innerHTML = `<div class="count">${n}</div>`;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assertSharing();

    const tracks = [video, ...(hasAudio ? dest.stream.getAudioTracks() : [])];
    const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: pickMimeType(), videoBitsPerSecond: qv.bps });
    const name = `${source === 'window' ? 'window' : 'screen'}-recording-${stamp()}`;
    sink = chunkSink(recorder, { name, title: source === 'window' ? 'Window recording' : 'Screen recording' }, { onError: () => stop() });
    let thumb = null;
    recorder.onstop = async () => {
      clearInterval(timer);
      release();
      $('#stage').innerHTML = '<span class="spin"></span>';
      $('#controls').hidden = true;
      try {
        const { id, error } = await sink.save({ kind: 'video', format: 'webm', name: `${name}.webm`, thumb });
        await chrome.runtime.sendMessage({ type: 'recording-saved', id, notice: stoppedEarlyNotice(error) });
        window.close();
      } catch (e) {
        chrome.runtime.sendMessage({ type: 'recording-failed', error: e.message });
        fail(e);
      }
    };

    try { thumb = await thumbnail(await new ImageCapture(screen.getVideoTracks()[0]).grabFrame()); } catch {}
    assertSharing();

    // claim the recording slot before starting; the service worker refuses if another recording owns it
    const { id: windowId } = await chrome.windows.getCurrent();
    const res = await chrome.runtime.sendMessage({ type: 'recording-started', source, windowId }).catch((e) => ({ ok: false, error: e.message }));
    if (!res?.ok) throw new Error(res?.error || 'Could not start recording');
    granted = true;
    assertSharing();
    recorder.start(1000);
    rec = recorder;
    t0 = Date.now();
    $('#controls').hidden = false;
    $('#stage').innerHTML = `<div><div class="time"><span class="dot" id="dot"></span><span id="time">00:00</span></div><p style="margin-top:8px">Recording · you can minimize this window</p></div>`;
    timer = setInterval(() => { $('#time').textContent = clock((pausedAt || Date.now()) - t0 - pausedTotal); }, 500);
    window.onbeforeunload = () => (rec?.state !== 'inactive' ? true : undefined);
    setTimeout(() => chrome.windows.update(windowId, { state: 'minimized' }).catch(() => {}), 1200);
  } catch (e) {
    // nothing was recorded: turn off the screen share, mic and camera, drop the empty chunk store, free the slot
    release();
    await sink?.discard();
    if (granted) chrome.runtime.sendMessage({ type: 'recording-failed', error: e.message }).catch(() => {});
    throw e;
  }
}

function setPaused(p) {
  if (!rec || rec.state === 'inactive') return;
  if (p && rec.state === 'recording') { rec.pause(); pausedAt = Date.now(); }
  if (!p && rec.state === 'paused') { rec.resume(); pausedTotal += Date.now() - pausedAt; pausedAt = 0; }
  $('#dot')?.classList.toggle('paused', p);
  $('#pause').innerHTML = p ? `${icon('play')}Resume` : `${icon('pause')}Pause`;
}
$('#pause').onclick = async () => { const p = rec?.state === 'recording'; await chrome.runtime.sendMessage({ type: p ? 'record-pause' : 'record-resume' }); };
$('#stop').onclick = () => stop();

function stop() {
  window.onbeforeunload = null;
  if (rec && rec.state !== 'inactive') rec.stop();
}

choose();
