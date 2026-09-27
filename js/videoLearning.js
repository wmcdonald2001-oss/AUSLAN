// Learning signs from video files (e.g. dictionary clips) instead of from a
// live signer. Each video should show one sign; its file name is the meaning.

import { extractFeatures, assignHands } from './features.js';

const VIDEO_EXTENSION = /\.(mp4|m4v|mov|webm|ogv|ogg|mkv|avi)$/i;

export function isVideoFile(file) {
  return (file.type ?? '').startsWith('video/') || VIDEO_EXTENSION.test(file.name ?? '');
}

// "thank-you_2.mp4" -> "thank you", "HELLO (1).mov" -> "hello", "b.mp4" -> "B"
export function labelFromFilename(name) {
  let label = name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  label = label
    .replace(/[_-]+/g, ' ')
    .replace(/\s*\(\d+\)\s*$/, '') // "hello (2)"
    .replace(/\s+\d+$/, '') // "hello 2", "hello_2"
    .replace(/\s+/g, ' ')
    .trim();
  if (label.length === 1) return label.toUpperCase();
  return label.toLowerCase();
}

// Flips a detection left-to-right, so a sign learned from a right-handed
// signer is also recognised when made with the left hand (and vice versa).
export function mirrorDetection({ landmarks = [], handedness = [] }) {
  const swap = { Left: 'Right', Right: 'Left' };
  return {
    landmarks: landmarks.map((hand) => hand.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }))),
    handedness: handedness.map((cats) =>
      cats.map((c) => ({ ...c, categoryName: swap[c.categoryName] ?? c.categoryName })),
    ),
  };
}

function handsInFrame(det) {
  const { left, right } = assignHands(det.landmarks, det.handedness);
  return { left, right, any: !!(left || right) };
}

function palm(hand) {
  return Math.hypot(hand[9].x - hand[0].x, hand[9].y - hand[0].y) || 1e-6;
}

// Average landmark movement between two frames, in palm-size units. A hand
// appearing or disappearing counts as a lot of movement.
function motionBetween(a, b) {
  let total = 0;
  let count = 0;
  for (const side of ['left', 'right']) {
    const ha = a[side];
    const hb = b[side];
    if (!ha && !hb) continue;
    if (!ha || !hb) return Infinity;
    const scale = (palm(ha) + palm(hb)) / 2;
    for (let i = 0; i < ha.length; i++) {
      total += Math.hypot(ha[i].x - hb[i].x, ha[i].y - hb[i].y) / scale;
      count++;
    }
  }
  return count ? total / count : Infinity;
}

// A hand resting low in the frame (before or after signing) isn't part of the sign.
function isResting(hands, restLine) {
  const wrists = [hands.left, hands.right].filter(Boolean).map((h) => h[0].y);
  return wrists.length > 0 && wrists.every((y) => y > restLine);
}

// Picks the frames of a clip that best represent the sign: drops the start
// and end (hands coming up and going down), hands at rest, and the fastest
// transitional movement; then spreads the remaining picks evenly.
export function selectSignFrames(detections, { maxFrames = 24, trim = 0.15, restLine = 0.88, keepFraction = 0.7 } = {}) {
  const frames = detections.map((det) => ({ det, hands: handsInFrame(det) }));
  const present = frames.map((f, i) => (f.hands.any ? i : -1)).filter((i) => i >= 0);
  if (present.length < 3) return [];

  const first = present[0];
  const last = present[present.length - 1];
  const span = last - first + 1;
  const from = first + Math.floor(span * trim);
  const to = last - Math.floor(span * trim);

  let candidates = [];
  for (let i = from; i <= to; i++) {
    const f = frames[i];
    if (!f.hands.any || isResting(f.hands, restLine)) continue;
    const prev = frames[i - 1]?.hands;
    const next = frames[i + 1]?.hands;
    const motions = [prev && motionBetween(prev, f.hands), next && motionBetween(f.hands, next)].filter(
      (m) => typeof m === 'number' && Number.isFinite(m),
    );
    const motion = motions.length ? Math.min(...motions) : Infinity;
    candidates.push({ i, motion });
  }
  if (candidates.length === 0) return [];

  // Keep the steadiest portion of the sign.
  const finite = candidates.filter((c) => Number.isFinite(c.motion)).map((c) => c.motion).sort((a, b) => a - b);
  if (finite.length) {
    const cutoff = finite[Math.max(0, Math.ceil(finite.length * keepFraction) - 1)];
    candidates = candidates.filter((c) => c.motion <= cutoff);
  }

  const step = Math.max(1, candidates.length / maxFrames);
  const picked = [];
  for (let k = 0; k < candidates.length && picked.length < maxFrames; k += step) {
    picked.push(frames[candidates[Math.floor(k)].i].det);
  }
  return picked;
}

export function detectionsToFeatures(detections, { mirror = false } = {}) {
  const out = [];
  for (const det of detections) {
    const f = extractFeatures(det.landmarks, det.handedness);
    if (f) out.push(f);
    if (mirror) {
      const m = mirrorDetection(det);
      const mf = extractFeatures(m.landmarks, m.handedness);
      if (mf) out.push(mf);
    }
  }
  return out;
}

// ---------- Browser-only: stepping through a video file ----------

function once(target, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for video ${event}`));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('This video could not be played. Try an MP4 or WebM file.'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(event, onEvent);
    target.addEventListener('error', onError);
  });
}

// Runs hand tracking over a video file, sampling `fps` frames per second.
// Returns an array of { landmarks, handedness } detections.
export async function detectHandsInVideo(file, landmarker, { fps = 12, onprogress, signal } = {}) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const url = URL.createObjectURL(file);
  try {
    video.src = url;
    await once(video, 'loadeddata', 20000);
    let duration = video.duration;
    if (duration === Infinity) {
      // Videos recorded in a browser often don't store their length; seeking
      // far past the end makes the browser work it out.
      video.currentTime = 1e7;
      await once(video, 'seeked', 10000);
      duration = video.duration;
      video.currentTime = 0;
      await once(video, 'seeked', 10000);
    }
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not read the video length.');
    const detections = [];
    const steps = Math.max(1, Math.floor(duration * fps));
    for (let s = 0; s <= steps; s++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const t = Math.min(duration - 0.001, s / fps);
      if (Math.abs(video.currentTime - t) > 1e-3) {
        video.currentTime = t;
        await once(video, 'seeked', 10000);
      }
      const result = landmarker.detect(video);
      detections.push({ landmarks: result.landmarks ?? [], handedness: result.handedness ?? result.handednesses ?? [] });
      onprogress?.(s / steps);
    }
    return detections;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
