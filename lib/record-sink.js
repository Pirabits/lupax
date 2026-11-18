// Persist a MediaRecorder's output to IndexedDB as it is produced, then assemble it into a history item.
// Used by both the tab recorder (offscreen.js) and the window/desktop recorder (recorder.js).
import { appendChunk, assembleChunks, clearChunks, putItem } from './db.js';

/**
 * Call before recorder.start(). `meta` ({ name, title, url }) is stored so an interrupted recording can be recovered.
 * Chunks are written in order; `save()` waits for pending writes (the final dataavailable fires before 'stop').
 * WebM chunks only play back as an unbroken sequence, so the first failed write ends the recording: nothing after it
 * is written (a gap would corrupt the file) and `onError` is called so the caller can stop the recorder.
 */
export function chunkSink(recorder, meta = {}, { onError } = {}) {
  const rec = crypto.randomUUID();
  let seq = 0;
  let error = null;
  const fail = (err) => {
    if (error) return;
    error = err;
    onError?.(err);
  };
  // recorded time, pauses excluded; stored with each chunk so the saved (or recovered) file gets a duration
  let activeMs = 0, since = 0;
  const now = () => performance.now();
  const elapsed = () => activeMs + (since ? now() - since : 0);
  const run = () => { since = now(); };
  const halt = () => { if (since) activeMs += now() - since; since = 0; };
  recorder.addEventListener('start', run);
  recorder.addEventListener('resume', run);
  recorder.addEventListener('pause', halt);
  recorder.addEventListener('stop', halt); // fires after the final dataavailable, which still counts its time
  let writes = appendChunk(rec, -1, null, { ...meta, mimeType: recorder.mimeType }).catch(fail);
  recorder.addEventListener('dataavailable', (e) => {
    if (!e.data.size || error) return;
    const n = seq++;
    const ms = Math.round(elapsed());
    writes = writes.then(() => (error ? undefined : appendChunk(rec, n, e.data, undefined, ms))).catch(fail);
  });
  return {
    rec,
    /**
     * Assemble the chunks into a history item ({ ...item, blob }) and drop the chunks.
     * Returns { id, error }: `error` is set when a write failed and only the part recorded before it was saved.
     * If saving fails, the chunks stay in IndexedDB and are recovered on the next start.
     */
    async save(item) {
      await writes;
      const blob = await assembleChunks(rec, recorder.mimeType);
      if (!blob.size) throw error ?? new Error('The recording is empty');
      const id = await putItem({ ...item, blob });
      await clearChunks(rec);
      return { id, error };
    },
    async discard() {
      await writes;
      await clearChunks(rec).catch(() => {});
    },
  };
}

/** Message for the viewer when `save()` reports that only part of the recording was kept. */
export function stoppedEarlyNotice(error) {
  return error ? `Recording stopped early: storage failed (${error.message || error}). Saved what was recorded before that.` : undefined;
}
