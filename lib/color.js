export function parseColor(str) {
  str = String(str).trim().toLowerCase();
  let m = str.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? +(n(6) / 255).toFixed(3) : 1 };
  }
  m = str.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    const a = p[3] === undefined ? 1 : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : +p[3];
    return { r: +p[0], g: +p[1], b: +p[2], a };
  }
  return null;
}

const hx = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
export const toHex = ({ r, g, b, a = 1 }) => `#${hx(r)}${hx(g)}${hx(b)}${a < 1 ? hx(a * 255) : ''}`.toUpperCase();
export const rgbTriplet = ({ r, g, b }) => `${r}, ${g}, ${b}`;
export const toRgb = ({ r, g, b, a = 1 }) => (a < 1 ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})`);

export function hsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}
export const hslTriplet = (c) => { const { h, s, l } = hsl(c); return `${h}°, ${s}%, ${l}%`; };
export const toHsl = (c) => { const { h, s, l } = hsl(c); return c.a < 1 ? `hsla(${h}, ${s}%, ${l}%, ${c.a})` : `hsl(${h}, ${s}%, ${l}%)`; };

export function format(str, fmt) {
  const c = parseColor(str);
  if (!c) return str;
  return fmt === 'rgb' ? toRgb(c) : fmt === 'hsl' ? toHsl(c) : toHex(c);
}

export function luminance({ r, g, b }) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a, b) {
  const ca = typeof a === 'string' ? parseColor(a) : a;
  const cb = typeof b === 'string' ? parseColor(b) : b;
  if (!ca || !cb) return null;
  const l1 = luminance(ca), l2 = luminance(cb);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** WCAG rating for normal text. */
export function rating(ratio, large = false) {
  if (ratio == null) return { label: 'n/a', cls: 'warn', icon: 'alert' };
  if (ratio >= (large ? 4.5 : 7)) return { label: 'Excellent', cls: 'good', icon: 'checkCircle' };
  if (ratio >= (large ? 3 : 4.5)) return { label: 'Good', cls: 'good', icon: 'checkCircle' };
  if (ratio >= 3) return { label: 'Large only', cls: 'warn', icon: 'alert' };
  return { label: 'Poor', cls: 'bad', icon: 'xCircle' };
}

export function isLight(str) {
  const c = typeof str === 'string' ? parseColor(str) : str;
  if (!c) return true;
  return c.a < 0.5 || luminance(c) > 0.45;
}

export function saturation(str) {
  const c = parseColor(str);
  return c ? hsl(c).s : 0;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
