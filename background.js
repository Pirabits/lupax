import { putItem, getItem, deleteItem, recoverOrphanRecordings } from './lib/db.js';
import { getSettings } from './lib/settings.js';
import { baseName, blobToDataUrl } from './lib/format.js';
import { imageBlobToPdf } from './lib/pdf.js';
import { makeZip, assetZipPath } from './lib/zip.js';
import { thumbnail } from './lib/thumb.js';

// Chrome limits captureVisibleTab to ~2 calls/second.
const CAPTURE_GAP_MS = 550;
const MAX_DIM = 32000;
const MAX_AREA = 250_000_000;
// Clipboard images travel to the page as base64 script arguments; past this size we skip the copy and say so.
const CLIPBOARD_MAX_BYTES = 20 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RECORDING_CANCELLED = 'Recording cancelled'; // also thrown by offscreen.js begin()

// ───────────────────────────── routing ─────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target) return; // addressed to offscreen / recorder
  if (msg?.type === 'recording-started') {
    // the recorder window waits for this answer and only starts recording when the slot is granted
    handle(msg, sender).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }
  sendResponse({ ok: true }); // ack first so the popup can close
  handle(msg, sender).catch(reportError);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  const map = { 'capture-visible': 'visible', 'capture-area': 'area', 'capture-full': 'full' };
  try {
    if (map[command]) return await runCapture(tab || (await activeTab()), map[command]);
    if (command === 'toggle-recording') {
      if (await liveRecording()) return await stopRecording();
      const s = await getSettings();
      await startRecording({ ...s.record, source: 'tab' }, tab);
    }
  } catch (e) { reportError(e); }
});

// Chunks left by a recording that never finished (browser crash, closed offscreen document) become history items.
chrome.runtime.onStartup.addListener(() => recoverOrphanRecordings().catch(reportError));
// an update or reload ends any recording mid-way; its chunks would otherwise wait for the next browser launch
chrome.runtime.onInstalled.addListener(() => recoverOrphanRecordings().catch(reportError));

chrome.windows.onRemoved.addListener(async (windowId) => {
  const rec = await getRecording();
  if (!rec || rec.kind !== 'desktop' || rec.windowId !== windowId) return;
  // the recorder window was closed (its beforeunload prompt only shows after user interaction): keep what it recorded
  await clearRecording();
  const [id] = await recoverOrphanRecordings().catch((e) => { reportError(e); return []; });
  if (id) await openViewer(id, undefined, 'The recorder window was closed, so the recording stopped there. This is everything recorded until then.');
});

async function handle(msg) {
  switch (msg.type) {
    case 'capture': return runCapture(await activeTab(), msg.mode, msg.delay);
    case 'desktop-shot': {
      const item = await getItem(msg.id);
      await deleteItem(msg.id);
      if (item) await finishCapture(item.blob, null, { title: 'Desktop screenshot', name: 'desktop-screenshot' });
      return;
    }
    case 'record-start': return startRecording(msg.options);
    case 'record-stop': return stopRecording();
    case 'record-pause': return pauseRecording(true);
    case 'record-resume': return pauseRecording(false);
    case 'recording-started': {
      // the slot was reserved for this recorder window when it opened; anything else means another recording owns it
      const rec = await liveRecording();
      if (rec && !(rec.kind === 'desktop' && rec.windowId === msg.windowId)) throw new Error('A recording is already in progress');
      await chrome.storage.session.set({ recording: { kind: 'desktop', source: msg.source, windowId: msg.windowId, startedAt: Date.now(), pausedTotal: 0 } });
      return setRecBadge(true);
    }
    case 'recording-saved':
      await endRecordingFx();
      await clearRecording();
      await closeOffscreenIfIdle();
      return openViewer(msg.id, undefined, msg.notice);
    case 'recording-failed':
      await endRecordingFx();
      await clearRecording();
      await closeOffscreenIfIdle();
      throw new Error(msg.error || 'Recording failed');
    case 'show-capture': return openViewer(msg.id);
    case 'pick-color': return pickColor(await activeTab());
    case 'inspect': return toggleInspect(await activeTab(), msg.on);
    case 'export-zip': return exportAssetsZip(msg, await activeTab().catch(() => null));
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: 'normal' });
  if (!tab) throw new Error('No active tab');
  return tab;
}

async function inject(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.result;
}

// ───────────────────────────── screenshots ─────────────────────────────

// One capture at a time: two scroll-and-stitch runs on the same tab would capture each other's scroll
// positions and restore each other's hidden sticky headers. Kept in memory: a capture keeps the worker alive.
let capturing = false;

async function runCapture(tab, mode, delay) {
  if (mode === 'desktop') return openRecorderWindow('screenshot');
  if (capturing) throw new Error('A capture is already in progress');
  capturing = true;
  try {
    return await runCaptureMode(tab, mode, delay);
  } finally {
    capturing = false;
  }
}

