// Tiny synthesized sound effects via WebAudio (no audio files needed).
let ctx = null;
let master = null;
let muted = false;
const last = {};

try {
  muted = localStorage.getItem('fs-muted') === '1';
} catch {}

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlockAudio() {
  ensure();
}

export function isMuted() {
  return muted;
}

export function setMuted(m) {
  muted = m;
  try {
    localStorage.setItem('fs-muted', m ? '1' : '0');
  } catch {}
  if (master) master.gain.value = m ? 0 : 0.35;
}

function throttle(name, ms) {
  const now = performance.now();
  if (last[name] && now - last[name] < ms) return false;
  last[name] = now;
  return true;
}

function tone({ freq = 440, to = null, dur = 0.12, type = 'sine', vol = 0.3, delay = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise({ dur = 0.2, vol = 0.3, freq = 1200, q = 1, type = 'lowpass', delay = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  shoot() {
    if (throttle('shoot', 70)) tone({ freq: 900, to: 500, dur: 0.05, type: 'triangle', vol: 0.05 });
  },
  cannon() {
    if (throttle('cannon', 90)) noise({ dur: 0.18, vol: 0.18, freq: 500 });
  },
  boom() {
    if (!throttle('boom', 90)) return;
    noise({ dur: 0.4, vol: 0.32, freq: 260 });
    tone({ freq: 120, to: 45, dur: 0.3, type: 'sine', vol: 0.25 });
  },
  zap() {
    if (!throttle('zap', 80)) return;
    noise({ dur: 0.12, vol: 0.12, freq: 3500, type: 'bandpass', q: 3 });
    tone({ freq: 1600, to: 300, dur: 0.1, type: 'sawtooth', vol: 0.05 });
  },
  skewer() {
    if (throttle('skewer', 80)) tone({ freq: 2200, to: 700, dur: 0.12, type: 'square', vol: 0.04 });
  },
  pulse() {
    if (throttle('pulse', 120)) tone({ freq: 1400, to: 2400, dur: 0.25, type: 'sine', vol: 0.05 });
  },
  splat(size = 0.3) {
    if (!throttle('splat', 45)) return;
    noise({ dur: 0.12 + size * 0.2, vol: 0.18, freq: 900 - size * 600, q: 2 });
    tone({ freq: 380 - size * 200, to: 120, dur: 0.1, type: 'sine', vol: 0.12 });
  },
  build() {
    tone({ freq: 220, to: 160, dur: 0.12, type: 'triangle', vol: 0.2 });
    noise({ dur: 0.08, vol: 0.12, freq: 700 });
  },
  wall() {
    if (throttle('wall', 50)) noise({ dur: 0.07, vol: 0.14, freq: 600 });
  },
  upgrade() {
    [523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.12, type: 'triangle', vol: 0.12, delay: i * 0.07 }));
  },
  sell() {
    [784, 523].forEach((f, i) => tone({ freq: f, dur: 0.1, type: 'triangle', vol: 0.1, delay: i * 0.06 }));
  },
  error() {
    if (throttle('error', 200)) tone({ freq: 160, dur: 0.15, type: 'square', vol: 0.06 });
  },
  leak() {
    if (throttle('leak', 150)) tone({ freq: 400, to: 150, dur: 0.35, type: 'sawtooth', vol: 0.08 });
  },
  wave() {
    [392, 523, 659].forEach((f, i) => tone({ freq: f, dur: 0.25, type: 'square', vol: 0.06, delay: i * 0.12 }));
  },
  cleared() {
    [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.18, type: 'triangle', vol: 0.12, delay: i * 0.08 }));
  },
  click() {
    tone({ freq: 700, dur: 0.04, type: 'triangle', vol: 0.06 });
  },
  lose() {
    [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, dur: 0.4, type: 'sawtooth', vol: 0.08, delay: i * 0.25 }));
  },
  win() {
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.25, type: 'triangle', vol: 0.14, delay: i * 0.13 }));
  },
};
