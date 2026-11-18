import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { makeZip, assetZipPath, safeAssetName } from '../../lib/zip.js';

const enc = new TextEncoder();

/** Minimal reader for STORE-method zips: walks the central directory and checks each local entry. */
function readZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.byteLength - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50, 'end of central directory signature');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50, 'central directory signature');
    const flags = dv.getUint16(p + 8, true);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    assert.equal(dv.getUint32(local, true), 0x04034b50, `local header for ${name}`);
    const dataStart = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    entries.push({ name, flags, crc, data: buf.subarray(dataStart, dataStart + size) });
    p += 46 + nameLen;
  }
  return entries;
}

const zipBytes = async (files) => new Uint8Array(await makeZip(files).arrayBuffer());

test('entries round-trip with correct CRC-32', async () => {
  const files = [{ name: 'a.txt', data: enc.encode('hello') }, { name: 'dir/b.bin', data: new Uint8Array([0, 255, 7]) }];
  const entries = readZip(await zipBytes(files));
  assert.deepEqual(entries.map((e) => e.name), ['a.txt', 'dir/b.bin']);
  for (const [i, e] of entries.entries()) {
    assert.deepEqual([...e.data], [...files[i].data]);
    assert.equal(e.crc, zlib.crc32(files[i].data));
  }
});

test('duplicate names get a numeric suffix before the extension', async () => {
  const d = enc.encode('x');
  const names = readZip(await zipBytes([
    { name: 'svgs/icon.svg', data: d }, { name: 'svgs/icon.svg', data: d }, { name: 'svgs/icon.svg', data: d }, { name: 'README', data: d }, { name: 'README', data: d },
  ])).map((e) => e.name);
  assert.deepEqual(names, ['svgs/icon.svg', 'svgs/icon-2.svg', 'svgs/icon-3.svg', 'README', 'README-2']);
});

test('non-ASCII names are UTF-8 flagged', async () => {
  const [e] = readZip(await zipBytes([{ name: 'fonts/ünïcode.woff2', data: enc.encode('f') }]));
  assert.equal(e.name, 'fonts/ünïcode.woff2');
  assert.ok(e.flags & 0x0800);
});

test('empty archive is valid', async () => {
  assert.deepEqual(readZip(await zipBytes([])), []);
});

test('unzip accepts the archive', { skip: !fs.existsSync('/usr/bin/unzip') && 'unzip not installed' }, async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ix-zip-')), 't.zip');
  fs.writeFileSync(file, await zipBytes([{ name: 'a/b.txt', data: enc.encode('ok') }, { name: 'a/b.txt', data: enc.encode('dup') }]));
  execFileSync('unzip', ['-tq', file]);
  fs.rmSync(path.dirname(file), { recursive: true });
});

test('assetZipPath sorts by type, adds a missing extension and strips path parts', () => {
  assert.equal(assetZipPath({ name: 'hero.png', type: 'image' }), 'images/hero.png');
  assert.equal(assetZipPath({ name: 'logo', type: 'svg', format: 'svg' }), 'svgs/logo.svg');
  assert.equal(assetZipPath({ name: 'Inter', type: 'font' }), 'fonts/Inter.bin');
  assert.equal(assetZipPath({ name: 'x.gif', type: 'weird' }), 'other/x.gif');
  assert.equal(assetZipPath({ name: '../../etc/passwd', type: 'image', format: 'txt' }), 'images/____etc_passwd.bin');
  assert.equal(assetZipPath({ name: '..\\..\\a.png', type: 'image' }), 'images/_.._a.png');
  assert.equal(assetZipPath({ name: '', type: 'icon', format: 'ico' }), 'icons/asset.ico');
});

test('safeAssetName never yields a program, a hidden extension or a reserved name', () => {
  // U+202E (right-to-left override) would display "invoice\u202Egpj.exe" as "invoiceexe.jpg"
  assert.equal(safeAssetName({ name: 'invoice\u202Egpj.exe', type: 'image', format: 'exe' }), 'invoicegpj_exe.bin');
  assert.equal(safeAssetName({ name: 'setup.exe', type: 'image', format: 'png' }), 'setup_exe.png');
  assert.equal(safeAssetName({ name: 'run.lnk', type: 'font' }), 'run_lnk.bin');
  assert.equal(safeAssetName({ name: 'tool.hta', type: 'weird' }), 'tool_hta.bin');
  assert.equal(safeAssetName({ name: 'a\u0000b\u200Fc.PNG', type: 'image' }), 'abc.png');
  assert.equal(safeAssetName({ name: 'con.png', type: 'image' }), '_con.png');
  assert.equal(safeAssetName({ name: 'logo.svg ...', type: 'svg' }), 'logo.svg');
  assert.equal(safeAssetName({ name: `${'x'.repeat(300)}.woff2`, type: 'font' }), `${'x'.repeat(100)}.woff2`);
  assert.equal(safeAssetName({ name: 'Inter.woff2', type: 'font' }), 'Inter.woff2');
});