async function runCaptureMode(tab, mode, delay) {
  const s = (await getSettings()).capture;
  delay ??= s.delay;
  switch (mode) {
    case 'visible':
      return finishCapture(await dataUrlToBlob(await captureTab(tab.windowId)), tab);
    case 'delayed':
      await countdown(tab, delay);
      return finishCapture(await dataUrlToBlob(await captureTab(tab.windowId)), tab);
    case 'area': {
      const r = await inject(tab.id, selectRegion, ['area']);
      if (!r) return;
      const bmp = await createImageBitmap(await dataUrlToBlob(await captureTab(tab.windowId)));
      const k = bmp.width / r.innerWidth;
      const c = new OffscreenCanvas(Math.max(1, Math.round(r.w * k)), Math.max(1, Math.round(r.h * k)));
      c.getContext('2d').drawImage(bmp, r.x * k, r.y * k, r.w * k, r.h * k, 0, 0, c.width, c.height);
      bmp.close();
      return finishCapture(await c.convertToBlob({ type: 'image/png' }), tab);
    }
    case 'element': {
      const r = await inject(tab.id, selectRegion, ['element']);
      if (r) await captureRegion(tab, r, { hideFixed: false });
      return;
    }
    case 'scroll': {
      const r = await inject(tab.id, selectRegion, ['scroll']);
      if (r) await captureRegion(tab, r, { hideFixed: s.hideFixed });
      return;
    }
    case 'full':
      return captureRegion(tab, null, { hideFixed: s.hideFixed });
  }
}

let lastCaptureAt = 0;
async function captureTab(windowId) {
  // reserve the slot before waiting, so concurrent callers (capture + color picker) queue instead of colliding
  const at = Math.max(Date.now(), lastCaptureAt + CAPTURE_GAP_MS);
  lastCaptureAt = at;
  if (at > Date.now()) await sleep(at - Date.now());
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

const dataUrlToBlob = async (u) => (await fetch(u)).blob();

/** Scroll through a document rect (whole page when null) and stitch viewport captures. */
async function captureRegion(tab, rect, { hideFixed }) {
  const tabId = tab.id;
  const m = await inject(tabId, pagePrep);
  try {
    rect ??= { x: 0, y: 0, w: m.docW, h: m.docH };
    const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
    rect = { x: x0, y: y0, w: Math.min(rect.w, m.docW - x0), h: Math.min(rect.h, m.docH - y0) };
    if (rect.w < 1 || rect.h < 1) throw new Error('Nothing to capture');
    const steps = (start, len, view) => { const o = []; for (let p = start; p < start + len; p += view) o.push(p); return o.length ? o : [start]; };
    const xs = steps(rect.x, rect.w, m.vw), ys = steps(rect.y, rect.h, m.vh);
    const multi = xs.length * ys.length > 1;
    if (multi) await setProgressBadge(0, xs.length * ys.length);
    let canvas, ctx, scale, out, hidden = false, n = 0;
    for (const y of ys) for (const x of xs) {
      const pos = await inject(tabId, scrollToPos, [x, y]);
      const bmp = await createImageBitmap(await dataUrlToBlob(await captureTab(tab.windowId)));
      if (!canvas) {
        scale = bmp.width / m.innerW;
        const W = rect.w * scale, H = rect.h * scale;
        out = Math.min(1, MAX_DIM / W, MAX_DIM / H, Math.sqrt(MAX_AREA / (W * H)));
        canvas = new OffscreenCanvas(Math.max(1, Math.round(W * out)), Math.max(1, Math.round(H * out)));
        ctx = canvas.getContext('2d');
      }
      const ix0 = Math.max(rect.x, pos.x), iy0 = Math.max(rect.y, pos.y);
      const ix1 = Math.min(rect.x + rect.w, pos.x + m.vw), iy1 = Math.min(rect.y + rect.h, pos.y + m.vh);
      if (ix1 > ix0 && iy1 > iy0) {
        const k = scale * out;
        ctx.drawImage(bmp, (ix0 - pos.x) * scale, (iy0 - pos.y) * scale, (ix1 - ix0) * scale, (iy1 - iy0) * scale,
          (ix0 - rect.x) * k, (iy0 - rect.y) * k, (ix1 - ix0) * k, (iy1 - iy0) * k);
      }
      bmp.close();
      if (multi) await setProgressBadge(++n, xs.length * ys.length);
      if (multi && hideFixed && !hidden) { await inject(tabId, toggleFixed, [true]); hidden = true; }
    }
    await chrome.action.setBadgeText({ text: '' });
    await finishCapture(await canvas.convertToBlob({ type: 'image/png' }), tab);
  } finally {
    await inject(tabId, pageRestore, [m.sx, m.sy]).catch(() => {});
  }
}

async function setProgressBadge(n, total) {
  await chrome.action.setBadgeBackgroundColor({ color: '#2b78d0' });
  await chrome.action.setBadgeText({ text: `${Math.round((n / total) * 100)}%` });
}

/** Post-process a PNG capture according to the user's capture settings. */
async function finishCapture(png, tab, meta = {}) {
  const s = (await getSettings()).capture;
  const bmp = await createImageBitmap(png);
  const width = bmp.width, height = bmp.height;
  const thumb = await thumbnail(bmp);
  bmp.close();
  const base = meta.name || baseName(tab?.title, tab?.url);
  const common = { kind: 'image', title: meta.title || tab?.title, url: tab?.url, width, height, thumb };

  const copied = s.copy && tab ? await copyImageInTab(tab, png) : null;

  if (s.annotate) {
    // editor exports to the chosen type/destination when the user saves
    const id = await putItem({ ...common, format: 'png', name: `${base}.png`, blob: png, pending: true });
    return openViewer(id, tab);
  }

  let blob = png, ext = 'png';
  if (s.fileType === 'jpg') { blob = await toJpeg(png, s.jpgQuality); ext = 'jpg'; }
  if (s.fileType === 'pdf') { blob = await imageBlobToPdf(png); ext = 'pdf'; }
  const name = `${base}.${ext}`;
  const id = await putItem({ ...common, format: ext, name, blob, preview: ext === 'png' ? undefined : png });

  if (s.destination === 'none') return openViewer(id, tab);
  await downloadItem(id, `LupaX/${name}`, s.destination === 'ask');
  const note = copied === true ? ' · copied to clipboard' : copied === 'too-large' ? ' · too large to copy to clipboard' : copied === false ? ' · clipboard copy failed' : '';
  if (tab) inject(tab.id, pageToast, [`Saved ${name}${note}`]).catch(() => {});
}

/** Download a stored item. The service worker can't make blob: URLs, so the offscreen document does. */
async function downloadItem(id, filename, saveAs = false) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'blob-url', id });
  if (!res?.ok) throw new Error(res?.error || 'Could not prepare the download');
  return chrome.downloads.download({ url: res.url, filename, saveAs, conflictAction: 'uniquify' });
}

