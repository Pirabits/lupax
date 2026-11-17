// LupaX in-page inspector (injected on demand). Hover to inspect, click to pin, ↑/↓ parent/child, Esc to exit.
(() => {
  if (window.__lupax) return;

  const hx = (v) => Math.round(v).toString(16).padStart(2, '0');
  const parse = (s) => { if (!s) return null; const m = s.match(/^rgba?\(([^)]+)\)$/); if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; } const memo = (parse.memo ||= new Map()); if (memo.has(s)) return memo.get(s); let c = null; if (CSS.supports('color', s)) { const x = (parse.ctx ||= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })); x.clearRect(0, 0, 1, 1); x.fillStyle = s; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; c = { r: d[0], g: d[1], b: d[2], a: Math.round((d[3] / 255) * 1000) / 1000 }; } memo.set(s, c); return c; };
  const hex = (c) => (c ? `#${hx(c.r)}${hx(c.g)}${hx(c.b)}${c.a < 1 ? hx(c.a * 255) : ''}`.toUpperCase() : '—');
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (t, b) => { const a = t.a + b.a * (1 - t.a); return a ? { r: (t.r * t.a + b.r * b.a * (1 - t.a)) / a, g: (t.g * t.a + b.g * b.a * (1 - t.a)) / a, b: (t.b * t.a + b.b * b.a * (1 - t.a)) / a, a } : t; };
  const bgOf = (el) => { const L = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { L.push(c); if (c.a >= 1) break; } } let o = { r: 255, g: 255, b: 255, a: 1 }; for (let i = L.length - 1; i >= 0; i--) o = blend(L[i], o); return o; };
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '');
  const px = (v) => Math.round(parseFloat(v) * 10) / 10;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  try {
    const ff = new FontFace('IXJakarta', `url(${chrome.runtime.getURL('fonts/PlusJakartaSans-latin.woff2')})`, { weight: '400 800' });
    ff.load().then(() => document.fonts.add(ff)).catch(() => {});
  } catch {}

  const host = document.createElement('lupax-root');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none';
  const sh = host.attachShadow({ mode: 'closed' });
  sh.innerHTML = `<style>
    *{box-sizing:border-box}
    :host{font-family:IXJakarta,system-ui,-apple-system,sans-serif}
    .m,.p,.c{position:fixed;pointer-events:none;display:none}
    .m{background:rgba(255,166,77,.22)}
    .p{background:rgba(74,222,128,.22)}
    .c{outline:1.5px dashed #4a9df0;background:rgba(74,157,240,.07)}
    .sel{position:fixed;pointer-events:none;display:none;outline:2px solid #4a9df0;background:rgba(74,157,240,.06)}
    .sel i{position:absolute;width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid #4a9df0;margin:-5px 0 0 -5px}
    .tag{position:fixed;pointer-events:none;display:none;font:600 12.5px/1 IXJakarta,system-ui,sans-serif;color:#7ab8f5;background:#061230;padding:6px 9px;border-radius:6px;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.3);gap:6px;align-items:center}
    .tag::before{content:'✦';font-size:11px}
    .tag small{opacity:.75;font-weight:500;margin-left:4px}
    .hint{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);pointer-events:none;font:600 12.5px/1 IXJakarta,system-ui,sans-serif;color:#eef3fb;background:rgba(6,18,48,.92);padding:10px 16px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.25);white-space:nowrap}
    .panel{position:fixed;top:16px;right:16px;width:316px;max-height:calc(100vh - 32px);overflow:auto;pointer-events:auto;background:#0a1836;color:#eef3fb;border:1px solid #223a68;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.3);font:500 12.5px/1.4 IXJakarta,system-ui,sans-serif;display:none}
    .hd{display:flex;align-items:center;gap:8px;padding:12px 12px 10px 14px;cursor:move;border-bottom:1px solid #172a52;background:linear-gradient(180deg,#0e1f44,#0a1836);position:sticky;top:0;z-index:1}
    .hd b{font-size:15px;font-weight:800;letter-spacing:-.02em}
    .hd .sp{flex:1}
    .x{width:28px;height:28px;border:0;border-radius:8px;background:none;cursor:pointer;color:#b7c6de;display:grid;place-items:center}
    .x:hover{background:#163463;color:#7ab8f5}
    .chip{display:inline-flex;align-items:center;gap:6px;font:700 12px/1 ui-monospace,Menlo,monospace;color:#7ab8f5;background:#10264f;padding:6px 8px;border-radius:7px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sec{padding:10px 14px;border-bottom:1px solid #172a52}
    .sec:last-child{border-bottom:0}
    .sec h4{margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8597b8}
    .kv{display:flex;align-items:center;gap:8px;min-height:27px}
    .kv .k{width:92px;color:#8597b8;flex:none}
    .kv .v{flex:1;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sw{width:18px;height:18px;border-radius:5px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);flex:none}
    .cp{border:0;background:none;cursor:pointer;color:#8597b8;padding:2px;border-radius:5px;font:inherit;display:grid;place-items:center}
    .cp:hover{color:#7ab8f5;background:#163463}
    .aa{display:inline-grid;place-items:center;width:24px;height:20px;border-radius:5px;font-size:11px;font-weight:800;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)}
    .bdg{margin-left:auto;display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 9px;border-radius:999px;font-size:11.5px;font-weight:700}
    .good{background:#0d2c2c;color:#4ade80}.warn{background:#2c2616;color:#fbbf24}.bad{background:#321a2b;color:#f87171}
    .box{position:relative;text-align:center;font:600 10.5px/1 ui-monospace,Menlo,monospace;color:#3a3550}
    .box .lyr{position:relative;padding:16px 22px;border-radius:8px}
    .box .lbl{position:absolute;left:6px;top:4px;font:700 9px/1 IXJakarta,system-ui;text-transform:uppercase;letter-spacing:.05em;color:#6e6884}
    .box .t,.box .b,.box .l,.box .r{position:absolute}
    .box .t{top:4px;left:50%;transform:translateX(-50%)}.box .b{bottom:3px;left:50%;transform:translateX(-50%)}
    .box .l{left:6px;top:50%;transform:translateY(-50%)}.box .r{right:6px;top:50%;transform:translateY(-50%)}
    .mg{background:#fff1e3;border:1px dashed #ffb27a}.bd{background:#fff9db;border:1.5px solid #f5d76e}.pd{background:#e6f9ee;border:1px dashed #66d19a}
    .ct{background:#e3f0fd;border:1px solid #9cc8f5;border-radius:5px;padding:9px 6px;color:#1f5fa8}
    .acts{display:flex;gap:6px;padding:12px 14px 14px}
    .btn{flex:1;height:34px;border-radius:10px;border:1px solid #223a68;background:#0f2148;font:650 12.5px IXJakarta,system-ui,sans-serif;color:#eef3fb;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}
    .btn:hover{border-color:#2c5a96;background:#14284f}
    .btn.pri{border:0;color:#061230;background:linear-gradient(180deg,#8fc4f7,#5ea6f0);box-shadow:0 4px 12px rgba(122,184,245,.25)}
    svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
    .toast{position:fixed;left:50%;bottom:62px;transform:translateX(-50%);background:#163463;color:#eef3fb;font:600 12.5px IXJakarta,system-ui;padding:9px 14px;border-radius:10px;opacity:0;transition:opacity .15s;pointer-events:none}
    .toast.on{opacity:1}
  </style>
  <div class="m"></div><div class="p"></div><div class="c"></div>
  <div class="sel"><i style="left:0;top:0"></i><i style="left:100%;top:0"></i><i style="left:0;top:100%"></i><i style="left:100%;top:100%"></i></div>
  <div class="tag"></div>
  <div class="hint">LupaX · hover to inspect · click to pin · ↑ parent · ↓ child · Esc to exit</div>
  <div class="panel"></div>
  <div class="toast"></div>`;

  const $ = (s) => sh.querySelector(s);
  const M = $('.m'), P = $('.p'), C = $('.c'), SEL = $('.sel'), TAG = $('.tag'), PANEL = $('.panel'), HINT = $('.hint');
  const ICON = {
    copy: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    ok: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8.2 12.3 2.6 2.6 5-5.4"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M10.3 4.3 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4.5M12 17.2h.01"/></svg>',
  };
  const LOGO = '<svg viewBox="0 0 48 48" style="width:24px;height:24px"><circle cx="20" cy="20" r="13.5" fill="none" stroke="#7ab8f5" stroke-width="3.6"/><path d="M14.8 14.8 25.2 25.2M25.2 14.8 14.8 25.2" stroke="#7ab8f5" stroke-width="3.2" fill="none"/><path d="M30.2 30.2 41.5 41.5" stroke="#7ab8f5" stroke-width="5.6" stroke-linecap="round" fill="none"/></svg>';

  let active = false, hover = null, pinned = null, stack = [], raf = 0;

  const place = (el, r) => Object.assign(el.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: Math.max(0, r.width) + 'px', height: Math.max(0, r.height) + 'px' });
  function drawHover(el) {
    if (!el) { M.style.display = P.style.display = C.style.display = 'none'; return; }
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const mt = parseFloat(cs.marginTop), mr = parseFloat(cs.marginRight), mb = parseFloat(cs.marginBottom), ml = parseFloat(cs.marginLeft);
    const bt = parseFloat(cs.borderTopWidth), br = parseFloat(cs.borderRightWidth), bb = parseFloat(cs.borderBottomWidth), bl = parseFloat(cs.borderLeftWidth);
    const pt = parseFloat(cs.paddingTop), pr = parseFloat(cs.paddingRight), pb = parseFloat(cs.paddingBottom), pl = parseFloat(cs.paddingLeft);
    place(M, { left: r.left - ml, top: r.top - mt, width: r.width + ml + mr, height: r.height + mt + mb });
    place(P, { left: r.left + bl, top: r.top + bt, width: r.width - bl - br, height: r.height - bt - bb });
    place(C, { left: r.left + bl + pl, top: r.top + bt + pt, width: r.width - bl - br - pl - pr, height: r.height - bt - bb - pt - pb });
    if (!pinned) drawTag(el, r);
  }
  function drawTag(el, r) {
    TAG.innerHTML = `${esc(name(el))}<small>${Math.round(r.width)} × ${Math.round(r.height)}</small>`;
    TAG.style.display = 'flex';
    const below = r.bottom + 34 < innerHeight;
    TAG.style.left = Math.max(4, Math.min(r.left, innerWidth - TAG.offsetWidth - 4)) + 'px';
    TAG.style.top = (below ? r.bottom + 6 : Math.max(4, r.top - 32)) + 'px';
  }
  function drawPinned() {
    if (!pinned || !pinned.isConnected) { SEL.style.display = 'none'; return; }
    const r = pinned.getBoundingClientRect();
    place(SEL, r);
    drawTag(pinned, r);
  }
  function loop() { if (!active) return; drawHover(hover && hover !== pinned ? hover : null); drawPinned(); raf = requestAnimationFrame(loop); }

  const inPanel = (e) => e.composedPath().includes(host);

  function onMove(e) {
    if (inPanel(e)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== hover && el !== document.documentElement && el !== host) { hover = el; if (!pinned) stack = []; }
  }
  function onClick(e) {
    if (inPanel(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type !== 'click') return;
    if (hover) pin(hover);
  }
  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (pinned) unpin(); else stop(); return; }
    const cur = pinned || hover;
    if (!cur || inPanel(e)) return;
    if (e.key === 'ArrowUp' && cur.parentElement && cur.parentElement !== document.documentElement) { e.preventDefault(); stack.push(cur); pinned ? pin(cur.parentElement, true) : (hover = cur.parentElement); }
    if (e.key === 'ArrowDown' && stack.length) { e.preventDefault(); const n = stack.pop(); pinned ? pin(n, true) : (hover = n); }
  }

  function pin(el, keepStack) {
    if (!keepStack) stack = [];
    pinned = el;
    hover = el;
    PANEL.style.display = 'block';
    HINT.style.display = 'none';
    renderPanel(el);
  }
  function unpin() { pinned = null; PANEL.style.display = 'none'; HINT.style.display = 'block'; }

  function cssOf(el) {
    const cs = getComputedStyle(el);
    const keep = ['display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color', 'background-image', 'border', 'border-radius', 'box-shadow', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform', 'text-align', 'gap', 'opacity'];
    const skip = { 'background-image': 'none', 'box-shadow': 'none', 'letter-spacing': 'normal', 'text-transform': 'none', opacity: '1', gap: 'normal' };
    return `${name(el)} {\n${keep.map((k) => [k, cs.getPropertyValue(k)]).filter(([k, v]) => v && v !== skip[k] && !(k === 'border' && v.startsWith('0px'))).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`;
  }

  function toast(t) { const el = $('.toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 1300); }
  async function copy(t, label) {
    try { await navigator.clipboard.writeText(t); } catch { const ta = document.createElement('textarea'); ta.value = t; document.documentElement.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toast(`Copied ${label || t}`);
  }

  function renderPanel(el) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const fg = parse(cs.color), bg = bgOf(el), ownBg = parse(cs.backgroundColor);
    const border = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' ? parse(cs.borderTopColor) : null;
    const ratio = fg ? (Math.max(lum(blend(fg, bg)), lum(bg)) + 0.05) / (Math.min(lum(blend(fg, bg)), lum(bg)) + 0.05) : null;
    const size = parseFloat(cs.fontSize), large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
    const rt = ratio == null ? null : ratio >= (large ? 4.5 : 7) ? ['Excellent', 'good', 'ok'] : ratio >= (large ? 3 : 4.5) ? ['Good', 'good', 'ok'] : ratio >= 3 ? ['Large only', 'warn', 'warn'] : ['Poor', 'bad', 'warn'];
    const lh = cs.lineHeight === 'normal' ? 'normal' : `${px(cs.lineHeight)} px (${(parseFloat(cs.lineHeight) / size).toFixed(2)})`;
    const colorRow = (label, c) => c && c.a > 0 ? `<div class="kv"><span class="k">${label}</span><span class="sw" style="background:${hex(c)}"></span><span class="v">${hex(c)}</span><button class="cp" data-copy="${hex(c)}">${ICON.copy}</button></div>` : '';
    const side = (p) => ['Top', 'Right', 'Bottom', 'Left'].map((s) => px(cs[`${p}${s}`] ?? cs[p.replace('Width', '') + s]));
    const m = side('margin'), pd = side('padding');
    const bw = ['Top', 'Right', 'Bottom', 'Left'].map((s) => px(cs[`border${s}Width`]));
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || el.innerText?.trim();

    PANEL.innerHTML = `
      <div class="hd">${LOGO}<b>Lupa<span style="color:#7ab8f5">X</span></b><span class="sp"></span><button class="x" data-act="close" title="Exit (Esc)">${ICON.x}</button></div>
      <div class="sec"><span class="chip" title="${esc(name(el))}">◆ ${esc(name(el))}</span>
        <div class="kv" style="margin-top:6px"><span class="k">Size</span><span class="v">${px(r.width)} × ${px(r.height)} px</span></div>
        <div class="kv"><span class="k">Display</span><span class="v">${cs.display} · ${cs.position}</span></div></div>
      <div class="sec"><h4>Colors</h4>
        ${colorRow('Text', fg)}${colorRow('Background', ownBg && ownBg.a > 0 ? ownBg : null)}${colorRow('Border', border)}
        ${cs.backgroundImage !== 'none' ? `<div class="kv"><span class="k">Gradient/img</span><span class="v" title="${esc(cs.backgroundImage)}">${esc(cs.backgroundImage.slice(0, 60))}</span></div>` : ''}
      </div>
      ${hasText ? `<div class="sec"><h4>Typography</h4>
        <div class="kv"><span class="k">Font family</span><span class="v" title="${esc(cs.fontFamily)}">${esc(cs.fontFamily.split(',')[0].replace(/["']/g, ''))}</span></div>
        <div class="kv"><span class="k">Font size</span><span class="v">${px(cs.fontSize)} px</span></div>
        <div class="kv"><span class="k">Line height</span><span class="v">${lh}</span></div>
        <div class="kv"><span class="k">Font weight</span><span class="v">${cs.fontWeight}</span></div>
        ${cs.letterSpacing !== 'normal' ? `<div class="kv"><span class="k">Letter spacing</span><span class="v">${cs.letterSpacing}</span></div>` : ''}
        ${rt ? `<div class="kv"><span class="k">Contrast</span><span class="aa" style="background:${hex(bg)};color:${hex(fg)}">Aa</span><span class="v" style="flex:none">${ratio.toFixed(2)}:1</span><span class="bdg ${rt[1]}">${ICON[rt[2]]}${rt[0]}</span></div>` : ''}
      </div>` : ''}
      <div class="sec"><h4>Spacing</h4>
        <div class="box"><div class="lyr mg"><span class="lbl">margin</span><span class="t">${m[0]}</span><span class="r">${m[1]}</span><span class="b">${m[2]}</span><span class="l">${m[3]}</span>
          <div class="lyr bd"><span class="lbl">border</span><span class="t">${bw[0]}</span><span class="r">${bw[1]}</span><span class="b">${bw[2]}</span><span class="l">${bw[3]}</span>
            <div class="lyr pd"><span class="lbl">padding</span><span class="t">${pd[0]}</span><span class="r">${pd[1]}</span><span class="b">${pd[2]}</span><span class="l">${pd[3]}</span>
              <div class="ct">${px(r.width - bw[1] - bw[3] - pd[1] - pd[3])} × ${px(r.height - bw[0] - bw[2] - pd[0] - pd[2])}</div></div></div></div></div>
        ${cs.borderTopLeftRadius !== '0px' ? `<div class="kv" style="margin-top:6px"><span class="k">Radius</span><span class="v">${cs.borderRadius}</span></div>` : ''}
        ${cs.boxShadow !== 'none' ? `<div class="kv"><span class="k">Shadow</span><span class="v" title="${esc(cs.boxShadow)}">${esc(cs.boxShadow)}</span><button class="cp" data-copy="${esc(cs.boxShadow)}">${ICON.copy}</button></div>` : ''}
      </div>
      <div class="acts"><button class="btn" data-act="parent">${ICON.up}Parent</button><button class="btn pri" data-act="css">${ICON.copy}Copy CSS</button></div>`;

    PANEL.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
    PANEL.querySelector('[data-act="close"]').onclick = stop;
    PANEL.querySelector('[data-act="css"]').onclick = () => copy(cssOf(el), 'CSS');
    PANEL.querySelector('[data-act="parent"]').onclick = () => { if (el.parentElement && el.parentElement !== document.documentElement) { stack.push(el); pin(el.parentElement, true); } };

    // drag panel by its header
    const hd = PANEL.querySelector('.hd');
    hd.onpointerdown = (e) => {
      if (e.target.closest('button')) return;
      const r0 = PANEL.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      const mv = (ev) => { PANEL.style.left = Math.max(0, r0.left + ev.clientX - sx) + 'px'; PANEL.style.top = Math.max(0, r0.top + ev.clientY - sy) + 'px'; PANEL.style.right = 'auto'; };
      const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); };
      addEventListener('pointermove', mv, true);
      addEventListener('pointerup', up, true);
    };
  }

  const EVENTS = [['mousemove', onMove], ['click', onClick], ['mousedown', onClick], ['mouseup', onClick], ['pointerdown', onClick], ['pointerup', onClick], ['keydown', onKey]];
  function start() {
    if (active) return true;
    active = true;
    document.documentElement.appendChild(host);
    HINT.style.display = 'block';
    for (const [t, f] of EVENTS) addEventListener(t, f, true);
    raf = requestAnimationFrame(loop);
    return true;
  }
  function stop() {
    if (!active) return true;
    active = false;
    for (const [t, f] of EVENTS) removeEventListener(t, f, true);
    cancelAnimationFrame(raf);
    pinned = hover = null;
    PANEL.style.display = 'none';
    host.remove();
    return true;
  }

  window.__lupax = { start, stop, get active() { return active; } };
})();
