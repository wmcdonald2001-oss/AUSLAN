// Saves the user's trained signs and settings in this browser, and
// imports/exports sign sets as JSON so they can be shared between devices.

const SIGNS_KEY = 'auslan-interpreter:signs:v1';
const SETTINGS_KEY = 'auslan-interpreter:settings:v1';

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// Rounding keeps saved data small without hurting accuracy.
export function serialiseSamples(samples) {
  return {
    format: 'auslan-interpreter-signs',
    version: 1,
    samples: samples.map((s) => ({
      label: s.label,
      features: Array.from(s.features, (v) => Math.round(v * 1000) / 1000),
    })),
  };
}

export function parseSamples(data, expectedLength) {
  if (!data || data.format !== 'auslan-interpreter-signs' || !Array.isArray(data.samples)) {
    throw new Error('This file is not an AUSLAN Interpreter sign set.');
  }
  return data.samples.filter(
    (s) =>
      typeof s.label === 'string' &&
      s.label.trim() &&
      Array.isArray(s.features) &&
      s.features.length === expectedLength &&
      s.features.every(Number.isFinite),
  );
}

// Signs live in IndexedDB, which can hold far more than localStorage (large
// sign sets learned from videos easily pass localStorage's ~5 MB limit).
const DB_NAME = 'auslan-interpreter';
const STORE = 'kv';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbRequest(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// Packs samples into one Float32Array so large sets store compactly.
export function packSamples(samples) {
  const length = samples[0]?.features.length ?? 0;
  const data = new Float32Array(samples.length * length);
  samples.forEach((s, i) => data.set(s.features, i * length));
  return { version: 1, length, labels: samples.map((s) => s.label), data };
}

export function unpackSamples(packed, expectedLength) {
  if (!packed || packed.length !== expectedLength || !(packed.data instanceof Float32Array)) return [];
  return packed.labels.map((label, i) => ({
    label,
    features: packed.data.slice(i * expectedLength, (i + 1) * expectedLength),
  }));
}

export async function loadSamples(expectedLength) {
  try {
    const packed = await dbRequest('readonly', (store) => store.get(SIGNS_KEY));
    if (packed) return unpackSamples(packed, expectedLength);
  } catch {
    // IndexedDB unavailable (e.g. some private windows): fall back below.
  }
  // Signs saved by earlier versions of the app were kept in localStorage.
  const raw = safeGet(SIGNS_KEY);
  if (!raw) return [];
  try {
    return parseSamples(JSON.parse(raw), expectedLength);
  } catch {
    return [];
  }
}

export async function saveSamples(samples) {
  try {
    await dbRequest('readwrite', (store) => store.put(packSamples(samples), SIGNS_KEY));
    try {
      localStorage.removeItem(SIGNS_KEY);
    } catch {
      // ignore
    }
    return true;
  } catch {
    return safeSet(SIGNS_KEY, JSON.stringify(serialiseSamples(samples)));
  }
}

export function loadSettings(defaults) {
  try {
    return { ...defaults, ...JSON.parse(safeGet(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings) {
  safeSet(SETTINGS_KEY, JSON.stringify(settings));
}
