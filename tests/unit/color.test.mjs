import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, toHex, toRgb, toHsl, hsl, contrast, rating, isLight, format } from '../../lib/color.js';

test('parseColor handles hex (3/4/6/8), rgb() and rgba() forms', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#7241FF'), { r: 114, g: 65, b: 255, a: 1 });
  assert.deepEqual(parseColor('#00000080'), { r: 0, g: 0, b: 0, a: 0.502 });
  assert.deepEqual(parseColor('#f008'), { r: 255, g: 0, b: 0, a: 0.533 });
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 });
  assert.deepEqual(parseColor('rgba(1,2,3,0.5)'), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.deepEqual(parseColor('rgb(1 2 3 / 40%)'), { r: 1, g: 2, b: 3, a: 0.4 });
  assert.equal(parseColor('papayawhip'), null);
  assert.equal(parseColor('#12'), null);
});

test('conversions', () => {
  const c = parseColor('#7241ff');
  assert.equal(toHex(c), '#7241FF');
  assert.equal(toHex({ r: 0, g: 0, b: 0, a: 0.5 }), '#00000080');
  assert.equal(toHex({ r: 300, g: -4, b: 12.6 }), '#FF000D', 'clamps and rounds');
  assert.equal(toRgb(c), 'rgb(114, 65, 255)');
  assert.deepEqual(hsl(c), { h: 255, s: 100, l: 63 });
  assert.equal(toHsl({ r: 255, g: 0, b: 0, a: 0.5 }), 'hsla(0, 100%, 50%, 0.5)');
  assert.equal(format('#ff0000', 'rgb'), 'rgb(255, 0, 0)');
  assert.equal(format('not a color', 'rgb'), 'not a color');
});

test('WCAG contrast ratios', () => {
  assert.equal(contrast('#000', '#fff'), 21);
  assert.equal(contrast('#fff', '#fff'), 1);
  assert.equal(contrast('#777', '#fff').toFixed(2), '4.48'); // classic just-fails-AA grey
  assert.equal(contrast('#666666', '#ffffff').toFixed(2), '5.74');
  assert.equal(contrast('#000', 'nope'), null);
  assert.equal(contrast('#123456', '#abcdef'), contrast('#abcdef', '#123456'), 'symmetric');
});

test('rating thresholds for normal and large text', () => {
  assert.equal(rating(7).label, 'Excellent');
  assert.equal(rating(4.5).label, 'Good');
  assert.equal(rating(4.49).label, 'Large only');
  assert.equal(rating(2.99).label, 'Poor');
  assert.equal(rating(4.5, true).label, 'Excellent');
  assert.equal(rating(3, true).label, 'Good');
  assert.equal(rating(null).label, 'n/a');
});

test('isLight', () => {
  assert.equal(isLight('#ffffff'), true);
  assert.equal(isLight('#17122b'), false);
  assert.equal(isLight('rgba(0,0,0,0.2)'), true, 'mostly transparent counts as light');
});
