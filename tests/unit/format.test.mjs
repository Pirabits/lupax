import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stamp, slug, baseName, bytes, clock, esc, ago, blobToDataUrl } from '../../lib/format.js';

test('stamp is sortable local time', () => {
  assert.equal(stamp(new Date(2026, 0, 5, 7, 8, 9)), '2026-01-05-070809');
});

test('slug', () => {
  assert.equal(slug('Héllo, Wörld!'), 'hello-world');
  assert.equal(slug('  --  '), 'capture');
  assert.equal(slug('', 'x'), 'x');
  assert.equal(slug('a'.repeat(80)).length, 48);
});

test('baseName combines host and title without repeating the host', () => {
  assert.equal(baseName('Pricing | Acme', 'https://www.acme.com/pricing'), 'acme-pricing');
  assert.equal(baseName('Acme Store — Home', 'https://acme.com'), 'acme-store');
  assert.equal(baseName('', 'https://docs.example.org/x'), 'docs');
  assert.equal(baseName(undefined, 'not a url'), 'capture');
});

test('bytes', () => {
  assert.equal(bytes(0), '—');
  assert.equal(bytes(512), '512 B');
  assert.equal(bytes(1536), '1.5 KB');
  assert.equal(bytes(20 * 1024 * 1024), '20 MB');
  assert.equal(bytes(null), '—');
});

test('clock', () => {
  assert.equal(clock(0), '00:00');
  assert.equal(clock(61_999), '01:01');
  assert.equal(clock(3_600_000), '60:00');
});

test('esc escapes HTML-significant characters', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});

test('ago', () => {
  assert.equal(ago(Date.now()), 'Just now');
  assert.equal(ago(Date.now() - 5 * 60_000), '5 min ago');
  assert.equal(ago(Date.now() - 3 * 3_600_000), '3 h ago');
});

test('blobToDataUrl', { skip: typeof FileReader === 'undefined' && 'FileReader not available in this Node' }, async () => {
  assert.equal(await blobToDataUrl(new Blob(['hi'], { type: 'text/plain' })), 'data:text/plain;base64,aGk=');
});
