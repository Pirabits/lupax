import { icon, hydrateIcons } from '../../lib/icons.js';
import { putItem } from '../../lib/db.js';
import { esc } from '../../lib/format.js';
import { parseColor, rgbTriplet, hslTriplet, contrast, rating } from '../../lib/color.js';
import { scanStyles } from '../../lib/scan.js';
import { $, $$, view, send, state, toast, copy, menu, loading, inject, downloadBlob, pageBase, go, registerView } from '../core.js';
import { colorRoles, tokensJson, tokensCss, tokensTailwind, cssFor } from '../tokens.js';

const insState = { color: 0, type: 0, allColors: false, allTypes: false, allStyles: false };

async function exportFile(text, ext, mime, label) {
  const name = `${pageBase()}-${label}.${ext}`;
  const blob = new Blob([text], { type: mime });
  await putItem({ kind: 'file', format: ext, name, blob, title: state.tab?.title, url: state.tab?.url });
  await downloadBlob(blob, `LupaX/${name}`);
  toast(`Exported ${name}`);
}

function exportMenu(anchor, d) {
  menu(anchor, [
    { label: 'Export tokens as' },
    { icon: 'code', text: 'Design tokens (JSON)', onClick: () => exportFile(tokensJson(d), 'json', 'application/json', 'styles') },
    { icon: 'code', text: 'CSS variables', onClick: () => exportFile(tokensCss(d), 'css', 'text/css', 'tokens') },
    { icon: 'code', text: 'Tailwind theme', onClick: () => exportFile(tokensTailwind(d), 'js', 'text/javascript', 'tailwind.config') },
  ]);
}

const weightName = (w) => ({ 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' })[Math.round(+w / 100) * 100] || '';
const groupTag = (k) => ({ body: 'Body', link: 'Link', button: 'Btn', small: 'Small' })[k] || k.toUpperCase();
const firstFamily = (f) => f.split(',')[0].replace(/["']/g, '').trim();

// ───────────── header controls (Inspect Mode pill) ─────────────

async function syncInspectToggle() {
  const t = $('#inspectToggle');
  if (state.restricted) { t.disabled = true; return; }
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: state.tab.id }, func: () => !!window.__lupax?.active });
    t.checked = !!res?.result;
  } catch { t.disabled = true; }
}

$('#inspectToggle').onchange = async (e) => {
  await send({ type: 'inspect', on: e.target.checked });
  if (e.target.checked) window.close();
};
$('#inspectMenu').onclick = (e) => {
  menu(e.currentTarget, [
    { icon: 'eyedropper', text: 'Pick a color from page', onClick: async () => { await send({ type: 'pick-color' }); window.close(); } },
    { icon: 'refresh', text: 'Rescan page', onClick: () => { delete state.cache.styles; go('inspect', { push: false }); } },
    ...(state.cache.styles ? [{ icon: 'upload', text: 'Export tokens (JSON)', onClick: () => exportFile(tokensJson(state.cache.styles), 'json', 'application/json', 'styles') }] : []),
  ]);
};

// ───────────── view ─────────────

