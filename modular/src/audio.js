import { TR } from './i18n.js';
import { TRACKS, HUMAN_DJ_TRACK } from './config.js';

// ═════════════ audio.js ═════════════

// 곡이 하나도 없을 때 쓰는 내장 비트
export const PRESETS = [
  { title: TR('내장 비트 #1 · 오일 하우스', "Built-in Beat #1 · Oil House"), bpm: 124, style: 'house' },
  { title: TR('내장 비트 #2 · 산업용 테크노', "Built-in Beat #2 · Industrial Techno"), bpm: 134, style: 'techno' },
  { title: TR('내장 비트 #3 · 8비트 장례식', "Built-in Beat #3 · 8-bit Funeral"), bpm: 108, style: 'chip' },
  { title: TR('내장 비트 #4 · 디스코 펌웨어', "Built-in Beat #4 · Disco Firmware"), bpm: 116, style: 'disco' },
];
export const SAD_PRESET = { title: TR('너무 감성적인 트랙 (위험)', "Way Too Emotional Track (Hazard)"), bpm: 74, style: 'ballad' };

export const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.userTracks = [];
    this.el = null;
    this.mode = null;
    this.playing = false;
    this.musicVol = 0.8;
    this.lastBleep = 0;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(c.destination);
    this.mus = c.createGain(); this.mus.gain.value = 0.5; this.mus.connect(this.master);
    this.sfxG = c.createGain(); this.sfxG.gain.value = 0.7; this.sfxG.connect(this.master);
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (this.mode === 'synth') this._synthStart();
  }

  get tracks() {
    const list = [...TRACKS, ...this.userTracks];
    return list.length ? list : PRESETS;
  }
  get hasUserTracks() { return TRACKS.length + this.userTracks.length > 0; }
  humanDJTrack(i) { return HUMAN_DJ_TRACK || (this.hasUserTracks ? this.tracks[i % this.tracks.length] : SAD_PRESET); }

  addFiles(files) {
    for (const f of files) this.userTracks.push({ title: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f), bpm: 120 });
  }

  play(track) {
    this.stop();
    this.cur = track;
    this.bpm = track.bpm || 120;
    this.rate = 1;
    this.playing = true;
    if (track.url) {
      const el = new Audio(track.url);
      el.loop = true; el.volume = Math.min(1, this.musicVol);
      this.el = el; this.mode = 'file'; this.offset = track.offset || 0;
      const fallback = () => {
        if (this.el !== el) return;
        console.warn(TR('[audio] 곡을 재생할 수 없어 내장 비트로 대체:', "[audio] Can't play track, falling back to built-in beat:"), track.url);
        this.el = null; this._synth({ ...PRESETS[0], title: track.title });
      };
      el.addEventListener('error', fallback);
      el.play().catch(fallback);
    } else this._synth(track);
  }

  _synth(track) {
    this.mode = 'synth';
    this.style = track.style || 'house';
    this.bpm = track.bpm || 120;
    this.baseBpm = this.bpm;
    this._synthStart();
  }
  _synthStart() {
    if (!this.ctx) return;
    this.t0 = this.ctx.currentTime + 0.08;
    this.nextT = this.t0;
    this.step = 0;
  }

  stop(scratch = false) {
    if (scratch) this.sfx('scratch');
    if (this.el) { this.el.pause(); this.el = null; }
    this.playing = false;
    this.mode = null;
  }

  // 현재 박(beat) — 로봇 춤의 기준
  beat() {
    if (!this.playing) return null;
    if (this.mode === 'file' && this.el) return Math.max(0, this.el.currentTime - this.offset) * this.bpm / 60;
    if (this.mode === 'synth' && this.ctx && this.t0 != null) return Math.max(0, this.ctx.currentTime - this.t0) * this.bpm / 60;
    return null;
  }

  // 지금 실제로 들리는 BPM (리믹스 반영)
  get liveBpm() { return this.mode === 'file' ? this.bpm * (this.rate || 1) : this.bpm; }
  // 리믹스: 곡 도중 템포 변경. 박(beat)은 끊기지 않고 이어짐
  setRate(rate) {
    if (!this.playing) return;
    if (this.mode === 'file' && this.el) { this.el.preservesPitch = false; this.el.playbackRate = rate; }
    else if (this.mode === 'synth' && this.ctx && this.nextT != null) {
      const b = this.beat() ?? 0, now = this.ctx.currentTime;
      this.bpm = this.baseBpm * rate;
      this.t0 = now - b * 60 / this.bpm;           // 지금 박 위치 그대로 이어서
      this.step = Math.ceil(b * 4);                 // 다음 16분음표를 그 박에 맞춤
      this.nextT = this.t0 + this.step / 4 * 60 / this.bpm;
    }
    this.rate = rate;
  }

  setMusicVolume(v) {
    this.musicVol = v;
    if (this.el) this.el.volume = Math.min(1, v);
    if (this.mus) this.mus.gain.value = 0.5 * v / 0.8;
  }

  tick() {
    if (!this.ctx || this.mode !== 'synth' || !this.playing || this.nextT == null) return;
    const sp = 60 / this.bpm / 4;
    if (this.nextT < this.ctx.currentTime - 0.5) { // 탭 비활성 후 복귀: 박(beat)과 스텝을 다시 맞춤
      this.step = Math.ceil((this.ctx.currentTime - this.t0) * this.bpm / 60 * 4);
      this.nextT = this.t0 + this.step / 4 * 60 / this.bpm;
    }
    while (this.nextT < this.ctx.currentTime + 0.15) {
      this._step(this.step, this.nextT, sp);
      this.step++; this.nextT += sp;
    }
  }

  // ── 신시사이저 패턴 ─────────────────────
  _step(step, t, sp) {
    const s = step % 16, bar = Math.floor(step / 16);
    switch (this.style) {
      case 'house': {
        if (s % 4 === 0) this.kick(t);
        if (s % 4 === 2) this.hat(t, 0.22, 0.09);
        if (s === 4 || s === 12) this.clap(t);
        const root = [45, 45, 41, 43][bar % 4];
        if (s % 4 === 2) this.tone(t, NOTE(root - 12), sp * 1.6, 'sawtooth', 0.22, 700);
        if (s === 0 && bar % 2 === 0) this.chord(t, [root + 12, root + 15, root + 19], sp * 6, 0.05);
        break;
      }
      case 'techno': {
        if (s % 4 === 0) this.kick(t, 1.1);
        this.hat(t, s % 2 ? 0.08 : 0.16, 0.03);
        if (s === 4 || s === 12) this.clap(t, 0.25);
        if (s % 4 !== 0) this.tone(t, NOTE(28), sp * 0.9, 'sawtooth', 0.18, 400 + 300 * Math.sin(step / 9));
        if (s === 7 && bar % 2) this.tone(t, NOTE(64), sp * 2, 'square', 0.08, 2400);
        break;
      }
      case 'chip': {
        if (s % 8 === 0) this.kick(t);
        if (s % 8 === 4) this.clap(t, 0.3);
        const ch = [[60, 63, 67], [56, 60, 63], [58, 62, 65], [55, 58, 62]][bar % 4];
        if (s % 2 === 0) this.tone(t, NOTE(ch[(s / 2) % 3] + 12), sp * 0.9, 'square', 0.07, 5000);
        if (s % 4 === 0) this.tone(t, NOTE(ch[0] - 24), sp * 3, 'triangle', 0.25, 3000);
        break;
      }
      case 'disco': {
        if (s % 4 === 0) this.kick(t);
        if (s % 4 === 2) this.hat(t, 0.25, 0.14);
        if (s === 4 || s === 12) this.clap(t);
        const root = [41, 41, 38, 40][bar % 4];
        if (s % 2 === 0) this.tone(t, NOTE(root - 12 + (s % 4 === 2 ? 12 : 0)), sp * 1.4, 'sawtooth', 0.2, 1200);
        if (s === 2 || s === 10) this.chord(t, [root + 24, root + 28, root + 31], sp * 1.2, 0.05);
        break;
      }
      case 'ballad': {
        if (s === 0) this.kick(t, 0.6);
        if (s === 8) this.clap(t, 0.15);
        const ch = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]][bar % 4];
        if (s === 0) this.chord(t, ch, sp * 16, 0.06, 'triangle');
        const mel = [76, 74, 72, 74, 72, 71, 69, 67];
        if (s % 4 === 0) this.tone(t, NOTE(mel[(bar * 4 + s / 4) % 8]), sp * 3.5, 'sine', 0.12, 3000);
        break;
      }
    }
  }

  _env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  kick(t, v = 1, out = this.mus) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this._env(g, t, 0.002, 0.9 * v, 0.26);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.32);
  }
  _noise(t, dur, v, type, freq, q = 1, out = this.mus) {
    const c = this.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
    this._env(g, t, 0.002, v, dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
    return f;
  }
  hat(t, v = 0.2, len = 0.04) { this._noise(t, len, v, 'highpass', 7000); }
  clap(t, v = 0.4) { this._noise(t, 0.16, v, 'bandpass', 1500, 0.8); }
  tone(t, freq, dur, type = 'sawtooth', v = 0.2, cutoff = 900, out = this.mus) {
    const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    f.type = 'lowpass'; f.frequency.value = cutoff;
    this._env(g, t, 0.005, v, dur);
    o.connect(f); f.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  chord(t, notes, dur, v, type = 'sawtooth') { for (const n of notes) this.tone(t, NOTE(n), dur, type, v, 1800); }

  // ── 효과음 ─────────────────────
  sfx(name) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.01, o = this.sfxG;
    switch (name) {
      case 'click': this.tone(t, 1300, 0.04, 'square', 0.12, 4000, o); break;
      case 'select': this.tone(t, 660, 0.05, 'square', 0.12, 4000, o); this.tone(t + 0.06, 990, 0.08, 'square', 0.12, 4000, o); break;
      case 'deny': this.tone(t, 180, 0.18, 'square', 0.15, 900, o); break;
      case 'scan': {
        const osc = this.tone(t, 300, 1.7, 'sawtooth', 0.08, 2500, o);
        osc.frequency.exponentialRampToValueAtTime(1600, t + 1.6);
        for (let i = 0; i < 6; i++) this.tone(t + i * 0.28, 1800, 0.03, 'square', 0.06, 6000, o);
        break;
      }
      case 'scanDone': this.tone(t, 1200, 0.08, 'square', 0.15, 6000, o); this.tone(t + 0.12, 1600, 0.12, 'square', 0.15, 6000, o); break;
      case 'human': [523, 659, 784, 1046].forEach((f, i) => this.tone(t + i * 0.07, f, 0.18, 'triangle', 0.2, 6000, o)); break;
      case 'robot': this.tone(t, 110, 0.5, 'sawtooth', 0.22, 800, o); this.tone(t, 116, 0.5, 'sawtooth', 0.2, 800, o); break;
      case 'eject': {
        const osc = this.tone(t, 1400, 1.0, 'triangle', 0.22, 5000, o);
        osc.frequency.exponentialRampToValueAtTime(110, t + 1.0);
        this._noise(t, 0.12, 0.6, 'lowpass', 300, 1, o);
        break;
      }
      case 'scratch': {
        const f = this._noise(t, 0.4, 0.6, 'bandpass', 3000, 4, o);
        f.frequency.exponentialRampToValueAtTime(250, t + 0.35);
        break;
      }
      case 'door': this.tone(t, 880, 0.15, 'sine', 0.1, 5000, o); this.tone(t + 0.15, 660, 0.25, 'sine', 0.1, 5000, o); break;
      case 'alarm': for (let i = 0; i < 8; i++) this.tone(t + i * 0.25, i % 2 ? 620 : 820, 0.22, 'square', 0.12, 3000, o); break;
      case 'clunk': this._noise(t, 0.08, 0.8, 'lowpass', 400, 1, o); this.tone(t, 90, 0.15, 'square', 0.2, 600, o); break;
      case 'tick': this.tone(t, 2200, 0.015, 'square', 0.05, 6000, o); break;
      case 'glug': for (let i = 0; i < 5; i++) { this.tone(t + i * 0.15, 240 - i * 25, 0.09, 'sine', 0.3, 900, o); this._noise(t + i * 0.15, 0.06, 0.15, 'lowpass', 500, 1, o); } break;
      case 'cough': for (let i = 0; i < 3; i++) this._noise(t + i * 0.24, 0.13, 0.6, 'bandpass', 900 - i * 100, 1.3, o); break;
      case 'powerDown': this.tone(t, 240, 0.5, 'sawtooth', 0.16, 700, o); this.tone(t + 0.12, 120, 0.7, 'sawtooth', 0.14, 400, o); break;
      case 'powerUp': this.tone(t, 110, 0.25, 'sawtooth', 0.12, 500, o); this.tone(t + 0.2, 330, 0.3, 'square', 0.08, 1500, o); break;
      case 'rise': { const osc = this.tone(t, 200, 1.2, 'sawtooth', 0.1, 2000, o); osc.frequency.exponentialRampToValueAtTime(900, t + 1.2); break; }
    }
  }

  // 로봇 음성 '삐빅'
  bleep() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastBleep < 0.05) return;
    this.lastBleep = now;
    this.tone(now, 380 + Math.random() * 420, 0.03, 'square', 0.035, 3000, this.sfxG);
  }
}


export const audio = new AudioSys(); // 게임 전체가 같이 쓰는 오디오 인스턴스
