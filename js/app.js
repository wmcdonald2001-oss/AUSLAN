import { extractFeatures, FEATURE_LENGTH } from './features.js';
import { SignClassifier, SignStabiliser, PhraseBuilder } from './classifier.js';
import { Speaker, Listener } from './speech.js';
import { loadSamples, saveSamples, serialiseSamples, parseSamples, loadSettings, saveSettings } from './storage.js';
import { HandTracker, createHandLandmarker } from './tracker.js';
import { isVideoFile, labelFromFilename, detectHandsInVideo, selectSignFrames, detectionsToFeatures } from './videoLearning.js';

const $ = (id) => document.getElementById(id);

const SIGNBANK_SEARCH = 'https://auslan.org.au/dictionary/search/?query=';
const RECORD_MS = 2000;
const MAX_SAMPLES_PER_RECORDING = 40;
const SUGGESTED_SIGNS = ['hello', 'thank you', 'yes', 'no', 'please', 'help', 'sorry', 'good', 'name', 'what', 'where', 'toilet', 'water', 'pain', 'doctor'];

const settings = loadSettings({
  voice: '',
  rate: 1,
  autoSpeakPause: 2.5,
  strictness: 2.5,
  captionSize: 2.25,
});

const classifier = new SignClassifier({ strictness: settings.strictness });
const stabiliser = new SignStabiliser();
const phrase = new PhraseBuilder();
const speaker = new Speaker();
const listener = new Listener();
const tracker = new HandTracker($('video'), $('overlay'));

const state = {
  started: false,
  trackingReady: false,
  recording: null, // { label, frames: [] }
  lastHandsAt: 0,
  lastSignAt: 0,
  videoQueue: [], // { file, label, note }
  videoAbort: null,
  imageLandmarker: null,
};

// ---------- UI helpers ----------

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.dataset.kind = kind;
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

function renderPhrase() {
  const el = $('phrase-text');
  if (phrase.isEmpty) el.innerHTML = '<span class="muted">Signs will appear here…</span>';
  else el.textContent = phrase.text;
}

