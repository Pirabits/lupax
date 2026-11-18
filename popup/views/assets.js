import { icon, hydrateIcons } from '../../lib/icons.js';
import { bytes, esc } from '../../lib/format.js';
import { scanAssets, scanA11y } from '../../lib/scan.js';
import { scoreDonut } from '../../lib/donut.js';
import { safeAssetName } from '../../lib/zip.js';
import { $, $$, view, send, state, toast, copy, menu, loading, inject, pageBase, openPage, registerView, restrictedState } from '../core.js';

const aState = { type: 'all', page: 1, per: 12, selected: new Set() };
const TYPES = [
  ['all', 'All', null], ['image', 'Images', 'image'], ['svg', 'SVGs', 'code'], ['font', 'Fonts', 'font'], ['icon', 'Icons', 'cube'], ['background', 'Backgrounds', 'stack'],
];

registerView('assets', async ({ focus, live }) => {
  const { cache } = state;
  view.innerHTML = `
    <div class="two-col">
      <div class="col-l">
        <h1 class="v-title">Asset Explorer</h1>
        <p class="v-sub">Extract and manage all page assets in one place.</p>
        <div id="aBody" style="display:flex;flex-direction:column;flex:1;min-height:0">${loading('Collecting assets…')}</div>
      </div>
      <div class="col-r">
        <h1 class="v-title">Accessibility Insights</h1>
        <p class="v-sub">Key accessibility checks for this page.</p>
        <div class="scroll" id="a11yBody">${loading('Running checks…')}</div>
        <div style="padding-top:12px"><button class="cta" id="report" style="height:48px;font-size:15.5px" disabled>${icon('sparkles')}Full Report<span class="arrow">${icon('arrowRight')}</span></button></div>
      </div>
    </div>`;
  hydrateIcons(view);
  if (focus === 'a11y') $('.col-r').animate([{ background: 'rgba(122,184,245,.14)' }, { background: 'transparent' }], { duration: 1200 });
  const showErr = (sel) => (e) => { if (live()) $(sel).innerHTML = state.restricted ? restrictedState() : `<div class="err-box">${esc(e.message)}</div>`; };
  const assetsP = (cache.assets ? Promise.resolve(cache.assets) : inject(scanAssets).then((r) => (cache.assets = r)))
    .then(() => live() && renderAssets()).catch(showErr('#aBody'));
  const a11yP = (cache.a11y ? Promise.resolve(cache.a11y) : inject(scanA11y).then((r) => (cache.a11y = r)))
    .then(() => live() && renderA11y()).catch(showErr('#a11yBody'));
  await Promise.all([assetsP, a11yP]);
});

