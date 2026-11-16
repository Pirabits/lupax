// Build a PDF that embeds a JPEG. Tall captures are split across pages of the image width.
// Works in windows and workers (uses OffscreenCanvas).

const MAX_PT = 14000; // PDF page size limit is 14400pt

export async function imageBlobToPdf(blob, { quality = 0.9 } = {}) {
  const bmp = await createImageBitmap(blob);
  const W = bmp.width, H = bmp.height;
  // render at 72dpi-equivalent points; scale down if wider than limit
  const scale = Math.min(1, MAX_PT / W);
  const pageWpt = W * scale;
  const pageHpx = Math.min(H, Math.floor(Math.min(MAX_PT, pageWpt * 1.4142 * 3) / scale)); // up to ~3 A-ratio pages tall
  const slices = [];
  for (let y = 0; y < H; y += pageHpx) {
    const h = Math.min(pageHpx, H - y);
    const c = new OffscreenCanvas(W, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, h);
    ctx.drawImage(bmp, 0, y, W, h, 0, 0, W, h);
    const jpg = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer());
    slices.push({ jpg, w: W, h, wpt: pageWpt, hpt: h * scale });
  }
  bmp.close();
  return buildPdf(slices);
}

/** pages: [{ jpg: Uint8Array, w, h (pixels), wpt, hpt (points) }] → PDF Blob. Exported for tests. */
export function buildPdf(pages) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = (data) => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(b);
    pos += b.length;
  };
  const obj = (n, body) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n`);
    for (const part of [].concat(body)) push(part);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length;
  // 1: catalog, 2: pages, then per page: page, image, content
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  pages.forEach((p, i) => {
    const pageN = 3 + i * 3, imgN = pageN + 1, contN = pageN + 2;
    const w = p.wpt.toFixed(2), h = p.hpt.toFixed(2);
    obj(pageN, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contN} 0 R >>`);
    obj(imgN, [
      `<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpg.length} >>\nstream\n`,
      p.jpg,
      '\nendstream',
    ]);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(contN, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const total = 3 + n * 3;
  const xref = pos;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}