function linkedWords(text) {
  const frag = document.createDocumentFragment();
  for (const part of text.split(/(\s+)/)) {
    const word = part.replace(/[^\p{L}\p{N}'-]/gu, '');
    if (!word) {
      frag.append(part);
      continue;
    }
    const a = document.createElement('a');
    a.href = SIGNBANK_SEARCH + encodeURIComponent(word.toLowerCase());
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = `Look up “${word}” in Auslan Signbank`;
    a.textContent = part;
    frag.append(a);
  }
  return frag;
}

function addMessage(who, text, via) {
  const li = document.createElement('li');
  li.className = `msg ${who}`;
  const meta = document.createElement('div');
  meta.className = 'meta';
  const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  meta.textContent = `${who === 'signer' ? 'Signer' : 'Hearing person'} · ${via} · ${time}`;
  const body = document.createElement('div');
  body.className = 'body';
  if (who === 'hearing') body.append(linkedWords(text));
  else body.textContent = text;
  li.append(meta, body);
  const list = $('transcript');
  list.append(li);
  list.scrollTop = list.scrollHeight;

  if (who === 'hearing') {
    const caption = $('caption');
    caption.replaceChildren(linkedWords(text));
  } else if ($('speak-toggle').checked) {
    speaker.speak(text);
  }
}

function finishPhrase() {
  if (phrase.isEmpty) return;
  addMessage('signer', phrase.text, 'signed');
  phrase.clear();
  stabiliser.reset();
  renderPhrase();
}

function renderSignList() {
  const list = $('sign-list');
  list.replaceChildren();
  const labels = classifier.labels.sort((a, b) => a.localeCompare(b));
  $('sign-total').textContent = labels.length ? `(${labels.length})` : '';
  if (labels.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'No signs yet. Add some sign videos above to get started.';
    list.append(li);
  }
  for (const label of labels) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'sign-name';
    name.textContent = label;
    const count = document.createElement('span');
    count.className = 'sign-count';
    const n = classifier.countFor(label);
    count.textContent = `${n} example${n === 1 ? '' : 's'}`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn small danger';
    del.textContent = 'Delete';
    del.setAttribute('aria-label', `Delete ${label}`);
    del.addEventListener('click', () => {
      if (!confirm(`Delete the sign “${label}”?`)) return;
      classifier.removeLabel(label);
      persistSamples();
      renderSignList();
    });
    li.append(name, count, del);
    list.append(li);
  }
  renderSuggestions();
}

function renderSuggestions() {
  const known = new Set(classifier.labels.map((l) => l.toLowerCase()));
  const box = $('quick-add');
  box.replaceChildren();
  for (const word of SUGGESTED_SIGNS.filter((w) => !known.has(w)).slice(0, 8)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = `+ ${word}`;
    b.addEventListener('click', () => {
      $('label-input').value = word;
      $('label-input').focus();
    });
    box.append(b);
  }
}

// ---------- Recording (teaching) ----------

async function startRecording(label) {
  label = label.trim();
  if (!label) return;
  if (!state.trackingReady) {
    toast('Start the interpreter first so the camera can see your hands.');
    return;
  }
  if (state.recording) return;
  const countdown = $('countdown');
  $('record-btn').disabled = true;
  countdown.hidden = false;
  for (let i = 3; i > 0; i--) {
    countdown.textContent = `Get ready to sign “${label}”… ${i}`;
    await new Promise((r) => setTimeout(r, 1000));
  }
  countdown.textContent = `Recording “${label}” – hold the sign`;
  countdown.classList.add('recording');
  state.recording = { label, frames: [] };
  await new Promise((r) => setTimeout(r, RECORD_MS));

  const { frames } = state.recording;
  state.recording = null;
  countdown.classList.remove('recording');
  countdown.hidden = true;
  $('record-btn').disabled = false;

  if (frames.length < 5) {
    toast('No hands were seen. Make sure your hands are in view and try again.');
    return;
  }
  const step = Math.max(1, Math.floor(frames.length / MAX_SAMPLES_PER_RECORDING));
  const kept = frames.filter((_, i) => i % step === 0).slice(0, MAX_SAMPLES_PER_RECORDING);
  classifier.addSamples(label, kept);
  await persistSamples();
  stabiliser.reset();
  renderSignList();
  $('label-input').value = '';
  toast(`Learned “${label}”.`);
}

async function persistSamples() {
  if (!(await saveSamples(classifier.samples))) toast('Could not save signs in this browser. Use Export to keep a copy.');
}

// ---------- Learning from video files ----------

function addVideos(fileList) {
  const files = [...fileList].filter(isVideoFile).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (files.length === 0) {
    toast('No video files found. Use MP4, MOV or WebM videos.');
    return;
  }
  for (const file of files) state.videoQueue.push({ file, label: labelFromFilename(file.name), note: '' });
  renderVideoQueue();
}

function renderVideoQueue() {
  const list = $('video-queue');
  list.replaceChildren();
  const busy = !!state.videoAbort;
  state.videoQueue.forEach((item, index) => {
    const li = document.createElement('li');
    const file = document.createElement('span');
    file.className = 'video-file';
    file.textContent = item.file.name;
    const label = document.createElement('input');
    label.type = 'text';
    label.value = item.label;
    label.disabled = busy;
    label.setAttribute('aria-label', `Meaning of ${item.file.name}`);
    label.addEventListener('input', () => (item.label = label.value));
    const note = document.createElement('span');
    note.className = 'video-note';
    note.textContent = item.note;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn small';
    remove.textContent = 'Remove';
    remove.disabled = busy;
    remove.setAttribute('aria-label', `Remove ${item.file.name}`);
    remove.addEventListener('click', () => {
      state.videoQueue.splice(index, 1);
      renderVideoQueue();
    });
    li.append(file, label, remove, note);
    list.append(li);
  });
  $('video-actions').hidden = state.videoQueue.length === 0;
  $('video-learn-btn').disabled = busy;
  $('video-clear-btn').disabled = busy;
  $('video-learn-btn').textContent = `Learn ${state.videoQueue.length === 1 ? 'this sign' : `these ${state.videoQueue.length} videos`}`;
}

async function learnFromVideos() {
  const items = state.videoQueue.filter((i) => i.label.trim());
  if (items.length === 0) {
    toast('Give each video a meaning first.');
    return;
  }
  const abort = new AbortController();
  state.videoAbort = abort;
  renderVideoQueue();
  const progress = $('video-progress');
  const text = $('video-progress-text');
  const bar = $('video-progress-bar');
  progress.hidden = false;
  bar.value = 0;
  const mirror = $('mirror-toggle').checked;
  const learned = new Set();
  let failed = 0;

  try {
    text.textContent = 'Loading hand tracking…';
    state.imageLandmarker ??= await createHandLandmarker('IMAGE');
    for (let n = 0; n < items.length; n++) {
      const item = items[n];
      const label = item.label.trim();
      text.textContent = `Watching “${label}” (${n + 1} of ${items.length})…`;
      try {
        const detections = await detectHandsInVideo(item.file, state.imageLandmarker, {
          signal: abort.signal,
          onprogress: (p) => (bar.value = (n + p) / items.length),
        });
        const features = detectionsToFeatures(selectSignFrames(detections), { mirror });
        if (features.length === 0) {
          item.note = 'No hands found in this video';
          failed++;
        } else {
          classifier.addSamples(label, features, { calibrate: false });
          learned.add(label);
          item.done = true;
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        item.note = err.message;
        failed++;
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') toast('Stopped. Signs learned so far have been kept.');
    else toast(`Could not load hand tracking: ${err.message}`);
  } finally {
    state.videoAbort = null;
    progress.hidden = true;
    classifier.calibrate();
    stabiliser.reset();
    state.videoQueue = state.videoQueue.filter((i) => !i.done);
    renderVideoQueue();
    if (learned.size) {
      await persistSamples();
      renderSignList();
      toast(`Learned ${learned.size} sign${learned.size === 1 ? '' : 's'}${failed ? `. ${failed} video${failed === 1 ? '' : 's'} couldn't be used (see the list).` : '.'}`);
    } else if (failed) {
      toast("Couldn't learn from those videos. Check that the signer's hands are clearly visible.");
    }
    if (state.trackingReady) setStatus('Ready', 'ok');
  }
}

// ---------- Per-frame processing ----------

function onFrame(result) {
  const features = extractFeatures(result.landmarks, result.handedness ?? result.handednesses);
  const now = performance.now();
  if (features) state.lastHandsAt = now;

  if (state.recording) {
    if (features) state.recording.frames.push(features);
    return;
  }

  const live = $('live-sign');
  if (!$('recognise-toggle').checked || classifier.samples.length === 0) {
    live.hidden = true;
  } else {
    const prediction = classifier.predict(features);
    if (prediction) {
      live.hidden = false;
      live.textContent = `${prediction.label} · ${Math.round(prediction.confidence * 100)}%`;
    } else {
      live.hidden = !features;
      live.textContent = 'Hands seen – sign not recognised';
    }
    const emitted = stabiliser.push(prediction);
    if (emitted) {
      phrase.add(emitted);
      state.lastSignAt = now;
      renderPhrase();
    }
  }

  const pause = settings.autoSpeakPause * 1000;
  if (pause > 0 && !phrase.isEmpty && now - state.lastHandsAt > pause && now - state.lastSignAt > pause) {
    finishPhrase();
  }
}

// ---------- Start-up ----------

async function start() {
  if (state.started) return;
  state.started = true;
  $('start-btn').disabled = true;
  setStatus('Starting camera…');

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Camera unavailable', 'error');
    toast('This browser cannot use the camera. Open the app over https in Chrome, Edge or Safari.');
    state.started = false;
    $('start-btn').disabled = false;
    return;
  }

  const loading = tracker.load();
  try {
    await tracker.startCamera();
    $('placeholder').hidden = true;
    $('switch-camera-btn').disabled = false;
  } catch (err) {
    setStatus('Camera blocked', 'error');
    toast(`Could not open the camera: ${err.message}`);
    state.started = false;
    $('start-btn').disabled = false;
    return;
  }

  setStatus('Loading hand tracking…');
  try {
    await loading;
    state.trackingReady = true;
    $('record-btn').disabled = false;
    setStatus(classifier.samples.length ? 'Ready' : 'Ready – teach it some signs', 'ok');
  } catch (err) {
    console.error(err);
    setStatus('Hand tracking unavailable', 'error');
    toast('Could not load the hand-tracking model. Check your internet connection. Speech and text still work.');
  }
  tracker.onframe = onFrame;
}

// ---------- Settings ----------

function applySettings() {
  classifier.strictness = settings.strictness;
  speaker.rate = settings.rate;
  speaker.pickVoice(settings.voice);
  document.documentElement.style.setProperty('--caption-size', `${settings.captionSize}rem`);
  $('rate-out').textContent = `${settings.rate.toFixed(1)}×`;
  $('pause-out').textContent = settings.autoSpeakPause ? `${settings.autoSpeakPause}s` : 'off';
  $('strict-out').textContent = settings.strictness.toFixed(2);
  $('caption-out').textContent = `${settings.captionSize}rem`;
  saveSettings(settings);
}

function fillVoices() {
  const select = $('voice-select');
  select.replaceChildren();
  const voices = speaker.voices;
  if (voices.length === 0) {
    select.append(new Option('Default voice', ''));
    return;
  }
  for (const v of voices) select.append(new Option(`${v.name} (${v.lang})`, v.name));
  select.value = speaker.voice?.name ?? '';
}

function bindRange(id, key) {
  const input = $(id);
  input.value = settings[key];
  input.addEventListener('input', () => {
    settings[key] = Number(input.value);
    applySettings();
  });
}

// ---------- Event wiring ----------

$('start-btn').addEventListener('click', start);
$('switch-camera-btn').addEventListener('click', () =>
  tracker.switchCamera().catch((err) => toast(`Could not switch camera: ${err.message}`)),
);
$('undo-btn').addEventListener('click', () => {
  phrase.undo();
  stabiliser.reset();
  renderPhrase();
});
$('clear-btn').addEventListener('click', () => {
  phrase.clear();
  stabiliser.reset();
  renderPhrase();
});
$('speak-phrase-btn').addEventListener('click', finishPhrase);

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('text-input');
  const text = input.value.trim();
  if (!text) return;
  const who = new FormData(e.target).get('who');
  addMessage(who, text, 'typed');
  input.value = '';
});

$('train-form').addEventListener('submit', (e) => {
  e.preventDefault();
  startRecording($('label-input').value);
});

// Teach tabs
const tabs = [$('tab-video'), $('tab-live')];
function selectTab(tab) {
  for (const t of tabs) {
    const selected = t === tab;
    t.setAttribute('aria-selected', String(selected));
    t.tabIndex = selected ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !selected;
  }
}
for (const t of tabs) {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = tabs[(tabs.indexOf(t) + 1) % tabs.length];
    selectTab(next);
    next.focus();
  });
}