function renderAssets() {
  const all = state.cache.assets.assets;
  const counts = Object.fromEntries(TYPES.map(([k]) => [k, k === 'all' ? all.length : all.filter((a) => a.type === k).length]));
  const list = aState.type === 'all' ? all : all.filter((a) => a.type === aState.type);
  const pages = Math.max(1, Math.ceil(list.length / aState.per));
  aState.page = Math.min(aState.page, pages);
  const pageItems = list.slice((aState.page - 1) * aState.per, aState.page * aState.per);
  const totalSize = list.reduce((s, a) => s + (a.size || 0), 0);
  const allSelected = list.length && list.every((a) => aState.selected.has(a.url));
  // a selection spans every category: exporting from another filter must not drop it
  const toExport = aState.selected.size ? all.filter((a) => aState.selected.has(a.url)) : list;

  const pageBtns = [];
  const addPg = (p) => pageBtns.push(`<button class="pg ${p === aState.page ? 'on' : ''}" data-pg="${p}">${p}</button>`);
  if (pages <= 6) for (let p = 1; p <= pages; p++) addPg(p);
  else {
    const set = new Set([1, 2, 3, aState.page - 1, aState.page, aState.page + 1, pages].filter((p) => p >= 1 && p <= pages));
    let prev = 0;
    for (const p of [...set].sort((a, b) => a - b)) { if (p - prev > 1) pageBtns.push('<span class="pg" style="display:grid;place-items:center">…</span>'); addPg(p); prev = p; }
  }

  $('#aBody').innerHTML = `
    <div class="chips">${TYPES.map(([k, l, ic]) => `<button class="chip ${aState.type === k ? 'on' : ''}" data-type="${k}">${ic ? icon(ic) : ''}${l} <small>${counts[k]}</small></button>`).join('')}</div>
    <div class="sel-row">
      <label><input type="checkbox" class="cb" id="selAll" ${allSelected ? 'checked' : ''}/>${aState.selected.size ? `${aState.selected.size} selected` : 'Select all'}</label>
      <span class="spacer"></span>
      <span class="sum">${list.length} assets • ${bytes(totalSize)}</span>
      <button class="btn primary" id="zip" ${toExport.length ? '' : 'disabled'}>${icon('download')}Export ZIP</button>
    </div>
    ${state.cache.assets.truncated ? '<p class="muted" style="margin:0 0 8px;font-size:12px">Large page: only the first 9,000 elements were scanned for background images, so some assets may be missing.</p>' : ''}
    <div class="agrid" id="agrid">${pageItems.map((a, i) => assetCard(a, i)).join('') || '<div class="empty" style="grid-column:1/-1">No assets in this category.</div>'}</div>
    <div class="pager">
      <button class="pg nav" data-pg="${aState.page - 1}" ${aState.page <= 1 ? 'disabled' : ''}>${icon('chevLeft')}</button>
      ${pageBtns.join('')}
      <button class="pg nav" data-pg="${aState.page + 1}" ${aState.page >= pages ? 'disabled' : ''}>${icon('chevRight')}</button>
      <span class="spacer"></span>
      <span class="select"><select id="per">${[8, 12, 24, 48].map((n) => `<option value="${n}" ${aState.per === n ? 'selected' : ''}>${n} per page</option>`).join('')}</select>${icon('chevDown')}</span>
    </div>`;
  hydrateIcons($('#aBody'));

  $$('[data-type]').forEach((b) => (b.onclick = () => { aState.type = b.dataset.type; aState.page = 1; renderAssets(); }));
  $$('[data-pg]').forEach((b) => (b.onclick = () => { aState.page = +b.dataset.pg; renderAssets(); $('#agrid').scrollTop = 0; }));
  $('#per').onchange = (e) => { aState.per = +e.target.value; aState.page = 1; renderAssets(); };
  $('#selAll').onchange = (e) => { for (const a of list) e.target.checked ? aState.selected.add(a.url) : aState.selected.delete(a.url); renderAssets(); };
  $('#zip').onclick = () => exportZip(toExport);
  for (const card of $$('.acard')) {
    const a = pageItems[+card.dataset.i];
    $('.cb', card).onchange = (e) => { e.target.checked ? aState.selected.add(a.url) : aState.selected.delete(a.url); renderAssets(); };
    $('.th', card).onclick = () => (a.url.startsWith('data:') ? null : chrome.tabs.create({ url: a.url, active: false }));
    $('[data-more]', card).onclick = (e) => menu(e.currentTarget, [
      { icon: 'download', text: 'Download', onClick: () => downloadAsset(a) },
      { icon: 'link', text: 'Copy URL', onClick: () => copy(a.url, 'URL') },
      ...(a.url.startsWith('data:') ? [] : [{ icon: 'external', text: 'Open in new tab', onClick: () => chrome.tabs.create({ url: a.url }) }]),
    ]);
  }
  loadFontPreviews(pageItems);
  fillSizes(pageItems);
}

function assetCard(a, i) {
  const fmt = (a.format || a.type).slice(0, 5);
  let thumb;
  if (a.type === 'font') thumb = `<span class="aa" data-font="${esc(a.url)}">Aa</span>`;
  else {
    const raster = a.type === 'image' || a.type === 'background';
    thumb = `<img src="${esc(a.url)}" alt="" loading="lazy" class="${raster && !/svg|png|gif|webp|ico/.test(a.format) ? 'cover' : ''}" referrerpolicy="no-referrer">`;
  }
  const checker = a.type !== 'font' && !(a.format === 'jpg' || a.format === 'jpeg');
  return `<div class="card acard ${aState.selected.has(a.url) ? 'sel' : ''}" data-i="${i}">
    <input type="checkbox" class="cb" ${aState.selected.has(a.url) ? 'checked' : ''} />
    <div class="th ${checker ? 'checker' : ''}" title="${esc(a.url.startsWith('data:') ? a.name : a.url)}" style="${a.type === 'font' ? 'background:var(--surface-2)' : ''}">${thumb}</div>
    <div class="inf"><b title="${esc(a.family || safeAssetName(a))}">${esc(safeAssetName(a))}</b>
      <div class="row"><span class="badge">${esc(fmt)}</span><span data-size="${esc(a.url)}">${a.size ? bytes(a.size) : a.w ? `${a.w}×${a.h}` : '—'}</span></div></div>
    <button class="icon-btn" data-more>${icon('dots')}</button>
  </div>`;
}

