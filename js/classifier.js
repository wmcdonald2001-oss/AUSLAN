// k-nearest-neighbour sign classifier trained on the user's own recordings,
// plus helpers that turn noisy per-frame predictions into discrete signs.

function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const MIN_TYPICAL_DISTANCE = 0.25;

export class SignClassifier {
  constructor({ k = 5, strictness = 2.5 } = {}) {
    this.k = k;
    this.strictness = strictness; // multiple of the typical same-sign distance
    this.samples = []; // { label, features: Float32Array }
    this.typicalDistance = null;
  }

  get labels() {
    return [...new Set(this.samples.map((s) => s.label))];
  }

  countFor(label) {
    return this.samples.filter((s) => s.label === label).length;
  }

  setSamples(samples) {
    this.samples = samples.map((s) => ({ label: s.label, features: Float32Array.from(s.features) }));
    this.calibrate();
  }

  // Pass { calibrate: false } when adding many signs in a row, then call calibrate() once.
  addSamples(label, featureList, { calibrate = true } = {}) {
    for (const f of featureList) this.samples.push({ label, features: Float32Array.from(f) });
    if (calibrate) this.calibrate();
  }

  removeLabel(label) {
    this.samples = this.samples.filter((s) => s.label !== label);
    this.calibrate();
  }

  // Works out how far apart two frames of the *same* sign usually are, so the
  // "unknown sign" cut-off adapts to the person's own recordings.
  calibrate() {
    const byLabel = new Map();
    for (const s of this.samples) {
      if (!byLabel.has(s.label)) byLabel.set(s.label, []);
      byLabel.get(s.label).push(s.features);
    }
    const nearest = [];
    for (const group of byLabel.values()) {
      // Sub-sample big groups to keep calibration cheap.
      const step = Math.max(1, Math.floor(group.length / 30));
      for (let i = 0; i < group.length; i += step) {
        let best = Infinity;
        for (let j = 0; j < group.length; j++) {
          if (i === j) continue;
          const d = distance(group[i], group[j]);
          if (d > 0 && d < best) best = d;
        }
        if (best < Infinity) nearest.push(best);
      }
    }
    this.typicalDistance = median(nearest);
  }

  // When examples barely vary (e.g. one steady video per sign) the typical
  // distance is tiny, which would reject the same sign made by anyone else.
  // The floor keeps a sensible minimum tolerance; different hand shapes are
  // usually 1.5+ apart in feature space.
  get threshold() {
    return Math.max(this.typicalDistance ?? 1, MIN_TYPICAL_DISTANCE) * this.strictness;
  }

  // Returns { label, confidence, distance } or null when nothing is close enough.
  predict(features) {
    if (!features || this.samples.length === 0) return null;
    const neighbours = [];
    for (const s of this.samples) {
      const d = distance(features, s.features);
      if (neighbours.length < this.k) {
        neighbours.push({ label: s.label, d });
        neighbours.sort((a, b) => a.d - b.d);
      } else if (d < neighbours[neighbours.length - 1].d) {
        neighbours[neighbours.length - 1] = { label: s.label, d };
        neighbours.sort((a, b) => a.d - b.d);
      }
    }
    if (neighbours[0].d > this.threshold) return null;

    const votes = new Map();
    let total = 0;
    for (const n of neighbours) {
      const w = 1 / (n.d + 1e-3);
      votes.set(n.label, (votes.get(n.label) ?? 0) + w);
      total += w;
    }
    let label = null;
    let best = -1;
    for (const [l, v] of votes) {
      if (v > best) {
        best = v;
        label = l;
      }
    }
    return { label, confidence: best / total, distance: neighbours[0].d };
  }
}

// Emits a sign only once it has been held steadily for several frames, and
// will not emit the same sign again until the hands change or drop.
export class SignStabiliser {
  constructor({ window = 12, required = 8, minConfidence = 0.6 } = {}) {
    this.window = window;
    this.required = required;
    this.minConfidence = minConfidence;
    this.history = [];
    this.lastEmitted = null;
  }

  reset() {
    this.history = [];
    this.lastEmitted = null;
  }

  // prediction: result of SignClassifier.predict (or null). Returns a label to
  // emit, or null.
  push(prediction) {
    const label = prediction && prediction.confidence >= this.minConfidence ? prediction.label : null;
    this.history.push(label);
    if (this.history.length > this.window) this.history.shift();

    const counts = new Map();
    for (const l of this.history) counts.set(l, (counts.get(l) ?? 0) + 1);
    let top = null;
    let topCount = 0;
    for (const [l, c] of counts) {
      if (c > topCount) {
        top = l;
        topCount = c;
      }
    }
    if (topCount < this.required) return null;
    if (top === null) {
      // Hands down / unrecognised for a while: allow the same sign again.
      this.lastEmitted = null;
      return null;
    }
    if (top === this.lastEmitted) return null;
    this.lastEmitted = top;
    return top;
  }
}

// Collects recognised signs into an English phrase. Single letters are
// treated as fingerspelling and joined into words.
export class PhraseBuilder {
  constructor() {
    this.tokens = [];
  }

  add(label) {
    this.tokens.push(label);
  }

  undo() {
    this.tokens.pop();
  }

  clear() {
    this.tokens = [];
  }

  get isEmpty() {
    return this.tokens.length === 0;
  }

  get text() {
    let out = '';
    let prevLetter = false;
    for (const t of this.tokens) {
      const isLetter = t.length === 1 && /\p{L}/u.test(t);
      if (out && !(isLetter && prevLetter)) out += ' ';
      out += isLetter ? t.toUpperCase() : t;
      prevLetter = isLetter;
    }
    return out;
  }
}
