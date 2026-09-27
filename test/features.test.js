import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFeatures, assignHands, FEATURE_LENGTH, HAND_FEATURES } from '../js/features.js';
import { makeHand } from './helpers.js';

const label = (name) => [{ categoryName: name, score: 0.9 }];

test('returns null when no hands are visible', () => {
  assert.equal(extractFeatures([], []), null);
  assert.equal(extractFeatures(undefined, undefined), null);
});

test('feature vector has fixed length', () => {
  const f = extractFeatures([makeHand()], [label('Right')]);
  assert.equal(f.length, FEATURE_LENGTH);
});

test('features ignore position and scale in the frame', () => {
  const a = extractFeatures([makeHand(0.3, 0.4, 0.1)], [label('Right')]);
  const b = extractFeatures([makeHand(0.7, 0.6, 0.2)], [label('Right')]);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-5, `index ${i}`);
});

test('one-handed and two-handed poses are far apart', () => {
  const one = extractFeatures([makeHand()], [label('Right')]);
  const two = extractFeatures([makeHand(0.3), makeHand(0.7)], [label('Left'), label('Right')]);
  assert.equal(one[HAND_FEATURES * 2], 0);
  assert.ok(two[HAND_FEATURES * 2] > 0);
});

test('assignHands falls back to screen position when labels clash', () => {
  const a = makeHand(0.2);
  const b = makeHand(0.8);
  const slots = assignHands([b, a], [label('Right'), label('Right')]);
  assert.equal(slots.right, b);
  assert.equal(slots.left, a);
  const unlabelled = assignHands([b, a], []);
  assert.equal(unlabelled.left, a);
  assert.equal(unlabelled.right, b);
});
