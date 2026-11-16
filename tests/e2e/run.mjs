// End-to-end smoke test: real Chrome, real extension, real fixture page.
//   npm run test:e2e            (headless)
//   npm run test:e2e -- --headed
//   npm run test:e2e -- --only zip      (run tests whose name contains "zip")
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './lib/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURES = path.join(ROOT, 'tests/e2e/fixtures');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

// ───────────── fixture server ─────────────
const server = http.createServer((req, res) => {
  const file = path.join(FIXTURES, path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(FIXTURES) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  const type = { '.html': 'text/html', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type }).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}/site.html`;

// ───────────── browser + helpers ─────────────
// EXTENSION_DIR lets you run this suite against another copy (e.g. an older version) of the extension
const b = await launch({ extensionDir: process.env.EXTENSION_DIR || ROOT, headless: !args.includes('--headed') });
const ext = await b.open(b.url('history.html'));
await sleep(1000);
const run = (body) => ext.evaluate(`(async()=>{${body}})()`);
const db = (body) => run(`const db = await import('./lib/db.js'); ${body}`);
const send = (msg) => run(`return chrome.runtime.sendMessage(${JSON.stringify(msg)})`);
const setSettings = (patch) => run(`const {setSettings}=await import('./lib/settings.js'); await setSettings(${JSON.stringify(patch)})`);
const lastItem = () => db(`const [it] = await db.listItems({ limit: 1 }); return it ? {
  id: it.id, name: it.name, kind: it.kind, format: it.format, width: it.width, height: it.height, size: it.size,
  type: it.blob?.type, pending: !!it.pending,
  head: String.fromCharCode(...new Uint8Array(await it.blob.slice(0, 5).arrayBuffer())) } : null;`);
const badge = async () => ({ text: await run('return chrome.action.getBadgeText({})'), title: await run('return chrome.action.getTitle({})') });

async function waitFor(fn, { ms = 10000, every = 200, label = 'condition' } = {}) {
  let last;
  for (const end = Date.now() + ms; Date.now() < end; await sleep(every)) {
    last = await fn();
    if (last) return last;
  }
  throw new Error(`Timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
}
async function newItem(prevId, opts) {
  return waitFor(async () => { const it = await lastItem(); return it && it.id !== prevId ? it : null; }, { label: 'new history item', ...opts });
}

/** Close every tab except the harness page, open the fixture site active, attach to it. */
let site = null;
async function freshSite() {
  await site?.detach();
  await run(`const me = (await chrome.tabs.getCurrent()).id;
    for (const t of await chrome.tabs.query({})) if (t.id !== me) await chrome.tabs.remove(t.id).catch(() => {});
    const t = await chrome.tabs.create({ url: ${JSON.stringify(SITE)}, active: true });
    await new Promise((r) => { const f = (id, i) => { if (id === t.id && i.status === 'complete') { chrome.tabs.onUpdated.removeListener(f); r(); } }; chrome.tabs.onUpdated.addListener(f); });`);
  const t = await b.waitForTarget((x) => x.type === 'page' && x.url === SITE);
  site = await b.attach(t.targetId);
  await site.send('Page.bringToFront');
  await sleep(300);
  return site;
}
const resetBadge = () => run(`await chrome.action.setBadgeText({ text: '' }); await chrome.action.setTitle({ title: 'LupaX' });`);
const quietCapture = { annotate: false, destination: 'none', fileType: 'png', copy: false };

