// Code injected into pages (lib/scan.js functions, content/inspector.js) must be self-contained, so the WCAG
// luminance / contrast / alpha-blend helpers are necessarily copied inside each injected function.
// This test extracts those copies from the source and checks they agree with lib/color.js, so they can't drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { luminance, contrast, parseColor } from '../../lib/color.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** All one-line `const <name> = ...;` definitions of `name` in a file, compiled to functions. */
function extract(file, name) {
  const re = new RegExp(`^\\s*const ${name} = (.+);\\s*$`, 'gm');
  const found = [...read(file).matchAll(re)].map((m) => m[1]);
  return found;
}
const compile = (defs) => new Function(`${defs.join('\n')}\nreturn { lum, ratio: typeof ratio === 'function' ? ratio : null, blend: typeof blend === 'function' ? blend : null };`)();

const COPIES = [
  { where: 'lib/scan.js#scanStyles', file: 'lib/scan.js', index: 0 },
  { where: 'lib/scan.js#scanA11y', file: 'lib/scan.js', index: 1 },
  { where: 'content/inspector.js', file: 'content/inspector.js', index: 0 },
];

const grid = [];
for (const r of [0, 17, 64, 119, 128, 200, 255]) for (const g of [0, 85, 170, 255]) for (const b of [0, 51, 153, 255]) grid.push({ r, g, b, a: 1 });

const reference = {
  blend: (top, bot) => { const a = top.a + bot.a * (1 - top.a); return { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a }; },
};

for (const c of COPIES) {
  test(`${c.where} matches lib/color.js`, () => {
    const lums = extract(c.file, 'lum');
    const blends = extract(c.file, 'blend');
    const ratios = extract(c.file, 'ratio').filter((d) => d.startsWith('('));
    assert.ok(lums[c.index], `lum() copy not found in ${c.file} — if it moved, update this test`);
    const fns = compile([`const lum = ${lums[c.index]};`, ...(blends[c.index] ? [`const blend = ${blends[c.index]};`] : []), ...(ratios[c.index] ? [`const ratio = ${ratios[c.index]};`] : [])]);
    for (const x of grid) assert.ok(Math.abs(fns.lum(x) - luminance(x)) < 1e-12, `lum(${JSON.stringify(x)})`);
    if (fns.ratio) {
      for (let i = 0; i < grid.length; i += 7) {
        const a = grid[i], b = grid[grid.length - 1 - i];
        assert.ok(Math.abs(fns.ratio(a, b) - contrast(a, b)) < 1e-12, `ratio(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
      }
    }
    if (fns.blend) {
      const top = { r: 114, g: 65, b: 255, a: 0.4 }, bot = { r: 255, g: 255, b: 255, a: 1 };
      assert.deepEqual(fns.blend(top, bot), reference.blend(top, bot));
    }
  });
}

test('the inspector inlines the same contrast formula', () => {
  // content/inspector.js computes the ratio inline rather than via a helper
  assert.match(read('content/inspector.js'), /\(Math\.max\(lum\(blend\(fg, bg\)\), lum\(bg\)\) \+ 0\.05\) \/ \(Math\.min\(lum\(blend\(fg, bg\)\), lum\(bg\)\) \+ 0\.05\)/);
});

test('every injected parse() copy is identical and reads rgb()/rgba() like lib/color.js', () => {
  // the oklch()/lab()/color() fallback needs a canvas, so it is covered end-to-end (tests/e2e "oklch"); here we pin the copies together
  const copies = [...extract('lib/scan.js', 'parse'), ...extract('content/inspector.js', 'parse')];
  assert.equal(copies.length, 3, 'expected parse() in scanStyles, scanA11y and the inspector — if one moved, update this test');
  assert.equal(new Set(copies).size, 1, 'parse() copies have drifted apart');
  const parse = new Function(`const parse = ${copies[0]}; return parse;`)();
  for (const s of ['rgb(114, 65, 255)', 'rgba(0, 0, 0, 0.5)', 'rgba(255, 255, 255, 0)', 'rgb(1 2 3 / 0.25)']) {
    const want = parseColor(s);
    assert.deepEqual(parse(s), want, s);
  }
  assert.equal(parse(''), null);
});
