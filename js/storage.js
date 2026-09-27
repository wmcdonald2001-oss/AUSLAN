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

export function loadSamples(expectedLength) {
  const raw = safeGet(SIGNS_KEY);
  if (!raw) return [];
  try {
    return parseSamples(JSON.parse(raw), expectedLength);
  } catch {
    return [];
  }
}

export function saveSamples(samples) {
  return safeSet(SIGNS_KEY, JSON.stringify(serialiseSamples(samples)));
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
