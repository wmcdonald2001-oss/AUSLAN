import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelFromFilename, mirrorDetection, selectSignFrames, detectionsToFeatures, isVideoFile } from '../js/videoLearning.js';
import { extractFeatures, HAND_FEATURES } from '../js/features.js';
import { makeHand } from './helpers.js';

const right = [[{ categoryName: 'Right', score: 0.9 }]];
const none = { landmarks: [], handedness: [] };
const at = (x, y, curl = 0) => ({ landmarks: [makeHand(x, y, 0.1, curl)], handedness: right });

test('labels come from file names', () => {
  assert.equal(labelFromFilename('hello.mp4'), 'hello');
  assert.equal(labelFromFilename('Thank-You_2.mov'), 'thank you');
  assert.equal(labelFromFilename('signs/good morning (3).webm'), 'good morning');
  assert.equal(labelFromFilename('b.mp4'), 'B');
  assert.equal(labelFromFilename('what_1.mp4'), 'what');
});

test('recognises video files', () => {
  assert.ok(isVideoFile({ name: 'a.mp4', type: '' }));
  assert.ok(isVideoFile({ name: 'clip', type: 'video/webm' }));
  assert.ok(!isVideoFile({ name: 'notes.txt', type: 'text/plain' }));
});

test('mirroring swaps hands and flips x', () => {
  const det = at(0.3, 0.5);
  const m = mirrorDetection(det);
  assert.equal(m.handedness[0][0].categoryName, 'Left');
  assert.ok(Math.abs(m.landmarks[0][0].x - 0.7) < 1e-9);
  const f = extractFeatures(det.landmarks, det.handedness);
  const mf = extractFeatures(m.landmarks, m.handedness);
  // Right-hand slot moves to the left-hand slot with x mirrored.
  assert.ok(Math.abs(mf[3] + f[HAND_FEATURES + 3]) < 1e-5);
  assert.ok(Math.abs(mf[4] - f[HAND_FEATURES + 4]) < 1e-5);
});

test('frame selection skips hands entering, resting and leaving', () => {
  const clip = [
    none,
    none,
    at(0.5, 0.95), // hand resting at the bottom of the frame
    at(0.5, 0.8),
    at(0.5, 0.65), // raising
    ...Array.from({ length: 20 }, () => at(0.5, 0.4, 1)), // the held sign
    at(0.5, 0.65),
    at(0.5, 0.8),
    at(0.5, 0.95),
    none,
  ];
  const picked = selectSignFrames(clip, { maxFrames: 10 });
  assert.ok(picked.length > 0 && picked.length <= 10);
  for (const det of picked) assert.ok(det.landmarks[0][0].y < 0.5, 'only frames from the held sign');
});

test('frame selection gives up on clips with no hands', () => {
  assert.deepEqual(selectSignFrames([none, none, none, none]), []);
});

test('mirror option doubles the examples', () => {
  const dets = [at(0.5, 0.4), at(0.5, 0.4)];
  assert.equal(detectionsToFeatures(dets).length, 2);
  assert.equal(detectionsToFeatures(dets, { mirror: true }).length, 4);
});
