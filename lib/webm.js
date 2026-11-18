// Chrome's MediaRecorder writes WebM without a Duration, so players show the length as unknown and can't seek.
// withDuration() writes one into the Segment's Info element. Only the head of the file is read and rewritten;
// the rest is passed through as a Blob slice, so large recordings are not loaded into memory.

const ID = { EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, SeekHead: 0x114d9b74, Cluster: 0x1f43b675, TimecodeScale: 0x2ad7b1, Duration: 0x4489 };
const HEAD_BYTES = 64 * 1024; // Info comes right after the EBML header, well inside this

/** EBML variable-length integer at `pos`: { len, value } (value keeps the marker bit for IDs), or null if truncated. */
function vint(b, pos, keepMarker) {
  if (pos >= b.length) return null;
  const first = b[pos];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || pos + len > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> len);
  let unknown = value === (0xff >> len);
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[pos + i];
    if (b[pos + i] !== 0xff) unknown = false;
  }
  return { len, value, unknown: !keepMarker && unknown };
}

/** Element header at `pos`: { id, size (null = unknown), start of data, end of element }. */
function element(b, pos) {
  const id = vint(b, pos, true);
  if (!id) return null;
  const size = vint(b, pos + id.len, false);
  if (!size) return null;
  const start = pos + id.len + size.len;
  return { id: id.value, size: size.unknown ? null : size.value, start, end: size.unknown ? null : start + size.value };
}

const readUint = (b, start, end) => { let v = 0; for (let i = start; i < end; i++) v = v * 256 + b[i]; return v; };

function durationElement(value) {
  const out = new Uint8Array(11);
  out.set([0x44, 0x89, 0x88]); // Duration, size 8
  new DataView(out.buffer).setFloat64(3, value);
  return out;
}

/**
 * Returns `blob` with its Duration set to `ms` milliseconds. Returns `blob` unchanged when the file doesn't look like
 * MediaRecorder output (a SeekHead would hold byte offsets that inserting bytes breaks) or `ms` isn't usable.
 */
export async function withDuration(blob, ms) {
  if (!(ms > 0) || !Number.isFinite(ms)) return blob;
  const b = new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer());
  const ebml = element(b, 0);
  if (!ebml || ebml.id !== ID.EBML || ebml.end == null) return blob;
  const seg = element(b, ebml.end);
  if (!seg || seg.id !== ID.Segment) return blob;
  for (let pos = seg.start; pos < b.length;) {
    const el = element(b, pos);
    if (!el || el.end == null || el.id === ID.SeekHead || el.id === ID.Cluster) return blob;
    if (el.id === ID.Info) {
      if (el.end > b.length) return blob;
      let scale = 1_000_000, dur = null;
      for (let p = el.start; p < el.end;) {
        const c = element(b, p);
        if (!c || c.end == null || c.end > el.end) return blob;
        if (c.id === ID.TimecodeScale) scale = readUint(b, c.start, c.end) || scale;
        if (c.id === ID.Duration) dur = c;
        p = c.end;
      }
      const value = (ms * 1_000_000) / scale;
      if (dur) {
        // already has one: overwrite it in place (4- or 8-byte float)
        const head = b.slice(0, dur.end);
        const dv = new DataView(head.buffer, dur.start, dur.end - dur.start);
        if (dur.end - dur.start === 8) dv.setFloat64(0, value);
        else if (dur.end - dur.start === 4) dv.setFloat32(0, value);
        else return blob;
        return new Blob([head, blob.slice(dur.end)], { type: blob.type });
      }
      const body = b.slice(el.start, el.end);
      const add = durationElement(value);
      const size = body.length + add.length;
      // Info's ID, then its new size as an 8-byte vint (0x01 marker + 7 bytes), then the old children and Duration
      const header = new Uint8Array(4 + 8);
      header.set([0x15, 0x49, 0xa9, 0x66, 0x01]);
      for (let i = 0, v = size; i < 7; i++, v = Math.floor(v / 256)) header[11 - i] = v & 0xff;
      return new Blob([b.slice(0, pos), header, body, add, blob.slice(el.end)], { type: blob.type });
    }
    pos = el.end;
  }
  return blob;
}
