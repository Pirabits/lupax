import { icon, hydrateIcons } from './lib/icons.js';
import { listItems, deleteItem, getItem } from './lib/db.js';
import { bytes, ago, esc } from './lib/format.js';

hydrateIcons();
const $ = (s) => document.querySelector(s);
const FILTERS = [['all', 'All', null], ['image', 'Screenshots', 'camera'], ['video', 'Recordings', 'video'], ['file', 'Exports', 'layers']];
let filter = new URLSearchParams(location.search).get('filter') || 'all';
let items = [];

function toast(t, ic = 'checkCircle') {
  const el = $('#toast');
  el.innerHTML = `${icon(ic)}<span>${esc(t)}</span>`;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1600);
}

async function load() {
  items = await listItems();
  render();
}

function render() {
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, k === 'all' ? items.length : items.filter((i) => i.kind === k).length]));
  $('#filters').innerHTML = FILTERS.map(([k, l, ic]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${ic ? icon(ic) : ''}${l} <small>${counts[k]}</small></button>`).join('');
  for (const b of document.querySelectorAll('[data-f]')) b.onclick = () => { filter = b.dataset.f; history.replaceState(null, '', `?filter=${filter}`); render(); };
  const q = $('#q').value.trim().toLowerCase();
  const list = items.filter((i) => (filter === 'all' || i.kind === filter) && (!q || `${i.name} ${i.title || ''} ${i.url || ''}`.toLowerCase().includes(q)));
  if (!list.length) {
    $('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1">Nothing here yet. Capture a screenshot or start a recording from the LupaX toolbar button.</div>`;
    return;
  }
  $('#grid').innerHTML = list.map((it) => `
    <div class="card item" data-id="${it.id}">
      <div class="th" data-open>
        ${it.thumb ? `<img src="${it.thumb}" alt="">` : icon(it.kind === 'video' ? 'video' : it.format === 'zip' ? 'zip' : it.kind === 'file' ? 'layers' : 'image')}
        ${it.kind === 'video' ? `<div class="play"><span>${icon('play')}</span></div>` : ''}
        <span class="badge">${esc((it.format || '').toUpperCase())}</span>
      </div>
      <div class="meta"><div><b title="${esc(it.name)}">${esc(it.name)}</b><span>${ago(it.createdAt)} · ${bytes(it.size)}</span></div>
        <button class="icon-btn sm" data-dl title="Download">${icon('download')}</button>
        <button class="icon-btn sm" data-del title="Delete">${icon('trash')}</button></div>
    </div>`).join('');
  for (const card of document.querySelectorAll('.item')) {
    const id = card.dataset.id;
    card.querySelector('[data-open]').onclick = () => chrome.tabs.create({ url: `viewer.html?id=${id}` });
    card.querySelector('[data-dl]').onclick = async () => {
      const it = await getItem(id);
      // pruned or deleted from another tab since this list was drawn
      if (!it?.blob) { toast('This item is no longer in history', 'alert'); load(); return; }
      const url = URL.createObjectURL(it.blob);
      try {
        await chrome.downloads.download({ url, filename: `LupaX/${it.name}`, conflictAction: 'uniquify' });
        toast(`Downloading ${it.name}`);
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 60_000); // the download reads the blob after download() resolves
      }
    };
    card.querySelector('[data-del]').onclick = async () => {
      // the trash icon sits right next to Download: ask first
      if (!confirm(`Delete “${items.find((x) => x.id === id)?.name || 'this capture'}”? This can’t be undone.`)) return;
      await deleteItem(id); items = items.filter((x) => x.id !== id); render();
    };
  }
}

$('#q').oninput = render;
chrome.storage.local.onChanged.addListener((c) => c.historyRev && load());
load();
