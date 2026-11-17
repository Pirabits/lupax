// Offscreen document: records the current tab (tabCapture stream id), optionally with mic + webcam bubble,
// and hands out blob: URLs for downloads (the service worker can't create them).
import { getItem } from './lib/db.js';
import { pickMimeType } from './lib/format.js';
import { thumbnail } from './lib/thumb.js';
import { QUALITY } from './lib/settings.js';
import { composeWithCamera } from './lib/compose.js';
import { chunkSink, stoppedEarlyNotice } from './lib/record-sink.js';

const BLOB_URL_TTL_MS = 120_000;
const CANCELLED = 'Recording cancelled'; // matched in background.js: a stop during the countdown is not an error
let rec = null; // { recorder, sink, meta, thumb, release }
let saving = 0; // recordings stopped but still being written to history
const blobUrls = new Set();

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  const reply = (p) => p.then(
    (value) => sendResponse({ ok: true, ...value }),
    (e) => sendResponse({ ok: false, error: e?.message || String(e) }),
  );
  switch (msg.type) {
    case 'prepare': reply(prepare(msg)); return true;
    case 'begin': reply(begin()); return true;
    case 'reset': reset(); sendResponse({ ok: true }); break;
    case 'pause': rec?.recorder?.state === 'recording' && rec.recorder.pause(); sendResponse({ ok: true }); break;
    case 'resume': rec?.recorder?.state === 'paused' && rec.recorder.resume(); sendResponse({ ok: true }); break;
    case 'stop': stop(); sendResponse({ ok: true }); break;
    case 'status': sendResponse({ ok: true, recording: !!rec || saving > 0, blobUrls: blobUrls.size }); break;
    case 'blob-url': reply(blobUrl(msg.id)); return true;
  }
});

/** Acquire every stream first; if any step fails, release what was already acquired. */
async function prepare({ streamId, options, meta }) {
  if (rec) throw new Error('A recording is already in progress');
  const streams = [];
  let audioCtx = null, composer = null;
  const release = () => {
    composer?.stop();
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    audioCtx?.close().catch(() => {});
  };
  try {
    const q = QUALITY[options.quality] || QUALITY[1080];
    const src = { chromeMediaSource: 'tab', chromeMediaSourceId: streamId };
    const tabStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: src },
      video: { mandatory: { ...src, maxWidth: q.w, maxHeight: q.h, maxFrameRate: options.fps || 30 } },
    });
    streams.push(tabStream);

    // capturing mutes the tab; play its audio back to the user
    audioCtx = new AudioContext();
    const tabAudio = audioCtx.createMediaStreamSource(tabStream);
    tabAudio.connect(audioCtx.destination);
    const dest = audioCtx.createMediaStreamDestination();
    if (options.systemAudio) tabAudio.connect(dest);

    if (options.mic) {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streams.push(mic);
      audioCtx.createMediaStreamSource(mic).connect(dest);
    }

    let videoTrack = tabStream.getVideoTracks()[0];
    if (options.webcam) {
      const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: options.fps || 30 } });
      streams.push(cam);
      composer = composeWithCamera(videoTrack, cam.getVideoTracks()[0], { position: options.webcamPosition });
      videoTrack = composer.track;
    }

    const tracks = [videoTrack];
    if (options.systemAudio || options.mic) tracks.push(...dest.stream.getAudioTracks());
    const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: pickMimeType(), videoBitsPerSecond: q.bps });
    const sink = chunkSink(recorder, meta, { onError: stop });
    recorder.onstop = save;
    tabStream.getVideoTracks()[0].addEventListener('ended', stop);
    rec = { recorder, sink, meta, thumb: await grabThumb(tabStream.getVideoTracks()[0]), release };
  } catch (e) {
    release();
    throw e;
  }
}

async function grabThumb(track) {
  try {
    return await thumbnail(await new ImageCapture(track).grabFrame());
  } catch {
    return null;
  }
}

async function begin() {
  if (!rec) throw new Error('Recording was not prepared');
  if (rec.cancelled) { reset(); throw new Error(CANCELLED); }
  rec.recorder.start(1000);
}

function stop() {
  if (!rec) return;
  // prepared but not started (countdown), e.g. the tab was closed: begin() abandons it instead of recording
  if (rec.recorder.state === 'inactive') rec.cancelled = true;
  else rec.recorder.stop();
}

/** Abandon a prepared or running recording without saving it. */
function reset() {
  const r = rec;
  if (!r) return;
  rec = null;
  r.recorder.onstop = null;
  if (r.recorder.state !== 'inactive') r.recorder.stop();
  r.release();
  r.sink.discard();
}

async function save() {
  const r = rec;
  if (!r) return;
  rec = null;
  saving++;
  r.release();
  try {
    const { id, error } = await r.sink.save({ kind: 'video', format: 'webm', name: `${r.meta.name || 'recording'}.webm`, thumb: r.thumb, title: r.meta.title, url: r.meta.url });
    chrome.runtime.sendMessage({ type: 'recording-saved', id, notice: stoppedEarlyNotice(error) });
  } catch (e) {
    chrome.runtime.sendMessage({ type: 'recording-failed', error: e?.message || String(e) });
  } finally {
    saving--;
  }
}

async function blobUrl(id) {
  const item = await getItem(id);
  if (!item?.blob) throw new Error('Capture not found');
  const url = URL.createObjectURL(item.blob);
  blobUrls.add(url);
  setTimeout(() => { URL.revokeObjectURL(url); blobUrls.delete(url); }, BLOB_URL_TTL_MS);
  return { url };
}
