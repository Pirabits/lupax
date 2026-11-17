import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// minimal chrome.storage.local stub
let store = {};
globalThis.chrome = {
  storage: { local: {
    get: async (k) => ({ [k]: store[k] }),
    set: async (o) => { Object.assign(store, structuredClone(o)); },
  } },
};
const { DEFAULTS, getSettings, setSettings, QUALITY } = await import('../../lib/settings.js');

beforeEach(() => { store = {}; });

test('defaults when nothing is stored', async () => {
  assert.deepEqual(await getSettings(), DEFAULTS);
});

test('stored groups are merged over defaults, so new defaults appear for old installs', async () => {
  store.settings = { capture: { fileType: 'jpg' } };
  const s = await getSettings();
  assert.equal(s.capture.fileType, 'jpg');
  assert.equal(s.capture.delay, DEFAULTS.capture.delay);
  assert.deepEqual(s.record, DEFAULTS.record);
});

test('setSettings patches one key without clobbering siblings', async () => {
  await setSettings({ record: { mic: true } });
  await setSettings({ record: { fps: 60 } });
  const s = await getSettings();
  assert.equal(s.record.mic, true);
  assert.equal(s.record.fps, 60);
  assert.equal(s.record.quality, DEFAULTS.record.quality);
});

test('every quality preset is complete', () => {
  for (const [k, q] of Object.entries(QUALITY)) {
    assert.ok(q.w > 0 && q.h > 0 && q.bps > 0 && q.label, k);
  }
  assert.ok(QUALITY[DEFAULTS.record.quality], 'default quality exists');
});

test('invalid stored values fall back to defaults instead of breaking pages', async () => {
  for (const bad of [null, 'garbage', 42, [], { capture: null }, { capture: 'x', record: [] }]) {
    store.settings = bad;
    assert.deepEqual(await getSettings(), DEFAULTS, JSON.stringify(bad));
  }
  store.settings = {
    capture: { fileType: 7, delay: 4, destination: 'cloud', jpgQuality: 3, annotate: 'yes', copy: true, mode: 'full' },
    record: { quality: 1080, fps: '30', countdown: 5, mic: true, webcamPosition: null },
  };
  const s = await getSettings();
  assert.deepEqual(
    { fileType: s.capture.fileType, delay: s.capture.delay, destination: s.capture.destination, jpgQuality: s.capture.jpgQuality, annotate: s.capture.annotate },
    { fileType: 'png', delay: 3, destination: 'downloads', jpgQuality: 0.92, annotate: true },
    'invalid capture values replaced by defaults');
  assert.equal(s.capture.copy, true, 'valid values kept');
  assert.equal(s.capture.mode, 'full');
  assert.equal(s.record.quality, '1080', 'numeric quality is not a valid key');
  assert.equal(s.record.fps, 30);
  assert.equal(s.record.countdown, 5);
  assert.equal(s.record.mic, true);
  assert.equal(s.record.webcamPosition, 'bottom-left');
});
