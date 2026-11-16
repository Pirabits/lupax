// Design-token export from a scanStyles() result. Pure functions (unit-tested in tests/unit/tokens.test.mjs).
import { parseColor, hsl } from '../lib/color.js';

/** Returns role(hexValue) → 'Primary / Brand' | 'Secondary / Accent' | 'Text' | 'Background' | 'Border' | 'Neutral' | 'Accent' | 'Color'. */
export function colorRoles(colors) {
  const roles = new Map();
  const vivid = colors.filter((c) => { const p = parseColor(c.value); if (!p || p.a < 1) return false; const { s, l } = hsl(p); return s >= 35 && l > 12 && l < 88; });
  if (vivid[0]) roles.set(vivid[0].value, 'Primary / Brand');
  if (vivid[1]) roles.set(vivid[1].value, 'Secondary / Accent');
  const by = (use) => colors.filter((c) => c.uses[use]).sort((a, b) => b.uses[use] - a.uses[use])[0];
  for (const [use, label] of [['text', 'Text'], ['background', 'Background'], ['border', 'Border']]) {
    const c = by(use);
    if (c && !roles.has(c.value)) roles.set(c.value, label);
  }
  return (v) => {
    if (roles.has(v)) return roles.get(v);
    const p = parseColor(v);
    if (!p) return 'Color';
    return hsl(p).s < 12 ? 'Neutral' : 'Accent';
  };
}

function tokenName(role, used) {
  const base = role.split('/')[0].trim().toLowerCase().replace(/\s+/g, '-');
  let name = base;
  for (let k = 2; used.has(name); k++) name = `${base}-${k}`;
  used.add(name);
  return name;
}

export function buildTokens(d) {
  const role = colorRoles(d.colors);
  const used = new Set();
  const colors = d.colors.slice(0, 24).map((c) => ({ name: tokenName(role(c.value), used), value: c.value }));
  const type = d.typography.groups.map((g) => ({
    name: g.key === 'body' ? 'body' : g.key === 'small' ? 'caption' : g.key,
    family: g.primary.family, size: g.primary.size, weight: g.primary.weight, lineHeight: g.primary.lineHeight, letterSpacing: g.primary.letterSpacing,
  }));
  const spacing = d.spacing.scale.map((s, i) => ({ name: String(i + 1), value: `${s.value}px` }));
  const radii = d.spacing.radii.map((r, i) => ({ name: ['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'][i] || String(i), value: r.value }));
  const shadows = d.spacing.shadows.slice(0, 4).map((s, i) => ({ name: ['sm', 'md', 'lg', 'xl'][i], value: s.value }));
  return { colors, type, spacing, radii, shadows };
}

/** W3C design-tokens format. */
export function tokensJson(d) {
  const t = buildTokens(d);
  return JSON.stringify({
    $description: `Design tokens extracted by LupaX from ${d.url}`,
    color: Object.fromEntries(t.colors.map((c) => [c.name, { $type: 'color', $value: c.value }])),
    typography: Object.fromEntries(t.type.map((x) => [x.name, { $type: 'typography', $value: { fontFamily: x.family, fontSize: x.size, fontWeight: +x.weight || x.weight, lineHeight: x.lineHeight, letterSpacing: x.letterSpacing } }])),
    spacing: Object.fromEntries(t.spacing.map((s) => [s.name, { $type: 'dimension', $value: s.value }])),
    radius: Object.fromEntries(t.radii.map((r) => [r.name, { $type: 'dimension', $value: r.value }])),
    shadow: Object.fromEntries(t.shadows.map((s) => [s.name, { $type: 'shadow', $value: s.value }])),
  }, null, 2);
}

export function tokensCss(d) {
  const t = buildTokens(d);
  const lines = [':root {', '  /* Colors */', ...t.colors.map((c) => `  --color-${c.name}: ${c.value};`), '', '  /* Typography */'];
  for (const x of t.type) lines.push(`  --font-${x.name}-family: ${x.family};`, `  --font-${x.name}-size: ${x.size};`, `  --font-${x.name}-weight: ${x.weight};`, `  --font-${x.name}-line-height: ${x.lineHeight};`);
  lines.push('', '  /* Spacing */', ...t.spacing.map((s) => `  --space-${s.name}: ${s.value};`));
  lines.push('', '  /* Radius */', ...t.radii.map((r) => `  --radius-${r.name}: ${r.value};`));
  lines.push('', '  /* Shadows */', ...t.shadows.map((s) => `  --shadow-${s.name}: ${s.value};`), '}');
  return lines.join('\n');
}

export function tokensTailwind(d) {
  const t = buildTokens(d);
  const familyKey = (f) => f.split(',')[0].replace(/["']/g, '').trim().toLowerCase().replace(/\s+/g, '-');
  const familyList = (f) => f.split(',').map((x) => x.trim().replace(/["']/g, ''));
  const obj = {
    theme: { extend: {
      colors: Object.fromEntries(t.colors.map((c) => [c.name, c.value])),
      fontFamily: Object.fromEntries(new Map(t.type.map((x) => [familyKey(x.family), familyList(x.family)]))),
      fontSize: Object.fromEntries(t.type.map((x) => [x.name, [x.size, { lineHeight: x.lineHeight, fontWeight: x.weight }]])),
      spacing: Object.fromEntries(t.spacing.map((s) => [s.name, s.value])),
      borderRadius: Object.fromEntries(t.radii.map((r) => [r.name, r.value])),
      boxShadow: Object.fromEntries(t.shadows.map((s) => [s.name, s.value])),
    } },
  };
  return `/** Tailwind theme extracted by LupaX from ${d.url} */\nmodule.exports = ${JSON.stringify(obj, null, 2)};\n`;
}

/** CSS declarations for one typography variant. */
export function cssFor(v) {
  return [`font-family: ${v.family};`, `font-size: ${v.size};`, `font-weight: ${v.weight};`, `line-height: ${v.lineHeight};`,
    v.letterSpacing && v.letterSpacing !== 'normal' ? `letter-spacing: ${v.letterSpacing};` : '', v.transform && v.transform !== 'none' ? `text-transform: ${v.transform};` : '',
    v.color ? `color: ${v.color};` : ''].filter(Boolean).join('\n');
}
