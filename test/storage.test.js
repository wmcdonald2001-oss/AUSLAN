import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialiseSamples, parseSamples } from '../js/storage.js';

test('sign sets round-trip through export and import', () => {
  const samples = [{ label: 'hello', features: Float32Array.from([0.12345, -1, 2]) }];
  const parsed = parseSamples(JSON.parse(JSON.stringify(serialiseSamples(samples))), 3);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].label, 'hello');
  assert.deepEqual(parsed[0].features, [0.123, -1, 2]);
});

test('import rejects unrelated files and drops malformed samples', () => {
  assert.throws(() => parseSamples({ foo: 1 }, 3));
  const parsed = parseSamples(
    {
      format: 'auslan-interpreter-signs',
      samples: [
        { label: 'ok', features: [1, 2, 3] },
        { label: 'short', features: [1] },
        { label: '', features: [1, 2, 3] },
        { label: 'nan', features: [1, null, 3] },
      ],
    },
    3,
  );
  assert.deepEqual(parsed.map((s) => s.label), ['ok']);
});