// ───────────── tiny runner ─────────────
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('popup renders every view without exceptions', async () => {
  const p = await b.open(b.url('popup.html'));
  await sleep(1500);
  const title = () => p.evaluate(`document.querySelector('.v-title')?.textContent`);
  const HOME = 'All-in-one web inspector';
  await waitFor(async () => (await title()) === HOME, { label: 'popup boot' });
  // [view, how to open it, expected title]; switching away mid-scan (inspect → assets) must not throw
  const steps = [
    ['capture', `document.querySelector('[data-go="capture"]').click()`, 'Capture Screen'],
    ['record', `document.querySelector('[data-go="record"]').click()`, 'Record Video'],
    ['inspect', `document.querySelector('[data-go="inspect"]').click()`, 'Style Inspector'],
    ['assets', `document.querySelector('[data-go="assets"]').click()`, 'Asset Explorer'],
    ['help', `document.querySelector('#help').click()`, 'Help & shortcuts'],
  ];
  for (const [name, open, expected] of steps) {
    await p.evaluate(`document.querySelector('#home').click()`);
    await waitFor(async () => (await title()) === HOME, { label: `home before ${name}` });
    await p.evaluate(open);
    await waitFor(async () => (await title()) === expected, { label: `${name} view`, ms: 4000 });
  }
  await p.evaluate(`document.querySelector('#home').click()`);
  await sleep(800); // let late scan results from the inspect/assets views land
  const errs = p.exceptions();
  await p.detach();
  await b.send('Target.closeTarget', { targetId: p.targetId });
  assert.deepEqual(errs, [], 'uncaught exceptions in popup');
});

test('history, settings and accessibility report pages render without exceptions', async () => {
  await freshSite();
  const tabId = await run(`return (await chrome.tabs.query({ url: ${JSON.stringify(SITE)} }))[0].id`);
  const checks = [
    ['history.html', `document.querySelector('.page-title')?.textContent`, 'Your captures'],
    ['settings.html', `!!document.body?.innerText.includes('20 recordings')`, true],
    [`report.html?tab=${tabId}`, `!!(document.querySelector('.donut b')?.textContent.endsWith('%') && document.querySelector('.donut linearGradient'))`, true],
  ];
  for (const [page, probe, expected] of checks) {
    const p = await b.open(b.url(page));
    try {
      await waitFor(async () => (await p.evaluate(probe).catch(() => null)) === expected, { label: page, ms: 6000 });
      assert.deepEqual(p.exceptions(), [], `exceptions on ${page}`);
    } finally {
      await p.detach();
      await b.send('Target.closeTarget', { targetId: p.targetId });
    }
  }
});

test('visible capture is stored as PNG', async () => {
  await setSettings({ capture: quietCapture });
  await freshSite();
  const prev = (await lastItem())?.id;
  await send({ type: 'capture', mode: 'visible' });
  const it = await newItem(prev);
  assert.equal(it.format, 'png');
  assert.equal(it.head.slice(1, 4), 'PNG');
  assert.equal(it.width, 1280);
});

test('full-page capture stitches beyond the viewport', async () => {
  await freshSite();
  const docH = await site.evaluate('document.documentElement.scrollHeight');
  const vh = await site.evaluate('innerHeight');
  const prev = (await lastItem())?.id;
  await send({ type: 'capture', mode: 'full' });
  const it = await newItem(prev, { ms: 20000 });
  assert.ok(docH > vh * 1.5, `fixture should be taller than the viewport (${docH} vs ${vh})`);
  assert.equal(it.height, docH);
});

test('JPG and PDF output formats', async () => {
  await setSettings({ capture: { ...quietCapture, fileType: 'jpg' } });
  await freshSite();
  let prev = (await lastItem())?.id;
  await send({ type: 'capture', mode: 'visible' });
  const jpg = await newItem(prev);
  assert.equal(jpg.format, 'jpg');
  assert.equal(jpg.type, 'image/jpeg');
  await setSettings({ capture: { ...quietCapture, fileType: 'pdf' } });
  prev = jpg.id;
  await send({ type: 'capture', mode: 'visible' });
  const pdf = await newItem(prev);
  assert.equal(pdf.head, '%PDF-');
});

