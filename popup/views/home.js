import { icon } from '../../lib/icons.js';
import { listItems } from '../../lib/db.js';
import { ago, esc } from '../../lib/format.js';
import { $, $$, view, send, state, toast, go, openPage, openViewer, itemMenu, KIND_META, fileLabel, registerView } from '../core.js';

registerView('home', async () => {
  const feat = (goTo, ic, title, desc, tile = '') => `
    <button class="card hover feat" data-go="${goTo}">
      <span class="tile ${tile}">${icon(ic)}</span>
      <span><div class="t">${title}</div><div class="d">${desc}</div></span>
      ${icon('chevRight', 'chev')}
    </button>`;
  view.innerHTML = `
    <div class="scroll">
      <h1 class="v-title">All-in-one web inspector</h1>
      <p class="v-sub">Capture, analyze, extract, and ensure accessibility — right from your browser.</p>
      <div class="feat-grid">
        ${feat('capture', 'camera', 'Capture<br>Screenshot', 'Grab any part of the page')}
        ${feat('record', 'video', 'Record<br>Video', 'Record screen, tab, or app', 'coral')}
        ${feat('inspect', 'layers', 'Inspect<br>Styles', 'Explore colors, typography, spacing, and more')}
        ${feat('assets', 'image', 'Extract<br>Assets', 'Download images, SVGs, fonts, and other resources', 'coral')}
        <button class="card hover feat wide" data-go="assets" data-focus="a11y">
          <span class="tile">${icon('shield')}</span>
          <span><div class="t">Accessibility Scan</div><div class="d">Check contrast, color, and accessibility issues</div></span>
          ${icon('chevRight', 'chev')}
        </button>
      </div>
      <hr class="div" />
      <div class="h-sec"><h3>Recent Activity</h3><span class="spacer"></span><button class="more" id="viewAll">View All ${icon('chevRight')}</button></div>
      <div class="act-list" id="acts"></div>
    </div>
    <div class="foot"><button class="cta" id="startInspect">${icon('sparkles')}Start Inspecting<span class="arrow">${icon('arrowRight')}</span></button></div>`;
  $$('[data-go]', view).forEach((b) => (b.onclick = () => go(b.dataset.go, { focus: b.dataset.focus })));
  $('#viewAll').onclick = () => openPage('history.html');
  $('#startInspect').onclick = async () => {
    if (state.restricted) return toast('This page can’t be inspected', 'xCircle');
    await send({ type: 'inspect', on: true });
    window.close();
  };
  await renderActivity();
});

/** Also called when history changes; no-op when the home view isn't showing. */
export async function renderActivity() {
  if (!$('#acts')) return;
  const items = await listItems({ limit: 3 });
  const el = $('#acts');
  if (!el) return; // navigated away while loading
  if (!items.length) {
    el.innerHTML = `<div class="empty" style="padding:14px 0">Your screenshots, recordings and exports will appear here.</div>`;
    return;
  }
  el.innerHTML = items.map((it) => {
    const m = KIND_META[it.kind] || KIND_META.file;
    return `<div class="act" data-id="${it.id}">
      <span class="tile sm ${m.tile}">${icon(m.icon)}</span>
      <div class="info" data-open><b>${esc(it.name)}</b><span>${fileLabel(it)} · ${ago(it.createdAt)}</span></div>
      <button class="icon-btn" data-open title="Open">${icon('external')}</button>
      <button class="icon-btn" data-more title="More">${icon('dots')}</button>
    </div>`;
  }).join('');
  for (const row of $$('.act', el)) {
    const it = items.find((x) => x.id === row.dataset.id);
    $$('[data-open]', row).forEach((b) => (b.onclick = () => openViewer(it.id)));
    $('[data-more]', row).onclick = (e) => itemMenu(e.currentTarget, it, renderActivity);
  }
}
