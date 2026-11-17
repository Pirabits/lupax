import { icon, hydrateIcons } from './lib/icons.js';
import { getItem, putItem, updateItem, deleteItem } from './lib/db.js';
import { getSettings } from './lib/settings.js';
import { bytes, esc } from './lib/format.js';
import { thumbnail } from './lib/thumb.js';
import { imageBlobToPdf } from './lib/pdf.js';

hydrateIcons();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const id = new URLSearchParams(location.search).get('id');
let item = id ? await getItem(id) : null;
const S = (await getSettings()).capture;

function toast(text, ico = 'checkCircle', ms = 1800) {
  const t = $('#toast');
  t.innerHTML = `${icon(ico)}<span>${esc(text)}</span>`;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), ms);
}

// set by the service worker when a recording was cut short (see stoppedEarlyNotice in lib/record-sink.js)
const notice = new URLSearchParams(location.search).get('notice');
if (notice) toast(notice, 'alert', 10_000);

async function download(blob, name, saveAs = false) {
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename: `LupaX/${name}`, saveAs, conflictAction: 'uniquify' });
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function actionBtn(html, cls, onClick) {
  const b = document.createElement('button');
  b.className = `btn ${cls || ''}`;
  b.innerHTML = html;
  b.onclick = () => Promise.resolve(onClick(b)).catch((e) => toast(e.message, 'xCircle'));
  $('#actions').appendChild(b);
  return b;
}

if (!item) {
  $('#stage').innerHTML = '<div class="card file-card"><span class="tile">' + icon('image') + '</span><b>This capture is no longer available.</b><a class="btn" href="history.html">See all captures</a></div>';
} else {
  $('#title').textContent = item.name || item.title || 'Capture';
  document.title = `${item.name} · LupaX`;
  if (item.url) { $('#src').textContent = item.url; $('#src').href = item.url; }
  if (item.kind === 'image') await imageEditor();
  else if (item.kind === 'video') videoView();
  else await fileView();
}

// ───────────────────────────── video / files ─────────────────────────────

function videoView() {
  const v = document.createElement('video');
  v.className = 'media';
  v.controls = true;
  v.src = URL.createObjectURL(item.blob);
  v.onloadedmetadata = () => { $('#dims').textContent = `${v.videoWidth}×${v.videoHeight} · ${bytes(item.blob.size)}`; };
  $('#stage').appendChild(v);
  actionBtn(`${icon('download')}Download WebM`, 'primary', () => download(item.blob, item.name));
  actionBtn(`${icon('trash')}Delete`, 'danger', () => confirmDelete());
}

async function confirmDelete() {
  if (!confirm(`Delete “${item.name}”? This can’t be undone.`)) return;
  await deleteItem(id);
  window.close();
}

async function fileView() {
  $('#dims').textContent = `${(item.format || 'file').toUpperCase()} · ${bytes(item.blob.size)}`;
  if (['json', 'css', 'js', 'txt'].includes(item.format)) {
    const pre = document.createElement('pre');
    pre.className = 'code';
    pre.textContent = await item.blob.text();
    $('#stage').appendChild(pre);
    actionBtn(`${icon('copy')}Copy`, '', async () => { await navigator.clipboard.writeText(pre.textContent); toast('Copied to clipboard'); });
  } else {
    $('#stage').innerHTML = `<div class="card file-card"><span class="tile">${icon(item.format === 'zip' ? 'zip' : 'layers')}</span><b>${esc(item.name)}</b><span class="muted">${bytes(item.blob.size)}</span></div>`;
  }
  actionBtn(`${icon('download')}Download`, 'primary', () => download(item.blob, item.name));
  actionBtn(`${icon('trash')}Delete`, 'danger', () => confirmDelete());
}

// ───────────────────────────── image editor ─────────────────────────────

