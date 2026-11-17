// Pronunciation for the word card.
//
// A word is spoken from a human recording when one exists, otherwise by the
// browser's own speech synthesizer, so the play button always does something.
//
// Recordings are the American-English pronunciation files on Wikimedia
// Commons, named "En-us-<word>.ogg". They are static files; no API is called.
// Commons stores every file under a path taken from the MD5 of its name, which
// is why this module carries a small MD5.

const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/';
const START_TIMEOUT_MS = 7000;

/** MD5 of a string, as lowercase hex. */
export function md5(text) {
  const bytes = new TextEncoder().encode(text);
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bytes.length / 2 ** 29), true);

  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < padded.length; offset += 64) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) [f, g] = [(b & c) | (~b & d), i];
      else if (i < 32) [f, g] = [(d & b) | (~d & c), (5 * i + 1) % 16];
      else if (i < 48) [f, g] = [b ^ c ^ d, (3 * i + 5) % 16];
      else [f, g] = [c ^ (b | ~d), (7 * i) % 16];
      const constant = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
      const x = (a + f + constant + view.getUint32(offset + g * 4, true)) >>> 0;
      const shift = shifts[(i >> 4) * 4 + (i % 4)];
      [a, d, c] = [d, c, b];
      b = (b + ((x << shift) | (x >>> (32 - shift)))) >>> 0;
    }
    [a0, b0, c0, d0] = [(a0 + a) >>> 0, (b0 + b) >>> 0, (c0 + c) >>> 0, (d0 + d) >>> 0];
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((value, i) => out.setUint32(i * 4, value, true));
  return [...new Uint8Array(out.buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Where the Commons recording of a word would be, if there is one:
 * the original Ogg file, its MP3 version (for browsers without Ogg), and the
 * file's page, which names its author and licence.
 */
export function recordingUrls(word) {
  const file = `En-us-${word}.ogg`;
  const hash = md5(file);
  const folder = `${hash[0]}/${hash.slice(0, 2)}/`;
  const name = encodeURIComponent(file);
  return {
    ogg: `${COMMONS}${folder}${name}`,
    mp3: `${COMMONS}transcoded/${folder}${name}/${name}.mp3`,
    page: `https://commons.wikimedia.org/wiki/File:${name}`,
  };
}

/** An American-English voice if the device has one, else any English voice. */
export function chooseVoice(voices) {
  const english = voices.filter((voice) => /^en([-_]|$)/i.test(voice.lang));
  const american = english.filter((voice) => /^en[-_]US$/i.test(voice.lang));
  const pool = american.length ? american : english;
  return pool.find((voice) => voice.default) ?? pool.find((voice) => voice.localService) ?? pool[0] ?? null;
}

// What worked for each word last time, so a second press starts at once:
// a recording address, or 'speech'.
const known = new Map();

// A recording that fails to load is either missing or refused (Wikimedia
// limits how often an address may ask); the page cannot tell which. Either
// way the same file is not asked for again this visit, and after a run of
// failures recordings are left alone for a while, so that a refusal is
// respected rather than repeated for every word.
const failed = new Set();
const FAILURES_BEFORE_PAUSE = 3;
const PAUSE_MS = 5 * 60 * 1000;

/** Tracks recording failures and says when to stop asking for a while. */
export function createBackoff(limit = FAILURES_BEFORE_PAUSE, pauseMs = PAUSE_MS) {
  let run = 0;
  let pausedUntil = 0;
  return {
    paused: (now = Date.now()) => now < pausedUntil,
    success: () => { run = 0; },
    failure: (now = Date.now()) => {
      run += 1;
      if (run >= limit) {
        run = 0;
        pausedUntil = now + pauseMs;
      }
    },
  };
}
const backoff = createBackoff();
let stopCurrent = () => {};

/** Stop whatever is playing. */
export function stopPronouncing() {
  stopCurrent();
  stopCurrent = () => {};
}

function playRecording(src, onState) {
  return new Promise((resolve) => {
    const audio = new Audio();
    let started = false;
    let settled = false;
    const settle = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      if (!started) audio.removeAttribute('src');
      settle(started);
    }, START_TIMEOUT_MS);
    audio.onplaying = () => {
      started = true;
      onState('playing');
      settle(true);
    };
    audio.onended = () => onState('idle');
    audio.onerror = () => (started ? onState('idle') : settle(false));
    stopCurrent = () => {
      audio.pause();
      settle(started);
    };
    audio.src = src;
    audio.play().catch(() => settle(started));
  });
}

/**
 * Speak with the browser's synthesizer. Resolves true once speech has really
 * started, false if this device cannot do it (no synthesizer, or no voice).
 */
function speak(word, onState) {
  const synth = globalThis.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance !== 'function') return Promise.resolve(false);
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;
    const voice = chooseVoice(synth.getVoices());
    if (voice) utterance.voice = voice;
    let started = false;
    // No start within a few seconds means nothing will be heard. And some
    // browsers never report the end of a short utterance, so the button is
    // also released on a timer.
    const startTimer = setTimeout(() => {
      if (!started) {
        synth.cancel();
        resolve(false);
      }
    }, 3000);
    const endTimer = setTimeout(() => onState('idle'), 6000);
    const done = () => {
      clearTimeout(startTimer);
      clearTimeout(endTimer);
      onState('idle');
      if (!started) resolve(false);
    };
    utterance.onstart = () => {
      started = true;
      clearTimeout(startTimer);
      onState('playing');
      resolve(true);
    };
    utterance.onend = done;
    utterance.onerror = done;
    stopCurrent = () => {
      clearTimeout(startTimer);
      clearTimeout(endTimer);
      synth.cancel();
      resolve(started);
    };
    synth.cancel();
    synth.speak(utterance);
  });
}

/**
 * Say a word aloud. `onState` hears 'loading', 'playing' and 'idle'.
 * Resolves to { source: 'recording', page } | { source: 'speech' } | null.
 */
export async function pronounce(word, onState = () => {}) {
  stopPronouncing();
  onState('loading');
  const urls = recordingUrls(word);
  const remembered = known.get(word);

  const wanted = remembered !== 'speech' && !failed.has(word) && typeof Audio === 'function';
  if (wanted && !backoff.paused()) {
    // One address only: the MP3 copy exists only where the Ogg original does,
    // so it is asked for instead of the Ogg, never after it.
    const src = remembered
      ?? (new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? urls.ogg : urls.mp3);
    if (await playRecording(src, onState)) {
      backoff.success();
      known.set(word, src);
      return { source: 'recording', page: urls.page };
    }
    backoff.failure();
    failed.add(word);
    known.delete(word);
  }
  if (await speak(word, onState)) {
    known.set(word, 'speech');
    return { source: 'speech' };
  }
  // Nothing could be played. The synthesizer is tried again next time, since
  // its voices can arrive late.
  onState('idle');
  return null;
}