test('annotate setting stores a pending item and opens the editor', async () => {
  await setSettings({ capture: { ...quietCapture, annotate: true } });
  await freshSite();
  const prev = (await lastItem())?.id;
  await send({ type: 'capture', mode: 'visible' });
  const it = await newItem(prev);
  assert.equal(it.pending, true);
  await b.waitForTarget((t) => t.url.includes(`viewer.html?id=${it.id}`));
});

test('download destination writes the file to Downloads/LupaX', async () => {
  await setSettings({ capture: { ...quietCapture, destination: 'downloads' } });
  await freshSite();
  const prev = (await lastItem())?.id;
  await send({ type: 'capture', mode: 'full' });
  const it = await newItem(prev, { ms: 20000 });
  const file = await waitFor(() => {
    const dir = path.join(b.downloads, 'LupaX');
    const f = fs.existsSync(dir) && fs.readdirSync(dir).find((n) => n.endsWith('.png') && !n.endsWith('.crdownload'));
    return f ? path.join(dir, f) : null;
  }, { label: 'downloaded png' });
  assert.equal(fs.statSync(file).size, it.size, 'downloaded bytes match the stored capture');
  const state = await run(`const [d] = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 1 }); return { url: d.url.slice(0, 5), state: d.state }`);
  assert.equal(state.state, 'complete');
  assert.notEqual(state.url, 'data:', 'downloads should not go through giant data: URLs');
});

test('selected region capture matches the dragged rectangle', async () => {
  await setSettings({ capture: quietCapture });
  await freshSite();
  const prev = (await lastItem())?.id;
  await send({ type: 'capture', mode: 'area' });
  await sleep(700);
  await site.drag(100, 100, 500, 400);
  const it = await newItem(prev);
  assert.deepEqual([it.width, it.height], [400, 300]);
});

