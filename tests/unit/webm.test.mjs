import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDuration } from '../../lib/webm.js';

const bytes = (...parts) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...new TextEncoder().encode(p)] : [...p])));
const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

/** A MediaRecorder-shaped WebM head: EBML header, Segment of unknown size, Info (no Duration), Tracks, one Cluster. */
function sampleWebm({ info = [], seekHead = false } = {}) {
  const infoBody = bytes([0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40], [0x4d, 0x80, 0x84], 'test', ...info);
  return bytes(
    [0x1a, 0x45, 0xdf, 0xa3, 0x84], 'webm',
    [0x18, 0x53, 0x80, 0x67], UNKNOWN,
    seekHead ? [0x11, 0x4d, 0x9b, 0x74, 0x80] : [],
    [0x15, 0x49, 0xa9, 0x66, 0x80 | infoBody.length], infoBody,
    [0x16, 0x54, 0xae, 0x6b, 0x82, 0xec, 0x80],
    [0x1f, 0x43, 0xb6, 0x75], UNKNOWN, [0xe7, 0x81, 0x00], 'frames',
  );
}

/** Find the Duration element (0x4489) and read its float. */
function readDuration(b) {
  for (let i = 0; i < b.length - 2; i++) {
    if (b[i] === 0x44 && b[i + 1] === 0x89) {
      const dv = new DataView(b.buffer, b.byteOffset + i + 3);
      return b[i + 2] === 0x88 ? dv.getFloat64(0) : dv.getFloat32(0);
    }
  }
  return null;
}

const run = async (src, ms) => new Uint8Array(await (await withDuration(new Blob([src], { type: 'video/webm' }), ms)).arrayBuffer());

test('adds a Duration to Info, in TimecodeScale units, and keeps every other byte', async () => {
  const src = sampleWebm();
  const out = await run(src, 12_345);
  assert.equal(readDuration(out), 12_345); // TimecodeScale 1,000,000 ns = 1 ms
  assert.equal(out.length, src.length + 11 + 7); // Duration element + Info size widened to 8 bytes
  const tail = new TextDecoder().decode(out.slice(-6));
  assert.equal(tail, 'frames', 'clusters are passed through untouched');
  // the new Info parses: ID, 8-byte size, then exactly its children
  const at = out.indexOf(0x15, 20);
  assert.deepEqual([...out.slice(at, at + 5)], [0x15, 0x49, 0xa9, 0x66, 0x01]);
  const size = Number(new DataView(out.buffer, at + 4, 8).getBigUint64(0) & 0x00ffffffffffffffn);
  assert.equal(out[at + 12 + size], 0x16, 'Tracks starts right after the rewritten Info');
});

test('overwrites an existing Duration in place', async () => {
  const src = sampleWebm({ info: [[0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0]] });
  const out = await run(src, 2_000);
  assert.equal(out.length, src.length);
  assert.equal(readDuration(out), 2_000);
});

test('leaves files it should not touch unchanged', async () => {
  const withSeekHead = sampleWebm({ seekHead: true }); // byte offsets would shift
  assert.deepEqual(await run(withSeekHead, 1000), withSeekHead);
  assert.deepEqual(await run(sampleWebm(), 0), sampleWebm());
  assert.deepEqual(await run(sampleWebm(), undefined), sampleWebm());
  const garbage = bytes('not a webm file at all');
  assert.deepEqual(await run(garbage, 1000), garbage);
});
