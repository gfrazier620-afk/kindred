// Reading replies aloud (browser voices) and dictation (browser speech recognition).
// Both are optional: each function reports whether the browser supports it.

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

export const canSpeak = () => !!synth && typeof SpeechSynthesisUtterance !== 'undefined';

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const canDictate = () => !!Recognition;

/** Voices installed on this device. Some browsers fill the list in a moment after load. */
export function getVoices() {
  if (!canSpeak()) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1200);
  });
}

/**
 * What gets read. "speech" reads only what the character says in "quotes" (falling back to the
 * whole message if there are none); "all" reads the narration too.
 */
export function speakable(text, mode = 'speech') {
  const plain = text.replace(/\*+/g, '');
  if (mode === 'speech') {
    const spoken = [...plain.matchAll(/["“]([^"”]+)["”]/g)].map((m) => m[1].trim()).filter(Boolean);
    if (spoken.length) return spoken.join(' ');
  }
  return plain.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
}

// Long text is read in sentence-sized pieces; some browsers cut off a single long utterance.
const chunks = (text) => text.match(/[^.!?…]+[.!?…]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];

/** Reads text aloud, replacing anything already being read. onEnd runs when it finishes or is stopped. */
export async function speak(text, { voiceURI = '', rate = 1, mode = 'speech', onEnd } = {}) {
  if (!canSpeak()) return false;
  stopSpeaking();
  const words = speakable(text, mode);
  if (!words) return false;
  const voices = await getVoices();
  const voice = voices.find((v) => v.voiceURI === voiceURI);
  const parts = chunks(words);
  parts.forEach((part, i) => {
    const utterance = new SpeechSynthesisUtterance(part);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    if (i === parts.length - 1) {
      utterance.onend = () => onEnd?.();
      utterance.onerror = () => onEnd?.();
    }
    synth.speak(utterance);
  });
  return true;
}

export function stopSpeaking() {
  if (canSpeak()) synth.cancel();
}

/**
 * iPhones only let a page start speaking after a tap. Call this inside a tap or click so later
 * automatic reading (new replies) is allowed.
 */
export function unlockSpeech() {
  if (!canSpeak()) return;
  const quiet = new SpeechSynthesisUtterance(' ');
  quiet.volume = 0;
  synth.speak(quiet);
}

/** Starts listening. onText gets the running transcript; onEnd runs when listening stops. Returns { stop }. */
export function listen({ onText, onEnd, onError }) {
  if (!Recognition) return null;
  const rec = new Recognition();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => onText([...e.results].map((r) => r[0].transcript).join(' ').trim());
  rec.onerror = (e) => onError?.(e.error);
  rec.onend = () => onEnd?.();
  rec.start();
  return { stop: () => rec.stop() };
}