async function toJpeg(png, quality = 0.92) {
  const bmp = await createImageBitmap(png);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return c.convertToBlob({ type: 'image/jpeg', quality });
}

/** true when copied, false when the page refused, 'too-large' when skipped. */
async function copyImageInTab(tab, png) {
  if (png.size > CLIPBOARD_MAX_BYTES) return 'too-large';
  try {
    const b64 = (await blobToDataUrl(png)).split(',')[1];
    return (await inject(tab.id, writeClipboardImage, [b64])) === true;
  } catch {
    return false;
  }
}

async function openViewer(id, tab, notice) {
  const url = chrome.runtime.getURL(`viewer.html?id=${encodeURIComponent(id)}${notice ? `&notice=${encodeURIComponent(notice)}` : ''}`);
  if (tab) return chrome.tabs.create({ url, index: tab.index + 1, openerTabId: tab.id, windowId: tab.windowId });
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  return chrome.tabs.create({ url, ...(win ? { windowId: win.id } : {}) });
}

async function countdown(tab, secs) {
  if (!secs) return;
  const shown = await inject(tab.id, showCountdown, [secs]).catch(() => false);
  if (shown) return;
  await chrome.action.setBadgeBackgroundColor({ color: '#2b78d0' });
  for (let i = secs; i > 0; i--) { await chrome.action.setBadgeText({ text: String(i) }); await sleep(1000); }
  await chrome.action.setBadgeText({ text: '' });
}

// ───────────────────────────── recording ─────────────────────────────

const getRecording = async () => (await chrome.storage.session.get('recording')).recording ?? null;

/** The stored recording, or null if the context that was recording is gone (crashed offscreen doc, closed window). */
async function liveRecording() {
  const rec = await getRecording();
  if (!rec) return null;
  const alive = rec.kind === 'tab' ? await tabRecorderAlive(rec) : await chrome.windows.get(rec.windowId).then(() => true, () => false);
  if (alive) return rec;
  await clearRecording();
  await recoverOrphanRecordings().catch(() => {});
  return null;
}
const TAB_START_TIMEOUT_MS = 60_000; // stream setup + the longest countdown, with a wide margin

async function tabRecorderAlive(rec) {
  if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) return false;
  // still setting up: the offscreen document has nothing to report yet (a worker that died mid-start times out)
  if (rec.starting) return Date.now() - rec.startedAt < TAB_START_TIMEOUT_MS;
  // the document also serves downloads and is recreated for them, so its existence alone proves nothing:
  // after a crash mid-recording, a new download document would otherwise hold the slot until the browser restarts
  const st = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'status' }).catch(() => null);
  return !!st?.recording;
}

/** Check-and-reserve the recording slot one caller at a time: two starts (shortcut + popup) used to both pass the check. */
let slotQueue = Promise.resolve();
function reserveSlot(fn) {
  const p = slotQueue.then(fn);
  slotQueue = p.catch(() => {});
  return p;
}

async function clearRecording() { await chrome.storage.session.remove('recording'); await setRecBadge(false); }
async function setRecBadge(on) {
  await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  await chrome.action.setBadgeText({ text: on ? 'REC' : '' });
}

let offscreenCreating = null; // concurrent callers (a download during a recording start) share one createDocument
async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (ctx.length) return;
  offscreenCreating ??= chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA', 'BLOBS'],
    justification: 'Record the current tab with MediaRecorder and create blob URLs for downloads',
  }).finally(() => { offscreenCreating = null; });
  await offscreenCreating;
}

/** Close the offscreen document unless it is recording or still serving a download URL. */
async function closeOffscreenIfIdle() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (!ctx.length) return;
  const st = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'status' }).catch(() => null);
  if (st?.recording || st?.blobUrls) return;
  await chrome.offscreen.closeDocument().catch(() => {});
}

