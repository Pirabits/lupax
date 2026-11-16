import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf } from '../../lib/pdf.js';

// Not a decodable JPEG, but buildPdf only embeds the bytes; structure is what we check.
const fakeJpg = (n) => new Uint8Array(n).map((_, i) => i % 251);
const latin1 = async (blob) => Buffer.from(await blob.arrayBuffer()).toString('latin1');

test('header, trailer and page count', async () => {
  const pdf = await latin1(buildPdf([{ jpg: fakeJpg(100), w: 10, h: 20, wpt: 10, hpt: 20 }, { jpg: fakeJpg(50), w: 10, h: 5, wpt: 10, hpt: 5 }]));
  assert.ok(pdf.startsWith('%PDF-1.4\n'));
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
  assert.match(pdf, /\/Type \/Pages \/Kids \[3 0 R 6 0 R\] \/Count 2/);
  assert.match(pdf, /\/MediaBox \[0 0 10\.00 20\.00\]/);
  assert.match(pdf, /\/Width 10 \/Height 5 .*\/Filter \/DCTDecode \/Length 50/);
});

test('every xref offset points at its object, and startxref points at the xref table', async () => {
  const pdf = await latin1(buildPdf([{ jpg: fakeJpg(300), w: 3, h: 4, wpt: 3, hpt: 4 }, { jpg: fakeJpg(7), w: 3, h: 1, wpt: 3, hpt: 1 }]));
  const startxref = +pdf.match(/startxref\n(\d+)\n%%EOF/)[1];
  assert.ok(pdf.startsWith('xref\n', startxref));
  const [, first, count] = pdf.slice(startxref).match(/^xref\n(\d+) (\d+)\n/);
  assert.equal(+first, 0);
  const rows = pdf.slice(startxref).split('\n').slice(2, 2 + +count);
  assert.equal(rows[0], '0000000000 65535 f ');
  for (let n = 1; n < +count; n++) {
    const off = +rows[n].slice(0, 10);
    assert.ok(pdf.startsWith(`${n} 0 obj\n`, off), `object ${n} at offset ${off}`);
  }
  assert.match(pdf, new RegExp(`/Size ${count} `));
});

test('image stream length matches the embedded bytes', async () => {
  const jpg = fakeJpg(1234);
  const pdf = await latin1(buildPdf([{ jpg, w: 1, h: 1, wpt: 1, hpt: 1 }]));
  const at = pdf.indexOf('stream\n', pdf.indexOf('/Length 1234')) + 'stream\n'.length;
  assert.equal(pdf.slice(at + 1234, at + 1234 + '\nendstream'.length), '\nendstream');
});
