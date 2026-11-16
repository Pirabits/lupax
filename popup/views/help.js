import { icon } from '../../lib/icons.js';
import { esc } from '../../lib/format.js';
import { $, view, shortcutMap, openPage, registerView } from '../core.js';

registerView('help', async ({ live }) => {
  const sc = await shortcutMap();
  if (!live()) return;
  const row = (ic, t, d, k) => `<div class="card help-item"><span class="tile sm">${icon(ic)}</span><div class="grow"><b>${t}</b><span>${d}</span></div>${k ? `<kbd class="k">${esc(k)}</kbd>` : ''}</div>`;
  view.innerHTML = `
    <div class="scroll">
      <h1 class="v-title">Help &amp; shortcuts</h1>
      <p class="v-sub">Everything LupaX can do, and the fastest way to do it.</p>
      <div class="help-list">
        ${row('monitor', 'Capture visible area', 'Screenshot what’s on screen', sc['capture-visible'])}
        ${row('region', 'Capture selected region', 'Drag to select an area', sc['capture-area'])}
        ${row('fullpage', 'Capture full page', 'Scrolls and stitches the whole page', sc['capture-full'])}
        ${row('video', 'Start / stop recording', 'Records the current tab', sc['toggle-recording'])}
        ${row('target', 'Inspect mode', 'Hover to inspect, click to pin · ↑/↓ parent/child · Esc to exit')}
        ${row('eyedropper', 'Color picker', 'Magnifier over the page · arrows nudge 1px · Enter picks')}
      </div>
      <div style="display:flex;gap:8px;margin:14px 0 6px">
        <button class="btn" id="hShort">${icon('bolt')}Customize shortcuts</button>
        <button class="btn" id="hHist">${icon('list')}All captures</button>
        <button class="btn" id="hSet">${icon('gear')}Settings</button>
      </div>
    </div>`;
  $('#hShort').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  $('#hHist').onclick = () => openPage('history.html');
  $('#hSet').onclick = () => openPage('settings.html');
});
