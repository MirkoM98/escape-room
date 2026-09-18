const SRC = "/escape-ambient.mp3";
const SECRET = /[?&]fiken=true/;

let element = null;
let muted = false;
// True between the start of a run and its end, which is the window where the
// tune belongs on. Unmuting outside that window must stay silent.
let active = false;

// Off for everyone unless the URL carries the flag, so the page is silent by
// default and nothing about it shows in the UI.
export function soundtrackEnabled() {
  try {
    return SECRET.test(window.location.href);
  } catch {
    return false;
  }
}

function audio() {
  if (element) return element;
  if (typeof Audio === "undefined") return null;
  element = new Audio(SRC);
  element.loop = true;
  element.volume = 0.45;
  // Nothing is fetched until a run actually starts it.
  element.preload = "none";
  return element;
}

// Resolves quietly when the file is missing or the browser refuses.
function play() {
  const el = audio();
  if (!el) return;
  const started = el.play();
  if (started && typeof started.catch === "function") started.catch(() => {});
}

export function isMuted() {
  return muted;
}

export function setMuted(next) {
  muted = next;
  if (!active) return;
  if (next) element?.pause();
  else play();
}

// Must be called straight off the click that starts a run: browsers only allow
// playback inside a user gesture, and awaiting anything first loses it.
export function startSoundtrack() {
  if (!soundtrackEnabled()) return;
  active = true;
  if (muted) return;
  const el = audio();
  if (!el) return;
  el.currentTime = 0;
  play();
}

export function stopSoundtrack() {
  active = false;
  if (!element) return;
  element.pause();
  element.currentTime = 0;
}
