import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorRoles, buildTokens, tokensJson, tokensCss, tokensTailwind, cssFor } from '../../popup/tokens.js';

const scan = {
  url: 'https://example.com/',
  colors: [
    { value: '#666666', count: 40, uses: { text: 40 } },
    { value: '#7241FF', count: 12, uses: { background: 8, text: 4 } },
    { value: '#FFFFFF', count: 30, uses: { background: 30 } },
    { value: '#FB3AA2', count: 3, uses: { text: 3 } },
    { value: '#E6E6E6', count: 9, uses: { border: 9 } },
    { value: '#0E0E0E', count: 8, uses: { text: 8 } },
  ],
  typography: { groups: [
    { key: 'h1', primary: { family: 'Georgia, serif', size: '64px', weight: '700', lineHeight: '72px', letterSpacing: 'normal' } },
    { key: 'body', primary: { family: '"Inter", Arial, sans-serif', size: '18px', weight: '400', lineHeight: '28px', letterSpacing: 'normal' } },
    { key: 'small', primary: { family: 'Arial', size: '11px', weight: '400', lineHeight: 'normal', letterSpacing: '0.2px' } },
  ] },
  spacing: {
    scale: [{ value: 8 }, { value: 16 }, { value: 24 }],
    radii: [{ value: '10px' }, { value: '16px' }],
    shadows: [{ value: '0 4px 16px rgba(0,0,0,.06)' }],
  },
};

test('color roles: vivid colors are brand/accent, most-used text/background/border get named roles', () => {
  const role = colorRoles(scan.colors);
  assert.equal(role('#7241FF'), 'Primary / Brand');
  assert.equal(role('#FB3AA2'), 'Secondary / Accent');
  assert.equal(role('#666666'), 'Text');
  assert.equal(role('#FFFFFF'), 'Background');
  assert.equal(role('#E6E6E6'), 'Border');
  assert.equal(role('#0E0E0E'), 'Neutral');
  assert.equal(role('#00FF00'), 'Accent');
  assert.equal(role('garbage'), 'Color');
});

test('token names are unique', () => {
  const names = buildTokens({ ...scan, colors: [...scan.colors, { value: '#111111', count: 1, uses: {} }, { value: '#222222', count: 1, uses: {} }] }).colors.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('neutral') && names.includes('neutral-2') && names.includes('neutral-3'));
});

test('W3C JSON export', () => {
  const j = JSON.parse(tokensJson(scan));
  assert.deepEqual(j.color.primary, { $type: 'color', $value: '#7241FF' });
  assert.equal(j.typography.h1.$value.fontWeight, 700);
  assert.equal(j.typography.caption.$value.fontSize, '11px');
  assert.deepEqual(j.spacing['2'], { $type: 'dimension', $value: '16px' });
  assert.deepEqual(j.radius.md, { $type: 'dimension', $value: '16px' });
  assert.equal(j.shadow.sm.$value, '0 4px 16px rgba(0,0,0,.06)');
});

test('CSS variables export', () => {
  const css = tokensCss(scan);
  assert.ok(css.startsWith(':root {') && css.endsWith('}'));
  assert.match(css, /--color-primary: #7241FF;/);
  assert.match(css, /--font-body-size: 18px;/);
  assert.match(css, /--space-3: 24px;/);
  assert.match(css, /--radius-sm: 10px;/);
});

test('Tailwind export is a loadable CommonJS module', () => {
  const src = tokensTailwind(scan);
  const mod = { exports: null };
  new Function('module', src)(mod);
  const ext = mod.exports.theme.extend;
  assert.equal(ext.colors.primary, '#7241FF');
  assert.deepEqual(ext.fontFamily.inter, ['Inter', 'Arial', 'sans-serif']);
  assert.deepEqual(ext.fontSize.h1, ['64px', { lineHeight: '72px', fontWeight: '700' }]);
  assert.equal(ext.spacing['1'], '8px');
});

test('cssFor omits defaults', () => {
  assert.equal(cssFor({ family: 'Arial', size: '11px', weight: '400', lineHeight: 'normal', letterSpacing: 'normal', transform: 'none' }),
    'font-family: Arial;\nfont-size: 11px;\nfont-weight: 400;\nline-height: normal;');
  assert.match(cssFor({ family: 'A', size: '1px', weight: '1', lineHeight: '1', letterSpacing: '2px', transform: 'uppercase', color: '#000' }), /letter-spacing: 2px;\ntext-transform: uppercase;\ncolor: #000;/);
});

test('Tailwind export cannot be broken out of by a hostile page URL', () => {
  for (const url of ['https://evil.test/a*/globalThis.pwned=1;/*', 'https://evil.test/#\u2028globalThis.pwned=1', 'https://evil.test/#\nglobalThis.pwned=1']) {
    delete globalThis.pwned;
    const mod = { exports: null };
    new Function('module', tokensTailwind({ ...scan, url }))(mod);
    assert.equal(globalThis.pwned, undefined, `page URL ran as code: ${JSON.stringify(url)}`);
    assert.equal(mod.exports.theme.extend.colors.primary, '#7241FF');
  }
});
