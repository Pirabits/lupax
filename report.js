import { icon, hydrateIcons } from './lib/icons.js';
import { scanA11y, highlightOnPage } from './lib/scan.js';
import { esc, baseName } from './lib/format.js';
import { putItem } from './lib/db.js';
import { scoreDonut } from './lib/donut.js';

hydrateIcons();
const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
const tabId = +q.get('tab');
const focus = q.get('focus');
let result = null;

const TIPS = {
  contrast: 'Increase the difference between text and background colors. Normal text needs 4.5:1, large text (24px or 18.66px bold) needs 3:1.',
  readability: 'Use at least 12px (ideally 16px) for body text and a line height around 1.5 for long passages.',
  alt: 'Add an alt attribute describing the image. Decorative images should use alt="".',
  labels: 'Associate each field with a <label for>, wrap it in a <label>, or add aria-label. Placeholders are not labels.',
  names: 'Give icon-only buttons and links an aria-label, or include visually hidden text.',
  document: 'Set <html lang="…"> and a descriptive <title> so assistive tech announces the page correctly.',
  zoom: 'Remove user-scalable=no and maximum-scale limits from the viewport meta tag.',
  headings: 'Use one <h1> and don’t skip heading levels (h2 → h4).',
  ids: 'Each id must be unique on the page, or labels and ARIA references break.',
};

function toast(t) {
  const el = $('#toast');
  el.innerHTML = `${icon('checkCircle')}<span>${esc(t)}</span>`;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1600);
}

async function run() {
  $('#root').innerHTML = '<div class="empty">Running checks…</div>';
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: scanA11y });
    result = res.result;
  } catch (e) {
    $('#root').innerHTML = `<div class="card summary"><h2>Can’t scan this tab</h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  render();
}

function render() {
  const r = result;
  const checks = [...r.checks].sort((a, b) => (b.failed > 0) - (a.failed > 0) || (a.severity === 'issue' ? -1 : 1) || b.failed - a.failed);
  $('#root').innerHTML = `
    <div class="hero">
      <div class="card score">
        ${scoreDonut(r.score)}
        <div class="stats">
          <div class="stat"><span class="is-g">${icon('checkCircle')}</span><span>Passed</span><b>${r.passed}</b></div>
          <div class="stat"><span class="is-r">${icon('xCircle')}</span><span>Issues</span><b>${r.issues}</b></div>
          <div class="stat"><span class="is-y">${icon('alert')}</span><span>Warnings</span><b>${r.warnings}</b></div>
        </div>
      </div>
      <div class="card summary">
        <h2>${esc(r.title || 'Untitled page')}</h2>
        <p><a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.url)}</a></p>
        <p>${r.issues ? `${r.issues} issue${r.issues === 1 ? '' : 's'} block some users.` : 'No blocking issues found by automated checks.'} ${r.warnings ? `${r.warnings} warning${r.warnings === 1 ? '' : 's'} worth reviewing.` : ''}</p>
        ${r.truncated ? '<p style="font-size:12.5px">Large page: contrast and readability checked the first 9,000 elements only.</p>' : ''}
        <p style="font-size:12.5px">Click <b>Show</b> on any row to scroll to and highlight the element in the page.</p>
      </div>
    </div>
    ${checks.map((c) => `
      <details class="card check" id="c-${c.id}" ${c.id === focus || (!focus && c.failed && c.severity === 'issue') ? 'open' : ''}>
        <summary>
          <span class="${!c.failed ? 'is-g' : c.severity === 'issue' ? 'is-r' : 'is-y'}">${icon(!c.failed ? 'checkCircle' : c.severity === 'issue' ? 'xCircle' : 'alert')}</span>
          <span class="ttl"><b>${esc(c.title)}</b><span>${c.failed ? esc(c.summary) : `All ${c.passed} checks passed`}</span></span>
          <span class="badge">${c.passed} passed · ${c.failed} failed</span>
          ${icon('chevRight', 'chev')}
        </summary>
        ${c.failed ? `<div class="tip">${esc(TIPS[c.id] || '')}</div><div class="rows">${c.items.map((it, i) => `
          <div class="r"><code title="${esc(it.selector)}">${esc(it.selector || it.label)}</code>
            <div class="d"><b>${esc(it.detail)}</b>${it.text ? `<span>“${esc(it.text)}”</span>` : ''}</div>
            ${it.selector ? `<button class="btn sm" data-hl="${c.id}:${i}">${icon('eye')}Show</button>` : '<span></span>'}</div>`).join('')}
          ${c.failed > c.items.length ? `<div class="r"><span class="muted">+ ${c.failed - c.items.length} more</span></div>` : ''}</div>` : ''}
      </details>`).join('')}`;
  hydrateIcons($('#root'));
  for (const b of document.querySelectorAll('[data-hl]')) {
    b.onclick = async () => {
      const [cid, i] = b.dataset.hl.split(':');
      const it = result.checks.find((c) => c.id === cid).items[+i];
      await chrome.tabs.update(tabId, { active: true });
      const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: highlightOnPage, args: [it.selector, `${it.label} · ${it.detail}`.slice(0, 80)] });
      if (!res?.result) toast('Element not found — the page may have changed');
    };
  }
  if (focus) $(`#c-${focus}`)?.scrollIntoView({ block: 'start' });
}

$('#rescan').onclick = run;
$('#export').onclick = async () => {
  if (!result) return;
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  const name = `${baseName(result.title, result.url)}-accessibility.json`;
  await putItem({ kind: 'file', format: 'json', name, blob, title: result.title, url: result.url });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename: `LupaX/${name}`, conflictAction: 'uniquify' });
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  toast(`Exported ${name}`);
};
run();
