// Persist a MediaRecorder's output to IndexedDB as it is produced, then assemble it into a history item.
// Used by both the tab recorder (offscreen.js) and the window/desktop recorder (recorder.js).
import { appendChunk, assembleChunks, clearChunks, putItem } from './db.js';

/**
 * Call before recorder.start(). `meta` ({ name, title, url }) is stored so an interrupted recording can be recovered.
 * Chunks are written in order; `save()` waits for pending writes (the final dataavailable fires before 'stop').
 */
export function chunkSink(recorder, meta = {}) {
  const rec = crypto.randomUUID();
  let seq = 0;
  let error = null;
  let writes = appendChunk(rec, -1, null, { ...meta, mimeType: recorder.mimeType }).catch((e) => { error = e; });
  recorder.addEventListener('dataavailable', (e) => {
    if (!e.data.size) return;
    const n = seq++;
    writes = writes.then(() => appendChunk(rec, n, e.data)).catch((err) => { error ??= err; });
  });
  return {
    rec,
    /** Assemble the chunks into a history item ({ ...item, blob }) and drop the chunks. Returns the item id. */
    async save(item) {
      await writes;
      if (error) throw error;
      const blob = await assembleChunks(rec, recorder.mimeType);
      if (!blob.size) throw new Error('The recording is empty');
      const id = await putItem({ ...item, blob });
      await clearChunks(rec);
      return id;
    },
    async discard() {
      await writes;
      await clearChunks(rec).catch(() => {});
    },
  };
}
