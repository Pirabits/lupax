import { blobToDataUrl } from './format.js';

/** 360×225 JPEG data URL of an image (ImageBitmap / canvas / VideoFrame), cover-scaled and top-aligned on white. */
export async function thumbnail(img) {
  const W = 360, H = 225;
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  const k = Math.max(W / img.width, H / img.height);
  ctx.drawImage(img, (W - img.width * k) / 2, 0, img.width * k, img.height * k);
  return blobToDataUrl(await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 }));
}
