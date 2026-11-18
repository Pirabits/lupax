// Minimal ZIP writer (STORE method, no compression) — enough for exporting assets.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const ASSET_FOLDERS = { image: 'images', svg: 'svgs', font: 'fonts', icon: 'icons', background: 'backgrounds' };

const RASTER = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'apng', 'bmp', 'ico', 'jfif', 'tif', 'tiff'];
const ASSET_EXTENSIONS = {
  image: [...RASTER, 'svg'], background: [...RASTER, 'svg'], icon: [...RASTER, 'svg'], svg: ['svg'],
  font: ['woff', 'woff2', 'ttf', 'otf', 'eot'],
};
const ANY_ASSET_EXTENSION = [...new Set(Object.values(ASSET_EXTENSIONS).flat())];
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * File name for a scanned asset ({ name, type, format }). Names come from the page, so path parts, control and bidi
 * characters (U+202E makes "x\u202Egpj.exe" read as "xexe.jpg") are removed, and the extension must be one that
 * type of asset can have: an "image" called setup.exe is saved as setup_exe.bin, never as a program.
 */
export function safeAssetName(a) {
  const allowed = ASSET_EXTENSIONS[a.type] || ANY_ASSET_EXTENSION;
  let name = String(a.name || '').normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]+/gu, '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  const dot = name.lastIndexOf('.');
  let stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (!allowed.includes(ext)) {
    stem = name.replace(/\./g, '_');
    const fmt = String(a.format || '').toLowerCase();
    ext = allowed.includes(fmt) ? fmt : 'bin';
  }
  stem = stem.slice(0, 100).replace(/[\s.]+$/, '') || 'asset';
  if (WINDOWS_RESERVED.test(stem)) stem = `_${stem}`;
  return `${stem}.${ext}`;
}

/** Path inside the export ZIP for a scanned asset: a folder per type, then its safe file name. */
export function assetZipPath(a) {
  return `${ASSET_FOLDERS[a.type] || 'other'}/${safeAssetName(a)}`;
}

/** files: [{ name, data: Uint8Array }] → Blob. Duplicate names get a numeric suffix (icon.svg, icon-2.svg). */
export function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());
  const used = new Set();

  for (const f of files) {
    let name = f.name;
    for (let i = 2; used.has(name); i++) name = f.name.replace(/(\.[^.]*)?$/, `-${i}$1`);
    used.add(name);
    const nameBytes = enc.encode(name);
    const data = f.data;
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, nameBytes, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const cdSize = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
