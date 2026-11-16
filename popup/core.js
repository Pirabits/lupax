// Popup shared state, DOM helpers and router. Views live in popup/views/*.js and register with `registerView`.
import { icon, hydrateIcons } from '../lib/icons.js';
import { getSettings } from '../lib/settings.js';
import { getItem, deleteItem } from '../lib/db.js';
import { esc, baseName } from '../lib/format.js';
import { copyText } from '../lib/color.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const view = $('#view');
export const send = (msg) => chrome.runtime.sendMessage(msg);

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
/** Mutable popup state shared by all views. `S` is the settings object (replaced on every save). */
export const state = {
  S: await getSettings(),
  tab,
  restricted: !tab?.url || /^(chrome|edge|about|chrome-extension|devtools|view-source):/.test(tab.url) || /chromewebstore\.google\.com|chrome\.google\.com\/webstore/.test(tab.url),
  cache: {},
};

// ───────────── feedback ─────────────

export function toast(text, ico = 'checkCircle') {
  const t = $('#toast');
  t.innerHTML = `${icon(ico)}<span>${esc(text)}</span>`;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 1600);
}
export const copy = async (text, label) => { await copyText(text); toast(`Copied ${label ?? text}`); };
export const loading = (text = 'Scanning page…') => `<div class="loading"><span class="spin"></span>${esc(text)}</div>`;

// ───────────── menu ─────────────

export function menu(anchor, items) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = items.map((it, i) =>
    it === 'hr' ? '<hr>' : it.label && !it.onClick ? `<div class="label">${esc(it.label)}</div>` :
    `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${icon(it.icon || 'chevRight')}<span>${esc(it.text)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}</button>`
  ).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  Object.assign(m.style, { left: left + 'px', top: top + 'px' });
  m.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    closeMenu();
    Promise.resolve(items[+b.dataset.i].onClick()).catch((err) => toast(err.message, 'xCircle'));
  });
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true));
}
function onDocDown(e) { if (!e.target.closest('.menu')) closeMenu(); }
export function closeMenu() { $('.menu')?.remove(); document.removeEventListener('mousedown', onDocDown, true); }

// ───────────── browser helpers ─────────────

export async function shortcutMap() {
  const out = {};
  try { for (const c of await chrome.commands.getAll()) out[c.name] = c.shortcut; } catch {}
  return out;
}

export async function inject(func) {
  if (state.restricted) throw new Error('This page can’t be inspected (browser or Web Store page).');
  const [res] = await chrome.scripting.executeScript({ target: { tabId: state.tab.id }, func });
  return res?.result;
}

export async function downloadBlob(blob, filename, saveAs = false) {
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename, saveAs, conflictAction: 'uniquify' });
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const openViewer = (id) => chrome.tabs.create({ url: chrome.runtime.getURL(`viewer.html?id=${id}`) });
export const openPage = (p) => chrome.tabs.create({ url: chrome.runtime.getURL(p) });
export const pageBase = () => baseName(state.tab?.title, state.tab?.url);

// ───────────── history items ─────────────

export const KIND_META = {
  image: { icon: 'camera', tile: '', label: 'Screenshot' },
  video: { icon: 'video', tile: 'coral', label: 'Recording' },
  file: { icon: 'layers', tile: '', label: 'Export' },
};
export function fileLabel(it) {
  if (it.kind !== 'file') return KIND_META[it.kind].label;
  return it.format === 'zip' ? 'Assets' : ['json', 'css', 'js'].includes(it.format) ? 'Styles' : 'Export';
}

async function toPng(blob) {
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}

export function itemMenu(anchor, it, after) {
  menu(anchor, [
    { icon: 'external', text: 'Open', onClick: () => openViewer(it.id) },
    { icon: 'download', text: 'Download', onClick: async () => { const full = await getItem(it.id); await downloadBlob(full.blob, `LupaX/${full.name}`); } },
    ...(it.kind === 'image' ? [{ icon: 'copy', text: 'Copy image', onClick: async () => {
      const full = await getItem(it.id);
      const png = full.preview || (full.format === 'png' ? full.blob : await toPng(full.blob));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast('Image copied');
    } }] : []),
    'hr',
    { icon: 'trash', text: 'Delete', danger: true, onClick: async () => { await deleteItem(it.id); after?.(); } },
  ]);
}

// ───────────── router ─────────────

const VIEWS = {};
const stack = [];
let current = null;
let navId = 0;

/**
 * Register a view: `render({ focus, live })`. Views await page scans, so the user may navigate away first;
 * `live()` turns false once another view has been shown, and views must check it before touching the DOM after an await.
 */
export const registerView = (name, render) => { VIEWS[name] = render; };
export const hasView = (name) => name in VIEWS;
export const currentView = () => current;

export async function go(name, { push = true, focus } = {}) {
  closeMenu();
  if (push && current && current !== name) stack.push(current);
  current = name;
  const id = ++navId;
  document.body.className = name === 'inspect' ? 'w-inspect' : name === 'assets' ? 'w-assets' : '';
  $('#back').hidden = name === 'home';
  $('#quick').hidden = name === 'inspect';
  $('#inspectPill').hidden = name !== 'inspect';
  view.innerHTML = '';
  await VIEWS[name]({ focus, live: () => id === navId });
  if (id === navId) hydrateIcons(view);
}
export const back = () => go(stack.pop() || 'home', { push: false });
export const home = () => { stack.length = 0; return go('home', { push: false }); };
