// Composite a circular webcam bubble onto a screen video track.
// Frame-driven via insertable streams, so it also works in hidden (offscreen) documents.

export function composeWithCamera(screenTrack, camTrack, { position = 'bottom-left', sizeRatio = 0.2 } = {}) {
  const screenReader = new MediaStreamTrackProcessor({ track: screenTrack }).readable.getReader();
  const camReader = new MediaStreamTrackProcessor({ track: camTrack }).readable.getReader();
  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  const writer = generator.writable.getWriter();

  let camFrame = null;
  let running = true;
  let canvas = null, ctx = null;

  (async () => {
    while (running) {
      const { value, done } = await camReader.read();
      if (done) break;
      // a read pending when stop() ran can still resolve: close that frame, nothing will draw it
      if (!running) { value.close(); break; }
      camFrame?.close();
      camFrame = value;
    }
  })().catch(() => {});

  (async () => {
    while (running) {
      const { value: frame, done } = await screenReader.read();
      if (done) break;
      const W = frame.displayWidth, H = frame.displayHeight;
      if (!canvas || canvas.width !== W || canvas.height !== H) {
        canvas = new OffscreenCanvas(W, H);
        ctx = canvas.getContext('2d');
      }
      ctx.drawImage(frame, 0, 0, W, H);
      if (camFrame) {
        const d = Math.round(Math.min(W, H) * sizeRatio);
        const m = Math.round(d * 0.16);
        const x = position.includes('right') ? W - d - m : m;
        const y = position.includes('top') ? m : H - d - m;
        const cw = camFrame.displayWidth, ch = camFrame.displayHeight, s = Math.min(cw, ch);
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        // mirror like a selfie view
        ctx.translate(x + d, y);
        ctx.scale(-1, 1);
        ctx.drawImage(camFrame, (cw - s) / 2, (ch - s) / 2, s, s, 0, 0, d, d);
        ctx.restore();
        ctx.lineWidth = Math.max(3, d * 0.03);
        const g = ctx.createLinearGradient(x, y, x + d, y + d);
        g.addColorStop(0, '#7ab8f5');
        g.addColorStop(1, '#3d8ee6');
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      const out = new VideoFrame(canvas, { timestamp: frame.timestamp });
      frame.close();
      try { await writer.write(out); } catch { out.close(); break; }
    }
  })().catch(() => {});

  return {
    track: generator,
    stop() {
      running = false;
      camFrame?.close();
      camFrame = null;
      screenReader.cancel().catch(() => {});
      camReader.cancel().catch(() => {});
      writer.close().catch(() => {});
    },
  };
}
