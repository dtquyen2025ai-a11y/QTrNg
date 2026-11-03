// Âm thanh tổng hợp bằng WebAudio: chuông, mõ, nhạc nền thiền. Không dùng tệp âm thanh có bản quyền.
let ctx: AudioContext | null = null;
let master: GainNode, sfxGain: GainNode, musicGain: GainNode;
const prefs = { sfx: true, music: true };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('tam-an.audio') || '{}')); } catch { /* mặc định */ }

function ac(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.gain.value = prefs.sfx ? 1 : 0; sfxGain.connect(master);
    musicGain = ctx.createGain(); musicGain.gain.value = 0; musicGain.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function audioPrefs() { return { ...prefs }; }
export function setAudioPref(k: 'sfx' | 'music', v: boolean) {
  prefs[k] = v;
  try { localStorage.setItem('tam-an.audio', JSON.stringify(prefs)); } catch { /* bỏ qua */ }
  const a = ac();
  if (k === 'sfx') sfxGain.gain.setTargetAtTime(v ? 1 : 0, a.currentTime, 0.05);
  if (k === 'music') { if (v) startMusic(); else musicGain.gain.setTargetAtTime(0, a.currentTime, 0.5); }
}
export function unlockAudio() { ac(); if (prefs.music) startMusic(); }

export function bell(volume = 1) {
  const a = ac(), t = a.currentTime;
  const partials: [number, number, number][] = [[110, 1, 9], [220, 0.6, 7], [293, 0.35, 6], [440, 0.25, 4], [587, 0.15, 3], [881, 0.08, 2]];
  for (const [f, v, dur] of partials) {
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v * 0.3 * volume, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(sfxGain); o.start(t); o.stop(t + dur + 0.1);
  }
}

export function woodBlock(volume = 1) {
  const a = ac(), t = a.currentTime;
  const o = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter();
  o.type = 'sine';
  o.frequency.setValueAtTime(900, t);
  o.frequency.exponentialRampToValueAtTime(480, t + 0.07);
  f.type = 'bandpass'; f.frequency.value = 750; f.Q.value = 4;
  g.gain.setValueAtTime(0.7 * volume, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  o.connect(f).connect(g).connect(sfxGain);
  o.start(t); o.stop(t + 0.2);
}

export function bead() {
  const a = ac(), t = a.currentTime;
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'triangle'; o.frequency.setValueAtTime(2200, t); o.frequency.exponentialRampToValueAtTime(1400, t + 0.03);
  g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  o.connect(g).connect(sfxGain); o.start(t); o.stop(t + 0.07);
}

export function chime() {
  const a = ac(), t = a.currentTime;
  [784, 988, 1175].forEach((f, i) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + i * 0.09);
    g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.09 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 1.2);
    o.connect(g).connect(sfxGain); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 1.3);
  });
}

// Nhạc nền: nền âm trầm (drone) + nốt ngũ cung ngẫu nhiên, chậm
let musicOn = false;
function startMusic() {
  const a = ac();
  musicGain.gain.setTargetAtTime(0.35, a.currentTime, 2);
  if (musicOn) return;
  musicOn = true;
  const drone = (f: number, v: number) => {
    const o = a.createOscillator(), g = a.createGain(), lfo = a.createOscillator(), lg = a.createGain();
    o.type = 'sine'; o.frequency.value = f; g.gain.value = v;
    lfo.frequency.value = 0.07 + Math.random() * 0.05; lg.gain.value = v * 0.5;
    lfo.connect(lg).connect(g.gain);
    o.connect(g).connect(musicGain); o.start(); lfo.start();
  };
  drone(73.4, 0.12); drone(110, 0.07); drone(146.8, 0.04);
  const scale = [293.7, 329.6, 392, 440, 523.3, 587.3, 659.3];
  const note = () => {
    if (!prefs.music) { setTimeout(note, 4000); return; }
    const t = a.currentTime, f = scale[Math.floor(Math.random() * scale.length)];
    const o = a.createOscillator(), g = a.createGain(), o2 = a.createOscillator();
    o.type = 'sine'; o2.type = 'sine'; o.frequency.value = f; o2.frequency.value = f * 2.01;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    o.connect(g); o2.connect(g); g.connect(musicGain); o.start(t); o2.start(t); o.stop(t + 4.1); o2.stop(t + 4.1);
    setTimeout(note, 2500 + Math.random() * 5000);
  };
  setTimeout(note, 1500);
}