/** tab: the tab to record; defaults to the active tab, looked up only after the recording slot is known to be free. */
async function startRecording(options, tab) {
  if (options.source !== 'tab') return openRecorderWindow('video', options.source);
  await reserveSlot(async () => {
    if (await liveRecording()) throw new Error('A recording is already in progress');
    tab ??= await activeTab();
    await ensureOffscreen();
    // reserve the slot now: setup and countdown take seconds, and nothing else may start a recording meanwhile
    await chrome.storage.session.set({ recording: { kind: 'tab', source: 'tab', tabId: tab.id, starting: true, startedAt: Date.now(), pausedTotal: 0 } });
  });
  try {
    // stream id must be requested while the user gesture is still fresh
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    // acquire the streams right away (ids expire quickly), then count down, then start recording
    const res = await chrome.runtime.sendMessage({
      target: 'offscreen', type: 'prepare', streamId, options,
      meta: { title: tab.title, url: tab.url, name: baseName(tab.title, tab.url) },
    });
    if (!res?.ok) throw Object.assign(new Error(res?.error || 'Could not start recording'), { name: res?.errorName || 'Error', device: res?.device });
    if (options.countdown) await inject(tab.id, showCountdown, [options.countdown]).catch(() => sleep(options.countdown * 1000));
    if ((await getRecording())?.cancelled) throw new Error(RECORDING_CANCELLED);
    const go = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'begin' });
    if (!go?.ok) throw new Error(go?.error || 'Could not start recording');
  } catch (e) {
    // release anything the offscreen document already acquired so the tab isn't left captured
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'reset' }).catch(() => {});
    await clearRecording();
    await closeOffscreenIfIdle();
    if (e?.message === RECORDING_CANCELLED) return; // stopped during setup or countdown: nothing to report
    // the offscreen document can't show permission prompts; the popup sends people to the grant page first, but the
    // record shortcut doesn't go through the popup
    if (e?.device && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
      const need = [options.mic && 'microphone', options.webcam && 'camera'].filter(Boolean).join(',');
      await chrome.tabs.create({ url: chrome.runtime.getURL(`permissions.html?need=${need}`) });
      return;
    }
    throw e;
  }
  await chrome.storage.session.set({ recording: { kind: 'tab', source: 'tab', tabId: tab.id, startedAt: Date.now(), pausedTotal: 0 } });
  await setRecBadge(true);
  if (options.cursor) await inject(tab.id, cursorFx, [true]).catch(() => {});
}

async function stopRecording() {
  const rec = await liveRecording();
  if (!rec) return;
  // still in the screen picker or countdown: closing the recorder window cancels it (onRemoved frees the slot)
  if (rec.starting && rec.kind === 'desktop') return chrome.windows.remove(rec.windowId).catch(() => {});
  if (rec.starting) {
    // still setting up or counting down: startRecording checks this flag before it begins, and the offscreen document
    // abandons a prepared recording on stop
    await chrome.storage.session.set({ recording: { ...rec, cancelled: true } });
    inject(rec.tabId, removeCountdown).catch(() => {});
  }
  await chrome.runtime.sendMessage({ target: rec.kind === 'tab' ? 'offscreen' : 'recorder', type: 'stop' }).catch(() => {});
}

async function pauseRecording(pause) {
  const rec = await getRecording();
  if (!rec || rec.starting || !!rec.paused === pause) return;
  await chrome.runtime.sendMessage({ target: rec.kind === 'tab' ? 'offscreen' : 'recorder', type: pause ? 'pause' : 'resume' }).catch(() => {});
  const now = Date.now();
  const next = pause ? { ...rec, paused: true, pausedAt: now } : { ...rec, paused: false, pausedTotal: (rec.pausedTotal || 0) + (now - rec.pausedAt) };
  await chrome.storage.session.set({ recording: next });
  await chrome.action.setBadgeText({ text: pause ? 'II' : 'REC' });
}

async function endRecordingFx() {
  const rec = await getRecording();
  if (rec?.tabId) await inject(rec.tabId, cursorFx, [false]).catch(() => {});
}

async function openRecorderWindow(mode, source = 'desktop') {
  if (mode !== 'video') return openRecorderPopup(mode, source);
  await reserveSlot(async () => {
    if (await liveRecording()) throw new Error('A recording is already in progress');
    const created = await openRecorderPopup(mode, source);
    // the picker and countdown take a while; hold the slot for this window so no other recording starts meanwhile
    await chrome.storage.session.set({ recording: { kind: 'desktop', source, windowId: created.id, starting: true, startedAt: Date.now(), pausedTotal: 0 } });
  });
}

async function openRecorderPopup(mode, source) {
  const win = await chrome.windows.getLastFocused().catch(() => null);
  const w = 400, h = 340;
  return chrome.windows.create({
    url: chrome.runtime.getURL(`recorder.html?mode=${mode}&source=${source}`),
    type: 'popup', width: w, height: h, focused: true,
    ...(win ? { left: Math.round(win.left + (win.width - w) / 2), top: Math.round(win.top + 80) } : {}),
  });
}

// ───────────────────────────── color picker & inspector ─────────────────────────────

async function pickColor(tab) {
  const dataUrl = await captureTab(tab.windowId);
  const hex = await inject(tab.id, pickerOverlay, [dataUrl]);
  if (!hex) return;
  const { colorHistory = [] } = await chrome.storage.local.get('colorHistory');
  await chrome.storage.local.set({ colorHistory: [hex, ...colorHistory.filter((c) => c !== hex)].slice(0, 60) });
}