$('video-files').addEventListener('change', (e) => {
  addVideos(e.target.files);
  e.target.value = '';
});
$('video-folder').addEventListener('change', (e) => {
  addVideos(e.target.files);
  e.target.value = '';
});
$('video-learn-btn').addEventListener('click', learnFromVideos);
$('video-cancel-btn').addEventListener('click', () => state.videoAbort?.abort());
$('video-clear-btn').addEventListener('click', () => {
  state.videoQueue = [];
  renderVideoQueue();
});

$('export-btn').addEventListener('click', () => {
  if (classifier.samples.length === 0) {
    toast('There are no signs to export yet.');
    return;
  }
  const blob = new Blob([JSON.stringify(serialiseSamples(classifier.samples))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'auslan-signs.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const imported = parseSamples(JSON.parse(await file.text()), FEATURE_LENGTH);
    if (imported.length === 0) throw new Error('The file contained no usable signs.');
    classifier.setSamples([...classifier.samples, ...imported]);
    await persistSamples();
    renderSignList();
    toast(`Imported ${new Set(imported.map((s) => s.label)).size} signs.`);
  } catch (err) {
    toast(err.message);
  }
});

// Microphone / speech recognition
const micBtn = $('mic-btn');
if (!listener.supported) {
  micBtn.disabled = true;
  micBtn.title = 'Speech recognition is not supported in this browser. Try Chrome, Edge or Safari.';
}
micBtn.addEventListener('click', () => {
  if (listener.wanted) listener.stop();
  else listener.start();
});
listener.onstatechange = (on) => {
  const active = on || listener.wanted;
  micBtn.setAttribute('aria-pressed', String(active));
  micBtn.textContent = active ? '🎤 Listening…' : '🎤 Listen';
  if (!active) $('interim').textContent = '';
};
listener.oninterim = (text) => ($('interim').textContent = text);
listener.onfinal = (text) => {
  $('interim').textContent = '';
  addMessage('hearing', text, 'spoken');
};
listener.onerror = (message) => {
  toast(message);
  listener.onstatechange(false);
};
// Don't transcribe the app's own voice.
speaker.onstart = () => listener.pause();
speaker.onend = () => listener.resume();

// Settings dialog
$('settings-btn').addEventListener('click', () => {
  fillVoices();
  $('settings-dialog').showModal();
});
$('voice-select').addEventListener('change', (e) => {
  settings.voice = e.target.value;
  applySettings();
  speaker.speak('Hello');
});
bindRange('rate-input', 'rate');
bindRange('pause-input', 'autoSpeakPause');
bindRange('strict-input', 'strictness');
bindRange('caption-input', 'captionSize');
$('delete-all-btn').addEventListener('click', () => {
  if (!confirm('Delete every sign you have taught the app? Export them first if you want a copy.')) return;
  classifier.setSamples([]);
  persistSamples();
  renderSignList();
});
speaker.synth?.addEventListener?.('voiceschanged', () => {
  speaker.pickVoice(settings.voice);
  fillVoices();
});

applySettings();
renderSignList();
renderPhrase();
renderVideoQueue();
loadSamples(FEATURE_LENGTH).then((samples) => {
  classifier.setSamples([...samples, ...classifier.samples]);
  renderSignList();
});
if (!speaker.supported) $('speak-toggle').disabled = true;

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