test('element capture captures the clicked element', async () => {
  await freshSite();
  const box = await site.evaluate(`(() => { const r = document.querySelector('.card').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 150, w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  const prev = (await lastItem())?.id;
  await send({ type: 'capture', mode: 'element' });
  await sleep(700);
  await site.mouse('mouseMoved', box.x, box.y); await sleep(250);
  await site.click(box.x, box.y);
  const it = await newItem(prev);
  assert.ok(Math.abs(it.width - box.w) <= 2 && Math.abs(it.height - box.h) <= 2, `got ${it.width}×${it.height}, card is ${box.w}×${box.h}`);
});

test('inspect mode adds and removes its overlay', async () => {
  await freshSite();
  await send({ type: 'inspect', on: true });
  await waitFor(() => site.evaluate('!!document.querySelector("lupax-root")'), { label: 'inspector overlay' });
  await send({ type: 'inspect', on: false });
  await waitFor(() => site.evaluate('!document.querySelector("lupax-root")'), { label: 'overlay removed' });
});

test('color picker stores the picked color', async () => {
  await freshSite();
  await run(`await chrome.storage.local.remove('colorHistory')`);
  const pt = await site.evaluate(`(() => { const r = document.querySelector('.btn').getBoundingClientRect(); return { x: r.left + 6, y: r.top + r.height / 2 }; })()`);
  await send({ type: 'pick-color' });
  await sleep(1200);
  await site.mouse('mouseMoved', pt.x, pt.y); await sleep(250);
  await site.click(pt.x, pt.y);
  const hist = await waitFor(async () => (await run(`return (await chrome.storage.local.get('colorHistory')).colorHistory`))?.[0], { label: 'picked color' });
  assert.equal(hist.toUpperCase(), '#7241FF');
});

test('editor saves annotations back to history', async () => {
  await setSettings({ capture: { ...quietCapture, annotate: true } });
  await freshSite();
  const prev = (await lastItem())?.id;
  await send({ type: 'capture', mode: 'visible' });
  const it = await newItem(prev);
  const t = await b.waitForTarget((x) => x.url.includes(`viewer.html?id=${it.id}`));
  const ed = await b.attach(t.targetId);
  await sleep(1200);
  const r = await ed.evaluate(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  await ed.evaluate(`document.querySelector('[data-tool=rect]').click()`);
  await ed.drag(r.x + r.w * 0.2, r.y + r.h * 0.2, r.x + r.w * 0.5, r.y + r.h * 0.5);
  await setSettings({ capture: { ...quietCapture, annotate: true, destination: 'none' } });
  await ed.evaluate(`document.getElementById('saveBtn').click()`);
  const saved = await waitFor(() => db(`const x = await db.getItem(${JSON.stringify(it.id)}); return x && !x.pending ? { size: x.size } : null`), { label: 'saved edit' });
  assert.ok(saved.size > 0);
  assert.deepEqual(ed.exceptions(), []);
  await ed.detach();
});

test('tab recording saves a WebM and streams chunks to IndexedDB while recording', async () => {
  await setSettings({ record: { source: 'tab', mic: false, webcam: false, systemAudio: true, cursor: false, countdown: 0, quality: '720', fps: 24 } });
  await freshSite();
  await resetBadge();
  const prev = (await lastItem())?.id;
  await send({ type: 'record-start', options: { source: 'tab', mic: false, webcam: false, systemAudio: true, cursor: false, countdown: 0, quality: '720', fps: 24 } });
  await waitFor(async () => (await badge()).text === 'REC', { label: 'REC badge', ms: 8000 });
  await sleep(3500);
  const chunksWhileRecording = await db(`return db.countChunks ? db.countChunks() : -1`);
  await send({ type: 'record-stop' });
  const it = await newItem(prev, { ms: 15000 });
  assert.equal(it.kind, 'video');
  assert.equal(it.head.slice(0, 4), '\x1aE\xdf\xa3', 'WebM/EBML header');
  assert.ok(it.size > 1000);
  assert.ok(chunksWhileRecording >= 2, `expected chunks persisted during recording, got ${chunksWhileRecording}`);
  assert.equal(await db(`return db.countChunks()`), 0, 'chunks cleaned up after save');
});

test('recording setup failure releases the tab, reports the error in the page, and allows a retry', async () => {
  await freshSite();
  await resetBadge();
  // make the microphone fail inside the offscreen document, after the tab stream was acquired
  await run(`if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length)
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA', 'BLOBS'], justification: 'test' });`);
  const off = await b.attach((await b.waitForTarget((t) => t.url.endsWith('/offscreen.html'))).targetId);
  await off.evaluate(`(() => { const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => c.video ? real(c) : Promise.reject(new DOMException('Mic blocked by test', 'NotAllowedError')); })()`);
  const opts = { source: 'tab', mic: true, webcam: false, systemAudio: true, cursor: false, countdown: 0, quality: '720', fps: 24 };
  await send({ type: 'record-start', options: opts });
  await waitFor(async () => (await badge()).text === '!', { label: 'error badge' });
  const captured = await run(`return (await chrome.tabCapture.getCapturedTabs()).filter((c) => c.status === 'active' || c.status === 'pending').length`);
  const toast = await site.evaluate(`document.querySelector('[data-lupax-toast="error"]') ? 'shown' : 'missing'`);
  await off.detach();
  assert.equal(captured, 0, 'tab capture should be released after a failed start');
  assert.equal(toast, 'shown', 'error toast should appear in the page');
  // retry without the broken mic must work (no "Already recording")
  await resetBadge();
  const prev = (await lastItem())?.id;
  await send({ type: 'record-start', options: { ...opts, mic: false } });
  await waitFor(async () => (await badge()).text === 'REC', { label: 'REC badge on retry', ms: 8000 });
  await sleep(1500);
  await send({ type: 'record-stop' });
  const it = await newItem(prev, { ms: 15000 });
  assert.equal(it.kind, 'video');
});

