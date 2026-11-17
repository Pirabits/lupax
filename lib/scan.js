// Functions injected into inspected pages via chrome.scripting.executeScript({ func }).
// Each must be fully self-contained (no references to module scope).

/* ───────────────────────────── Styles: colors, typography, spacing, components ───────────────────────────── */
export function scanStyles() {
  const MAX = 9000;
  const allEls = [document.documentElement, ...document.querySelectorAll('body, body *')];
  const els = allEls.slice(0, MAX);
  const hx = (v) => Math.round(v).toString(16).padStart(2, '0');
  // Chrome reports oklch()/lab()/color() values in their own syntax; anything that isn't rgb() is resolved through a 1×1 canvas.
  const parse = (s) => { if (!s) return null; const m = s.match(/^rgba?\(([^)]+)\)$/); if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; } const memo = (parse.memo ||= new Map()); if (memo.has(s)) return memo.get(s); let c = null; if (CSS.supports('color', s)) { const x = (parse.ctx ||= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })); x.clearRect(0, 0, 1, 1); x.fillStyle = s; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; c = { r: d[0], g: d[1], b: d[2], a: Math.round((d[3] / 255) * 1000) / 1000 }; } memo.set(s, c); return c; };
  const hex = (c) => (c ? `#${hx(c.r)}${hx(c.g)}${hx(c.b)}${c.a < 1 ? hx(c.a * 255) : ''}`.toUpperCase() : null);
  const norm = (str) => { const c = parse(str); return c && c.a > 0 ? hex(c) : null; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const blend = (top, bot) => { const a = top.a + bot.a * (1 - top.a); return a ? { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a } : top; };
  const bgCache = new Map();
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (bgCache.has(n)) { layers.push(bgCache.get(n)); break; }
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    bgCache.set(el, out);
    return out;
  };
  const directText = (el) => { let t = ''; for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent; return t.replace(/\s+/g, ' ').trim(); };
  const sel = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');

  const colors = new Map();
  const addColor = (val, use) => {
    const v = norm(val);
    if (!v) return;
    const e = colors.get(v) || { value: v, count: 0, uses: {} };
    e.count++;
    e.uses[use] = (e.uses[use] || 0) + 1;
    colors.set(v, e);
  };

  const styles = new Map(), families = new Map();
  const groups = {}; // semantic typography groups
  const spacing = new Map(), radii = new Map(), shadows = new Map(), gaps = new Map();
  const comp = { button: new Map(), input: new Map(), card: new Map(), link: new Map() };
  const addComp = (kind, key, data) => { const e = comp[kind].get(key) || { ...data, count: 0 }; e.count++; comp[kind].set(key, e); };
  const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);

  const groupOf = (el) => {
    const t = el.tagName;
    if (/^H[1-6]$/.test(t)) return t.toLowerCase();
    if (t === 'BUTTON' || el.getAttribute('role') === 'button') return 'button';
    if (t === 'A') return 'link';
    if (['SMALL', 'FIGCAPTION', 'CAPTION', 'LABEL'].includes(t)) return 'small';
    if (['P', 'LI', 'DD', 'BLOCKQUOTE', 'TD', 'SPAN', 'DIV', 'EM', 'STRONG', 'B', 'I'].includes(t)) return 'body';
    return null;
  };

  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    const visible = cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0 && (r.width > 0 || el === document.documentElement);
    if (!visible) continue;
    const text = directText(el);

    if (text) {
      const key = [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.lineHeight, cs.letterSpacing, cs.fontStyle, cs.textTransform].join('|');
      const s = styles.get(key) || { family: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, style: cs.fontStyle, transform: cs.textTransform, color: norm(cs.color), sample: text.slice(0, 70), count: 0, tags: new Set() };
      s.count++;
      s.tags.add(el.tagName.toLowerCase());
      styles.set(key, s);
      bump(families, cs.fontFamily.split(',')[0].replace(/["']/g, '').trim());
      addColor(cs.color, 'text');

      const g = groupOf(el);
      if (g) {
        const fg = parse(cs.color);
        const bg = bgOf(el);
        const gk = key + '|' + norm(cs.color);
        groups[g] ??= { count: 0, variants: new Map() };
        groups[g].count++;
        const v = groups[g].variants.get(gk) || { family: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, transform: cs.textTransform, color: norm(cs.color), bg: hex(bg), contrast: fg ? +ratio(blend(fg, bg), bg).toFixed(2) : null, sample: text.slice(0, 60), count: 0 };
        v.count++;
        groups[g].variants.set(gk, v);
      }
    }

    addColor(cs.backgroundColor, 'background');
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none') { addColor(cs[`border${side}Color`], 'border'); break; }
    }
    if (el instanceof SVGGeometryElement || el instanceof SVGTextContentElement) { addColor(cs.fill, 'svg'); addColor(cs.stroke, 'svg'); }
    for (const c of cs.backgroundImage.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/g) || []) addColor(c, 'gradient');
    if (cs.boxShadow !== 'none') {
      for (const c of cs.boxShadow.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/g) || []) addColor(c, 'shadow');
      bump(shadows, cs.boxShadow);
    }

    // spacing scale
    for (const p of ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
      const v = Math.round(parseFloat(cs[p]));
      if (v > 0 && v <= 200) bump(spacing, v);
    }
    for (const p of ['rowGap', 'columnGap']) {
      const v = Math.round(parseFloat(cs[p]));
      if (v > 0 && v <= 200 && /flex|grid/.test(cs.display)) bump(gaps, v);
    }
    const rad = cs.borderTopLeftRadius;
    if (rad && rad !== '0px') bump(radii, rad.includes('%') ? rad : Math.round(parseFloat(rad)) + 'px');

    // components
    const tag = el.tagName;
    const hasBg = (parse(cs.backgroundColor)?.a || 0) > 0 || cs.backgroundImage.includes('gradient');
    const hasBorder = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
    // innerText is layout work, and value can be a number (<progress>, <meter>, <li>): only read them for buttons and links
    const label = () => String(el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    const isBtn = tag === 'BUTTON' || el.getAttribute('role') === 'button' || (tag === 'INPUT' && /^(submit|button|reset)$/.test(el.type)) ||
      (tag === 'A' && (hasBg || hasBorder) && parseFloat(cs.paddingLeft) >= 8 && r.height >= 24 && r.height <= 80);
    if (isBtn && r.width > 16 && r.height > 16) {
      const d = { bg: cs.backgroundImage.includes('gradient') ? cs.backgroundImage : norm(cs.backgroundColor) || 'transparent', color: norm(cs.color), border: hasBorder ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${norm(cs.borderTopColor)}` : 'none', radius: cs.borderTopLeftRadius, padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily, height: Math.round(r.height) + 'px', shadow: cs.boxShadow, label: label() || 'Button', selector: sel(el) };
      addComp('button', [d.bg, d.color, d.border, d.radius, d.padding, d.fontSize, d.fontWeight].join('|'), d);
    } else if (tag === 'A' && text) {
      const d = { color: norm(cs.color), decoration: cs.textDecorationLine, fontWeight: cs.fontWeight, fontSize: cs.fontSize, fontFamily: cs.fontFamily, label: label() || 'Link', selector: sel(el) };
      addComp('link', [d.color, d.decoration, d.fontWeight].join('|'), d);
    }
    if ((tag === 'INPUT' && !/^(submit|button|reset|checkbox|radio|hidden|range|color|file|image)$/.test(el.type)) || tag === 'TEXTAREA' || tag === 'SELECT') {
      const d = { bg: norm(cs.backgroundColor) || 'transparent', color: norm(cs.color), border: hasBorder ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${norm(cs.borderTopColor)}` : 'none', radius: cs.borderTopLeftRadius, padding: `${cs.paddingTop} ${cs.paddingRight}`, height: Math.round(r.height) + 'px', fontSize: cs.fontSize, fontFamily: cs.fontFamily, placeholder: el.placeholder || el.getAttribute('aria-label') || tag.toLowerCase(), selector: sel(el) };
      addComp('input', [d.bg, d.border, d.radius, d.height].join('|'), d);
    }
    if (!isBtn && r.width >= 140 && r.height >= 90 && el.children.length >= 2 && parseFloat(cs.borderTopLeftRadius) >= 6 &&
      (cs.boxShadow !== 'none' || hasBorder || hasBg) && parseFloat(cs.paddingTop) >= 10 && el !== document.body) {
      const d = { bg: norm(cs.backgroundColor) || 'transparent', border: hasBorder ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${norm(cs.borderTopColor)}` : 'none', radius: cs.borderTopLeftRadius, shadow: cs.boxShadow, padding: cs.padding, selector: sel(el) };
      addComp('card', [d.bg, d.border, d.radius, d.shadow].join('|'), d);
    }
  }

  const webfonts = [];
  try { for (const f of document.fonts) if (f.status === 'loaded') webfonts.push({ family: f.family.replace(/["']/g, ''), weight: f.weight, style: f.style }); } catch {}

  const GROUP_META = { h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6', body: 'Body / Paragraph', link: 'Link', button: 'Button', small: 'Caption / Small' };
  const ORDER = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'link', 'button', 'small'];
  const typeGroups = ORDER.filter((k) => groups[k]).map((k) => {
    const vs = [...groups[k].variants.values()].sort((a, b) => b.count - a.count);
    return { key: k, name: GROUP_META[k], count: groups[k].count, primary: vs[0], variants: vs.slice(0, 5) };
  });

  const top = (map, n, conv = (k) => k) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => ({ value: conv(k), count: c }));
  const compList = (m, n = 8) => [...m.values()].sort((a, b) => b.count - a.count).slice(0, n);
  const totalFam = [...families.values()].reduce((a, b) => a + b, 0) || 1;

  return {
    url: location.href,
    title: document.title,
    truncated: allEls.length > MAX, // only the first MAX elements were scanned
    colors: [...colors.values()].sort((a, b) => b.count - a.count),
    typography: {
      groups: typeGroups,
      families: [...families].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count, pct: Math.round((count / totalFam) * 100) })),
      styles: [...styles.values()].map((s) => ({ ...s, tags: [...s.tags].slice(0, 6) })).sort((a, b) => parseFloat(b.size) - parseFloat(a.size) || b.count - a.count),
      webfonts: webfonts.filter((w, i, a) => a.findIndex((x) => x.family === w.family && x.weight === w.weight && x.style === w.style) === i),
    },
    spacing: {
      scale: top(spacing, 14).sort((a, b) => a.value - b.value),
      gaps: top(gaps, 8).sort((a, b) => a.value - b.value),
      radii: top(radii, 8),
      shadows: top(shadows, 6),
    },
    components: {
      buttons: compList(comp.button),
      inputs: compList(comp.input, 6),
      cards: compList(comp.card, 6),
      links: compList(comp.link, 6),
    },
  };
}

/* ───────────────────────────── Assets ───────────────────────────── */
export function scanAssets() {
  const sizes = new Map();
  try {
    for (const e of performance.getEntriesByType('resource')) {
      const s = e.encodedBodySize || e.transferSize || e.decodedBodySize;
      if (s) sizes.set(e.name, s);
    }
  } catch {}
  const items = new Map();
  const fmtOf = (url) => {
    if (url.startsWith('data:')) {
      const m = url.match(/^data:([a-z]+)\/([a-z0-9.+-]+)/i);
      return (m ? m[2] : 'bin').replace('svg+xml', 'svg').replace('jpeg', 'jpg').replace('x-icon', 'ico').replace('vnd.microsoft.icon', 'ico').toLowerCase();
    }
    try {
      const p = new URL(url).pathname.toLowerCase();
      const m = p.match(/\.([a-z0-9]{2,5})$/);
      return m ? m[1].replace('jpeg', 'jpg') : '';
    } catch { return ''; }
  };
  const nameOf = (url, type, i) => {
    if (url.startsWith('data:')) return `${type}-${i}.${fmtOf(url) || 'bin'}`;
    try {
      const u = new URL(url);
      let base = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '') || u.hostname;
      base = base.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
      return base;
    } catch { return `asset-${i}`; }
  };
  let i = 0;
  const add = (url, type, extra = {}) => {
    if (!url || url === 'none' || url.startsWith('about:')) return;
    try { url = new URL(url, document.baseURI).href; } catch { return; }
    if (!/^(https?|data|blob):/.test(url)) return;
    const prev = items.get(url);
    if (prev) { if (extra.w && !prev.w) Object.assign(prev, extra); return; }
    i++;
    const format = fmtOf(url) || (type === 'font' ? 'font' : type === 'svg' ? 'svg' : 'img');
    const size = url.startsWith('data:') ? Math.round((url.length - url.indexOf(',') - 1) * (url.includes(';base64,') ? 0.75 : 1)) : sizes.get(url) || 0;
    items.set(url, { url, type, format, name: nameOf(url, type, i), size, ...extra });
  };
  const urlsIn = (v) => [...(v || '').matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)].map((m) => m[2]);

  for (const l of document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"], link[rel="shortcut icon"]')) add(l.href, 'icon');
  for (const img of document.images) {
    const src = img.currentSrc || img.src;
    const small = img.naturalWidth && img.naturalWidth <= 64 && img.naturalHeight <= 64;
    const isSvg = /\.svg(\?|#|$)/i.test(src) || src.startsWith('data:image/svg');
    add(src, small ? 'icon' : isSvg ? 'svg' : 'image', { w: img.naturalWidth, h: img.naturalHeight, alt: img.alt });
  }
  // srcset: a candidate URL is a run of non-whitespace and may contain commas (CDN params like w_400,c_fill; data: URLs),
  // so it can't be split on ","; take the largest candidate
  const srcsetBest = (v) => {
    let best = null, i = 0;
    while (i < v.length) {
      while (i < v.length && /[\s,]/.test(v[i])) i++;
      let j = i;
      while (j < v.length && !/\s/.test(v[j])) j++;
      let url = v.slice(i, j), desc = '';
      i = j;
      if (url.endsWith(',')) url = url.replace(/,+$/, '');
      else { const k = v.indexOf(',', i); desc = v.slice(i, k < 0 ? v.length : k).trim(); i = k < 0 ? v.length : k + 1; }
      const size = parseFloat(desc) || 1;
      if (url && (!best || size > best.size)) best = { url, size };
    }
    return best?.url;
  };
  for (const s of document.querySelectorAll('picture source[srcset]')) add(srcsetBest(s.srcset), 'image');
  for (const v of document.querySelectorAll('video')) {
    if (v.poster) add(v.poster, 'image');
  }
  for (const m of document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')) add(m.content, 'image');

  const allEls = document.querySelectorAll('body, body *');
  const els = [...allEls].slice(0, 9000);
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    for (const u of urlsIn(cs.backgroundImage)) {
      const r = el.getBoundingClientRect();
      add(u, /\.svg(\?|#|$)/i.test(u) && r.width <= 64 ? 'icon' : 'background', { w: Math.round(r.width), h: Math.round(r.height) });
    }
    for (const ps of ['::before', '::after']) {
      const pcs = getComputedStyle(el, ps);
      if (pcs.content === 'none' && pcs.backgroundImage === 'none') continue;
      for (const u of [...urlsIn(pcs.backgroundImage), ...urlsIn(pcs.content)]) add(u, 'icon');
    }
  }

  // inline SVGs
  // Sprites (<use href="#icon">) and shared gradients/filters (fill="url(#g)") point at elements elsewhere in the page:
  // copy them into the clone, or the saved file renders blank. Follows references of references.
  const inlineRefs = (clone) => {
    let defs = null;
    for (let pass = 0, added = true; added && pass < 5; pass++) {
      added = false;
      const have = new Set([...clone.querySelectorAll('[id]')].map((e) => e.id)); // includes ids inside copied symbols
      const ids = new Set();
      for (const e of clone.querySelectorAll('*')) {
        for (const a of e.attributes) {
          const v = a.value;
          if ((a.localName === 'href') && v.startsWith('#')) ids.add(v.slice(1));
          for (const m of v.matchAll(/url\(\s*['"]?#([^'")\s]+)/g)) ids.add(m[1]);
        }
      }
      for (const id of ids) {
        if (have.has(id)) continue;
        const ref = document.getElementById(id);
        if (!(ref instanceof SVGElement)) continue;
        defs ??= clone.insertBefore(document.createElementNS('http://www.w3.org/2000/svg', 'defs'), clone.firstChild);
        defs.appendChild(ref.cloneNode(true));
        have.add(id);
        added = true;
      }
    }
  };
  const seen = new Set();
  let n = 0;
  for (const svg of document.querySelectorAll('svg')) {
    if (n >= 300 || svg.parentElement?.closest('svg')) continue;
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const clone = svg.cloneNode(true);
    if (!clone.getAttribute('width')) clone.setAttribute('width', Math.round(r.width));
    if (!clone.getAttribute('height')) clone.setAttribute('height', Math.round(r.height));
    inlineRefs(clone);
    // XMLSerializer declares xmlns/xmlns:xlink and escapes text; outerHTML wrote xlink:href undeclared and &nbsp;,
    // which are XML errors in a standalone .svg (the file wouldn't open)
    const s = new XMLSerializer().serializeToString(clone).replace(/currentColor/g, getComputedStyle(svg).color);
    if (s.length > 300000 || seen.has(s)) continue;
    seen.add(s);
    n++;
    const label = (svg.getAttribute('aria-label') || svg.querySelector('title')?.textContent || svg.getAttribute('class') || '').trim().split(/\s+/)[0];
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
    add(url, r.width <= 48 && r.height <= 48 ? 'icon' : 'svg', { w: Math.round(r.width), h: Math.round(r.height) });
    const it = items.get(url);
    if (it) it.name = `${(label || 'inline').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase().slice(0, 40) || 'inline'}-${n}.svg`;
  }

  // fonts: @font-face rules + loaded font resources
  const fontFamilies = new Map();
  const scanRules = (rules, base) => {
    for (const rule of rules) {
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        const fam = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
        const src = rule.style.getPropertyValue('src');
        for (const m of src.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) {
          let u = m[2];
          try { u = new URL(u, base).href; } catch {}
          fontFamilies.set(u, `${fam} ${rule.style.getPropertyValue('font-weight') || ''}`.trim());
          break; // first (preferred) source only
        }
      } else if (rule.cssRules) scanRules(rule.cssRules, base);
    }
  };
  for (const sheet of document.styleSheets) {
    try { scanRules(sheet.cssRules, sheet.href || document.baseURI); } catch { /* cross-origin sheet */ }
  }
  try {
    for (const e of performance.getEntriesByType('resource')) {
      if (/\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(e.name) && !fontFamilies.has(e.name)) fontFamilies.set(e.name, '');
    }
  } catch {}
  for (const [u, fam] of fontFamilies) add(u, 'font', { family: fam });

  return { url: location.href, title: document.title, truncated: allEls.length > 9000, assets: [...items.values()] };
}

/* ───────────────────────────── Accessibility ───────────────────────────── */
export function scanA11y() {
  const LIMIT = 60;
  // Chrome reports oklch()/lab()/color() values in their own syntax; anything that isn't rgb() is resolved through a 1×1 canvas.
  const parse = (s) => { if (!s) return null; const m = s.match(/^rgba?\(([^)]+)\)$/); if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; } const memo = (parse.memo ||= new Map()); if (memo.has(s)) return memo.get(s); let c = null; if (CSS.supports('color', s)) { const x = (parse.ctx ||= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })); x.clearRect(0, 0, 1, 1); x.fillStyle = s; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; c = { r: d[0], g: d[1], b: d[2], a: Math.round((d[3] / 255) * 1000) / 1000 }; } memo.set(s, c); return c; };
  const hx = (v) => Math.round(v).toString(16).padStart(2, '0');
  const hex = (c) => `#${hx(c.r)}${hx(c.g)}${hx(c.b)}`.toUpperCase();
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const blend = (top, bot) => { const a = top.a + bot.a * (1 - top.a); return a ? { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a } : top; };
  const bgOf = (el) => {
    const layers = [];
    let image = false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') image = true;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    return { color: out, image };
  };
  const selector = (el) => {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      if (n.id && document.querySelectorAll('#' + CSS.escape(n.id)).length === 1) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let p = n.tagName.toLowerCase();
      const sibs = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (sibs.length > 1) p += `:nth-of-type(${sibs.indexOf(n) + 1})`;
      parts.unshift(p);
      if (parts.length >= 5) break;
    }
    return parts.join(' > ');
  };
  const label = (el) => {
    const t = el.tagName.toLowerCase();
    const c = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    return t + c;
  };
  const visible = (el) => {
    // checkVisibility also sees opacity:0 / visibility:hidden on ancestors (closed menus); both option spellings for Chrome 116–120 and 121+
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true })) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // text over an <img>/<video>/<canvas> (hero banners) or a background image: the color behind the glyphs is unknown,
  // so a failing ratio can't be trusted. Only called for failing ratios; climbs to the first opaque background.
  const overMedia = (el) => { const r = el.getBoundingClientRect(), area = r.width * r.height; const covers = (m) => { if (m === el || m.contains(el) || el.contains(m)) return false; const q = m.getBoundingClientRect(); const w = Math.min(r.right, q.right) - Math.max(r.left, q.left), h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top); return w > 0 && h > 0 && w * h >= 0.5 * area; }; for (let a = el; a && a.nodeType === 1; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.backgroundImage !== 'none') return true; for (const m of a.querySelectorAll('img, video, canvas')) if (covers(m)) return true; if ((parse(cs.backgroundColor)?.a || 0) >= 1) return false; } return false; };
  const accName = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim(); if (t) return t; }
    return String(el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.querySelector?.('img[alt]')?.alt || el.value || '').trim();
  };

  const checks = [];
  const check = (id, title, severity, describe) => {
    const c = { id, title, severity, passed: 0, failed: 0, items: [], describe };
    checks.push(c);
    return {
      pass: () => c.passed++,
      fail: (el, detail) => { c.failed++; if (c.items.length < LIMIT) c.items.push({ selector: el ? selector(el) : '', label: el ? label(el) : 'document', text: el ? (el.innerText || el.alt || el.getAttribute?.('src') || '').trim().replace(/\s+/g, ' ').slice(0, 80) : '', detail }); },
    };
  };

  // 1. Contrast
  const con = check('contrast', 'Contrast issues', 'issue', (n) => `${n} element${n === 1 ? '' : 's'} below the 4.5:1 (AA) threshold`);
  const read = check('readability', 'Readability warnings', 'warning', (n) => `${n} text block${n === 1 ? '' : 's'} may be hard to read (e.g., small size or tight line height)`);
  const bodyEls = document.querySelectorAll('body *');
  const textEls = [...bodyEls].slice(0, 9000).filter((el) => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  });
  for (const el of textEls) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) continue;
    const { color: bg, image } = bgOf(el);
    const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const r = ratio(blend(fg, bg), bg);
    const need = large ? 3 : 4.5;
    if (r < need && (image || overMedia(el))) { /* text over an image: cannot be verified reliably */ }
    else if (r < need) con.fail(el, `${r.toFixed(2)}:1 · ${hex(fg)} on ${hex(bg)} · needs ${need}:1`);
    else con.pass();

    const text = el.textContent.trim();
    const lh = cs.lineHeight === 'normal' ? size * 1.2 : parseFloat(cs.lineHeight);
    if (size < 12 && text.length > 3) read.fail(el, `Font size ${size}px (min 12px recommended)`);
    else if (text.length > 120 && lh / size < 1.3) read.fail(el, `Line height ${(lh / size).toFixed(2)} on long text (1.5 recommended)`);
    else read.pass();
  }

  // 2. Images alt
  const alt = check('alt', 'Missing alt text', 'issue', (n) => `${n} image${n === 1 ? '' : 's'} without alt text`);
  for (const img of document.querySelectorAll('img, [role="img"], input[type="image"], area')) {
    // <area> has no box of its own; everything else that isn't rendered is skipped
    if (img.tagName !== 'AREA' && !visible(img) && img.getAttribute('aria-hidden') !== 'false') continue;
    const role = img.getAttribute('role');
    if (role === 'presentation' || role === 'none' || img.closest('[aria-hidden="true"]')) { alt.pass(); continue; }
    const has = img.hasAttribute('alt') || img.getAttribute('aria-label') || img.getAttribute('aria-labelledby') || img.getAttribute('title') ||
      (img instanceof SVGSVGElement && img.querySelector(':scope > title')?.textContent.trim());
    // name the image by its file; a data: URL has no file name (splitting it on "/" printed fragments like "svg>")
    const src = img.currentSrc || img.src || '';
    const file = src.startsWith('data:') ? `inline ${(src.match(/^data:image\/([a-z0-9.+-]+)/i)?.[1] || 'image').replace('svg+xml', 'SVG').toUpperCase()} image` : src.split(/[?#]/)[0].split('/').pop()?.slice(0, 60);
    if (has) alt.pass(); else alt.fail(img, file || 'image');
  }

  // 3. Form labels
  const lab = check('labels', 'Form fields without labels', 'issue', (n) => `${n} form field${n === 1 ? ' has' : 's have'} no accessible label`);
  for (const f of document.querySelectorAll('input, select, textarea')) {
    if (/^(hidden|submit|button|reset|image)$/.test(f.type) || !visible(f)) continue;
    const ok = (f.id && document.querySelector(`label[for="${CSS.escape(f.id)}"]`)) || f.closest('label') || f.getAttribute('aria-label') || f.getAttribute('aria-labelledby') || f.getAttribute('title');
    if (ok) lab.pass(); else lab.fail(f, `<${f.tagName.toLowerCase()}${f.type ? ` type="${f.type}"` : ''}>${f.placeholder ? ` placeholder only: “${f.placeholder}”` : ''}`);
  }

  // 4. Buttons & links names
  const names = check('names', 'Buttons & links without names', 'issue', (n) => `${n} interactive element${n === 1 ? ' has' : 's have'} no accessible name`);
  for (const el of document.querySelectorAll('a[href], button, [role="button"], [role="link"]')) {
    if (!visible(el)) continue;
    if (accName(el)) names.pass(); else names.fail(el, el.tagName === 'A' ? `Link to ${el.getAttribute('href')?.slice(0, 60)}` : 'Icon-only button');
  }

  // 5. Document language & title
  const doc = check('document', 'Document metadata', 'issue', (n) => `${n} page-level problem${n === 1 ? '' : 's'} (language / title)`);
  if (document.documentElement.getAttribute('lang')) doc.pass(); else doc.fail(null, 'Missing <html lang="…">');
  if (document.title.trim()) doc.pass(); else doc.fail(null, 'Missing <title>');

  // 6. Zoom
  const zoom = check('zoom', 'Zoom disabled', 'issue', () => 'Viewport meta prevents pinch zoom');
  const vp = document.querySelector('meta[name="viewport"]')?.content || '';
  if (/user-scalable\s*=\s*(no|0)/i.test(vp) || (/maximum-scale\s*=\s*([\d.]+)/i.exec(vp)?.[1] ?? 5) < 2) zoom.fail(null, vp); else zoom.pass();

  // 7. Headings
  const head = check('headings', 'Heading structure', 'warning', (n) => `${n} heading${n === 1 ? '' : 's'} skip a level or the page lacks an <h1>`);
  const hs = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(visible);
  if (!hs.some((h) => h.tagName === 'H1')) head.fail(null, 'No <h1> on the page'); else head.pass();
  let prev = 0;
  for (const h of hs) {
    const lvl = +h.tagName[1];
    if (prev && lvl > prev + 1) head.fail(h, `h${prev} → h${lvl}`); else head.pass();
    prev = lvl;
  }

  // 8. Duplicate ids
  const dup = check('ids', 'Duplicate IDs', 'warning', (n) => `${n} id value${n === 1 ? ' is' : 's are'} used more than once`);
  const ids = new Map();
  for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) || []).concat(el));
  for (const [id, list] of ids) { if (list.length > 1) dup.fail(list[1], `id="${id}" ×${list.length}`); else dup.pass(); }

  const passed = checks.reduce((s, c) => s + c.passed, 0);
  const issues = checks.filter((c) => c.severity === 'issue').reduce((s, c) => s + c.failed, 0);
  const warnings = checks.filter((c) => c.severity === 'warning').reduce((s, c) => s + c.failed, 0);
  // every analyzed element counts once, so checks weigh by how many elements they analyzed; failed warnings count half
  const score = passed + issues + warnings ? Math.round((passed / (passed + issues + warnings * 0.5)) * 100) : 100;
  return {
    url: location.href,
    title: document.title,
    score,
    truncated: bodyEls.length > 9000, // contrast/readability only covered the first 9000 elements
    passed,
    issues,
    warnings,
    checks: checks.map((c) => ({ id: c.id, title: c.title, severity: c.severity, passed: c.passed, failed: c.failed, items: c.items, summary: c.describe(c.failed) })),
  };
}

/* Scroll to and flash-outline an element on the page. */
export function highlightOnPage(selector, label) {
  let el = null;
  try { el = selector ? document.querySelector(selector) : null; } catch {}
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const r0 = el.getBoundingClientRect();
  const box = document.createElement('div');
  box.style.cssText = `all:initial;position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #4a9df0;border-radius:6px;background:rgba(74,157,240,.12);box-shadow:0 0 0 4px rgba(74,157,240,.18);transition:opacity .4s`;
  const tag = document.createElement('div');
  tag.textContent = label || selector;
  tag.style.cssText = 'all:initial;position:absolute;left:-2px;top:100%;margin-top:6px;font:600 11px/1 system-ui,sans-serif;color:#fff;background:#4a9df0;padding:5px 8px;border-radius:6px;white-space:nowrap';
  box.appendChild(tag);
  document.documentElement.appendChild(box);
  const place = () => { const r = el.getBoundingClientRect(); Object.assign(box.style, { left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' }); };
  place();
  const t = setInterval(place, 50);
  setTimeout(() => { box.style.opacity = '0'; }, 2600);
  setTimeout(() => { clearInterval(t); box.remove(); }, 3100);
  return !!r0;
}
