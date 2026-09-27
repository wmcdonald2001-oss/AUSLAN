// Thin wrappers around the browser's Web Speech API: text-to-speech for the
// signer's words, and speech recognition for the hearing person.

export class Speaker {
  constructor() {
    this.synth = window.speechSynthesis ?? null;
    this.voice = null;
    this.rate = 1;
    this.onstart = null;
    this.onend = null;
    if (this.synth) {
      this.pickVoice();
      this.synth.addEventListener?.('voiceschanged', () => this.pickVoice());
    }
  }

  get supported() {
    return !!this.synth;
  }

  get voices() {
    return this.synth ? this.synth.getVoices().filter((v) => v.lang.startsWith('en')) : [];
  }

  pickVoice(name) {
    const voices = this.voices;
    this.voice =
      voices.find((v) => v.name === name) ??
      voices.find((v) => v.lang === 'en-AU') ??
      voices.find((v) => v.lang.startsWith('en-GB')) ??
      voices[0] ??
      null;
  }

  speak(text) {
    if (!this.synth || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? 'en-AU';
    u.rate = this.rate;
    u.onstart = () => this.onstart?.();
    u.onend = u.onerror = () => {
      if (!this.synth.speaking) this.onend?.();
    };
    this.synth.speak(u);
  }

  cancel() {
    this.synth?.cancel();
  }
}

export class Listener {
  constructor({ lang = 'en-AU' } = {}) {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    this.recognition = Recognition ? new Recognition() : null;
    this.wanted = false;
    this.paused = false;
    this.oninterim = null;
    this.onfinal = null;
    this.onstatechange = null;
    this.onerror = null;
    if (!this.recognition) return;

    const r = this.recognition;
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = res[0].transcript.trim();
        if (res.isFinal) {
          if (text) this.onfinal?.(text);
        } else {
          interim += text + ' ';
        }
      }
      this.oninterim?.(interim.trim());
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.wanted = false;
        this.onerror?.('Microphone permission was denied.');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.onerror?.(`Speech recognition error: ${e.error}`);
      }
    };
    // Browsers stop recognition after silence; restart while still wanted.
    r.onend = () => {
      this.running = false;
      if (this.wanted && !this.paused) this.startNow();
      else this.onstatechange?.(false);
    };
  }

  get supported() {
    return !!this.recognition;
  }

  startNow() {
    try {
      this.recognition.start();
      this.running = true;
      this.onstatechange?.(true);
    } catch {
      // start() throws if already started; ignore.
    }
  }

  start() {
    if (!this.recognition) return;
    this.wanted = true;
    if (!this.paused) this.startNow();
  }

  stop() {
    this.wanted = false;
    this.recognition?.stop();
  }

  // Used while the app is talking so it does not transcribe its own voice.
  pause() {
    this.paused = true;
    if (this.running) this.recognition.abort();
  }

  resume() {
    this.paused = false;
    if (this.wanted && !this.running) this.startNow();
  }
}
