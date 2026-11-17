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
  if (req.url.startsWith('/hang')) return; // never answers: exercises fetch timeouts
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
async function freshSite(url = SITE) {
  await site?.detach();
  await run(`const me = (await chrome.tabs.getCurrent()).id;
    for (const t of await chrome.tabs.query({})) if (t.id !== me) await chrome.tabs.remove(t.id).catch(() => {});
    const t = await chrome.tabs.create({ url: ${JSON.stringify(url)}, active: true });
    await new Promise((r) => { const f = (id, i) => { if (id === t.id && i.status === 'complete') { chrome.tabs.onUpdated.removeListener(f); r(); } }; chrome.tabs.onUpdated.addListener(f); });`);
  const t = await b.waitForTarget((x) => x.type === 'page' && x.url === url);
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

test('asset scan: srcset URLs with commas, and inline SVGs that open and render on their own', async () => {
  const url = SITE.replace('site.html', 'assets.html');
  await freshSite(url);
  const res = await run(`const { scanAssets } = await import('./lib/scan.js');
    const [t] = await chrome.tabs.query({ url: ${JSON.stringify(url)} });
    const { assets } = (await chrome.scripting.executeScript({ target: { tabId: t.id }, func: scanAssets }))[0].result;
    // how a saved .svg behaves: parse it as standalone XML, then draw it and count painted pixels
    const check = async (a) => {
      const xml = decodeURIComponent(a.url.slice(a.url.indexOf(',') + 1));
      const parses = !new DOMParser().parseFromString(xml, 'image/svg+xml').querySelector('parsererror');
      const img = new Image();
      const loaded = await new Promise((r) => { img.onload = () => r(true); img.onerror = () => r(false); img.src = a.url; });
      let painted = 0;
      if (loaded) {
        const c = new OffscreenCanvas(96, 96), x = c.getContext('2d');
        x.drawImage(img, 0, 0, 96, 96);
        const d = x.getImageData(0, 0, 96, 96).data;
        for (let i = 3; i < d.length; i += 4) if (d[i]) painted++;
      }
      return { name: a.name, parses, loaded, painted, hasSymbol: xml.includes('<symbol'), gradient: xml.includes('brand-grad"') };
    };
    return { urls: assets.map((a) => a.url), svgs: await Promise.all(assets.filter((a) => a.url.startsWith('data:image/svg+xml;charset')).map(check)) };`);
  assert.ok(res.urls.some((u) => u.endsWith('/cdn/w_1200,c_fill/photo.jpg')), `largest srcset candidate, commas intact: ${res.urls.filter((u) => u.includes('/cdn/'))}`);
  assert.ok(!res.urls.some((u) => /\/cdn\/w_\d+$/.test(u)), 'no URL cut at a comma');
  const byName = (p) => res.svgs.find((s) => s.name.startsWith(p));
  for (const p of ['star-', 'star-xlink-', 'label-']) {
    const s = byName(p);
    assert.ok(s, `inline svg ${p}* found: ${res.svgs.map((x) => x.name)}`);
    assert.ok(s.parses && s.loaded, `${p}* is valid standalone SVG: ${JSON.stringify(s)}`);
  }
  for (const p of ['star-', 'star-xlink-']) {
    const s = byName(p);
    assert.ok(s.hasSymbol && s.gradient, `${p}* carries the sprite symbol and its gradient`);
    assert.ok(s.painted > 500, `${p}* renders the icon, not a blank file (${s.painted} px)`);
  }
});

test('Export ZIP exports the whole selection, even from another category', async () => {
  await freshSite();
  // a background popup tab scans the active (fixture) tab, like the real popup
  await run(`await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=assets'), active: false })`);
  const p = await b.attach((await b.waitForTarget((x) => x.url.includes('popup.html?view=assets'))).targetId);
  try {
    await waitFor(() => p.evaluate(`document.querySelectorAll('.acard').length`), { label: 'asset cards', ms: 8000 });
    // record what Export sends instead of downloading
    await p.evaluate(`window.__zips = []; const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (m, ...r) => m?.type === 'export-zip' ? (window.__zips.push(m), Promise.resolve({ ok: true })) : real(m, ...r); true`);
    const click = (sel) => p.evaluate(`document.querySelector(${JSON.stringify(sel)}).click(); true`);
    await click('[data-type="svg"]');
    const picked = await p.evaluate(`document.querySelector('.acard .cb').click(); document.querySelector('.acard b')?.textContent`);
    await click('[data-type="icon"]'); // a category the selected SVG is not in
    assert.equal(await p.evaluate(`document.getElementById('zip').disabled`), false, 'Export enabled while something is selected');
    await click('#zip');
    const sent = await waitFor(() => p.evaluate('window.__zips[0]?.assets'), { label: 'export-zip message' });
    assert.deepEqual(sent.map((a) => a.name), [picked]);
    assert.deepEqual(p.exceptions(), []);
  } finally {
    await p.detach();
    await b.send('Target.closeTarget', { targetId: p.targetId });
  }
});

test('style inspector escapes page-controlled CSS in component previews', async () => {
  await freshSite(SITE.replace('site.html', 'hostile.html'));
  // a background popup tab in the same window scans the active (hostile) tab, like the real popup
  await run(`await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=inspect'), active: false })`);
  const p = await b.attach((await b.waitForTarget((x) => x.url.includes('popup.html?view=inspect'))).targetId);
  try {
    await waitFor(() => p.evaluate(`document.querySelectorAll('[data-comp^="buttons:"]').length`), { label: 'button previews', ms: 8000 });
    assert.equal(await p.evaluate(`!!document.getElementById('lupax-pwned')`), false, 'page markup was injected into the popup');
    assert.deepEqual(p.exceptions(), []);
  } finally {
    await p.detach();
    await b.send('Target.closeTarget', { targetId: p.targetId });
  }
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

test('accessibility scan: text over images, hidden content and svg titles are not misreported', async () => {
  const url = SITE.replace('site.html', 'a11y-edge.html');
  await freshSite(url);
  const r = await run(`const { scanA11y } = await import('./lib/scan.js');
    const [t] = await chrome.tabs.query({ url: ${JSON.stringify(url)} });
    return (await chrome.scripting.executeScript({ target: { tabId: t.id }, func: scanA11y }))[0].result;`);
  const byId = (id) => r.checks.find((c) => c.id === id);
  assert.deepEqual(byId('contrast').items.map((i) => i.text), ['Really faded text'], 'only the real failure: not the photo heading, not the closed menu');
  assert.deepEqual(byId('alt').items.map((i) => i.selector.split(' > ').pop()), ['#no-alt'], 'only the image without a name');
  assert.equal(byId('alt').passed, 3, 'hero img (alt), svg (title), aria-hidden img');

  // the in-page inspector uses the same rule for the photo heading
  await send({ type: 'inspect', on: true });
  await waitFor(() => site.evaluate('!!document.querySelector("lupax-root")'), { label: 'inspector overlay' });
  const h = await site.evaluate(`(() => { const r = document.querySelector('.hero h2').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
  await site.click(h.x, h.y); // pin it: the panel opens
  // the panel lives in a closed shadow root; CDP can still read it
  const panelText = await waitFor(async () => {
    const doc = JSON.stringify(await site.send('DOM.getDocument', { depth: -1, pierce: true }));
    return doc.includes('Contrast') ? doc : null;
  }, { label: 'inspector panel with contrast row' });
  await send({ type: 'inspect', on: false });
  assert.ok(panelText.includes('Over image'), 'inspector flags the photo heading instead of rating it Poor');
  assert.ok(!panelText.includes('"Poor"'), 'not rated Poor');
});

test('report page survives a bad focus parameter and a scan that returns nothing', async () => {
  await freshSite();
  const tabId = await run(`return (await chrome.tabs.query({ url: ${JSON.stringify(SITE)} }))[0].id`);
  const p = await b.open(b.url(`report.html?tab=${tabId}&focus=${encodeURIComponent('x"] b, [y')}`));
  try {
    await waitFor(() => p.evaluate(`!!document.querySelector('.donut b')`), { label: 'report rendered', ms: 8000 });
    assert.deepEqual(p.exceptions(), [], 'a focus value that is not a valid selector does not throw');
    // the injected scan comes back without a result (frame navigated or crashed mid-scan)
    await p.evaluate(`chrome.scripting.executeScript = async () => [{}]; document.getElementById('rescan').click(); true`);
    const msg = await waitFor(() => p.evaluate(`document.querySelector('#root h2')?.textContent === 'Can’t scan this tab' && document.querySelector('#root p').textContent`), { label: 'error card' });
    assert.match(msg, /Rescan/);
    assert.deepEqual(p.exceptions(), []);
  } finally {
    await p.detach();
    await b.send('Target.closeTarget', { targetId: p.targetId });
  }
});

test('accessibility score weighs every check by how many elements it analyzed', async () => {
  await freshSite();
  const r = await run(`const { scanA11y } = await import('./lib/scan.js');
    const [t] = await chrome.tabs.query({ url: ${JSON.stringify(SITE)} });
    return (await chrome.scripting.executeScript({ target: { tabId: t.id }, func: scanA11y }))[0].result;`);
  const sum = (sev, k) => r.checks.filter((c) => !sev || c.severity === sev).reduce((s, c) => s + c[k], 0);
  assert.ok(r.checks.filter((c) => c.passed + c.failed > 0).length >= 3, 'fixture exercises several checks');
  assert.equal(r.passed, sum(null, 'passed'));
  assert.equal(r.score, Math.round((r.passed / (r.passed + sum('issue', 'failed') + sum('warning', 'failed') * 0.5)) * 100));
  assert.equal(r.truncated, false);
  const byId = (id) => r.checks.find((c) => c.id === id);
  assert.equal(byId('labels').summary, '1 form field has no accessible label');
  assert.deepEqual(byId('alt').items.map((i) => i.detail), ['inline SVG image'], 'a data: image is named, not split on "/"');
});

test('scans handle oklch()/lab() colors and elements with numeric values', async () => {
  const url = SITE.replace('site.html', 'modern.html');
  await freshSite(url);
  const scan = (fn) => run(`const m = await import('./lib/scan.js');
    const [t] = await chrome.tabs.query({ url: ${JSON.stringify(url)} });
    return (await chrome.scripting.executeScript({ target: { tabId: t.id }, func: m.${fn} }))[0].result;`);
  const hexes = (list) => list.map((c) => c.value);
  const near = (hex, [r, g, b], tol = 12) => { const n = parseInt(hex.slice(1, 7), 16); return Math.abs((n >> 16) - r) <= tol && Math.abs(((n >> 8) & 255) - g) <= tol && Math.abs((n & 255) - b) <= tol; };

  // <progress>/<meter>/<li value> used to throw "trim is not a function" and kill the whole style scan
  const s = await scan('scanStyles');
  assert.ok(s?.colors, 'style scan returned a result');
  const colors = hexes(s.colors);
  assert.ok(colors.some((h) => near(h, [21, 93, 252])), `oklch blue-600 is in the palette: ${colors}`);
  assert.ok(colors.some((h) => near(h, [229, 229, 229])), `oklch gray text is in the palette: ${colors}`);
  assert.ok(colors.some((h) => near(h, [0, 166, 62], 20)), `oklch shadow color is in the palette: ${colors}`);
  assert.ok(colors.length >= 6, `gradient (lab/oklch) stops are collected too: ${colors}`);
  // both .cta elements share one style, so they are one component; its label still comes from the button text
  assert.match(s.components.buttons[0]?.label || '', /^(Get started|Sign up)$/);
  assert.ok(near(s.components.buttons[0].bg, [21, 93, 252]), `button background resolved: ${s.components.buttons[0].bg}`);

  // white text on an oklch blue passes; light-gray oklch text on white fails
  const a = await scan('scanA11y');
  const contrast = a.checks.find((c) => c.id === 'contrast');
  const failed = contrast.items.map((i) => i.text);
  assert.ok(!failed.some((t) => /Get started|Sign up/.test(t)), `oklch button not misreported: ${JSON.stringify(contrast.items)}`);
  assert.ok(failed.includes('Barely visible oklch text'), `oklch low-contrast text is reported: ${JSON.stringify(contrast.items)}`);
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

test('a second capture while one is running is refused and leaves the page intact', async () => {
  await setSettings({ capture: { ...quietCapture, hideFixed: true } });
  await freshSite();
  await resetBadge();
  await site.evaluate(`document.body.insertAdjacentHTML('afterbegin', '<div id="stick" style="position:sticky;top:0;height:40px;background:#ccc">sticky</div>'); true`);
  const count = () => db('return (await db.listItems({ limit: 200 })).length');
  const before = await count();
  // e.g. the full-page shortcut pressed twice
  await Promise.all([send({ type: 'capture', mode: 'full' }), send({ type: 'capture', mode: 'full' })]);
  const err = await waitFor(async () => { const t = (await badge()).title; return t.includes('already') ? t : null; }, { label: 'busy error', ms: 5000 });
  assert.match(err, /A capture is already in progress/);
  await waitFor(async () => (await count()) > before, { label: 'capture saved', ms: 20000 });
  await sleep(2500); // a second run would still be stitching
  assert.equal(await count(), before + 1, 'exactly one capture was saved');
  const page = await site.evaluate(`({ vis: document.getElementById('stick').style.visibility, sb: document.documentElement.style.scrollBehavior, fixed: (window.__ixFixed || []).length })`);
  assert.deepEqual(page, { vis: '', sb: '', fixed: 0 }, 'sticky header and scroll-behavior restored');
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
  const saved = await waitFor(() => db(`const x = await db.getItem(${JSON.stringify(it.id)}); return x && !x.pending ? {
    size: x.size, original: x.original?.size ?? 0 } : null`), { label: 'saved edit' });
  assert.ok(saved.size > 0);
  assert.ok(saved.original > 0, 'the unannotated original is kept after saving');
  assert.notEqual(saved.original, saved.size, 'original differs from the annotated image');
  assert.deepEqual(ed.exceptions(), []);
  await ed.detach();
});

test('editor: crop is clamped, unsaved edits warn, IME Enter, and Save survives a deleted item', async () => {
  await setSettings({ capture: { ...quietCapture, annotate: true } });
  await freshSite();
  const prev = (await lastItem())?.id;
  await send({ type: 'capture', mode: 'visible' });
  const it = await newItem(prev);
  const ed = await b.attach((await b.waitForTarget((x) => x.url.includes(`viewer.html?id=${it.id}`))).targetId);
  try {
    await sleep(1200);
    const r = await ed.evaluate(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    const unloadBlocked = () => ed.evaluate(`(() => { const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; })()`);
    assert.equal(await unloadBlocked(), false, 'no warning before any edit');

    // IME: Enter while composing must not commit the text box
    await ed.evaluate(`document.querySelector('[data-tool=text]').click()`);
    await ed.click(r.x + r.w * 0.1, r.y + r.h * 0.1);
    await waitFor(() => ed.evaluate(`!!document.querySelector('.txt-in')`), { label: 'text box' });
    await ed.evaluate(`(() => { const el = document.querySelector('.txt-in'); el.textContent = 'にほん';
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); })()`);
    assert.equal(await ed.evaluate(`!!document.querySelector('.txt-in')`), true, 'IME Enter kept the text box open');
    await ed.evaluate(`document.querySelector('.txt-in').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    assert.equal(await ed.evaluate(`!!document.querySelector('.txt-in')`), false, 'plain Enter commits');
    assert.equal(await unloadBlocked(), true, 'unsaved annotation warns before closing');

    // crop dragged past the right edge of the image
    await ed.evaluate(`document.querySelector('[data-tool=crop]').click()`);
    await ed.drag(r.x + r.w * 0.6, r.y + r.h * 0.4, r.x + r.w + 15, r.y + r.h * 0.7);

    // the item disappears while open (History delete / Clear history), then Save twice
    await db(`await db.deleteItem(${JSON.stringify(it.id)})`);
    await setSettings({ capture: { ...quietCapture, annotate: true, destination: 'none', fileType: 'png' } });
    for (let i = 0; i < 2; i++) {
      await ed.evaluate(`document.getElementById('saveBtn').click()`);
      await waitFor(() => ed.evaluate(`!document.getElementById('saveBtn').disabled`), { label: 'save finished' });
      await sleep(300);
    }
    const saved = await waitFor(() => db(`const x = await db.getItem(${JSON.stringify(it.id)}); if (!x) return null;
      const bmp = await createImageBitmap(x.blob); return { w: bmp.width, h: bmp.height, pending: x.pending }`), { label: 'item restored by Save' });
    assert.equal(saved.pending, false);
    assert.ok(saved.w <= Math.ceil(it.width * 0.4) + 1 && saved.w >= Math.floor(it.width * 0.4) - 2, `crop clamped to the image: ${saved.w} of ${it.width}`);
    assert.equal(await unloadBlocked(), false, 'no warning after saving');
    assert.deepEqual(ed.exceptions(), []);
    assert.equal(await ed.evaluate(`document.querySelector('.toast')?.textContent || ''`).then((t) => /Cannot read/.test(t)), false);
  } finally {
    await ed.detach();
  }
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

const recOpts = { source: 'tab', mic: false, webcam: false, systemAudio: true, cursor: false, countdown: 0, quality: '720', fps: 24 };
const offscreenRecording = () => run(`return (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'status' }).catch(() => null))?.recording ?? null`);
const sessionRecording = () => run(`return (await chrome.storage.session.get('recording')).recording ?? null`);

test('two recording starts at once: the second is refused and the first keeps recording', async () => {
  await freshSite();
  await resetBadge();
  const prev = (await lastItem())?.id;
  // the offscreen document already exists (it also serves downloads): both starts get past setup and race
  await run(`if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length)
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA', 'BLOBS'], justification: 'download' });`);
  // e.g. the record shortcut and the popup button at the same moment
  await Promise.all([send({ type: 'record-start', options: recOpts }), send({ type: 'record-start', options: recOpts })]);
  await waitFor(async () => { const r = await sessionRecording(); return r && !r.starting; }, { label: 'recording started', ms: 8000 });
  await sleep(2500);
  assert.equal(await offscreenRecording(), true, 'first recording still running');
  await send({ type: 'record-stop' });
  const it = await newItem(prev, { ms: 15000 });
  assert.equal(it.kind, 'video');
  assert.ok(!/recovered/.test(it.name), `saved normally, not recovered: ${it.name}`);
});

test('a crashed tab recorder does not block recording when the offscreen document is recreated', async () => {
  await freshSite();
  await resetBadge();
  await send({ type: 'record-start', options: recOpts });
  await waitFor(async () => { const r = await sessionRecording(); return r && !r.starting; }, { label: 'recording started', ms: 8000 });
  // the recorder dies (renderer crash), then a download recreates the offscreen document
  await run(`await chrome.offscreen.closeDocument();
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA', 'BLOBS'], justification: 'download' });`);
  assert.equal(await offscreenRecording(), false);
  const prev = (await lastItem())?.id;
  await send({ type: 'record-start', options: recOpts });
  await waitFor(async () => (await offscreenRecording()) === true, { label: 'new recording started', ms: 8000 });
  await sleep(2000);
  await send({ type: 'record-stop' });
  const it = await waitFor(async () => { const x = await lastItem(); return x && x.id !== prev && !/recovered/.test(x.name) ? x : null; }, { label: 'new recording saved', ms: 15000 });
  assert.equal(it.kind, 'video');
});

test('stopping during the countdown cancels the tab recording quietly', async () => {
  await freshSite();
  await resetBadge();
  const prev = (await lastItem())?.id;
  await send({ type: 'record-start', options: { source: 'tab', mic: false, webcam: false, systemAudio: true, cursor: false, countdown: 3, quality: '720', fps: 24 } });
  await waitFor(() => site.evaluate('!!document.querySelector("[data-lupax-countdown]")'), { label: 'countdown overlay', ms: 8000 });
  await send({ type: 'record-stop' });
  await waitFor(async () => !(await site.evaluate('!!document.querySelector("[data-lupax-countdown]")')), { label: 'countdown removed on stop', ms: 2000 });
  await sleep(4500); // past the end of the countdown, when the recording used to begin anyway
  assert.equal(await run(`return (await chrome.storage.session.get('recording')).recording ?? null`), null, 'recording slot freed');
  assert.deepEqual(await badge(), { text: '', title: 'LupaX' }, 'no REC badge and no error');
  const captured = await run(`return (await chrome.tabCapture.getCapturedTabs()).filter((c) => c.status === 'active' || c.status === 'pending').length`);
  assert.equal(captured, 0, 'tab released');
  assert.equal((await lastItem())?.id, prev, 'nothing saved');
});

test('recording setup failure releases the tab, reports the error in the page, and allows a retry', async () => {
  await freshSite();
  await resetBadge();
  // make the microphone fail inside the offscreen document, after the tab stream was acquired
  await run(`if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length)
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA', 'BLOBS'], justification: 'test' });`);
  const off = await b.attach((await b.waitForTarget((t) => t.url.endsWith('/offscreen.html'))).targetId);
  await off.evaluate(`(() => { const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => c.video ? real(c) : Promise.reject(new DOMException('Mic in use by test', 'NotReadableError')); })()`);
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

test('record shortcut without a mic grant opens the grant page instead of failing', async () => {
  await freshSite();
  await resetBadge();
  await run(`if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length)
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA', 'BLOBS'], justification: 'test' });`);
  const off = await b.attach((await b.waitForTarget((t) => t.url.endsWith('/offscreen.html'))).targetId);
  await off.evaluate(`(() => { const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => c.video ? real(c) : Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); })()`);
  // what the Alt+Shift+R handler does: start straight away, without the popup's permission check
  await send({ type: 'record-start', options: { ...recOpts, mic: true } });
  const t = await b.waitForTarget((x) => x.url.includes('permissions.html?need=microphone'), 8000);
  await off.detach();
  assert.equal((await badge()).text, '', 'no error badge: the grant page explains what to do');
  assert.equal(await sessionRecording(), null, 'slot freed');
  const captured = await run(`return (await chrome.tabCapture.getCapturedTabs()).filter((c) => c.status === 'active' || c.status === 'pending').length`);
  assert.equal(captured, 0, 'tab released');
  await b.send('Target.closeTarget', { targetId: t.targetId });
});

test('a failed chunk write stops the recording and saves the intact part before it', async () => {
  await freshSite();
  await resetBadge();
  const opts = { source: 'tab', mic: false, webcam: false, systemAudio: true, cursor: false, countdown: 0, quality: '720', fps: 24 };
  const prev = (await lastItem())?.id;
  await send({ type: 'record-start', options: opts });
  await waitFor(async () => (await badge()).text === 'REC', { label: 'REC badge', ms: 8000 });
  await sleep(2500);
  // simulate a full disk: every later chunk write throws, other stores keep working
  const off = await b.attach((await b.waitForTarget((t) => t.url.endsWith('/offscreen.html'))).targetId);
  const realPut = 'IDBObjectStore.prototype.__realPut';
  await off.evaluate(`(() => { const real = ${realPut} = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, ...rest) {
      if (this.name === 'chunks' && v?.seq >= 0) throw new DOMException('Disk full (test)', 'QuotaExceededError');
      return real.call(this, v, ...rest); }; })()`);
  // no record-stop: the failed write must end the recording by itself
  const it = await newItem(prev, { ms: 15000 }).finally(async () => {
    // the offscreen document outlives this test, so undo the fake disk-full
    await off.evaluate(`IDBObjectStore.prototype.put = ${realPut}`).catch(() => {});
    await off.detach();
  });
  assert.equal(it.kind, 'video');
  assert.equal(it.head.slice(0, 4), '\x1aE\xdf\xa3', 'WebM/EBML header');
  assert.ok(it.size > 1000);
  await waitFor(async () => (await badge()).text !== 'REC', { label: 'REC badge cleared' });
  assert.equal(await run('return (await chrome.storage.session.get("recording")).recording ?? null'), null);
  assert.equal(await db(`return db.countChunks()`), 0, 'chunks cleaned up after the partial save');
  const viewer = await waitFor(async () => (await run(`return (await chrome.tabs.query({})).map((t) => t.url)`)).find((u) => u.includes(`viewer.html?id=${it.id}`)), { label: 'viewer tab' });
  assert.match(decodeURIComponent(viewer), /stopped early: storage failed \(Disk full \(test\)\)/);
});

test('a recording being set up holds the slot: no second recording can start during the countdown or screen picker', async () => {
  await freshSite();
  await resetBadge();
  const session = () => run(`return (await chrome.storage.session.get('recording')).recording ?? null`);
  const recorderWindows = () => run(`return (await chrome.tabs.query({})).filter((t) => t.url.includes('recorder.html')).length`);
  // tab recording in its countdown → a desktop recording is refused
  const opts = { source: 'tab', mic: false, webcam: false, systemAudio: true, cursor: false, countdown: 3, quality: '720', fps: 24 };
  const prev = (await lastItem())?.id;
  await send({ type: 'record-start', options: opts });
  await waitFor(async () => (await session())?.starting, { label: 'tab slot reserved' });
  await send({ type: 'record-start', options: { ...opts, source: 'desktop' } });
  await waitFor(async () => (await badge()).title.includes('already in progress'), { label: 'desktop start refused' });
  assert.equal(await recorderWindows(), 0, 'no recorder window while a tab recording is starting');
  await waitFor(async () => (await badge()).text === 'REC', { label: 'tab recording started', ms: 10000 });
  assert.equal((await session()).starting, undefined);
  await sleep(1500); // let MediaRecorder produce data, as the other recording tests do
  await send({ type: 'record-stop' });
  assert.equal((await newItem(prev, { ms: 15000 })).kind, 'video');

  // desktop recorder in its screen picker → a tab recording is refused; cancelling frees the slot
  await resetBadge();
  await send({ type: 'record-start', options: { ...opts, source: 'desktop' } });
  const rec = await waitFor(async () => { const r = await session(); return r?.starting && r.kind === 'desktop' ? r : null; }, { label: 'desktop slot reserved' });
  await send({ type: 'record-start', options: { ...opts, countdown: 0 } });
  await waitFor(async () => (await badge()).title.includes('already in progress'), { label: 'tab start refused' });
  assert.equal(await run(`return (await chrome.tabCapture.getCapturedTabs()).filter((c) => c.status === 'active' || c.status === 'pending').length`), 0);
  await send({ type: 'record-stop' }); // cancels the picker by closing the recorder window
  await waitFor(async () => (await session()) === null, { label: 'slot freed after cancel' });
  assert.equal(await run(`return chrome.windows.get(${rec.windowId}).then(() => true, () => false)`), false);
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

test('closing the recorder window mid-recording keeps what was recorded', async () => {
  await resetBadge();
  // a window/desktop recording in progress (the screen picker can't be driven in tests, so set up its state directly)
  const winId = await run(`const w = await chrome.windows.create({ url: 'about:blank', type: 'popup', width: 300, height: 200 });
    await chrome.storage.session.set({ recording: { kind: 'desktop', source: 'desktop', windowId: w.id, startedAt: Date.now(), pausedTotal: 0 } });
    return w.id;`);
  await db(`await db.appendChunk('test-window', -1, null, { name: 'desktop-rec', title: 'Desktop', mimeType: 'video/webm' });
    await db.appendChunk('test-window', 0, new Blob(['abc'], { type: 'video/webm' }));`);
  await run(`await chrome.windows.remove(${winId})`);
  const t = await b.waitForTarget((x) => x.url.includes('viewer.html') && x.url.includes('notice='), 5000);
  const id = new URL(t.url).searchParams.get('id');
  const it = await db(`const x = await db.getItem(${JSON.stringify(id)}); return { name: x.name, text: await x.blob.text() }`);
  assert.deepEqual(it, { name: 'desktop-rec-recovered.webm', text: 'abc' });
  assert.equal(await sessionRecording(), null, 'slot freed');
  await b.send('Target.closeTarget', { targetId: t.targetId });
});

test('history keeps 60 screenshots/exports and 20 recordings, never pruning recent pending edits', async () => {
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
    { url: SITE.replace('site.html', 'hang/slow.png'), name: 'slow.png', type: 'image', format: 'png' },
  ];
  const before = fs.existsSync(path.join(b.downloads, 'LupaX')) ? fs.readdirSync(path.join(b.downloads, 'LupaX')) : [];
  const prev = (await lastItem())?.id;
  await send({ type: 'export-zip', assets, title: 'Fixture', url: SITE });
  const it = await newItem(prev, { ms: 25000 }); // includes the 10 s timeout on the hanging asset
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
