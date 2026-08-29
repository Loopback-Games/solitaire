/* Card sounds, synthesised.
 *
 * No audio files: a card landing is a very short burst of band-passed noise,
 * which is what a card landing actually is, and a card going home is that plus
 * a tone. Keeping it to the oscillators the browser already has costs no bytes
 * and no request, which is the same bargain the rest of the game makes.
 *
 * Everything here is inert until the player asks for it, and the context is
 * built on the first sound rather than at load — browsers refuse to start one
 * without a gesture behind it.
 */

let ctx = null;
let noise = null;
let on = false;

function wake() {
  if (!on) return null;
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      on = false;
      return null;
    }
    ctx = new Ctor();
    // A fifth of a second of white noise, reused by every card sound there is.
    const len = Math.floor(ctx.sampleRate * 0.2);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// A card: noise through a bandpass, opened and shut inside a tenth of a second.
function burst({ freq = 1200, dur = 0.07, gain = 0.3, q = 0.9 }) {
  const c = wake();
  if (!c) return;
  const t = c.currentTime;

  const src = c.createBufferSource();
  src.buffer = noise;

  const filt = c.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = freq;
  filt.Q.value = q;

  const amp = c.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.linearRampToValueAtTime(gain, t + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  src.connect(filt).connect(amp).connect(c.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function tone({ freq, dur = 0.2, gain = 0.16, at = 0 }) {
  const c = wake();
  if (!c) return;
  const t = c.currentTime + at;

  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;

  const amp = c.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.linearRampToValueAtTime(gain, t + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(amp).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function enable(want) {
  on = !!want;
  if (on && ctx) ctx.resume().catch(() => {});
}

/* Gains are set from measured peaks rather than guessed: each sound was
 * rendered offline and levelled to peak around -20 dBFS, with the win a few dB
 * above it: quiet enough to sit under a room, loud enough to be there at all,
 * and clear of clipping. A bandpass throws away most of the noise it is handed,
 * which is why the low thud needs several times the gain of the clicks to
 * arrive in the same place. */
export const sfx = {
  place: () => burst({ freq: 1150, dur: 0.075 }),
  deal: () => burst({ freq: 2100, dur: 0.05, gain: 0.26 }),
  flip: () => burst({ freq: 820, dur: 0.055, gain: 0.26 }),
  nope: () => burst({ freq: 240, dur: 0.1, gain: 0.9, q: 1.6 }),
  home: () => {
    burst({ freq: 1500, dur: 0.05, gain: 0.24 });
    tone({ freq: 880, dur: 0.24 });
  },
  // C major, straight up, one card per note.
  win: () =>
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
      tone({ freq, at: i * 0.11, dur: 0.55, gain: 0.17 }),
    ),
};

// A backgrounded tab has its context suspended out from under it.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && on && ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
});