async function toggleInspect(tab, on) {
  if (on) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/inspector.js'] });
    await inject(tab.id, () => window.__lupax.start());
  } else {
    await inject(tab.id, () => window.__lupax?.stop()).catch(() => {});
  }
}

// ───────────────────────────── asset ZIP ─────────────────────────────

const ASSET_FETCH_TIMEOUT_MS = 10_000;
const ASSET_FETCH_CONCURRENCY = 4;

/** Runs here rather than in the popup so closing the popup doesn't lose the export. */
async function exportAssetsZip({ assets, title, url }, tab) {
  // a few fetches at a time, each with a timeout, so one slow or hanging asset can't stall the export
  const results = new Array(assets.length);
  let next = 0, fetched = 0;
  await setProgressBadge(0, assets.length);
  const worker = async () => {
    while (next < assets.length) {
      const i = next++;
      try {
        const res = await fetch(assets[i].url, { signal: AbortSignal.timeout(ASSET_FETCH_TIMEOUT_MS) });
        if (res.ok) results[i] = { name: assetZipPath(assets[i]), data: new Uint8Array(await res.arrayBuffer()) };
      } catch { /* unreachable or timed out: skip */ }
      await setProgressBadge(++fetched, assets.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(ASSET_FETCH_CONCURRENCY, assets.length) }, worker));
  const files = results.filter(Boolean); // input order, so duplicate names are suffixed deterministically
  await chrome.action.setBadgeText({ text: '' });
  if (!files.length) throw new Error('Could not download any of the selected assets');
  const name = `${baseName(title, url)}-assets.zip`;
  const id = await putItem({ kind: 'file', format: 'zip', name, blob: makeZip(files), title, url });
  await downloadItem(id, `LupaX/${name}`);
  const skipped = assets.length - files.length;
  if (tab) inject(tab.id, pageToast, [`Exported ${files.length} assets${skipped ? ` · ${skipped} unreachable` : ''}`]).catch(() => {});
}

// ───────────────────────────── errors ─────────────────────────────

async function reportError(err) {
  console.error('[LupaX]', err);
  const message = err?.message || String(err);
  await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  await chrome.action.setBadgeText({ text: '!' });
  await chrome.action.setTitle({ title: `LupaX — ${message}` });
  // show it where the user is looking; browser pages can't be scripted, so the badge is the fallback
  const tab = await activeTab().catch(() => null);
  if (tab) inject(tab.id, pageToast, [message, 'error']).catch(() => {});
  setTimeout(async () => {
    if (!(await getRecording())) await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'LupaX' });
  }, 5000);
}

// ═════════════ Functions below are injected into pages and must be self-contained ═════════════

function pagePrep() {
  const de = document.documentElement, b = document.body;
  window.__ixPrev = { de: de.style.scrollBehavior, b: b ? b.style.scrollBehavior : '' };
  de.style.setProperty('scroll-behavior', 'auto', 'important');
  b?.style.setProperty('scroll-behavior', 'auto', 'important');
  const std = document.compatMode === 'CSS1Compat';
  return {
    vw: std ? de.clientWidth : innerWidth, vh: std ? de.clientHeight : innerHeight, innerW: innerWidth,
    docW: Math.max(de.scrollWidth, b ? b.scrollWidth : 0, de.clientWidth),
    docH: Math.max(de.scrollHeight, b ? b.scrollHeight : 0, de.clientHeight),
    sx: scrollX, sy: scrollY,
  };
}

function scrollToPos(x, y) {
  window.scrollTo(x, y);
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => r({ x: scrollX, y: scrollY }), 150))));
}

function toggleFixed(hide) {
  if (!hide) return true;
  const list = [];
  for (const el of document.querySelectorAll('body *')) {
    const p = getComputedStyle(el).position;
    if (p === 'fixed' || p === 'sticky') {
      list.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
      el.style.setProperty('visibility', 'hidden', 'important');
    }
  }
  window.__ixFixed = list;
  return true;
}

function pageRestore(sx, sy) {
  for (const [el, v, p] of window.__ixFixed || []) { if (v) el.style.setProperty('visibility', v, p); else el.style.removeProperty('visibility'); }
  window.__ixFixed = [];
  const prev = window.__ixPrev || {};
  document.documentElement.style.scrollBehavior = prev.de || '';
  if (document.body) document.body.style.scrollBehavior = prev.b || '';
  window.scrollTo(sx, sy);
  return true;
}

function writeClipboardImage(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/png' });
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => true, () => false);
}

function pageToast(text, kind = 'ok') {
  const host = document.createElement('div');
  host.dataset.lupaxToast = kind;
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:50%;bottom:28px;transform:translateX(-50%)';
  const sh = host.attachShadow({ mode: 'closed' });
  sh.innerHTML = `<style>div{font:600 13px/1 system-ui,sans-serif;color:#fff;background:#061230;padding:12px 16px 12px 14px;border-radius:12px;display:flex;gap:10px;align-items:center;box-shadow:0 10px 30px rgba(0,0,0,.4);animation:in .2s ease-out}
    i{width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,#7ab8f5,#3d8ee6);display:grid;place-items:center;color:#061230;font-style:normal;font-size:11px;flex:none}
    i.err{background:#ef4444} span{max-width:520px;line-height:1.35}
    @keyframes in{from{opacity:0;transform:translateY(8px)}}</style><div><i></i><span></span></div>`;
  const err = kind === 'error';
  sh.querySelector('i').textContent = err ? '!' : '✓';
  sh.querySelector('i').className = err ? 'err' : '';
  sh.querySelector('span').textContent = err ? `LupaX: ${text}` : text;
  document.documentElement.appendChild(host);
  setTimeout(() => host.remove(), err ? 6000 : 2600);
  return true;
}

