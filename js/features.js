// Turns MediaPipe hand landmarks into a fixed-length feature vector that is
// independent of where the signer stands and how far they are from the camera.
//
// Layout (130 numbers):
//   [0..62]    left hand: 21 landmarks x (x, y, z), wrist-centred, scaled by palm size
//   [63..125]  right hand: same
//   [126, 127] hand presence flags (left, right), weighted
//   [128, 129] vector from left wrist to right wrist, in palm-size units

export const LANDMARKS_PER_HAND = 21;
export const HAND_FEATURES = LANDMARKS_PER_HAND * 3;
export const FEATURE_LENGTH = HAND_FEATURES * 2 + 4;

const WRIST = 0;
const MIDDLE_MCP = 9;
// Presence is weighted heavily so one-handed and two-handed signs never match.
const PRESENCE_WEIGHT = 3;
const RELATIVE_WEIGHT = 0.5;

function palmSize(hand) {
  const w = hand[WRIST];
  const m = hand[MIDDLE_MCP];
  return Math.hypot(m.x - w.x, m.y - w.y, (m.z ?? 0) - (w.z ?? 0)) || 1e-6;
}

function normaliseHand(hand, out, offset) {
  const w = hand[WRIST];
  const scale = palmSize(hand);
  for (let i = 0; i < LANDMARKS_PER_HAND; i++) {
    const p = hand[i];
    out[offset + i * 3] = (p.x - w.x) / scale;
    out[offset + i * 3 + 1] = (p.y - w.y) / scale;
    out[offset + i * 3 + 2] = ((p.z ?? 0) - (w.z ?? 0)) / scale;
  }
}

// Assigns each detected hand to the "left" or "right" slot. Uses MediaPipe's
// handedness label when available, falling back to screen position.
export function assignHands(landmarks, handedness = []) {
  const slots = { left: null, right: null };
  if (!landmarks || landmarks.length === 0) return slots;

  const labelled = landmarks.map((hand, i) => ({
    hand,
    label: handedness[i]?.[0]?.categoryName?.toLowerCase() ?? null,
    score: handedness[i]?.[0]?.score ?? 0,
  }));

  for (const h of labelled) {
    if ((h.label === 'left' || h.label === 'right') && !slots[h.label]) {
      slots[h.label] = h.hand;
      h.used = true;
    }
  }
  // Anything unassigned (no label, or both hands given the same label) is
  // placed by horizontal position.
  const rest = labelled.filter((h) => !h.used).sort((a, b) => a.hand[WRIST].x - b.hand[WRIST].x);
  for (const h of rest) {
    if (!slots.left && (!slots.right || h.hand[WRIST].x <= slots.right[WRIST].x)) slots.left = h.hand;
    else if (!slots.right) slots.right = h.hand;
  }
  return slots;
}

export function extractFeatures(landmarks, handedness) {
  const { left, right } = assignHands(landmarks, handedness);
  if (!left && !right) return null;

  const out = new Float32Array(FEATURE_LENGTH);
  if (left) normaliseHand(left, out, 0);
  if (right) normaliseHand(right, out, HAND_FEATURES);
  out[HAND_FEATURES * 2] = left ? PRESENCE_WEIGHT : 0;
  out[HAND_FEATURES * 2 + 1] = right ? PRESENCE_WEIGHT : 0;
  if (left && right) {
    const scale = (palmSize(left) + palmSize(right)) / 2;
    out[HAND_FEATURES * 2 + 2] = ((right[WRIST].x - left[WRIST].x) / scale) * RELATIVE_WEIGHT;
    out[HAND_FEATURES * 2 + 3] = ((right[WRIST].y - left[WRIST].y) / scale) * RELATIVE_WEIGHT;
  }
  return out;
}