test('orphaned recording chunks are recovered into history', async () => {
  const res = await db(`
    const recId = 'test-orphan';
    await db.appendChunk(recId, -1, null, { name: 'crashed-tab', title: 'Crashed', mimeType: 'video/webm' });
    await db.appendChunk(recId, 0, new Blob(['abc'], { type: 'video/webm' }));
    await db.appendChunk(recId, 1, new Blob(['def'], { type: 'video/webm' }));
    const ids = await db.recoverOrphanRecordings();
    const it = await db.getItem(ids[0]);
    return { n: ids.length, name: it.name, text: await it.blob.text(), left: await db.countChunks() };`);
  assert.deepEqual(res, { n: 1, name: 'crashed-tab-recovered.webm', text: 'abcdef', left: 0 });
});

test('history keeps 60 screenshots/exports and 20 recordings, never pruning pending edits', async () => {
  const res = await db(`
    await db.clearItems();
    const tiny = new Blob(['x']);
    const t0 = Date.now() - 1e6;
    await db.putItem({ kind: 'image', name: 'pending.png', blob: tiny, pending: true, createdAt: t0 });
    for (let i = 0; i < 25; i++) await db.putItem({ kind: 'video', name: 'v' + i, blob: tiny, createdAt: t0 + 10 + i });
    for (let i = 0; i < 70; i++) await db.putItem({ kind: i % 5 ? 'image' : 'file', name: 'i' + i, blob: tiny, createdAt: t0 + 100 + i });
    await new Promise((r) => setTimeout(r, 300));
    const all = await db.listItems();
    return { videos: all.filter((x) => x.kind === 'video').length, other: all.filter((x) => x.kind !== 'video' && !x.pending).length,
      pending: all.some((x) => x.pending), newestVideo: all.find((x) => x.kind === 'video')?.name };`);
  assert.deepEqual(res, { videos: 20, other: 60, pending: true, newestVideo: 'v24' });
});

test('ZIP export runs in the background, survives the popup closing, and de-duplicates names', async () => {
  await freshSite();
  const svg = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
  const assets = [
    { url: svg, name: 'icon.svg', type: 'svg', format: 'svg' },
    { url: svg, name: 'icon.svg', type: 'svg', format: 'svg' },
    { url: SITE.replace('site.html', 'logo.svg'), name: 'logo', type: 'image', format: 'svg' },
    { url: SITE.replace('site.html', 'missing.png'), name: 'missing.png', type: 'image', format: 'png' },
  ];
  const before = fs.existsSync(path.join(b.downloads, 'LupaX')) ? fs.readdirSync(path.join(b.downloads, 'LupaX')) : [];
  const prev = (await lastItem())?.id;
  await send({ type: 'export-zip', assets, title: 'Fixture', url: SITE });
  const it = await newItem(prev, { ms: 15000 });
  assert.equal(it.format, 'zip');
  const file = await waitFor(() => {
    const f = fs.readdirSync(path.join(b.downloads, 'LupaX')).find((n) => n.endsWith('.zip') && !before.includes(n));
    return f && path.join(b.downloads, 'LupaX', f);
  }, { label: 'downloaded zip' });
  await sleep(300);
  const listing = execFileSync('unzip', ['-Z1', file]).toString().trim().split('\n').sort();
  execFileSync('unzip', ['-tq', file]);
  assert.deepEqual(listing, ['images/logo.svg', 'svgs/icon-2.svg', 'svgs/icon.svg']);
});

// ───────────── run ─────────────
let failed = 0, passed = 0;
const t0 = Date.now();
for (const t of tests) {
  if (only && !t.name.toLowerCase().includes(only.toLowerCase())) continue;
  const s = Date.now();
  try {
    await t.fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${t.name} \x1b[2m(${Date.now() - s} ms)\x1b[0m`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗ ${t.name}\x1b[0m\n      ${String(e.message).split('\n').join('\n      ')}`);
  }
}
console.log(`\n${passed} passed, ${failed} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
await b.close();
server.close();
process.exit(failed ? 1 : 0);