async function loadFontPreviews(items) {
  for (const a of items.filter((x) => x.type === 'font')) {
    try {
      const buf = await (await fetch(a.url, { credentials: 'omit' })).arrayBuffer();
      if (!a.size) a.size = buf.byteLength;
      const fam = `ixf-${Math.abs([...a.url].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7))}`;
      const ff = new FontFace(fam, buf);
      await ff.load();
      document.fonts.add(ff);
      for (const el of $$(`[data-font="${CSS.escape(a.url)}"]`)) el.style.fontFamily = `"${fam}"`;
      for (const el of $$(`[data-size="${CSS.escape(a.url)}"]`)) el.textContent = bytes(a.size);
    } catch { /* blocked or unsupported */ }
  }
}

async function fillSizes(items) {
  const todo = items.filter((a) => !a.size && /^https?:/.test(a.url));
  let changed = false;
  await Promise.all(todo.map(async (a) => {
    try {
      const res = await fetch(a.url, { method: 'HEAD', credentials: 'omit' });
      const len = +res.headers.get('content-length');
      if (len) { a.size = len; changed = true; for (const el of $$(`[data-size="${CSS.escape(a.url)}"]`)) el.textContent = bytes(len); }
    } catch {}
  }));
  const sum = $('.sel-row .sum');
  if (changed && sum) {
    const all = state.cache.assets.assets;
    const list = aState.type === 'all' ? all : all.filter((x) => x.type === aState.type);
    sum.textContent = `${list.length} assets • ${bytes(list.reduce((s, x) => s + (x.size || 0), 0))}`;
  }
}

async function downloadAsset(a) {
  const name = safeAssetName(a);
  await chrome.downloads.download({ url: a.url, filename: `LupaX/${pageBase()}/${name}`, conflictAction: 'uniquify' });
  toast(`Downloading ${name}`);
}

/** The site patterns an export needs access to: LupaX only has access to the tab it was opened on. */
const exportOrigins = (items) => [...new Set(items.filter((a) => /^https?:/i.test(a.url)).map((a) => `${new URL(a.url).origin}/*`))];

/** The background builds the ZIP so the export survives the popup closing. */
async function exportZip(items) {
  const btn = $('#zip');
  btn.disabled = true;
  btn.innerHTML = `${icon('download')}Exporting…`;
  const origins = exportOrigins(items);
  // nothing is awaited before the prompt: Chrome only shows it during the click. The popup may close while the
  // prompt is open, so the worker starts now and watches for the grant itself.
  const started = send({
    type: 'export-zip',
    assets: items.map(({ url, name, type, format }) => ({ url, name, type, format })),
    title: state.tab?.title, url: state.tab?.url, origins,
  });
  const access = origins.length ? chrome.permissions.request({ origins }).catch(() => false) : true;
  await started;
  toast(`Exporting ${items.length} assets — you can close this popup`);
  if (!(await access)) send({ type: 'access-denied' });
}

function renderA11y() {
  const r = state.cache.a11y;
  const failing = r.checks.filter((c) => c.failed).sort((a, b) => (a.severity === b.severity ? b.failed - a.failed : a.severity === 'issue' ? -1 : 1));
  $('#a11yBody').innerHTML = `
    <div class="card score">
      ${scoreDonut(r.score, { size: 118, r: 47, stroke: 11 })}
      <div class="stats">
        <div class="stat g">${icon('checkCircle')}<span>Passed</span><b>${r.passed}</b></div>
        <div class="stat r">${icon('xCircle')}<span>Issues</span><b>${r.issues}</b></div>
        <div class="stat y">${icon('alert')}<span>Warnings</span><b>${r.warnings}</b></div>
      </div>
    </div>
    ${r.truncated ? '<p class="muted" style="margin:0 0 8px;font-size:12px">Large page: contrast and readability checked the first 9,000 elements only.</p>' : ''}
    ${failing.length ? failing.map((c) => `
      <button class="card hover issue ${c.severity === 'issue' ? 'issue-r' : 'issue-y'}" data-check="${c.id}">
        ${icon(c.severity === 'issue' ? 'xCircle' : 'alert')}
        <span class="txt"><b>${esc(c.title)}</b><span>${esc(c.summary)}</span></span>${icon('chevRight', 'chev')}
      </button>`).join('') : `<div class="card ok-box">${icon('checkCircle')}No issues found by automated checks.</div>`}`;
  hydrateIcons($('#a11yBody'));
  $$('[data-check]').forEach((b) => (b.onclick = () => openPage(`report.html?tab=${state.tab.id}&focus=${b.dataset.check}`)));
  const rep = $('#report');
  rep.disabled = false;
  rep.onclick = () => openPage(`report.html?tab=${state.tab.id}`);
}