async function imageEditor() {
  const src = item.preview || item.blob;
  const base = await createImageBitmap(src);
  const W = base.width, H = base.height;
  const K = Math.max(1, W / 1300); // stroke scale for hi-dpi captures
  $('#dims').textContent = `${W} × ${H}px`;

  if (item.pending) {
    $('#banner').innerHTML = `<div class="banner">${icon('pen')}Annotate your capture, then press Save — exports as ${S.fileType.toUpperCase()}${S.destination === 'none' ? '' : S.destination === 'ask' ? ' (you’ll pick a folder)' : ' to Downloads'}.</div>`;
  }

  const TOOLS = [
    ['move', 'move', 'Select & move (V)', 'v'], ['pen', 'pen', 'Pen (P)', 'p'], ['highlight', 'highlighter', 'Highlighter (H)', 'h'],
    ['arrow', 'arrowTool', 'Arrow (A)', 'a'], ['line', 'line', 'Line (L)', 'l'], ['rect', 'rect', 'Rectangle (R)', 'r'],
    ['ellipse', 'ellipse', 'Ellipse (O)', 'o'], ['text', 'text', 'Text (T)', 't'], ['blur', 'blur', 'Blur / pixelate (B)', 'b'], ['crop', 'crop', 'Crop (C)', 'c'],
  ];
  const COLORS = ['#4A9DF0', '#FF4D4F', '#FF8A00', '#FFD60A', '#16A34A', '#0EA5E9', '#061230', '#FFFFFF'];
  const SIZES = [2, 4, 8];
  const st = { tool: 'arrow', color: COLORS[1], size: 4, shapes: [], crop: null, sel: -1 };
  const undo = [], redo = [];
  const snap = () => JSON.stringify({ shapes: st.shapes, crop: st.crop });
  const commit = () => { undo.push(snap()); redo.length = 0; syncUndo(); };
  // annotations not yet saved: warn before the tab closes (Delete closes on purpose, so it clears this)
  let savedSnap = snap();
  const dirty = () => snap() !== savedSnap;
  window.addEventListener('beforeunload', (e) => { if (dirty()) e.preventDefault(); });

  $('#toolbar').innerHTML = `<div class="toolbar">
    ${TOOLS.map(([t, ic, tip]) => `<button class="tool ${st.tool === t ? 'on' : ''}" data-tool="${t}" title="${tip}">${icon(ic)}</button>`).join('')}
    <span class="sep"></span>
    <div class="colors">${COLORS.map((c) => `<button data-color="${c}" class="${c === st.color ? 'on' : ''}" style="background:${c}" title="${c}"></button>`).join('')}</div>
    <span class="sep"></span>
    <div class="sizes">${SIZES.map((s) => `<button data-size="${s}" class="${s === st.size ? 'on' : ''}" title="Stroke ${s}"><i style="width:${s + 4}px;height:${s + 4}px"></i></button>`).join('')}</div>
    <span class="sep"></span>
    <button class="tool" id="undo" title="Undo (⌘Z)">${icon('undo')}</button>
    <button class="tool" id="redo" title="Redo (⇧⌘Z)">${icon('redo')}</button>
    <button class="tool" id="clear" title="Clear annotations">${icon('trash')}</button>
  </div>`;

  const wrap = document.createElement('div');
  wrap.className = 'canvas-wrap checker';
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  wrap.appendChild(cv);
  $('#stage').appendChild(wrap);
  const ctx = cv.getContext('2d');

  function syncUndo() { $('#undo').disabled = !undo.length; $('#redo').disabled = !redo.length; }
  syncUndo();

  // ── drawing ──
  function arrowHead(c, x1, y1, x2, y2, w) {
    const a = Math.atan2(y2 - y1, x2 - x1), L = Math.max(14, w * 4.5);
    c.beginPath();
    c.moveTo(x2, y2);
    c.lineTo(x2 - L * Math.cos(a - 0.45), y2 - L * Math.sin(a - 0.45));
    c.lineTo(x2 - L * Math.cos(a + 0.45), y2 - L * Math.sin(a + 0.45));
    c.closePath();
    c.fill();
  }
  function drawShape(c, s) {
    const w = s.size * K;
    c.save();
    c.strokeStyle = c.fillStyle = s.color;
    c.lineWidth = w;
    c.lineCap = c.lineJoin = 'round';
    const { x1, y1, x2, y2 } = s;
    switch (s.type) {
      case 'pen': case 'highlight':
        if (s.type === 'highlight') { c.globalAlpha = 0.35; c.lineWidth = w * 4; c.lineCap = 'butt'; }
        c.beginPath();
        s.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.stroke();
        break;
      case 'line': c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); break;
      case 'arrow': {
        const a = Math.atan2(y2 - y1, x2 - x1), L = Math.max(14, w * 4.5) * 0.8;
        c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2 - L * Math.cos(a), y2 - L * Math.sin(a)); c.stroke();
        arrowHead(c, x1, y1, x2, y2, w);
        break;
      }
      case 'rect': c.beginPath(); c.roundRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1), 4 * K); c.stroke(); break;
      case 'ellipse': c.beginPath(); c.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2); c.stroke(); break;
      case 'blur': {
        const x = Math.min(x1, x2), y = Math.min(y1, y2), bw = Math.abs(x2 - x1), bh = Math.abs(y2 - y1);
        if (bw < 2 || bh < 2) break;
        const px = Math.max(6, Math.round(10 * K));
        const t = new OffscreenCanvas(Math.max(1, Math.round(bw / px)), Math.max(1, Math.round(bh / px)));
        t.getContext('2d').drawImage(base, x, y, bw, bh, 0, 0, t.width, t.height);
        c.imageSmoothingEnabled = false;
        c.drawImage(t, 0, 0, t.width, t.height, x, y, bw, bh);
        break;
      }
      case 'text': {
        const fs = (14 + s.size * 3) * K;
        c.font = `700 ${fs}px Jakarta, system-ui, sans-serif`;
        c.textBaseline = 'top';
        const lines = s.text.split('\n');
        if (s.color === '#FFFFFF') { c.strokeStyle = '#061230'; c.lineWidth = fs / 6; lines.forEach((ln, i) => c.strokeText(ln, x1, y1 + i * fs * 1.2)); }
        else { c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = fs / 7; lines.forEach((ln, i) => c.strokeText(ln, x1, y1 + i * fs * 1.2)); }
        lines.forEach((ln, i) => c.fillText(ln, x1, y1 + i * fs * 1.2));
        s.w = Math.max(...lines.map((ln) => c.measureText(ln).width));
        s.h = lines.length * fs * 1.2;
        break;
      }
    }
    c.restore();
  }
  function bounds(s) {
    if (s.type === 'pen' || s.type === 'highlight') {
      const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    if (s.type === 'text') return { x: s.x1, y: s.y1, w: s.w || 50, h: s.h || 20 };
    return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
  }
  function render(forExport = false) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0);
    for (const s of st.shapes) drawShape(ctx, s);
    if (forExport) return;
    if (st.sel >= 0 && st.shapes[st.sel]) {
      const b = bounds(st.shapes[st.sel]), p = 6 * K;
      ctx.save(); ctx.setLineDash([6 * K, 4 * K]); ctx.strokeStyle = '#4a9df0'; ctx.lineWidth = 1.5 * K;
      ctx.strokeRect(b.x - p, b.y - p, b.w + p * 2, b.h + p * 2); ctx.restore();
    }
    if (st.crop) {
      const c = norm(st.crop);
      ctx.save();
      ctx.fillStyle = 'rgba(6,18,48,.55)';
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(c.x, c.y, c.w, c.h); ctx.fill('evenodd');
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * K; ctx.setLineDash([8 * K, 6 * K]); ctx.strokeRect(c.x, c.y, c.w, c.h);
      ctx.restore();
    }
  }
  const norm = (r) => ({ x: Math.min(r.x1, r.x2), y: Math.min(r.y1, r.y2), w: Math.abs(r.x2 - r.x1), h: Math.abs(r.y2 - r.y1) });
  render();

  // ── pointer ──
  const toImg = (e) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
  let drag = null;
  const clampX = (x) => Math.max(0, Math.min(W, x)), clampY = (y) => Math.max(0, Math.min(H, y));
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const p = toImg(e);
    cv.setPointerCapture(e.pointerId);
    if (st.tool === 'text') return startText(p, e);
    if (st.tool === 'move') {
      const pad = 8 * K;
      st.sel = -1;
      for (let i = st.shapes.length - 1; i >= 0; i--) {
        const b = bounds(st.shapes[i]);
        if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) { st.sel = i; break; }
      }
      if (st.sel >= 0) { commit(); drag = { kind: 'move', last: p }; }
      render();
      return;
    }
    if (st.tool === 'crop') { commit(); st.crop = { x1: clampX(p.x), y1: clampY(p.y), x2: clampX(p.x), y2: clampY(p.y) }; drag = { kind: 'crop' }; return; }
    commit();
    const s = { type: st.tool, color: st.color, size: st.size, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    if (st.tool === 'pen' || st.tool === 'highlight') s.pts = [[p.x, p.y]];
    st.shapes.push(s);
    drag = { kind: 'draw', s };
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toImg(e);
    if (drag.kind === 'move') {
      const s = st.shapes[st.sel], dx = p.x - drag.last.x, dy = p.y - drag.last.y;
      if (s.pts) s.pts = s.pts.map(([x, y]) => [x + dx, y + dy]);
      s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy;
      drag.last = p;
    } else if (drag.kind === 'crop') { st.crop.x2 = clampX(p.x); st.crop.y2 = clampY(p.y); } // pointer capture reports points outside the image
    else {
      const s = drag.s;
      if (s.pts) s.pts.push([p.x, p.y]);
      else if (e.shiftKey && (s.type === 'rect' || s.type === 'ellipse')) { const d = Math.max(Math.abs(p.x - s.x1), Math.abs(p.y - s.y1)); s.x2 = s.x1 + Math.sign(p.x - s.x1) * d; s.y2 = s.y1 + Math.sign(p.y - s.y1) * d; }
      else { s.x2 = p.x; s.y2 = p.y; }
    }
    render();
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.kind === 'draw') {
      const b = bounds(drag.s);
      if (b.w < 3 && b.h < 3 && !drag.s.pts) { st.shapes.pop(); undo.pop(); syncUndo(); }
    }
    if (drag.kind === 'crop') {
      const c = norm(st.crop);
      if (c.w < 8 || c.h < 8) st.crop = null;
    }
    drag = null;
    render();
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('dblclick', () => { if (st.tool === 'move') wrap.classList.toggle('zoom'); });

  function startText(p, e) {
    const r = cv.getBoundingClientRect(), k = r.width / W;
    const fs = (14 + st.size * 3) * K * k;
    const el = document.createElement('div');
    el.className = 'txt-in';
    el.contentEditable = 'true';
    Object.assign(el.style, { left: e.clientX - r.left + 'px', top: e.clientY - r.top + 'px', fontSize: fs + 'px', color: st.color });
    wrap.appendChild(el);
    setTimeout(() => el.focus());
    const done = () => {
      const text = el.innerText.trim();
      el.remove();
      if (!text) return;
      commit();
      st.shapes.push({ type: 'text', color: st.color, size: st.size, x1: p.x, y1: p.y, x2: p.x, y2: p.y, text });
      render();
    };
    el.addEventListener('blur', done, { once: true });
    el.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.isComposing || ev.keyCode === 229) return; // Enter confirms an IME composition (Japanese, Chinese, Korean), not the text
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); el.blur(); }
      if (ev.key === 'Escape') { el.innerText = ''; el.blur(); }
    });
  }

  // ── toolbar ──
  const setTool = (t) => {
    st.tool = t;
    if (t !== 'move') st.sel = -1;
    $$('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    cv.style.cursor = t === 'move' ? 'default' : t === 'text' ? 'text' : 'crosshair';
    render();
  };
  setTool(st.tool);
  $$('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  $$('[data-color]').forEach((b) => (b.onclick = () => {
    st.color = b.dataset.color;
    $$('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
    if (st.sel >= 0) { commit(); st.shapes[st.sel].color = st.color; render(); }
  }));
  $$('[data-size]').forEach((b) => (b.onclick = () => {
    st.size = +b.dataset.size;
    $$('[data-size]').forEach((x) => x.classList.toggle('on', x === b));
    if (st.sel >= 0) { commit(); st.shapes[st.sel].size = st.size; render(); }
  }));
  const restore = (json) => { const o = JSON.parse(json); st.shapes = o.shapes; st.crop = o.crop; st.sel = -1; drag = null; render(); syncUndo(); };
  $('#undo').onclick = () => { if (!undo.length) return; redo.push(snap()); restore(undo.pop()); };
  $('#redo').onclick = () => { if (!redo.length) return; undo.push(snap()); restore(redo.pop()); };
  $('#clear').onclick = () => { if (!st.shapes.length && !st.crop) return; commit(); st.shapes = []; st.crop = null; st.sel = -1; render(); };
  document.addEventListener('keydown', (e) => {
    if (e.target.isContentEditable || e.target.tagName === 'INPUT') return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? $('#redo') : $('#undo')).click(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); $('#saveBtn').click(); return; }
    if (mod && e.key.toLowerCase() === 'c' && !getSelection().toString()) { e.preventDefault(); $('#copyBtn').click(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel >= 0) { commit(); st.shapes.splice(st.sel, 1); st.sel = -1; render(); return; }
    if (e.key === 'Escape') { st.sel = -1; if (st.tool === 'crop' && st.crop) { commit(); st.crop = null; } render(); return; }
    const t = TOOLS.find((x) => x[3] === e.key.toLowerCase());
    if (t && !mod) setTool(t[0]);
  });

  // ── export ──
  async function exportPng() {
    render(true);
    let out = cv;
    if (st.crop) {
      const c = norm(st.crop);
      out = new OffscreenCanvas(Math.round(c.w), Math.round(c.h));
      out.getContext('2d').drawImage(cv, c.x, c.y, c.w, c.h, 0, 0, out.width, out.height);
    }
    const blob = out instanceof OffscreenCanvas ? await out.convertToBlob({ type: 'image/png' }) : await new Promise((r) => cv.toBlob(r, 'image/png'));
    render();
    return blob;
  }
  async function convert(png, fmt) {
    if (fmt === 'png') return png;
    if (fmt === 'pdf') return imageBlobToPdf(png);
    const bmp = await createImageBitmap(png);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0);
    return c.convertToBlob({ type: 'image/jpeg', quality: S.jpgQuality });
  }

  let fmt = item.pending ? S.fileType : item.format === 'pdf' ? 'pdf' : item.format === 'jpg' ? 'jpg' : 'png';
  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.innerHTML = ['png', 'jpg', 'pdf'].map((f) => `<button data-f="${f}" class="${f === fmt ? 'on' : ''}">${f.toUpperCase()}</button>`).join('');
  seg.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; fmt = b.dataset.f; $$('button', seg).forEach((x) => x.classList.toggle('on', x === b)); };
  $('#actions').appendChild(seg);

  actionBtn(`${icon('copy')}Copy`, '', async () => {
    const png = await exportPng();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    toast('Image copied to clipboard');
  }).id = 'copyBtn';

  actionBtn(`${icon('download')}Save`, 'primary', async (btn) => {
    btn.disabled = true;
    try {
      const png = await exportPng();
      const blob = await convert(png, fmt);
      const name = (item.name || 'capture').replace(/\.[a-z0-9]+$/i, '') + '.' + fmt;
      // the first save keeps the unannotated capture so "Download original" still has it after reopening
      const patch = { blob, format: fmt, name, preview: fmt === 'png' ? undefined : png, thumb: await thumbnail(await createImageBitmap(png)), pending: false, original: item.original ?? src };
      // the item may have been deleted (History, Clear history, pruning) while open here: put it back instead of losing the edit
      const updated = await updateItem(id, patch);
      item = updated ?? { ...item, ...patch, id };
      if (!updated) await putItem(item);
      savedSnap = snap();
      $('#title').textContent = name;
      $('#banner').innerHTML = '';
      if (S.copy) await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).catch(() => {});
      if (S.destination === 'none') toast(`Saved ${name} to LupaX history`);
      else { await download(blob, name, S.destination === 'ask'); toast(`Saved ${name}`); }
    } finally { btn.disabled = false; }
  }).id = 'saveBtn';

  const more = actionBtn(icon('dots'), 'ghost', (b) => {
    const m = document.createElement('div');
    m.className = 'menu';
    m.innerHTML = `<button data-a="dl">${icon('download')}Save as…</button><button data-a="orig">${icon('image')}Download original</button><hr><button data-a="del" class="danger">${icon('trash')}Delete capture</button>`;
    document.body.appendChild(m);
    const r = b.getBoundingClientRect();
    Object.assign(m.style, { top: r.bottom + 6 + 'px', left: Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8) + 'px' });
    const close = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', close, true); } };
    setTimeout(() => document.addEventListener('mousedown', close, true));
    m.onclick = (e) => act(e).catch((err) => toast(err.message, 'xCircle'));
    const act = async (e) => {
      const a = e.target.closest('button')?.dataset.a;
      m.remove();
      if (a === 'dl') { const png = await exportPng(); const blob = await convert(png, fmt); await download(blob, (item.name || 'capture').replace(/\.[a-z0-9]+$/i, '') + '.' + fmt, true); }
      if (a === 'orig') await download(item.original ?? src, (item.name || 'capture').replace(/\.[a-z0-9]+$/i, '') + '-original.png');
      if (a === 'del') { await deleteItem(id); savedSnap = snap(); window.close(); }
    };
  });
  more.title = 'More';
}