function showCountdown(secs) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.dataset.lupaxCountdown = '';
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const sh = host.attachShadow({ mode: 'closed' });
    sh.innerHTML = `<style>
      .w{position:fixed;inset:0;display:grid;place-items:center;background:rgba(6,18,48,.25)}
      .c{width:150px;height:150px;border-radius:50%;display:grid;place-items:center;background:#061230;box-shadow:0 20px 60px rgba(0,0,0,.4);position:relative}
      .c::before{content:'';position:absolute;inset:-6px;border-radius:50%;background:conic-gradient(#3d8ee6,#7ab8f5,#cfe6ff,#3d8ee6);z-index:-1}
      b{font:800 72px/1 system-ui,sans-serif;background:linear-gradient(135deg,#7ab8f5,#cfe6ff);-webkit-background-clip:text;color:transparent;animation:p 1s ease-out infinite}
      @keyframes p{0%{transform:scale(1.25);opacity:.4}30%{transform:scale(1);opacity:1}}
    </style><div class="w"><div class="c"><b></b></div></div>`;
    const b = sh.querySelector('b');
    document.documentElement.appendChild(host);
    let n = secs;
    const tick = () => {
      if (n === 0) { host.remove(); requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(true), 80))); return; }
      b.textContent = n--;
      setTimeout(tick, 1000);
    };
    tick();
  });
}

function removeCountdown() {
  for (const el of document.querySelectorAll('[data-lupax-countdown]')) el.remove();
  return true;
}

function cursorFx(on) {
  window.__ixCursor?.remove();
  window.__ixCursor = null;
  if (!on) return true;
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none';
  const sh = host.attachShadow({ mode: 'closed' });
  sh.innerHTML = `<style>
    .halo{position:fixed;width:38px;height:38px;margin:-19px 0 0 -19px;border-radius:50%;background:rgba(255,214,70,.35);box-shadow:0 0 0 2px rgba(255,190,40,.55);transition:transform .08s;left:-100px;top:-100px}
    .ring{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #4a9df0;animation:r .5s ease-out forwards}
    @keyframes r{to{transform:scale(3.4);opacity:0}}
  </style><div class="halo"></div>`;
  const halo = sh.querySelector('.halo');
  const move = (e) => { halo.style.left = e.clientX + 'px'; halo.style.top = e.clientY + 'px'; };
  const down = (e) => {
    halo.style.transform = 'scale(.8)';
    const r = document.createElement('div');
    r.className = 'ring';
    r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    sh.appendChild(r);
    setTimeout(() => r.remove(), 520);
  };
  const up = () => { halo.style.transform = ''; };
  addEventListener('mousemove', move, true);
  addEventListener('mousedown', down, true);
  addEventListener('mouseup', up, true);
  document.documentElement.appendChild(host);
  window.__ixCursor = { remove() { removeEventListener('mousemove', move, true); removeEventListener('mousedown', down, true); removeEventListener('mouseup', up, true); host.remove(); } };
  return true;
}

/**
 * Selection overlay. 'area' → viewport rect + innerWidth; 'scroll' → document rect (wheel/edge
 * auto-scroll extends it); 'element' → hovered element's document rect (↑/↓ walks parents).
 * Resolves null on Esc.
 */
