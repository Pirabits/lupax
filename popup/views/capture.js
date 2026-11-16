import { icon } from '../../lib/icons.js';
import { setSettings } from '../../lib/settings.js';
import { listItems } from '../../lib/db.js';
import { ago, esc } from '../../lib/format.js';
import { $, $$, view, send, state, toast, openPage, openViewer, itemMenu, registerView } from '../core.js';

registerView('capture', async () => {
  const c = state.S.capture;
  const big = (mode, ic, t, d, tile = '') => `
    <button class="opt mode ${c.mode === mode ? 'on' : ''}" data-mode="${mode}">
      <span class="check">${icon('check')}</span>
      <span class="tile sm ${tile}">${icon(ic)}</span>
      <span class="t">${t}</span><span class="d">${d}</span>
    </button>`;
  const row = (mode, ic, t, d, tile = '', extra = '', cls = '') => `
    <div class="opt mode row ${cls} ${extra ? 'has-sel' : ''} ${c.mode === mode ? 'on' : ''}" data-mode="${mode}" role="button" tabindex="0">
      <span class="check">${icon('check')}</span>
      <span class="tile sm ${tile}">${icon(ic)}</span>
      <span><div class="t">${t}</div><div class="d">${d}</div></span>
      ${extra}
    </div>`;
  view.innerHTML = `
    <div class="scroll">
      <h1 class="v-title">Capture Screen</h1>
      <p class="v-sub">Take screenshots your way — from what’s visible to full pages, scrolling content, and scheduled captures.</p>
      <div class="modes3">
        ${big('visible', 'monitor', 'Visible area', 'Capture what’s on screen')}
        ${big('area', 'region', 'Selected region', 'Choose a custom area to capture', 'coral')}
        ${big('full', 'fullpage', 'Full page', 'Capture the entire page')}
      </div>
      <div class="modes2">
        ${row('scroll', 'scroll', 'Scrolling capture', 'Auto-scroll to capture long content')}
        ${row('delayed', 'timer', `Delayed capture<small>${c.delay}s</small>`, 'Capture after a countdown (3s / 5s / 10s)', 'coral',
          `<span class="select sel" data-stop><select id="delay" title="Delay">${[3, 5, 10].map((s) => `<option value="${s}" ${c.delay === s ? 'selected' : ''}>${s}s</option>`).join('')}</select>${icon('chevDown')}</span>`)}
        ${row('element', 'element', 'Element capture', 'Click any element or fragment', '', '', 'compact')}
        ${row('desktop', 'monitor', 'Desktop screenshot', 'Screen or app window', 'coral', '', 'compact')}
      </div>
      <div class="card opts">
        <div class="opt-row">${icon('imageFile')}<div class="lbl"><b>File type</b></div>
          <div class="seg" id="ftype">${['png', 'jpg', 'pdf'].map((f) => `<button data-v="${f}" class="${c.fileType === f ? 'on' : ''}">${f.toUpperCase()}</button>`).join('')}</div></div>
        <div class="opt-row">${icon('pen')}<div class="lbl"><b>Annotate after capture</b><span>Add text, arrows, shapes, and more</span></div>
          <label class="switch"><input type="checkbox" id="annotate" ${c.annotate ? 'checked' : ''}/><span></span></label></div>
        <div class="opt-row">${icon('copy')}<div class="lbl"><b>Copy to clipboard</b><span>Automatically copy the result</span></div>
          <label class="switch"><input type="checkbox" id="copyClip" ${c.copy ? 'checked' : ''}/><span></span></label></div>
        <div class="opt-row">${icon('folder')}<div class="lbl"><b>Save destination</b></div>
          <span class="select">${icon('folder', 'lead')}
          <select id="dest" style="padding-left:34px">
            <option value="downloads" ${c.destination === 'downloads' ? 'selected' : ''}>Downloads</option>
            <option value="ask" ${c.destination === 'ask' ? 'selected' : ''}>Ask where to save</option>
            <option value="none" ${c.destination === 'none' ? 'selected' : ''}>Don’t save (preview only)</option>
          </select>${icon('chevDown')}</span></div>
      </div>
      <div class="h-sec"><h3>Recent Captures</h3><span class="spacer"></span><button class="more" id="viewAll">View All ${icon('arrowRight')}</button></div>
      <div class="recent3" id="recent"></div>
    </div>
    <div class="foot"><button class="cta" id="go">${icon('region')}Capture Now<span class="arrow">${icon('arrowRight')}</span></button></div>`;

  const save = async (patch) => { state.S = await setSettings({ capture: patch }); };
  for (const b of $$('[data-mode]', view)) {
    b.onclick = (e) => {
      if (e.target.closest('[data-stop]')) return;
      $$('[data-mode]', view).forEach((x) => x.classList.toggle('on', x === b));
      save({ mode: b.dataset.mode });
    };
    b.ondblclick = (e) => { if (!e.target.closest('[data-stop]')) $('#go').click(); };
  }
  $('#delay').onchange = (e) => {
    save({ delay: +e.target.value, mode: 'delayed' });
    $('[data-mode="delayed"] .t small').textContent = `${e.target.value}s`;
    $$('[data-mode]', view).forEach((x) => x.classList.toggle('on', x.dataset.mode === 'delayed'));
  };
  $$('#ftype button').forEach((b) => (b.onclick = () => { $$('#ftype button').forEach((x) => x.classList.toggle('on', x === b)); save({ fileType: b.dataset.v }); }));
  $('#annotate').onchange = (e) => save({ annotate: e.target.checked });
  $('#copyClip').onchange = (e) => save({ copy: e.target.checked });
  $('#dest').onchange = (e) => save({ destination: e.target.value });
  $('#viewAll').onclick = () => openPage('history.html?filter=image');
  $('#go').onclick = async () => {
    const mode = state.S.capture.mode;
    if (state.restricted && mode !== 'desktop') return toast('Chrome doesn’t allow capturing this page', 'xCircle');
    await send({ type: 'capture', mode, delay: state.S.capture.delay });
    window.close();
  };
  await renderRecentCaptures();
});

/** Also called when history changes; no-op when the capture view isn't showing. */
export async function renderRecentCaptures() {
  if (!$('#recent')) return;
  const items = await listItems({ kind: 'image', limit: 3 });
  const el = $('#recent');
  if (!el) return; // navigated away while loading
  const cells = items.map((it) => `
    <div class="card rc" data-id="${it.id}">
      <div class="th" data-open>${it.thumb ? `<img src="${it.thumb}" alt="">` : ''}<span class="badge">${esc((it.format || 'png').toUpperCase())}</span></div>
      <div class="meta"><div><b title="${esc(it.name)}">${esc(it.name)}</b><span>${ago(it.createdAt)}</span></div>
      <button class="icon-btn" data-more>${icon('dots')}</button></div>
    </div>`);
  while (cells.length < 3) cells.push(`<div class="card rc placeholder"><div class="th">${icon('image')}</div><div class="meta"><div><b class="muted">No capture yet</b><span>&nbsp;</span></div></div></div>`);
  el.innerHTML = cells.join('');
  for (const card of $$('.rc[data-id]', el)) {
    const it = items.find((x) => x.id === card.dataset.id);
    $('[data-open]', card).onclick = () => openViewer(it.id);
    $('[data-more]', card).onclick = (e) => itemMenu(e.currentTarget, it, renderRecentCaptures);
  }
}
