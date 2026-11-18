// Shared IndexedDB store for captures, recordings and exports.
// Item: { id, kind: 'image'|'video'|'file', name, format, size, blob, thumb?, title?, url?, width?, height?, pending?, original?, createdAt }
// original: the unannotated PNG, kept once an image has been saved from the editor.
//
// Recordings stream into the `chunks` store while they run ({ rec, seq, blob }, plus one { rec, seq: -1, meta } record),
// so a long recording never sits in memory and a crash leaves recoverable data behind.

import { withDuration } from './webm.js';

// Kept from the extension's original name so existing history survives the rename to LupaX.
const DB_NAME = 'inspectx';
const STORE = 'captures';
const CHUNKS = 'chunks';

/** History limits. Pending items (captures waiting for Save in the editor) are kept for PENDING_TTL_MS. */
export const HISTORY_LIMITS = { video: 20, other: 60 };
/** A pending capture the user never saved stops being protected after this long and counts toward the limits. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

let dbp = null;
function openDb() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      if (e.oldVersion < 2) db.createObjectStore(CHUNKS, { keyPath: ['rec', 'seq'] });
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); dbp = null; };
      resolve(req.result);
    };
    req.onerror = () => { dbp = null; reject(req.error); };
    req.onblocked = () => console.warn('[LupaX] database upgrade waiting for other tabs to close');
  });
  return dbp;
}

const done = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const txDone = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error);
  });

export async function putItem(item) {
  const db = await openDb();
  const id = item.id || crypto.randomUUID();
  await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put({
    createdAt: Date.now(), size: item.blob?.size ?? 0, ...item, id,
  }));
  await prune(db).catch((e) => console.warn('[LupaX] prune failed', e));
  notify();
  return id;
}

export async function updateItem(id, patch) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const cur = await done(store.get(id));
  if (!cur) return null;
  const next = { ...cur, ...patch, size: (patch.blob ?? cur.blob)?.size ?? cur.size };
  await done(store.put(next));
  notify();
  return next;
}

export async function getItem(id) {
  const db = await openDb();
  return done(db.transaction(STORE).objectStore(STORE).get(id));
}

export async function deleteItem(id) {
  const db = await openDb();
  await done(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
  notify();
}

export async function clearItems() {
  const db = await openDb();
  await done(db.transaction(STORE, 'readwrite').objectStore(STORE).clear());
  notify();
}

/** Newest first. kind: optional filter. */
export async function listItems({ kind, limit = Infinity } = {}) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out = [];
    const req = db.transaction(STORE).objectStore(STORE).index('createdAt').openCursor(null, 'prev');
    req.onsuccess = () => {
      const c = req.result;
      if (!c || out.length >= limit) return resolve(out);
      if (!kind || [].concat(kind).includes(c.value.kind)) out.push(c.value);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Pure: which items to delete, given items sorted newest first.
 * Videos and everything else (screenshots, exports) are counted separately; pending items younger than
 * PENDING_TTL_MS are kept and don't use up the budget, older ones are treated like any other item.
 */
export function selectPrunable(items, limits = HISTORY_LIMITS, now = Date.now()) {
  const seen = { video: 0, other: 0 };
  const out = [];
  for (const it of items) {
    if (it.pending && now - (it.createdAt ?? now) < PENDING_TTL_MS) continue;
    const bucket = it.kind === 'video' ? 'video' : 'other';
    if (++seen[bucket] > limits[bucket]) out.push(it.id);
  }
  return out;
}

async function prune(db) {
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const items = [];
  await new Promise((resolve, reject) => {
    const req = store.index('createdAt').openCursor(null, 'prev');
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      const { id, kind, pending, createdAt } = c.value;
      items.push({ id, kind, pending, createdAt });
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  for (const id of selectPrunable(items)) store.delete(id);
  await txDone(tx);
}

// ───────────── recording chunks ─────────────

const recRange = (rec) => IDBKeyRange.bound([rec, -Infinity], [rec, Infinity]);

/**
 * seq -1 holds metadata ({ name, title, url, mimeType }); seq >= 0 holds media chunks in order, each with `ms`, the
 * recorded time (pauses excluded) at its end, so a recording's duration is known even when it never finished.
 */
export async function appendChunk(rec, seq, blob, meta, ms) {
  const db = await openDb();
  await done(db.transaction(CHUNKS, 'readwrite').objectStore(CHUNKS).put({ rec, seq, blob, meta, ms }));
}

async function readRecording(db, rec) {
  const rows = await done(db.transaction(CHUNKS).objectStore(CHUNKS).getAll(recRange(rec)));
  const meta = rows.find((r) => r.seq < 0)?.meta || {};
  const media = rows.filter((r) => r.seq >= 0 && r.blob).sort((a, b) => a.seq - b.seq);
  return { meta, parts: media.map((r) => r.blob), ms: media.at(-1)?.ms };
}

/**
 * Concatenate a recording's chunks, with its duration written in. IndexedDB blobs are disk-backed, so this does not
 * load the video into memory.
 */
export async function assembleChunks(rec, type) {
  const db = await openDb();
  const { meta, parts, ms } = await readRecording(db, rec);
  const blob = new Blob(parts, { type: type || meta.mimeType || 'video/webm' });
  return withDuration(blob, ms).catch(() => blob);
}

export async function clearChunks(rec) {
  const db = await openDb();
  await done(db.transaction(CHUNKS, 'readwrite').objectStore(CHUNKS).delete(recRange(rec)));
}

export async function countChunks() {
  const db = await openDb();
  const keys = await done(db.transaction(CHUNKS).objectStore(CHUNKS).getAllKeys());
  return keys.filter(([, seq]) => seq >= 0).length;
}

/**
 * Turn chunks left behind by a crashed or interrupted recording into history items. Returns the new item ids.
 * Calls overlapping a run in progress (onStartup and onInstalled both fire after a browser update) share its result
 * instead of each recovering the same chunks.
 */
let recovering = null;
export function recoverOrphanRecordings() {
  recovering ??= recoverOrphans().finally(() => { recovering = null; });
  return recovering;
}

async function recoverOrphans() {
  const db = await openDb();
  const keys = await done(db.transaction(CHUNKS).objectStore(CHUNKS).getAllKeys());
  const recs = [...new Set(keys.map(([rec]) => rec))];
  const ids = [];
  for (const rec of recs) {
    const { meta, parts, ms } = await readRecording(db, rec);
    if (parts.length) {
      const blob = await withDuration(new Blob(parts, { type: meta.mimeType || 'video/webm' }), ms).catch(() => null)
        ?? new Blob(parts, { type: meta.mimeType || 'video/webm' });
      // the id comes from the recording, so if clearing its chunks fails, the next recovery overwrites this item
      // instead of adding a copy
      ids.push(await putItem({
        id: `recovered-${rec}`, kind: 'video', format: 'webm', name: `${meta.name || 'recording'}-recovered.webm`,
        blob, title: meta.title, url: meta.url, recovered: true,
      }));
    }
    await clearChunks(rec);
  }
  return ids;
}

// cross-context change signal (popup / history page refresh)
function notify() {
  try { chrome.storage.local.set({ historyRev: Date.now() }); } catch {}
}