registerView('inspect', async ({ live }) => {
  syncInspectToggle();
  view.innerHTML = `
    <div class="scroll" id="insScroll">
      <h1 class="v-title">Style Inspector</h1>
      <p class="v-sub" style="max-width:480px">Explore and analyze the styles of any element — colors, typography, spacing, and reusable components.</p>
      <div class="tabs4" id="tabs">
        <button data-t="colors" class="on">${icon('palette')}Colors</button>
        <button data-t="typography">${icon('type')}Typography</button>
        <button data-t="spacing">${icon('spacing')}Spacing</button>
        <button data-t="components">${icon('layers')}Components</button>
      </div>
      <div id="insBody">${loading()}</div>
    </div>
    <div class="foot"><div class="cta cta-split">
      <button id="copyAll">${icon('sparkles')}Copy All Values</button><i></i>
      <button id="exportAll">${icon('layers')}Export Style Tokens<span class="arrow">${icon('arrowRight')}</span></button>
    </div></div>`;
  hydrateIcons(view);
  try {
    state.cache.styles ??= await inject(scanStyles);
  } catch (e) {
    if (live()) $('#insBody').innerHTML = `<div class="err-box" style="margin-top:14px">${esc(e.message)}</div>`;
    return;
  }
  if (!live()) return;
  const d = state.cache.styles;
  $('#copyAll').onclick = () => copy(tokensCss(d), 'all values as CSS variables');
  $('#exportAll').onclick = () => exportFile(tokensJson(d), 'json', 'application/json', 'styles');
  renderInspect(d);

  const scroller = $('#insScroll');
  $$('#tabs button').forEach((b) => (b.onclick = () => {
    const sec = $(`#sec-${b.dataset.t}`);
    if (sec) scroller.scrollTo({ top: sec.offsetTop - $('#tabs').offsetTop - 50, behavior: 'smooth' });
  }));
  scroller.addEventListener('scroll', () => {
    let active = 'colors';
    for (const id of ['colors', 'typography', 'spacing', 'components']) {
      const s = $(`#sec-${id}`);
      if (s && s.offsetTop - scroller.scrollTop < 220) active = id;
    }
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === active));
  });
});

