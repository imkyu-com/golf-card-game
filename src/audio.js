// WebAudio 合成音效（无需音频文件）
let ctx = null, enabled = true, master = null;
function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
export function setSoundEnabled(v) { enabled = v; }
export function isSoundEnabled() { return enabled; }
export function unlockAudio() { if (enabled) ac(); }

function tone(freq, dur, { type = 'sine', vol = 0.3, delay = 0, slide = 0 } = {}) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, { vol = 0.25, freq = 2000, q = 1, delay = 0 } = {}) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + delay;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

export const sfx = {
  click() { if (enabled) tone(660, 0.06, { type: 'triangle', vol: 0.15 }); },
  flip() { if (enabled) { noise(0.09, { freq: 3200, q: 0.8, vol: 0.35 }); tone(420, 0.05, { type: 'triangle', vol: 0.08, delay: 0.04 }); } },
  draw() { if (enabled) noise(0.18, { freq: 1500, q: 0.6, vol: 0.25 }); },
  place() { if (enabled) { noise(0.06, { freq: 700, q: 1.2, vol: 0.45 }); tone(140, 0.12, { vol: 0.25, slide: -60 }); } },
  pair() { if (enabled) { tone(784, 0.12, { type: 'triangle', vol: 0.2 }); tone(1046, 0.18, { type: 'triangle', vol: 0.2, delay: 0.1 }); } },
  win() { if (enabled) [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.22, delay: i * 0.11 })); },
  lose() { if (enabled) [392, 330, 262].forEach((f, i) => tone(f, 0.3, { type: 'sine', vol: 0.2, delay: i * 0.16 })); },
  star(i = 0) { if (enabled) tone(880 + i * 220, 0.2, { type: 'triangle', vol: 0.2 }); },
  lastRound() { if (enabled) { tone(300, 0.15, { type: 'square', vol: 0.08 }); tone(300, 0.15, { type: 'square', vol: 0.08, delay: 0.2 }); } },
};