function selectRegion(mode) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.style.cssText = `all:initial;position:fixed;inset:0;z-index:2147483647;${mode === 'element' ? 'pointer-events:none;' : ''}`;
    const sh = host.attachShadow({ mode: 'closed' });
    sh.innerHTML = `<style>
      .layer{position:fixed;inset:0;cursor:crosshair;background:rgba(6,18,48,.32)}
      .layer.dragging{background:transparent}
      .el .layer{display:none}
      .box{position:fixed;display:none;outline:2px solid #4a9df0;box-shadow:0 0 0 100vmax rgba(6,18,48,.42);pointer-events:none}
      .el .box{box-shadow:none;background:rgba(74,157,240,.12);transition:all .06s ease-out}
      .h{position:absolute;width:9px;height:9px;border-radius:50%;background:#fff;border:2px solid #4a9df0;margin:-6.5px 0 0 -6.5px}
      .size{position:absolute;left:-2px;top:calc(100% + 6px);font:600 12px/1 system-ui,sans-serif;color:#fff;background:#4a9df0;padding:5px 8px;border-radius:5px;white-space:nowrap;display:flex;gap:5px;align-items:center}
      .size::before{content:'✦';font-size:10px}
      .hint{position:fixed;top:14px;left:50%;transform:translateX(-50%);font:600 13px/1.2 system-ui,sans-serif;color:#fff;background:rgba(6,18,48,.92);padding:9px 16px;border-radius:999px;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.25);white-space:nowrap;display:flex;gap:8px;align-items:center}
      .hint i{width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#7ab8f5,#3d8ee6)}
    </style>
    <div class="root ${mode === 'element' ? 'el' : ''}"><div class="layer"></div>
      <div class="box"><span class="h" style="left:0;top:0"></span><span class="h" style="left:100%;top:0"></span><span class="h" style="left:0;top:100%"></span><span class="h" style="left:100%;top:100%"></span><span class="size"></span></div>
      <div class="hint"><i></i><span></span></div></div>`;
    const layer = sh.querySelector('.layer'), box = sh.querySelector('.box'), size = sh.querySelector('.size');
    sh.querySelector('.hint span').textContent = {
      area: 'Drag to select a region · Esc to cancel',
      scroll: 'Drag to select · scroll or hold at the edge to extend · Esc to cancel',
      element: 'Click an element to capture · ↑ parent · ↓ child · Esc to cancel',
    }[mode];
    document.documentElement.appendChild(host);

    let start = null, cur = null, last = { x: 0, y: 0 }, raf = 0, target = null, stack = [];
    const off = () => (mode === 'scroll' ? { x: scrollX, y: scrollY } : { x: 0, y: 0 });
    const pt = (cx, cy) => ({ x: cx + off().x, y: cy + off().y });
    const rect = () => ({ x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y), w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) });
    function drawBox(x, y, w, h, label) {
      Object.assign(box.style, { display: 'block', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      size.textContent = label;
      size.style.top = y + h + 34 > innerHeight ? '6px' : 'calc(100% + 6px)';
      size.style.left = y + h + 34 > innerHeight ? '6px' : '-2px';
    }
    function render() { if (!start) return; const r = rect(), o = off(); drawBox(r.x - o.x, r.y - o.y, r.w, r.h, `${Math.round(r.w)} × ${Math.round(r.h)}`); }

    function onDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      last = { x: e.clientX, y: e.clientY };
      start = cur = pt(e.clientX, e.clientY);
      layer.classList.add('dragging');
      render();
      if (mode === 'scroll') raf = requestAnimationFrame(autoScroll);
    }
    function onMove(e) { if (!start) return; last = { x: e.clientX, y: e.clientY }; cur = pt(e.clientX, e.clientY); render(); }
    function onUp(e) {
      if (!start) return;
      cur = pt(e.clientX, e.clientY);
      const r = rect();
      if (r.w < 4 || r.h < 4) { start = null; box.style.display = 'none'; layer.classList.remove('dragging'); cancelAnimationFrame(raf); return; }
      finish(mode === 'area' ? { ...r, innerWidth } : r);
    }
    function autoScroll() {
      if (!start) return;
      const E = 48;
      let dx = 0, dy = 0;
      if (last.y < E) dy = -(E - last.y) / 2; else if (last.y > innerHeight - E) dy = (last.y - (innerHeight - E)) / 2;
      if (last.x < E) dx = -(E - last.x) / 2; else if (last.x > innerWidth - E) dx = (last.x - (innerWidth - E)) / 2;
      if (dx || dy) window.scrollBy(dx, dy);
      raf = requestAnimationFrame(autoScroll);
    }
    function onScroll() {
      if (mode === 'scroll' && start) { cur = pt(last.x, last.y); render(); }
      if (mode === 'element' && target) highlight(target);
    }
    function highlight(el) {
      target = el;
      const r = el.getBoundingClientRect();
      const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
      drawBox(r.left, r.top, r.width, r.height, `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : cls}  ${Math.round(r.width)} × ${Math.round(r.height)}`);
    }
    function onElMove(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el !== target && el !== document.documentElement) { stack = []; highlight(el); }
    }
    function block(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'click' && target) { const r = target.getBoundingClientRect(); finish({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }); }
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(null); }
      if (mode === 'element' && target) {
        if (e.key === 'ArrowUp' && target.parentElement && target.parentElement !== document.documentElement) { e.preventDefault(); stack.push(target); highlight(target.parentElement); }
        else if (e.key === 'ArrowDown' && stack.length) { e.preventDefault(); highlight(stack.pop()); }
        else if (e.key === 'Enter') { e.preventDefault(); const r = target.getBoundingClientRect(); finish({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }); }
      }
    }
    const listeners = [['keydown', onKey], ['scroll', onScroll]];
    if (mode === 'element') {
      listeners.push(['mousemove', onElMove]);
      for (const t of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'contextmenu']) listeners.push([t, block]);
    } else {
      layer.addEventListener('mousedown', onDown);
      listeners.push(['mousemove', onMove], ['mouseup', onUp]);
    }
    for (const [t, fn] of listeners) window.addEventListener(t, fn, true);
    function finish(result) {
      for (const [t, fn] of listeners) window.removeEventListener(t, fn, true);
      cancelAnimationFrame(raf);
      host.remove();
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(result), 60)));
    }
  });
}