function renderInspect(d) {
  const role = colorRoles(d.colors);
  const colors = d.colors;
  const groups = d.typography.groups;
  insState.color = Math.min(insState.color, Math.max(0, colors.length - 1));
  insState.type = Math.min(insState.type, Math.max(0, groups.length - 1));
  const shownColors = insState.allColors ? colors : colors.slice(0, 6);
  const shownGroups = insState.allTypes ? groups : groups.slice(0, 3);
  const sc = colors[insState.color];
  const g = groups[insState.type];
  const pc = sc && parseColor(sc.value);

  const colorDetail = sc ? (() => {
    const r = contrast(pc, '#ffffff');
    const rt = rating(r);
    return `<div class="card detail">
      <div class="top"><span class="big" style="background:${sc.value}"></span>
        <div class="grow"><b>${sc.value}</b><span class="role">${esc(role(sc.value))}</span></div>
        <button class="icon-btn sm" data-copy="${sc.value}">${icon('copy')}</button></div>
      <div class="kv"><span class="k">RGB</span><span class="v">${rgbTriplet(pc)}${pc.a < 1 ? `, ${pc.a}` : ''}</span><button class="icon-btn sm" data-copy="${pc.a < 1 ? `rgba(${rgbTriplet(pc)}, ${pc.a})` : `rgb(${rgbTriplet(pc)})`}">${icon('copy')}</button></div>
      <div class="kv"><span class="k">HSL</span><span class="v">${hslTriplet(pc)}</span><button class="icon-btn sm" data-copy="hsl(${hslTriplet(pc).replace('°', '')})">${icon('copy')}</button></div>
      <div class="kv"><span class="k">Contrast (on white)</span><span class="v" style="display:flex;align-items:center;gap:8px"><span class="aa" style="background:${sc.value}">Aa</span>${r.toFixed(2)}</span><span class="badge ${rt.cls}">${icon(rt.icon)}${rt.label}</span></div>
      <div class="kv"><span class="k">Used as</span><span class="v" style="font-weight:600;color:var(--ink-2)">${Object.entries(sc.uses).map(([k, v]) => `${k} ${v}`).join(' · ')}</span></div>
    </div>`;
  })() : '';

  const typeDetail = g ? (() => {
    const v = g.primary;
    const size = parseFloat(v.size), lh = v.lineHeight === 'normal' ? null : parseFloat(v.lineHeight);
    const large = size >= 24 || (size >= 18.66 && +v.weight >= 700);
    const rt = rating(v.contrast, large);
    return `<div class="card detail type">
      <div class="head"><b>${esc(g.name)}</b><button class="icon-btn sm" data-copy-css>${icon('copy')}</button></div>
      <div class="kv"><span class="k">Font family</span><span class="v" title="${esc(v.family)}">${esc(firstFamily(v.family))}</span></div>
      <div class="kv"><span class="k">Font size</span><span class="v">${Math.round(size * 10) / 10} px</span></div>
      <div class="kv"><span class="k">Line height</span><span class="v">${lh ? `${Math.round(lh * 10) / 10} px (${(lh / size).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')})` : 'normal'}</span></div>
      <div class="kv"><span class="k">Font weight</span><span class="v">${weightName(v.weight)} (${v.weight})</span></div>
      ${v.letterSpacing && v.letterSpacing !== 'normal' ? `<div class="kv"><span class="k">Letter spacing</span><span class="v">${v.letterSpacing}</span></div>` : ''}
      <div class="kv"><span class="k">Contrast</span><span class="v" style="display:flex;align-items:center;gap:8px"><span class="aa" style="background:${v.bg};color:${v.color};box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)">Aa</span>${v.contrast ? `${+v.contrast.toFixed(1)}:1` : '—'}</span><span class="badge ${rt.cls}">${icon(rt.icon)}${rt.label}</span></div>
    </div>`;
  })() : '';

  const maxSp = Math.max(1, ...d.spacing.scale.map((s) => s.count));
  const comps = d.components;
  // every value here comes from the scanned page (computed styles can carry quotes, e.g. data: URLs in gradients), so escape all of it
  const btnPrev = (b) => `<span class="prev" style="background:${esc(b.bg)};color:${esc(b.color)};border:${esc(b.border)};border-radius:${esc(b.radius)};padding:${esc(b.padding)};font-size:${Math.min(parseFloat(b.fontSize), 15)}px;font-weight:${esc(b.fontWeight)};font-family:${esc(b.fontFamily)};box-shadow:${esc(b.shadow)};max-height:52px">${esc(b.label)}</span>`;

  $('#insBody').innerHTML = `
    ${d.truncated ? '<p class="muted" style="margin:10px 0 0;font-size:12px">Large page: only the first 9,000 elements were scanned, so these results are partial.</p>' : ''}
    <section class="ins-sec" id="sec-colors">
      <div class="h-sec"><h3>Color Palette</h3><span class="count-pill">${colors.length}</span><span class="spacer"></span>
        <button class="btn sm" data-act="pick">${icon('eyedropper')}Pick</button>
        <button class="btn sm" data-act="export">${icon('upload')}Export Tokens</button></div>
      ${colors.length ? `<div class="split">
        <div><div class="clist">${shownColors.map((c) => `
          <button class="crow ${c === sc ? 'on' : ''}" data-ci="${colors.indexOf(c)}"><span class="sw" style="background:${c.value}"></span><span class="hex">${c.value}</span><span class="inst">${c.count} instance${c.count === 1 ? '' : 's'}</span><span class="ck">${icon('check')}</span></button>`).join('')}
        </div>${colors.length > 6 ? `<button class="viewall" data-act="allColors">${insState.allColors ? 'Show fewer' : `View all ${colors.length} colors`} ${icon('arrowRight')}</button>` : ''}</div>
        ${colorDetail}
      </div>` : '<div class="empty">No colors found.</div>'}
      <div id="pickedWrap"></div>
    </section>

    <section class="ins-sec" id="sec-typography">
      <div class="h-sec"><h3>Typography</h3><span class="count-pill">${groups.length}</span><span class="spacer"></span>
        <button class="btn sm" data-act="copyType">${icon('copy')}Copy Values</button>
        <button class="btn sm" data-act="export">${icon('upload')}Export Tokens</button></div>
      ${groups.length ? `<div class="split">
        <div><div class="clist">${shownGroups.map((x) => `
          <button class="crow ${x === g ? 'on' : ''}" data-ti="${groups.indexOf(x)}"><span class="tag">${groupTag(x.key)}</span><span class="nm"><b>${esc(x.name)}</b><span>${x.count} instance${x.count === 1 ? '' : 's'}</span></span><span class="ck">${icon('check')}</span></button>`).join('')}
        </div>${groups.length > 3 ? `<button class="viewall" data-act="allTypes">${insState.allTypes ? 'Show fewer' : `View all ${groups.length} styles`} ${icon('arrowRight')}</button>` : ''}</div>
        ${typeDetail}
      </div>` : '<div class="empty">No text found.</div>'}
      <div class="sub-h">${icon('type')}Font families</div>
      <div class="chips">${d.typography.families.slice(0, 8).map((f) => `<span class="chip" title="${f.count} text elements">${esc(f.name)} <small>${f.pct}%</small></span>`).join('')}</div>
      <div class="sub-h">${icon('list')}All text styles (${d.typography.styles.length})</div>
      <div class="clist style-list">${d.typography.styles.slice(0, insState.allStyles ? 999 : 6).map((s, i) => `
        <button class="crow" data-si="${i}" title="Click to copy CSS"><span class="tag" style="min-width:58px">${Math.round(parseFloat(s.size))}/${s.weight}</span><span class="smp" style="font-family:${esc(s.family)};font-weight:${s.weight}">${esc(s.sample)}</span><span class="inst">×${s.count}</span></button>`).join('')}</div>
      ${d.typography.styles.length > 6 ? `<button class="viewall" data-act="allStyles">${insState.allStyles ? 'Show fewer' : `View all ${d.typography.styles.length} text styles`} ${icon('arrowRight')}</button>` : ''}
    </section>

    <section class="ins-sec" id="sec-spacing">
      <div class="h-sec"><h3>Spacing</h3><span class="count-pill">${d.spacing.scale.length}</span><span class="spacer"></span><button class="btn sm" data-act="copySpacing">${icon('copy')}Copy Scale</button></div>
      <div class="split">
        <div class="scale">${d.spacing.scale.map((s) => `<div class="sr" data-copy="${s.value}px"><b>${s.value}px</b><span class="bar" style="width:${Math.max(4, (s.count / maxSp) * 100)}%"></span><span>${s.count}×</span></div>`).join('') || '<div class="empty">No spacing values</div>'}</div>
        <div>
          <div class="sub-h" style="margin-top:0">${icon('radius')}Border radius</div>
          <div class="radii">${d.spacing.radii.map((r) => `<span class="rad" data-copy="${r.value}"><i style="border-top-left-radius:${r.value.includes('%') ? '50%' : Math.min(parseFloat(r.value), 30) + 'px'}"></i>${r.value}</span>`).join('') || '<span class="muted">None</span>'}</div>
          ${d.spacing.gaps.length ? `<div class="sub-h">${icon('ruler')}Flex / grid gaps</div><div class="chips">${d.spacing.gaps.map((x) => `<span class="chip" data-copy="${x.value}px">${x.value}px <small>${x.count}×</small></span>`).join('')}</div>` : ''}
        </div>
      </div>
      ${d.spacing.shadows.length ? `<div class="sub-h">${icon('shadow')}Shadows</div><div class="shadows">${d.spacing.shadows.slice(0, 6).map((s) => `<div class="shd" style="box-shadow:${esc(s.value)}" data-copy="${esc(s.value)}" title="${esc(s.value)}">${s.count}×</div>`).join('')}</div>` : ''}
    </section>

    <section class="ins-sec" id="sec-components">
      <div class="h-sec"><h3>Components</h3><span class="count-pill">${comps.buttons.length + comps.inputs.length + comps.cards.length + comps.links.length}</span></div>
      ${comps.buttons.length ? `<div class="sub-h">${icon('button')}Buttons</div><div class="comp-grid">${comps.buttons.map((b, i) => `<div class="comp" data-comp="buttons:${i}" title="Click to copy CSS">${btnPrev(b)}<small>${b.count}× · ${esc(b.selector.slice(0, 30))}</small></div>`).join('')}</div>` : ''}
      ${comps.inputs.length ? `<div class="sub-h">${icon('input')}Inputs</div><div class="comp-grid">${comps.inputs.map((x, i) => `<div class="comp" data-comp="inputs:${i}"><span class="prev" style="background:${esc(x.bg)};color:${esc(x.color)};border:${esc(x.border)};border-radius:${esc(x.radius)};height:${Math.min(parseFloat(x.height), 44)}px;padding:0 12px;min-width:160px;justify-content:flex-start;font-size:${Math.min(parseFloat(x.fontSize), 14)}px;opacity:.85">${esc(x.placeholder)}</span><small>${x.count}× · h ${esc(x.height)}</small></div>`).join('')}</div>` : ''}
      ${comps.cards.length ? `<div class="sub-h">${icon('card')}Cards &amp; surfaces</div><div class="comp-grid">${comps.cards.map((x, i) => `<div class="comp" data-comp="cards:${i}"><span class="prev" style="width:110px;height:60px;background:${x.bg === 'transparent' ? '#fff' : esc(x.bg)};border:${esc(x.border)};border-radius:${Math.min(parseFloat(x.radius), 24)}px;box-shadow:${esc(x.shadow)}"></span><small>${x.count}× · r ${esc(x.radius)}</small></div>`).join('')}</div>` : ''}
      ${comps.links.length ? `<div class="sub-h">${icon('link')}Links</div><div class="comp-grid">${comps.links.map((x, i) => `<div class="comp" data-comp="links:${i}"><span class="prev" style="color:${esc(x.color)};text-decoration:${esc(x.decoration)};font-weight:${esc(x.fontWeight)};font-family:${esc(x.fontFamily)};font-size:13px">${esc(x.label)}</span><small>${x.count}×</small></div>`).join('')}</div>` : ''}
      ${!comps.buttons.length && !comps.inputs.length && !comps.cards.length && !comps.links.length ? '<div class="empty">No reusable components detected.</div>' : ''}
    </section>`;
  hydrateIcons($('#insBody'));
  renderPicked();

  const body = $('#insBody');
  $$('[data-ci]', body).forEach((b) => (b.onclick = () => { insState.color = +b.dataset.ci; renderInspect(d); }));
  $$('[data-ti]', body).forEach((b) => (b.onclick = () => { insState.type = +b.dataset.ti; renderInspect(d); }));
  $$('[data-si]', body).forEach((b) => (b.onclick = () => copy(cssFor(d.typography.styles[+b.dataset.si]), 'CSS')));
  $$('[data-copy]', body).forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
  $('[data-copy-css]', body)?.addEventListener('click', () => copy(cssFor(g.primary), `${g.name} CSS`));
  $$('[data-act="export"]', body).forEach((b) => (b.onclick = () => exportMenu(b, d)));
  $('[data-act="pick"]', body).onclick = async () => { await send({ type: 'pick-color' }); window.close(); };
  $('[data-act="allColors"]', body)?.addEventListener('click', () => { insState.allColors = !insState.allColors; renderInspect(d); });
  $('[data-act="allTypes"]', body)?.addEventListener('click', () => { insState.allTypes = !insState.allTypes; renderInspect(d); });
  $('[data-act="allStyles"]', body)?.addEventListener('click', () => { insState.allStyles = !insState.allStyles; renderInspect(d); });
  $('[data-act="copyType"]', body).onclick = () => copy(groups.map((x) => `/* ${x.name} */\n${cssFor(x.primary)}`).join('\n\n'), 'typography values');
  $('[data-act="copySpacing"]', body).onclick = () => copy(d.spacing.scale.map((s) => `${s.value}px`).join(', '), 'spacing scale');
  $$('[data-comp]', body).forEach((el) => (el.onclick = () => {
    const [k, i] = el.dataset.comp.split(':');
    const c = comps[k][+i];
    const css = Object.entries(c).filter(([key]) => !['count', 'label', 'selector', 'placeholder'].includes(key)).map(([key, v]) => `${key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()).replace(/^bg$/, 'background')}: ${v};`).join('\n');
    copy(`/* ${c.selector} */\n${css}`, 'component CSS');
  }));
}

/** Also called when picked colors change; no-op when the inspect view isn't showing. */
export async function renderPicked() {
  if (!$('#pickedWrap')) return;
  const { colorHistory = [] } = await chrome.storage.local.get('colorHistory');
  const wrap = $('#pickedWrap');
  if (!wrap) return;
  if (!colorHistory.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div class="sub-h">${icon('eyedropper')}Picked colors</div><div class="picked">${colorHistory.slice(0, 24).map((c) => `<button style="background:${c}" title="${c}" data-copy="${c}"></button>`).join('')}</div>`;
  $$('[data-copy]', wrap).forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
}
