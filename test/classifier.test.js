import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignClassifier, SignStabiliser, PhraseBuilder } from '../js/classifier.js';
import { extractFeatures } from '../js/features.js';
import { makeHand } from './helpers.js';

const right = [[{ categoryName: 'Right', score: 0.9 }]];

// Several slightly jittered frames of the same hand shape.
function frames(curl, n = 20, seed = 1) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.004;
  const out = [];
  for (let i = 0; i < n; i++) {
    const hand = makeHand(0.5, 0.5, 0.1, curl).map((p) => ({ x: p.x + rand(), y: p.y + rand(), z: 0 }));
    out.push(extractFeatures([hand], right));
  }
  return out;
}

function trained() {
  const c = new SignClassifier();
  c.addSamples('hello', frames(0));
  c.addSamples('A', frames(1));
  return c;
}

test('recognises trained signs', () => {
  const c = trained();
  assert.equal(c.predict(frames(0, 1, 99)[0]).label, 'hello');
  assert.equal(c.predict(frames(1, 1, 99)[0]).label, 'A');
});

test('rejects poses unlike anything trained', () => {
  const c = trained();
  const twoHands = extractFeatures([makeHand(0.3), makeHand(0.7)], [
    [{ categoryName: 'Left', score: 0.9 }],
    [{ categoryName: 'Right', score: 0.9 }],
  ]);
  assert.equal(c.predict(twoHands), null);
});

test('returns null with no training data or no hands', () => {
  assert.equal(new SignClassifier().predict(frames(0, 1)[0]), null);
  assert.equal(trained().predict(null), null);
});

test('removeLabel forgets a sign', () => {
  const c = trained();
  c.removeLabel('A');
  assert.deepEqual(c.labels, ['hello']);
});

test('stabiliser emits once per held sign, and again after a pause', () => {
  const s = new SignStabiliser({ window: 5, required: 4 });
  const hello = { label: 'hello', confidence: 1 };
  const emitted = [];
  for (let i = 0; i < 10; i++) emitted.push(s.push(hello));
  assert.deepEqual(emitted.filter(Boolean), ['hello']);
  for (let i = 0; i < 5; i++) s.push(null);
  const again = [];
  for (let i = 0; i < 5; i++) again.push(s.push(hello));
  assert.deepEqual(again.filter(Boolean), ['hello']);
});

test('stabiliser ignores low-confidence predictions', () => {
  const s = new SignStabiliser({ window: 5, required: 4, minConfidence: 0.6 });
  for (let i = 0; i < 10; i++) assert.equal(s.push({ label: 'x', confidence: 0.4 }), null);
});

test('phrase joins fingerspelled letters into words', () => {
  const p = new PhraseBuilder();
  for (const t of ['hello', 'my', 'name', 'b', 'e', 'n', 'thank you']) p.add(t);
  assert.equal(p.text, 'hello my name BEN thank you');
  p.undo();
  assert.equal(p.text, 'hello my name BEN');
  p.clear();
  assert.ok(p.isEmpty);
});