/** Magnifier color picker over a frozen viewport capture. Resolves "#RRGGBB" or null. */
function pickerOverlay(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(null);
    img.onload = () => {
      const scale = img.naturalWidth / innerWidth;
      const src = document.createElement('canvas');
      src.width = img.naturalWidth; src.height = img.naturalHeight;
      const sctx = src.getContext('2d', { willReadFrequently: true });
      sctx.drawImage(img, 0, 0);
      const N = 11, CELL = 12, SIZE = N * CELL;
      const host = document.createElement('div');
      host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647';
      const sh = host.attachShadow({ mode: 'closed' });
      sh.innerHTML = `<style>
        .ov{position:fixed;inset:0;cursor:crosshair}
        .loupe{position:fixed;width:${SIZE}px;height:${SIZE}px;border-radius:50%;overflow:hidden;border:3px solid #fff;box-shadow:0 0 0 2px #4a9df0,0 10px 30px rgba(0,0,0,.4);pointer-events:none}
        canvas{display:block}
        .lbl{position:fixed;pointer-events:none;font:700 12px/1 ui-monospace,Menlo,monospace;background:#061230;color:#fff;padding:7px 9px;border-radius:8px;display:flex;gap:7px;align-items:center;box-shadow:0 6px 18px rgba(0,0,0,.3)}
        .sw{width:13px;height:13px;border-radius:4px;border:1px solid rgba(255,255,255,.7)}
        .hint{position:fixed;top:14px;left:50%;transform:translateX(-50%);font:600 13px/1.2 system-ui,sans-serif;color:#fff;background:rgba(6,18,48,.92);padding:9px 16px;border-radius:999px;pointer-events:none}
      </style>
      <div class="ov"></div><div class="loupe"><canvas width="${SIZE}" height="${SIZE}"></canvas></div>
      <div class="lbl"><span class="sw"></span><span class="hex"></span></div>
      <div class="hint">Click to pick a color · arrows nudge 1px · Esc to cancel</div>`;
      const ov = sh.querySelector('.ov'), loupe = sh.querySelector('.loupe'), lbl = sh.querySelector('.lbl');
      const sw = sh.querySelector('.sw'), hexEl = sh.querySelector('.hex');
      const lctx = sh.querySelector('canvas').getContext('2d');
      lctx.imageSmoothingEnabled = false;
      document.documentElement.appendChild(host);
      let pos = { x: innerWidth / 2, y: innerHeight / 2 };
      const hexAt = (x, y) => {
        const d = sctx.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data;
        return ('#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')).toUpperCase();
      };
      function draw() {
        const px = Math.floor(pos.x * scale), py = Math.floor(pos.y * scale);
        lctx.fillStyle = '#000'; lctx.fillRect(0, 0, SIZE, SIZE);
        lctx.drawImage(src, px - (N >> 1), py - (N >> 1), N, N, 0, 0, SIZE, SIZE);
        lctx.strokeStyle = 'rgba(0,0,0,.12)'; lctx.lineWidth = 1;
        for (let i = 1; i < N; i++) {
          lctx.beginPath(); lctx.moveTo(i * CELL + 0.5, 0); lctx.lineTo(i * CELL + 0.5, SIZE); lctx.stroke();
          lctx.beginPath(); lctx.moveTo(0, i * CELL + 0.5); lctx.lineTo(SIZE, i * CELL + 0.5); lctx.stroke();
        }
        const c = (N >> 1) * CELL;
        lctx.strokeStyle = '#000'; lctx.lineWidth = 3; lctx.strokeRect(c, c, CELL, CELL);
        lctx.strokeStyle = '#fff'; lctx.lineWidth = 1.5; lctx.strokeRect(c, c, CELL, CELL);
        const hex = hexAt(pos.x, pos.y);
        sw.style.background = hex; hexEl.textContent = hex;
        const fx = pos.x + SIZE + 30 > innerWidth, fy = pos.y + SIZE + 60 > innerHeight;
        const lx = fx ? pos.x - SIZE - 20 : pos.x + 20, ly = fy ? pos.y - SIZE - 50 : pos.y + 20;
        loupe.style.left = lx + 'px'; loupe.style.top = ly + 'px';
        lbl.style.left = lx + SIZE / 2 - 48 + 'px'; lbl.style.top = ly + SIZE + 8 + 'px';
      }
      draw();
      const onMove = (e) => { pos = { x: e.clientX, y: e.clientY }; draw(); };
      const onKey = (e) => {
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (d) { e.preventDefault(); pos = { x: pos.x + d[0] / scale, y: pos.y + d[1] / scale }; draw(); }
        else if (e.key === 'Enter') { e.preventDefault(); pick(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(null); }
      };
      ov.addEventListener('mousemove', onMove);
      ov.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); pick(); });
      ov.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
      window.addEventListener('keydown', onKey, true);
      function pick() {
        const hex = hexAt(pos.x, pos.y);
        const fallback = () => { const ta = document.createElement('textarea'); ta.value = hex; document.documentElement.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); };
        (navigator.clipboard?.writeText(hex) ?? Promise.reject()).catch(fallback);
        const t = document.createElement('div');
        t.textContent = `Copied ${hex}`;
        t.style.cssText = `all:initial;position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:2147483647;font:600 13px system-ui,sans-serif;color:#fff;background:#061230;padding:11px 15px;border-radius:10px;border-left:16px solid ${hex};box-shadow:0 8px 24px rgba(0,0,0,.3)`;
        document.documentElement.appendChild(t);
        setTimeout(() => t.remove(), 1600);
        done(hex);
      }
      function done(v) { window.removeEventListener('keydown', onKey, true); host.remove(); resolve(v); }
    };
    img.src = dataUrl;
  });
}
