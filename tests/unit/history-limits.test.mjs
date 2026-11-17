import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPrunable, HISTORY_LIMITS, PENDING_TTL_MS } from '../../lib/db.js';

// items are newest first, as the prune cursor returns them
const items = (spec) => spec.map(([kind, extra = {}], i) => ({ id: `${kind}${i}`, kind, ...extra }));

test('nothing is pruned under the limits', () => {
  assert.deepEqual(selectPrunable(items([['image'], ['video'], ['file']])), []);
});

test('videos and other items have separate budgets; the oldest go first', () => {
  const list = items([['video'], ['image'], ['video'], ['video'], ['file'], ['image'], ['image']]);
  assert.deepEqual(selectPrunable(list, { video: 2, other: 3 }), ['video3', 'image6']);
});

test('a burst of screenshots never evicts recordings', () => {
  const list = items([...Array(100).fill(['image']), ['video']]);
  const out = selectPrunable(list);
  assert.equal(out.length, 100 - HISTORY_LIMITS.other);
  assert.ok(!out.includes('video100'));
});

test('recent pending items (waiting for Save in the editor) are not pruned and do not use up the budget', () => {
  const list = items([['image'], ['image', { pending: true }], ['image'], ['image']]);
  assert.deepEqual(selectPrunable(list, { video: 1, other: 2 }), ['image3']);
});

test('pending items older than the TTL count toward the budget and can be pruned', () => {
  const now = 10 * PENDING_TTL_MS;
  const stale = now - PENDING_TTL_MS - 1, fresh = now - 1000;
  const list = items([['image', { createdAt: fresh }], ['image', { pending: true, createdAt: fresh }], ['image', { createdAt: stale }], ['image', { pending: true, createdAt: stale }]]);
  assert.deepEqual(selectPrunable(list, { video: 1, other: 2 }, now), ['image3']);
});
