import { icon, hydrateIcons } from './lib/icons.js';
import { getSettings, setSettings, QUALITY } from './lib/settings.js';
import { clearItems, HISTORY_LIMITS } from './lib/db.js';
import { bytes, esc } from './lib/format.js';

hydrateIcons();
const $ = (s) => document.querySelector(s);
let S = await getSettings();

function toast(t) {
  const el = $('#toast');
  el.innerHTML = `${icon('checkCircle')}<span>${esc(t)}</span>`;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 1400);
}

const sw = (path, val) => `<label class="switch"><input type="checkbox" data-path="${path}" ${val ? 'checked' : ''}/><span></span></label>`;
const seg = (path, val, opts) => `<div class="seg" data-seg="${path}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(val) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const sel = (path, val, opts) => `<span class="select"><select data-path="${path}">${opts.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>${icon('chevDown')}</span>`;
const row = (ic, t, d, ctl) => `<div class="row"><span class="tile sm">${icon(ic)}</span><div class="lbl"><b>${t}</b>${d ? `<span>${d}</span>` : ''}</div>${ctl}</div>`;

async function render() {
  const c = S.capture, r = S.record;
  const est = await navigator.storage.estimate().catch(() => ({}));
  const shortcuts = await chrome.commands.getAll().catch(() => []);
  $('#root').innerHTML = `
    <section class="card group" id="capture">
      <h2>${icon('camera')}Capture</h2>
      ${row('region', 'Default capture mode', 'Used by “Capture Now”', sel('capture.mode', c.mode, [['visible', 'Visible area'], ['area', 'Selected region'], ['full', 'Full page'], ['scroll', 'Scrolling capture'], ['delayed', 'Delayed capture'], ['element', 'Element capture'], ['desktop', 'Desktop screenshot']]))}
      ${row('timer', 'Delay', 'Countdown for delayed capture', seg('capture.delay', c.delay, [[3, '3s'], [5, '5s'], [10, '10s']]))}
      ${row('imageFile', 'File type', '', seg('capture.fileType', c.fileType, [['png', 'PNG'], ['jpg', 'JPG'], ['pdf', 'PDF']]))}
      ${row('imageFile', 'JPG quality', '', sel('capture.jpgQuality', c.jpgQuality, [[0.8, '80%'], [0.92, '92%'], [1, '100%']]))}
      ${row('pen', 'Annotate after capture', 'Open the editor before saving', sw('capture.annotate', c.annotate))}
      ${row('copy', 'Copy to clipboard', 'Automatically copy the result', sw('capture.copy', c.copy))}
      ${row('folder', 'Save destination', 'Files go to Downloads/LupaX', sel('capture.destination', c.destination, [['downloads', 'Downloads'], ['ask', 'Ask where to save'], ['none', 'Don’t save (preview only)']]))}
      ${row('fullpage', 'Hide sticky headers', 'On full-page and scrolling captures, show fixed elements only once', sw('capture.hideFixed', c.hideFixed))}
    </section>
    <section class="card group" id="record">
      <h2>${icon('video')}Recording</h2>
      ${row('tab', 'Default source', '', seg('record.source', r.source, [['tab', 'Tab'], ['window', 'Window'], ['desktop', 'Desktop']]))}
      ${row('mic', 'Microphone audio', '', sw('record.mic', r.mic))}
      ${row('speaker', 'Tab / system audio', '', sw('record.systemAudio', r.systemAudio))}
      ${row('webcam', 'Webcam bubble', 'Composited into the video', sw('record.webcam', r.webcam))}
      ${row('webcam', 'Webcam position', '', sel('record.webcamPosition', r.webcamPosition, [['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right'], ['top-left', 'Top left'], ['top-right', 'Top right']]))}
      ${row('cursor', 'Cursor highlight', 'Halo and click ripples (tab recordings)', sw('record.cursor', r.cursor))}
      ${row('timer', 'Countdown', '', seg('record.countdown', r.countdown, [[0, 'Off'], [3, '3s'], [5, '5s'], [10, '10s']]))}
      ${row('hd', 'Video quality', '', sel('record.quality', r.quality, Object.entries(QUALITY).map(([k, q]) => [k, q.label])))}
      ${row('layers', 'Frame rate', '', seg('record.fps', r.fps, [[24, '24'], [30, '30'], [60, '60']]))}
      ${row('shield', 'Microphone & camera access', 'Needed once for tab recordings', `<button class="btn" id="perm">${icon('mic')}Grant access</button>`)}
    </section>
    <section class="card group">
      <h2>${icon('bolt')}Keyboard shortcuts</h2>
      ${shortcuts.filter((s) => s.description).map((s) => row('bolt', esc(s.description), '', `<kbd style="font:700 12px var(--mono);padding:4px 8px;border-radius:6px;background:var(--surface-2);border:1px solid var(--line-2)">${esc(s.shortcut || 'Not set')}</kbd>`)).join('')}
      ${row('gear', 'Customize shortcuts', '', `<button class="btn" id="sc">${icon('external')}Open</button>`)}
    </section>
    <section class="card group">
      <h2>${icon('folder')}Storage</h2>
      ${row('folder', 'Saved captures', `Using ${bytes(est.usage)} on this device. History keeps your latest ${HISTORY_LIMITS.other} screenshots and exports and ${HISTORY_LIMITS.video} recordings; older ones are removed automatically (files already downloaded are not affected).`, `<button class="btn danger" id="clear">${icon('trash')}Clear history</button>`)}
    </section>`;

  const save = async (path, value) => {
    const [g, k] = path.split('.');
    S = await setSettings({ [g]: { [k]: value } });
    toast('Saved');
  };
  const cast = (path, v) => (/delay|countdown|fps|jpgQuality/.test(path) ? +v : v);
  for (const el of document.querySelectorAll('input[data-path]')) el.onchange = () => save(el.dataset.path, el.checked);
  for (const el of document.querySelectorAll('select[data-path]')) el.onchange = () => save(el.dataset.path, cast(el.dataset.path, el.value));
  for (const g of document.querySelectorAll('[data-seg]')) {
    g.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      save(g.dataset.seg, cast(g.dataset.seg, b.dataset.v));
    };
  }
  $('#perm').onclick = () => chrome.tabs.create({ url: 'permissions.html?need=microphone,camera' });
  $('#sc').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  $('#clear').onclick = async () => { if (confirm('Delete all saved captures, recordings and exports?')) { await clearItems(); toast('History cleared'); render(); } };
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}
render();
