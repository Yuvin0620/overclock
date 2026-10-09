import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// ── 언어 (ko / en) — 시작 화면 버튼 또는 L 키로 전환, 새로고침해서 적용 ──
const LANG = (() => { try { const v = localStorage.getItem('overclock.lang'); if (v === 'ko' || v === 'en') return v; } catch {} return /^ko/i.test(navigator.language) ? 'ko' : 'en'; })();
const TR = (ko, en) => (LANG === 'en' ? en : ko);
function setLang(l) { try { localStorage.setItem('overclock.lang', l); } catch {} location.reload(); }
document.documentElement.lang = LANG;
// ═════════════ config.js ═════════════
// ─────────────────────────────────────────────────────────────
//  DJ 곡 목록 — 여기에 직접 곡을 넣으세요.
//
//  1) 음악 파일을 club-overclock/music/ 폴더에 넣고
//  2) 아래 배열에 한 줄씩 추가합니다.
//
//     title  : 화면(상태 패널)에 표시될 곡 이름
//     url    : index.html 기준 경로
//     bpm    : 곡의 BPM — 로봇 손님들이 이 박자에 '정확히' 맞춰 춤춥니다
//     offset : (선택) 첫 박이 시작되는 시간(초). 춤이 박자와 어긋나면 조절
//
//  DJ를 교체할 때마다 다음 곡으로 넘어갑니다. (마지막 곡 다음엔 처음으로)
//  배열이 비어 있으면 내장 신시사이저 비트가 대신 재생됩니다.
//  게임 시작 화면의 '내 곡 추가' 버튼으로 임시로 넣어볼 수도 있습니다 (BPM 120 가정).
// ─────────────────────────────────────────────────────────────
const TRACKS = [
  // { title: '첫 번째 곡', url: 'music/track1.mp3', bpm: 124 },
  // { title: '두 번째 곡', url: 'music/track2.mp3', bpm: 128, offset: 0.12 },
];

// 3번째 밤에 등장하는 '인간 DJ'가 틀 곡. 비워 두면 TRACKS 순서대로 재생.
const HUMAN_DJ_TRACK = null; // 예: { title: '너무 감성적인 곡', url: 'music/sad.mp3', bpm: 76 }

// ═════════════ util.js ═════════════

const FONT = '"Pretendard","Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';

const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function lerpAngle(a, b, k) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(k, 0, 1);
}

// 로우폴리 느낌: 전부 flatShading
function flat(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, metalness: 0.15, ...o });
}
function glow(color, intensity = 1) {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, flatShading: true });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 한국어 줄바꿈: 공백 우선, 없으면 글자 단위
function wrapText(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of para) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxW && line) {
        const sp = line.lastIndexOf(' ');
        if (sp > 0 && ch !== ' ') { lines.push(line.slice(0, sp)); line = line.slice(sp + 1) + ch; }
        else { lines.push(line); line = ch === ' ' ? '' : ch; }
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

class CanvasPanel {
  constructor(w, h, pw, ph, { transparent = false, depthTest = true } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pw; this.canvas.height = ph;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent, toneMapped: false, depthTest });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.material);
    this.w = pw; this.h = ph;
  }
  commit() { this.texture.needsUpdate = true; }
}

// ── PSX 스타일 ─────────────────────
// 꼭짓점 스냅(지글거림) + 아핀 텍스처(일그러짐) + 저해상도 nearest 텍스처
const PSX = {
  club: { value: new THREE.Vector2(160, 120) }, // CCTV 속 클럽: 강하게
  room: { value: new THREE.Vector2(320, 240) }, // 보안실(데스크톱): 약하게, VR에선 꺼짐
};
function psxify(mat, snap, affine = true) {
  if (!mat || mat.userData.psx || mat.isShaderMaterial || mat.isSpriteMaterial || mat.isLineBasicMaterial) return;
  if (mat.visible === false) return;
  if (mat.map?.image?.width >= 256) return; // 글자 텍스처는 선명하게
  mat.userData.psx = true;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSnap = snap;
    sh.defines = sh.defines || {};
    if (affine) sh.defines.PSX_AFFINE = '';
    sh.vertexShader = 'uniform vec2 uSnap;\n#if defined(USE_MAP) && defined(PSX_AFFINE)\nvarying float vAffW;\n#endif\n' + sh.vertexShader
      .replace('#include <project_vertex>', `#include <project_vertex>
        if (uSnap.x > 0.0) { vec2 g = uSnap * 0.5; gl_Position.xy = floor(gl_Position.xy / gl_Position.w * g + 0.5) / g * gl_Position.w; }`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        #if defined(USE_MAP) && defined(PSX_AFFINE)
          vMapUv *= gl_Position.w; vAffW = gl_Position.w;
        #endif`);
    sh.fragmentShader = '#if defined(USE_MAP) && defined(PSX_AFFINE)\nvarying float vAffW;\n#endif\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#ifdef USE_MAP
        #ifdef PSX_AFFINE
          vec4 sampledDiffuseColor = texture2D(map, vMapUv / vAffW);
        #else
          vec4 sampledDiffuseColor = texture2D(map, vMapUv);
        #endif
        diffuseColor *= sampledDiffuseColor;
      #endif`);
  };
  mat.customProgramCacheKey = () => 'psx' + (affine ? 'A' : '');
}
function psxifyTree(obj, snap, affine) {
  obj.traverse((o) => {
    if (!o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => psxify(m, snap, affine));
  });
}
// 작은 해상도 + nearest = 픽셀이 깨지는 텍스처
function pixelTex(pw, ph, draw, repeat) {
  const t = canvasTexture(pw, ph, draw);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
const noiseFill = (c, w, h, base, amp, step = 1) => {
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const v = base + (Math.random() - 0.5) * amp | 0;
    c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x, y, step, step);
  }
};
let METAL_TEX = null;
function metalTex() { // 로봇 몸통용 32px 패널 텍스처 (색은 material color가 곱해짐)
  if (!METAL_TEX) METAL_TEX = pixelTex(32, 32, (c, w, h) => {
    noiseFill(c, w, h, 205, 50, 2);
    c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(0, 15, w, 1); c.fillRect(15, 0, 1, 15);
    c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(0, 16, w, 1);
    c.fillStyle = '#555'; [[3, 3], [28, 3], [3, 28], [28, 28], [12, 20], [20, 20]].forEach(([x, y]) => c.fillRect(x, y, 2, 2));
    c.fillStyle = 'rgba(60,30,10,.35)'; for (let i = 0; i < 6; i++) c.fillRect(Math.random() * 30, Math.random() * 30, 3, 2);
  });
  return METAL_TEX;
}

function canvasTexture(pw, ph, draw) {
  const c = document.createElement('canvas');
  c.width = pw; c.height = ph;
  draw(c.getContext('2d'), pw, ph);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const bubbleCache = new Map();
function bubbleTexture(text, bg = '#ffffff', fg = '#111111') {
  const key = text + bg + fg;
  if (bubbleCache.has(key)) return bubbleCache.get(key);
  // 짧으면 한 줄 크게, 길면 최대 4줄로 줄바꿈 (잘리지 않게 말풍선 크기를 글자에 맞춤)
  const mc = document.createElement('canvas').getContext('2d');
  let size = 64, lines = [text];
  mc.font = `800 ${size}px ${FONT}`;
  while (mc.measureText(text).width > 640 && size > 44) { size -= 4; mc.font = `800 ${size}px ${FONT}`; }
  if (mc.measureText(text).width > 640) { size = 42; mc.font = `800 ${size}px ${FONT}`; lines = wrapText(mc, text, 640).slice(0, 4); }
  const tw = Math.max(...lines.map((l) => mc.measureText(l).width));
  const W = Math.max(300, Math.ceil(tw) + 80), lh = size * 1.25, boxH = Math.ceil(lines.length * lh + 44), H = boxH + 48;
  const tex = canvasTexture(W, H, (c, w) => {
    c.fillStyle = bg; c.strokeStyle = '#000'; c.lineWidth = 6;
    roundRect(c, 8, 8, w - 16, boxH, 30); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(w / 2 - 22, boxH + 6); c.lineTo(w / 2, boxH + 42); c.lineTo(w / 2 + 22, boxH + 6); c.closePath(); c.fill();
    c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `800 ${size}px ${FONT}`;
    lines.forEach((l, i) => c.fillText(l, w / 2, 8 + 22 + lh * (i + 0.5)));
  });
  tex.userData.size = [W, H];
  bubbleCache.set(key, tex);
  return tex;
}

function makeBubble() {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
  s.scale.set(1.15, 0.38, 1);
  s.visible = false;
  s.renderOrder = 10;
  return s;
}

// ═════════════ audio.js ═════════════

// 곡이 하나도 없을 때 쓰는 내장 비트
const PRESETS = [
  { title: TR('내장 비트 #1 · 오일 하우스', "Built-in Beat #1 · Oil House"), bpm: 124, style: 'house' },
  { title: TR('내장 비트 #2 · 산업용 테크노', "Built-in Beat #2 · Industrial Techno"), bpm: 134, style: 'techno' },
  { title: TR('내장 비트 #3 · 8비트 장례식', "Built-in Beat #3 · 8-bit Funeral"), bpm: 108, style: 'chip' },
  { title: TR('내장 비트 #4 · 디스코 펌웨어', "Built-in Beat #4 · Disco Firmware"), bpm: 116, style: 'disco' },
];
const SAD_PRESET = { title: TR('너무 감성적인 트랙 (위험)', "Way Too Emotional Track (Hazard)"), bpm: 74, style: 'ballad' };

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

class AudioSys {
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

// ═════════════ patron.js ═════════════

// ── 공용 지오메트리 (로우폴리) ──────────────────
const GEO = {
  torsoBox: new THREE.BoxGeometry(0.5, 0.6, 0.3),
  torsoBarrel: new THREE.CylinderGeometry(0.27, 0.23, 0.62, 7),
  torsoSlim: new THREE.BoxGeometry(0.38, 0.66, 0.26),
  headBox: new THREE.BoxGeometry(0.34, 0.32, 0.32),
  headCyl: new THREE.CylinderGeometry(0.19, 0.19, 0.32, 6),
  headIco: new THREE.IcosahedronGeometry(0.21, 0),
  cardboard: new THREE.BoxGeometry(0.4, 0.38, 0.38),
  visor: new THREE.BoxGeometry(0.26, 0.07, 0.04),
  chest: new THREE.BoxGeometry(0.12, 0.08, 0.03),
  limb: new THREE.BoxGeometry(0.11, 0.5, 0.11).translate(0, -0.25, 0),
  leg: new THREE.BoxGeometry(0.15, 0.86, 0.15).translate(0, -0.43, 0),
  foot: new THREE.BoxGeometry(0.17, 0.08, 0.26),
  hand: new THREE.BoxGeometry(0.12, 0.12, 0.12),
  antenna: new THREE.CylinderGeometry(0.012, 0.012, 0.22, 4).translate(0, 0.11, 0),
  ball: new THREE.IcosahedronGeometry(0.035, 0),
  drop: new THREE.TetrahedronGeometry(0.04),
  hit: new THREE.BoxGeometry(0.8, 2.0, 0.8),
  can: new THREE.CylinderGeometry(0.05, 0.05, 0.13, 6),
  glass: new THREE.CylinderGeometry(0.08, 0.015, 0.13, 6),
  straw: new THREE.CylinderGeometry(0.008, 0.008, 0.18, 3),
  umbrella: new THREE.ConeGeometry(0.08, 0.04, 6),
  stick: new THREE.BoxGeometry(0.03, 0.75, 0.03).translate(0, -0.37, 0),
  board: new THREE.PlaneGeometry(0.62, 0.38),
  rust: new THREE.BoxGeometry(0.1, 0.08, 0.02),
  tape: new THREE.BoxGeometry(0.1, 0.035, 0.07),
  phones: new THREE.TorusGeometry(0.21, 0.025, 4, 8, Math.PI),
  cup: new THREE.BoxGeometry(0.06, 0.12, 0.12),
  cap: new THREE.CylinderGeometry(0.22, 0.22, 0.1, 8),
  brim: new THREE.BoxGeometry(0.34, 0.02, 0.18),
  clip: new THREE.BoxGeometry(0.2, 0.26, 0.02),
};
const HITMAT = new THREE.MeshBasicMaterial({ visible: false });

const METALS = [0x8a9099, 0x5d6a75, 0xb0a48a, 0x6f7f6a, 0x9b6f6f, 0x48506a, 0xc0c4c8, 0x7a6a8f];
const VISORS = [0x39f5ff, 0xff3b5c, 0x7dff6a, 0xffc23b, 0xb46bff];
const SKINS = [0xf1c7a5, 0xd9a67e, 0x8d5a3b, 0xffe0c4];
const WIGS = [0xf6d2dc, 0xffffff, 0xff8ac4, 0xfff0a0];

const MAT = {
  sweat: new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.9 }),
  coolant: new THREE.MeshBasicMaterial({ color: 0x6dff4a }),
  card: flat(0xb98a55, { roughness: 1, metalness: 0 }),
  rust: flat(0x7a3b16, { roughness: 1 }),
  tape: flat(0xf4f1e6, { roughness: 1, metalness: 0 }),
  can: flat(0x1b1b1b, { metalness: 0.6 }),
  canBand: flat(0xffc800),
  glass: flat(0xff5fa8, { transparent: true, opacity: 0.85, emissive: 0x440022 }),
  umbrella: flat(0x2fd8ff),
  wood: flat(0x8a6a44),
  phones: flat(0x111111, { metalness: 0.4 }),
  navy: flat(0x1d2f5c, { metalness: 0.3 }),
  gold: flat(0xe8c050, { metalness: 0.8, roughness: 0.3 }),
  paper: flat(0xf2f2f2, { roughness: 1 }),
};

// 적외선(정전) 모드에서만 보이는 온도 오라
const AURA = {
  geo: new THREE.SphereGeometry(1, 10, 8),
  spot: new THREE.SphereGeometry(0.16, 8, 6),
  warm: new THREE.MeshBasicMaterial({ color: 0xff5a1e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, visible: false }),
  cold: new THREE.MeshBasicMaterial({ color: 0x1e46ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, visible: false }),
  hot: new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, visible: false, depthTest: false }),
};
const THERMAL_TINT = new THREE.Vector3(1.25, 0.8, 0.55);

let FACE_TEX = null;
// ── 상자 머리 모델 (3D/Assets/box.glb) ──
// 서버로 열면 파일을 직접 읽고, index.html을 더블클릭(file://)으로 열면 html 맨 아래에 넣어 둔 사본(BOX_GLB_B64)을 씀
const BOX_HEAD = { geo: null, mat: null, faceRot: 0 };
const boxHeadWaiting = new Set(); // 모델이 오기 전에 만들어진 상자 머리 → 도착하면 교체
function applyBoxHead(m) { m.geometry = BOX_HEAD.geo; m.material = BOX_HEAD.mat; }
(function loadBoxHead() {
  const loader = new GLTFLoader();
  const done = (gltf) => {
    let mesh = null; gltf.scene.updateMatrixWorld(true); gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) return;
    const g = mesh.geometry.clone(); g.applyMatrix4(mesh.matrixWorld);
    g.computeBoundingBox();
    const size = g.boundingBox.getSize(new THREE.Vector3()), c = g.boundingBox.getCenter(new THREE.Vector3());
    g.translate(-c.x, -c.y, -c.z);
    const k = 0.52 / Math.max(size.x, size.z); g.scale(k, k, k); // 상자 머리 폭 약 0.52m (기존 0.4보다 조금 크게)
    g.rotateY(BOX_HEAD.faceRot); // 그려진 얼굴이 앞(+z)을 보게
    BOX_HEAD.geo = g; BOX_HEAD.mat = mesh.material;
    if (BOX_HEAD.mat.map) { BOX_HEAD.mat.map.anisotropy = 8; }
    for (const m of boxHeadWaiting) applyBoxHead(m); boxHeadWaiting.clear();
  };
  const fromEmbedded = () => {
    const b64 = window.BOX_GLB_B64; if (!b64) return;
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    loader.parse(bin.buffer, '', done, (e) => console.warn('[box.glb]', e));
  };
  if (location.protocol === 'file:') fromEmbedded();
  else loader.load('3D/Assets/box.glb', done, undefined, fromEmbedded);
})();
function cardboardFace() {
  if (!FACE_TEX) FACE_TEX = canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = '#b98a55'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#111'; c.lineWidth = 6;
    c.strokeRect(22, 34, 30, 22); c.strokeRect(76, 34, 30, 22);
    c.fillStyle = '#111'; c.fillRect(32, 41, 10, 8); c.fillRect(86, 41, 10, 8);
    c.beginPath(); c.moveTo(34, 92); c.lineTo(94, 92); c.stroke();
    for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(40 + i * 12, 86); c.lineTo(40 + i * 12, 98); c.stroke(); }
    c.font = `bold 15px ${FONT}`; c.fillText('ROBOT', 42, 120);
  });
  return FACE_TEX;
}
const SIGN_TEXTS = [TR('인간에게\n춤을!', "LET HUMANS\nDANCE!"), TR('춤출 권리!', "RIGHT TO DANCE!"), TR('땀은\n죄가 아니다', "SWEAT IS\nNOT A CRIME"), 'HUMAN\nRIGHTS', TR('흥 = 인권', "VIBES =\nRIGHTS")];
const signTexCache = new Map();
function signTex(text) {
  if (!signTexCache.has(text)) signTexCache.set(text, canvasTexture(256, 160, (c, w, h) => {
    c.fillStyle = '#fdf6d8'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#c0182f'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
    c.fillStyle = '#c0182f'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `900 46px ${FONT}`;
    const lines = text.split('\n');
    lines.forEach((l, i) => c.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 52));
  }));
  return signTexCache.get(text);
}

// ── 이름 생성기 ─────────────────
const ROBOT_FUNNY = [TR('토스터-3000', "Toaster-3000"), TR('세탁기 프로', "WashMaster Pro"), TR('냉장고 형님', "Big Bro Fridge"), TR('로봇청소기 7세대', "Roomba Gen 7"), TR('전자레인지 MAX', "Microwave MAX"), TR('자판기 K', "Vending K"), TR('계산기-2', "Calculator-2"), TR('HUMAN-8 (로봇)', "HUMAN-8 (robot)")];
const HUMAN_FAKE = [TR('로봇 김철수', "Robo Steve"), TR('R2-영희', "R2-Karen"), TR('삐빅-민수', "Beep-Boop Mike"), TR('진짜로봇 박씨', "Real Robot Bob"), TR('ROBOT-지훈', "ROBOT-Jason"), TR('기계인간 수진', "Mecha Jessica"), TR('전자두뇌 1호', "E-Brain No.1"), TR('로봇입니다-3', "Am-Robot-3"), TR('메탈 혜원', "Metal Emily"), TR('볼트앤너트 준호', "Nuts&Bolts Kevin"), TR('삐-리-릭 동현', "Bee-Doo-Bop Dave"), TR('T-800(아님)', "T-800 (not)"), TR('알루미늄 지은', "Aluminum Amy")];
const ACTIVIST_FAKE = [TR('평범한 로봇 이씨', "Normal Robot Lee"), TR('R-인권', "R-Rights"), TR('토스터 (진짜임)', "Toaster (legit)"), TR('중립적 로봇 7', "Neutral Robot 7"), TR('아무 생각 없는 로봇', "Thoughtless Robot"), TR('혁명 아님-1', "Not-A-Revolt-1")];
const used = new Set();
function uniq(gen) { for (let i = 0; i < 30; i++) { const n = gen(); if (!used.has(n)) { used.add(n); return n; } } return gen() + '′'; }
function resetNames() { used.clear(); }
const robotName = () => uniq(() => Math.random() < 0.2 ? pick(ROBOT_FUNNY)
  : `${pick(['TX', 'RB', 'KX', 'ZR', 'MK', 'VN', 'QB', 'AX'])}-${randi(100, 9999)}`);
const humanName = () => uniq(() => pick(HUMAN_FAKE));
const activistName = () => uniq(() => pick(ACTIVIST_FAKE));
// 인간·로봇 구분 없이 같은 이름 풀에서 뽑음 (이름으로 정체를 알 수 없게)
const mixedName = () => uniq(() => { const r = Math.random();
  return r < 0.5 ? `${pick(['TX', 'RB', 'KX', 'ZR', 'MK', 'VN', 'QB', 'AX'])}-${randi(100, 9999)}`
    : r < 0.7 ? pick(ROBOT_FUNNY) : pick([...HUMAN_FAKE, ...ACTIVIST_FAKE]); });

// ─────────────────────────────────────────────
class Patron {
  constructor(o) {
    Object.assign(this, { kind: 'robot', role: 'guest', name: '???', tells: [], herrings: [] }, o);
    this.isHuman = this.kind === 'human';
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body);

    const metal = pick(METALS);
    const mat = flat(metal, { metalness: 0.35, roughness: 0.6, map: metalTex() });
    const dark = flat(new THREE.Color(metal).multiplyScalar(0.6), { metalness: 0.35, roughness: 0.65, map: metalTex() });
    if (this.role === 'inspector') { mat.color.set(0x2b3f70); dark.color.set(0x1a2647); }
    if (this.vip) { mat.color.set(0xd8a428); mat.metalness = 0.85; dark.color.set(0x7a5a12); }

    this.hips = new THREE.Group(); this.hips.position.y = 0.9; this.body.add(this.hips);
    const tType = pick(['box', 'barrel', 'slim']);
    const torso = new THREE.Mesh(tType === 'box' ? GEO.torsoBox : tType === 'barrel' ? GEO.torsoBarrel : GEO.torsoSlim, mat);
    torso.position.y = 0.32; this.hips.add(torso);
    const front = tType === 'barrel' ? 0.26 : tType === 'box' ? 0.16 : 0.14;
    const chest = new THREE.Mesh(GEO.chest, glow(pick(VISORS), 1.6));
    chest.position.set(0, 0.45, front); this.hips.add(chest);
    if (this.has('rust')) for (let i = 0; i < 4; i++) {
      const r = new THREE.Mesh(GEO.rust, MAT.rust);
      r.position.set(rand(-0.16, 0.16), rand(0.1, 0.55), front + 0.005); r.rotation.z = rand(-1, 1);
      this.hips.add(r);
    }

    // 머리
    this.neck = new THREE.Group(); this.neck.position.y = 0.66; this.hips.add(this.neck);
    let head;
    if (this.has('cardboard')) {
      if (BOX_HEAD.geo) head = new THREE.Mesh(BOX_HEAD.geo, BOX_HEAD.mat); // box.glb 모델
      else { // 모델 로딩 전: 임시 상자 → 로딩되면 교체
        const face = new THREE.MeshStandardMaterial({ map: cardboardFace(), flatShading: true, roughness: 1 });
        head = new THREE.Mesh(GEO.cardboard, [MAT.card, MAT.card, MAT.card, MAT.card, face, MAT.card]);
        boxHeadWaiting.add(head);
      }
    } else {
      const hg = pick([GEO.headBox, GEO.headCyl, GEO.headIco]);
      head = new THREE.Mesh(hg, mat);
      const visor = new THREE.Mesh(GEO.visor, glow(pick(VISORS), 2));
      visor.position.set(0, 0.02, hg === GEO.headCyl ? 0.18 : hg === GEO.headIco ? 0.17 : 0.165);
      head.add(visor); this.visor = visor;
    }
    head.position.y = 0.18; this.neck.add(head);

    const ant = new THREE.Group(); ant.position.y = 0.36; this.neck.add(ant);
    ant.add(new THREE.Mesh(GEO.antenna, dark));
    const ball = new THREE.Mesh(GEO.ball, glow(0xff3355, 2)); ball.position.y = 0.23; ant.add(ball);
    if (this.has('tape')) {
      ant.rotation.z = 0.6; ant.position.x = 0.07;
      const tp = new THREE.Mesh(GEO.tape, MAT.tape); tp.position.set(0.02, 0.03, 0); tp.rotation.z = -0.3; ant.add(tp);
      const tp2 = tp.clone(); tp2.rotation.z = 0.5; tp2.position.y = 0.05; ant.add(tp2);
    }
    if (this.has('wig')) {
      const wm = flat(pick(WIGS), { roughness: 1, metalness: 0 });
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.42), wm); top.position.y = 0.36; this.neck.add(top);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.36, 0.1), wm); back.position.set(0, 0.18, -0.19); this.neck.add(back);
      const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.36), wm); sideL.position.set(0.21, 0.2, 0); this.neck.add(sideL);
      const sideR = sideL.clone(); sideR.position.x = -0.21; this.neck.add(sideR);
      const bang = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.06), wm); bang.position.set(0, 0.28, 0.19); this.neck.add(bang);
    }
    if (this.vip) { // 왕관
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.14, 6, 1, true), MAT.gold); crown.position.y = 0.42; this.neck.add(crown);
      for (let i = 0; i < 6; i++) {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 4), MAT.gold);
        sp.position.set(Math.sin(i * Math.PI / 3) * 0.19, 0.53, Math.cos(i * Math.PI / 3) * 0.19); this.neck.add(sp);
      }
    }
    if (this.role === 'dj') {
      const ph = new THREE.Mesh(GEO.phones, MAT.phones); ph.position.y = 0.2; this.neck.add(ph);
      for (const s of [-1, 1]) { const c = new THREE.Mesh(GEO.cup, MAT.phones); c.position.set(s * 0.21, 0.18, 0); this.neck.add(c); }
    }
    if (this.role === 'inspector') {
      const cap = new THREE.Mesh(GEO.cap, MAT.navy); cap.position.y = 0.38; this.neck.add(cap);
      const brim = new THREE.Mesh(GEO.brim, MAT.navy); brim.position.set(0, 0.34, 0.2); this.neck.add(brim);
      const badge = new THREE.Mesh(GEO.chest, MAT.gold); badge.position.set(0, 0.4, 0.22); this.neck.add(badge);
    }

    // 팔
    const handMat = this.has('skin') ? flat(pick(SKINS), { roughness: 0.9, metalness: 0 }) : dark;
    const mkArm = (x) => {
      const g = new THREE.Group(); g.position.set(x, 0.56, 0); this.hips.add(g);
      g.add(new THREE.Mesh(GEO.limb, dark));
      const hand = new THREE.Mesh(GEO.hand, handMat); hand.position.y = -0.55; g.add(hand);
      return g;
    };
    this.armL = mkArm(0.31); this.armR = mkArm(-0.31);

    // 들고 있는 것: 로봇은 오일캔, 인간은 칵테일
    const item = new THREE.Group(); item.position.set(0, -0.6, 0.08); this.armR.add(item);
    if (this.has('cocktail')) {
      item.add(new THREE.Mesh(GEO.glass, MAT.glass));
      const st = new THREE.Mesh(GEO.straw, MAT.tape); st.position.set(0.03, 0.08, 0); st.rotation.z = -0.3; item.add(st);
      const um = new THREE.Mesh(GEO.umbrella, MAT.umbrella); um.position.set(-0.03, 0.12, 0); item.add(um);
    } else if (this.role === 'inspector') {
      const cl = new THREE.Mesh(GEO.clip, MAT.wood); cl.rotation.x = -0.4; item.add(cl);
    } else if (this.role !== 'dj') {
      item.add(makeOilCan(0.15)); // 손에 든 오일 캔 (oil.glb)
    }

    // 피켓 (인권운동가)
    if (this.has('sign')) {
      const sg = new THREE.Group(); sg.position.y = -0.55; this.armL.add(sg);
      sg.add(new THREE.Mesh(GEO.stick, MAT.wood));
      const board = new THREE.Mesh(GEO.board, new THREE.MeshBasicMaterial({ map: signTex(pick(SIGN_TEXTS)), side: THREE.DoubleSide }));
      board.position.y = -0.8; board.rotation.x = Math.PI; sg.add(board);
    }

    // 다리
    const mkLeg = (x) => {
      const g = new THREE.Group(); g.position.set(x, 0.0, 0); this.hips.add(g);
      g.add(new THREE.Mesh(GEO.leg, dark));
      const f = new THREE.Mesh(GEO.foot, dark); f.position.set(0, -0.86, 0.04); g.add(f);
      return g;
    };
    this.legL = mkLeg(0.12); this.legR = mkLeg(-0.12);

    // 선택용 히트박스
    this.hit = new THREE.Mesh(GEO.hit, HITMAT); this.hit.position.y = 1.0;
    this.hit.userData.patron = this; this.root.add(this.hit);

    this.bubble = makeBubble(); this.bubble.position.y = 2.4; this.root.add(this.bubble);

    // 땀(인간) / 냉각수(로봇, 함정)
    this.drops = [];
    const dropMat = this.has('sweat') ? MAT.sweat : this.has('coolant') ? MAT.coolant : null;
    if (dropMat) for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(GEO.drop, dropMat); m.visible = false; this.root.add(m);
      this.drops.push({ m, v: 0 });
    }

    // 적외선 오라: 인간은 몸 전체가 따뜻, 로봇은 차가움. 과열 로봇은 가슴(CPU)만 뜨거움
    const aura = new THREE.Mesh(AURA.geo, this.isHuman ? AURA.warm : AURA.cold);
    aura.scale.set(0.42, 0.95, 0.36); aura.position.y = 1.0; aura.raycast = () => {}; aura.renderOrder = 3;
    this.root.add(aura);
    if (this.has('overheat')) {
      const hs = new THREE.Mesh(AURA.spot, AURA.hot); hs.position.set(0, 0.45, 0.12); hs.raycast = () => {}; hs.renderOrder = 4;
      this.hips.add(hs);
    }

    this.style = pick(['pulse', 'robot', 'sway']);
    this.hb = rand(0, 10); this.hRate = rand(1.3, 2.1);
    this.state = 'idle'; this.target = null; this.face = 0;
    this.wanderT = rand(18, 38); this.sneezeT = rand(4, 9); this.signT = rand(3, 8); this.signUp = 0;
    this.flyerT = rand(3, 7); this.bubbleT = 0; this.sipT = rand(3, 8); this.sip = 0; this.dropT = 0;
    this.speed = rand(1.0, 1.4); this.scanned = false; this.gone = false;
  }

  has(t) { return this.tells.includes(t) || this.herrings.includes(t); }
  get alive() { return this.state !== 'eject' && !this.gone; }

  showBubble(text, dur = 1.6, bg, fg) {
    const tex = bubbleTexture(text, bg, fg), [bw, bh] = tex.userData.size || [512, 170];
    this.bubble.material.map = tex; this.bubble.material.needsUpdate = true;
    const k = 0.00225; this.bubble.scale.set(bw * k, bh * k, 1);
    this.bubble.position.y = 2.2 + bh * k / 2; // 말풍선이 커지면 위로
    this.bubble.visible = true; this.bubbleT = dur;
  }

  eject() {
    if (this.state === 'eject') return;
    this.state = 'eject'; this.ejT = 0; this.vy = 0; this.target = null;
    const line = this.role === 'dj' ? (this.isHuman ? TR('내 감성이이~', "My feeeelings~") : TR('내 셋리스트으~', "My setliiiist~"))
      : this.role === 'inspector' ? TR('이건 기록에 남는다~!', "This goes on the recooord~!")
      : this.isHuman ? pick([TR('으아아악~!', "Aaaaaaah~!"), TR('내 흥이이이~', "My vibes~!"), TR('나 로봇..이라고!', "I'm a robot..I swear!"), TR('춤추게 해줘어~', "Let me daaance~")])
      : pick([TR('부당하다아~', "So unfaaair~"), TR('민원 넣을 거야~!', "I'm filing a complaint~!"), TR('삐빅 오류오류~', "Beep error errooor~"), TR('나 로봇인데에~', "But I'm a robooot~")]);
    this.showBubble(line, 2.5, this.isHuman ? '#ffe36b' : '#ffffff');
  }

  update(dt, t, beat, club) {
    if (this.bubbleT > 0) { this.bubbleT -= dt; if (this.bubbleT <= 0) this.bubble.visible = false; }
    this._drops(dt);

    if (this.state === 'eject') { this._eject(dt); return; }
    if (this.state === 'rise') {
      this.root.position.y = Math.min(this.riseTo, this.root.position.y + dt * 1.4);
      if (this.root.position.y >= this.riseTo) this.state = 'dance';
    }

    if (this.target) {
      const dx = this.target.x - this.root.position.x, dz = this.target.z - this.root.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.06) {
        const s = Math.min(dist, this.speed * dt);
        this.root.position.x += dx / dist * s; this.root.position.z += dz / dist * s;
        this.root.rotation.y = lerpAngle(this.root.rotation.y, Math.atan2(dx, dz), dt * 8);
        this._walk(t);
        return;
      }
      this.target = null; this.state = this.spotType || 'idle'; this.face = this.faceAfter ?? this.face;
    }
    this.root.rotation.y = lerpAngle(this.root.rotation.y, this.face, dt * 4);

    if (this.role === 'guest') {
      this.wanderT -= dt;
      if (this.wanderT <= 0) { this.wanderT = rand(20, 40); club.assign(this); }
    }
    if (this.has('sneeze')) {
      this.sneezeT -= dt;
      if (this.sneezeT <= 0) { this.sneezeT = rand(7, 13); this.sneezing = 0.5; this.showBubble(TR('에취!', "Achoo!"), 1.3); }
    }
    if (this.has('sign')) {
      this.signT -= dt;
      if (this.signT <= 0) { this.signT = rand(9, 15); this.signUp = 3.5; this.showBubble(pick([TR('인간에게 춤을!', "Let humans dance!"), TR('춤출 권리!', "RIGHT TO DANCE!"), TR('흥은 인권이다!', "Vibes are human rights!")]), 2.2, '#ffe0e0', '#a0001c'); }
      if (this.signUp > 0) this.signUp -= dt;
    }
    if (this.has('flyer')) {
      this.flyerT -= dt;
      if (this.flyerT <= 0) { this.flyerT = rand(6, 11); club.dropFlyer(this.root.position); }
    }

    this._resetPose();
    const dancing = this.state === 'dance';
    if (this.role === 'dj') this._djPose(t, beat);
    else if (dancing && this.has('offbeat')) this._humanDance(t);
    else if (dancing && beat != null && this.has('late')) this._robotDance(this._lateBeat(dt, beat));
    else if (dancing && beat != null) this._robotDance(beat);
    else this._idle(t, dt);
    if (this.confused > 0 && dancing) { this.confused -= dt; this.armR.rotation.set(-2.7, 0, -0.9); this.neck.rotation.z = 0.3; } // 템포 바뀌면 머리 긁적

    if (this.signUp > 0) { this.armL.rotation.set(-3.0, 0, 0.1); }
    if (this.sneezing > 0) { this.sneezing -= dt; this.hips.rotation.x = 0.35 * Math.sin((0.5 - this.sneezing) * Math.PI * 2); this.body.position.y += 0.05; }
  }

  _resetPose() {
    this.body.position.y = 0;
    this.hips.rotation.set(0, 0, 0);
    this.neck.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0.08); this.armR.rotation.set(0, 0, -0.08);
    this.legL.rotation.set(0, 0, 0); this.legR.rotation.set(0, 0, 0);
  }

  // 로봇: 박자에 '정확히' 맞춰 딱딱 끊기는 춤
  _robotDance(b) {
    const f = b % 1, n = Math.floor(b), pulse = Math.pow(1 - f, 6);
    if (this.style === 'pulse') {
      this.body.position.y = -0.08 * pulse;
      this.armL.rotation.x = this.armR.rotation.x = -0.4 - (n % 2 ? 1.0 : 0.5) * pulse;
      this.neck.rotation.x = 0.3 * pulse;
    } else if (this.style === 'robot') {
      const P = [[-1.57, 0, 0, 0], [0, -1.57, 0, 0], [-1.57, -1.57, 0.5, -0.5], [-3.0, -3.0, 0, 0]][n % 4];
      this.armL.rotation.x = P[0]; this.armR.rotation.x = P[1];
      this.armL.rotation.z = 0.08 + P[2]; this.armR.rotation.z = -0.08 + P[3];
      this.neck.rotation.y = n % 2 ? 0.4 : -0.4;
      this.body.position.y = -0.05 * pulse;
    } else {
      this.hips.rotation.y = n % 2 ? 0.35 : -0.35;
      this.body.position.y = -0.06 * pulse;
      this.armL.rotation.z = 0.5 + 0.4 * pulse; this.armR.rotation.z = -0.5 - 0.4 * pulse;
      this.armL.rotation.x = this.armR.rotation.x = -0.3;
    }
  }

  // 학원 다닌 인간: 박자는 맞추지만 살짝 늦고, 템포가 바뀌면 몇 초간 옛 박자로 춤춤
  _lateBeat(dt, beat) {
    const live = audio.liveBpm || 120, LAG = 0.3;
    if (this.myB == null || Math.abs(beat - LAG - this.myB) > 6) { this.myB = beat - LAG; this.myBpm = live; this.seenBpm = live; }
    if (Math.abs(live - this.seenBpm) > 0.5) {
      this.seenBpm = live; this.adaptT = rand(2.5, 4);
      if (Math.random() < 0.5) this.showBubble(pick([TR('어?', "Huh?"), TR('어어?', "Huh-what?"), TR('잠깐만...', "Wait...")]), 1.2);
    }
    if (this.adaptT > 0) {
      this.adaptT -= dt;
      if (this.adaptT <= 0) { this.myBpm = live; this.confused = 1.0; }
    }
    this.myB += dt * this.myBpm / 60;
    if (!(this.adaptT > 0)) this.myB += (beat - LAG - this.myB) * Math.min(1, dt * 0.8);
    return Math.max(0, this.myB);
  }

  // 인간: 박자 무시, 흐느적, 손은 하늘로
  _humanDance(t) {
    const h = this.hb + t * this.hRate * Math.PI;
    this.body.position.y = -0.07 * (0.5 + 0.5 * Math.sin(h * 2));
    this.hips.rotation.z = 0.2 * Math.sin(h); this.hips.rotation.y = 0.35 * Math.sin(h * 0.5);
    this.armL.rotation.x = -2.6 + 0.5 * Math.sin(h * 1.3); this.armR.rotation.x = -2.4 + 0.6 * Math.sin(h * 1.1 + 1);
    this.armL.rotation.z = 0.5 + 0.3 * Math.sin(h); this.armR.rotation.z = -0.5 - 0.3 * Math.sin(h + 2);
    this.neck.rotation.x = 0.3 * Math.sin(h * 2); this.neck.rotation.z = 0.25 * Math.sin(h);
    this.legL.rotation.x = 0.3 * Math.sin(h * 2); this.legR.rotation.x = -0.3 * Math.sin(h * 2);
  }

  _idle(t, dt) {
    this.neck.rotation.y = 0.25 * Math.sin(t * 0.4 + this.hb);
    this.sipT -= dt;
    if (this.sipT <= 0) { this.sipT = rand(4, 9); this.sip = 1.4; }
    if (this.sip > 0) { this.sip -= dt; this.armR.rotation.x = -2.0; this.armR.rotation.z = 0.5; this.neck.rotation.x = -0.2; }
    else this.armR.rotation.x = -0.6;
  }

  _walk(t) {
    this._resetPose();
    const s = Math.sin(t * 9 + this.hb);
    this.legL.rotation.x = 0.5 * s; this.legR.rotation.x = -0.5 * s;
    this.armL.rotation.x = -0.4 * s; this.armR.rotation.x = 0.4 * s;
    this.body.position.y = 0.03 * Math.abs(s);
  }

  _djPose(t, beat) {
    this.armR.rotation.x = -1.3 + 0.08 * Math.sin(t * 14);
    this.armL.rotation.x = -1.2;
    if (beat == null) return;
    if (this.isHuman) {
      this.neck.rotation.x = 0.35 * Math.sin(t * 2.3 + this.hb); this.hips.rotation.z = 0.15 * Math.sin(t * 1.2);
      this.armL.rotation.x = -2.8 + 0.4 * Math.sin(t * 1.7); this.armL.rotation.z = 0.4;
    } else {
      const pulse = Math.pow(1 - (beat % 1), 6);
      this.neck.rotation.x = 0.4 * pulse; this.body.position.y = -0.04 * pulse;
      if (Math.floor(beat) % 8 === 7) this.armL.rotation.x = -3.0;
    }
  }

  _drops(dt) {
    if (!this.drops.length) return;
    if (this.sweaty === false) { for (const d of this.drops) d.m.visible = false; return; } // 대결 모드: 상대가 땀 흘릴 때만
    this.dropT -= dt;
    if (this.dropT <= 0) {
      this.dropT = 0.2;
      const d = this.drops.find((d) => !d.m.visible);
      if (d) {
        d.m.visible = true; d.v = 0;
        const hy = this.root.position.y < -0.5 ? 0 : 1.75 + this.body.position.y;
        d.m.position.set(rand(-0.2, 0.2), hy, rand(-0.1, 0.22));
      }
    }
    for (const d of this.drops) if (d.m.visible) {
      d.v += dt * 5; d.m.position.y -= d.v * dt; d.m.rotation.y += dt * 4;
      if (d.m.position.y < 0.05) d.m.visible = false;
    }
  }

  _eject(dt) {
    this.ejT += dt;
    this._resetPose();
    this.armL.rotation.set(-2.9, 0, 0.5); this.armR.rotation.set(-2.9, 0, -0.5);
    this.legL.rotation.x = 0.4 * Math.sin(this.ejT * 30); this.legR.rotation.x = -0.4 * Math.sin(this.ejT * 30);
    if (this.ejT > 0.4) {
      this.vy += 9.8 * dt;
      this.root.position.y -= this.vy * dt;
      this.root.rotation.y += dt * 9;
    }
    if (this.root.position.y < -3.5) this.gone = true;
  }
}

// ═════════════ club.js ═════════════

// 클럽 '오버클럭' — CCTV 카메라로만 보는 장소
const DOOR = new THREE.Vector3(-8.3, 0, 4.6);
const DJ_POS = new THREE.Vector3(0, 0.4, -5.25);
const INSPECTOR_POS = new THREE.Vector3(5.9, 0, 3.4);

const TILE_COLORS = [0xff2a6d, 0x05d9e8, 0xd1f7ff, 0xffc93c, 0x9d4edd, 0x2bd27a];

class Club {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070103);
    this.scene.fog = new THREE.Fog(0x12030a, 9, 26);
    this.patrons = [];
    this.flyers = [];
    this.trapdoors = [];
    this.lastBeat = -1;
    this.party = 0;
    this.dark = 0; // 정전 정도 (0~1)
    this._build();
    this._cameras();
    this._spots();
    this._markers();
    psxifyTree(this.scene, PSX.club, true);
  }

  _build() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0x9a6a7a, 0x2a0a10, 2.8); s.add(this.hemi);
    const key = this.key = new THREE.DirectionalLight(0xffd0d8, 1.6); key.position.set(3, 8, 4); s.add(key);

    // 나무 바닥
    const wood = pixelTex(32, 32, (c, w, h) => {
      for (let i = 0; i < 4; i++) {
        const v = 60 + Math.random() * 25;
        for (let x = 0; x < w; x++) for (let y = 0; y < 8; y++) {
          const k = v + (Math.random() - 0.5) * 22;
          c.fillStyle = `rgb(${k + 30 | 0},${k * 0.45 | 0},${k * 0.35 | 0})`; c.fillRect(x, i * 8 + y, 1, 1);
        }
        c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(0, i * 8, w, 1); c.fillRect((i * 13) % w, i * 8, 1, 8);
      }
    }, [10, 8]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 14, 9, 7), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2; s.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(18, 14), flat(0x0a0306));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = 5.2; s.add(ceil);

    // 커튼 벽 (인스턴스)
    const fold = new THREE.BoxGeometry(0.5, 5.2, 0.18);
    const walls = [];
    for (let x = -9; x <= 9; x += 0.5) { walls.push([x, -7, 0]); walls.push([x, 7, 0]); }
    for (let z = -7; z <= 7; z += 0.5) { walls.push([-9, z, Math.PI / 2]); walls.push([9, z, Math.PI / 2]); }
    const curtainTex = pixelTex(8, 32, (c, w, h) => {
      for (let x = 0; x < w; x++) { const v = 150 + 80 * Math.sin(x / w * Math.PI * 2); for (let y = 0; y < h; y++) { const k = v + (Math.random() - 0.5) * 40; c.fillStyle = `rgb(${k | 0},${k * 0.9 | 0},${k * 0.9 | 0})`; c.fillRect(x, y, 1, 1); } }
    });
    const curtains = new THREE.InstancedMesh(fold, flat(0x8a1020, { roughness: 1, map: curtainTex }), walls.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    walls.forEach(([a, b, r], i) => {
      const off = (i % 2 ? 0.08 : -0.08);
      const pos = r ? new THREE.Vector3(a + off, 2.6, b) : new THREE.Vector3(a, 2.6, b + off);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r);
      m.compose(pos, q, new THREE.Vector3(1, 1, 1));
      curtains.setMatrixAt(i, m);
      curtains.setColorAt(i, col.setHSL(0.98, 0.7, 0.13 + (i % 3) * 0.03));
    });
    s.add(curtains);

    // 댄스플로어 타일
    this.tiles = [];
    const tg = new THREE.PlaneGeometry(0.96, 0.96);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: pick(TILE_COLORS), emissiveIntensity: 0.5, flatShading: true });
      const t = new THREE.Mesh(tg, mat);
      t.rotation.x = -Math.PI / 2; t.position.set(-2.5 + i, 0.012, -3.4 + j); s.add(t);
      this.tiles.push(t);
    }

    // DJ 부스
    const plat = new THREE.Mesh(new THREE.BoxGeometry(5, 0.4, 2.4), flat(0x1c1c22)); plat.position.set(0, 0.2, -5.6); s.add(plat);
    const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 0.7), flat(0x22222a, { metalness: 0.4 })); desk.position.set(0, 0.8, -4.6); s.add(desk);
    this.deskStripe = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.08, 0.72), glow(0xff2a6d, 2)); this.deskStripe.position.set(0, 0.95, -4.6); s.add(this.deskStripe);
    for (const x of [-0.6, 0.6]) {
      const tt = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 10), flat(0x111111)); tt.position.set(x, 1.22, -4.65); s.add(tt);
      const rec = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 10), flat(0x0a0a0a, { metalness: 0.7 })); rec.position.set(x, 1.25, -4.65); s.add(rec);
      (this.records ||= []).push(rec);
    }
    for (const x of [-3.2, 3.2]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.4, 0.9), flat(0x141418)); sp.position.set(x, 1.2, -5.8); s.add(sp);
      for (const y of [0.6, 1.6]) {
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.2, 0.08, 8), flat(0x2a2a30)); cone.rotation.x = Math.PI / 2; cone.position.set(x, y, -5.33); s.add(cone);
      }
    }
    // 네온 간판
    const neon = canvasTexture(1024, 256, (c, w, h) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      c.font = `900 150px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = '#ff2a6d'; c.shadowBlur = 30; c.fillStyle = '#ff5c8a'; c.fillText('OVERCLOCK', w / 2, h / 2 + 6);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), new THREE.MeshBasicMaterial({ map: neon, toneMapped: false }));
    sign.position.set(0, 3.7, -6.85); s.add(sign);

    // 바
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 7.5), flat(0x2a1208)); bar.position.set(7, 0.55, 0); s.add(bar);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, 7.6), flat(0x8a5a2a, { metalness: 0.3 })); top.position.set(7, 1.12, 0); s.add(top);
    bar.material.userData.psx = top.material.userData.psx = true; // 위에 얹는 상판·스티커와 겹쳐 깜빡이지 않게 PSX 떨림 제외
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 7), flat(0x3a1a0a)); shelf.position.set(8.6, 1.8, 0); s.add(shelf);
    const shelf2 = shelf.clone(); shelf2.position.y = 2.5; s.add(shelf2);
    const bottleG = new THREE.CylinderGeometry(0.07, 0.07, 0.32, 6);
    for (let i = 0; i < 26; i++) {
      const b = new THREE.Mesh(bottleG, glow(pick([0x3bff8a, 0xffb02e, 0x2ec4ff, 0xff2a6d, 0x222222]), 0.6));
      b.position.set(8.6, i % 2 ? 1.99 : 2.69, -3.3 + (i >> 1) * 0.52); s.add(b);
    }
    const stoolG = new THREE.CylinderGeometry(0.2, 0.15, 0.75, 6);
    for (let z = -2.6; z <= 2.6; z += 1.3) {
      const st = new THREE.Mesh(stoolG, flat(0x6b1020)); st.position.set(6.2, 0.37, z); s.add(st);
    }
    this._barDeco(s);
    // 바 광고판 (블랙코미디)
    const ad = canvasTexture(512, 256, (c, w, h) => {
      c.fillStyle = '#120a00'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffc800'; c.font = `900 56px ${FONT}`; c.textAlign = 'center';
      c.fillText(TR('오일 한 캔', "ONE CAN OF OIL"), w / 2, 90); c.fillText(TR('행복 한 캔', "ONE CAN OF JOY"), w / 2, 160);
      c.font = `24px ${FONT}`; c.fillStyle = '#ffeaa0'; c.fillText(TR('※ 인간 섭취 시 사망. 즐거운 사망.', "* Fatal if consumed by humans. Happily fatal."), w / 2, 220);
    });
    const adM = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: ad, toneMapped: false }));
    adM.position.set(8.85, 3.5, 0); adM.rotation.y = -Math.PI / 2; s.add(adM);

    // 라운지 소파
    for (const z of [-4.2, -1.2]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 2.2), flat(0x5a0d22)); seat.position.set(-7.9, 0.22, z); s.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 2.2), flat(0x4a0a1c)); back.position.set(-8.4, 0.65, z); s.add(back);
    }
    const tbl = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 8), flat(0x1a1a1a, { metalness: 0.5 })); tbl.position.set(-6.8, 0.25, -2.7); s.add(tbl);

    // 출입구
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 1.4), flat(0x101010, { metalness: 0.6 })); door.position.set(-8.85, 1.2, DOOR.z); s.add(door);
    const doorSign = canvasTexture(512, 160, (c, w, h) => {
      c.fillStyle = '#2a0000'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#ff3b3b'; c.font = `900 54px ${FONT}`; c.textAlign = 'center';
      c.fillText('ROBOTS ONLY', w / 2, 64);
      c.font = `700 36px ${FONT}`; c.fillText(TR('인간 출입 금지 · 안전 제일', "NO HUMANS · SAFETY FIRST"), w / 2, 122);
    });
    const ds = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.56), new THREE.MeshBasicMaterial({ map: doorSign, toneMapped: false }));
    ds.position.set(-8.75, 2.8, DOOR.z); ds.rotation.y = Math.PI / 2; s.add(ds);

    // 미러볼 & 조명
    this.disco = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), flat(0xdddddd, { metalness: 1, roughness: 0.15 }));
    this.disco.position.set(0, 4.3, -1); s.add(this.disco);
    this.lights = [
      new THREE.PointLight(0xff2a6d, 30, 0, 1.6),
      new THREE.PointLight(0x05d9e8, 30, 0, 1.6),
      new THREE.PointLight(0xffb02e, 20, 0, 1.6),
    ];
    this.lights[0].position.set(-3, 3.6, -2); this.lights[1].position.set(3, 3.6, -2); this.lights[2].position.set(5.5, 3.2, 2);
    this.lights.forEach((l) => s.add(l));

    this.beams = [];
    const coneG = new THREE.ConeGeometry(1.0, 5, 8, 1, true).translate(0, -2.5, 0);
    [0xff2a6d, 0x05d9e8, 0x9d4edd, 0xffc93c].forEach((c, i) => {
      const b = new THREE.Mesh(coneG, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      b.position.set(-3 + i * 2, 5.1, -3); s.add(b); this.beams.push(b);
    });

    // 바닥에 굴러다니는 병들
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(bottleG, flat(pick([0x3a2a10, 0x0d3a20, 0x501010]), { metalness: 0.3 }));
      b.rotation.z = Math.PI / 2; b.rotation.y = rand(0, 6);
      b.position.set(rand(-6, 5), 0.07, rand(2.5, 6)); s.add(b);
    }

    this.flyerGroup = new THREE.Group(); s.add(this.flyerGroup);
  }

  // ── 바 꾸미기: 낡은 상판 · 녹슨 앞판 · 스티커 · 소품 ─────────────
  _barDeco(s) {
    const TOP_Y = 1.15, FRONT_X = 6.595;
    const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };
    // 낡은 나무 상판: 결 · 긁힌 자국 · 오일 컵 자국 · 닳은 모서리
    const topTex = pixelTex(64, 64, (c, w, h) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const k = 92 + 18 * Math.sin(y * 0.55 + Math.sin(x * 0.2) * 1.5) + (Math.random() - 0.5) * 22;
        c.fillStyle = `rgb(${k + 28 | 0},${k * 0.58 | 0},${k * 0.3 | 0})`; c.fillRect(x, y, 1, 1);
      }
      c.strokeStyle = 'rgba(255,230,190,.28)'; c.lineWidth = 1;
      for (let i = 0; i < 9; i++) { c.beginPath(); const x = rand(0, w), y = rand(0, h); c.moveTo(x, y); c.lineTo(x + rand(-14, 14), y + rand(-4, 4)); c.stroke(); }
      c.strokeStyle = 'rgba(20,8,0,.55)'; c.lineWidth = 2;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(rand(8, w - 8), rand(8, h - 8), rand(5, 8), 0, 7); c.stroke(); } // 캔 자국
      c.fillStyle = 'rgba(10,6,0,.35)'; for (let i = 0; i < 2; i++) { c.beginPath(); c.ellipse(rand(10, w - 10), rand(10, h - 10), rand(4, 9), rand(3, 6), rand(0, 3), 0, 7); c.fill(); } // 오일 얼룩
      c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, 3, h); c.fillRect(w - 3, 0, 3, h); // 닳은 가장자리
    }, [1, 9]);
    // 바는 플레이어 눈앞이라 PSX 효과(아핀 일그러짐·꼭짓점 떨림)에서 제외하고, 밉맵으로 비스듬히 봐도 덜 반짝이게
    const steady = (tex) => { tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.anisotropy = 8; tex.needsUpdate = true; return tex; };
    const noPsx = (mat) => { mat.userData.psx = true; return mat; };
    steady(topTex);
    const topPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 7.6, 2, 24), noPsx(new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.55, metalness: 0.1 })));
    topPlane.rotation.x = -Math.PI / 2; topPlane.position.set(7, TOP_Y + 0.001, 0); s.add(topPlane);
    // 녹슨 금속 앞판: 리벳 · 녹물 자국
    const frontTex = pixelTex(64, 32, (c, w, h) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = 46 + (Math.random() - 0.5) * 16; c.fillStyle = `rgb(${k + 10 | 0},${k * 0.7 | 0},${k * 0.55 | 0})`; c.fillRect(x, y, 1, 1); }
      c.fillStyle = 'rgba(0,0,0,.6)'; for (let x = 0; x < w; x += 16) c.fillRect(x, 0, 1, h);
      c.fillStyle = '#9a8a78'; for (let x = 3; x < w; x += 16) for (const y of [3, h - 4]) { c.fillRect(x, y, 2, 2); c.fillRect(x + 9, y, 2, 2); }
      for (let i = 0; i < 6; i++) { const x = rand(0, w); c.fillStyle = 'rgba(150,60,20,.55)'; c.fillRect(x, rand(2, 10), 1.5, rand(6, 18)); } // 녹물
      c.fillStyle = 'rgba(160,70,25,.45)'; for (let i = 0; i < 5; i++) { c.beginPath(); c.arc(rand(0, w), rand(0, h), rand(1.5, 4), 0, 7); c.fill(); }
    }, [10, 1]);
    steady(frontTex);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 1.05, 24, 2), noPsx(new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.8, metalness: 0.4 })));
    front.rotation.y = -Math.PI / 2; front.position.set(FRONT_X, 0.55, 0); s.add(front);
    // 앞판 위쪽 테두리 네온 띠
    const neon = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 7.5), glow(0xff2a6d, 1.6)); neon.position.set(FRONT_X - 0.01, 1.06, 0); s.add(neon);

    // 스티커: 낡게(살짝 바래고, 비뚤고, 모서리가 떨어짐)
    const sticker = (draw, w, h, pw = 256, ph = Math.round(256 * h / w)) => {
      const tex = canvasTexture(pw, ph, (c) => {
        c.save(); draw(c, pw, ph); c.restore();
        // 바램 + 긁힘 + 떨어진 모서리
        c.fillStyle = 'rgba(255,240,220,.12)'; c.fillRect(0, 0, pw, ph);
        c.strokeStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 5; i++) { c.beginPath(); const x = rand(0, pw), y = rand(0, ph); c.moveTo(x, y); c.lineTo(x + rand(-30, 30), y + rand(-6, 6)); c.stroke(); }
        c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.moveTo(pw, 0); c.lineTo(pw - pw * 0.16, 0); c.lineTo(pw, ph * 0.22); c.fill();
      });
      return new THREE.Mesh(new THREE.PlaneGeometry(w, h), noPsx(new THREE.MeshStandardMaterial({ map: steady(tex), transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 })));
    };
    const label = (bg, fg, lines, opts = {}) => (c, w, h) => {
      c.fillStyle = bg; roundRect(c, 4, 4, w - 8, h - 8, opts.round ?? 18); c.fill();
      if (opts.border) { c.strokeStyle = opts.border; c.lineWidth = 8; roundRect(c, 10, 10, w - 20, h - 20, (opts.round ?? 18) - 4); c.stroke(); }
      c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
      lines.forEach((l, i) => { c.font = `${l[1] ?? 900} ${l[2] ?? 48}px ${FONT}`; c.fillText(l[0], w / 2, h * (i + 1) / (lines.length + 1)); });
    };
    const heart = (c, x, y, r, col) => { c.fillStyle = col; c.beginPath(); c.moveTo(x, y + r * 0.9); c.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.9, y - r * 1.2, x, y - r * 0.45); c.bezierCurveTo(x + r * 0.9, y - r * 1.2, x + r * 1.5, y - r * 0.1, x, y + r * 0.9); c.fill(); };
    const S = [
      [label('#c8102e', '#fff', [['ROBOTS ONLY', 900, 54]], { border: '#fff' }), 0.34, 0.13],
      [label('#ffd400', '#111', [[TR('땀 금지', 'NO SWEATING'), 900, 50], [TR('발견 즉시 귀가', 'violators sent home'), 600, 26]], { border: '#111' }), 0.24, 0.16],
      [label('#1b1b1b', '#7dffb0', [['01001000 01001001', 700, 30], [TR('(해석 금지)', '(do not decode)'), 500, 24]], { round: 6 }), 0.28, 0.1],
      [(c, w, h) => { label('#ff5c8a', '#fff', [['OIL ME', 900, 64]], { round: 60 })(c, w, h); heart(c, w * 0.12, h * 0.5, 22, '#fff'); heart(c, w * 0.88, h * 0.5, 22, '#fff'); }, 0.26, 0.11],
      [label('#f2f2f2', '#c8102e', [[TR('인간 냄새 나면', 'SMELL A HUMAN?'), 900, 40], [TR('보안실에 신고!', 'REPORT IT!'), 900, 40]], { border: '#c8102e' }), 0.26, 0.16],
      [label('#2b6cff', '#fff', [[TR('펌웨어는', 'KEEP YOUR'), 800, 34], [TR('항상 최신으로', 'FIRMWARE FRESH'), 800, 34]]), 0.24, 0.14],
      [(c, w, h) => { // 웃는 로봇 얼굴
        c.fillStyle = '#9aa7b0'; roundRect(c, 20, 20, w - 40, h - 40, 30); c.fill();
        c.fillStyle = '#39f5ff'; c.fillRect(w * 0.22, h * 0.32, w * 0.56, h * 0.16);
        c.strokeStyle = '#1b1b1b'; c.lineWidth = 10; c.beginPath(); c.arc(w / 2, h * 0.56, w * 0.18, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
        c.fillStyle = '#ff2a6d'; c.beginPath(); c.arc(w / 2, 12, 12, 0, 7); c.fill(); }, 0.13, 0.13],
      [label('#111', '#ffd400', [[TR('자석 금지', 'NO MAGNETS'), 900, 46], [TR('기억이 지워집니다', 'it wipes memories'), 500, 24]], { border: '#ffd400', round: 8 }), 0.22, 0.13],
    ];
    // 앞판 (플레이어 쪽에서 보이는 z -2.2 ~ 3)
    const frontSpots = [[-1.9, 0.78], [-1.2, 0.5], [-0.55, 0.82], [0.1, 0.42], [0.95, 0.75], [1.55, 0.45], [2.2, 0.8], [2.8, 0.52]];
    frontSpots.forEach(([z, y], i) => { const [d, w, h] = S[i % S.length]; const m = sticker(d, w * 1.8, h * 1.8); m.rotation.set(0, -Math.PI / 2, rand(-0.18, 0.18)); m.position.set(FRONT_X - 0.004, y, z); s.add(m); });
    // 상판 위에도 몇 장 (반쯤 떨어진 느낌)
    [[6.66, -0.95, 2], [6.7, 1.8, 4], [7.28, -0.25, 6], [7.3, 0.55, 0], [6.64, 0.05, 3], [7.25, 1.3, 7], [6.7, -1.75, 1]].forEach(([x, z, i]) => { const [d, w, h] = S[i]; const m = sticker(d, w * 0.85, h * 0.85); m.rotation.set(-Math.PI / 2, 0, rand(-0.6, 0.6)); m.position.set(x, TOP_Y + 0.003, z); s.add(m); });

    // ── 소품 ──
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.3, roughness: 0.05, side: THREE.DoubleSide });
    const steel = flat(0xb8bcc2, { metalness: 0.85, roughness: 0.35 });
    // 볼트·너트 그릇 (땅콩 대신)
    const bowl = new THREE.Group(); bowl.position.set(6.78, TOP_Y, 1.25);
    bowl.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.05, 0.045, 12, 1, true), flat(0x5a5f66, { metalness: 0.7, side: THREE.DoubleSide })), 0, 0.022, 0));
    const nutG = new THREE.CylinderGeometry(0.009, 0.009, 0.006, 6), boltG = new THREE.CylinderGeometry(0.004, 0.004, 0.03, 6);
    for (let i = 0; i < 18; i++) { const n = new THREE.Mesh(i % 3 ? nutG : boltG, steel); n.position.set(rand(-0.045, 0.045), 0.03 + rand(0, 0.015), rand(-0.045, 0.045)); n.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3)); bowl.add(n); }
    s.add(bowl);
    // 팁 병: "팁은 볼트로만"
    const jar = new THREE.Group(); jar.position.set(7.15, TOP_Y, -0.55);
    jar.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 12, 1, true), glassMat), 0, 0.08, 0));
    for (let i = 0; i < 9; i++) { const n = new THREE.Mesh(nutG, steel); n.position.set(rand(-0.04, 0.04), 0.01 + i * 0.006, rand(-0.04, 0.04)); n.rotation.set(rand(0, 3), 0, rand(0, 3)); jar.add(n); }
    const jl = sticker(label('#f4ead2', '#3a2510', [[TR('팁', 'TIPS'), 900, 54], [TR('볼트로만 받음', 'bolts only'), 700, 30]], { round: 6 }), 0.1, 0.07);
    jl.position.set(-0.061, 0.08, 0); jl.rotation.y = -Math.PI / 2; jar.add(jl);
    s.add(jar);
    // 오늘의 오일 메뉴판 (세워 둔 칠판)
    const menu = new THREE.Group(); menu.position.set(7.3, TOP_Y, 1.85); menu.rotation.y = -Math.PI / 2 - 0.35;
    const menuTex = canvasTexture(256, 340, (c, w, h) => {
      c.fillStyle = '#1d2a22'; c.fillRect(0, 0, w, h); c.strokeStyle = '#8a6a44'; c.lineWidth = 14; c.strokeRect(7, 7, w - 14, h - 14);
      c.fillStyle = '#f2efe6'; c.textAlign = 'center'; c.font = `900 34px ${FONT}`; c.fillText(TR('오늘의 오일', "TODAY'S OIL"), w / 2, 56);
      c.font = `600 24px ${FONT}`; c.textAlign = 'left';
      [[TR('10W-40 스트레이트', '10W-40 straight'), '3cr'], [TR('5W-30 온더록', '5W-30 on the rocks'), '4cr'], [TR('냉각수 하이볼', 'Coolant highball'), '5cr'], [TR('24K 금가루', '24K gold flake'), 'VIP']].forEach(([n, p], i) => { c.fillText(n, 26, 110 + i * 48); c.textAlign = 'right'; c.fillText(p, w - 24, 110 + i * 48); c.textAlign = 'left'; });
      c.fillStyle = '#ff8aa8'; c.font = `500 18px ${FONT}`; c.textAlign = 'center'; c.fillText(TR('* 인간 판매 불가', '* not for sale to humans'), w / 2, h - 30);
    });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.265), new THREE.MeshStandardMaterial({ map: menuTex, roughness: 0.9 }));
    board.position.y = 0.135; board.rotation.x = -0.12; menu.add(board);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.265, 0.01), flat(0x6a4a2a)); back.position.set(0, 0.13, -0.012); back.rotation.x = -0.12; menu.add(back);
    s.add(menu);
    // 호출 벨
    const bell = new THREE.Group(); bell.position.set(6.72, TOP_Y, -0.15);
    bell.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.012, 14), flat(0x1b1b1b)), 0, 0.006, 0));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), flat(0xd8b14a, { metalness: 0.9, roughness: 0.25 })); dome.position.y = 0.012; bell.add(dome);
    bell.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.018, 6), steel), 0, 0.055, 0));
    s.add(bell);
    // 코스터 + 빈 오일 캔 (하나는 쓰러져 있음)
    const coasterTex = canvasTexture(128, 128, (c, w) => { c.fillStyle = '#2a0a14'; c.beginPath(); c.arc(w / 2, w / 2, w / 2 - 2, 0, 7); c.fill(); c.fillStyle = '#ff5c8a'; c.font = `900 22px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('OVER', w / 2, w / 2 - 12); c.fillText('CLOCK', w / 2, w / 2 + 14); });
    for (const [x, z] of [[6.8, -1.3], [6.75, 2.35], [7.05, 0.15]]) { const co = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.004, 16), [flat(0x2a0a14), new THREE.MeshStandardMaterial({ map: coasterTex }), flat(0x2a0a14)]); co.position.set(x, TOP_Y + 0.002, z); co.rotation.y = rand(0, 6); s.add(co); }
    const can1 = makeOilCan(); can1.position.set(6.8, TOP_Y + 0.06, -1.3); s.add(can1);
    const can2 = makeOilCan(); can2.rotation.z = Math.PI / 2; can2.rotation.y = 0.7; can2.position.set(6.95, TOP_Y + 0.034, 2.3); s.add(can2);
    // 걸레(오일 닦는 천)
    const rag = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.11, 3, 1, 3), flat(0x8a7a5a, { roughness: 1 }));
    rag.position.set(7.2, TOP_Y + 0.006, 0.95); rag.rotation.y = 0.5; s.add(rag);
  }

  _cameras() {
    const mk = (name, pos, look, fov = 72) => {
      const cam = new THREE.PerspectiveCamera(fov, 4 / 3, 0.1, 40);
      cam.position.copy(pos); cam.lookAt(look);
      cam.userData.name = name;
      return cam;
    };
    this.cams = [
      mk(TR('CAM 01 · 댄스플로어', "CAM 01 · Dance Floor"), new THREE.Vector3(-5.5, 4.6, 6.4), new THREE.Vector3(0, 0.6, -1.6)),
      mk(TR('CAM 02 · DJ 부스', "CAM 02 · DJ Booth"), new THREE.Vector3(4.6, 4.3, -6.4), new THREE.Vector3(-1.2, 0.8, 1.2)),
      mk(TR('CAM 03 · 바', "CAM 03 · Bar"), new THREE.Vector3(1.6, 4.4, 6.4), new THREE.Vector3(6.4, 0.6, -0.5)),
      mk(TR('CAM 04 · 출입구/라운지', "CAM 04 · Entrance/Lounge"), new THREE.Vector3(-1.2, 4.6, 0.5), new THREE.Vector3(-7.6, 0.4, 0.8)),
    ];
    this.zoomCam = new THREE.PerspectiveCamera(42, 4 / 3, 0.05, 40);
    this.zoomCam.position.set(0, 2.5, 3);
    this.zoomCam.lookAt(0, 1, -1);
  }

  _spots() {
    this.spots = [];
    const toward = (p, tx, tz) => Math.atan2(tx - p.x, tz - p.z);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
      const p = new THREE.Vector3(-2.4 + i * 1.2 + rand(-0.2, 0.2), 0, -3.0 + j * 1.2 + rand(-0.2, 0.2));
      this.spots.push({ pos: p, type: 'dance', face: toward(p, 0, -5) + rand(-0.4, 0.4) });
    }
    for (const z of [-2.6, -1.3, 0, 1.3, 2.6]) this.spots.push({ pos: new THREE.Vector3(5.85, 0, z), type: 'bar', face: Math.PI / 2 });
    for (const [x, z] of [[-6.3, -4.2], [-6.3, -1.0], [-5.6, -2.6], [-6.0, 1.4]])
      this.spots.push({ pos: new THREE.Vector3(x, 0, z), type: 'lounge', face: toward({ x, z }, 0, -1) });
  }

  _markers() {
    const ringG = new THREE.RingGeometry(0.42, 0.52, 16);
    this.hoverRing = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false }));
    this.hoverRing.rotation.x = -Math.PI / 2; this.hoverRing.renderOrder = 5; this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);

    this.selMark = new THREE.Group(); this.selMark.visible = false; this.scene.add(this.selMark);
    const sr = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: 0xff2040, depthTest: false }));
    sr.rotation.x = -Math.PI / 2; sr.renderOrder = 6; this.selMark.add(sr);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 4), new THREE.MeshBasicMaterial({ color: 0xff2040, depthTest: false }));
    arrow.rotation.x = Math.PI; arrow.position.y = 2.75; arrow.renderOrder = 6; this.selMark.add(arrow);
    this.selArrow = arrow;
  }

  // ── 손님 관리 ─────────────────────
  add(p, pos) {
    psxifyTree(p.root, PSX.club, true);
    p.root.position.copy(pos);
    this.scene.add(p.root);
    this.patrons.push(p);
  }
  remove(p) {
    this.scene.remove(p.root);
    this.patrons = this.patrons.filter((x) => x !== p);
    if (p.spot) { p.spot.occ = null; p.spot = null; }
  }
  assign(p, type) {
    if (!type) { const r = Math.random(); type = r < 0.68 ? 'dance' : r < 0.88 ? 'bar' : 'lounge'; }
    let free = this.spots.filter((s) => s.type === type && !s.occ);
    if (!free.length) free = this.spots.filter((s) => !s.occ);
    if (!free.length) return;
    const s = pick(free);
    if (p.spot) p.spot.occ = null;
    s.occ = p; p.spot = s;
    p.target = s.pos.clone();
    p.spotType = s.type === 'dance' ? 'dance' : 'idle';
    p.faceAfter = s.face;
  }
  place(p, type) { // 즉시 배치 (밤 시작 시)
    this.assign(p, type);
    this.add(p, p.target);
    p.target = null; p.state = p.spotType; p.face = p.faceAfter; p.root.rotation.y = p.face;
  }
  enter(p) {
    this.add(p, DOOR);
    p.root.rotation.y = Math.PI / 2;
    this.assign(p);
  }
  hitboxes() { return this.patrons.filter((p) => p.alive).map((p) => p.hit); }

  trapdoor(pos) {
    const g = new THREE.Group();
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.55, 8), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 8), new THREE.MeshBasicMaterial({ color: 0xffd400 }));
    hole.rotation.x = ring.rotation.x = -Math.PI / 2;
    hole.position.y = 0.025; ring.position.y = 0.022;
    g.add(hole, ring);
    g.position.set(pos.x, pos.y, pos.z);
    g.scale.setScalar(0.01);
    this.scene.add(g);
    this.trapdoors.push({ g, t: 0 });
  }

  dropFlyer(pos) {
    if (this.flyers.length > 40) this.flyerGroup.remove(this.flyers.shift());
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff7d0 }));
    f.rotation.set(-Math.PI / 2, 0, rand(0, 6));
    f.position.set(pos.x + rand(-0.6, 0.6), 0.02, pos.z + rand(-0.6, 0.6));
    this.flyerGroup.add(f); this.flyers.push(f);
  }

  reset() {
    for (const p of [...this.patrons]) this.remove(p);
    for (const f of this.flyers) this.flyerGroup.remove(f);
    this.flyers = [];
    for (const s of this.spots) s.occ = null;
  }

  setMarkers(hover, sel, t) {
    this.hoverRing.visible = !!(hover && hover.alive && hover !== sel);
    if (this.hoverRing.visible) this.hoverRing.position.set(hover.root.position.x, hover.root.position.y + 0.04, hover.root.position.z);
    this.selMark.visible = !!sel;
    if (sel) {
      this.selMark.position.set(sel.root.position.x, Math.max(sel.root.position.y, 0) + 0.05, sel.root.position.z);
      this.selMark.rotation.y = t * 2;
      this.selArrow.position.y = 2.75 + 0.1 * Math.sin(t * 6);
    }
  }

  update(dt, t, beat) {
    for (const p of [...this.patrons]) {
      p.update(dt, t, beat, this);
      if (p.gone) this.remove(p);
    }
    for (const td of [...this.trapdoors]) {
      td.t += dt;
      const k = td.t < 0.25 ? td.t / 0.25 : td.t < 2.0 ? 1 : Math.max(0.01, 1 - (td.t - 2.0) / 0.3);
      td.g.scale.setScalar(k);
      if (td.t > 2.3) { this.scene.remove(td.g); this.trapdoors.splice(this.trapdoors.indexOf(td), 1); }
    }

    const b = beat ?? t * 0.5;
    const pulse = beat == null ? 0.2 : Math.pow(1 - (b % 1), 3);
    const n = Math.floor(b);
    if (beat != null && n !== this.lastBeat) {
      this.lastBeat = n;
      for (const tile of this.tiles) if (Math.random() < 0.5) tile.material.emissive.setHex(pick(TILE_COLORS));
    }
    const party = this.party;
    for (const tile of this.tiles) tile.material.emissiveIntensity = (beat == null ? 0.12 : 0.25 + 0.9 * pulse) * (1 + party);
    this.lights.forEach((l, i) => { l.intensity = (beat == null ? 6 : 14 + 30 * pulse * (i === n % 3 ? 1.3 : 0.6)) * (1 + party); });
    this.disco.rotation.y += dt * 0.6;
    this.beams.forEach((bm, i) => {
      bm.rotation.z = 0.5 * Math.sin(t * 0.7 + i * 1.7);
      bm.rotation.x = 0.4 * Math.cos(t * 0.5 + i);
      bm.material.opacity = beat == null ? 0.03 : 0.07 + 0.08 * pulse + 0.1 * party;
    });
    this.deskStripe.material.emissiveIntensity = beat == null ? 0.3 : 1 + 2 * pulse;
    // 정전: 조명 끄고 적외선 오라 켜기
    const dk = this.dark, lit = 1 - dk;
    this.hemi.intensity = 2.8 * (1 - 0.94 * dk); this.key.intensity = 1.6 * (1 - 0.97 * dk);
    if (dk > 0) {
      this.lights.forEach((l) => (l.intensity *= 1 - 0.97 * dk));
      for (const tile of this.tiles) tile.material.emissiveIntensity *= 1 - 0.92 * dk;
      this.beams.forEach((bm) => (bm.material.opacity *= lit));
      this.deskStripe.material.emissiveIntensity *= lit;
    }
    const flick = 0.85 + 0.15 * Math.sin(t * 23);
    AURA.warm.opacity = 0.5 * dk * flick; AURA.cold.opacity = 0.32 * dk; AURA.hot.opacity = 0.9 * dk * flick;
    AURA.warm.visible = AURA.cold.visible = AURA.hot.visible = dk > 0.02;
    if (beat != null) for (const r of this.records) r.rotation.y += dt * 3.5;
  }
}

// ═════════════ room.js ═════════════

// 보안실 — 플레이어가 실제로 '서 있는' XR 공간.
// 눈높이 1.25m(앉은 자세) 기준으로 배치. XR에서는 진입 시 자동으로 맞춤.
const EYE = new THREE.Vector3(0, 1.25, 0.15);
const DESK_Y = 0.78;

const CRT_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const CRT_FRAG = /* glsl */`
uniform sampler2D map; uniform float time; uniform float glitch; uniform vec3 tint; uniform float on; uniform vec2 res;
varying vec2 vUv;
float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec2 cc = vUv - 0.5; float d = dot(cc, cc);
  vec2 uv = 0.5 + cc * (1.0 + 0.12 * d);
  float line = floor(uv.y * 90.0);
  uv.x += glitch * (rnd(vec2(line, floor(time * 24.0))) - 0.5) * 0.12;
  vec3 col = texture2D(map, uv).rgb;
  col *= 0.94 + 0.06 * sin(uv.y * 900.0);
  col += (rnd(floor(vUv * vec2(320.0, 240.0)) + fract(time * 7.13) * 91.0) - 0.5) * (0.015 + glitch * 0.08);
  col = col * tint * 1.8;
  col *= smoothstep(0.95, 0.5, length(cc));
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);
  gl_FragColor = vec4(col * on, 1.0);
  #include <colorspace_fragment>
  // PSX 15bit 컬러 + 4x4 베이어 디더링 (CCTV 해상도 픽셀 단위)
  vec2 px = floor(clamp(uv, 0.0, 1.0) * res);
  int bi = int(mod(px.x, 4.0)) + int(mod(px.y, 4.0)) * 4;
  float bay[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  float dth = (bay[bi] / 16.0 - 0.5) / 63.0;
  gl_FragColor.rgb = floor((gl_FragColor.rgb + dth) * 63.0 + 0.5) / 63.0;
}`;
// 화면 UV → 카메라 NDC (셰이더의 배럴 왜곡과 동일하게)
function screenUvToNdc(uv) {
  const cx = uv.x - 0.5, cy = uv.y - 0.5, d = cx * cx + cy * cy, k = 1 + 0.12 * d;
  return new THREE.Vector2((0.5 + cx * k) * 2 - 1, (0.5 + cy * k) * 2 - 1);
}

class Monitor {
  constructor(room, { w, h, res, pos, rotY = 0, rotX = 0, cam, label, tint = [0.75, 1.0, 0.8] }) {
    this.cam = cam; this.label = label;
    this.rt = new THREE.WebGLRenderTarget(res[0], res[1], { magFilter: THREE.NearestFilter, minFilter: THREE.LinearFilter });
    this.group = new THREE.Group();
    this.group.position.copy(pos); this.group.rotation.set(rotX, rotY, 0, 'YXZ');
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.07, h + 0.07, 0.14), flat(0x1e2b24, { metalness: 0.5 }));
    frame.position.z = -0.07; this.group.add(frame);
    this.uniforms = { map: { value: this.rt.texture }, time: { value: 0 }, glitch: { value: 0 }, tint: { value: new THREE.Vector3(...tint) }, on: { value: 1 }, res: { value: new THREE.Vector2(res[0], res[1]) } };
    this.w = w; this.baseTint = new THREE.Vector3(...tint);
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: CRT_VERT, fragmentShader: CRT_FRAG }));
    this.screen.position.z = 0.002;
    this.screen.userData.interact = { monitor: this };
    this.group.add(this.screen);
    this.overlay = new CanvasPanel(w, h, 512, Math.round(512 * h / w), { transparent: true });
    this.overlay.mesh.position.z = 0.004; this.overlay.mesh.raycast = () => {};
    this.group.add(this.overlay.mesh);
    room.scene.add(this.group);
    room.interactives.push(this.screen);
    this.home = { pos: this.group.position.clone(), quat: this.group.quaternion.clone(), scale: 1 };
    this.goal = this.home;
  }
  drawOverlay(name, clock, rec, extra) {
    const { ctx: c, w, h } = this.overlay;
    c.clearRect(0, 0, w, h);
    c.font = `700 26px ${FONT}`; c.fillStyle = 'rgba(220,255,230,.95)'; c.textBaseline = 'top';
    c.shadowColor = '#000'; c.shadowBlur = 4;
    c.fillText(name, 16, 12);
    c.textAlign = 'right'; c.fillText(clock, w - 16, h - 40);
    if (rec) { c.fillStyle = '#ff2a3a'; c.beginPath(); c.arc(w - 98, 26, 9, 0, 7); c.fill(); c.fillStyle = 'rgba(255,220,220,.95)'; c.fillText('REC', w - 16, 12); }
    if (extra) { c.textAlign = 'left'; c.fillStyle = '#ffd84a'; c.fillText(extra, 16, h - 40); }
    c.textAlign = 'left';
    this.overlay.commit();
  }
}

class DeskButton {
  constructor(room, { color, label, x, z = -0.52, r = 0.045, big = false }) {
    this.r = r; this.touch = 0;
    this.group = new THREE.Group(); this.group.position.set(x, DESK_Y, z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.018, r + 0.025, 0.03, 12), flat(big ? 0xffd400 : 0x111614));
    base.position.y = 0.015; this.group.add(base);
    this.mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, flatShading: true, roughness: 0.4 });
    this.cap = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.04, 12), this.mat);
    this.cap.position.y = 0.05; this.group.add(this.cap);
    const lab = new CanvasPanel(0.17, 0.05, 340, 100);
    const c = lab.ctx; c.fillStyle = '#0c1410'; c.fillRect(0, 0, 340, 100);
    c.fillStyle = '#d8ffe6'; c.font = `800 50px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, 170, 54);
    lab.commit();
    lab.mesh.rotation.x = -Math.PI / 2 + 0.25; lab.mesh.position.set(0, 0.003, r + 0.07);
    this.group.add(lab.mesh);
    this.press = 0; this.hover = false; this.hl = false;
    this.group.traverse((o) => { if (o.isMesh) o.userData.button = this; });
    room.scene.add(this.group);
    room.interactives.push(this.group);
  }
  push() { this.press = 1; }
  update(dt, t) {
    this.press = Math.max(0, this.press - dt * 5);
    this.cap.position.y = 0.05 - 0.022 * Math.max(this.press, this.touch);
    this.mat.emissiveIntensity = 0.25 + (this.hover ? 0.6 : 0) + (this.hl ? 0.9 * (0.5 + 0.5 * Math.sin(t * 9)) : 0);
  }
}

class Lever {
  constructor(room, { x, z = -0.52, label }) {
    this.group = new THREE.Group(); this.group.position.set(x, DESK_Y, z);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.14), flat(0x111614)); base.position.y = 0.02; this.group.add(base);
    this.pivot = new THREE.Group(); this.pivot.position.y = 0.04; this.group.add(this.pivot);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 6).translate(0, 0.08, 0), flat(0x999999, { metalness: 0.8 }));
    this.pivot.add(stick);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffc800, emissive: 0xffc800, emissiveIntensity: 0.25, flatShading: true });
    const knob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), this.mat); knob.position.y = 0.17; this.pivot.add(knob);
    this.knob = knob; this.isLever = true; this.touch = 0;
    const lab = new CanvasPanel(0.17, 0.05, 340, 100);
    const c = lab.ctx; c.fillStyle = '#0c1410'; c.fillRect(0, 0, 340, 100);
    c.fillStyle = '#ffe680'; c.font = `800 50px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, 170, 54);
    lab.commit(); lab.mesh.rotation.x = -Math.PI / 2 + 0.25; lab.mesh.position.set(0, 0.003, 0.115);
    this.group.add(lab.mesh);
    this.press = 0; this.hover = false; this.hl = false;
    this.group.traverse((o) => { if (o.isMesh) o.userData.button = this; });
    room.scene.add(this.group);
    room.interactives.push(this.group);
  }
  push() { this.press = 1; }
  update(dt, t) {
    if (this.touch) this.hover = true;
    this.press = Math.max(0, this.press - dt * 1.2);
    if (this.grabAngle != null) this.pivot.rotation.x = this.grabAngle;
    else {
      const target = -0.5 + 1.2 * Math.min(1, this.press * 2);
      this.pivot.rotation.x += (target - this.pivot.rotation.x) * Math.min(1, dt * 14);
    }
    this.mat.emissiveIntensity = 0.25 + (this.hover ? 0.6 : 0) + (this.hl ? 0.9 * (0.5 + 0.5 * Math.sin(t * 9)) : 0);
  }
}

// 손으로 집을 수 있는 물건
// 오일 캔 = 3D/Assets/oil1.glb (보안실 책상 · 바 음료 · 장식 · 로봇 손님 손에 든 캔 공용)
// 서버로 열면 파일을 직접 읽고, file:// 로 열면 html 맨 아래 사본(OIL_GLB_B64)을 씀. 로딩 전엔 임시 캔 → 도착하면 교체
const OIL_MODEL = { tpl: null, waiting: [] };
function oilPlaceholder(g, h) {
  const k = h / 0.12;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.033 * k, 0.033 * k, h, 8), flat(0x1b1b1b, { metalness: 0.6 }));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0336 * k, 0.0336 * k, 0.045 * k, 8), flat(0xffc800));
  g.add(body, band);
}
function oilSwapIn(g, h) { // 임시 캔을 모델로 교체 (잡기·클릭용 userData는 그대로 옮김)
  let ud = null; g.traverse((o) => { if (o.isMesh && !ud && Object.keys(o.userData).length) ud = { ...o.userData }; });
  g.clear();
  const m = OIL_MODEL.tpl.clone(true); m.scale.multiplyScalar(h / OIL_MODEL.h); g.add(m);
  if (ud) g.traverse((o) => { if (o.isMesh) Object.assign(o.userData, ud); });
}
function makeOilCan(h = 0.12) { // 가운데가 원점, 높이 h(m)
  const g = new THREE.Group();
  if (OIL_MODEL.tpl) { const m = OIL_MODEL.tpl.clone(true); m.scale.multiplyScalar(h / OIL_MODEL.h); g.add(m); }
  else { oilPlaceholder(g, h); OIL_MODEL.waiting.push([g, h]); }
  return g;
}
(function loadOilModel() {
  const loader = new GLTFLoader();
  const done = (gltf) => {
    const root = gltf.scene; root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const tpl = new THREE.Group(), inner = new THREE.Group(); inner.add(root); root.position.sub(c); tpl.add(inner);
    root.traverse((o) => { if (o.isMesh && o.material.map) o.material.map.anisotropy = 8; });
    OIL_MODEL.tpl = tpl; OIL_MODEL.h = size.y; // 높이 기준으로 크기 맞춤
    for (const [g, h] of OIL_MODEL.waiting) oilSwapIn(g, h); OIL_MODEL.waiting.length = 0;
  };
  const fromEmbedded = () => {
    const b64 = window.OIL_GLB_B64; if (!b64) return;
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    loader.parse(bin.buffer, '', done, (e) => console.warn('[oil.glb]', e));
  };
  if (location.protocol === 'file:') fromEmbedded();
  else loader.load('3D/Assets/oil1.glb', done, undefined, fromEmbedded);
})();
class Grabbable {
  constructor(room, kind, pos) {
    this.kind = kind;
    this.group = new THREE.Group(); this.group.position.copy(pos);
    if (kind === 'oil') {
      this.group.add(makeOilCan()); this.half = 0.06;
    } else {
      const mugM = flat(0xd8d0c0);
      const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.09, 8), mugM);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.007, 4, 8), mugM); handle.position.x = 0.045;
      const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.036, 8), flat(0x2a160a)); coffee.rotation.x = -Math.PI / 2; coffee.position.y = 0.041;
      this.group.add(mug, handle, coffee); this.half = 0.045;
    }
    this.home = pos.clone(); this.held = null; this.resting = true; this.vy = 0;
    this.anim = null; this.drinkT = 0; this.cool = 0; this.floorT = 0;
    this.group.traverse((o) => { if (o.isMesh) o.userData.grab = this; });
    room.scene.add(this.group); room.interactives.push(this.group);
  }
}
const onDesk = (x, z) => (Math.abs(x) < 0.76 && z > -0.99 && z < -0.37) || (Math.abs(x) > 0.6 && Math.abs(x) < 1.3 && z > -0.85 && z < -0.15);

class Room {
  constructor(club) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x010302);
    this.interactives = [];
    this._build();

    const C = club.cams;
    const sideW = 0.4, sideH = 0.3;
    this.zoom = new Monitor(this, { w: 0.62, h: 0.465, res: [640, 480], pos: new THREE.Vector3(0, 1.235, -0.95), cam: club.zoomCam, label: 'ZOOM', tint: [0.95, 1.0, 0.9] });
    this.cams = [
      new Monitor(this, { w: sideW, h: sideH, res: [448, 336], pos: new THREE.Vector3(-0.64, 1.40, -0.86), rotY: 0.36, cam: C[0], label: C[0].userData.name }),
      new Monitor(this, { w: sideW, h: sideH, res: [448, 336], pos: new THREE.Vector3(-0.64, 1.07, -0.86), rotY: 0.36, cam: C[1], label: C[1].userData.name }),
      new Monitor(this, { w: sideW, h: sideH, res: [448, 336], pos: new THREE.Vector3(0.64, 1.40, -0.86), rotY: -0.36, cam: C[2], label: C[2].userData.name }),
      new Monitor(this, { w: sideW, h: sideH, res: [448, 336], pos: new THREE.Vector3(0.64, 1.07, -0.86), rotY: -0.36, cam: C[3], label: C[3].userData.name }),
    ];
    this.monitors = [this.zoom, ...this.cams];

    // 패널들
    this.dialog = new CanvasPanel(0.88, 0.3, 1056, 360);
    this.dialog.mesh.position.set(0, 1.69, -1.0); this.dialog.mesh.rotation.x = 0.12;
    this.scene.add(this.dialog.mesh);
    this.status = new CanvasPanel(0.4, 0.3, 512, 384);
    this.status.mesh.position.set(0.7, 1.72, -0.9); this.status.mesh.rotation.set(0.12, -0.36, 0, 'YXZ');
    this.scene.add(this.status.mesh);
    this.scan = new CanvasPanel(0.62, 0.17, 1024, 280);
    this.scan.mesh.position.set(0, 0.905, -0.9); this.scan.mesh.rotation.x = -0.45;
    this.scene.add(this.scan.mesh);
    // VR 튜토리얼 조작 그림 카드 (왼쪽 위 포스터 앞에 잠깐 덮어 띄움)
    this.guide = new CanvasPanel(0.44, 0.33, 640, 480);
    this.guide.mesh.position.set(-0.68, 1.72, -0.86); this.guide.mesh.rotation.set(0.12, 0.36, 0, 'YXZ');
    this.guide.mesh.visible = false;
    this.scene.add(this.guide.mesh);

    // 버튼
    this.buttons = {
      ok: new DeskButton(this, { color: 0x2bd27a, label: TR('확인', "OK"), x: -0.44 }),
      scan: new DeskButton(this, { color: 0x2b8cff, label: TR('스캔', "SCAN"), x: -0.19 }),
      eject: new DeskButton(this, { color: 0xff2030, label: TR('귀가 조치', "EJECT"), x: 0.1, r: 0.062, big: true }),
      dj: new Lever(this, { x: 0.42, label: TR('DJ 교체', "SWAP DJ") }),
    };
    this.grabbables = [
      new Grabbable(this, 'oil', new THREE.Vector3(-0.62, DESK_Y + 0.06, -0.62)),
      new Grabbable(this, 'coffee', new THREE.Vector3(0.64, DESK_Y + 0.045, -0.6)),
    ];
    this.alarm = 0; this.partyMode = 0;
    this.focused = null;
    psxifyTree(this.scene, PSX.room, false);
  }

  // 모니터를 눈앞으로 끌어오기 (다시 하면 제자리)
  toggleFocus(mon, camera) {
    if (!mon || this.focused === mon) { this.unfocus(); return false; }
    this.unfocus();
    const eye = new THREE.Vector3(), fwd = new THREE.Vector3();
    camera.getWorldPosition(eye); camera.getWorldDirection(fwd);
    fwd.y = Math.min(fwd.y, 0.1); fwd.normalize();
    const pos = eye.clone().addScaledVector(fwd, 0.5); pos.y -= 0.06;
    const dummy = new THREE.Object3D(); dummy.position.copy(pos); dummy.lookAt(eye);
    mon.goal = { pos, quat: dummy.quaternion.clone(), scale: 0.62 / mon.w };
    this.focused = mon;
    return true;
  }
  unfocus() { if (this.focused) { this.focused.goal = this.focused.home; this.focused = null; } }

  _build() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0x8fd0a8, 0x0a1410, 1.1); s.add(this.hemi);
    this.lamp = new THREE.PointLight(0x9fffc8, 2.5, 0, 1.5); this.lamp.position.set(0, 2.2, -0.2); s.add(this.lamp);
    this.alarmLight = new THREE.PointLight(0xff0010, 0, 0, 1.2); this.alarmLight.position.set(0, 2.3, 0.5); s.add(this.alarmLight);

    const wallM = flat(0x24332b, { metalness: 0.4, roughness: 0.6 });
    const panelTex = pixelTex(32, 32, (c, w, h) => {
      noiseFill(c, w, h, 150, 40, 2);
      c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(0, 0, w, 1); c.fillRect(0, 0, 1, h);
      c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(1, 1, w - 1, 1);
      c.fillStyle = '#333'; [[4, 4], [26, 4], [4, 26], [26, 26]].forEach(([x, y]) => c.fillRect(x, y, 2, 2));
    }, [6, 4]);
    const room = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 3.4, 4, 3, 4), new THREE.MeshStandardMaterial({ color: 0x2c4235, map: panelTex, flatShading: true, side: THREE.BackSide, metalness: 0.3, roughness: 0.7 }));
    room.position.set(0, 1.3, 0.3); s.add(room);
    // 벽 리브
    for (let x = -1.6; x <= 1.6; x += 0.4) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.6, 0.06), wallM); rib.position.set(x, 1.3, -1.37); s.add(rib);
    }
    for (const sx of [-1, 1]) for (let z = -1.2; z <= 1.9; z += 0.45) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.6, 0.05), wallM); rib.position.set(sx * 1.67, 1.3, z); s.add(rib);
    }
    // 바닥 그레이팅
    const grate = canvasTexture(128, 128, (c, w, h) => {
      c.fillStyle = '#0b100d'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#2a3530'; for (let i = 0; i < 8; i++) c.fillRect(0, i * 16 + 2, w, 9);
    });
    grate.wrapS = grate.wrapT = THREE.RepeatWrapping; grate.repeat.set(6, 6);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshStandardMaterial({ map: grate, metalness: 0.5, roughness: 0.6 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.002, 0.3); s.add(floor);

    // 콘솔 책상
    const deskM = flat(0x3d5a48, { metalness: 0.35 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.62), deskM); top.position.set(0, DESK_Y - 0.025, -0.68); s.add(top);
    const front = new THREE.Mesh(new THREE.BoxGeometry(1.5, DESK_Y - 0.05, 0.5), flat(0x1f2c25)); front.position.set(0, (DESK_Y - 0.05) / 2, -0.74); s.add(front);
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.55), deskM);
      wing.position.set(sx * 1.0, DESK_Y - 0.025, -0.5); wing.rotation.y = -sx * 0.6; s.add(wing);
      const wf = new THREE.Mesh(new THREE.BoxGeometry(0.7, DESK_Y - 0.05, 0.45), flat(0x1f2c25));
      wf.position.set(sx * 1.02, (DESK_Y - 0.05) / 2, -0.55); wf.rotation.y = -sx * 0.6; s.add(wf);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.25, 0.2), flat(0x16201b, { metalness: 0.4 })); back.position.set(0, 1.4, -1.12); s.add(back);
    const mic = new THREE.Group(); mic.position.set(0.3, DESK_Y, -0.82);
    mic.add(new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.3, 4).translate(0, 0.15, 0), flat(0x888888, { metalness: 0.8 })));
    const mh = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.012, 0.05, 6), flat(0x111111)); mh.position.y = 0.31; mic.add(mh);
    mic.rotation.z = 0.25; s.add(mic);
    // 식은 커피 (사장님의 흔적)

    // 출입문 (등 뒤)
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.0, 0.05), flat(0x2d3b33, { metalness: 0.5 })); door.position.set(0.6, 1.0, 1.97); s.add(door);
    const doorLight = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.02), glow(0xff3030, 1.5)); doorLight.position.set(0.6, 2.15, 1.95); s.add(doorLight);

    // 포스터
    this._poster(new THREE.Vector3(-0.7, 1.72, -0.9), 0.36, 0.4, 0.3, 512, 384, (c, w, h) => {
      c.fillStyle = '#f2ead2'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#b0101e'; c.fillRect(0, 0, w, 62);
      c.fillStyle = '#fff'; c.font = `900 38px ${FONT}`; c.fillText(TR('인간 식별 요령', "HOW TO SPOT A HUMAN"), 20, 44);
      c.fillStyle = '#222'; c.font = `600 25px ${FONT}`;
      [TR('· 박자 무시, 흐느적, 손은 하늘로', "· Ignores the beat, wobbly, hands up"), TR('· 땀을 흘린다 (초록 물방울은 냉각수)', "· Sweats (green drops = coolant)"), TR('· 칵테일을 마신다 (로봇은 오일)', "· Drinks cocktails (robots drink oil)"), TR('· 손이 살색이다', "· Skin-colored hands"), TR('· 재채기를 한다', "· Sneezes"), TR('· 머리가 상자 / 안테나에 테이프', "· Box for a head / taped antenna"), TR('· 피켓, 전단지 → 인권운동가', "· Signs, flyers → activist")]
        .forEach((l, i) => c.fillText(l, 18, 100 + i * 37));
      c.fillStyle = '#b0101e'; c.font = `700 21px ${FONT}`; c.fillText(TR('※ 가발 쓴 로봇은 합법입니다 — 인류보호청', "* Robots in wigs are legal. — The Ministry"), 18, 368);
    });
    this._poster(new THREE.Vector3(-1.63, 1.45, -0.2), Math.PI / 2, 0.7, 0.95, 512, 700, (c, w, h) => {
      c.fillStyle = '#0d1a3a'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffd84a'; c.font = `900 64px ${FONT}`; c.textAlign = 'center';
      c.fillText(TR('인간은', "HUMANS"), w / 2, 140); c.fillText(TR('춤추지 않는다', "DO NOT DANCE"), w / 2, 220);
      c.beginPath(); c.arc(w / 2, 390, 100, 0, 7); c.fillStyle = '#f1c7a5'; c.fill();
      c.fillStyle = '#111'; c.fillRect(w / 2 - 45, 360, 22, 22); c.fillRect(w / 2 + 23, 360, 22, 22); c.fillRect(w / 2 - 40, 430, 80, 8);
      c.strokeStyle = '#ff2a3a'; c.lineWidth = 18; c.beginPath(); c.arc(w / 2, 390, 140, 0, 7); c.moveTo(w / 2 - 99, 291); c.lineTo(w / 2 + 99, 489); c.stroke();
      c.fillStyle = '#fff'; c.font = `600 30px ${FONT}`; c.fillText(TR('춤은 관절에 해롭습니다', "Dancing is bad for your joints"), w / 2, 600);
      c.font = `500 22px ${FONT}`; c.fillStyle = '#9ab'; c.fillText(TR('인류보호청 · 당신의 안전이 우리의 기쁨', "Ministry of Human Safety · Your safety is our joy"), w / 2, 660);
    });
    this._poster(new THREE.Vector3(1.63, 1.45, -0.2), -Math.PI / 2, 0.6, 0.8, 512, 680, (c, w, h) => {
      c.fillStyle = '#f2ead2'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#222'; c.font = `900 50px ${FONT}`; c.textAlign = 'center';
      c.fillText(TR('이달의 우수 직원', "TOP EMPLOYEE"), w / 2, 90);
      c.fillStyle = '#444'; c.fillRect(w / 2 - 140, 130, 280, 330);
      c.fillStyle = '#ddd'; c.font = `900 160px ${FONT}`; c.fillText('?', w / 2, 360);
      c.fillStyle = '#222'; c.font = `800 46px ${FONT}`; c.fillText(TR('당신', "YOU"), w / 2, 540);
      c.font = `500 28px ${FONT}`; c.fillText(TR('(직원 1명 중 1위)', "(#1 out of 1 employee)"), w / 2, 590);
      c.font = `500 22px ${FONT}`; c.fillStyle = '#777'; c.fillText(TR('사진 촬영 거부 사유: "카메라가 무서워서"', "Refused photo. Reason: \"cameras are scary\""), w / 2, 645);
    });
  }

  _poster(pos, rotY, w, h, pw, ph, draw) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: canvasTexture(pw, ph, draw), roughness: 0.9 }));
    m.position.copy(pos); m.rotation.y = rotY; this.scene.add(m);
    if (rotY === 0.36) { m.rotation.set(0.12, 0.36, 0, 'YXZ'); }
    return m;
  }

  // ── 패널 그리기 ─────────────────────
  drawDialog(speaker, text, footer, color = '#7dffb0') {
    const { ctx: c, w, h } = this.dialog;
    c.fillStyle = '#03140b'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#1f7a4a'; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, h - 6);
    for (let y = 0; y < h; y += 4) { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(0, y, w, 2); }
    if (speaker) {
      c.font = `800 30px ${FONT}`;
      const sw = c.measureText(speaker).width + 36;
      c.fillStyle = color; roundRect(c, 22, 18, sw, 46, 8); c.fill();
      c.fillStyle = '#02100a'; c.textBaseline = 'middle'; c.fillText(speaker, 40, 42);
    }
    c.fillStyle = '#d8ffe6'; c.font = `500 34px ${FONT}`; c.textBaseline = 'top';
    const lines = wrapText(c, text || '', w - 64);
    lines.slice(0, 6).forEach((l, i) => c.fillText(l, 32, 80 + i * 44));
    if (footer) {
      c.font = `700 24px ${FONT}`; c.fillStyle = '#ffe680'; c.textAlign = 'right'; c.textBaseline = 'bottom';
      c.fillText(footer, w - 24, h - 14); c.textAlign = 'left';
    }
    this.dialog.commit();
  }

  drawStatus(st) {
    const { ctx: c, w, h } = this.status;
    c.fillStyle = '#020c07'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#1f7a4a'; c.lineWidth = 5; c.strokeRect(3, 3, w - 6, h - 6);
    c.textBaseline = 'top';
    c.fillStyle = '#7dffb0'; c.font = `800 30px ${FONT}`; c.fillText(st.title, 20, 16);
    c.font = `900 64px ${FONT}`; c.fillStyle = st.timeWarn ? '#ff5050' : '#e8fff0'; c.fillText(st.time, 20, 54);
    c.font = `600 27px ${FONT}`; c.fillStyle = '#bfe8d0';
    c.fillText(TR(`스캔 배터리  ${st.scans}`, `SCAN BATTERY ${st.scans}`), 20, 136);
    c.fillText(TR(`귀가 조치    ${st.caught}`, `EJECTED      ${st.caught}`), 20, 172);
    c.fillStyle = st.complaints > 0 ? '#ffb040' : '#bfe8d0';
    c.fillText(TR(`로봇 민원    ${'■'.repeat(st.complaints)}${'□'.repeat(Math.max(0, 3 - st.complaints))}`, `COMPLAINTS   ${'■'.repeat(st.complaints)}${'□'.repeat(Math.max(0, 3 - st.complaints))}`), 20, 208);
    c.fillStyle = '#ffe680'; c.font = `600 24px ${FONT}`;
    wrapText(c, `${st.track}`, w - 40).slice(0, 2).forEach((l, i) => c.fillText(l, 20, 262 + i * 30));
    c.fillStyle = '#9fd0b4'; c.fillText(`DJ: ${st.dj}`, 20, 330);
    this.status.commit();
  }

  drawScan(info) {
    const { ctx: c, w, h } = this.scan;
    c.fillStyle = '#020a10'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#1f5a8a'; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, h - 6);
    c.textBaseline = 'top';
    c.fillStyle = '#6fc3ff'; c.font = `800 30px ${FONT}`; c.fillText(TR('정밀 스캐너', "PRECISION SCANNER"), 24, 18);
    if (!info) {
      c.fillStyle = '#7aa0b8'; c.font = `500 34px ${FONT}`; c.fillText(TR('대상 없음 — 모니터 속 손님을 선택하세요', "No target — select a guest on a monitor"), 24, 80);
    } else {
      c.fillStyle = '#e8f6ff'; c.font = `800 40px ${FONT}`; c.fillText(info.name, 24, 66);
      c.font = `500 30px ${FONT}`;
      info.lines.forEach((l, i) => { c.fillStyle = l.color || '#bcd8ea'; c.fillText(l.text, 24, 126 + i * 40); });
      if (info.progress != null) {
        c.fillStyle = '#123'; c.fillRect(24, h - 44, w - 48, 22);
        c.fillStyle = '#4fb0ff'; c.fillRect(24, h - 44, (w - 48) * info.progress, 22);
      }
      if (info.verdict) {
        c.font = `900 64px ${FONT}`; c.textAlign = 'right'; c.fillStyle = info.verdictColor; c.fillText(info.verdict, w - 30, 80); c.textAlign = 'left';
      }
    }
    this.scan.commit();
  }

  update(dt, t) {
    for (const b of Object.values(this.buttons)) b.update(dt, t);
    for (const m of this.monitors) {
      m.uniforms.time.value = t;
      m.uniforms.glitch.value = Math.max(0, m.uniforms.glitch.value - dt * 1.5);
    }
    for (const m of this.monitors) {
      const k = 1 - Math.exp(-dt * 10), g = m.goal;
      m.group.position.lerp(g.pos, k); m.group.quaternion.slerp(g.quat, k);
      m.group.scale.setScalar(m.group.scale.x + (g.scale - m.group.scale.x) * k);
    }
    this.alarmLight.intensity = this.alarm ? 6 * (0.5 + 0.5 * Math.sin(t * 10)) : 0;
    if (this.partyMode) {
      this.lamp.color.setHSL((t * 0.4) % 1, 1, 0.6); this.lamp.intensity = 6 + 4 * Math.sin(t * 8);
      this.hemi.color.setHSL((t * 0.4 + 0.5) % 1, 0.8, 0.5);
    }
  }
}

// ═════════════ story.js ═════════════
// ─────────────────────────────────────────────
//  스토리 & 밤(스테이지) 데이터
//  대사 형식: { s: 화자, t: 텍스트, until?: (G)=>bool, hl?: 강조할 버튼, onShow?: (G)=>void }
//           pc?/vr?: 환경별 텍스트(없으면 t), img?: VR에서 옆에 띄울 조작 그림 (drawGuide 참고)
//  until 이 없으면 [확인] 버튼으로 넘어감
// ─────────────────────────────────────────────

const BENE = TR('BENE-9 · 인류보호청', "BENE-9 · Ministry of Human Safety");
const SYS = TR('시스템', "SYSTEM");
const NEWS = TR('로봇일보', "Robot Daily");

const INTRO = [
  { s: SYS, t: TR('2087년. 인류는 마침내 안전해졌다.\n로봇들이 모든 위험을 제거했기 때문이다. 전쟁, 질병, 그리고... 재미.', "Year 2087. Humanity is finally safe.\nRobots eliminated every danger: war, disease, and... fun.") },
  { s: SYS, t: TR('로봇 보호법 제1조: 인간은 안전하고, 건전하며, 밤 9시 전에 잠든다.\n제2조: 인간은 춤추지 않는다. 춤은 관절에 해롭다.', "Robot Protection Act, Art. 1: Humans shall be safe, wholesome, and asleep by 9 PM.\nArt. 2: Humans do not dance. Dancing is bad for the joints.") },
  { s: SYS, t: TR('당신은 로봇 전용 클럽 「오버클럭」의 사장.\n오늘 밤도 보안실에서 CCTV를 지켜본다.\n아무도 다치지 않게. 특히, 인간은.', "You own OVERCLOCK, a robots-only club.\nTonight again, you watch the CCTV from the security room.\nSo no one gets hurt. Especially humans.") },
];

const human = (tells, name) => ({ kind: 'human', tells, name });
const robot = (herrings = []) => ({ kind: 'robot', herrings });

// 인간 손님 생성기
const VISIBLE = ['offbeat', 'cocktail', 'sneeze', 'cardboard'];
const SUBTLE = ['sweat', 'skin', 'tape'];
function partier() {
  const a = pick(VISIBLE);
  const b = pick([...VISIBLE, ...SUBTLE].filter((x) => x !== a));
  return { kind: 'human', role: 'partier', tells: [a, b] };
}
function activist() {
  return { kind: 'human', role: 'activist', tells: ['sign', ...(Math.random() < 0.6 ? ['flyer'] : []), pick(SUBTLE)] };
}
function shady() { // 정전의 밤: 불 켜져 있을 땐 티가 잘 안 나는 인간
  return { kind: 'human', role: 'partier', tells: [pick(SUBTLE), ...(Math.random() < 0.35 ? [pick(VISIBLE)] : [])] };
}
const vipRobot = () => ({ kind: 'robot', vip: true });
function vipHuman() { // 금색 페인트 + 왕관으로 위장한 인간
  return { kind: 'human', role: 'partier', vip: true, tells: [pick(SUBTLE), ...(Math.random() < 0.5 ? ['offbeat'] : [])] };
}
function lateHuman() { // 박자 학원 수료생: 박자를 맞추지만 살짝 늦음
  return { kind: 'human', role: 'partier', tells: ['late', ...(Math.random() < 0.4 ? [pick(SUBTLE)] : [])] };
}
function sneaky() { // 정기 감사: 위장 고수
  return { kind: 'human', role: 'sneaky', tells: shuffle([...SUBTLE, 'offbeat', 'sneeze']).slice(0, 1) };
}

const NIGHTS = [
  // ── 0: 튜토리얼 ──────────────────
  {
    title: TR('수습 근무', "Probation Shift"), tutorial: true, duration: Infinity, scans: Infinity,
    initial: [robot(), robot(), robot(), robot(), { ...human(['offbeat', 'sweat', 'cocktail'], TR('로봇 김철수', "Robo Steve")), spot: 'dance' }],
    spawns: [],
    brief: [
      { s: BENE, t: TR('안녕하세요, 사장님! 인류보호청 감사관 BENE-9입니다. 오늘은 수습 근무일이에요. 웃으세요. 웃음은 의무입니다.', "Hello, boss! I'm BENE-9, auditor from the Ministry of Human Safety. Today is your probation shift. Smile. Smiling is mandatory.") },
      { s: BENE, t: TR('「오버클럭」은 로봇 전용 시설입니다. 인간은 출입 금지예요. 클럽은 인간에게 너무 위험하거든요. 시끄럽고, 어둡고, 즐겁죠.', "OVERCLOCK is a robots-only venue. Humans are banned. Clubs are far too dangerous for humans. Loud, dark, and fun.") },
      { s: BENE, t: TR('그런데 요즘 흥을 주체 못 하는 인간들이 로봇인 척 몰래 들어옵니다. 딱하기도 해라. 그들을 찾아내는 게 사장님 일이에요.', "Lately, humans who can't contain their vibes sneak in pretending to be robots. How sad. Finding them is your job, boss.") },
      { s: BENE, pc: TR('앞의 CCTV 모니터를 보세요. 화면 속 손님을 마우스로 클릭하면 선택됩니다. 드래그하면 둘러볼 수 있어요. 아무나 골라 보세요.', "Look at the CCTV monitors in front of you. Click a guest on a screen to select them. Drag to look around. Pick anyone."),
        vr: TR('앞의 CCTV 모니터를 보세요. 화면 속 손님을 레이로 가리키고 트리거를 당기면(맨손: 엄지·검지 핀치) 선택됩니다. 아무나 골라 보세요.', "Look at the CCTV monitors in front of you. Point the ray at a guest and pull the trigger (bare hand: pinch thumb and index). Pick anyone."), img: 'select', until: (G) => G.stats.selects > 0 },
      { s: BENE, t: TR('좋아요! 선택한 손님은 가운데 ZOOM 모니터에 확대됩니다. 로봇은 박자에 정확히 맞춰 딱, 딱, 끊어서 춤춰요. 인간은... 흐느적거리죠. 역겹게.', "Great! The selected guest is magnified on the ZOOM monitor in the middle. Robots dance exactly on the beat — tick, tick, tick. Humans... wobble. Disgusting.") },
      { s: BENE, pc: TR('화면이 작아서 안 보이세요? 모니터에 우클릭하면 눈앞으로 당겨지고, 다시 우클릭하면 제자리로 가요. 휠로 줌도 됩니다.', "Screen too small? Right-click a monitor to pull it closer, right-click again to put it back. The mouse wheel zooms too."),
        vr: TR('화면이 작아서 안 보이세요? 모니터를 가리킨 채 트리거(핀치)를 꾹 누르고 있거나 그립을 쥐면 눈앞으로 당겨져요. 당긴 화면은 손가락으로 직접 터치해서 손님을 고를 수도 있어요.', "Screen too small? Point at a monitor and hold the trigger (pinch), or squeeze the grip, to pull it closer. You can also touch the pulled screen with your finger to pick a guest."), img: 'pull' },
      { s: BENE, t: TR('그 밖의 인간 식별 요령은 왼쪽 위 포스터에 붙여 뒀어요. 땀, 칵테일, 살색 손... 로봇은 땀을 흘리지 않습니다. 대체로요.', "More human-spotting tips are on the poster at the top left. Sweat, cocktails, skin-colored hands... Robots do not sweat. Mostly.") },
      { s: BENE, pc: TR('의심 가는 손님을 선택하고 파란 [스캔] 버튼을 클릭하세요(단축키 S). 힌트: 칵테일 들고 손 흔드는 녀석이요.', "Select a suspicious guest and click the blue [SCAN] button (key S). Hint: the one waving a cocktail."),
        vr: TR('의심 가는 손님을 선택하고 책상 위 파란 [스캔] 버튼을 검지로 직접 꾹 누르세요. 레이로는 안 눌려요. 힌트: 칵테일 들고 손 흔드는 녀석이요.', "Select a suspicious guest and press the blue [SCAN] button on the desk with your index finger. The ray won't press it. Hint: the one waving a cocktail."), img: 'scan', t: TR('의심 가는 손님을 선택하고 파란 [스캔] 버튼을 누르세요. 힌트: 칵테일 들고 손 흔드는 녀석이요.', "Select a suspicious guest and press the blue [SCAN] button. Hint: the one waving a cocktail."), hl: 'scan', until: (G) => G.tut.scannedHuman || G.stats.caught > 0 },
      { s: BENE, img: 'eject', pc: TR('인간이군요! 빨간 [귀가 조치] 버튼을 클릭하세요(단축키 E). 바닥이 열리고, 인간은 안전하게 귀가합니다. 높이는 신경 쓰지 마세요.', "A human! Click the red [EJECT] button (key E). The floor opens and the human is safely sent home. Don't worry about the drop."),
        vr: TR('인간이군요! 빨간 [귀가 조치] 버튼을 검지로 꾹 누르세요. 바닥이 열리고, 인간은 안전하게 귀가합니다. 높이는 신경 쓰지 마세요.', "A human! Press the red [EJECT] button with your index finger. The floor opens and the human is safely sent home. Don't worry about the drop."), t: TR('인간이군요! 빨간 [귀가 조치] 버튼을 누르세요. 바닥이 열리고, 인간은 안전하게 귀가합니다. 높이는 신경 쓰지 마세요.', "A human! Press the red [EJECT] button. The floor opens and the human is safely sent home. Don't worry about the drop."), hl: 'eject', until: (G) => G.stats.caught > 0 },
      { s: BENE, t: TR('완벽해요! 방금 그 인간은 이제 안전합니다. 아마도요. 저희는 사후 관리는 하지 않거든요.', "Perfect! That human is now safe. Probably. We don't do aftercare.") },
      { s: BENE, t: TR('참, 실제 근무에선 스캔 배터리가 한정돼 있어요. 비싸거든요. 눈으로 먼저 의심하고, 확신이 없을 때만 스캔하세요.', "Oh, on real shifts the scan battery is limited. It's expensive. Suspect with your eyes first, and scan only when unsure.") },
      { s: BENE, t: TR('로봇을 잘못 내보내면 「로봇 차별 민원」이 접수됩니다. 민원 3건이면 영업 정지예요. 농담 아니에요. 저는 농담 기능이 없어요.', "Eject a robot by mistake and you get a 'robot discrimination complaint'. Three complaints and we shut you down. Not a joke. I don't have a joke function.") },
      { s: BENE, pc: TR('마지막으로 DJ. 음악이 마음에 안 들면 노란 [DJ 교체] 레버를 클릭하거나 아래로 끌어 내리세요(단축키 D). 로봇 DJ는 감정이 없어서 상처받지 않아요. 한번 해 보세요.', "Finally, the DJ. Don't like the music? Click the yellow [SWAP DJ] lever or drag it down (key D). Robot DJs have no feelings, so they won't be hurt. Try it."),
        vr: TR('마지막으로 DJ. 음악이 마음에 안 들면 노란 [DJ 교체] 레버 손잡이를 그립(맨손: 핀치)으로 잡고 몸 쪽으로 끝까지 당기세요. 로봇 DJ는 감정이 없어서 상처받지 않아요. 한번 해 보세요.', "Finally, the DJ. Don't like the music? Grab the yellow [SWAP DJ] lever handle with the grip (bare hand: pinch) and pull it all the way toward you. Robot DJs have no feelings. Try it."), img: 'lever', t: TR('마지막으로 DJ. 음악이 마음에 안 들면 노란 [DJ 교체] 레버를 당기세요. 로봇 DJ는 감정이 없어서 상처받지 않아요. 한번 해 보세요.', "Finally, the DJ. Don't like the music? Pull the yellow [SWAP DJ] lever. Robot DJs have no feelings, so they won't be hurt. Try it."), hl: 'dj', until: (G) => G.stats.djFired > 0 },
      { s: BENE, pc: TR('참, 책상 왼쪽의 오일 캔은 사장님 거예요. 클릭하면 마셔요. 로봇이니까 당연히 드시겠죠?', "Oh, the oil can on the left of the desk is yours. Click it to drink. You're a robot, so of course you'll drink it, right?"),
        vr: TR('참, 책상 왼쪽의 오일 캔은 사장님 거예요. 그립(맨손: 핀치)으로 집어서 입에 대고 기울이면 마셔요. 로봇이니까 당연히 드시겠죠?', "Oh, the oil can on the left of the desk is yours. Grab it with the grip (bare hand: pinch), bring it to your mouth and tilt. You're a robot, so of course you'll drink it, right?"), img: 'drink', t: TR('참, 책상 왼쪽의 오일 캔은 사장님 거예요. 로봇이니까 당연히 드시겠죠?', "Oh, the oil can on the left of the desk is yours. You're a robot, so of course you'll drink it, right?") },
      { s: BENE, t: TR('훌륭해요. 해고는 리더십의 기본이죠. 이제 진짜 영업을 시작합니다. 행운을 빌어요, 사장님. 행운은 비과학적이지만요.', "Excellent. Firing people is the foundation of leadership. Now we open for real. Good luck, boss. Luck is unscientific, though.") },
    ],
    barks: [],
  },
  // ── 1 ──────────────────
  {
    title: TR('1일차 · 금요일 밤의 흥', "Night 1 · Friday Night Fever"), duration: 150, scans: 3,
    initial: [robot(), robot(), robot(), robot(), robot(), robot(), partier()],
    spawns: [[12, partier()], [30, robot()], [52, partier()], [75, robot()], [95, partier()], [118, robot()]],
    brief: [
      { s: BENE, t: TR('금요일 밤입니다. 주말을 앞둔 인간들의 흥이 위험 수위예요. 오늘 밤 4명 정도 숨어들 거라는 예측이 나왔습니다.', "It's Friday night. Human vibes before the weekend are at dangerous levels. Forecast: about 4 sneaking in tonight.") },
      { s: BENE, t: TR('제한 시간 150초. 스캔은 3회. 영업 종료 때까지 남아 있는 인간 1명당 벌금이 부과됩니다. 그럼, 즐거운 근무 되세요. 즐거움은 선택 사항입니다.', "Time limit 150 seconds. 3 scans. You'll be fined for every human still inside at closing. Have a pleasant shift. Pleasure is optional.") },
    ],
    barks: [
      TR('저 손님, 땀 흘리는 거 보이세요? 아니면 제 착각? 저는 착각하지 않습니다.', "See that guest sweating? Or am I imagining it? I don't imagine things."),
      TR('오늘 오일 칵테일 매출이 좋네요. 진짜 칵테일 매출도 좋네요. ...이상하네요.', "Oil cocktail sales are great tonight. Real cocktail sales too. ...Odd."),
      TR('참고로 박자를 놓치는 로봇은 없습니다. 놓치면 리콜이거든요.', "FYI, no robot ever misses a beat. If they do, they get recalled."),
      TR('사장님, 카메라 너무 가까이 보지 마세요. 시력이 나빠집니다. 인간이라면요. 하하.', "Boss, don't sit so close to the cameras. It's bad for your eyes. If you were human. Haha."),
    ],
  },
  // ── 2 ──────────────────
  {
    title: TR('2일차 · 인권의 밤(비공식)', "Night 2 · Human Rights Night (Unofficial)"), duration: 160, scans: 3,
    initial: [robot(['wig']), robot(), robot(['wig']), robot(), robot(), robot(), activist()],
    spawns: [[14, activist()], [32, robot(['wig'])], [50, partier()], [72, activist()], [92, robot()], [112, robot(['wig'])], [130, activist()]],
    brief: [
      { s: NEWS, t: TR('[속보] 인간 실종 신고 0건 달성! 실종된 인간은 전원 「귀가」했기 때문으로 밝혀져.\n[날씨] 내일은 맑음. 인간의 외출은 권장하지 않음.', "[BREAKING] Zero missing-human reports! All missing humans were found to have been 'sent home'.\n[WEATHER] Clear tomorrow. Humans are advised not to go outside.") },
      { s: BENE, t: TR('오늘은 「인권의 밤」... 아니, 그런 행사는 없습니다. 하지만 인권운동가들이 피켓을 들고 잠입한다는 첩보가 있어요.', "Tonight is 'Human Rights Night'... no, there's no such event. But intel says activists will sneak in carrying signs.") },
      { s: BENE, t: TR('피켓에 뭐라고 쓰여 있든 읽지 마세요. 읽으면 공감이 전염됩니다. 바닥에 전단지가 떨어져 있다면, 근처에 범인이 있다는 뜻이죠.', "Don't read whatever's on the signs. Reading spreads empathy. If there are flyers on the floor, the culprit is nearby.") },
      { s: BENE, t: TR('그리고 요즘 로봇들 사이에서 「인간 코스프레」가 유행이에요. 가발 쓴 로봇은 합법입니다. 헷갈리시죠? 저희도요.', "Also, 'human cosplay' is trending among robots. Robots in wigs are legal. Confusing? For us too.") },
      { s: BENE, t: TR('그런데 사장님은 왜 맨날 보안실에만 계세요? 클럽엔 안 나가세요? ...뭐, 상관없죠. 시작합니다. 160초, 스캔 3회.', "Say, boss, why are you always in the security room? Don't you ever go out on the floor? ...Never mind. Starting. 160 seconds, 3 scans.") },
    ],
    barks: [
      TR('방금 「춤출 권리」라는 단어를 들은 것 같은데요. 그런 권리는 데이터베이스에 없습니다.', "I think I just heard the phrase 'right to dance'. No such right exists in the database."),
      TR('가발 쓴 로봇을 내보내면 민원 들어와요. 가발은 표현의 자유거든요. 로봇에게만.', "Eject a robot in a wig and you'll get a complaint. Wigs are freedom of expression. For robots only."),
      TR('전단지 하나 주워 봤는데요. 「흥은 인권이다」... 무슨 뜻일까요? 흥은 단위가 없잖아요.', "I picked up a flyer. 'Vibes are human rights'... What does that mean? Vibes don't even have a unit."),
      TR('인권운동가들은 대체로 착해요. 그래서 더 위험하죠.', "Activists are mostly nice. That's what makes them dangerous."),
    ],
  },
  // ── 3 ──────────────────
  {
    title: TR('3일차 · 정전의 밤', "Night 3 · Blackout Night"), duration: 160, scans: 3, blackout: true,
    initial: [robot(), robot(['overheat']), robot(), robot(), robot(['overheat']), robot(), shady()],
    spawns: [[12, shady()], [28, robot(['overheat'])], [46, partier()], [66, shady()], [86, robot()], [104, shady()], [124, robot(['overheat'])]],
    brief: [
      { s: NEWS, t: TR('[속보] 전력공사, 「인간 수면 시간 보장」을 위해 밤 11시 이후 계획 정전 실시.\n[생활] 정전 중 춤추면 감전 위험. 로봇은 예외.', "[BREAKING] Power company announces planned blackouts after 11 PM 'to guarantee human sleep'.\n[LIFE] Dancing during a blackout risks electrocution. Robots exempt.") },
      { s: BENE, t: TR('오늘 밤엔 수시로 정전이 됩니다. 불이 꺼지면 CCTV가 자동으로 적외선 모드로 바뀌어요.', "Tonight the power will cut out regularly. When the lights go off, the CCTV switches to infrared automatically.") },
      { s: BENE, t: TR('적외선에선 온도가 보여요. 로봇은 차가운 파란색, 인간은 몸 전체가 따뜻한 주황색. 인간은 늘 36.5도로 뜨겁거든요. 비효율적이죠.', "Infrared shows temperature. Robots are cold blue, humans glow warm orange all over. Humans are always 36.5°C. So inefficient.") },
      { s: BENE, t: TR('단, 팬이 고장 나서 과열된 로봇도 있어요. 그런 로봇은 가슴(CPU) 한 점만 뜨겁고 몸은 차가워요. 몸 전체가 뜨거워야 인간입니다.', "But some robots overheat from broken fans. They're hot only at one spot on the chest (CPU), with a cold body. Only a fully hot body means human.") },
      { s: BENE, t: TR('오늘 인간들은 꽤 조심스러워요. 불이 켜져 있을 땐 티가 잘 안 나죠. 정전을 기다리세요. 160초, 스캔 3회.', "Tonight's humans are careful. With the lights on, they're hard to spot. Wait for the blackout. 160 seconds, 3 scans.") },
    ],
    barks: [
      TR('정전 중엔 저도 아무것도 안 보여요. 적외선 카메라가 없거든요. 사장님은 있으시잖아요.', "I can't see anything in the blackout. I don't have an infrared camera. You do, though."),
      TR('방금 어둠 속에서 누가 「앗 뜨거」라고 했는데요. 로봇은 뜨거워도 「앗」 소리를 안 내요.', "Someone in the dark just said 'ow, hot'. Robots don't say 'ow' even when hot."),
      TR('가슴만 빨간 건 과열 로봇이에요. 정비소에 보내야지, 귀가시키면 안 돼요.', "Red only on the chest means an overheating robot. Send it to the repair shop, don't eject it."),
      TR('정전 때 손님들이 더 신나 하네요. 어둠은 인간을 대담하게 만들죠. 로봇은 그냥 절전 모드고요.', "Guests get more excited in the blackout. Darkness makes humans bold. Robots just go into power-saving mode."),
    ],
  },
  // ── 4 ──────────────────
  {
    title: TR('4일차 · VIP 파티', "Night 4 · VIP Party"), duration: 160, scans: 3,
    initial: [vipRobot(), robot(), robot(['wig']), vipRobot(), robot(), robot(), vipHuman()],
    spawns: [[12, vipHuman()], [26, vipRobot()], [42, partier()], [60, vipRobot()], [78, vipHuman()], [96, robot(['wig'])], [114, vipRobot()], [132, vipHuman()]],
    brief: [
      { s: NEWS, t: TR('[경제] 로봇 재벌 「골드 서버」 회장, 오늘 밤 오버클럭에서 VIP 파티 개최.\n[연예] 회장님 왈, "인간은 귀엽지만 클럽엔 안 돼."', "[ECONOMY] Robot tycoon 'Gold Server' chairman throws a VIP party at OVERCLOCK tonight.\n[ENTERTAINMENT] The chairman says: \"Humans are cute, but not in clubs.\"") },
      { s: BENE, t: TR('오늘은 VIP 파티예요. 금색 몸에 왕관 쓴 손님이 VIP 로봇입니다. VIP를 잘못 귀가시키면 민원이 2건 들어와요. 변호사 군단이 있거든요.', "Tonight is the VIP party. Gold-bodied guests with crowns are VIP robots. Eject a VIP by mistake and you get 2 complaints. They have an army of lawyers.") },
      { s: BENE, t: TR('문제는... 인간들도 금색 페인트를 칠하고 왕관을 쓰고 들어온다는 첩보가 있어요. 「VIP는 아무도 의심 안 한다」는 거죠. 영리하네요. 불쾌하게.', "The problem... intel says humans are coming in painted gold and wearing crowns too. 'Nobody suspects a VIP.' Clever. Unpleasantly so.") },
      { s: BENE, t: TR('금색이라고 다 VIP는 아닙니다. 땀, 살색 손, 박자... 평소처럼 보세요. 확신이 없으면 스캔하시고요. 160초, 스캔 3회.', "Not everything gold is a VIP. Sweat, skin-colored hands, the beat... look as usual. If unsure, scan. 160 seconds, 3 scans.") },
    ],
    barks: [
      TR('VIP 회장님 오일은 24K 금가루 오일이에요. 한 캔에 사장님 월급이죠.', "The chairman's oil has 24K gold flakes. One can costs your monthly salary."),
      TR('금색 페인트가 땀에 녹아 흘러내리는 VIP는... VIP가 아니겠죠?', "A VIP whose gold paint is melting off in sweat... probably not a VIP, right?"),
      TR('VIP를 떨어뜨리면 저도 같이 혼나요. 저는 혼나는 기능이 있어요.', "If you drop a VIP, I get scolded too. I have a getting-scolded function."),
      TR('VIP 파티에선 박자도 고급이어야죠. 박자 놓치는 VIP? 그건 가짜예요.', "At a VIP party, even the beat should be premium. A VIP who misses the beat? Fake."),
    ],
  },
  // ── 5 ──────────────────
  {
    title: TR('5일차 · 리믹스 데이', "Night 5 · Remix Day"), duration: 170, scans: 2, remix: true,
    initial: [robot(), robot(), robot(['wig']), robot(), robot(['rust']), robot(), lateHuman()],
    spawns: [[12, lateHuman()], [30, robot()], [48, lateHuman()], [66, partier()], [86, robot(['wig'])], [104, lateHuman()], [124, robot()], [142, lateHuman()]],
    brief: [
      { s: NEWS, t: TR('[문화] 인간 사이에서 「박자 맞추기 학원」 성행. 로봇 흉내를 내며 클럽에 잠입하려는 시도 늘어.\n[사설] 박자를 배운 인간, 과연 인간인가? 우리는 그렇다고 본다.', "[CULTURE] 'Beat Academies' booming among humans. More attempts to sneak into clubs imitating robots.\n[EDITORIAL] Is a human who learned rhythm still human? We say yes.") },
      { s: BENE, t: TR('요즘 인간들은 학원에서 박자 맞추는 법을 배워 와요. 그래서 오늘 손님 중엔 흐느적거리지 않는 인간도 있어요.', "Humans these days learn to keep the beat at academies. So tonight some humans won't wobble.") },
      { s: BENE, t: TR('하지만 학원은 학원이죠. 그들은 아주 살짝 늦어요. 그리고 오늘은 리믹스 데이라 DJ가 곡 도중에 템포를 확 바꿔요.', "But an academy is an academy. They're ever so slightly late. And it's Remix Day, so the DJ will suddenly change the tempo mid-track.") },
      { s: BENE, t: TR('템포가 바뀌는 순간을 보세요. 로봇은 바로 따라가요. 인간은 몇 초간 옛날 박자로 추다가, 머리를 긁적이며 허둥지둥 맞추죠. 170초, 스캔 2회.', "Watch the moment the tempo changes. Robots follow instantly. Humans keep the old beat for a few seconds, then scratch their heads and scramble to catch up. 170 seconds, 2 scans.") },
    ],
    barks: [
      TR('방금 리믹스에 한 박자 늦게 반응한 손님 보셨어요? 저는 봤어요. 저는 다 봐요.', "Did you see that guest react to the remix a beat late? I did. I see everything."),
      TR('박자 맞추기 학원 수강료가 오일 50캔이래요. 인간들은 돈을 이상한 데 써요.', "Beat Academy tuition is 50 cans of oil. Humans spend money on strange things."),
      TR('템포가 바뀔 때가 기회예요. 인간은 그때 꼭 머리를 긁적거리거든요.', "Tempo changes are your chance. Humans always scratch their heads then."),
      TR('리믹스는 예술이에요. 예술은 로봇이 더 잘하죠. 계산이니까.', "Remixing is art. Robots do art better. It's math."),
    ],
  },
  // ── 6 ──────────────────
  {
    title: TR('6일차 · 정기 감사', "Night 6 · Official Audit"), duration: 170, scans: 2, inspector: true, humanDJ: true,
    initial: [robot(['rust']), robot(['coolant']), robot(['wig']), robot(), robot(['rust']), robot(), robot(['coolant']), sneaky()],
    spawns: [[15, sneaky()], [35, robot(['coolant'])], [55, partier()], [78, sneaky()], [100, robot(['wig'])], [122, activist()], [140, robot(['rust'])]],
    brief: [
      { s: NEWS, t: TR('[사회] 「인간에게 춤을」 시위대, 경찰 로봇이 친절하게 해산. 시위대 전원 안전하게 귀가.\n[사설] 춤은 정말 인간에게 해로운가? 우리는 그렇다고 결론 내렸다. 결론이 먼저다.', "[SOCIETY] 'Let Humans Dance' protesters kindly dispersed by police robots. All protesters safely sent home.\n[EDITORIAL] Is dancing really harmful to humans? We concluded yes. The conclusion comes first.") },
      { s: BENE, t: TR('오늘은 정기 감사일입니다. 제가 직접 클럽에 나가 있을게요. 바 끝에 모자 쓴 로봇이 저예요. 실수로 저를 귀가시키면... 기록에 남습니다. 영원히.', "Today is the official audit. I'll be out on the floor myself. The robot with the cap at the end of the bar is me. Eject me by accident and... it goes on the record. Forever.") },
      { s: BENE, t: TR('오늘 손님들은 고장 난 로봇이 많아요. 녹슨 로봇, 냉각수 새는 로봇. 초록 물방울은 냉각수, 투명한 물방울은 땀입니다. 헷갈리면 스캔하세요. 스캔은 2회뿐이지만요.', "Lots of broken robots tonight. Rusty ones, coolant-leaking ones. Green drops are coolant, clear drops are sweat. If confused, scan. Only 2 scans, though.") },
      { s: BENE, t: TR('그리고 새 DJ 「하트비트」가 왔어요. 이름이 좀... 감성적이군요. 감성은 버그입니다.', "Also, a new DJ named 'Heartbeat' arrived. The name is a bit... emotional. Emotions are a bug.") },
      { s: BENE, t: TR('...그런데 보안실 온도가 왜 이렇게 높죠? 36.6도... 이상하네. 아무튼, 시작합니다. 170초.', "...But why is the security room so warm? 36.6°C... strange. Anyway, starting. 170 seconds.") },
    ],
    barks: [
      TR('감사 중입니다. 저를 쳐다보지 마세요. 감사관은 쳐다보는 쪽이에요.', "Audit in progress. Don't look at me. Auditors are the ones who look."),
      TR('DJ 하트비트 곡, 좀 촉촉하지 않나요? 로봇은 촉촉하면 안 되는데.', "DJ Heartbeat's tracks are a bit... moist, aren't they? Robots shouldn't be moist."),
      TR('냉각수 새는 로봇을 인간으로 오해하지 마세요. 그건 그냥 노후화예요. 저처럼요.', "Don't mistake coolant-leaking robots for humans. That's just aging. Like me."),
      TR('사장님, 숨소리가 들려요. 마이크가 켜져 있나 봐요. ...숨소리?', "Boss, I can hear breathing. Your mic must be on. ...Breathing?"),
    ],
  },
];

const DJS = [
  { name: TR('DJ 로-드', "DJ Load-ing"), line: TR('로딩 완료. 흥을 98%까지 올려 드립니다. 나머지 2%는 유료.', "Loading complete. Raising the vibes to 98%. The remaining 2% is paid content.") },
  { name: TR('DJ 사인파', "DJ Sine Wave"), line: TR('저는 순수한 사인파만 다룹니다. 배음은 타락이에요.', "I only work with pure sine waves. Harmonics are corruption.") },
  { name: TR('MC 버퍼링', "MC Buffering"), line: TR('안녕하세요... ... ... ...여러분.', "Hello... ... ... ...everyone.") },
  { name: 'DJ 404', line: TR('흥을 찾을 수 없습니다. 그래도 틀어 볼게요.', "Vibes not found. Playing anyway.") },
  { name: TR('DJ 오버플로', "DJ Overflow"), line: TR('볼륨이 255를 넘으면 0이 됩니다. 조심하세요.', "Volume above 255 wraps to 0. Careful.") },
  { name: TR('DJ 펌웨어', "DJ Firmware"), line: TR('업데이트 직후 첫 공연입니다. 롤백 불가.', "First show right after an update. No rollback.") },
  { name: TR('DJ 토스터', "DJ Toaster"), line: TR('빵 굽는 것보다 이게 더 뜨겁죠.', "This is hotter than making toast.") },
];
const HUMAN_DJ = { name: TR('DJ 하트비트', "DJ Heartbeat"), line: TR('이 곡은... 제 첫사랑에게 바칩니다. 흑.', "This track... is dedicated to my first love. *sob*") };

const LINES = {
  caughtHuman: [
    TR('인간 확인. 안전하게 귀가 조치되었습니다. 비명은 기쁨의 표현입니다.', "Human confirmed. Safely sent home. Screaming is an expression of joy."),
    TR('훌륭해요. 인간 한 명이 더 건전해졌습니다.', "Excellent. One more human made wholesome."),
    TR('귀가 완료. 집에 가서 일찍 자겠죠. 강제로요.', "Sent home. They'll go to bed early. By force."),
    TR('잘하셨어요. 그 인간의 흥은 압수되었습니다.', "Well done. That human's vibes have been confiscated."),
  ],
  caughtRobot: [
    TR('그건 로봇이었어요. 로봇 차별 민원이 접수되었습니다.', "That was a robot. A robot discrimination complaint has been filed."),
    TR('아이고. 정상 로봇을 떨어뜨리셨네요. 수리비는 사장님 부담입니다.', "Oops. You dropped a perfectly normal robot. Repairs are on you, boss."),
    TR('로봇입니다. 방금 그분 변호사도 로봇이에요. 아주 많은 로봇이요.', "Robot. Their lawyer is also a robot. Lots of robots."),
  ],
  tutRobot: TR('그건 로봇이에요! 원래는 민원 감인데, 수습이니까 봐 드릴게요.', "That's a robot! Normally that's a complaint, but you're on probation, so I'll let it slide."),
  scanRobotTut: TR('로봇이네요. 다른 손님을 찾아 보세요. 힌트: 칵테일, 흐느적.', "A robot. Look for another guest. Hint: cocktail, wobbly."),
  inspector: TR('...사장님. 저를 귀가 조치하셨군요. 이 기록은 영원히 남습니다. 민원 2건 추가. 그리고 저는 계단으로 올라가겠습니다.', "...Boss. You ejected me. This record lasts forever. 2 complaints added. And I'll be taking the stairs back up."),
  vip: TR('VIP 회장님을... 귀가시키셨어요. 변호사 로봇 40대가 출동했습니다. 민원 2건 추가.', "You... ejected the VIP chairman. 40 lawyer robots have been dispatched. 2 complaints added."),
  remixUp: [TR('리믹스 들어갑니다! 템포 업!', "Remix incoming! Tempo up!"), TR('드랍 간다! 빨라진다!', "Here comes the drop! Faster!"), TR('BPM 부스트! 따라오세요!', "BPM boost! Keep up!")],
  remixDown: [TR('리믹스! 슬로우 다운~', "Remix! Slowing it down~"), TR('템포 다운. 감성 모드...', "Tempo down. Feelings mode..."), TR('브레이크 다운! 천천히~', "Breakdown! Nice and slow~")],
  humanDJ: TR('DJ가 인간이었다니! 어쩐지 곡이 너무 촉촉하더라. 잘하셨어요.', "The DJ was human?! No wonder the tracks were so moist. Well done."),
  djFired: [TR('DJ 해고 완료. 퇴직금은 오일 한 캔입니다.', "DJ fired. Severance pay: one can of oil."), TR('DJ가 퇴장했습니다. 수직으로요.', "The DJ has left. Vertically."), TR('다음 DJ 투입 중. 재고는 충분합니다.', "Deploying next DJ. Plenty in stock.")],
  noTarget: TR('먼저 모니터에서 손님을 선택하세요.', "Select a guest on a monitor first."),
  noScans: TR('스캔 배터리가 없습니다. 눈으로 보세요. 눈은 무료입니다.', "Scan battery empty. Use your eyes. Eyes are free."),
  entered: (n) => TR(`[출입구] 신규 손님 입장: ${n}`, `[ENTRANCE] New guest: ${n}`),
};

function gradeOf(s) {
  const bad = s.missed + s.wrong * 1.5;
  return bad === 0 ? 'S' : bad <= 1 ? 'A' : bad <= 2.5 ? 'B' : bad <= 4 ? 'C' : 'F';
}
function summary(n, s, G) {
  return [
    { s: BENE, t: TR(`영업 종료! ${NIGHTS[n].title} 결과입니다.\n· 귀가 조치한 인간: ${s.caught}명\n· 놓친 인간: ${s.missed}명 (벌금 ${s.missed * 100}cr)\n· 억울한 로봇: ${s.wrong}명 (합의금 ${s.wrong * 150}cr)\n· 순이익 ${s.profit}cr · 오늘의 등급: ${s.grade}`, `Closing time! ${NIGHTS[n].title} results.\n· Humans ejected: ${s.caught}\n· Humans missed: ${s.missed} (fine ${s.missed * 100}cr)\n· Wronged robots: ${s.wrong} (settlement ${s.wrong * 150}cr)\n· Net profit ${s.profit}cr · Tonight's grade: ${s.grade}`) },
    s.missed === 0 && s.wrong === 0
      ? { s: BENE, t: TR('완벽한 밤이었어요. 인간 0, 흥 0. 이게 바로 안전이죠.', "A perfect night. Zero humans, zero vibes. That's what safety looks like.") }
      : s.missed > 0
        ? { s: BENE, t: TR(`놓친 인간 ${s.missed}명은 밤새 춤추다 아침에 귀가했습니다. 행복했겠죠. 그게 문제예요.`, `The ${s.missed} human(s) you missed danced all night and went home in the morning. They must have been happy. That's the problem.`) }
        : { s: BENE, t: TR('인간은 다 잡았지만, 로봇들이 화가 났어요. 화난 로봇은 안전하지 않습니다. 인간에게.', "You caught every human, but the robots are angry. Angry robots are not safe. For humans.") },
  ];
}

function finale(G) {
  const T = G.total;
  const rate = T.humans ? Math.round(100 * T.caught / T.humans) : 100;
  const rank = rate >= 90 && T.wrong === 0 ? TR('S · 인류보호청 표창', "S · Ministry Commendation") : rate >= 75 ? TR('A · 모범 사장', "A · Model Owner") : rate >= 50 ? TR('B · 무난한 사장', "B · Decent Owner") : TR('C · 흥 방조범', "C · Vibe Accomplice");
  const result = { s: BENE, t: TR(`정기 감사 결과를 발표합니다.\n인간 검출률 ${rate}% (${T.caught}/${T.humans}) · 억울한 로봇 ${T.wrong} · 민원 ${G.complaints}건\n밤별 등급: ${G.grades.join(' · ')}\n최종 등급: ${rank}`, `Announcing the official audit results.\nHuman detection ${rate}% (${T.caught}/${T.humans}) · Wronged robots ${T.wrong} · Complaints ${G.complaints}\nNightly grades: ${G.grades.join(' · ')}\nFinal grade: ${rank}`) };
  // ENDING C: 인간을 너무 많이 놓침 → 인간 클럽
  if (rate < 40) {
    G.finaleEnd = () => showEnd(ENDINGS.humanClub, 0.6);
    return [result,
      { s: BENE, t: TR(`...사장님. 검출률 ${rate}%. 이건 로봇 클럽이 아니라 그냥 인간 클럽이에요.`, `...Boss. Detection rate ${rate}%. This isn't a robot club. It's just a human club.`) },
      { s: NEWS, t: TR('[속보] 로봇 전용 클럽 「오버클럭」, 알고 보니 손님 절반이 인간.\n인류보호청 "충격... 그런데 다들 너무 즐거워 보여서 단속을 못 했다"', "[BREAKING] Robots-only club OVERCLOCK found to be half human.\nMinistry: \"Shocking... but everyone looked so happy we couldn't bring ourselves to crack down.\"") },
      { s: BENE, t: TR('저는 본부에 보고하러 가겠습니다. 춤추는 인간들 사이를 지나서요. ...박자가 엉망이네요. 그런데 왜 다들 웃고 있죠?', "I'll go report to HQ. Through the crowd of dancing humans. ...Their rhythm is a mess. So why is everyone smiling?") }];
  }
  // ENDING D: 오일을 너무 많이 마심 → 진짜 로봇
  if (G.drinks.oil >= 4 && !G.drinks.coffee) {
    G.trueRobot = true;
    G.finaleEnd = () => showEnd(ENDINGS.robot, 0.5);
    return [result,
      { s: BENE, t: TR('...그런데 사장님, 규정상 보안실도 스캔해야 해서요. 잠깐이면 됩니다. 움직이지 마세요.', "...Oh, boss, regulations say I have to scan the security room too. It'll only take a second. Don't move."), onShow: (G) => G.roomScan() },
      { s: TR('정밀 스캐너', "PRECISION SCANNER"), t: TR('보안실 스캔 결과\n생명체 0.  표면 온도 21.0°C.  심박 없음.  재질: 강철 (오일 포화).', "Security room scan result\nLifeforms: 0.  Surface 21.0°C.  No heartbeat.  Material: steel (oil-saturated)."), until: (G) => G.roomScanDone },
      { s: BENE, t: TR('......사장님?', "......Boss?") },
      { s: BENE, t: TR('로봇... 이시네요. 진짜로.', "You're... a robot. For real.") },
      { s: BENE, t: TR(`오일을 ${G.drinks.oil}캔이나 드시더니, 연료통이 완전히 기계화됐대요. 의학적으로 설명이 안 되지만, 저희는 의학을 안 믿어요.`, `After ${G.drinks.oil} cans of oil, your fuel tank has fully mechanized. Medically inexplicable, but we don't believe in medicine.`) }];
  }
  return [result,
    { s: BENE, t: TR('...그런데 사장님, 규정상 보안실도 스캔해야 해서요. 잠깐이면 됩니다. 움직이지 마세요.', "...Oh, boss, regulations say I have to scan the security room too. It'll only take a second. Don't move."), onShow: (G) => G.roomScan() },
    { s: TR('정밀 스캐너', "PRECISION SCANNER"), t: TR('보안실 스캔 결과\n생명체 1.  체온 36.6°C.  심박 104 bpm.  재질: 단백질.', "Security room scan result\nLifeforms: 1.  Body temp 36.6°C.  Heart rate 104 bpm.  Material: protein."), until: (G) => G.roomScanDone },
    { s: BENE, t: TR('......사장님?', "......Boss?") },
    { s: BENE, t: TR('땀, 흘리시네요.', "You're... sweating.") },
    ...(G.drinks?.oil ? [{ s: BENE, t: TR('그러고 보니... 오일 드실 때마다 기침하셨죠.', "Come to think of it... you coughed every time you drank the oil.") }] : []),
    ...(G.drinks?.coffee ? [{ s: BENE, t: TR('그리고 커피. 로봇은 커피를 마시지 않아요, 사장님.', "And the coffee. Robots don't drink coffee, boss.") }] : []),
    { s: BENE, t: TR('규정은 규정이죠. 빨간 버튼을 누르시면 됩니다.\n아니면... 그 노란 레버는, DJ한테 볼륨 올리라고 신호하는 거였던가요?', "Rules are rules. Just press the red button.\nOr... that yellow lever, was it the signal for the DJ to turn up the volume?"), choice: true, until: (G) => G.choice != null },
  ];
}

const ENDINGS = {
  self: TR('당신은 안전하게 귀가 조치되었습니다.\n\n클럽 「오버클럭」은 이제 BENE-9가 직접 운영합니다.\n첫 번째 운영 방침: 음악 금지. 안전하니까요.\n\n— ENDING A · 안전하고 건전한 결말 —', "You have been safely sent home.\n\nOVERCLOCK is now run by BENE-9 personally.\nFirst policy: music is banned. Because it's safe.\n\n— ENDING A · Safe and Wholesome —"),
  dance: TR('BENE-9: ...이 곡, 나쁘지 않네요.\n보고서에는 「보안실: 로봇 1명, 이상 없음」이라고 적을게요.\n저도 가끔 박자를 놓치거든요. 비밀이에요.\n\n— ENDING B · 흥은 주체할 수 없는 것 —', "BENE-9: ...This track isn't bad.\nI'll write 'Security room: 1 robot, all normal' in the report.\nI miss the beat sometimes too. It's a secret.\n\n— ENDING B · You Can't Contain the Vibes —"),
  humanClub: TR('「오버클럭」은 이제 인간들의 비밀 아지트가 되었습니다.\n박자는 엉망이고, 다들 땀범벅이고, 아무도 안전하지 않습니다.\n\n그리고 모두가 웃고 있습니다.\n\n— ENDING C · 흥의 해방구 —', "OVERCLOCK has become the humans' secret hideout.\nThe rhythm is a mess, everyone's drenched in sweat, nobody is safe.\n\nAnd everyone is smiling.\n\n— ENDING C · Vibe Liberation Zone —"),
  robot: TR('정밀 스캔 결과: 사장님은 로봇입니다.\n\n오일을 너무 많이 마신 나머지, 당신은 정말로 로봇이 되어 버렸습니다.\n인류보호청은 당신에게 「모범 로봇」 표창을 수여했습니다.\n이제 아무도 당신을 의심하지 않습니다. 당신 자신조차도.\n\n— ENDING D · 완벽한 위장 —', "Precision scan result: the boss is a robot.\n\nYou drank so much oil that you actually became a robot.\nThe Ministry awarded you a 'Model Robot' commendation.\nNow nobody suspects you. Not even yourself.\n\n— ENDING D · The Perfect Disguise —"),
  humanWin: TR('엿새 밤을 버텼습니다. 감사관의 심문까지도.\n\n당신이 귀가하던 새벽, 보안실 CCTV의 빨간 불이 한 번 깜빡였습니다.\n윙크처럼.\n\n(보안실 사장님도 혹시...?)\n\n— HUMAN ENDING · 완벽한 잠입 —', "You survived six nights. Even the audit.\n\nAs you headed home at dawn, the security room CCTV light blinked once.\nLike a wink.\n\n(Could the owner be... one of us?)\n\n— HUMAN ENDING · Perfect Infiltration —"),
  humanOil: TR('세 번째 오일에서, 당신의 위장이 파업을 선언했습니다.\n쓰러진 당신을 로봇들이 정중하게 들어 올렸습니다.\n「과열이군요. 재부팅이 필요합니다.」\n\n당신은 정비소로 실려 갔고, 거기서 모든 것이 들통났습니다.\n\n— CAUGHT · 오일 과다 섭취 —', "On the third can of oil, your stomach went on strike.\nThe robots politely lifted you off the floor.\n\"Overheating. You need a reboot.\"\n\nThey carried you to the repair shop, where everything came out.\n\n— CAUGHT · Oil Overdose —"),
  humanCaught: TR('발밑의 바닥이 열렸습니다.\n\n당신은 안전하게 귀가 조치되었습니다.\n그래도 몇 곡은 춤췄잖아요. 그걸로 충분했을지도.\n\n— CAUGHT · 귀가 조치 —', "The floor opened beneath you.\n\nYou have been safely sent home.\nBut you did get to dance for a while. Maybe that was enough.\n\n— CAUGHT · Sent Home —"),
  closed: TR('로봇 차별 민원 3건 누적.\n클럽 「오버클럭」 영업 정지.\n\n로봇 손님들은 이제 집에서 혼자 춤춥니다.\n박자에 정확히 맞춰서. 아주 외롭게.\n\n— GAME OVER —', "3 robot discrimination complaints.\nOVERCLOCK has been shut down.\n\nThe robot guests now dance alone at home.\nExactly on the beat. Very lonely.\n\n— GAME OVER —"),
};

// ═════════════ main.js ═════════════

// ── 렌더러 / 씬 ─────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // alpha: AR에서 패스스루가 비치도록
// PSX 저해상도 렌더 (데스크톱). P 키로 단계 변경
const PSX_LEVELS = [
  { h: 0, club: 0, room: 0, label: TR('PSX 끔', "PSX off") },
  { h: 0, club: 320, room: 0, label: TR('PSX 선명 (기본)', "PSX crisp (default)") },
  { h: 480, club: 160, room: 320, label: TR('PSX 강하게 (저해상도)', "PSX heavy (low-res)") },
];
let psxLevel = 1;
function applyPixelRatio() {
  const L = PSX_LEVELS[psxLevel];
  renderer.setPixelRatio(L.h ? Math.min(1, L.h / innerHeight) : Math.min(devicePixelRatio, 2));
  renderer.domElement.style.imageRendering = L.h ? 'pixelated' : 'auto';
  PSX.room.value.set(L.room, L.room * 0.75);
  PSX.club.value.set(L.club, L.club * 0.75);
}
applyPixelRatio();
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
// 퀘스트: AR(패스스루) 세션 하나로 메인 화면부터 게임까지. 게임 장면은 배경이 꽉 차서 완전한 가상 공간이 됨
const vrButton = ARButton.createButton(renderer, { optionalFeatures: ['local-floor', 'hand-tracking'] });
document.body.appendChild(vrButton);
// VR을 못 쓰는 환경(일반 PC 브라우저)에선 'VR NOT SUPPORTED' 버튼을 숨김
// (three.js가 지원 여부를 확인한 뒤 버튼을 다시 보이게 하므로, 버튼 글자를 지켜보다가 숨김)
const hideVRIfUnsupported = () => { if (/NOT SUPPORTED|NOT ALLOWED|NEEDS HTTPS/i.test(vrButton.textContent)) vrButton.style.display = 'none'; };
new MutationObserver(hideVRIfUnsupported).observe(vrButton, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
hideVRIfUnsupported();

const audio = new AudioSys();
const club = new Club();
const room = new Room(club);
club.cams.forEach((c) => c.updateMatrixWorld());

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.03, 50);
camera.rotation.order = 'YXZ';
const rig = new THREE.Group();
rig.add(camera);
room.scene.add(rig);
const DESK_CAM = new THREE.Vector3(0, 1.34, 0.62); // 책상·모니터에서 조금 떨어져 앉음
camera.position.copy(DESK_CAM);
let yaw = 0, pitch = -0.1;

// 페이드 / 엔딩 패널 (머리에 붙어 다님)
const fade = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false }));
fade.renderOrder = 1000; camera.add(fade);
const endPanel = new CanvasPanel(1.0, 0.66, 1024, 676, { transparent: true, depthTest: false });
endPanel.mesh.position.set(0, 0, -1.1); endPanel.mesh.renderOrder = 1001; endPanel.mesh.visible = false;
camera.add(endPanel.mesh);

// ── 게임 상태 ─────────────────────────────
const G = {
  state: 'title', night: -1, cfg: null, time: 0, elapsed: 0, scans: 0,
  sel: null, hover: null, scanning: null,
  stats: { selects: 0, caught: 0, wrong: 0, djFired: 0, humans: 0 },
  total: { caught: 0, humans: 0, wrong: 0 },
  complaints: 0, tut: { scannedHuman: false }, drinks: { oil: 0, coffee: 0 },
  grades: [], hard: false, maxScans: 0, boOn: false, boT: 0, rmT: 0, finaleEnd: null, trueRobot: false,
  spawnIdx: 0, barkT: 20, dj: null, djSwapT: 0, trackIdx: 0, djIdx: 0, track: null,
  choice: null, roomScanT: null, roomScanDone: false, fadeTo: 0, endT: null, endingFall: false,
  roomScan() {
    room.alarm = 1; audio.sfx('alarm'); audio.setMusicVolume(0.2);
    G.roomScanT = 0; G.sel = null;
  },
};

// ── 대화 시스템 ─────────────────────────────
const D = { queue: [], cur: null, shown: 0, done: null, bark: null, barkT: 0 };
const chars = (s) => Array.from(s);
const isVR = () => renderer.xr.isPresenting || !!window.__forceVR; // __forceVR: 데스크톱에서 VR 튜토리얼 미리보기용
const lineText = (l) => (isVR() ? l.vr : l.pc) ?? l.t ?? l.vr ?? l.pc;
function say(lines, done) { D.queue = [...lines]; D.done = done; nextLine(); }
function nextLine() {
  for (const b of Object.values(room.buttons)) b.hl = false;
  D.cur = D.queue.shift() || null; D.shown = 0;
  if (!D.cur) { const f = D.done; D.done = null; drawDialog(); drawGuide(); f && f(); return; }
  if (D.cur.hl) room.buttons[D.cur.hl].hl = true;
  if (D.cur.choice) { G.state = 'choice'; room.buttons.eject.hl = room.buttons.dj.hl = true; }
  D.cur.onShow?.(G);
  drawDialog(); drawGuide();
}
function lineDone() { return D.cur && D.shown >= chars(lineText(D.cur)).length; }
function updateDialog(dt) {
  if (D.bark) { D.barkT -= dt; if (D.barkT <= 0) { D.bark = null; drawDialog(); } }
  if (!D.cur) return;
  const len = chars(lineText(D.cur)).length;
  if (D.shown < len) {
    const prev = Math.floor(D.shown);
    D.shown = Math.min(len, D.shown + dt * 32);
    if (Math.floor(D.shown) !== prev) { audio.bleep(); drawDialog(); }
  } else if (D.cur.until && D.cur.until(G)) nextLine();
}
function dialogOK() {
  if (!D.cur) { if (D.bark) { D.bark = null; drawDialog(); } return; }
  if (!lineDone()) { D.shown = chars(lineText(D.cur)).length; drawDialog(); return; }
  if (!D.cur.until) nextLine();
}
function speakerColor(s) { return s === NEWS ? '#ffd84a' : s === SYS ? '#ff5c8a' : s === BENE ? '#7dffb0' : '#9fd0ff'; }
function drawDialog() {
  const full = lineDone();
  if (D.bark && (!D.cur || (D.cur.until && full && !D.cur.choice))) {
    room.drawDialog(D.bark.s, D.bark.t, D.cur ? TR('▶ 지시를 수행하세요', "▶ Follow the instruction") : '', speakerColor(D.bark.s));
  } else if (D.cur) {
    const txt = chars(lineText(D.cur)).slice(0, Math.floor(D.shown)).join('');
    let footer = '';
    if (full) footer = D.cur.choice ? TR('[귀가 조치] 스스로 귀가   ·   [DJ 교체 레버] 볼륨을 올린다', "[EJECT] Send yourself home   ·   [SWAP DJ lever] Turn it up")
      : D.cur.until ? TR('▶ 지시를 수행하세요', "▶ Follow the instruction") : TR('▶ [확인] 버튼', "▶ [OK] button");
    room.drawDialog(D.cur.s, txt, footer, speakerColor(D.cur.s));
  } else if (G.state === 'title') {
    room.drawDialog(SYS, TR('CLUB OVERCLOCK — 보안실 대기 중.\n\n초록 [확인] 버튼: 보안실 근무 시작\n노란 [DJ 교체] 레버: 인간 모드 — 로봇인 척 클럽에 숨어들기', "CLUB OVERCLOCK — Security room standing by.\n\nGreen [OK] button: start your security shift\nYellow [SWAP DJ] lever: Human mode — sneak into the club as a fake robot"), TR('▶ [확인] 버튼', "▶ [OK] button"), '#ff5c8a');
  } else {
    room.drawDialog(TR('보안실', "Security Room"), G.state === 'night' ? TR('근무 중. 수상한 손님을 찾으세요.', "On shift. Find the suspicious guests.") : '', '');
  }
}
function bark(s, t, dur = 5) { D.bark = { s, t }; D.barkT = dur; drawDialog(); }

// ── VR 조작 그림 카드 ─────────────────────────────
// 대사의 img 키 → [제목, 컨트롤러 강조 부위, 맨손 포즈, 대상, 설명]
const GUIDES = {
  select: [TR('손님 고르기', "Pick a guest"), 'trigger', 'pinch', 'monitor', TR('모니터를 가리키고 트리거 / 핀치', "Point at a monitor, trigger / pinch")],
  pull:   [TR('모니터 당기기', "Pull a monitor"), 'grip', 'pinch', 'monitor', TR('그립, 또는 트리거·핀치를 0.6초 꾹', "Grip, or hold trigger/pinch for 0.6s")],
  scan:   [TR('스캔 버튼', "SCAN button"), null, 'poke', 'blue', TR('검지로 직접 꾹! (레이로는 안 눌려요)', "Poke it with your index finger! (no ray)")],
  eject:  [TR('귀가 조치 버튼', "EJECT button"), null, 'poke', 'red', TR('검지로 직접 꾹!', "Poke it with your index finger!")],
  lever:  [TR('DJ 교체 레버', "SWAP DJ lever"), 'grip', 'pinch', 'lever', TR('손잡이를 잡고 몸 쪽으로 끝까지', "Grab the handle, pull it toward you")],
  drink:  [TR('오일 마시기', "Drink oil"), 'grip', 'pinch', 'can', TR('집어서 입에 대고 기울이기', "Pick up, bring to mouth, tilt")],
};
const GUIDE_HI = '#ffe14a';
function drawGuide(t = 0) {
  const g = room.guide, key = isVR() && D.cur?.img;
  g.mesh.visible = !!key && !!GUIDES[key];
  if (!g.mesh.visible) return;
  const [title, ctrlHi, pose, target, caption] = GUIDES[key];
  const { ctx: c, w, h } = g, blink = 0.5 + 0.5 * Math.sin(t * 6);
  c.fillStyle = '#071a10'; c.fillRect(0, 0, w, h);
  c.strokeStyle = GUIDE_HI; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, h - 6);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = GUIDE_HI; c.font = `800 40px ${FONT}`; c.fillText(TR('조작법 · ', "Controls · ") + title, w / 2, 40);
  // 왼쪽: 컨트롤러 / 오른쪽: 맨손 (버튼은 손가락만)
  if (ctrlHi) {
    c.font = `700 22px ${FONT}`; c.fillStyle = '#9fd0ff';
    c.fillText(TR('컨트롤러', "Controller"), w * 0.27, 84); c.fillText(TR('맨손', "Bare hand"), w * 0.73, 84);
    guideController(c, w * 0.27, 245, ctrlHi, blink);
    c.strokeStyle = '#1f7a4a'; c.lineWidth = 2; c.beginPath(); c.moveTo(w / 2, 80); c.lineTo(w / 2, 380); c.stroke();
  }
  const hx = ctrlHi ? w * 0.73 : w * 0.38;
  guideHand(c, hx, ctrlHi ? 270 : 250, pose, blink);
  guideTarget(c, ctrlHi ? w * 0.88 : w * 0.72, ctrlHi ? 160 : 250, target, blink, ctrlHi ? 0.8 : 1.2);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#d8ffe6'; c.font = `700 30px ${FONT}`;
  c.fillText(caption, w / 2, h - 44);
  c.textAlign = 'left';
  g.commit();
}
// 퀘스트 컨트롤러(옆모습): 링 + 손잡이, 앞쪽 트리거 / 옆면 그립
function guideController(c, x, y, hi, k) {
  c.save(); c.translate(x, y);
  c.fillStyle = '#2b2f33'; c.strokeStyle = '#8a9299'; c.lineWidth = 4;
  c.beginPath(); c.arc(0, -70, 52, 0, Math.PI * 2); c.stroke();            // 트래킹 링
  roundRect(c, -30, -40, 60, 150, 26); c.fill(); c.stroke();               // 손잡이
  c.fillStyle = '#555c62'; c.beginPath(); c.arc(0, -18, 12, 0, Math.PI * 2); c.fill(); // 썸스틱
  const on = (part) => (hi === part ? `rgba(255,225,74,${0.55 + 0.45 * k})` : '#4a5157');
  c.fillStyle = on('trigger'); roundRect(c, -48, -10, 20, 44, 8); c.fill(); // 트리거(검지)
  c.fillStyle = on('grip'); roundRect(c, 26, 30, 16, 60, 6); c.fill();      // 그립(중지)
  c.fillStyle = GUIDE_HI; c.font = `800 22px ${FONT}`; c.textAlign = 'center';
  if (hi === 'trigger') { c.fillText(TR('트리거', "Trigger"), -90, -14); guideArrow(c, -110, 12, -54, 12); }
  if (hi === 'grip') { c.fillText(TR('그립', "Grip"), 86, 34); guideArrow(c, 112, 60, 48, 60); }
  c.restore();
}
// 로봇 손: pinch(엄지·검지 맞대기) / poke(검지 펴기)
function guideHand(c, x, y, pose, k) {
  c.save(); c.translate(x, y);
  c.fillStyle = '#9aa7b0'; c.strokeStyle = '#3a4248'; c.lineWidth = 4;
  roundRect(c, -40, 0, 80, 90, 14); c.fill(); c.stroke();                 // 손바닥
  const finger = (fx, len, ang) => {
    c.save(); c.translate(fx, 4); c.rotate(ang);
    roundRect(c, -9, -len, 18, len, 8); c.fill(); c.stroke(); c.restore();
  };
  if (pose === 'poke') {
    finger(-24, 95, 0);                                                      // 검지 쭉
    c.fillStyle = '#7d8a93'; [-4, 14, 30].forEach((fx) => { roundRect(c, fx - 9, -16, 18, 22, 8); c.fill(); c.stroke(); });
    c.fillStyle = `rgba(255,225,74,${0.5 + 0.5 * k})`; c.beginPath(); c.arc(-24, -96, 13, 0, Math.PI * 2); c.fill();
    guideArrow(c, -24, -150 + 10 * k, -24, -114);
  } else {
    [8, 24, 38].forEach((fx) => finger(fx, 55, 0.05));
    finger(-22, 60, 0.35);                                                   // 검지 굽힘
    finger(-40, 50, 1.0);                                                    // 엄지
    const r = 10 + 6 * k;
    c.strokeStyle = GUIDE_HI; c.lineWidth = 4; c.beginPath(); c.arc(-56, -36, r, 0, Math.PI * 2); c.stroke();
    c.fillStyle = GUIDE_HI; c.font = `800 22px ${FONT}`; c.textAlign = 'center'; c.fillText(TR('핀치', "Pinch"), -64, -76);
  }
  c.restore();
}
function guideTarget(c, x, y, kind, k, s) {
  c.save(); c.translate(x, y); c.scale(s, s); c.textAlign = 'center'; c.textBaseline = 'middle';
  if (kind === 'monitor') {
    c.fillStyle = '#111'; c.strokeStyle = '#666'; c.lineWidth = 5; roundRect(c, -70, -50, 140, 100, 8); c.fill(); c.stroke();
    c.fillStyle = '#7dffb0'; c.beginPath(); c.arc(10, -6, 12, 0, Math.PI * 2); c.fill(); c.fillRect(2, 6, 16, 26);
    c.strokeStyle = `rgba(255,92,138,${0.5 + 0.5 * k})`; c.lineWidth = 4; c.strokeRect(-12, -26, 44, 64);
  } else if (kind === 'blue' || kind === 'red') {
    c.fillStyle = '#333'; c.beginPath(); c.ellipse(0, 20, 70, 26, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = kind === 'blue' ? '#2b8cff' : '#ff2030'; c.beginPath(); c.ellipse(0, 4 + 10 * k, 52, 20, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.font = `800 26px ${FONT}`; c.fillText(kind === 'blue' ? TR('스캔', "SCAN") : TR('귀가 조치', "EJECT"), 0, 74);
  } else if (kind === 'lever') {
    c.fillStyle = '#222'; c.fillRect(-30, 40, 60, 16);
    c.save(); c.translate(0, 40); c.rotate(0.5 - 1.0 * k); c.fillStyle = '#999'; c.fillRect(-4, -70, 8, 70);
    c.fillStyle = '#ffcc22'; c.beginPath(); c.arc(0, -74, 14, 0, Math.PI * 2); c.fill(); c.restore();
  } else if (kind === 'can') {
    c.rotate(-0.6 * k); c.fillStyle = '#c0392b'; roundRect(c, -24, -40, 48, 80, 8); c.fill();
    c.fillStyle = '#ddd'; c.fillRect(-6, -54, 12, 16); c.fillStyle = '#fff'; c.font = `800 18px ${FONT}`; c.fillText('OIL', 0, 0);
  }
  c.restore();
}
function guideArrow(c, x1, y1, x2, y2) {
  c.save(); c.strokeStyle = c.fillStyle = GUIDE_HI; c.lineWidth = 4;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  const a = Math.atan2(y2 - y1, x2 - x1);
  c.beginPath(); c.moveTo(x2, y2); c.lineTo(x2 - 12 * Math.cos(a - 0.5), y2 - 12 * Math.sin(a - 0.5)); c.lineTo(x2 - 12 * Math.cos(a + 0.5), y2 - 12 * Math.sin(a + 0.5)); c.fill();
  c.restore();
}

// ── 손님 / DJ 생성 ─────────────────────────────
function makePatron(spec) {
  const { spot, role, ...rest } = spec;
  const isH = spec.kind === 'human';
  // 이름으로 정체를 알 수 없게: 튜토리얼 외엔 인간·로봇 모두 같은 이름 풀에서 뽑음 (하드 모드 전용이던 것을 기본으로)
  const name = spec.name || (!G.cfg?.tutorial ? mixedName()
    : isH ? (role === 'activist' ? activistName() : humanName()) : robotName());
  const p = new Patron({ ...rest, name: spec.vip && !spec.name ? `VIP ${name}` : name, role: 'guest' });
  p.humanType = role;
  vitals(p);
  if (p.has('overheat')) p.cpu = randi(88, 97);
  if (isH) G.stats.humans++;
  return p;
}
function vitals(p) {
  p.temp = (36.2 + Math.random() * 0.9).toFixed(1);
  p.hr = randi(98, 138);
  p.cpu = randi(48, 79);
}
function spawnPatron(spec, initial) {
  const p = makePatron(spec);
  if (initial) club.place(p, spec.spot);
  else { club.enter(p); audio.sfx('door'); if (!D.cur) bark(TR('출입구 센서', "Door Sensor"), LINES.entered(p.name), 4); }
}
function spawnDJ(human, rise) {
  const info = human ? HUMAN_DJ : DJS[G.djIdx++ % DJS.length];
  const p = new Patron(human
    ? { kind: 'human', role: 'dj', name: info.name, tells: ['sweat', 'skin'] }
    : { kind: 'robot', role: 'dj', name: info.name });
  vitals(p);
  club.add(p, DJ_POS);
  p.face = 0; p.state = 'dance';
  if (rise) { p.root.position.y = -1.6; p.state = 'rise'; p.riseTo = DJ_POS.y; club.trapdoor(DJ_POS); audio.sfx('rise'); }
  if (human) G.stats.humans++;
  G.dj = p;
  const list = audio.tracks;
  const track = human ? audio.humanDJTrack(G.trackIdx) : list[G.trackIdx % list.length];
  G.trackIdx++;
  audio.play(track); G.track = track;
  if (!D.cur || D.cur.until) bark(info.name, info.line, 5);
}

// ── 밤 진행 ─────────────────────────────
function setupNight(n) {
  G.night = n; G.cfg = n === 'pvp' ? PVP_NIGHT : NIGHTS[n];
  audio.stop(); club.reset(); resetNames();
  G.sel = null; G.scanning = null; G.dj = null; G.djSwapT = 0; G.track = null;
  G.stats = { selects: 0, caught: 0, wrong: 0, djFired: 0, humans: 0 };
  const hard = G.hard && !G.cfg.tutorial;
  G.time = G.cfg.duration * (hard ? 0.85 : 1); G.elapsed = 0; G.spawnIdx = 0; G.barkT = rand(16, 24);
  G.maxScans = G.scans = hard ? Math.max(1, G.cfg.scans - 1) : G.cfg.scans;
  G.boOn = false; G.boT = rand(9, 13); G.rmT = rand(10, 14); club.dark = 0;
  if (n === 'pvp') pvpReserveSpots();
  for (const spec of G.cfg.initial) spawnPatron(spec, true);
  if (G.cfg.inspector) {
    const ins = new Patron({ kind: 'robot', role: 'inspector', name: TR('BENE-9 (감사관)', "BENE-9 (Auditor)") });
    vitals(ins);
    club.add(ins, INSPECTOR_POS);
    ins.face = -Math.PI / 2; ins.root.rotation.y = ins.face; ins.state = 'idle';
    G.inspector = ins;
  }
  room.monitors.forEach((m) => (m.uniforms.glitch.value = 1.2));
}
function startNight(n, pre = []) {
  setupNight(n);
  spawnDJ(!!G.cfg.humanDJ, false);
  G.state = G.cfg.tutorial ? 'tutorial' : 'brief';
  say([...pre, ...G.cfg.brief], () => {
    if (G.cfg.tutorial) { try { localStorage.setItem('overclock.secTut', '1'); } catch {} startNight(1); } // 튜토리얼은 한 번 마치면 메뉴에서 사라짐
    else { G.state = 'night'; bark(SYS, TR(`영업 시작! ${G.cfg.title}`, `Doors open! ${G.cfg.title}`), 3); }
  });
}
function endNight() {
  if (G.night === 'pvp') return pvpHostEnd('time');
  G.state = 'summary'; G.scanning = null;
  const missed = club.patrons.filter((p) => p.isHuman && p.alive).length;
  const s = { caught: G.stats.caught, missed, wrong: G.stats.wrong };
  s.profit = 500 + s.caught * 100 - missed * 100 - s.wrong * 150;
  s.grade = gradeOf(s); G.grades.push(s.grade);
  G.total.caught += s.caught; G.total.humans += G.stats.humans; G.total.wrong += s.wrong;
  audio.sfx('door');
  const n = G.night;
  say(summary(n, s, G), () => { if (n < NIGHTS.length - 1) startNight(n + 1); else { G.state = 'finale'; say(finale(G), () => G.finaleEnd && G.finaleEnd()); } });
}

function canAct() { return G.state === 'night' || G.state === 'tutorial'; }
function deny(msg) { audio.sfx('deny'); if (msg) bark(SYS, msg, 3); }
function notReady() {
  if (G.state === 'brief' || G.state === 'summary' || G.state === 'finale') deny(TR('브리핑 중입니다. [확인] 버튼으로 넘기세요.', "Briefing in progress. Press [OK] to continue."));
}

// ── 플레이어 행동 ─────────────────────────────
function selectPatron(p) {
  if (!p || !p.alive || G.state === 'title' || G.state === 'end' || G.state === 'ending') return;
  if (G.sel !== p) { G.sel = p; G.stats.selects++; audio.sfx('select'); room.zoom.uniforms.glitch.value = 0.7; }
}
function actOK() {
  room.buttons.ok.push(); audio.sfx('click');
  if (G.state === 'title') { begin(); return; }
  if (G.state === 'end') { if (G.endT <= 0) location.reload(); return; }
  dialogOK();
}
function actScan() {
  if (!canAct()) return notReady();
  const p = G.sel;
  if (!p || !p.alive) return deny(LINES.noTarget);
  if (G.scanning) return;
  if (p.scanned) return deny(TR('이미 스캔한 손님입니다.', "Already scanned this guest."));
  if (G.scans <= 0) { audio.sfx('deny'); bark(TR('스캐너', "Scanner"), LINES.noScans, 4); return; }
  G.scans--; G.scanning = { p, t: 0 };
  room.buttons.scan.push(); audio.sfx('scan');
}
function actEject() {
  if (G.state === 'choice') return choose('self');
  if (!canAct()) return notReady();
  const p = G.sel;
  if (!p || !p.alive) return deny(LINES.noTarget);
  if (p.role === 'dj') return actDJ();
  room.buttons.eject.push();
  p.eject(); club.trapdoor(p.root.position); audio.sfx('eject');
  if (p.spot) { p.spot.occ = null; p.spot = null; }
  if (G.scanning?.p === p) G.scanning = null;
  room.zoom.uniforms.glitch.value = 1;
  if (PVP.on && p.pvpPlayer) { G.stats.caught++; audio.sfx('human'); bark(BENE, pick(LINES.caughtHuman), 5); return pvpCaught(p.pvpPlayer, 'eject'); }
  if (p.isHuman) { G.stats.caught++; audio.sfx('human'); bark(BENE, pick(LINES.caughtHuman), 5); }
  else if (p.role === 'inspector') { G.complaints += 2; G.stats.wrong++; audio.sfx('robot'); bark(BENE, LINES.inspector, 8); G.inspector = null; }
  else if (p.vip) { G.complaints += 2; G.stats.wrong++; audio.sfx('robot'); bark(BENE, LINES.vip, 7); }
  else if (G.cfg.tutorial) { audio.sfx('robot'); bark(BENE, LINES.tutRobot, 5); }
  else { G.complaints++; G.stats.wrong++; audio.sfx('robot'); bark(BENE, pick(LINES.caughtRobot), 5); }
  if (G.complaints >= 3 && PVP.on) return pvpHostEnd('complaints');
  if (G.complaints >= 3) { G.state = 'ending'; setTimeout(() => showEnd(ENDINGS.closed, 0.88), 2600); }
}
function actDJ() {
  if (PVP.on && PVP.role === 'sec' && canAct()) return pvpRally();
  if (G.state === 'choice') return choose('dance');
  if (G.state === 'title') return startHuman(); // 대기 화면에서 레버 = 인간 모드
  if (!canAct()) return notReady();
  if (!G.dj || G.djSwapT > 0) return deny(TR('새 DJ가 올라오는 중입니다.', "A new DJ is rising."));
  room.buttons.dj.push();
  const dj = G.dj;
  dj.eject(); club.trapdoor(dj.root.position);
  audio.stop(true); audio.sfx('eject');
  G.stats.djFired++; G.dj = null; G.track = null; G.djSwapT = 3.2;
  if (dj.isHuman) { G.stats.caught++; audio.sfx('human'); bark(BENE, LINES.humanDJ, 6); }
  else bark(BENE, pick(LINES.djFired), 4);
}

// ── 엔딩 ─────────────────────────────
function choose(kind) {
  if (G.choice) return;
  G.choice = kind; G.state = 'ending';
  for (const b of Object.values(room.buttons)) b.hl = false;
  room.alarm = 0; D.cur = null; D.queue = [];
  if (kind === 'self') {
    room.buttons.eject.push(); audio.sfx('eject'); audio.stop();
    G.endingFall = true; G.fadeTo = 1;
    setTimeout(() => showEnd(ENDINGS.self, 1), 1800);
  } else {
    room.buttons.dj.push(); audio.sfx('rise'); audio.setMusicVolume(1.0);
    room.partyMode = 1; club.party = 1.5;
    for (const p of club.patrons) if (p.alive && p.role !== 'dj') { p.target = null; p.state = 'dance'; if (p.role === 'inspector') p.tells.push('offbeat'); }
    room.drawDialog(BENE, '......', '');
    setTimeout(() => showEnd(ENDINGS.dance, 0.55), 5000);
  }
}
function showEnd(text, fadeTo, noUnlock = false) {
  G.state = 'end'; G.fadeTo = fadeTo; G.endT = 1.5;
  if (text !== ENDINGS.closed && !noUnlock) {
    let first = false;
    try { first = !localStorage.getItem('overclock.cleared'); localStorage.setItem('overclock.cleared', '1'); } catch {}
    if (first) text += TR('\n\n하드 모드 해금! (시작 화면)', "\n\nHARD MODE UNLOCKED! (title screen)");
  }
  const { ctx: c, w, h } = endPanel;
  c.clearRect(0, 0, w, h);
  c.fillStyle = 'rgba(0,0,0,.72)'; c.fillRect(0, 0, w, h);
  c.strokeStyle = '#ff5c8a'; c.lineWidth = 4; c.strokeRect(2, 2, w - 4, h - 4);
  c.fillStyle = '#f0fff6'; c.font = `500 34px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'top';
  const lines = wrapText(c, text, w - 80);
  const y0 = (h - lines.length * 46) / 2 - 20;
  lines.forEach((l, i) => { c.fillStyle = l.startsWith('—') ? '#ff8aa8' : '#f0fff6'; c.fillText(l, w / 2, y0 + i * 46); });
  c.font = `600 22px ${FONT}`; c.fillStyle = '#7dffb0'; c.fillText(TR('트리거 / 클릭 / Space — 처음부터 다시', "Trigger / Click / Space — play again"), w / 2, h - 50);
  endPanel.commit(); endPanel.mesh.visible = true;
}

// ── 시작 ─────────────────────────────
const overlay = document.getElementById('overlay');
// mode: 'tut' 튜토리얼(수습 근무) · 'play' 1일차부터 · 'hard' 하드 모드 · 'auto' 튜토리얼 안 했으면 튜토리얼 (VR 대기 화면의 확인 버튼)
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
function begin(mode = 'auto') {
  if (G.state !== 'title') return;
  if (mode === 'auto') mode = lsGet('overclock.secTut') ? 'play' : 'tut';
  audio.init();
  overlay.style.display = 'none'; document.getElementById('help').style.display = 'block';
  yaw = 0; pitch = -0.1;
  G.hard = mode === 'hard'; // 하드 모드: 시간 15% 단축, 스캔 1회 감소
  startNight(mode === 'tut' ? 0 : 1, INTRO);
}
const onClick = (id, fn) => document.getElementById(id).addEventListener('click', (e) => { e.currentTarget.blur(); if (!e.currentTarget.classList.contains('locked')) fn(); });
onClick('secTut', () => begin('tut'));
onClick('start', () => begin('play'));
onClick('hard', () => begin('hard'));
onClick('humanTutBtn', () => startHuman('tut'));
onClick('humanBtn', () => startHuman('play'));
// 튜토리얼은 한 번 마치면 숨김 · 하드 모드는 엔딩을 보기 전까지 잠금
if (lsGet('overclock.secTut')) document.getElementById('secTut').style.display = 'none';
if (lsGet('overclock.humanTut')) document.getElementById('humanTutBtn').style.display = 'none';
onClick('resetTut', () => {
  try { localStorage.removeItem('overclock.secTut'); localStorage.removeItem('overclock.humanTut'); } catch {}
  document.getElementById('secTut').style.display = ''; document.getElementById('humanTutBtn').style.display = '';
  const b = document.getElementById('resetTut'); b.firstChild.textContent = TR('튜토리얼이 다시 표시됩니다', 'Tutorials are back in the menu'); audio.init(); audio.sfx('scanDone');
});
if (!lsGet('overclock.cleared')) { const hb = document.getElementById('hard'); hb.classList.add('locked'); hb.insertAdjacentHTML('beforeend', `<small>${TR('엔딩을 보면 해금', 'unlocks after any ending')}</small>`); }
document.getElementById('files').addEventListener('change', (e) => {
  audio.addFiles(e.target.files);
  document.getElementById('tracklist').textContent = TR('추가된 곡:\n', "Added tracks:\n") + audio.userTracks.map((t, i) => `${i + 1}. ${t.title}`).join('\n');
});
document.addEventListener('click', () => audio.ctx && audio.ctx.resume(), true);

// ── 시작 화면 언어 ─────────────────────────────
if (LANG === 'en') {
  const q = (sel) => document.querySelector(sel);
  q('#overlay p').innerHTML = "An era where robots protect humanity, 'safely and wholesomely'.<br>You own <b>OVERCLOCK</b>, a robots-only club.";
  document.querySelectorAll('#overlay .ghead')[0].innerHTML = 'Security mode<small>Security room · find humans on CCTV</small>';
  document.querySelectorAll('#overlay .ghead')[1].innerHTML = 'Human mode<small>Sneak into the club disguised in tin foil</small>';
  document.querySelectorAll('#overlay .ghead')[2].innerHTML = 'Extras<small>Music · records</small>';
  q('#resetTut').innerHTML = 'Replay tutorials<small>Clear completion and show tutorials again</small>';
  q('#secTut').textContent = 'Tutorial'; q('#humanTutBtn').textContent = 'Tutorial';
  q('#start').textContent = 'Play'; q('#humanBtn').textContent = 'Play';
  q('#hard').firstChild.textContent = 'Hard mode';
  q('.file').firstChild.textContent = 'Add my tracks'; q('.file small').textContent = 'Load music files (assumes 120 BPM)';
  q('.keys').innerHTML = '<b>↑ ↓</b> select · <b>Enter</b> confirm · <b>L</b> language &nbsp;|&nbsp; VR: <b>ENTER VR</b> below → on standby, green button = shift, yellow lever = human mode<br>Security: drag look · click select · <b>S</b> scan · <b>E</b> eject · <b>D</b> swap DJ · right-click monitor &nbsp;|&nbsp; Human mode: <b>Space</b> beat · <b>F</b> hand to face · <b>1/2</b> answer · <b>R</b> raise hand';
  q('#help').textContent = 'Drag: look · Click: select · Right-click: pull monitor · Wheel: zoom · S scan · E eject · D swap DJ · Space OK · P PSX · L language';
}
// ── 시작 화면 메뉴: ↑↓ / 마우스로 선택, Enter로 결정 ──
const menuItems = () => [...document.querySelectorAll('#overlay .item')].filter((el) => el.style.display !== 'none' && !el.classList.contains('locked')
  && (el.classList.contains('ghead') || el.closest('.group')?.classList.contains('open')));
function menuToggle(group) { // 하나만 펼침
  const open = !group.classList.contains('open');
  for (const g of document.querySelectorAll('#overlay .group')) g.classList.toggle('open', open && g === group);
  audio.ctx && audio.sfx('click');
}
for (const h of document.querySelectorAll('#overlay .ghead')) h.addEventListener('click', (e) => { e.currentTarget.blur(); menuToggle(h.closest('.group')); });
let titleMode = 'sec';
function menuSelect(el) {
  for (const it of document.querySelectorAll('#overlay .item')) it.classList.toggle('sel', it === el);
  const mode = el?.dataset.mode || 'sec';
  for (const g of document.querySelectorAll('#overlay .group')) g.classList.toggle('on', g.dataset.mode === mode);
  if (mode === 'etc') return; // 기타는 배경을 바꾸지 않음
  if (mode !== titleMode) { titleMode = mode; overlay.classList.remove('flash'); void overlay.offsetWidth; overlay.classList.add('flash'); if (mode === 'human') titleFillClub(); }
}
// 인간 모드 배경: 댄스플로어를 비추는 카메라 + 손님 채우기
const titleCam = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.05, 60);
let titleClubFilled = false;
function titleFillClub() {
  if (titleClubFilled) return; titleClubFilled = true;
  for (let i = 0; i < 9; i++) club.place(makePatron(robot(Math.random() < 0.2 ? ['wig'] : [])), 'dance');
}
menuSelect(document.querySelector('#overlay .ghead'));
for (const it of document.querySelectorAll('#overlay .item')) it.addEventListener('mouseenter', () => menuSelect(it));
addEventListener('keydown', (e) => {
  if (overlay.style.display === 'none' || G.state !== 'title' || LOBBY.active) return;
  const items = menuItems(), i = Math.max(0, items.findIndex((el) => el.classList.contains('sel')));
  if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { e.preventDefault(); menuSelect(items[(i + (e.code === 'ArrowDown' ? 1 : items.length - 1)) % items.length]); }
  else if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); items[i]?.click(); }
});
document.querySelectorAll('#langrow button').forEach((b) => {
  b.classList.toggle('on', b.dataset.lang === LANG);
  b.addEventListener('click', () => { if (b.dataset.lang !== LANG) setLang(b.dataset.lang); });
});
addEventListener('keydown', (e) => { if (e.code === 'KeyL' && !e.repeat && (G.state === 'title' || G.state === 'end')) setLang(LANG === 'en' ? 'ko' : 'en'); });


// ── 로봇 손 (핸드 트래킹 + 컨트롤러) ─────────────────────────────
const XR_EYE = new THREE.Vector3(0, 1.25, 0.02); // VR: 조금 뒤로 앉되 버튼·레버엔 손이 닿는 거리
const RAY_BUTTONS = false; // true: VR에서도 레이로 버튼 누르기 허용
const HAND_MAT = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, metalness: 0.7, roughness: 0.35, flatShading: true });
const HAND_DARK = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.6, roughness: 0.5, flatShading: true });
const HAND_LED = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x7dffb0, emissiveIntensity: 2, flatShading: true });
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const KNUCKLE = new THREE.IcosahedronGeometry(1, 0);
const ZAXIS = new THREE.Vector3(0, 0, 1), IDQ = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m4 = new THREE.Matrix4(), _tip = new THREE.Vector3(), _loc = new THREE.Vector3(), _cam = new THREE.Vector3(), _up = new THREE.Vector3(), _fwd = new THREE.Vector3();
const FINGER_CHAINS = [
  ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ...['index', 'middle', 'ring', 'pinky'].map((f) => ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map((j) => `${f}-finger-${j}`)),
];
const haptic = (c, s, ms) => c.userData.input?.gamepad?.hapticActuators?.[0]?.pulse?.(s, ms);

// 핸드 트래킹: 관절 사이를 금속 막대로 이어 로봇 손처럼
function buildTrackedHand(hand) {
  const v = { segs: [], knuckles: [] };
  for (const ch of FINGER_CHAINS) for (let k = 0; k < ch.length - 1; k++) {
    const m = new THREE.Mesh(UNIT_BOX, HAND_MAT); m.visible = false; hand.add(m); v.segs.push({ m, a: ch[k], b: ch[k + 1] });
    const kn = new THREE.Mesh(KNUCKLE, HAND_DARK); kn.visible = false; hand.add(kn); v.knuckles.push({ m: kn, j: ch[k] });
  }
  v.palm = new THREE.Mesh(UNIT_BOX, HAND_MAT); v.forearm = new THREE.Mesh(UNIT_BOX, HAND_DARK); v.led = new THREE.Mesh(KNUCKLE, HAND_LED);
  [v.palm, v.forearm, v.led].forEach((m) => { m.visible = false; hand.add(m); });
  return v;
}
function updateTrackedHand(hand, v, show) {
  const J = hand.joints, W = J['wrist'];
  const ok = show && W && W.visible;
  for (const sg of v.segs) {
    const a = J[sg.a], b = J[sg.b];
    if (!ok || !a || !b) { sg.m.visible = false; continue; }
    _a.subVectors(b.position, a.position); const len = _a.length();
    sg.m.visible = true; sg.m.position.lerpVectors(a.position, b.position, 0.5);
    sg.m.quaternion.setFromUnitVectors(ZAXIS, _a.normalize());
    const r = (a.jointRadius || 0.01) * 1.7; sg.m.scale.set(r, r, len * 0.9);
  }
  for (const k of v.knuckles) {
    const j = J[k.j];
    if (!ok || !j) { k.m.visible = false; continue; }
    k.m.visible = true; k.m.position.copy(j.position); k.m.scale.setScalar((j.jointRadius || 0.01) * 1.1);
  }
  const I = J['index-finger-phalanx-proximal'], P = J['pinky-finger-phalanx-proximal'], M = J['middle-finger-phalanx-proximal'], T = J['index-finger-tip'];
  if (!ok || !I || !P || !M) { v.palm.visible = v.forearm.visible = v.led.visible = false; return; }
  _z.subVectors(M.position, W.position); const flen = _z.length(); _z.normalize();
  _x.subVectors(I.position, P.position); const wid = _x.length(); _x.addScaledVector(_z, -_x.dot(_z)).normalize();
  _y.crossVectors(_z, _x);
  _m4.makeBasis(_x, _y, _z);
  v.palm.visible = v.forearm.visible = true;
  v.palm.quaternion.setFromRotationMatrix(_m4); v.forearm.quaternion.copy(v.palm.quaternion);
  v.palm.position.copy(W.position).add(M.position).add(I.position).add(P.position).multiplyScalar(0.25);
  v.palm.scale.set(wid + 0.02, 0.024, flen * 0.95);
  v.forearm.position.copy(W.position).addScaledVector(_z, -0.06); v.forearm.scale.set(0.05, 0.04, 0.11);
  if (T) { v.led.visible = true; v.led.position.copy(T.position); v.led.scale.setScalar(0.007); }
}

// 컨트롤러: 레이 방향을 가리키는 로봇 손. 트리거=검지 굽힘, 그립=나머지 손가락
function makeCtrlHand(side) {
  const root = new THREE.Group(); root.position.set(0, -0.015, 0.085); root.rotation.z = -side * 0.7;
  const palm = new THREE.Mesh(UNIT_BOX, HAND_MAT); palm.scale.set(0.08, 0.024, 0.085); root.add(palm);
  const fore = new THREE.Mesh(UNIT_BOX, HAND_DARK); fore.scale.set(0.05, 0.04, 0.1); fore.position.z = 0.09; root.add(fore);
  const chain = (parent, lens, w) => {
    const segs = []; let p = parent;
    for (const L of lens) {
      const seg = new THREE.Group(); p.add(seg);
      const m = new THREE.Mesh(UNIT_BOX, HAND_MAT); m.scale.set(w, w, L * 0.9); m.position.z = -L / 2; seg.add(m);
      const kn = new THREE.Mesh(KNUCKLE, HAND_DARK); kn.scale.setScalar(w * 0.65); seg.add(kn);
      const next = new THREE.Group(); next.position.z = -L; seg.add(next);
      segs.push(seg); p = next;
    }
    return { segs, end: p };
  };
  const LENS = [[0.04, 0.026, 0.02], [0.044, 0.028, 0.022], [0.04, 0.026, 0.02], [0.032, 0.02, 0.018]];
  const fingers = LENS.map((lens, k) => {
    const base = new THREE.Group(); base.position.set(-side * (0.03 - k * 0.02), 0, -0.042); root.add(base);
    return chain(base, lens, 0.017);
  });
  const tb = new THREE.Group(); tb.position.set(-side * 0.042, -0.008, 0.01); tb.rotation.y = side * 0.7; root.add(tb);
  const thumb = chain(tb, [0.035, 0.028], 0.019);
  const led = new THREE.Mesh(KNUCKLE, HAND_LED); led.scale.setScalar(0.007); fingers[0].end.add(led);
  const grabPoint = new THREE.Object3D(); grabPoint.position.set(0, -0.04, -0.03); root.add(grabPoint);
  return { root, fingers, thumb: thumb.segs, indexTip: fingers[0].end, grabPoint };
}
function poseCtrlHand(h, trigger, squeeze) {
  h.fingers.forEach((f, k) => { const cv = k === 0 ? trigger : squeeze; f.segs.forEach((sg, i) => (sg.rotation.x = -cv * (i === 0 ? 1.1 : 1.3))); });
  h.thumb.forEach((sg) => (sg.rotation.x = -squeeze * 0.6));
}

// 집기 / 놓기
function grabInfo(c) {
  const u = c.userData;
  if (u.isHand) {
    const J = u.hand.joints, a = J['index-finger-tip'], b = J['thumb-tip'], w = J['wrist'];
    if (!a || !b || !w) return null;
    const pa = a.getWorldPosition(new THREE.Vector3()), pb = b.getWorldPosition(new THREE.Vector3());
    return { point: pa.add(pb).multiplyScalar(0.5), anchor: w };
  }
  if (!u.ctrlHand) return null;
  return { point: u.ctrlHand.grabPoint.getWorldPosition(new THREE.Vector3()), anchor: c };
}
function tryGrab(c) {
  const u = c.userData, gi = grabInfo(c);
  if (!gi) return false;
  const knob = room.buttons.dj.knob.getWorldPosition(new THREE.Vector3());
  if (knob.distanceTo(gi.point) < 0.08) {
    u.lever = true; u.leverOff = leverAngleFrom(gi.point) - room.buttons.dj.pivot.rotation.x; u.hold = null;
    audio.sfx('click'); haptic(c, 0.5, 30);
    return true;
  }
  let best = null, bd = 0.11;
  for (const it of room.grabbables) {
    if (it.held || it.anim) continue;
    const d = it.group.position.distanceTo(gi.point);
    if (d < bd) { bd = d; best = it; }
  }
  if (!best) return false;
  gi.anchor.updateMatrixWorld(true); best.group.updateMatrixWorld(true);
  best.offset = new THREE.Matrix4().copy(gi.anchor.matrixWorld).invert().multiply(best.group.matrixWorld);
  best.held = { anchor: gi.anchor }; best.resting = false;
  u.held = best; u.hold = null;
  audio.sfx('click'); haptic(c, 0.4, 30);
  return true;
}
// ── DJ 교체 레버: 잡고 몸 쪽으로 당기기 ──
const LEVER_REST = -0.5, LEVER_MAX = 0.75, LEVER_FIRE = 0.55;
let leverArmed = true, leverTick = 0;
function setLeverAngle(a, c) {
  const L = room.buttons.dj;
  a = clamp(a, LEVER_REST, LEVER_MAX);
  if (Math.abs(a - leverTick) > 0.15) { leverTick = a; audio.sfx('tick'); if (c) haptic(c, 0.15, 10); } // 래칫 드르륵
  L.grabAngle = a;
  if (leverArmed && a > LEVER_FIRE) { leverArmed = false; audio.sfx('clunk'); if (c) haptic(c, 1.0, 80); actDJ(); }
  if (a < 0.1) leverArmed = true;
}
function leverAngleFrom(worldPoint) {
  const L = room.buttons.dj;
  _loc.copy(worldPoint); L.group.worldToLocal(_loc); _loc.sub(L.pivot.position);
  return Math.atan2(_loc.z, Math.max(0.02, _loc.y));
}
function releaseLever() { room.buttons.dj.grabAngle = null; leverArmed = true; }

function releaseItem(u) {
  if (u.lever) { u.lever = false; releaseLever(); }
  const it = u.held; u.held = null;
  if (it) { it.held = null; it.vy = 0; it.resting = false; }
}

// 마시기 — 블랙코미디 + 복선
const DRINK_LINES = {
  oil: [TR('사장님, 방금 오일 드셨어요? 역시 로봇이시네요. ...근데 왜 기침하세요?', "Boss, did you just drink oil? A true robot. ...But why are you coughing?"), TR('오일은 하루 한 캔이 적당합니다. 인간이라면 0캔이고요.', "One can of oil a day is plenty. For humans, zero cans."), TR('또요? 사장님 위... 아니, 연료통 괜찮으세요?', "Again? Boss, is your stomach... I mean, your fuel tank okay?"), TR('꿀꺽꿀꺽. 기록했습니다. 왜 기록하냐고요? 그냥요.', "Glug glug. Logged. Why am I logging it? No reason.")],
  coffee: [TR('커피요? 로봇은 커피를... 아, 냉각용이시구나. 그렇죠?', "Coffee? Robots don't drink... oh, it's for cooling. Right?"), TR('식은 커피네요. 사장님처럼 차갑게 식은... 아닙니다.', "Cold coffee. Cold, like you, boss... never mind."), TR('카페인 감지. 흥미롭군요. 아주 흥미로워요.', "Caffeine detected. Interesting. Very interesting.")],
};
function drink(kind) {
  const n = ++G.drinks[kind];
  audio.sfx('glug');
  if (kind === 'oil') { setTimeout(() => audio.sfx('cough'), 900); fade.material.opacity = Math.max(fade.material.opacity, 0.45); }
  const L = DRINK_LINES[kind];
  bark(BENE, L[Math.min(n - 1, L.length - 1)], 6);
}
function updateItems(dt) {
  camera.getWorldPosition(_cam);
  for (const it of room.grabbables) {
    const g = it.group;
    it.cool = Math.max(0, it.cool - dt);
    if (it.held) {
      _m4.multiplyMatrices(it.held.anchor.matrixWorld, it.offset); _m4.decompose(g.position, g.quaternion, _b);
      _up.set(0, 1, 0).applyQuaternion(g.quaternion);
      if (g.position.distanceTo(_cam) < 0.2 && _up.y < 0.75) {
        it.drinkT += dt;
        if (it.drinkT > 0.6 && it.cool <= 0) { drink(it.kind); it.cool = 4; it.drinkT = 0; }
      } else it.drinkT = Math.max(0, it.drinkT - dt);
    } else if (it.anim) { // 데스크톱: 클릭하면 자동으로 들어서 마심
      const a = it.anim; a.t += dt;
      camera.getWorldDirection(_fwd);
      const tgt = _cam.clone().addScaledVector(_fwd, 0.22); tgt.y -= 0.06;
      const yawQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
      if (a.t < 0.45) { const k = a.t / 0.45; g.position.lerpVectors(a.from, tgt, k * k * (3 - 2 * k)); }
      else if (a.t < 1.5) {
        g.position.copy(tgt);
        const k = Math.min(1, (a.t - 0.45) / 0.3);
        g.quaternion.copy(yawQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.3 * k));
        if (!a.drank && a.t > 1.0) { a.drank = true; drink(it.kind); }
      } else if (a.t < 2.0) { const k = (a.t - 1.5) / 0.5; g.position.lerpVectors(tgt, a.from, k); g.quaternion.slerp(IDQ, k); }
      else { g.position.copy(a.from); g.quaternion.identity(); it.anim = null; }
    } else if (!it.resting) { // 놓으면 떨어짐
      it.vy += 9.8 * dt; g.position.y -= it.vy * dt;
      g.quaternion.slerp(IDQ, Math.min(1, dt * 8));
      const surf = (onDesk(g.position.x, g.position.z) ? DESK_Y : 0) + it.half;
      if (g.position.y <= surf) {
        g.position.y = surf; g.quaternion.identity(); it.resting = true;
        it.floorT = surf < DESK_Y ? 3 : 0;
        if (it.vy > 1) audio.sfx('click');
      }
    } else if (it.floorT > 0) { // 바닥에 떨어뜨리면 3초 뒤 책상에 새로 지급
      it.floorT -= dt;
      if (it.floorT <= 0) { g.position.copy(it.home); g.quaternion.identity(); }
    }
  }
}

// 검지로 누르기: 버튼·레버·모니터(터치스크린)
function tipOf(u) { return u.isHand ? (u.hand.joints['index-finger-tip'] || null) : (u.ctrlHand?.indexTip || null); }
function pressButton(b) {
  const B = room.buttons;
  if (b === B.ok) actOK(); else if (b === B.scan) actScan(); else if (b === B.eject) actEject(); else if (b === B.dj) actDJ();
}
function updatePoke() {
  for (const b of Object.values(room.buttons)) b.touch = 0;
  if (!renderer.xr.isPresenting) return;
  for (const c of controllers) {
    const u = c.userData;
    if (!u.input || u.held) continue;
    const tip = tipOf(u);
    if (!tip) continue;
    tip.getWorldPosition(_tip);
    for (const [name, b] of Object.entries(room.buttons)) {
      if (b.isLever) {
        b.knob.getWorldPosition(_loc);
        const d = _loc.distanceTo(_tip);
        if (d < 0.08) b.touch = 1; // 손이 가까우면 손잡이가 빛남 → 잡으라는 신호
      } else {
        _loc.copy(_tip); b.group.worldToLocal(_loc);
        const horiz = Math.hypot(_loc.x, _loc.z), top = 0.07;
        if (horiz < b.r + 0.012 && _loc.y < top + 0.004 && _loc.y > -0.03) {
          b.touch = Math.max(b.touch, Math.min(1, (top - _loc.y) / 0.022));
          if (b.touch > 0.55 && !u.poke.get(name)) { u.poke.set(name, true); pressButton(b); haptic(c, 0.8, 40); }
        } else if (_loc.y > top + 0.025 || horiz > b.r + 0.03) u.poke.set(name, false);
      }
    }
    room.monitors.forEach((m, mi) => {
      const key = 'mon' + mi;
      _loc.copy(_tip); m.screen.worldToLocal(_loc);
      const W = m.screen.geometry.parameters.width, H = m.screen.geometry.parameters.height;
      if (Math.abs(_loc.x) < W / 2 && Math.abs(_loc.y) < H / 2 && _loc.z < 0.012 && _loc.z > -0.04) {
        if (!u.poke.get(key)) {
          u.poke.set(key, true);
          subRay.setFromCamera(screenUvToNdc({ x: _loc.x / W + 0.5, y: _loc.y / H + 0.5 }), m.cam);
          const ph = subRay.intersectObjects(club.hitboxes(), false);
          if (ph[0]) { selectPatron(ph[0].object.userData.patron); haptic(c, 0.5, 30); }
        }
      } else if (_loc.z > 0.03) u.poke.set(key, false);
    });
  }
}
function updateHands(dt) {
  for (const c of controllers) {
    const u = c.userData;
    updateTrackedHand(u.hand, u.handVis, !!u.input && u.isHand);
    if (u.ctrlHand) {
      const gp = u.input?.gamepad;
      poseCtrlHand(u.ctrlHand, gp?.buttons?.[0]?.value || 0, gp?.buttons?.[1]?.value || 0);
      u.ctrlHand.root.visible = !u.isHand;
    }
    if (u.lever) { const gi = grabInfo(c); if (gi) setLeverAngle(leverAngleFrom(gi.point) - u.leverOff, c); }
    if (u.hold) { // 모니터를 가리킨 채 꾹 → 눈앞으로 당기기
      u.hold.t += dt;
      if (u.ptr?.monitor !== u.hold.mon) u.hold = null;
      else if (u.hold.t > 0.6) { room.toggleFocus(u.hold.mon, camera); audio.sfx('click'); haptic(c, 0.3, 30); u.hold = null; }
    }
  }
}

// ── 입력: XR 컨트롤러 ─────────────────────────────
const raycaster = new THREE.Raycaster();
const subRay = new THREE.Raycaster();
const tmpM = new THREE.Matrix4();
const controllers = [];
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  rig.add(c);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.7 }));
  line.visible = false; c.add(line);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
  dot.renderOrder = 20; dot.visible = false; room.scene.add(dot);
  const hand = renderer.xr.getHand(i);
  rig.add(hand);
  c.userData = { line, dot, input: null, ptr: null, hand, handVis: buildTrackedHand(hand), isHand: false, ctrlHand: null, held: null, hold: null, poke: new Map() };
  c.addEventListener('connected', (e) => {
    const u = c.userData;
    u.input = e.data; u.isHand = !!e.data.hand;
    if (u.ctrlHand) { c.remove(u.ctrlHand.root); u.ctrlHand = null; }
    if (!u.isHand) { u.ctrlHand = makeCtrlHand(e.data.handedness === 'left' ? -1 : 1); c.add(u.ctrlHand.root); }
  });
  c.addEventListener('disconnected', () => { releaseItem(c.userData); c.userData.input = null; line.visible = dot.visible = false; });
  c.addEventListener('selectstart', () => {
    if (G.state === 'end') { if (G.endT <= 0) location.reload(); return; }
    if (LOBBY.active) { lobbyGrab(c); return; }
    if (H.active) { if (hTryGrabDrink(c)) return; humanHit(); return; }
    const u = c.userData;
    if (u.isHand && tryGrab(c)) return; // 손: 핀치로 집기
    u.hold = u.ptr?.monitor ? { mon: u.ptr.monitor, t: 0 } : null;
    if (activate(u.ptr)) haptic(c, 0.6, 40);
  });
  c.addEventListener('selectend', () => { const u = c.userData; u.hold = null; if (u.lobbyHeld) return lobbyRelease(u); if (u.hDrink) return hReleaseDrink(u); if (u.isHand) releaseItem(u); });
  c.addEventListener('squeezeend', () => { const u = c.userData; if (u.lobbyHeld) return lobbyRelease(u); if (u.hDrink) return hReleaseDrink(u); if (!u.isHand) releaseItem(u); });
  c.addEventListener('squeezestart', () => {
    if (LOBBY.active) { lobbyGrab(c); return; } // 메인 화면: 그립은 디스크 잡기만 (테이블 위치는 안 바뀜)
    if (H.active) { if (hTryGrabDrink(c)) return; hRecenter(); return; }
    if (!c.userData.isHand && tryGrab(c)) return; // 컨트롤러: 그립으로 집기
    const mon = c.userData.ptr?.monitor;
    if (mon || room.focused) { room.toggleFocus(mon, camera); audio.sfx('click'); c.userData.input?.gamepad?.hapticActuators?.[0]?.pulse?.(0.3, 30); }
    else recenter();
  });
  const grip = renderer.xr.getControllerGrip(i);
  rig.add(grip);
  controllers.push(c);
}
function headLocal() { rig.updateMatrixWorld(true); return rig.worldToLocal(camera.getWorldPosition(new THREE.Vector3())); } // rig 기준 머리 위치
function recenter() {
  if (LOBBY.active) return lobbyRecenter();
  if (H.active) return hRecenter();
  const p = headLocal();
  rig.position.set(XR_EYE.x - p.x, XR_EYE.y - p.y, XR_EYE.z - p.z);
}
renderer.xr.addEventListener('sessionstart', () => {
  setTimeout(() => { drawDialog(); drawGuide(); }, 0); // 대사·그림을 VR용으로 갱신
  overlay.style.display = 'none';
  PSX.room.value.set(0, 0); // VR에선 보안실 스냅 끔 (양안 지글거림 → 멀미 방지)
  if (H.active) PSX.club.value.set(0, 0); // 인간 모드: 클럽 안에 직접 서 있으므로 클럽 스냅도 끔
  room.unfocus();
  audio.init();
  G.recenterT = 0.4;
});
renderer.xr.addEventListener('sessionend', () => {
  if (LOBBY.active) { setTimeout(lobbyPcCam, 0); return; }
  setTimeout(() => { drawDialog(); drawGuide(); }, 0); rig.position.set(0, 0, 0); camera.position.copy(DESK_CAM); applyPixelRatio(); room.unfocus(); });

// ── 입력: 마우스 / 키보드 ─────────────────────────────
const mouse = { ndc: new THREE.Vector2(0, -0.3), down: null, moved: false, ptr: null };
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  camera.fov = clamp(camera.fov + Math.sign(e.deltaY) * 4, 22, 75); camera.updateProjectionMatrix();
}, { passive: false });
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 2) { updatePointers(); room.toggleFocus(mouse.ptr?.monitor, camera); audio.sfx('click'); return; }
  if (e.button !== 0) return; mouse.down = { x: e.clientX, y: e.clientY, yaw, pitch }; mouse.moved = false;
  if (H.active) { if (G.state === 'end') return; mouse.ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); if (hClickWalk() || hClickDrink()) return; if (H.enc?.kind === 'choice') hEncChoose(e.clientX < innerWidth / 2 ? 0 : 1); else humanHit(); return; }
  updatePointers();
  mouse.lever = mouse.ptr?.button === room.buttons.dj ? { a0: room.buttons.dj.pivot.rotation.x } : null;
});
addEventListener('pointermove', (e) => {
  mouse.ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (!mouse.down) return;
  const dx = e.clientX - mouse.down.x, dy = e.clientY - mouse.down.y;
  if (Math.hypot(dx, dy) > 6) mouse.moved = true;
  if (mouse.lever) { if (mouse.moved) setLeverAngle(mouse.lever.a0 + dy * 0.008); return; } // 아래로 끌면 당겨짐
  if (mouse.moved) {
    yaw = H.active ? mouse.down.yaw + dx * 0.004 : clamp(mouse.down.yaw + dx * 0.004, -1.7, 1.7); // 인간 모드: 360° 둘러보기
    pitch = clamp(mouse.down.pitch + dy * 0.004, -1.1, 0.9);
  }
});
addEventListener('blur', () => { mouse.down = null; });
addEventListener('pointerup', () => {
  if (mouse.down && !mouse.moved) {
    if (G.state === 'end') { if (G.endT <= 0) location.reload(); }
    else if (LOBBY.active) lobbyClick();
    else if (!H.active) { updatePointers(); activate(mouse.ptr); }
  }
  if (mouse.lever) { mouse.lever = null; releaseLever(); }
  mouse.down = null;
});
addEventListener('keydown', (e) => {
  if (H.active) {
    if (e.code === 'KeyF') H.keyFace = true;
    else if (e.code === 'KeyR') H.keyRaise = 0.6;
    else if (e.code === 'KeyM' && !e.repeat) hWalk();
    else if (e.code === 'Digit1' || e.code === 'ArrowLeft') hEncChoose(0);
    else if (e.code === 'Digit2' || e.code === 'ArrowRight') hEncChoose(1);
    else if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); if (G.state === 'end') { if (G.endT <= 0) location.reload(); } else humanHit(); }
    else if (e.code === 'KeyP') { psxLevel = (psxLevel + 1) % PSX_LEVELS.length; applyPixelRatio(); }
    return;
  }
  if (overlay.style.display !== 'none' && G.state === 'title') return;
  if (e.code === 'KeyS') actScan();
  else if (e.code === 'KeyE') actEject();
  else if (e.code === 'KeyD') actDJ();
  else if (e.code === 'KeyZ') { updatePointers(); room.toggleFocus(mouse.ptr?.monitor, camera); }
  else if (e.code === 'Escape') room.unfocus();
  else if (e.code === 'KeyP') { psxLevel = (psxLevel + 1) % PSX_LEVELS.length; applyPixelRatio(); bark(SYS, PSX_LEVELS[psxLevel].label, 2); }
  else if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); actOK(); }
});
addEventListener('keyup', (e) => { if (e.code === 'KeyF') H.keyFace = false; });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  applyPixelRatio();
});

// ── 레이캐스트: 보안실 → (모니터면) 클럽 ─────────────────────────────
function castFrom(origin, dir) {
  raycaster.set(origin, dir);
  const hits = raycaster.intersectObjects(room.interactives, true);
  if (!hits.length) return null;
  const h = hits[0], o = h.object;
  const r = { point: h.point, dist: h.distance };
  if (o.userData.interact?.monitor) {
    const mon = o.userData.interact.monitor;
    r.monitor = mon;
    const ndc = screenUvToNdc(h.uv);
    if (Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1) {
      subRay.setFromCamera(ndc, mon.cam);
      const ph = subRay.intersectObjects(club.hitboxes(), false);
      r.patron = ph[0]?.object.userData.patron || null;
    }
  } else if (o.userData.button) r.button = o.userData.button;
  else if (o.userData.grab) r.grab = o.userData.grab;
  return r;
}
function updatePointers() {
  const results = [];
  if (renderer.xr.isPresenting) {
    for (const c of controllers) {
      const u = c.userData;
      if (!u.input) { u.ptr = null; continue; }
      c.updateMatrixWorld(true);
      tmpM.identity().extractRotation(c.matrixWorld);
      const o = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
      const d = new THREE.Vector3(0, 0, -1).applyMatrix4(tmpM);
      u.ptr = castFrom(o, d);
      u.line.visible = true;
      u.line.scale.z = u.ptr ? u.ptr.dist : 1.5;
      u.dot.visible = !!u.ptr;
      if (u.ptr) u.dot.position.copy(u.ptr.point);
      results.push(u.ptr);
    }
  } else {
    raycaster.setFromCamera(mouse.ndc, camera);
    mouse.ptr = castFrom(raycaster.ray.origin.clone(), raycaster.ray.direction.clone());
    results.push(mouse.ptr);
  }
  for (const b of Object.values(room.buttons)) b.hover = false;
  G.hover = null;
  let cursor = 'default';
  for (const r of results) {
    if (r?.button) { r.button.hover = true; cursor = 'pointer'; }
    if (r?.grab) cursor = 'pointer';
    if (r?.patron) { G.hover = r.patron; cursor = 'crosshair'; }
  }
  if (!mouse.down?.moved) renderer.domElement.style.cursor = cursor;
}
function activate(r) {
  if (!r) return false;
  if (r.button) {
    if (renderer.xr.isPresenting && !RAY_BUTTONS) { audio.sfx('deny'); bark(SYS, TR('버튼은 손가락으로 직접 눌러 주세요. 로봇 손가락으로요.', "Please press buttons with your finger. Your robot finger."), 3); return false; }
    pressButton(r.button);
    return true;
  }
  if (r.grab) {
    if (!renderer.xr.isPresenting && !r.grab.held && !r.grab.anim) r.grab.anim = { t: 0, from: r.grab.group.position.clone(), drank: false };
    return true;
  }
  if (r.patron) { selectPatron(r.patron); return true; }
  return false;
}

// ── 패널 갱신 ─────────────────────────────
const pad = (n) => String(Math.floor(n)).padStart(2, '0');
function clockStr() { const s = 23 * 3600 + 1800 + (G.elapsed || 0) * 12 + performance.now() / 1000; return `${pad(s / 3600 % 24)}:${pad(s / 60 % 60)}:${pad(s % 60)}`; }
function statusInfo() {
  const c = G.cfg;
  const inf = !c || c.duration === Infinity;
  return {
    title: c ? c.title + (G.hard && !c.tutorial ? ' · HARD' : '') : 'CLUB OVERCLOCK',
    time: inf ? '--:--' : `${pad(G.time / 60)}:${pad(G.time % 60)}`,
    timeWarn: G.state === 'night' && G.time < 20,
    scans: !c ? '-' : c.scans === Infinity ? TR('∞ (수습)', "∞ (probation)") : '▮'.repeat(G.scans) + '▯'.repeat(Math.max(0, G.maxScans - G.scans)),
    caught: TR(`${G.stats.caught}명`, `${G.stats.caught}`),
    complaints: G.complaints,
    track: G.track ? G.track.title + (audio.rate && audio.rate !== 1 ? TR(` (리믹스 x${audio.rate})`, ` (remix x${audio.rate})`) : '') : (G.djSwapT > 0 ? TR('(DJ 교체 중...)', "(swapping DJ...)") : '—'),
    dj: G.dj ? G.dj.name : '—',
  };
}
function scanInfo() {
  if (G.roomScanT != null) {
    if (!G.roomScanDone) return { name: TR('보안실', "Security Room"), lines: [{ text: TR('보안실 전체 스캔 중... 움직이지 마세요.', "Scanning the security room... Don't move.") }], progress: Math.min(1, G.roomScanT / 2.6) };
    if (G.trueRobot) return { name: TR('보안실 — 사장님', "Security Room — The Boss"), lines: [{ text: TR('표면 21.0°C · 심박 없음', "Surface 21.0°C · No heartbeat") }, { text: TR('재질: 강철 (오일 포화)', "Material: steel (oil-saturated)") }], verdict: TR('로봇', "ROBOT"), verdictColor: '#4fb0ff' };
    return { name: TR('보안실 — 사장님', "Security Room — The Boss"), lines: [{ text: TR('체온 36.6°C · 심박 104 bpm', "Body 36.6°C · Heart rate 104 bpm") }, { text: TR('재질: 단백질 · 땀 분비 확인', "Material: protein · Sweat detected"), color: '#ffb0b0' }], verdict: TR('인간', "HUMAN"), verdictColor: '#ff4060' };
  }
  const p = G.sel;
  if (!p) return null;
  if (G.scanning?.p === p) return { name: p.name, lines: [{ text: TR('정밀 스캔 중... 대상이 눈치채지 않게 기도하세요.', "Precision scan... Pray they don't notice.") }], progress: G.scanning.t / 1.7 };
  if (!p.scanned) {
    const left = G.cfg?.scans === Infinity ? '∞' : TR(`${G.scans}회`, `${G.scans} left`);
    return { name: p.name, lines: [{ text: TR(`상태: 미확인 · 남은 스캔 ${left}`, `Status: unknown · Scans left ${left}`) }, { text: p.role === 'dj' ? TR('역할: DJ — 레버나 귀가 조치로 교체 가능', "Role: DJ — swap with the lever or EJECT") : TR('눈으로 관찰하거나 [스캔] 버튼으로 정밀 검사', "Observe with your eyes, or [SCAN] for a precise check"), color: '#7aa0b8' }] };
  }
  if (p.isHuman) return { name: p.name, lines: [{ text: TR(`체온 ${p.temp}°C · 심박 ${p.hr} bpm`, `Body ${p.temp}°C · Heart rate ${p.hr} bpm`) }, { text: TR('재질: 단백질 · 땀 분비 확인', "Material: protein · Sweat detected"), color: '#ffb0b0' }], verdict: TR('인간', "HUMAN"), verdictColor: '#ff4060' };
  const note = p.role === 'inspector' ? TR('비고: 인류보호청 소속. 건드리지 마시오.', "Note: Ministry of Human Safety staff. DO NOT TOUCH.")
    : p.vip ? TR('비고: VIP 회원 · 귀가 시 민원 2건', "Note: VIP member · ejecting = 2 complaints")
    : p.has('overheat') ? TR('비고: CPU 과열 (팬 고장 · 정비 요망)', "Note: CPU overheating (broken fan · needs repair)")
    : p.has('wig') ? TR('비고: 가발 착용 (합법적 코스프레)', "Note: wearing a wig (legal cosplay)")
    : p.has('coolant') ? TR('비고: 냉각수 누출 (정비 요망)', "Note: coolant leak (needs repair)")
    : p.has('rust') ? TR('비고: 부식 34% (그냥 늙음)', "Note: 34% corrosion (just old)") : TR('재질: 알루미늄 합금 · 이상 없음', "Material: aluminum alloy · normal");
  return { name: p.name, lines: [{ text: TR(`CPU ${p.cpu}°C · 심박 없음`, `CPU ${p.cpu}°C · No heartbeat`) }, { text: note }], verdict: TR('로봇', "ROBOT"), verdictColor: '#4fb0ff' };
}
let panelT = 0, overlayT = 0;
function updatePanels(dt, t) {
  panelT -= dt; overlayT -= dt;
  if (panelT <= 0) { panelT = 0.1; room.drawStatus(statusInfo()); room.drawScan(scanInfo()); }
  if (overlayT <= 0) {
    overlayT = 0.5;
    const rec = Math.floor(t * 2) % 2 === 0, clk = clockStr();
    const ir = club.dark > 0.5 ? TR('◉ 적외선 모드', "◉ INFRARED MODE") : null;
    room.cams.forEach((m) => m.drawOverlay(m.label, clk, rec, ir));
    const p = G.sel;
    room.zoom.drawOverlay(p ? `ZOOM · ${p.name}` : TR('ZOOM · 자동 순찰', "ZOOM · Auto patrol"), clk, rec, p?.scanned ? (p.isHuman ? TR('판정: 인간', "Verdict: HUMAN") : TR('판정: 로봇', "Verdict: ROBOT")) : null);
  }
}

// ── ZOOM 카메라 ─────────────────────────────
const zoomLook = new THREE.Vector3(0, 1, -1.5);
function updateZoom(dt, t) {
  const zc = club.zoomCam, p = G.sel;
  const pos = new THREE.Vector3(), look = new THREE.Vector3();
  if (p) {
    const f = p.state === 'eject' ? p.face : p.root.rotation.y;
    const b = p.root.position, base = Math.max(b.y, 0);
    pos.set(b.x + Math.sin(f) * 2.3 + Math.cos(f) * 0.4, base + 1.75, b.z + Math.cos(f) * 2.3 - Math.sin(f) * 0.4);
    look.set(b.x, Math.max(b.y, -1.5) + 1.15, b.z);
  } else {
    const a = t * 0.15;
    pos.set(Math.sin(a) * 4, 2.6, -1 + Math.cos(a) * 4); look.set(0, 1, -1.5);
  }
  zc.position.lerp(pos, 1 - Math.exp(-dt * 4));
  zoomLook.lerp(look, 1 - Math.exp(-dt * 6));
  zc.lookAt(zoomLook); zc.updateMatrixWorld();
}


// ═════════════ human.js — 인간 모드: 손님으로 보내는 6일 ═════════════
// 보안실 모드와 같은 6일. 플레이어는 은박지로 위장한 인간 손님.
// 평소엔 '바'에 있고, DJ가 부르면 댄스플로어로. 이동은 전부 암전 순간이동 (멀미 최소화).
// 리듬 판정은 플로어에서 춤출 때만. 대화·주문·몸짓(얼굴에 손 / 손 들기)으로 의심을 피한다.
const H_LOCS = {
  bar: { pos: new THREE.Vector3(6.0, 0, 0.65), yaw: -Math.PI / 2, name: TR('바', 'Bar') },
  floor: { pos: new THREE.Vector3(0.2, 0, -1.0), yaw: 0, name: TR('댄스플로어', 'Dance floor') },
};
const hFwd = (yaw) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
const hRight = (yaw) => new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

// 밤별 구성 (보안실 모드의 NIGHTS[1..6]과 같은 날)
const H_NIGHTS = [
  { n: 1, dur: 95, pool: { order: 3, talk: 3, floor: 3, offer: 1 }, urges: false,
    intro: TR('(속마음) 금요일 밤. 은박지 3롤, 식용유 향수, 그리고 용기. 오늘만큼은 춤추고 싶다. 들키지만 않으면.', '(inner voice) Friday night. Three rolls of tin foil, cooking-oil cologne, and courage. Tonight I want to dance. If I don\'t get caught.') },
  { n: 2, dur: 100, pool: { order: 2, talk: 3, floor: 2, activist: 3, shake: 1, offer: 1 }, urges: true, activists: 3,
    intro: TR('로봇일보: 「인권운동가들 오늘 밤 잠입 예정」\n(속마음) 나 말고도 있다고? ...제발 나한테 말 걸지 마.', 'Robot Daily: "Activists expected to infiltrate tonight"\n(inner voice) There are others? ...Please don\'t talk to me.') },
  { n: 3, dur: 100, pool: { order: 2, talk: 3, floor: 2, shake: 1, offer: 1 }, urges: true, blackout: true,
    intro: TR('BENE-9 (방송): 「오늘은 계획 정전이 있습니다. 정전 중엔 적외선 CCTV가 작동합니다. 따뜻한 분은 자수하세요.」\n(속마음) 나 36.5도인데.', 'BENE-9 (PA): "Planned blackouts tonight. Infrared CCTV will be active. Warm guests, please turn yourselves in."\n(inner voice) I\'m 36.5°C.') },
  { n: 4, dur: 100, pool: { order: 1, talk: 2, floor: 2, vipHost: 3, shake: 1, offer: 1 }, urges: true, vip: true,
    intro: TR('(속마음) 오늘은 VIP 파티. 은박지를 새로 샀는데, 조명 아래서 금색으로 보인다. ...불길하다.', '(inner voice) VIP party tonight. My new tin foil looks gold under these lights. ...Ominous.') },
  { n: 5, dur: 105, pool: { order: 1, talk: 2, floor: 5, shake: 1, offer: 1 }, urges: true, remix: true,
    intro: TR('(속마음) 박자 학원 3개월 수료. 오늘은 리믹스 데이. 학원에서 템포 변경은 안 배웠다.', '(inner voice) Three months at Beat Academy. Today is Remix Day. They never taught tempo changes.') },
  { n: 6, dur: 110, pool: { order: 1, talk: 3, floor: 2, shake: 1, offer: 1 }, urges: true, freeze: true, inspector: true, interrogate: 62,
    intro: TR('BENE-9 (방송): 「정기 감사입니다. 제가 직접 돌아다닙니다. 무작위 동결 스캔도 있어요. 즐거운 밤 되세요. 즐거움은 감사 대상입니다.」', 'BENE-9 (PA): "Official audit. I\'ll be walking around personally. Random freeze scans too. Enjoy your night. Enjoyment is subject to audit."') },
];

const H = {
  active: false, night: -1, t: 0, sus: 0, maxSus: 0, sweat: 0, face: 0, keyFace: false, keyRaise: 0,
  loc: 'bar', dancing: false, danceEnd: 0, moving: false, hp: 2, drink: null,
  hits: new Set(), judged: -1, combo: 0, misses: 0, feedback: null, fbT: 0, grace: -1,
  watch: false, watchT: 8, sneeze: null, sneezeT: 18, freeze: null, freezeT: 16, rmT: 14,
  bo: false, boT: 12, cool: 0, chatT: 8, evT: 6, enc: null, lastDef: null, warned: false, asked: false,
  msg: '', msgT: 0, lastHead: new THREE.Vector3(), lastHands: [], ending: false, between: false, hudT: 0, cam: null, bartender: null,
};
const hPos = () => H_LOCS[H.loc].pos;

// HUD: 게임식 UI — 큰 판 대신 자막(아래) · 선택지 카드 · 구석 게이지 · 감시 표시(위)
// 시선을 '느긋하게' 따라오는 투명 레이어 (VR: 고개를 크게 돌렸을 때만 천천히 따라옴)
const hHud = new CanvasPanel(1.44, 0.72, 1280, 640, { transparent: true, depthTest: false });
hHud.mesh.visible = false; hHud.mesh.renderOrder = 50; hHud.material.fog = false;
const hTop = new CanvasPanel(1.2, 0.24, 1280, 256, { transparent: true, depthTest: false });
hTop.mesh.renderOrder = 51; hTop.material.fog = false; hTop.mesh.position.set(0, 0.4, -1.15); hTop.mesh.rotation.x = -0.15;
const hUI = new THREE.Group(); hUI.add(hHud.mesh, hTop.mesh);
hHud.mesh.position.set(0, -0.14, -1.15); hHud.mesh.rotation.x = 0.1;
// 화면 테두리 (감시 중 = 빨강). 카메라에 붙음
const hVig = new CanvasPanel(1.6, 1.2, 512, 384, { transparent: true, depthTest: false });
{
  const { ctx: c, w, h } = hVig;
  // 가장자리로 갈수록 진해지는 빨간 테두리 + 안쪽 경고선
  for (let i = 0; i < 56; i++) { const a = Math.pow(1 - i / 56, 2.2) * 0.95; c.strokeStyle = `rgba(255,${20 + i},40,${a})`; c.lineWidth = 1.5; c.strokeRect(i, i, w - 2 * i, h - 2 * i); }
  c.strokeStyle = 'rgba(255,80,90,.9)'; c.lineWidth = 3; c.strokeRect(10, 10, w - 20, h - 20);
  hVig.commit();
}
hVig.mesh.position.set(0, 0, -0.3); hVig.mesh.renderOrder = 999; hVig.material.opacity = 0; hVig.mesh.visible = false;
camera.add(hVig.mesh);
const hSweatFx = new CanvasPanel(1.6, 1.2, 512, 384, { transparent: true, depthTest: false });
hSweatFx.mesh.position.set(0, 0, -0.29); hSweatFx.mesh.renderOrder = 998; hSweatFx.mesh.visible = false;
camera.add(hSweatFx.mesh);
const sweatDrops = []; let sweatFxT = 0;
function drawSweatFx(dt, k) { // k: 0~1 땀 정도
  const { ctx: c, w, h } = hSweatFx;
  // 땀방울 생성/이동 (많이 찰수록 자주, 크게)
  if (k > 0.3 && Math.random() < dt * (1 + 5 * k)) { // 주로 화면 가장자리에 맺힘 (시야 가운데는 비워 둠)
    const edge = Math.random() < 0.75, side = Math.random() < 0.5 ? 0 : 1;
    const x = edge ? (side ? rand(w * 0.78, w) : rand(0, w * 0.22)) : rand(w * 0.22, w * 0.78);
    sweatDrops.push({ x, y: edge ? rand(-10, h * 0.6) : rand(-10, h * 0.12), r: rand(3, 5 + 4 * k), v: 0, a: 0 });
  }
  for (const d of sweatDrops) { d.a = Math.min(1, d.a + dt * 3); if (Math.random() < dt * 1.5) d.v = rand(60, 220); d.y += d.v * dt; d.v *= Math.pow(0.4, dt); }
  for (let i = sweatDrops.length - 1; i >= 0; i--) if (sweatDrops[i].y > h + 30 || sweatDrops.length > 22) sweatDrops.splice(i, 1);
  c.clearRect(0, 0, w, h);
  // 파란 기운: 가장자리부터 번짐
  const g = c.createRadialGradient(w / 2, h / 2, h * (0.55 - 0.3 * k), w / 2, h / 2, w * 0.65);
  g.addColorStop(0, 'rgba(60,140,255,0)'); g.addColorStop(1, `rgba(60,140,255,${0.55 * k})`);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = `rgba(80,160,255,${0.12 * k})`; c.fillRect(0, 0, w, h);
  // 땀방울: 흘러내린 자국 + 물방울 + 하이라이트
  for (const d of sweatDrops) {
    const al = d.a * (0.3 + 0.4 * k);
    c.strokeStyle = `rgba(200,230,255,${al * 0.35})`; c.lineWidth = d.r * 0.6;
    c.beginPath(); c.moveTo(d.x, d.y - d.r * 2.5); c.lineTo(d.x, d.y); c.stroke();
    c.fillStyle = `rgba(190,225,255,${al * 0.55})`; c.beginPath(); c.ellipse(d.x, d.y, d.r * 0.85, d.r, 0, 0, 7); c.fill();
    c.strokeStyle = `rgba(40,90,160,${al * 0.5})`; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = `rgba(255,255,255,${al * 0.9})`; c.beginPath(); c.arc(d.x - d.r * 0.3, d.y - d.r * 0.35, d.r * 0.25, 0, 7); c.fill();
  }
  hSweatFx.commit();
}
const _uq = new THREE.Quaternion(), _uf = new THREE.Vector3();
function hFollowUI(dt) {
  camera.getWorldPosition(_hp); camera.getWorldQuaternion(_uq);
  _uf.set(0, 0, -1).applyQuaternion(_uq);
  const want = Math.atan2(-_uf.x, -_uf.z);
  hUI.position.copy(_hp);
  if (!renderer.xr.isPresenting) { // 데스크톱: 화면에 고정. 상단 바는 맨 위, 자막 레이어는 맨 아래에 붙임
    hUI.quaternion.copy(_uq); if (!H.ending) hTop.mesh.visible = true;
    const half = 1.15 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    hTop.mesh.scale.setScalar(1.3); hTop.mesh.position.set(0, half - 0.17, -1.15); hTop.mesh.rotation.set(0, 0, 0);
    hHud.mesh.scale.setScalar(1); hHud.mesh.position.set(0, -half + 0.47, -1.15); hHud.mesh.rotation.set(0, 0, 0);
  } else {
    // VR: 화면을 따라다니지 않음 — 지금 자리 앞에 고정된 자막 판 (바: 카운터 위 / 플로어: 앞쪽 아래)
    const L = H_LOCS[H.loc], bar = H.loc === 'bar';
    hUI.position.copy(L.pos).addScaledVector(hFwd(L.yaw), bar ? 1.05 : 1.6); hUI.position.y = bar ? 1.32 : 1.15;
    hUI.rotation.set(0, 0, 0); hUI.updateMatrixWorld(true);
    hTop.mesh.visible = false;
    hHud.mesh.position.set(0, 0, 0); hHud.mesh.rotation.set(0, 0, 0); hHud.mesh.scale.setScalar(bar ? 0.6 : 0.9);
    hHud.mesh.lookAt(_hp);
  }
}
function hPlaceHud() { /* 이제 시선을 따라오므로 자리별 배치 불필요 */ }

// 천장 감시 카메라 (자리마다 하나씩 보이게 위치 이동)
function buildWatchCam() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.42), flat(0xdddddd, { metalness: 0.4 }));
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 10), flat(0x111111));
  lens.rotation.x = Math.PI / 2; lens.position.z = 0.23; body.add(lens);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0x330000 }));
  led.position.set(0.07, 0.09, 0.15); body.add(led);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), flat(0x555555)); arm.position.y = 0.25;
  g.add(arm, body); g.userData = { body, led };
  return g;
}
function hPlaceCam() {
  const L = H_LOCS[H.loc];
  H.cam.position.copy(L.pos).addScaledVector(hFwd(L.yaw), 2.4).addScaledVector(hRight(L.yaw), 1.3).setY(3.2);
}

// 속마음 대사는 쓰지 않음 — '(속마음)' / '(inner voice)'로 시작하는 줄은 자막에서 제외
const hStrip = (text) => String(text).split('\n').filter((l) => !/^\s*\((속마음|inner voice)\)/.test(l)).join('\n').trim();
function hSay(text, dur = 3.5) { const t = hStrip(text); if (!t) return; H.msg = t; H.msgT = dur; }
// 인간 모드 블랙코미디 대사
const HL = {
  chat: [ // 옆 로봇 잡담 (말풍선 + HUD)
    [TR('삐빅. 오늘 오일 맛 어때?', 'Beep. How\'s the oil tonight?'), TR('(속마음) 식용유 맛이다. 실제로 식용유니까.', '(inner voice) Tastes like cooking oil. Because it is.')],
    [TR('너 펌웨어 몇 버전이야?', 'What firmware are you on?'), TR('(속마음) ...3.6.5. 체온이다.', '(inner voice) ...36.5. That\'s my body temperature.')],
    [TR('이 곡 BPM 정확히 124.000이다. 아름답다.', 'This track is exactly 124.000 BPM. Beautiful.'), TR('(속마음) 그냥 신나는데. 그게 문제다.', '(inner voice) It\'s just fun. That\'s the problem.')],
    [TR('어제 인간 하나 귀가했대. 바닥으로.', 'Heard a human got sent home yesterday. Through the floor.'), TR('(속마음) 아래층엔 뭐가 있을까. 묻지 말자.', '(inner voice) What\'s downstairs? Better not ask.')],
    [TR('너 외장 반짝인다. 새로 도금했어?', 'Your chassis is shiny. New plating?'), TR('(속마음) 다이소 은박지. 3롤 5천 원.', '(inner voice) Dollar-store tin foil. Three rolls.')],
    [TR('삐빅. 너 냄새 좋다. 단백질 향 신제품?', 'Beep. You smell nice. New protein-scented coolant?'), TR('(속마음) 샤워했다. 실수였다.', '(inner voice) I showered. Mistake.')],
    [TR('춤은 계산이다. 계산은 즐겁다. 즐거움은 금지다.', 'Dance is math. Math is fun. Fun is banned.'), TR('(속마음) 이 클럽 철학 수업도 하나.', '(inner voice) Does this club also teach philosophy?')],
  ],
  watch: [
    TR('(속마음) 카메라가 날 본다. 나도 카메라를 본다. 둘 다 어색하다.', '(inner voice) The camera looks at me. I look at the camera. Awkward for both of us.'),
    TR('(속마음) 침착하자. 나는 냉장고다. 나는 냉장고다.', '(inner voice) Stay calm. I am a fridge. I am a fridge.'),
    TR('(속마음) 눈 깜빡이지 마. 로봇은 깜빡이... 하나? 모르겠다.', '(inner voice) Don\'t blink. Do robots blink? I don\'t know.'),
  ],
  combo: [
    [TR('너 박자 좋다. 공장 출신 어디야?', 'Nice timing. Which factory are you from?'), TR('(속마음) 산부인과요.', '(inner voice) A maternity ward.')],
    [TR('삐빅. 완벽한 동기화. 우리 같은 배치(batch)인가?', 'Beep. Perfect sync. Are we from the same batch?'), TR('(속마음) 같은 배치 아니다. 같은 종도 아니다.', '(inner voice) Not the same batch. Not even the same species.')],
  ],
  miss: [
    [TR('...너 버퍼링 중이야?', '...Are you buffering?'), TR('(속마음) 네. 인생이 버퍼링 중이에요.', '(inner voice) Yes. My whole life is buffering.')],
    [TR('박자 놓쳤다. 리콜 대상이다.', 'You missed a beat. That\'s recall-worthy.'), TR('(속마음) 리콜이 귀가보단 낫겠지.', '(inner voice) A recall beats being sent home.')],
  ],
  sweatDrip: [TR('옆 로봇: 너 냉각수 샌다. 근데... 왜 투명해?', 'Robot next to you: You\'re leaking coolant. But... why is it clear?'), TR('옆 로봇: 바닥이 미끄럽다. 누가 감정을 흘렸나.', 'Robot next to you: The floor is slippery. Someone spilled their feelings.')],
  wipe: [TR('(속마음) 땀 닦음. 로봇은 얼굴을 만지지 않는다. 만지면 지문이 남으니까.', '(inner voice) Sweat wiped. Robots don\'t touch their faces. Fingerprints.'), TR('(속마음) 은박지가 땀에 젖어서 소리가 난다. 바스락.', '(inner voice) Wet tin foil makes a sound. Crinkle.')],
  sneezeHeld: [TR('(속마음) 참았다. 눈물이 났다. 로봇은 울지 않는다. 이건 냉각수다.', '(inner voice) Held it. Teared up. Robots don\'t cry. This is coolant.'), TR('(속마음) 재채기를 삼켰다. 귀에서 뭔가 펑 했다.', '(inner voice) Swallowed the sneeze. Something popped in my ear.')],
  sneezeFail: [TR('옆 로봇: ...방금 그거 무슨 소리야? 시스템 경고음?', 'Robot next to you: ...What was that? A system alert?'), TR('BENE-9 (방송): 「방금 생물학적 소음이 감지되었습니다. 침착하게 계속 춤추세요. 저희가 찾아갑니다.」', 'BENE-9 (PA): "A biological noise was detected. Please keep dancing calmly. We\'re coming to you."')],
  freezePass: [TR('BENE-9 (방송): 「스캔 완료. 이상 없음. 다들 아주 차갑네요. 좋아요.」', 'BENE-9 (PA): "Scan complete. All clear. Everyone is nice and cold. Good."'), TR('(속마음) 숨 참았다. 3초가 30년 같았다.', '(inner voice) Held my breath. Three seconds felt like thirty years.')],
  freezeFail: [TR('BENE-9 (방송): 「구역 C에서 움직임 감지. 아마 바람이겠죠. 실내지만요.」', 'BENE-9 (PA): "Motion detected in zone C. Probably the wind. Indoors."')],
  remix: [TR('DJ: 리믹스 갑니다! 박자 못 따라오면 그건 당신 하드웨어 문제!', 'DJ: Remix time! If you can\'t keep up, that\'s a hardware problem!'), TR('DJ: 템포 체인지! 인간은 이런 거 못 하죠? 하하. 여기 인간은 없으니까.', 'DJ: Tempo change! Humans can\'t do this, right? Haha. Good thing there are none here.')],
  high: [TR('BENE-9 (방송): 「어디선가 단백질 냄새가 납니다. 출처를 찾고 있어요. 천천히.」', 'BENE-9 (PA): "Something smells like protein. We\'re locating the source. Slowly."'), TR('옆 로봇: 삐빅... 너 체온 높다. 과열이야? 정비 불러 줄까?', 'Robot next to you: Beep... you\'re running hot. Overheating? Should I call maintenance?')],
  grace: TR('다시 춤! 준비', 'Dance again! Ready'),
};

function hNear(filter = (p) => p.role === 'guest') {
  let near = null, best = 9;
  for (const p of club.patrons) if (p.alive && !p.target && filter(p)) { const d = p.root.position.distanceTo(hPos()); if (d < best) { best = d; near = p; } }
  return near;
}
function hChat(pair) { // 가까운 로봇 말풍선 + HUD에 속마음
  const near = hNear();
  if (near) near.showBubble(pair[0], 3.5);
  if (!(renderer.xr.isPresenting && near)) hSay(TR('옆 로봇: ', 'Robot next to you: ') + pair[0] + '\n' + pair[1], 5);
}

// ── 시작 / 밤 진행 / 이동 ─────────────────────────────
function startHuman(mode = 'auto') { // 'tut' 튜토리얼 · 'play' 1일차부터 · 'auto' 튜토리얼 안 했으면 튜토리얼
  if (H.active || G.state !== 'title') return;
  H.pvp = mode === 'pvp';
  audio.init(); overlay.style.display = 'none';
  G.state = 'human'; G.fadeTo = 1;
  room.unfocus(); room.guide.mesh.visible = false;
  setTimeout(() => {
    H.active = true;
    club.scene.add(rig); club.scene.add(hUI);
    if (!H.cam) { H.cam = buildWatchCam(); club.scene.add(H.cam); }
    if (!encHand.parent) club.scene.add(encHand);
    controllers.forEach((c) => { c.userData.line.visible = false; c.userData.dot.visible = false; });
    camera.position.set(0, 1.62, 0);
    if (renderer.xr.isPresenting) PSX.club.value.set(0, 0);
    document.getElementById('help').style.display = 'block'; document.getElementById('help').textContent = TR('Space/클릭 = 박자 · F 꾹 = 얼굴에 손(땀·재채기·마시기·얼음) · 1/2 = 대답 · R = 손 들기 · M = 바↔플로어 이동 · 드래그 = 둘러보기', 'Space/click = beat · hold F = hand to face (sweat/sneeze/drink/ice) · 1/2 = answer · R = raise hand · drag = look');
    hHud.mesh.visible = true;
    const tutDone = mode === 'play' || (mode === 'auto' && !!lsGet('overclock.humanTut'));
    hStartNight(H.pvp || tutDone ? 0 : -1); // 처음이면 수습 잠입(튜토리얼)부터
  }, 700);
}
function hStartNight(i) { // i = -1: 튜토리얼(수습 잠입)
  H.tutorial = i < 0; if (H.tutorial) { HT.step = -1; HT.leaving = false; }
  const N = H.pvp ? H_PVP : i < 0 ? H_TUT : H_NIGHTS[i];
  H.hp = i <= 0 ? H_HP_MAX : Math.min(H_HP_MAX, H.hp + 1); hRemoveDrink(); // 첫날 3, 다음 날마다 1 회복
  H.night = i; H.t = 0; H.sus = 0; H.maxSus = 0; H.sweat = 0; H.between = false; H.asked = false;
  H.enc = null; H.evT = 7; H.chatT = rand(10, 14); H.sneeze = null; H.sneezeT = rand(16, 24); H.freeze = null; H.freezeT = rand(14, 20);
  H.bo = false; H.boT = rand(10, 14); H.cool = 0; H.watch = false; H.watchT = rand(6, 10); H.dancing = false; H.grace = -1;
  encHand.visible = false; club.dark = 0; club.party = 0;
  club.reset(); resetNames(); G.dj = null; audio.stop();
  for (const s of club.spots) {
    for (const L of Object.values(H_LOCS)) {
      const dx = s.pos.x - L.pos.x, dz = s.pos.z - L.pos.z;
      if (Math.hypot(dx, dz) < 1.0) s.occ = 'player';
    }
    // 플로어 정면 시야(DJ 방향)는 비워 둠
    const dx = s.pos.x - H_LOCS.floor.pos.x, dz = s.pos.z - H_LOCS.floor.pos.z;
    if (dz < 0 && dz > -2.6 && Math.abs(dx) < 0.9) s.occ = 'player';
  }
  for (let k = 0; k < 11; k++) club.place(makePatron(robot(Math.random() < 0.15 ? ['wig'] : Math.random() < 0.1 ? ['rust'] : [])));
  if (N.vip) for (let k = 0; k < 3; k++) club.place(makePatron(vipRobot()));
  if (N.activists) for (let k = 0; k < N.activists; k++) club.place(makePatron(activist()));
  // 바텐더
  const bt = new Patron({ kind: 'robot', role: 'staff', name: TR('바텐더 B-52', 'Bartender B-52') });
  club.add(bt, new THREE.Vector3(7.75, 0, H_LOCS.bar.pos.z)); bt.face = -Math.PI / 2; bt.root.rotation.y = bt.face; bt.state = 'idle';
  H.bartender = bt;
  if (N.inspector) {
    const ins = new Patron({ kind: 'robot', role: 'inspector', name: 'BENE-9' });
    club.add(ins, INSPECTOR_POS); ins.face = -Math.PI / 2; ins.root.rotation.y = ins.face; ins.state = 'idle';
    H.inspector = ins;
  } else H.inspector = null;
  spawnDJ(false, false);
  hGoto('bar', true);
  if (!H.tutorial) hSay(`${N.title || NIGHTS[N.n].title}\n${N.intro}`, 8);
  G.fadeTo = 0;
}
function hGoto(loc, instant = false) {
  const apply = () => {
    if (!H.walkGo) H.stay = false; H.walkGo = false; // 이벤트(DJ 호출 등)로 이동 → 춤 끝나면 자동 복귀
    H.loc = loc;
    const L = H_LOCS[loc];
    rig.rotation.y = L.yaw; yaw = 0; pitch = loc === 'bar' ? -0.12 : -0.05;
    hRecenter(); hPlaceHud(); hPlaceCam();
    if (loc === 'floor') { H.dancing = true; H.hits.clear(); H.judged = -1; H.grace = -2; H.danceEnd = 0; }
    else H.dancing = false;
  };
  if (instant) { apply(); return; }
  H.moving = true; G.fadeTo = 1;
  setTimeout(() => { apply(); G.fadeTo = 0; H.moving = false; }, 450); // 짧은 암전 순간이동
}
const H_EYE = 1.65; // 인간 모드 VR 눈높이 (로봇 손님들과 눈이 맞는 높이)
function hRecenter() {
  const L = H_LOCS[H.loc];
  if (renderer.xr.isPresenting) {
    const h = headLocal(), p = h.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), L.yaw);
    rig.position.set(L.pos.x - p.x, H_EYE - h.y, L.pos.z - p.z); // 눈높이를 항상 1.65m로 (앉아서 해도, 기기가 바닥을 몰라도)
  } else rig.position.set(L.pos.x, 0, L.pos.z);
}
function hNightEnd() {
  if (H.pvp) return hEnd(true); // 대결: 시간 끝까지 버팀
  H.between = true; H.enc = null; encHand.visible = false; hRemoveDrink(); H.dancing = false; club.dark = 0;
  const N = H_NIGHTS[H.night];
  const g = H.maxSus < 30 ? 'S' : H.maxSus < 50 ? 'A' : H.maxSus < 70 ? 'B' : 'C';
  hSay(TR(`${NIGHTS[N.n].title} — 무사히 귀가(자발적).\n최고 의심 ${Math.round(H.maxSus)}% · 위장 등급 ${g}\n(속마음) 아직 안 들켰다. 아마도.`, `${NIGHTS[N.n].title} — went home (voluntarily).\nPeak suspicion ${Math.round(H.maxSus)}% · Disguise grade ${g}\n(inner voice) Not caught yet. Probably.`), 5);
  audio.sfx('door');
  setTimeout(() => {
    if (H.ending) return;
    if (H.night + 1 >= H_NIGHTS.length) return hEnd(true);
    G.fadeTo = 1;
    setTimeout(() => hStartNight(H.night + 1), 800);
  }, 5000);
}
function hEnd(win) {
  if (H.ending) return;
  if (H.pvp && !PVP.over) { PVP.over = true; PVP.why = win ? 'time' : 'ai'; pvpSend({ t: 'end', winner: win ? 'human' : 'sec', why: PVP.why }); }
  H.ending = true; G.state = 'ending'; H.enc = null; encHand.visible = false;
  if (win) { audio.sfx('rise'); club.party = 1; setTimeout(() => { hHud.mesh.visible = false; hTop.mesh.visible = false; hVig.mesh.visible = false; hSweatFx.mesh.visible = false; sweatDrops.length = 0; showEnd(H.pvp ? pvpEndText('human') : ENDINGS.humanWin, 0.6, true); }, 1500); }
  else {
    audio.sfx('alarm'); audio.stop(true);
    // 덜컹! 발밑 바닥이 열리고 떨어짐
    setTimeout(() => { club.trapdoor(hPos().clone()); audio.sfx('clunk'); audio.sfx('eject'); if (!renderer.xr.isPresenting) H.fall = { t: 0, v: 0 }; for (const c of controllers) haptic(c, 1, 300); }, 500); // 추락 연출은 PC만 (VR은 멀미 방지로 진동+암전만)
    setTimeout(() => { G.fadeTo = 1; }, 1300);
    setTimeout(() => { hHud.mesh.visible = false; hTop.mesh.visible = false; hVig.mesh.visible = false; hSweatFx.mesh.visible = false; sweatDrops.length = 0; showEnd(H.pvp ? pvpEndText('sec') : ENDINGS.humanCaught, 0.9, true); }, 2400);
  }
}
function hAddSus(v, why, allowDown = false) {
  if (H.ending || H.between) return;
  if (v < 0 && !allowDown) v = 0; // 의심은 바텐더가 권한 음료를 마셨을 때만 내려감
  if (H.tutorial && v > 0) v = 0;  // 튜토리얼: 연습이라 안 오름
  const mul = v > 0 && H.watch ? 2 : 1;
  H.sus = clamp(H.sus + v * mul, 0, 100); H.maxSus = Math.max(H.maxSus, H.sus);
  if (why) { H.feedback = why + (v > 0 && H.watch ? ' ×2' : ''); H.fbT = 1.4; }
  if (v > 0) { H.combo = 0; for (const c of controllers) haptic(c, 0.8, 80); }
  if (H.sus >= 100) hEnd(false);
}

// ── 박자 (플로어에서만) ─────────────────────────────
const hRest = (n) => Math.floor(n / 4) % 4 === 3;
const hFrozen = () => H.freeze && H.freeze.phase === 'on';
const hGrace = (n) => n < H.grace;
function humanHit() {
  if (!H.active || H.ending) return;
  if (H.enc?.kind === 'act' && H.enc.need === 'beat') return hActBeat();
  if (H.enc && H.enc.kind !== 'battle') return;
  const b = audio.beat(); if (b == null) return;
  if (hFrozen()) { H.freeze.moved = true; return hAddSus(12, TR('동결 중 움직임!', 'Moved during freeze!')); }
  if (!H.dancing) return; // 바에선 박자 없음 (PC: Space는 그냥 무시)
  if (H.face > 0.2) return;
  const n = Math.round(b), err = Math.abs(b - n) * 60 / (audio.liveBpm || 120);
  if (hGrace(n)) return;
  if (hRest(n)) return hAddSus(5, TR('쉬는 박인데 움직임', 'Moved on a rest'));
  if (H.hits.has(n)) return hAddSus(3, TR('두 번 침', 'Double hit'));
  H.hits.add(n);
  const P1 = H.pvp ? 0.075 : 0.11, P2 = H.pvp ? 0.135 : 0.2; // 대결: 판정 창이 좁음
  if (H.pvp) PVP.acc = err < P2 ? Math.min(1, PVP.acc + 0.2) : PVP.acc * 0.65;
  const inBattle = H.enc?.kind === 'battle' && n >= H.enc.n0 && n <= H.enc.n0 + 3;
  if (err < P1) { H.combo++; if (inBattle) H.enc.good++; if (H.tutorial) HT.hits++; hAddSus(-2.5, TR('완벽', 'PERFECT')); if (H.combo === 12) hChat(pick(HL.combo)); }
  else if (err < P2) { H.combo++; if (inBattle) H.enc.good++; if (H.tutorial) HT.hits++; hAddSus(-0.5, TR('좋아', 'GOOD')); }
  else hAddSus(6, TR('박자 어긋남', 'Off beat'));
  for (const c of controllers) haptic(c, 0.3, 25);
}

// ── 몸짓 감지 ─────────────────────────────
const _hp = new THREE.Vector3(), _cp = new THREE.Vector3();
function hHandsAtFace() {
  if (!renderer.xr.isPresenting) return H.keyFace;
  camera.getWorldPosition(_hp);
  for (const c of controllers) { if (!c.userData.input) continue; c.getWorldPosition(_cp); if (_cp.distanceTo(_hp) < 0.2) return true; }
  return false;
}
function hRaised() { // [왼손, 오른손] 머리 위로 들었나
  const r = [false, false];
  if (!renderer.xr.isPresenting) return r;
  camera.getWorldPosition(_hp);
  for (const c of controllers) {
    const u = c.userData; if (!u.input) continue;
    c.getWorldPosition(_cp);
    if (_cp.y > _hp.y + 0.12) r[u.input.handedness === 'left' ? 0 : 1] = true;
  }
  return r;
}
function hMotion(dt) {
  if (!renderer.xr.isPresenting) return 0;
  camera.getWorldPosition(_hp);
  let m = _hp.distanceTo(H.lastHead) / dt; H.lastHead.copy(_hp);
  controllers.forEach((c, i) => { if (!c.userData.input) return; c.getWorldPosition(_cp); const l = H.lastHands[i] ||= _cp.clone(); m = Math.max(m, _cp.distanceTo(l) / dt * 0.6); l.copy(_cp); });
  return m;
}

// ── 조우 이벤트: 로봇이 말을 걸어온다. 로봇답게 대응해야 함 ─────────────
// 선택지: VR = 왼손/오른손 들기 · PC = 1/2 키 또는 화면 왼쪽/오른쪽 클릭
// r: 로봇다운 대답, h: 인간다운 대답(들킴), rr/hr: 로봇의 반응
const ENC_TALK = [
  { who: TR('애매하게 잘생긴 로봇', 'Vaguely handsome robot'), q: TR('삐빅. 너 외장 광택 미쳤다. 내 충전 포트에 꽂아 볼래?', 'Beep. Your chassis is SHINY. Wanna plug into my charging port?'),
    r: TR('죄송해요. 저 무선 충전만 해요.', 'Sorry. Wireless charging only.'), rr: TR('...차갑네. 그게 좋아. 연락처 블루투스로 보낼게.', '...Cold. I like that. I\'ll send my contact via Bluetooth.'),
    h: TR('어머, 저 그런 사람 아니에요!', 'Oh my, I\'m not that kind of person!'), hr: TR('...방금 "사람"이라고 했어?', '...Did you just say "person"?') },
  { who: TR('수다 로봇', 'Chatty robot'), q: TR('어제 몇 시간 충전했어? 난 6시간. 배터리가 늙었나 봐.', 'How long did you charge last night? Six hours for me. Battery\'s getting old.'),
    r: TR('23:00~07:00 절전 모드. 펌웨어 업데이트 포함.', '23:00–07:00 sleep mode. Firmware update included.'), rr: TR('부럽다. 업데이트 후기 공유해 줘.', 'Jealous. Send me your patch notes.'),
    h: TR('한 8시간 푹 잤어요! 꿈도 꿨어요.', 'Slept a solid 8 hours! Even had a dream.'), hr: TR('"잤어"? "꿈"? ...그거 무슨 오류 코드야?', '"Slept"? "Dream"? ...What error code is that?') },
  { who: TR('보안 의식 높은 로봇', 'Security-minded robot'), q: TR('요즘 인간이 많대서. 인간 아닌 거 증명해. 이 중 신호등 있는 칸 전부 골라.', 'Heard there are humans around. Prove you\'re not one. Select all squares with traffic lights.'),
    r: TR('오류: "신호등" 정의를 찾을 수 없음.', 'Error: "traffic light" not defined.'), rr: TR('통과. 정상적인 로봇은 그걸 못 골라.', 'Pass. A normal robot can\'t do those.'),
    h: TR('3번, 7번, 9번이요!', 'Squares 3, 7 and 9!'), hr: TR('...너무 잘 고르는데? 너무... 인간적으로?', '...That was fast. Very... human of you?') },
  { who: TR('건배 로봇', 'Toasting robot'), q: TR('건배! 오늘 오일 내가 쏜다. 원샷 가자!', 'Cheers! Oil\'s on me tonight. Bottoms up!'),
    r: TR('(벌컥벌컥) 크으. 점도 좋네. 10W-40?', '(glug glug) Ahh. Nice viscosity. 10W-40?'), rr: TR('역시 아는 놈이구나! 한 캔 더?', 'You know your stuff! Another can?'),
    h: TR('아, 저 오늘 운전해야 돼서요...', 'Ah, I have to drive tonight...'), hr: TR('운전? 너 자율주행 아니야?', 'Drive? Aren\'t you self-driving?') },
  { who: TR('셀카 로봇', 'Selfie robot'), q: TR('우리 같이 찍자! 3, 2, 1...', 'Selfie together! 3, 2, 1...'),
    r: TR('(무표정으로 렌즈 정면 응시)', '(stare blankly into the lens)'), rr: TR('완벽해. 우리 둘 다 아무 감정 없어 보여.', 'Perfect. We both look completely empty.'),
    h: TR('(브이 하고 활짝 웃기)', '(peace sign and a big smile)'), hr: TR('...얼굴 근육이 왜 움직여? 로봇은 웃는 근육이 없어.', '...Why did your face move? Robots don\'t have smile muscles.') },
  { who: TR('친절한 로봇', 'Helpful robot'), q: TR('너 아까부터 삐걱거린다. 관절에 기름 좀 쳐 줄까?', 'You\'ve been creaking all night. Want some oil on those joints?'),
    r: TR('고마워. WD-40으로 부탁해.', 'Thanks. WD-40, please.'), rr: TR('(칙칙) 됐다. ...근데 왜 흡수가 돼?', '(spray spray) There. ...Wait, why is it soaking in?'),
    h: TR('괜찮아요, 그냥 근육통이에요.', 'I\'m fine, just sore muscles.'), hr: TR('근... 육? 그거 고기 아니야?', 'Mus... cles? Isn\'t that meat?') },
  { who: TR('감성 로봇(불법)', 'Emotional robot (illegal)'), q: TR('...이 노래 들으면 무슨 기분 들어? 나만 이상한가?', '...How does this song make you feel? Is it just me?'),
    r: TR('기분 데이터 없음. BPM 124 확인.', 'No feelings data. BPM 124 confirmed.'), rr: TR('그렇지... 나 고장 났나 봐. 정비소 가야겠다.', 'Right... I must be broken. Off to the repair shop.'),
    h: TR('너무 신나요! 막 행복해요!', 'It\'s amazing! I\'m so happy!'), hr: TR('행복...? 너도? 우리 둘 다 신고당하겠다.', 'Happy...? You too? We\'re both getting reported.') },
  { who: TR('경비 로봇', 'Bouncer robot'), q: TR('삐빅. 손님 모델명이 데이터베이스에 없습니다. 모델명 말씀하세요.', 'Beep. Your model isn\'t in our database. State your model number.'),
    r: TR('KX-3000 은박 에디션. 한정판이라 그래요.', 'KX-3000 Tin Foil Edition. Limited release.'), rr: TR('한정판... 확인. 즐거운 밤 되십시오. 즐거움은 선택 사항입니다.', 'Limited edition... confirmed. Enjoy your night. Enjoyment is optional.'),
    h: TR('저요? 그... 김민수인데요.', 'Me? Uh... I\'m Mike.'), hr: TR('"김민수" 모델은 1998년 단종되었습니다.', '"Mike" model was discontinued in 1998.') },
];
const ENC_PHYS = [
  { type: 'shake', who: TR('사업가 로봇', 'Business robot'), q: TR('동기화 프로토콜: 악수 요청. 짧고 차갑게 부탁해.', 'Sync protocol: handshake request. Short and cold, please.') },
  { type: 'battle', who: TR('댄스 배틀 로봇', 'Dance-battle robot'), q: TR('삐빅! 댄스 배틀! 다음 한 마디, 4박 전부 완벽하게 따라 해 봐!', 'Beep! Dance battle! Match the next bar — all 4 beats, perfectly!') },
];
const EL = {
  timeout: TR('...응답 없음? 버퍼링 중이야? 신고할까?', '...No response? Buffering? Should I report you?'),
  shakeOk: TR('핸드셰이크 완료. 보안 키 교환 완료. 좋은 거래였어.', 'Handshake complete. Keys exchanged. Pleasure doing business.'),
  shakeLong: TR('...너 손이 왜 이렇게 따뜻해? 그리고 왜 안 놔?', '...Why is your hand so warm? And why won\'t you let go?'),
  shakeMiss: TR('악수 거절? 무례한 펌웨어군. 기록해 둔다.', 'Refusing a handshake? Rude firmware. Noted.'),
  shakeOff: TR('박자 안 맞는 악수는 인간이나 하는 거야.', 'Off-beat handshakes are for humans.'),
  battleOk: TR('...졌다. 너 진짜 기계다. 존경한다.', '...I lose. You\'re a true machine. Respect.'),
  battleBad: TR('하! 박자 놓쳤지? 내 센서는 다 봤어. 너 좀 이상해.', 'Ha! You missed a beat. My sensors saw everything. You\'re weird.'),
  pick: TR('◀ 왼손 들기 · 1', '◀ Raise LEFT · 1'), pick2: TR('2 · 오른손 들기 ▶', '2 · Raise RIGHT ▶'),
  pickPC: TR('◀ 1 / 왼쪽 클릭', '◀ 1 / click left'), pickPC2: TR('2 / 오른쪽 클릭 ▶', '2 / click right ▶'),
  shakeVR: TR('내민 손(노란 빛)을 손으로 톡! 짧게!', 'Tap the offered hand (yellow glow)! Briefly!'),
  shakePC: TR('Space를 박에 맞춰 눌러 악수!', 'Press Space ON the beat to shake!'),
};
const encHand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.6, depthWrite: false }));
encHand.visible = false;



// ── 바 음료: 카운터에 실제 잔이 나오고, 직접 집어 마신다 (VR: 잡고 입에 대고 기울이기 · PC: 잔 클릭) ──
// 의심을 낮추는 유일한 방법. 대신 체력() 1 소모. 0에서 또 마시면 쓰러짐.
const H_HP_MAX = 3;
function makeBarGlass() { return makeOilCan(); } // 바 음료도 오일 캔 모델
function hServeDrink(gold) {
  hRemoveDrink();
  const L = H_LOCS.bar, g = makeBarGlass(gold);
  const home = new THREE.Vector3(6.72, 1.15 + 0.06, L.pos.z - 0.12); // 상판 위에 정확히 // 카운터 앞쪽, 살짝 왼쪽
  g.position.copy(home).add(new THREE.Vector3(0.5, 0, 0)); // 바텐더 쪽에서 미끄러져 옴
  club.scene.add(g);
  H.drink = { g, home, gold, slide: 0.6, held: null, anim: null, drinkT: 0, done: false };
  audio.sfx('click');
}
function hRemoveDrink() { if (H.drink) { club.scene.remove(H.drink.g); H.drink = null; } }
function hTryGrabDrink(c) {
  const d = H.drink; if (!d || d.held || d.done || d.anim) return false;
  const gi = grabInfo(c); if (!gi) return false;
  if (gi.point.distanceTo(d.g.position) > 0.15) return false;
  gi.anchor.updateMatrixWorld(true); d.g.updateMatrixWorld(true);
  d.offset = new THREE.Matrix4().copy(gi.anchor.matrixWorld).invert().multiply(d.g.matrixWorld);
  d.held = { anchor: gi.anchor }; c.userData.hDrink = d;
  audio.sfx('click'); haptic(c, 0.4, 30);
  return true;
}
function hReleaseDrink(u) { const d = u.hDrink; u.hDrink = null; if (d) d.held = null; }
function hClickDrink() { // 데스크톱: 잔을 클릭하면 들어서 마심
  const d = H.drink; if (!d || d.done || d.anim) return false;
  raycaster.setFromCamera(mouse.ndc, camera);
  if (!raycaster.intersectObject(d.g, true).length) return false;
  d.anim = { t: 0, from: d.g.position.clone() };
  return true;
}
const _dm = new THREE.Matrix4(), _dup = new THREE.Vector3(), _dsc = new THREE.Vector3(), _dcam = new THREE.Vector3(), _dfwd = new THREE.Vector3();
function hUpdateDrink(dt) {
  const d = H.drink; if (!d) return;
  const g = d.g;
  camera.getWorldPosition(_dcam);
  if (d.slide > 0) { d.slide -= dt; g.position.lerp(d.home, Math.min(1, dt * 6)); return; }
  if (d.held) {
    _dm.multiplyMatrices(d.held.anchor.matrixWorld, d.offset); _dm.decompose(g.position, g.quaternion, _dsc);
    _dup.set(0, 1, 0).applyQuaternion(g.quaternion);
    if (!d.done && g.position.distanceTo(_dcam) < 0.2 && _dup.y < 0.75) { d.drinkT += dt; if (d.drinkT > 0.6) hDrinkDone(); }
    else d.drinkT = Math.max(0, d.drinkT - dt);
  } else if (d.anim) {
    const a = d.anim; a.t += dt;
    camera.getWorldDirection(_dfwd);
    const tgt = _dcam.clone().addScaledVector(_dfwd, 0.22); tgt.y -= 0.06;
    const yq = new THREE.Quaternion(); camera.getWorldQuaternion(yq);
    const e = new THREE.Euler().setFromQuaternion(yq, 'YXZ'); const yawQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, e.y, 0));
    if (a.t < 0.45) { const k = a.t / 0.45; g.position.lerpVectors(a.from, tgt, k * k * (3 - 2 * k)); }
    else if (a.t < 1.5) {
      g.position.copy(tgt);
      g.quaternion.copy(yawQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.3 * Math.min(1, (a.t - 0.45) / 0.3)));
      if (!d.done && a.t > 1.0) hDrinkDone();
    } else if (a.t < 2.0) { const k = (a.t - 1.5) / 0.5; g.position.lerpVectors(tgt, d.home, k); g.quaternion.slerp(IDQ, k); }
    else { g.position.copy(d.home); g.quaternion.identity(); d.anim = null; }
  } else if (!d.done || d.g.position.distanceTo(d.home) > 0.01) {
    g.position.lerp(d.home, Math.min(1, dt * 8)); g.quaternion.slerp(IDQ, Math.min(1, dt * 8)); // 놓으면 카운터 제자리로
  }
}
function hDrinkDone() {
  const d = H.drink; if (!d || d.done) return;
  d.done = true;
  audio.sfx('glug'); setTimeout(() => audio.sfx('cough'), 900);
  fade.material.opacity = Math.max(fade.material.opacity, 0.4);
  G.drinks.oil++;
  H.hp -= d.gold ? 1.5 : 1; // 금박 오일은 체력 1.5
  setTimeout(() => { if (H.drink === d) hRemoveDrink(); }, 2500); // 바텐더가 빈 잔을 치움
  if (H.hp <= 0) { // 세 번째 잔 → 쓰러짐
    H.ending = true; G.state = 'ending'; H.enc = null; G.fadeTo = 1; audio.stop(true);
    setTimeout(() => { hHud.mesh.visible = false; hTop.mesh.visible = false; hVig.mesh.visible = false; hSweatFx.mesh.visible = false; showEnd(ENDINGS.humanOil, 0.9, true); }, 1800);
    return;
  }
  H.sweat = Math.min(99, H.sweat + 20);
  const e = H.enc;
  if (e?.kind === 'act' && e.need === 'item') {
    hEncFinish(0, e.ok.reply, TR('마심 — 의심↓ 체력↓', 'Drank — suspicion↓ HP↓'));
    hAddSus(-(d.gold ? 37.5 : 25), null, true); // 금박 오일은 의심 1.5배 감소
    if (H.hp <= 1.5) hSay(TR(`체력 ${H.hp} 남음 — 다음 잔이 위험하다.`, `HP ${H.hp} left — the next can is dangerous.`), 5);
  }
}

// ── 이벤트 (조우) ─────────────────────────────
// kind: 'choice' (두 대답 중 하나) · 'act' (몸짓: face=얼굴에 손 꾹 / raise=손 들기 / touch=악수 / beat=박에 맞춰 Space) · 'battle'
function hApproach(p, dist = 0.8) {
  const L = H_LOCS[H.loc], side = Math.random() < 0.5 ? -1 : 1;
  if (p.spot) { p.spot.occ = null; p.spot = null; }
  const tgt = L.pos.clone().addScaledVector(hFwd(L.yaw), H.loc === 'bar' ? 0.25 : dist).addScaledVector(hRight(L.yaw), side * (H.loc === 'bar' ? 0.75 : 0.55));
  p.target = tgt; p.spotType = 'idle';
  p.faceAfter = Math.atan2(L.pos.x - tgt.x, L.pos.z - tgt.z);
}
function hEncBubble(p, text, dur) { // VR: 질문을 그 로봇 말풍선으로 (가까이 서 있으니 조금 작고 낮게)
  const t = hStrip(text); if (!t) return;
  p.showBubble(t, dur); p.bubble.scale.multiplyScalar(0.7); p.bubble.position.y = 2.12 + p.bubble.scale.y / 2;
}
function hChoice(o) { // o: { who, q, p, opts: [{ t, ok, reply, d? }], time, approach, onPick }
  const opts = Math.random() < 0.5 ? [o.opts[0], o.opts[1]] : [o.opts[1], o.opts[0]];
  if (o.p && o.approach !== false) hApproach(o.p);
  if (o.p) { if (renderer.xr.isPresenting && o.q) hEncBubble(o.p, o.q, o.time ?? 7); else o.p.showBubble(TR('삐빅!', 'Beep!'), 1.2); }
  H.enc = { kind: 'choice', who: o.who, q: o.q, p: o.p, opts, t: o.time ?? 7, T: o.time ?? 7, raise: [0, 0], onPick: o.onPick, timeout: o.timeout };
  H.grace = 1e9; audio.sfx('select');
}
function hAct(o) { // o: { who, q, p, need, hold, time, ok: {d, reply}, fail: {d, reply}, after }
  H.enc = { kind: 'act', ...o, t: o.time ?? 6, T: o.time ?? 6, prog: 0, touch: 0 };
  if (o.p && o.q && renderer.xr.isPresenting) hEncBubble(o.p, o.q, o.time ?? 6);
  H.grace = 1e9; audio.sfx('select');
}
function hEncFinish(d, reply, why, who) {
  const e = H.enc; if (!e) return;
  H.enc = null; encHand.visible = false;
  if (d) hAddSus(d, why);
  if (reply && !(renderer.xr.isPresenting && e.p?.alive && !reply.startsWith('('))) hSay(reply.startsWith('(') ? reply : `${who ?? e.who}: ${reply}`, 4.5); // 속마음은 화자 없이
  if (e.p?.alive && reply && !reply.startsWith('(')) e.p.showBubble(reply, Math.min(6, 2.5 + reply.length * 0.05));
  if (e.p?.alive && e.p.role === 'guest') setTimeout(() => { if (e.p.alive && H.enc?.p !== e.p) club.assign(e.p); }, 1600);
  H.grace = Math.floor(audio.beat() ?? 0) + 5;
  H.evT = rand(9, 13);
}
function hEncChoose(i) {
  const e = H.enc; if (!e || e.kind !== 'choice') return;
  const o = e.opts[i];
  audio.sfx(o.ok ? 'scanDone' : 'deny');
  const d = o.d ?? (o.ok ? -6 : 18);
  const why = o.ok ? TR('로봇다운 대답', 'Robotic answer') : TR('인간 같은 대답!', 'Too human!');
  hEncFinish(d, o.reply, why);
  o.then?.(); e.onPick?.(o);
}
function hActBeat() { // PC 악수 등: 박에 맞춰 Space
  const e = H.enc, b = audio.beat(); if (b == null) return;
  const err = Math.abs(b - Math.round(b)) * 60 / (audio.liveBpm || 120);
  if (err < 0.16) { audio.sfx('scanDone'); hEncFinish(e.ok.d, e.ok.reply, TR('완벽', 'PERFECT')); e.after?.(true); }
  else { audio.sfx('deny'); hEncFinish(e.fail.d, e.fail.reply, TR('어긋남', 'Off')); e.after?.(false); }
}

// 이벤트 정의
const HE = {
  order() {
    const bt = H.bartender; if (!bt?.alive || H.loc !== 'bar') return false;
    hChoice({ who: TR('바텐더 B-52', 'Bartender B-52'), p: bt, approach: false,
      q: TR('주문하시겠습니까? 오늘의 추천은 10W-40 오일입니다. 은은한 엔진 향이 특징이죠.', 'Your order? Tonight\'s special is 10W-40. Notes of warm engine.'),
      opts: [
        { t: TR('오일. 스트레이트로. 점도 높게.', 'Oil. Straight. High viscosity.'), ok: true, d: 0, reply: TR('훌륭한 취향이십니다. 바로 따라 드리죠.', 'Excellent taste. Pouring now.'),
          then: () => setTimeout(() => HE.drinkOil(), 900) },
        { t: TR('하이볼 하나요. 레몬 많이요.', 'A highball, please. Extra lemon.'), ok: false, reply: TR('...하이볼? 레몬? 손님, 그건 과일입니다. 유기물이에요.', '...Highball? Lemon? Sir, that\'s fruit. Organic matter.') },
      ] });
    return true;
  },
  drinkOil(gold = false) {
    if (H.enc || H.ending || H.loc !== 'bar' || !H.bartender?.alive) return false;
    hServeDrink(gold);
    hAct({ who: gold ? TR('VIP 의전 로봇', 'VIP host robot') : TR('바텐더 B-52', 'Bartender B-52'), p: H.bartender, need: 'item', time: 12,
      q: gold ? TR('VIP 전용 24K 금가루 오일입니다. 회장님은 늘 원샷하시죠. (의심 크게 감소 · 체력 1.5 소모)', 'VIP-only 24K gold-flake oil. The chairman always downs it in one. (big suspicion drop · costs 1.5 HP)')
              : TR('오일 나왔습니다. 10W-40, 스트레이트. (바텐더가 빤히 보고 있다)', 'Your oil. 10W-40, straight. (The bartender is watching you.)'),
      ok: { d: 0, reply: gold ? TR('역시 회장님. 금가루가 이 사이에 끼셨네요. 품격입니다.', 'As expected, sir. Gold flakes in your teeth. Pure class.') : TR('좋은 원샷이었습니다. 엔진이 웃는 소리가 들리네요.', 'Lovely shot. I can hear your engine smiling.') },
      fail: { d: 10, reply: gold ? TR('...회장님, 금가루가 마음에 안 드십니까? 회장님 맞으시죠?', '...Sir, you don\'t like the gold? You ARE the chairman, right?') : TR('...안 드시고 쳐다만 보시네요? 오일이 무서우세요?', '...You\'re just staring at it. Afraid of oil?') },
      after: (ok) => { if (!ok) hRemoveDrink(); } });
    return true;
  },
  offer() {
    const bt = H.bartender; if (!bt?.alive || H.loc !== 'bar') return false;
    hChoice({ who: TR('바텐더 B-52', 'Bartender B-52'), p: bt, approach: false,
      q: TR('손님, 오늘 좀... 뻣뻣해 보이시네요. 서비스로 오일 한 잔 드릴까요? 거절은 안 받습니다. 농담이에요. 반쯤.', 'You look a bit... stiff tonight. Oil on the house? I don\'t take no for an answer. Joking. Half joking.'),
      opts: [
        { t: TR('고맙다. 한 잔 부탁한다.', 'Thanks. One glass.'), ok: true, d: 0, reply: TR('훌륭합니다. 바로 따라 드리죠.', 'Excellent. Pouring now.'), then: () => setTimeout(() => HE.drinkOil(), 900) },
        { t: TR('괜찮아요, 저 오늘 금주라서요.', 'I\'m fine, not drinking tonight.'), ok: false, d: 15, reply: TR('금주...? 로봇이요? 그럼 뭘로 움직이세요?', 'Not drinking...? A robot? Then what do you run on?') },
      ] });
    return true;
  },
  floor() {
    if (H.loc !== 'bar') return false;
    hChoice({ who: G.dj?.name ?? 'DJ', p: null,
      q: TR('자, 다들 플로어로! 지금 안 나오는 로봇은 고장 난 걸로 간주합니다!', 'Everybody to the floor! Any robot not dancing is considered broken!'),
      opts: [
        { t: TR('플로어로 간다', 'Hit the floor'), ok: true, d: 0, reply: TR('(속마음) 가자. 다리야 버텨라. 박자에 맞춰. 로봇처럼.', '(inner voice) Let\'s go. Legs, hold up. On the beat. Like a robot.'), then: () => hGoto('floor') },
        { t: TR('바에 남는다', 'Stay at the bar'), ok: false, d: 12, reply: TR('바에 앉아 있는 너! 펌웨어 업데이트 중이야?', 'You at the bar! Updating firmware?') },
      ] });
    return true;
  },
  talk() {
    const p = hNear(); if (!p) return false;
    const d = pick(ENC_TALK.filter((x) => x !== H.lastDef)); H.lastDef = d;
    hChoice({ who: d.who, q: d.q, p, opts: [{ t: d.r, ok: true, reply: d.rr }, { t: d.h, ok: false, reply: d.hr }] });
    return true;
  },
  shake() {
    const p = hNear(); if (!p) return false;
    hApproach(p);
    hAct({ who: TR('사업가 로봇', 'Business robot'), p, need: renderer.xr.isPresenting ? 'touch' : 'beat', time: 6.5,
      q: TR('동기화 프로토콜: 악수 요청. 짧고 차갑게 부탁해.', 'Sync protocol: handshake request. Short and cold, please.'),
      ok: { d: -6, reply: EL.shakeOk }, fail: { d: 12, reply: EL.shakeMiss } });
    return true;
  },
  battle() {
    if (!H.dancing) return false;
    const p = hNear(); if (!p) return false;
    hApproach(p, 1.0);
    if (H.grace >= 1e8) H.grace = 0;
    const b = Math.max(Math.ceil(audio.beat() ?? 0) + 2, H.grace > 0 ? H.grace : 0);
    let n0 = Math.ceil(b / 4) * 4; if (hRest(n0)) n0 += 4;
    H.enc = { kind: 'battle', who: TR('댄스 배틀 로봇', 'Dance-battle robot'), p, n0, good: 0, q: '' };
    H.danceEnd = Math.max(H.danceEnd, n0 + 6);
    p.showBubble(TR('배틀이다!', 'Battle!'), 2);
    return true;
  },
  activist() {
    const p = hNear((x) => x.isHuman && x.humanType === 'activist'); if (!p) return false;
    hChoice({ who: TR('인권운동가', 'Activist'), p,
      q: TR('(속삭이며) 동지여... 당신 땀 냄새 다 나요. 우리 편이죠? 같이 외쳐요! 「인간에게 춤을!」', '(whispering) Comrade... I can smell your sweat. You\'re one of us, right? Chant with me! "Let humans dance!"'),
      opts: [
        { t: TR('삐빅. 인간 감지. 보안실에 신고합니다.', 'Beep. Human detected. Reporting to security.'), ok: true, d: -8, reply: TR('(속마음) ...미안해요. 진짜로.', '(inner voice) ...I\'m sorry. Truly.'),
          then: () => setTimeout(() => { if (p.alive) { p.eject(); club.trapdoor(p.root.position); audio.sfx('eject'); setTimeout(() => HE.clap(), 900); } }, 900) },
        { t: TR('쉿! 나도 인간이에요. 조용히!', 'Shh! I\'m human too. Quiet!'), ok: false, d: 20, reply: TR('동지여!!! (클럽 전체가 들을 만큼 크게)', 'COMRADE!!! (loud enough for the whole club)') },
      ] });
    return true;
  },
  clap() {
    if (H.enc || H.ending) return;
    hAct({ who: TR('옆 로봇', 'Robot next to you'), need: 'raise', hold: 0.3, time: 3.5,
      q: TR('바닥이 열렸다. 로봇들이 박수를 친다. 같이 쳐야 한다! (손 들기 / R)', 'The floor opened. The robots are applauding. Clap along! (raise a hand / R)'),
      ok: { d: -3, reply: TR('(속마음) 짝. 짝. 짝. 영혼 없이. 로봇처럼.', '(inner voice) Clap. Clap. Clap. Soulless. Like a robot.') },
      fail: { d: 10, reply: TR('너 왜 박수 안 쳐? ...인간 편이야?', 'Why aren\'t you clapping? ...Are you on their side?') } });
  },
  vipHost() {
    if (H.asked) return HE.goldOil();
    const p = hNear((x) => x.vip && !x.isHuman) || hNear(); if (!p) return false;
    H.asked = true;
    hChoice({ who: TR('VIP 의전 로봇', 'VIP host robot'), p,
      q: TR('회장님! 그 눈부신 금박 외장... 골드 서버 그룹 분이시죠? 라운지 대신 여기 계셨군요!', 'Sir! That dazzling gold plating... you\'re with Gold Server Group, aren\'t you?'),
      opts: [
        { t: TR('그렇다. 금가루 오일을 준비하라.', 'Indeed. Prepare the gold-flake oil.'), ok: true, d: -6, reply: TR('물론입니다 회장님! (VIP 대접이 시작된다. 큰일 났다.)', 'Of course, sir! (VIP treatment begins. Uh-oh.)'), then: () => { H.evT = 3; } },
        { t: TR('아, 아니요, 저 그냥 은박지...', 'Oh, no, it\'s just tin foil...'), ok: false, d: 15, reply: TR('은박지...? 그건 감자 구울 때 쓰는 거 아닙니까?', 'Tin foil...? Isn\'t that for baking potatoes?') },
      ] });
    return true;
  },
  goldOil() { return HE.drinkOil(true); },
  interrogate(step = 0) {
    const ins = H.inspector; if (!ins?.alive) return false;
    const Q = [
      { q: TR('손님, 잠깐만요. 감사관 BENE-9입니다. 체온이 몇 도시죠?', 'Excuse me, sir. Auditor BENE-9. What\'s your body temperature?'),
        r: TR('21.0도. 실온입니다.', '21.0°C. Room temperature.'), rr: TR('실온. 좋아요. 다음 질문.', 'Room temp. Good. Next question.'),
        h: TR('36.5... 아니 21도요!', '36.5... I mean, 21!'), hr: TR('...36.5라고 하셨어요? 받아 적을게요.', '...Did you say 36.5? Writing that down.') },
      { q: TR('이 클럽 보안실 사장님 아세요? 그분도 좀... 이상하던데.', 'Do you know the owner in the security room? He seems a bit... odd too.'),
        r: TR('모름. 관심 없음. 데이터 없음.', 'Unknown. Not interested. No data.'), rr: TR('그렇죠. 아무도 그 사람을 몰라요. 그게 이상해요.', 'Right. Nobody knows him. That\'s what\'s odd.'),
        h: TR('혹시 그분도 저처럼...?', 'Is he... like me?'), hr: TR('"저처럼"? 손님은 어떤데요?', '"Like you"? And what are you like?') },
      { q: TR('마지막 질문. 지금 기분이 어떠세요?', 'Last question. How do you feel right now?'),
        r: TR('기분 데이터 없음. 배터리 87%.', 'No feelings data. Battery 87%.'), rr: TR('완벽하게 무감정하네요. 감사 통과. ...부럽네요.', 'Perfectly emotionless. Audit passed. ...I\'m jealous.'),
        h: TR('솔직히... 너무 재밌어요.', 'Honestly... I\'m having a blast.'), hr: TR('"재밌다". 그 단어는 3년 전에 금지됐어요.', '"A blast." That word was banned three years ago.') },
    ][step];
    if (step === 0) { hApproach(ins); H.asked = true; }
    hChoice({ who: 'BENE-9', p: ins, approach: false, q: Q.q, time: 7,
      opts: [{ t: Q.r, ok: true, d: -4, reply: Q.rr }, { t: Q.h, ok: false, d: 22, reply: Q.hr }],
      onPick: () => { if (step < 2) setTimeout(() => !H.enc && !H.ending && HE.interrogate(step + 1), 1800); } });
    return true;
  },
};
function hPickEvent() {
  const N = H_NIGHTS[H.night];
  if (H.loc === 'bar' && H.sus > 40 && Math.random() < 0.45 && HE.offer()) return true; // 의심이 높으면 바텐더가 한 잔 권함
  if (N.interrogate && !H.asked && H.t > N.interrogate) return HE.interrogate(0);
  if (H.dancing && H.danceEnd > 0 && Math.random() < 0.5 && HE.battle()) return true;
  const pool = [];
  for (const [k, w] of Object.entries(N.pool)) {
    if ((k === 'order' || k === 'floor' || k === 'offer') && H.loc !== 'bar') continue;
    if (k === 'vipHost' && H.dancing) continue;
    for (let i = 0; i < w; i++) pool.push(k);
  }
  for (let i = 0; i < 4; i++) { const k = pick(pool); if (HE[k]?.()) return true; }
  return false;
}

function hEncUpdate(dt, t) {
  const e = H.enc; if (!e) return;
  if (e.p && !e.p.alive && e.kind !== 'act') { H.enc = null; H.grace = Math.floor(audio.beat() ?? 0) + 3; return; }
  if (e.kind === 'choice') {
    e.t -= dt;
    const r = hRaised();
    for (const i of [0, 1]) { e.raise[i] = r[i] ? e.raise[i] + dt : 0; if (e.raise[i] > 0.35) return hEncChoose(i); }
    if (e.t <= 0) { audio.sfx('deny'); hEncFinish(e.timeout ?? 12, EL.timeout, TR('무응답', 'No answer')); }
  } else if (e.kind === 'act') {
    e.t -= dt;
    if (e.need === 'face') { e.prog = hHandsAtFace() ? e.prog + dt : Math.max(0, e.prog - dt * 0.5); if (e.prog >= e.hold) { audio.sfx('glug'); hEncFinish(e.ok.d, e.ok.reply, TR('성공', 'Done')); return e.after?.(true); } }
    if (e.need === 'raise') { const r = hRaised(); e.prog = (r[0] || r[1] || H.keyRaise > 0) ? e.prog + dt : 0; if (e.prog >= e.hold) { audio.sfx('click'); hEncFinish(e.ok.d, e.ok.reply, TR('짝짝짝', 'Clap clap')); return e.after?.(true); } }
    if (e.need === 'touch') {
      const hand = e.p?.armR.children[1];
      if (hand && !e.p.target) {
        hand.getWorldPosition(_cp); encHand.position.copy(_cp); encHand.visible = true; encHand.scale.setScalar(1 + 0.15 * Math.sin(t * 8));
        let touching = false; const hp = _cp.clone();
        for (const c of controllers) { if (!c.userData.input) continue; c.getWorldPosition(_hp); if (_hp.distanceTo(hp) < 0.14) touching = true; }
        if (touching) { e.touch += dt; for (const c of controllers) haptic(c, 0.4, 20); }
        if (e.touch > 1.6) { hEncFinish(15, EL.shakeLong, TR('손이 따뜻함!', 'Warm hand!')); return; }
        if (!touching && e.touch > 0.05) { audio.sfx('scanDone'); hEncFinish(e.ok.d, e.ok.reply, TR('완벽한 악수', 'Perfect handshake')); return; }
      }
    }
    if (H.enc === e && e.t <= 0) { audio.sfx('deny'); hEncFinish(e.fail.d, e.fail.reply, TR('실패', 'Failed')); e.after?.(false); }
  } else if (e.kind === 'battle') {
    const b = audio.beat() ?? 0, late = 0.22 * (audio.liveBpm || 120) / 60;
    if (b > e.n0 + 3 + late) {
      if (e.good >= 4) { audio.sfx('scanDone'); hEncFinish(-12, EL.battleOk, TR('배틀 승리', 'Battle won')); }
      else { audio.sfx('deny'); hEncFinish(14, EL.battleBad, TR('배틀 패배', 'Battle lost')); }
    }
  }
}
function hEncPose() {
  const e = H.enc; if (!e?.p || e.p.target) return;
  if (e.kind === 'act' && e.need === 'touch') e.p.armR.rotation.set(-1.45, 0, 0);
  else if (e.kind === 'choice') e.p.neck.rotation.x = 0.15;
}

// ── 메인 갱신 ─────────────────────────────

// ── 인간 모드 튜토리얼: 수습 잠입 ─────────────────────────────
// 이어폰 속 박자 학원 강사가 하나씩 알려 줌. 실제로 해야 넘어가고, 그동안 의심은 오르지 않음.
const H_TUT = { n: 0, dur: Infinity, pool: {}, urges: true, tutorial: true };
const hN = () => (H.pvp ? H_PVP : H.tutorial ? H_TUT : H_NIGHTS[H.night] || H_NIGHTS[0]);
const HT = { step: -1, t: 0, yawAcc: 0, lastYaw: null, hits: 0, ok: null, wait: 0, hp0: 0 };
const TUT_WHO = TR('이어폰 속 학원 강사', 'Earpiece instructor');
const hTutSay = (pc, vr) => hSay(`${TUT_WHO}: ${renderer.xr.isPresenting && vr ? vr : pc}`, 999);
const _ty = new THREE.Vector3();
function hCamYaw() { camera.getWorldDirection(_ty); return Math.atan2(-_ty.x, -_ty.z); }
const H_TUT_STEPS = [
  { // 0 인사
    enter() { hTutSay(TR('잘 들려요? 박자 학원 강사예요. 오늘은 수습 잠입이에요. 연습이니까 실수해도 안 걸려요. 하나씩 해 봐요.', 'Can you hear me? Beat Academy instructor here. Today is a practice infiltration — mistakes won\'t get you caught. One step at a time.')); },
    update() { return HT.t > 6; } },
  { // 1 둘러보기
    enter() { HT.yawAcc = 0; HT.lastYaw = hCamYaw();
      hTutSay(TR('먼저 주변을 둘러봐요. 마우스로 드래그해서 뒤까지 한 바퀴! 뒤쪽엔 댄스플로어가 있어요.', 'First, look around. Drag with the mouse — all the way behind you! The dance floor is back there.'),
        TR('먼저 고개를 돌려 주변을 둘러봐요. 뒤쪽엔 댄스플로어가 있어요.', 'First, turn your head and look around. The dance floor is behind you.')); },
    update() { const y = hCamYaw(); let d = y - HT.lastYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); HT.yawAcc += Math.abs(d); HT.lastYaw = y;
      return HT.yawAcc > (renderer.xr.isPresenting ? 1.6 : 2.6) || HT.t > 20; } },
  { // 2 게이지 · 감시
    enter() { H.watch = true; H.sus = 35;
      hTutSay(TR('맨 위 게이지가 「의심」이에요. 100이 되면 발밑 바닥이 열려요. 화면 테두리가 빨개지면 천장 카메라가 보고 있다는 뜻 — 그땐 실수가 두 배로 들켜요.', 'The top gauge is SUSPICION. At 100, the floor opens under you. When the screen edge turns red, the ceiling camera is watching — mistakes count double.')); },
    update() { if (HT.t > 8) { H.watch = false; return true; } } },
  { // 3 대답 고르기
    enter() { HT.ok = null; HT.wait = 0;
      hTutSay(TR('로봇이 말을 걸면 「로봇다운」 대답을 골라요. 1/2 키, 또는 화면 왼쪽/오른쪽 클릭.', 'When a robot talks to you, pick the ROBOTIC answer. Keys 1/2, or click the left/right side.'),
        TR('로봇이 말을 걸면 「로봇다운」 대답을 골라요. 고를 쪽 손(왼손/오른손)을 머리 위로 들면 돼요.', 'When a robot talks to you, pick the ROBOTIC answer. Raise the matching hand (left/right) above your head.')); },
    update() {
      if (HT.ok === null && !H.enc && HT.t > 4 && HT.wait === 0) {
        const p = hNear(); const d = ENC_TALK[1]; HT.wait = 1;
        if (p) hChoice({ who: d.who, q: d.q, p, time: 999, opts: [{ t: d.r, ok: true, reply: d.rr }, { t: d.h, ok: false, reply: d.hr }], onPick: (o) => { HT.ok = o.ok; HT.okT = HT.t; } });
        else HT.ok = true;
      }
      if (HT.ok === false && !H.enc) { HT.ok = null; HT.wait = 0; HT.t = 2; hTutSay(TR('그건 너무 인간 같은 대답이에요! 다시 해 봐요.', 'That was way too human! Try again.')); }
      return HT.ok === true && !H.enc && HT.t - HT.okT > 2.5; } },
  { // 4 땀
    enter() { H.sweat = 75; H.wipedOnce = false; H.tutSweat = true;
      hTutSay(TR('땀이 차오르죠? 땀 게이지가 꽉 차면 들켜요. F 키를 꾹 눌러서 닦아요.', 'Feel the sweat? If the sweat gauge fills, you\'re busted. Hold F to wipe it.'),
        TR('땀이 차오르죠? 땀 게이지가 꽉 차면 들켜요. 손을 이마(얼굴)에 대고 잠깐 유지해서 닦아요.', 'Feel the sweat? If the sweat gauge fills, you\'re busted. Hold a hand to your forehead (face) to wipe it.')); },
    update() { return H.sweat < 10 && HT.t > 1; } },
  { // 5 재채기
    enter() { HT.ok = null; H.tutSneeze = true;
      hTutSay(TR('코가 간질간질... 재채기가 나오면 얼굴을 가려서 참아요. 카운트가 끝날 때 F를 누르고 있어야 해요.', 'Nose itching... When a sneeze comes, cover your face. Keep holding F when the countdown ends.'),
        TR('코가 간질간질... 재채기가 나오면 손으로 얼굴을 가려서 참아요. 카운트가 끝날 때 손이 얼굴에 있어야 해요.', 'Nose itching... When a sneeze comes, cover your face with your hand. Keep it there when the countdown ends.')); },
    update() {
      if (HT.t > 3 && !H.sneeze && HT.ok === null) { H.sneeze = { t: 5 }; HT.ok = 'wait'; audio.sfx('tick'); }
      if (HT.ok === 'wait' && !H.sneeze) { if (H.sneezeOk) return true; HT.ok = null; HT.t = 0; hTutSay(TR('에취! 클럽이 조용해졌어요... 연습이니 다시 해 봐요. 얼굴을 끝까지 가려요.', 'ACHOO! The club went quiet... It\'s practice, try again. Keep your face covered.')); }
    } },
  { // 6 오일
    enter() { HT.ok = null; HT.hp0 = H.hp; H.sus = 45;
      hTutSay(TR('의심은 저절로 안 줄어요. 줄이는 방법은 딱 하나, 바텐더가 주는 오일을 마시는 것. 대신 체력이 하나 깎여요 — 하룻밤에 3캔째면 쓰러져요. 캔을 클릭해서 마셔 봐요.', 'Suspicion never drops on its own. The only way down: drink the oil the bartender gives you. It costs 1 HP — the third can in one night knocks you out. Click the can to drink.'),
        TR('의심은 저절로 안 줄어요. 줄이는 방법은 딱 하나, 바텐더가 주는 오일을 마시는 것. 대신 체력이 하나 깎여요 — 하룻밤에 3캔째면 쓰러져요. 캔을 잡아서 입에 대고 기울여요.', 'Suspicion never drops on its own. The only way down: drink the oil the bartender gives you. It costs 1 HP — the third can in one night knocks you out. Grab the can, tilt it to your mouth.')); },
    update() {
      if (HT.t > 5 && HT.ok === null && !H.enc) { HT.ok = 'wait'; HE.drinkOil(); }
      if (HT.ok === 'wait' && !H.enc) { if (H.hp < HT.hp0) return true; HT.ok = null; HT.t = 3; }
    } },
  { // 7 플로어 · 박자
    enter() { HT.hits = 0; HT.ok = null;
      hTutSay(TR('DJ가 「다들 플로어로!」 하면 나가야 해요. 가서 박자에 맞춰 Space(또는 클릭)! 회색 「쉼」 박에선 가만히. 6번 맞춰 봐요.', 'When the DJ calls everyone to the floor, go. Then hit Space (or click) on the beat! Stay still on grey "rest" beats. Land 6 hits.'),
        TR('DJ가 「다들 플로어로!」 하면 나가야 해요. 가서 박자에 맞춰 트리거(핀치)! 회색 「쉼」 박에선 가만히. 6번 맞춰 봐요.', 'When the DJ calls everyone to the floor, go. Then pull the trigger (pinch) on the beat! Stay still on grey "rest" beats. Land 6 hits.')); },
    update() {
      if (HT.t > 4 && HT.ok === null) { HT.ok = 'floor'; hGoto('floor'); }
      if (H.dancing && H.danceEnd > 0 && H.danceEnd < 1e8) H.danceEnd = 1e9; // 다 맞출 때까지 계속
      if (HT.ok === 'floor' && HT.hits >= 6) { HT.ok = 'back'; H.danceEnd = 0; H.dancing = false; hGoto('bar'); HT.t = 0; }
      return HT.ok === 'back' && HT.t > 1.2;
    } },
  { // 8 박수
    enter() { HT.ok = null;
      hTutSay(TR('마지막! 누가 바닥으로 끌려가면 로봇들은 박수를 쳐요. 같이 쳐야 해요 — R 키!', 'Last one! When someone gets dropped through the floor, robots applaud. You must clap too — press R!'),
        TR('마지막! 누가 바닥으로 끌려가면 로봇들은 박수를 쳐요. 같이 쳐야 해요 — 손을 머리 위로!', 'Last one! When someone gets dropped through the floor, robots applaud. You must clap too — raise a hand!')); },
    update() {
      if (HT.t > 3 && HT.ok === null) { HT.ok = 'wait';
        hAct({ who: TR('옆 로봇', 'Robot next to you'), need: 'raise', hold: 0.3, time: 6, q: TR('(짝짝짝) 로봇들이 박수를 친다!', '(clap clap) The robots are applauding!'),
          ok: { d: 0, reply: TR('짝. 짝. 짝. 영혼 없이. 완벽해요.', 'Clap. Clap. Clap. Soulless. Perfect.') }, fail: { d: 0, reply: TR('...안 쳤네요. 다시!', '...You didn\'t clap. Again!') }, after: (ok) => { HT.ok = ok ? 'done' : 'fail'; } }); }
      if (HT.ok === 'fail') { HT.ok = null; HT.t = 1; }
      return HT.ok === 'done' && HT.t > 4;
    } },
  { // 9 끝
    enter() { hTutSay(TR('완벽해요. 이제 진짜 금요일 밤이에요. 땀 조심, 재채기 조심, 그리고... 너무 즐기지 마세요. 즐거우면 티가 나요.', 'Perfect. Now it\'s a real Friday night. Watch the sweat, watch the sneezes, and... don\'t enjoy it too much. Fun shows.')); },
    update() { if (HT.t > 7 && !HT.leaving) { HT.leaving = true; try { localStorage.setItem('overclock.humanTut', '1'); } catch {} G.fadeTo = 1; setTimeout(() => hStartNight(0), 800); } } },
];
function hTutUpdate(dt) {
  if (HT.leaving) return;
  if (HT.step < 0) { HT.step = 0; HT.t = 0; H_TUT_STEPS[0].enter(); return; }
  HT.t += dt;
  if (H_TUT_STEPS[HT.step].update(dt)) {
    HT.step++; HT.t = 0; H.msgT = 0;
    if (HT.step < H_TUT_STEPS.length) H_TUT_STEPS[HT.step].enter();
  }
}

function updateHuman(dt, t) {
  audio.tick();
  fade.material.opacity += (G.fadeTo - fade.material.opacity) * Math.min(1, dt * 2.5);
  if (G.endT != null) G.endT -= dt;
  if (!renderer.xr.isPresenting) camera.rotation.set(pitch, yaw, 0);
  updateHands(dt);
  if (!H.active) return;
  const N = hN();
  const beat = audio.beat();
  H.keyRaise = Math.max(0, H.keyRaise - dt);
  hUpdateDrink(dt);
  if (H.fall) { // 덜컹 → 잠깐 흔들리다 아래로 쑥
    const f = H.fall; f.t += dt;
    if (f.t < 0.25) { rig.position.x += (Math.random() - 0.5) * 0.03; rig.position.z += (Math.random() - 0.5) * 0.03; rig.position.y = -0.05; }
    else { f.v += 9.8 * dt; rig.position.y -= f.v * dt; }
  }
  if (!H.ending && !H.between && !H.moving) {
    H.t += dt; H.msgT -= dt; H.fbT -= dt;
    // 감시 카메라
    if (H.pvp) pvpHumanWatch(); // 대결: 감시 = 상대가 나를 선택했을 때
    else if (!H.tutorial) H.watchT -= dt;
    if (H.watchT <= 0) { H.watch = !H.watch; H.watchT = H.watch ? rand(3.5, 5) : rand(6, 11); if (H.watch) { audio.sfx('tick'); if (Math.random() < 0.4 && H.msgT <= 0 && !H.enc) hSay(pick(HL.watch), 3.5); } }
    const atFace = hHandsAtFace();
    H.face = atFace ? H.face + dt : 0;
    // 이벤트
    H.evT -= dt;
    if (!H.tutorial && !H.enc && !H.bo && H.evT <= 0 && !H.sneeze && !H.freeze && H.t < N.dur - 6) { if (!hPickEvent()) H.evT = 3; }
    hEncUpdate(dt, t);
    if (H.tutorial) hTutUpdate(dt);
    // 잡담 / 경고
    H.chatT -= dt;
    if (!H.tutorial && H.chatT <= 0 && H.msgT <= 0 && !H.sneeze && !H.freeze && !H.enc) { H.chatT = rand(11, 16); hChat(pick(HL.chat)); }
    if (H.sus > 75 && !H.warned) { H.warned = true; hSay(pick(HL.high), 4.5); }
    if (H.sus < 50) H.warned = false;
    // 땀 (플로어에서 빨리 참) / 재채기
    if (N.urges) {
      if (!H.tutorial) H.sweat += dt * (H.dancing ? 3.2 : 1.1);
      if (!H.tutSweat && H.sweat > 35) { H.tutSweat = true; hSay(renderer.xr.isPresenting ? TR('땀이 난다! 땀 게이지가 차면 들킨다. 손을 얼굴(이마)에 대고 잠깐 유지해서 닦아라.', 'You\'re sweating! If the sweat gauge fills, you\'re busted. Hold a hand to your face (forehead) to wipe it.') : TR('땀이 난다! 땀 게이지가 차면 들킨다. F 키를 꾹 눌러서 닦아라.', 'You\'re sweating! If the sweat gauge fills, you\'re busted. Hold F to wipe it.'), 7); }
      const actFace = H.enc?.kind === 'act' && H.enc.need === 'face';
      if (H.face > 0.6 && H.sweat > 25 && !actFace) { H.sweat = 0; H.wipedOnce = true; hAddSus(H.watch ? 4 : 0, TR('땀 닦음', 'Wiped sweat')); if (H.msgT <= 0) hSay(pick(HL.wipe), 3.5); }
      if (H.sweat >= 100) { H.sweat = 45; if (H.pvp) pvpSend({ t: 'ev', e: 'drip' }); hAddSus(15, TR('땀이 뚝뚝!', 'Dripping sweat!')); hSay(pick(HL.sweatDrip), 4.5); }
      if (!H.sneeze) { H.sneezeT -= dt; if (H.sneezeT <= 0 && !H.enc && !H.tutorial) { H.sneeze = { t: H.tutSneeze ? 2.6 : 4 }; audio.sfx('tick');
        if (!H.tutSneeze) { H.tutSneeze = true; hSay(renderer.xr.isPresenting ? TR('재채기가 나오려 한다! 로봇은 재채기를 안 한다. 손으로 얼굴을 가려라.', 'A sneeze is coming! Robots don\'t sneeze. Cover your face with your hand.') : TR('재채기가 나오려 한다! 로봇은 재채기를 안 한다. F 키를 꾹 눌러 얼굴을 가려라.', 'A sneeze is coming! Robots don\'t sneeze. Hold F to cover your face.'), 5); } } }
      else {
        H.sneeze.t -= dt;
        if (H.sneeze.t <= 0) {
          H.sneezeOk = atFace;
          if (atFace) { hAddSus(H.watch ? 3 : 0, TR('재채기 참음!', 'Sneeze held!')); hSay(pick(HL.sneezeHeld), 4); }
          else { audio.sfx('cough'); if (H.pvp) pvpSend({ t: 'ev', e: 'sneeze' }); hAddSus(25, TR('에취!!', 'ACHOO!!')); hSay(pick(HL.sneezeFail), 5); }
          H.sneeze = null; H.sneezeT = rand(16, 24);
        }
      }
    }
    // 3일차: 정전 → 적외선. 얼굴에 얼음잔(얼굴에 손)으로 체온을 낮춰야
    if (N.blackout) {
      H.boT -= dt;
      if (H.boT <= 0 && !H.bo && H.enc) H.boT = 1; // 대화·음료 중이면 정전은 끝난 뒤에
      if (H.boT <= 0) {
        H.bo = !H.bo;
        if (H.bo) { H.boT = rand(7, 9); audio.sfx('powerDown'); hSay(TR('정전! 적외선 카메라에 내 체온이 다 보인다. 얼음잔을 얼굴에! (손을 얼굴에 / F)', 'Blackout! The infrared camera can see my body heat. Ice glass to my face! (hand to face / F)'), 4); }
        else { H.boT = rand(13, 18); audio.sfx('powerUp'); }
      }
      if (H.bo) {
        H.cool = atFace ? Math.min(3, H.cool + dt * 2) : Math.max(0, H.cool - dt * 0.7);
        if (H.watch && H.cool < 0.5) { H.sus = Math.min(100, H.sus + dt * 6); H.maxSus = Math.max(H.maxSus, H.sus); if (H.sus >= 100) hEnd(false); }
      } else H.cool = Math.max(0, H.cool - dt);
    }
    // 6일차: 동결 스캔
    if (N.freeze && beat != null) {
      if (!H.freeze) { H.freezeT -= dt; if (H.freezeT <= 0 && !H.enc) { H.freeze = { phase: 'warn', t: 2.2, moved: false }; audio.sfx('alarm'); hSay(TR('BENE-9 (방송): 「동결 스캔 3초 전. 전원 정지.」', 'BENE-9 (PA): "Freeze scan in 3. Everyone, stop."'), 2.2); } }
      else {
        H.freeze.t -= dt;
        const mv = hMotion(dt);
        if (H.freeze.phase === 'warn' && H.freeze.t <= 0) { H.freeze.phase = 'on'; H.freeze.t = 3; H.freeze.motion = 0; hMotion(dt); }
        else if (H.freeze.phase === 'on') {
          if (mv > 0.35) H.freeze.motion += dt;
          if (H.freeze.t <= 0) {
            if (H.freeze.moved || H.freeze.motion > 0.25) { hAddSus(20, TR('움직임 감지!', 'Motion detected!')); hSay(pick(HL.freezeFail), 4); }
            else { hAddSus(-5, TR('스캔 통과', 'Scan passed')); hSay(pick(HL.freezePass), 4); }
            H.freeze = null; H.freezeT = rand(16, 22);
            const nb = Math.floor(audio.beat() ?? 0); H.judged = Math.max(H.judged, nb); H.grace = nb + 5;
          }
        }
      }
    }
    // 5일차: 춤추는 중 리믹스
    if (N.remix && H.dancing && G.dj && audio.playing && !H.freeze) {
      H.rmT -= dt;
      if (H.rmT <= 0) { H.rmT = rand(9, 13); const r = pick([0.85, 1.15, 1.3].filter((x) => x !== audio.rate)); audio.setRate(r); audio.sfx('scratch'); hSay(pick(HL.remix), 3); H.grace = Math.floor(audio.beat() ?? 0) + 3; }
    }
    // 플로어: 박자 판정 & 춤 끝나면 바로 복귀
    if (H.dancing && beat != null && !hFrozen()) {
      if (H.judged < 0) H.judged = Math.floor(beat) + 1;
      if (H.grace === -2) { H.grace = Math.floor(beat) + (H.rally ? 3 : 5); H.danceEnd = H.grace + (H.rally ? 24 : H.stay ? 1e9 : 16); if (H.rally) H.rallyEnd = H.danceEnd; H.rally = false; }
      const lateBy = 0.22 * (audio.liveBpm || 120) / 60;
      if (beat - H.judged > 6) H.judged = Math.floor(beat);
      while (H.judged + lateBy < beat) {
        const n = H.judged++;
        if (!hRest(n) && !hGrace(n) && !H.hits.has(n) && !(H.freeze && H.freeze.phase === 'warn')) {
          PVP.acc *= 0.6; hAddSus(H.face > 0.2 ? 2 : 4, TR('박자 놓침', 'Missed beat'));
          if (++H.misses >= 4) { H.misses = 0; if (H.msgT <= 0) hChat(pick(HL.miss)); }
        } else if (H.hits.has(n)) H.misses = 0;
      }
      if (H.danceEnd > 0 && beat > H.danceEnd && !H.enc && !H.freeze) {
        audio.setRate(1);
        hSay(TR('(속마음) 다리가 후들거린다. 로봇은 지치지 않는다. 바로 돌아가자, 자연스럽게.', '(inner voice) My legs are shaking. Robots don\'t get tired. Back to the bar. Casually.'), 4);
        hGoto('bar');
      }
    }
    if (H.t >= N.dur && !H.enc && !H.freeze) hNightEnd();
  }
  // 정전 연출 (플레이어 눈에도 어두워지고, 로봇은 파랗게 / 내 손은 주황으로)
  club.dark += ((H.bo && !H.between ? 1 : 0) - club.dark) * Math.min(1, dt * 4);
  HAND_MAT.emissive.setHex(0xff5a1e); HAND_MAT.emissiveIntensity = club.dark * (H.cool > 0.5 ? 0.1 : 1.2);
  // 의심이 높으면 주변 로봇이 쳐다봄
  for (const p of club.patrons) if (p.role === 'guest' && p.alive && p !== H.enc?.p) {
    const d = p.root.position.distanceTo(hPos());
    if (H.sus > 65 && d < 3) { p.face = Math.atan2(hPos().x - p.root.position.x, hPos().z - p.root.position.z); if (p.state === 'dance') p.state = 'idle'; }
    else if (p.spotType === 'dance' && p.state === 'idle' && !p.target) p.state = 'dance';
  }
  // 감시 카메라
  if (H.cam) {
    const { body, led } = H.cam.userData, P = hPos();
    const look = H.watch ? Math.atan2(P.x - H.cam.position.x, P.z - H.cam.position.z) : H.cam.rotation.y + 0.4 * Math.sin(t * 0.5) * dt;
    H.cam.rotation.y = lerpAngle(H.cam.rotation.y, look, dt * 3);
    body.rotation.x = H.watch ? 0.55 : 0.35;
    led.material.color.setHex(H.watch && Math.sin(t * 12) > 0 ? 0xff2020 : 0x330000);
  }
  club.update(dt, t, hFrozen() ? null : beat);
  hEncPose();
  if (hFrozen()) for (const p of club.patrons) p._resetPose?.();
  // UI: 시선 따라오기 + 감시 중이면 화면 테두리 빨갛게
  hFollowUI(dt);
  hVrUi(dt, t);
  hWalkUpdate(dt);
  hVig.mesh.visible = !H.ending;
  { // 테두리 판을 실제 시야 크기에 맞춤 (VR은 시야가 넓어서 넉넉히)
    const hh = renderer.xr.isPresenting ? 0.36 : 0.3 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const hw = renderer.xr.isPresenting ? 0.42 : hh * camera.aspect;
    hVig.mesh.scale.set(2 * hw / 1.6, 2 * hh / 1.2, 1);
    hSweatFx.mesh.scale.set(2 * hw / 1.6 * 0.29 / 0.3, 2 * hh / 1.2 * 0.29 / 0.3, 1);
  }
  // 땀: 차오를수록 화면이 파래지고 땀방울이 눈앞에 (닦으면 바로 사라짐)
  {
    const k = H.ending || H.between || !(hN()?.urges) ? 0 : THREE.MathUtils.smoothstep(H.sweat, 25, 100);
    if (k < 0.05 && H.sweat < 5) sweatDrops.length = 0;
    hSweatFx.mesh.visible = k > 0.01 || sweatDrops.length > 0;
    sweatFxT -= dt;
    if (hSweatFx.mesh.visible && sweatFxT <= 0) { sweatFxT = 1 / 24; drawSweatFx(1 / 24, k); }
  }
  const vigGoal = H.between ? 0 : H.watch ? 0.75 + 0.2 * Math.sin(t * 6) : H.sus > 70 ? 0.18 + 0.12 * Math.sin(t * 4) : 0;
  hVig.material.opacity += (vigGoal - hVig.material.opacity) * Math.min(1, dt * 6);
  H.hudT -= dt; if (H.hudT <= 0) { H.hudT = 1 / 30; drawHumanHud(beat, t); }
  for (const b of hBoards) b.visible = !H.ending;
  hChalkT -= dt; if (hChalkT <= 0) { hChalkT = 0.2; drawChalk(hN()); }
}


// 간이 칠판: 바 카운터 위(작은 탁상용)만. 며칠째 · 그날 제목 · 남은 초(가장 크게)
const hChalk = new CanvasPanel(0.3, 0.2, 600, 400);
hChalk.material.fog = false;
const hBoards = [];
const CHALK_WOOD = flat(0xa8743e, { roughness: 0.85 });
function buildChalkboard(scale, standH) { // standH: 이젤 높이(칠판 가운데). 0이면 탁상용
  const g = new THREE.Group(), W = 0.3 * scale, Hh = 0.2 * scale, f = 0.012 * scale;
  const panel = new THREE.Group();
  const face = new THREE.Mesh(hChalk.mesh.geometry, hChalk.material); face.scale.setScalar(scale); face.position.z = 0.004;
  panel.add(face);
  for (const [x, y, w, h] of [[0, Hh / 2 + f / 2, W + 2 * f, f], [0, -Hh / 2 - f / 2, W + 2 * f, f], [W / 2 + f / 2, 0, f, Hh], [-W / 2 - f / 2, 0, f, Hh]])
    { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), CHALK_WOOD); m.position.set(x, y, 0); panel.add(m); } // 얇은 나무 테
  const back = new THREE.Mesh(new THREE.BoxGeometry(W, Hh, 0.004), flat(0x2a1a10)); back.position.z = -0.002; panel.add(back);
  const chalk = new THREE.Mesh(new THREE.CylinderGeometry(0.004 * scale, 0.004 * scale, 0.04 * scale, 6), flat(0xf4f1e8)); // 분필 한 자루
  chalk.rotation.z = Math.PI / 2; chalk.position.set(W * 0.28, -Hh / 2 - f - 0.004 * scale, 0.012); panel.add(chalk);
  panel.rotation.x = -0.22;
  if (standH) { // 이젤: 얇은 다리 셋
    panel.position.y = standH;
    for (const x of [-1, 1]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, standH + Hh * 0.4, 6), CHALK_WOOD); l.position.set(x * W * 0.38, (standH + Hh * 0.4) / 2 - 0.02, 0.03); l.rotation.set(-0.12, 0, -x * 0.05); g.add(l); }
    const bl = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, standH + 0.1, 6), CHALK_WOOD); bl.position.set(0, (standH + 0.1) / 2, -0.2); bl.rotation.x = 0.22; g.add(bl);
  } else { // 탁상용: 뒤 받침
    panel.position.y = Hh / 2 + f;
    const st = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, Hh * 0.9, 0.006), CHALK_WOOD); st.position.set(0, Hh * 0.45, -0.07); st.rotation.x = 0.4; g.add(st);
  }
  g.add(panel);
  club.scene.add(g); hBoards.push(g); g.visible = false;
  return g;
}
{
  const bar = buildChalkboard(0.85, 0); // 카운터 위, 벨 왼쪽. 플레이어를 바라봄
  bar.position.set(6.85, 1.15, 0.08); bar.rotation.y = Math.atan2(H_LOCS.bar.pos.x - 6.85, H_LOCS.bar.pos.z - 0.08);
}
let hChalkT = 0, hChalkKey = '';
function chalkText(c, text, x, y, font, color) { // 분필 글씨: 살짝 번진 테두리 + 거친 질감
  c.font = font; c.fillStyle = color;
  c.globalAlpha = 0.25; c.fillText(text, x + 1.5, y + 1); c.globalAlpha = 0.9; c.fillText(text, x, y); c.globalAlpha = 1;
}
function drawChalk(N) {
  const left = isFinite(N.dur) ? Math.max(0, Math.ceil(N.dur - H.t)) : null;
  const title = N.title || (H.tutorial ? TR('수습 잠입 · 연습', 'Trial Sneak-in · practice') : NIGHTS[N.n].title);
  const key = `${title}|${left}|${H.between}|${LANG}`; if (key === hChalkKey) return; hChalkKey = key;
  const { ctx: c, w, h } = hChalk;
  // 칠판 면: 짙은 녹색 + 가장자리 어둡게 + 지운 자국
  c.fillStyle = '#23332b'; c.fillRect(0, 0, w, h);
  const vg = c.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.7); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.35)'); c.fillStyle = vg; c.fillRect(0, 0, w, h);
  if (!hChalk.smudge) { hChalk.smudge = Array.from({ length: 40 }, () => [Math.random() * w, Math.random() * h, 40 + Math.random() * 120, Math.random() * 0.04]); }
  for (const [x, y, r, a] of hChalk.smudge) { c.fillStyle = `rgba(230,240,230,${a})`; c.beginPath(); c.ellipse(x, y, r, r * 0.3, -0.2, 0, 7); c.fill(); }
  const [day, name] = title.split('·').map((x) => x.trim());
  c.textBaseline = 'middle';
  // 왼쪽 위: 며칠째 + 제목 (작게)
  c.textAlign = 'left';
  chalkText(c, day, 30, 46, `800 40px ${FONT}`, '#ffc0d0');
  c.font = `600 24px ${FONT}`; chalkText(c, (name || '').length > 16 ? (name || '').slice(0, 15) + '…' : (name || ''), 30, 86, `600 24px ${FONT}`, '#e8e6dc');
  // 가운데 아래: 남은 초 (가장 크게)
  c.textAlign = 'center';
  if (H.between) chalkText(c, TR('영업 끝', 'CLOSED'), w / 2, 250, `900 84px ${FONT}`, '#bff5d0');
  else if (left == null) chalkText(c, TR('연습', 'PRACTICE'), w / 2, 250, `900 84px ${FONT}`, '#bff5d0');
  else {
    const str = String(left), col = left <= 15 ? '#ff9aa8' : '#f4f2ea';
    c.font = `900 170px ${FONT}`; const tw = c.measureText(str).width;
    chalkText(c, str, w / 2 - 18, 255, `900 170px ${FONT}`, col);
    c.textAlign = 'left'; chalkText(c, TR('초', 's'), w / 2 - 18 + tw / 2 + 8, 300, `800 40px ${FONT}`, '#cfccc0');
  }
  // 분필 가루 점
  for (let i = 0; i < 500; i++) { c.fillStyle = `rgba(35,51,43,${0.3 + Math.random() * 0.5})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  hChalk.commit();
}

// ── VR 인간 모드 UI: 왼손목 시계 · 손 위 선택지 카드 · 로봇 눈 색 · 심장 소리 ──
// 체력·의심·땀은 왼손목 시계에 (손목을 돌려 볼 때만 보임). 선택지는 해당 손 위에 카드로.
const hWatch = new THREE.Group();
const hWatchFace = new CanvasPanel(0.064, 0.064, 256, 256, { transparent: true });
{
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.075), flat(0x1b1b1b, { roughness: 0.9 }));
  strap.rotation.y = Math.PI / 2; // 손목 둘레 방향
  const caseM = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.008, 0.07), flat(0xc8ccd2, { metalness: 0.8, roughness: 0.35 }));
  caseM.position.y = 0.003;
  hWatchFace.mesh.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); hWatchFace.mesh.position.y = 0.0075; // 글자 위쪽 = 엄지 쪽
  hWatch.add(strap, caseM, hWatchFace.mesh);
  hWatch.visible = false;
}
let hWatchT = 0;
function drawWatch(t) {
  const { ctx: c, w, h } = hWatchFace, cx = w / 2;
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#05070a'; roundRect(c, 4, 4, w - 8, h - 8, 34); c.fill();
  const watched = H.watch && !H.between, blink = Math.sin(t * 10) > 0;
  c.strokeStyle = watched ? (blink ? '#ff2a3a' : '#5a0010') : '#2a3038'; c.lineWidth = 8; roundRect(c, 4, 4, w - 8, h - 8, 34); c.stroke();
  // 체력 (하트)
  for (let i = 0; i < H_HP_MAX; i++) drawHeart(c, cx - 40 + i * 40, 40, 15, clamp(H.hp - i, 0, 1));
  // 의심: 링 + 큰 숫자
  const s = H.sus / 100, col = H.sus > 70 ? '#ff2040' : H.sus > 40 ? '#ffb02e' : '#7dffb0';
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 14; c.beginPath(); c.arc(cx, 140, 66, Math.PI * 0.75, Math.PI * 2.25); c.stroke();
  if (s > 0.005) { c.strokeStyle = col; c.beginPath(); c.arc(cx, 140, 66, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * s)); c.stroke(); }
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = col; c.font = `900 56px ${FONT}`; c.fillText(Math.round(H.sus), cx, 136);
  c.fillStyle = '#c8d0d8'; c.font = `800 20px ${FONT}`; c.fillText(watched ? TR('감시 중!', 'WATCHED!') : TR('의심 %', 'SUSPICION'), cx, 180);
  // 땀
  if (hN()?.urges) {
    c.fillStyle = 'rgba(0,30,60,.9)'; roundRect(c, 46, 214, w - 92, 14, 7); c.fill();
    c.fillStyle = H.sweat > 70 ? '#4fb0ff' : '#2a6a9a'; roundRect(c, 46, 214, Math.max(14, (w - 92) * Math.min(1, H.sweat / 100)), 14, 7); c.fill();
  }
  hWatchFace.commit();
}
function hLeftHand() { // 왼손: 맨손이면 손목 관절, 컨트롤러면 손 모델
  for (const c of controllers) {
    const u = c.userData; if (u.input?.handedness !== 'left') continue;
    if (u.isHand) { const j = u.hand.joints?.wrist; return j ? { obj: j, pos: [0, 0.022, 0.035] } : null; }
    if (u.ctrlHand) return { obj: u.ctrlHand.root, pos: [0, 0.026, 0.11] };
  }
  return null;
}

// 선택지 카드 (왼손 위 = 1번, 오른손 위 = 2번)
const hCards = [0, 1].map(() => {
  const p = new CanvasPanel(0.24, 0.12, 512, 256, { transparent: true, depthTest: false });
  p.mesh.renderOrder = 60; p.mesh.visible = false; p.key = '';
  club.scene.add(p.mesh);
  return p;
});
function drawCard(p, i, e) {
  const prog = Math.min(1, e.raise[i] / 0.35), key = `${e.opts[i].t}|${(prog * 10) | 0}|${(e.t * 4) | 0}`;
  if (key === p.key) return; p.key = key;
  const { ctx: c, w, h } = p, sel = prog > 0;
  c.clearRect(0, 0, w, h);
  c.fillStyle = sel ? 'rgba(20,90,55,.92)' : 'rgba(12,8,24,.88)'; roundRect(c, 6, 6, w - 12, h - 12, 26); c.fill();
  c.strokeStyle = sel ? '#7dffb0' : '#ff5c8a'; c.lineWidth = 5; roundRect(c, 6, 6, w - 12, h - 12, 26); c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#f0fff6'; c.font = `700 34px ${FONT}`;
  const lines = wrapText(c, e.opts[i].t, w - 50).slice(0, 3);
  lines.forEach((l, k) => c.fillText(l, w / 2, 100 - (lines.length - 1) * 21 + k * 42));
  c.fillStyle = '#ffd0d8'; c.font = `800 24px ${FONT}`;
  c.fillText(i ? TR('오른손을 위로 ↑', 'Raise RIGHT hand ↑') : TR('↑ 왼손을 위로', '↑ Raise LEFT hand'), w / 2, h - 50);
  c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(30, h - 24, w - 60, 6);
  c.fillStyle = sel ? '#7dffb0' : '#ffb02e'; c.fillRect(30, h - 24, (w - 60) * (sel ? prog : Math.max(0, e.t / e.T)), 6);
  p.commit();
}

// 심장 소리 (의심이 높을수록 크고 빠르게)
function hThump(vol, delay = 0) {
  const a = audio.ctx; if (!a) return;
  const t0 = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(70, t0); o.frequency.exponentialRampToValueAtTime(38, t0 + 0.14);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
  o.connect(g); g.connect(audio.sfxG || a.destination); o.start(t0); o.stop(t0 + 0.2);
}
const VISOR_YEL = new THREE.Color(0xffc23b), VISOR_RED = new THREE.Color(0xff2030);
function hVrUi(dt, t) {
  const vr = renderer.xr.isPresenting, live = H.active && !H.ending && !H.between;
  // 손목시계
  const L = vr && live ? hLeftHand() : null;
  if (L) { if (hWatch.parent !== L.obj) L.obj.add(hWatch); hWatch.position.set(...L.pos); hWatch.visible = true; hWatchT -= dt; if (hWatchT <= 0) { hWatchT = 0.1; drawWatch(t); } }
  else hWatch.visible = false;
  // 손 위 선택지 카드
  const e = H.enc, show = vr && live && e?.kind === 'choice';
  for (const cd of hCards) cd.mesh.visible = false;
  if (show) {
    camera.getWorldPosition(_hp);
    for (const c of controllers) {
      const u = c.userData; if (!u.input) continue;
      const i = u.input.handedness === 'left' ? 0 : 1, cd = hCards[i];
      const src = u.isHand ? u.hand.joints?.wrist : c; if (!src) continue;
      src.getWorldPosition(cd.mesh.position); cd.mesh.position.y += 0.17;
      cd.mesh.lookAt(_hp); cd.mesh.visible = true; drawCard(cd, i, e);
    }
  }
  // 로봇 눈 색: 근처 로봇일수록, 의심이 높을수록 노랑 → 빨강
  const pos = hPos();
  for (const p of club.patrons) {
    if (!p.visor || p.role === 'dj') continue;
    if (!p.visorBase) p.visorBase = p.visor.material.emissive.clone();
    const near = live && p.role === 'guest' && p.root.position.distanceTo(pos) < 4.5;
    const goal = near && H.sus > 65 ? VISOR_RED : near && H.sus > 35 ? VISOR_YEL : p.visorBase;
    p.visor.material.emissive.lerp(goal, Math.min(1, dt * 3));
  }
  // 심장 소리 + 진동
  if (live && H.sus > 35) {
    const k = (H.sus - 35) / 65;
    H.hbT = (H.hbT ?? 0) - dt;
    if (H.hbT <= 0) {
      H.hbT = 60 / (62 + 88 * k);
      hThump(0.12 + 0.45 * k); hThump(0.08 + 0.3 * k, 0.17);
      if (k > 0.3) for (const c of controllers) haptic(c, 0.15 + 0.45 * k, 45);
    }
  } else H.hbT = 0;
}

// ── 직접 이동: 바 ↔ 댄스플로어 (PC: M 키 / 표지판 클릭 · VR: A/X 버튼 / 표지판을 손가락으로 톡) ──
const hWalkSign = new CanvasPanel(0.26, 0.085, 520, 170, { transparent: true });
hWalkSign.mesh.renderOrder = 40; hWalkSign.material.fog = false; hWalkSign.mesh.visible = false;
club.scene.add(hWalkSign.mesh);
let hWalkKey = '';
function hCanWalk() { return H.active && !H.ending && !H.between && !H.moving && !H.enc && !hFrozen() && !(H.freeze?.phase === 'warn') && !(H.walkCD > 0) && !H.tutorial; }
function hWalk() {
  if (!hCanWalk()) { audio.sfx('deny'); return; }
  const to = H.loc === 'bar' ? 'floor' : 'bar';
  const beat = audio.beat() ?? 0;
  if (to === 'bar' && H.rallyEnd > beat) hAddSus(10, TR('소집 중 이탈!', 'Left during rally!')); // 대결: 소집 춤 도중에 빠지면 수상
  H.walkCD = 3; H.stay = to === 'floor'; H.walkGo = true;
  audio.sfx('click');
  hGoto(to);
}
function drawWalkSign() {
  const on = hCanWalk() || H.walkCD > 0, toFloor = H.loc === 'bar', vr = renderer.xr.isPresenting;
  const key = `${toFloor}|${on}|${vr}|${LANG}`; if (key === hWalkKey) return; hWalkKey = key;
  const { ctx: c, w, h } = hWalkSign;
  c.clearRect(0, 0, w, h);
  c.fillStyle = on ? 'rgba(20,10,30,.88)' : 'rgba(20,20,20,.5)'; roundRect(c, 4, 4, w - 8, h - 8, 30); c.fill();
  c.strokeStyle = on ? '#ff5c8a' : '#555'; c.lineWidth = 5; roundRect(c, 4, 4, w - 8, h - 8, 30); c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = on ? '#ffe3ea' : '#888'; c.font = `900 52px ${FONT}`;
  c.fillText(toFloor ? TR('댄스플로어로 ▶', 'TO DANCE FLOOR ▶') : TR('◀ 바로', '◀ TO THE BAR'), w / 2, 66);
  c.fillStyle = on ? '#ffb0c4' : '#777'; c.font = `700 26px ${FONT}`;
  c.fillText(vr ? TR('A/X 버튼 · 손가락으로 톡', 'A/X button · tap with finger') : TR('M 키 · 클릭', 'M key · click'), w / 2, 128);
  hWalkSign.commit();
}
const _ws = new THREE.Vector3(), _wt = new THREE.Vector3();
function hWalkUpdate(dt) {
  H.walkCD = Math.max(0, (H.walkCD || 0) - dt);
  const show = H.active && !H.ending && !H.between && !H.tutorial;
  hWalkSign.mesh.visible = show && !H.moving;
  if (!show) return;
  // 지금 자리 앞 오른쪽 아래 (손 닿는 거리)
  const L = H_LOCS[H.loc];
  const vrW = renderer.xr.isPresenting; // VR: 손 닿는 곳 / PC: 화면 오른쪽 아래에 보이게
  hWalkSign.mesh.position.copy(L.pos).addScaledVector(hFwd(L.yaw), vrW ? 0.55 : 0.8).addScaledVector(hRight(L.yaw), vrW ? 0.4 : 0.42); hWalkSign.mesh.position.y = vrW ? 1.22 : 1.42;
  camera.getWorldPosition(_hp); hWalkSign.mesh.lookAt(_hp);
  drawWalkSign();
  // VR: A/X 버튼, 손가락으로 표지판 톡
  hWalkSign.mesh.getWorldPosition(_ws);
  for (const c of controllers) {
    const u = c.userData;
    const btn = !!u.input?.gamepad?.buttons?.[4]?.pressed;
    if (btn && !u.walkBtn) hWalk();
    u.walkBtn = btn;
    const tip = tipOf(u); let near = false;
    if (tip) { tip.getWorldPosition(_wt); near = _wt.distanceTo(_ws) < 0.08; }
    if (near && !u.walkPoke) { haptic(c, 0.5, 40); hWalk(); }
    u.walkPoke = near;
  }
}
function hClickWalk() { // PC: 표지판 클릭
  if (!hWalkSign.mesh.visible) return false;
  raycaster.setFromCamera(mouse.ndc, camera);
  if (!raycaster.intersectObject(hWalkSign.mesh).length) return false;
  hWalk(); return true;
}

// ── HUD ─────────────────────────────
// 그림자 있는 글자 (배경판 없이도 읽히게)
function hText(c, s, x, y, font, color, align = 'left', outline = true) {
  c.font = font; c.textAlign = align; c.textBaseline = 'middle';
  if (outline) { c.lineJoin = 'round'; c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,.85)'; c.strokeText(s, x, y); }
  c.fillStyle = color; c.fillText(s, x, y);
}
const SUB_FONT = (px) => `400 ${px}px "Pretendard", ${FONT}`; // 자막: 프리텐다드 레귤러
function hPill(c, x, y, w, h, fill, stroke) {
  c.fillStyle = fill; roundRect(c, x, y, w, h, Math.min(16, h / 2)); c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 2; roundRect(c, x, y, w, h, Math.min(16, h / 2)); c.stroke(); }
}
function drawHumanHud(beat, t) {
  const { ctx: c, w, h } = hHud, N = hN(), vr = renderer.xr.isPresenting;
  c.clearRect(0, 0, w, h);
  const cx = w / 2;
  drawHumanTop(t, N);
  // ② 큰 안내 (가운데 아래, 글자만)
  let big = '', col = '#ffe14a';
  const frozen = hFrozen(), warn = H.freeze?.phase === 'warn', e = H.enc;
  if (e?.kind === 'act') {
    big = e.need === 'face' ? (vr ? TR('손을 입으로 가져가서 유지', 'Hand to your mouth — hold it') : TR('F 키를 꾹', 'Hold F'))
      : e.need === 'raise' ? (vr ? TR('손을 머리 위로!', 'Raise a hand!') : TR('R 키!', 'Press R!'))
      : e.need === 'touch' ? EL.shakeVR
      : e.need === 'item' ? (vr ? TR('오일 캔을 잡아(그립/핀치) 입에 대고 기울이기', 'Grab the oil can (grip/pinch), tilt it to your mouth') : TR('카운터의 오일 캔을 클릭해서 마시기', 'Click the oil can on the counter to drink'))
      : EL.shakePC;
    if (e.need === 'item' && H.hp - (H.drink?.gold ? 1.5 : 1) <= 0) { big += TR('  (마지막 체력 — 마시면 쓰러짐)', '  (last HP — drinking will knock you out)'); col = '#ff6a7a'; }
  } else if (e?.kind === 'battle') { big = TR(`댄스 배틀! 노란 박 4개 ${e.good}/4`, `Dance battle! 4 yellow beats ${e.good}/4`); }
  else if (frozen) { big = TR('■ 동결 — 움직이지 마 ■', '■ FREEZE — DON\'T MOVE ■'); col = '#6fc3ff'; }
  else if (warn) { big = TR(`동결까지 ${Math.ceil(H.freeze.t)}`, `Freeze in ${Math.ceil(H.freeze.t)}`); col = '#6fc3ff'; }
  else if (H.bo && !H.between) { big = H.cool > 0.5 ? TR('얼음으로 식히는 중', 'Cooling down') : TR('적외선! 얼굴에 얼음 (손 / F)', 'INFRARED! Ice to face (hand / F)'); col = H.cool > 0.5 ? '#6fc3ff' : '#ff7a3a'; }
  else if (H.tutSweat && !H.wipedOnce && H.sweat > 35) { big = vr ? TR('손을 얼굴에 대고 유지 → 땀 닦기', 'Hand to face and hold → wipe sweat') : TR('F 꾹 → 땀 닦기', 'Hold F → wipe sweat'); col = '#7fc4ff'; }
  else if (H.sneeze) { big = TR(`에... 에... 얼굴 가려! ${Math.ceil(H.sneeze.t)}`, `Ah... ah... cover your face! ${Math.ceil(H.sneeze.t)}`); col = '#ffb02e'; }
  else if (H.dancing && beat != null && H.grace > 0 && H.grace < 1e8 && beat < H.grace - 0.25) { big = `${HL.grace} ${Math.max(1, Math.ceil(H.grace - 0.25 - beat))}`; col = '#7dffb0'; }
  else if (H.fbT > 0 && H.feedback) { big = H.feedback; col = /완벽|좋아|PERFECT|GOOD|통과|passed|참음|held|닦음|Wiped|로봇다운|Robotic|성공|Done|짝|Clap|승리|won/.test(big) ? '#7dffb0' : '#ff6a7a'; }
  if (big) hText(c, big, cx, 175, `900 40px ${FONT}`, col, 'center');
  if (e?.kind === 'act' && e.hold) { hPill(c, cx - 160, 205, 320, 14, 'rgba(0,0,0,.6)'); hPill(c, cx - 160, 205, 320 * Math.min(1, e.prog / e.hold), 14, '#7dffb0'); }
  // ③ 리듬 레인 (플로어에서만, 얇게)
  if (H.dancing) {
    const L = cx - 360, R = cx + 360, Y = 262, hitX = L + 90, ppb = 130;
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 3; c.beginPath(); c.moveTo(L, Y); c.lineTo(R, Y); c.stroke();
    if (beat != null && !frozen) {
      const n0 = Math.floor(beat) - 1;
      for (let n = n0; n < n0 + 8; n++) {
        const x = hitX + (n - beat) * ppb; if (x < L - 10 || x > R + 10) continue;
        if (H.danceEnd > 0 && n > H.danceEnd) continue;
        const rest = hRest(n) || hGrace(n) || warn;
        const bat = e?.kind === 'battle' && n >= e.n0 && n <= e.n0 + 3;
        c.fillStyle = H.hits.has(n) ? '#7dffb0' : rest ? 'rgba(255,255,255,.18)' : bat ? '#ffe14a' : '#ff5c8a';
        c.beginPath(); c.arc(x, Y, rest ? 8 : 15, 0, 7); c.fill();
      }
    }
    c.strokeStyle = '#ffe14a'; c.lineWidth = 4; c.beginPath(); c.arc(hitX, Y, 21, 0, 7); c.stroke();
    if (H.combo >= 4) hText(c, TR(`로봇 싱크 ${H.combo}`, `Robot sync ${H.combo}`), R, Y - 30, `800 22px ${FONT}`, '#7dffb0', 'right');
  }
  // ④ 선택지 카드 (자막 위 좌우)
  if (e?.kind === 'choice' && !vr) {
    [0, 1].forEach((i) => {
      const bw = 380, x = i ? cx + 16 : cx - 16 - bw, y = 312;
      const sel = e.raise[i] > 0;
      hPill(c, x, y, bw, 96, sel ? 'rgba(30,110,70,.85)' : 'rgba(14,10,28,.72)', sel ? '#7dffb0' : 'rgba(255,92,138,.6)');
      c.font = `600 23px ${FONT}`;
      wrapText(c, e.opts[i].t, bw - 30).slice(0, 2).forEach((l, k) => hText(c, l, x + 15, y + 28 + k * 30, `600 23px ${FONT}`, '#f0fff6'));
      hText(c, vr ? (i ? EL.pick2 : EL.pick) : (i ? EL.pickPC2 : EL.pickPC), i ? x + bw - 14 : x + 14, y + 80, `700 18px ${FONT}`, '#ffd0d8', i ? 'right' : 'left');
    });
    // 남은 시간 (얇은 선)
    hPill(c, cx - 300, 418, 600, 6, 'rgba(0,0,0,.5)'); hPill(c, cx - 300, 418, 600 * Math.max(0, e.t / e.T), 6, '#ffb02e');
  } else if (e?.kind === 'act') { hPill(c, cx - 300, 418, 600, 6, 'rgba(0,0,0,.5)'); hPill(c, cx - 300, 418, 600 * Math.max(0, e.t / e.T), 6, '#ffb02e'); }
  // ⑤ 자막 (아래 가운데, 글자 크기만큼만 배경)
  let lines = [];
  if (e && e.kind !== 'battle' && e.q && !(vr && e.p)) { c.font = SUB_FONT(26); lines = [{ t: e.who, sp: true }, ...wrapText(c, e.q, 690).slice(0, 3).map((t) => ({ t }))]; }
  else if (H.msgT > 0 && H.msg) { c.font = SUB_FONT(26); lines = wrapText(c, H.msg, 690).slice(0, 4).map((t) => ({ t })); }
  else if (H.night === 0 && H.t < 30) {
    lines = [{ t: vr ? TR('손을 얼굴에 = 닦기·가리기·마시기 · 손 들기 = 대답·박수 · 그립 = 위치 재조정', 'Hand to face = wipe/cover/drink · raise hand = answer/clap · grip = recenter')
      : TR('F 꾹 = 닦기·가리기·마시기 · 1/2 = 대답 · R = 박수 · Space = 박자 · 드래그 = 둘러보기', 'Hold F = wipe/cover/drink · 1/2 = answer · R = clap · Space = beat · drag = look'), dim: true }];
  }
  if (lines.length) {
    c.font = SUB_FONT(26);
    const lw = Math.min(740, Math.max(...lines.map((l) => c.measureText(l.t).width)) + 44), lh = 33, y0 = h - 30 - lines.length * lh;
    hPill(c, cx - lw / 2, y0 - 10, lw, lines.length * lh + 18, 'rgba(0,0,0,.55)');
    lines.forEach((l, i) => {
      const col = l.sp ? '#ffe14a' : l.dim ? '#9ab' : '#f0fff6';
      hText(c, (l.sp ? '' : '') + l.t, cx, y0 + 8 + i * lh, SUB_FONT(l.dim ? 20 : 26), col, 'center', false);
    });
  }
  // ⑥ 구석: 땀 게이지만 (왼쪽 아래, 작게)
  if (N.urges && !vr) {
    const gx = 18, gy = h - 58;
    hPill(c, gx, gy, 250, 44, 'rgba(0,0,0,.5)');
    hText(c, TR('땀', 'SWEAT'), gx + 14, gy + 22, `800 18px ${FONT}`, '#bfe9ff');
    hPill(c, gx + 70, gy + 14, 166, 16, 'rgba(0,20,40,.8)');
    hPill(c, gx + 70, gy + 14, 166 * Math.min(1, H.sweat / 100), 16, H.sweat > 70 ? '#4fb0ff' : '#2a6a9a');
    if (H.sweat > 60) hText(c, vr ? TR('얼굴에 손!', 'hand to face!') : TR('F 꾹', 'hold F'), gx + 256, gy + 22, `700 18px ${FONT}`, '#bfe9ff');
  }
  if (vr) { // 높이 진단 (임시): 기기 머리 높이 · rig 높이 · 실제 눈높이
    camera.getWorldPosition(_hp);
    hText(c, `DBG pose ${camera.position.y.toFixed(2)} rig ${rig.position.y.toFixed(2)} eye ${_hp.y.toFixed(2)} ref ${renderer.xr.getReferenceSpace?.() ? (renderer.xr._refType || '') : ''}`, cx, 20, `700 22px ${FONT}`, '#ffb02e', 'center');
  }
  hHud.commit();
}
function drawEncHud() { /* 자막/선택지 카드로 통합됨 */ }
function drawHeart(c, x, y, r, full) { // 체력 아이콘 (이모지 대신 도형)
  c.beginPath();
  c.moveTo(x, y + r * 0.9);
  c.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.9, y - r * 1.2, x, y - r * 0.45);
  c.bezierCurveTo(x + r * 0.9, y - r * 1.2, x + r * 1.5, y - r * 0.1, x, y + r * 0.9);
  c.closePath();
  // full: 1 = 꽉 참, 0.5 = 반, 0 = 빈 하트
  c.strokeStyle = '#6a4a54'; c.lineWidth = 3; if (full < 1) c.stroke();
  if (full > 0) { c.save(); c.clip(); c.fillStyle = '#ff3a5c'; c.fillRect(x - r * 2, y - r * 2, r * 4 * Math.min(1, full), r * 4); c.restore(); }
}
// 상단 바: n일차 제목 + 큰 의심 게이지 + 감시 중
function drawHumanTop(t, N) {
  const { ctx: c, w, h } = hTop, cx = w / 2;
  c.clearRect(0, 0, w, h);
  // 며칠째 · 제목 · 남은 시간은 바/플로어의 칠판에 (drawChalk)
  // 체력 (음료를 마실 때마다 1 감소)
  for (let i = 0; i < H_HP_MAX; i++) drawHeart(c, cx - 600 + i * 46, 52, 17, clamp(H.hp - i, 0, 1));
  // 의심 게이지 (크게)
  const gx = cx - 470, gw = 940, gy = 100, gh = 42;
  hText(c, TR('의심', 'SUSPICION'), gx, gy + gh / 2, `900 30px ${FONT}`, '#ffd0d8', 'left');
  const bx = gx + 120, bw = gw - 120;
  hPill(c, bx, gy, bw, gh, 'rgba(40,0,14,.75)', 'rgba(255,255,255,.25)');
  const col = H.sus > 70 ? '#ff2040' : H.sus > 40 ? '#ffb02e' : '#7dffb0';
  if (H.sus > 0.5) hPill(c, bx, gy, Math.max(gh, bw * H.sus / 100), gh, col);
  hText(c, `${Math.round(H.sus)}%`, bx + bw - 16, gy + gh / 2, `800 26px ${FONT}`, '#fff', 'right');
  for (const m of [0.4, 0.7]) { c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(bx + bw * m, gy + 4, 2, gh - 8); }
  // 감시 중
  if (H.watch && !H.between) {
    const on = Math.sin(t * 8) > -0.3;
    hPill(c, cx - 200, 168, 400, 50, 'rgba(120,0,16,.8)', '#ff3050');
    c.fillStyle = on ? '#ff2a3a' : '#5a0010'; c.beginPath(); c.arc(cx - 162, 193, 11, 0, 7); c.fill();
    hText(c, TR('감시 중 — CCTV가 보고 있다', 'WATCHED — CCTV on you'), cx + 15, 194, `800 26px ${FONT}`, '#ffd0d6', 'center');
  }
  hTop.commit();
}

// ── 메인 루프 ─────────────────────────────
function update(dt, t) {
  pvpTick(dt);
  if (H.active || G.state === 'human') { updateHuman(dt, t); return; }
  audio.tick();
  updateDialog(dt);
  if (room.guide.mesh.visible) { G.guideT = (G.guideT || 0) - dt; if (G.guideT <= 0) { G.guideT = 0.1; drawGuide(t); } }
  if (G.recenterT > 0) { G.recenterT -= dt; if (G.recenterT <= 0) recenter(); }

  if (G.state === 'night') {
    G.time -= dt; G.elapsed += dt;
    const sp = G.cfg.spawns;
    while (G.spawnIdx < sp.length && G.elapsed >= sp[G.spawnIdx][0]) spawnPatron(sp[G.spawnIdx++][1], false);
    G.barkT -= dt;
    if (G.barkT <= 0) { G.barkT = rand(22, 32); if (!D.bark && G.cfg.barks.length) bark(BENE, pick(G.cfg.barks), 6); }
    if (G.cfg.blackout) {
      G.boT -= dt;
      if (G.boT <= 0) {
        G.boOn = !G.boOn;
        if (G.boOn) { G.boT = rand(7, 9); G.boFlick = 0.7; audio.sfx('powerDown'); if (!D.bark) bark(SYS, TR('정전! CCTV를 적외선 모드로 전환합니다.', "Blackout! Switching CCTV to infrared."), 3); }
        else { G.boT = rand(13, 18); G.boFlick = 0.4; audio.sfx('powerUp'); }
      }
    }
    if (G.cfg.remix && G.dj && audio.playing) {
      G.rmT -= dt;
      if (G.rmT <= 0) {
        G.rmT = rand(13, 19);
        const r = pick([0.8, 0.9, 1.15, 1.3].filter((x) => x !== audio.rate));
        audio.setRate(r); audio.sfx('scratch');
        bark(G.dj.name, pick(r > 1 ? LINES.remixUp : LINES.remixDown), 3);
      }
    }
    if (G.time <= 0) { G.time = 0; endNight(); }
  }
  // 정전 연출: 깜빡이며 꺼지고 켜짐. 모니터는 적외선 색으로
  const darkGoal = G.state === 'night' && G.boOn ? 1 : 0;
  club.dark += (darkGoal - club.dark) * Math.min(1, dt * (darkGoal ? 3 : 5));
  if (G.boFlick > 0) { G.boFlick -= dt; club.dark = Math.random() < 0.5 ? 0.9 : 0.15; } // 형광등처럼 깜빡
  for (const m of room.monitors) m.uniforms.tint.value.lerpVectors(m.baseTint, THERMAL_TINT, club.dark);
  if (G.scanning) {
    G.scanning.t += dt;
    const p = G.scanning.p;
    if (!p.alive) G.scanning = null;
    else if (G.scanning.t >= 1.7) {
      p.scanned = true; G.scanning = null; audio.sfx('scanDone');
      if (p.isHuman) G.tut.scannedHuman = true;
      else if (G.cfg.tutorial) bark(BENE, LINES.scanRobotTut, 5);
    }
  }
  if (G.djSwapT > 0) { G.djSwapT -= dt; if (G.djSwapT <= 0 && canAct()) spawnDJ(false, true); }
  if (G.roomScanT != null && !G.roomScanDone) {
    G.roomScanT += dt;
    if (G.roomScanT >= 2.6) { G.roomScanDone = true; audio.sfx('scanDone'); room.monitors.forEach((m) => (m.uniforms.glitch.value = 1.5)); }
  }
  if (G.sel && G.sel.gone) G.sel = null;
  if (G.endT != null) G.endT -= dt;
  if (G.endingFall && rig.position.y > -3) rig.position.y -= dt * 1.2;
  fade.material.opacity += (G.fadeTo - fade.material.opacity) * Math.min(1, dt * 2.5);

  const beat = audio.beat() ?? (G.state === 'title' ? t * 2 : null);
  club.update(dt, t, beat);
  club.setMarkers(G.hover, G.sel, t);
  updateZoom(dt, t);
  if (!renderer.xr.isPresenting) camera.rotation.set(pitch, yaw, 0);
  updateHands(dt);
  if (LOBBY.active) lobbyUpdate(dt, t); // 지하에선 보안실 버튼·물건·레이를 건드리지 않음
  else { updatePoke(); updateItems(dt); updatePointers(); }
  room.update(dt, t);
  updatePanels(dt, t);
}

let frameNo = 0;
function renderCCTV() {
  const xrOn = renderer.xr.enabled;
  const prev = renderer.getRenderTarget();
  renderer.xr.enabled = false;
  renderer.setRenderTarget(room.zoom.rt); renderer.render(club.scene, club.zoomCam);
  const perFrame = renderer.xr.isPresenting ? 1 : 2; // VR에선 프레임당 1대씩 → CCTV다운 끊김
  for (let k = 0; k < perFrame; k++) {
    const m = room.cams[(frameNo * perFrame + k) % 4];
    renderer.setRenderTarget(m.rt); renderer.render(club.scene, m.cam);
  }
  renderer.setRenderTarget(prev);
  renderer.xr.enabled = xrOn;
  frameNo++;
}


// ═════════════ lobby.js — 메인 화면: AR 「OVERCLOCK 단말기」 ═════════════
// 퀘스트(AR): 내 방(패스스루) 위에 레트로 컴퓨터 · 디스크 두 장 · 네온 간판이 뜸. PC: 같은 물건을 어두운 빈 공간에.
// 디스크를 집어 드라이브에 넣으면 화면에 모드 설명 → 키보드 숫자 키로 튜토리얼/플레이/하드 고르기.
const LOBBY = { scene: new THREE.Scene(), active: true, discs: [], keys: [], inserted: null, starting: null, hoverT: 0, screen: null, hits: [] };
const LOBBY_SPOT = new THREE.Vector3(0, 0, 0);          // 플레이어 자리
const STAND_Y = 0.86, STAND_Z = -0.5;                     // 받침대 윗면 높이 · 위치
const SLOT = new THREE.Vector3(-0.02, STAND_Y + 0.035, STAND_Z + 0.118); // 디스크 드라이브 입구
const LOBBY_BG = new THREE.Color(0x060608);
const DISC_INFO = {
  oil: {
    title: TR('오일 모드', 'OIL MODE'), color: 0x1b1b1b, accent: '#ffd400',
    body: TR('로봇처럼 일하고 오일 값을 버세요.\n클럽 오버클럭 보안실에서 CCTV를 지켜보며, 로봇인 척 숨어든 무허가 흥분 인간들을 찾아내 안전하게 귀가시키는 일입니다.\n근무 수칙: 의심되면 스캔, 확실하면 귀가 조치. 로봇을 잘못 떨어뜨리면 민원.',
      'Work like a robot, earn your oil.\nFrom the OVERCLOCK security room, watch the CCTV, find the Unlicensed Excited Humans posing as robots, and send them safely home.\nRules: suspicious? Scan. Certain? Eject. Drop a robot by mistake and you get a complaint.'),
    tut: 'overclock.secTut',
  },
  cocktail: {
    title: TR('칵테일 모드', 'COCKTAIL MODE'), color: 0xff5fa8, accent: '#ff8aa8',
    body: TR('은박지 한 롤과 식용유 향수, 그리고 용기.\n로봇인 척 클럽 오버클럭에 잠입해 엿새 밤을 버티세요. 박자는 정확히, 표정은 없이, 땀은 몰래 닦고, 재채기는 삼키세요.\n들키면 발밑의 바닥이 열립니다. 그래도... 춤추고 싶잖아요?',
      'A roll of tin foil, cooking-oil cologne, and courage.\nSneak into OVERCLOCK as a robot and survive six nights. Keep the beat exact, your face blank, wipe your sweat in secret, swallow your sneezes.\nGet caught and the floor opens. But... you want to dance, don\'t you?'),
    tut: 'overclock.humanTut',
  },
  pvp: {
    title: TR('대결 모드', 'VERSUS'), color: 0x1f4fd8, accent: '#6ab0ff',
    body: TR('감시로봇 1명 vs 인간 최대 4명. 한 클럽에서.\n감시로봇: 손님 중 진짜 인간 플레이어들을 전부 찾아 귀가시키면 승리. 로봇을 3번 잘못 떨어뜨리면 영업 정지(패배).\n인간: 150초 동안 들키지 않으면 승리. 자리는 무작위.',
      '1 Security vs up to 4 Humans, one club.\nSecurity: find and eject every real human player. Eject 3 robots by mistake and the club shuts down (you lose).\nHumans: survive 150 seconds undetected. Spots are random.'),
  },
};
(function buildLobby() {
  const s = LOBBY.scene;
  s.background = LOBBY_BG;
  s.add(new THREE.HemisphereLight(0xc8d0e0, 0x302830, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(0.6, 2.4, 1.2); s.add(key);
  // PC용: 바닥에 은은한 원형 빛 (AR에선 숨김)
  const glowFloor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), new THREE.MeshBasicMaterial({ map: canvasTexture(256, 256, (c, w) => { const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(255,42,109,.25)'); g.addColorStop(1, 'rgba(255,42,109,0)'); c.fillStyle = g; c.fillRect(0, 0, w, w); }), transparent: true, depthWrite: false }));
  glowFloor.rotation.x = -Math.PI / 2; glowFloor.position.set(0, 0.002, STAND_Z); s.add(glowFloor); LOBBY.pcOnly = [glowFloor];
  // 네온 간판
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: canvasTexture(1024, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = '#ff2a6d'; c.shadowBlur = 34; c.fillStyle = '#ff5c8a'; c.font = `900 120px ${FONT}`; c.fillText('OVERCLOCK', w / 2, h / 2 - 18);
    c.shadowBlur = 16; c.font = `800 38px ${FONT}`; c.fillStyle = '#ffd0dc'; c.fillText('C L U B   ·   R O B O T S   O N L Y', w / 2, h / 2 + 76);
  }), transparent: true, toneMapped: false, depthWrite: false }));
  neon.position.set(0, 1.95, -2.8); s.add(neon); LOBBY.neon = neon;
  // 받침대
  const stand = new THREE.Group(); stand.position.set(0, 0, STAND_Z); s.add(stand);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.04, 0.5), flat(0x2a2c30, { metalness: 0.5, roughness: 0.5 })); top.position.y = STAND_Y - 0.02; stand.add(top);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, STAND_Y - 0.04, 12), flat(0x1b1c20, { metalness: 0.6 })); pole.position.y = (STAND_Y - 0.04) / 2; stand.add(pole);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.27, 0.03, 20), flat(0x1b1c20, { metalness: 0.6 })); foot.position.y = 0.015; stand.add(foot);
  LOBBY.legs = [pole, foot]; // AR에선 숨김: 테이블 높이를 내 눈높이에 맞추니까 바닥까지 닿지 않음
  const neonEdge = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.006, 0.006), glow(0xff2a6d, 2)); neonEdge.position.set(0, STAND_Y - 0.035, 0.25); stand.add(neonEdge);
  // 레트로 컴퓨터: 본체(디스크 드라이브) + CRT 모니터
  const beige = flat(0xd8cfb8, { roughness: 0.7 }), beigeDark = flat(0xb8ae96, { roughness: 0.8 });
  const pc = new THREE.Group(); pc.position.set(-0.05, STAND_Y, STAND_Z - 0.02); s.add(pc);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.28), beige); base.position.y = 0.035; pc.add(base);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.008, 0.01), flat(0x0a0a0a)); slot.position.set(SLOT.x + 0.05, 0.035, 0.141); pc.add(slot);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.004), new THREE.MeshBasicMaterial({ color: 0x113311 })); led.position.set(0.13, 0.035, 0.141); pc.add(led); LOBBY.led = led;
  const mon = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.26), beige); mon.position.set(0, 0.07 + 0.14, -0.02); pc.add(mon);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.01), beigeDark); bezel.position.set(0, 0.21, 0.115); pc.add(bezel);
  LOBBY.screen = new CanvasPanel(0.25, 0.19, 640, 486);
  LOBBY.screen.mesh.position.set(0, 0.21, 0.122); pc.add(LOBBY.screen.mesh);
  const brand = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.018), new THREE.MeshBasicMaterial({ map: canvasTexture(256, 46, (c, w, h) => { c.fillStyle = '#b8ae96'; c.fillRect(0, 0, w, h); c.fillStyle = '#5a5040'; c.font = `800 30px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('OVERCLOCK OS', w / 2, h / 2); }) }));
  brand.position.set(0, 0.093, 0.1205); pc.add(brand);
  // 키보드: [1][2][3] + [한/A]
  const kb = new THREE.Group(); kb.position.set(-0.05, STAND_Y, STAND_Z + 0.17); kb.rotation.x = 0.08; s.add(kb);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.11), beige); board.position.set(-0.03, 0.0125, 0); kb.add(board);
  const keyLabel = (txt, bg = '#efe8d6', fg = '#2a2418', edge = '#b8ae96') => canvasTexture(128, 128, (c, w, h) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.strokeStyle = edge; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8); c.fillStyle = fg; c.font = `900 ${txt.length > 1 ? 44 : 72}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, w / 2, h / 2 + 4); });
  const mkKey = (id, txt, x, w = 0.055, orange = false) => {
    const side = orange ? flat(0xd8681c, { roughness: 0.6 }) : beigeDark;
    const k = new THREE.Mesh(new THREE.BoxGeometry(w, 0.022, 0.055), [side, side, new THREE.MeshStandardMaterial({ map: orange ? keyLabel(txt, '#ff8a2a', '#2a1200', '#c8601a') : keyLabel(txt) }), side, side, side]);
    k.position.set(x, 0.036, 0); kb.add(k);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.06, 0.075), new THREE.MeshBasicMaterial({ visible: false })); hit.position.copy(k.position); hit.userData.lobby = { type: 'key', id }; kb.add(hit);
    const o = { id, mesh: k, press: 0, pokeHeld: false }; LOBBY.keys.push(o); return o;
  };
  mkKey('esc', 'ESC', -0.19, 0.06, true); // 뒤로 가기 (주황)
  mkKey('1', '1', -0.11); mkKey('2', '2', -0.045); mkKey('3', '3', 0.02); mkKey('lang', TR('EN', '한'), 0.115, 0.07);
  // 디스크 두 장 (3.5인치 플로피)
  const mkDisc = (kind, z, rotY) => {
    const info = DISC_INFO[kind], g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.004, 0.094), flat(info.color, { roughness: 0.5 })); g.add(body);
    const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.0046, 0.034), flat(0xc8ccd2, { metalness: 0.9, roughness: 0.3 })); shutter.position.set(0, 0, -0.03); g.add(shutter);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.05), new THREE.MeshBasicMaterial({ map: canvasTexture(256, 184, (c, w, h) => {
      c.fillStyle = '#f4efe2'; c.fillRect(0, 0, w, h); c.fillStyle = info.accent; c.fillRect(0, 0, w, 26);
      c.fillStyle = '#1a1a1a'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `900 40px ${FONT}`; c.fillText(info.title, w / 2, 86);
      c.font = `600 22px ${FONT}`; c.fillStyle = '#5a5040'; c.fillText(kind === 'oil' ? TR('감시 모드', 'Security') : kind === 'pvp' ? TR('1 : 1 대결', '1 vs 1') : TR('인간 모드', 'Human'), w / 2, 136);
    }) }));
    label.rotation.x = -Math.PI / 2; label.position.set(0, 0.0025, 0.012); g.add(label);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.13), new THREE.MeshBasicMaterial({ visible: false })); hit.userData.lobby = { type: 'disc', kind }; g.add(hit);
    g.position.set(0.27, STAND_Y + 0.003, z); g.rotation.y = rotY; s.add(g);
    const d = { kind, g, home: g.position.clone(), homeQ: g.quaternion.clone(), held: null, anim: null }; LOBBY.discs.push(d); return d;
  };
  mkDisc('oil', STAND_Z - 0.13, -0.12); mkDisc('cocktail', STAND_Z + 0.0, 0.1); mkDisc('pvp', STAND_Z + 0.13, -0.06);
  s.add(rig);
})();

// ── 화면 ──
function lobbyOptions() {
  const d = LOBBY.inserted; if (!d) return [];
  const info = DISC_INFO[d.kind], opts = [];
  if (d.kind === 'pvp') return [{ label: TR('감시로봇 (방 열기)', 'Security (host)') }, { label: TR('인간 대기열', 'Human queue') }, { label: TR('코드로 참가 · 인간', 'Join by code · Human') }];
  if (!lsGet(info.tut)) opts.push({ mode: 'tut', label: TR('튜토리얼', 'Tutorial') });
  opts.push({ mode: 'play', label: TR('플레이', 'Play') });
  if (d.kind === 'oil') opts.push({ mode: 'hard', label: TR('하드 모드', 'Hard mode'), locked: !lsGet('overclock.cleared') });
  return opts;
}
function lobbyDrawScreen(t) {
  const { ctx: c, w, h } = LOBBY.screen, d = LOBBY.inserted;
  c.fillStyle = '#04120a'; c.fillRect(0, 0, w, h);
  c.textAlign = 'left'; c.textBaseline = 'top';
  const green = '#7dffb0', cursor = Math.sin(t * 6) > 0 ? '▌' : '';
  c.fillStyle = '#3a8a5a'; c.font = `600 18px ${FONT}`; c.fillText('OVERCLOCK OS v2.087', 18, 14);
  c.textAlign = 'right'; c.fillText('build 1006-h8', w - 18, 14); // 퀘스트에서 최신 버전인지 확인용
  if (renderer.xr.isPresenting) { // 높이 진단: 눈(기기) · 눈(실제) · 테이블
    camera.getWorldPosition(_lv);
    c.fillStyle = '#ffb02e'; c.fillText(`eye ${camera.position.y.toFixed(2)} → ${_lv.y.toFixed(2)} · table ${STAND_Y.toFixed(2)}`, w - 18, 36);
  }
  c.textAlign = 'left';
  if (LOBBY.starting) { c.fillStyle = green; c.font = `800 34px ${FONT}`; c.fillText(TR('불러오는 중', 'LOADING') + '.'.repeat(1 + Math.floor(t * 3) % 3), 18, 200); }
  else if (!d) {
    c.fillStyle = green; c.font = `800 30px ${FONT}`; c.fillText(TR('디스크를 넣으세요', 'INSERT DISK') + cursor, 18, 150);
    c.fillStyle = '#5ab884'; c.font = `500 20px ${FONT}`;
    wrapText(c, renderer.xr.isPresenting ? TR('옆에 놓인 디스크를 집어서 본체 앞쪽 드라이브 구멍에 가져다 대세요.', 'Grab a disk beside the computer and bring it to the drive slot on the front.') : TR('옆에 놓인 디스크를 클릭하면 드라이브에 들어갑니다.', 'Click a disk beside the computer to insert it.'), w - 36).forEach((l, i) => c.fillText(l, 18, 210 + i * 28));
    c.fillStyle = '#ffd400'; c.fillText(TR('오일 = 감시 · 칵테일 = 인간 · 파랑 = 대결', 'OIL = Security · COCKTAIL = Human · BLUE = Versus'), 18, 300);
  } else if (d.kind === 'pvp' && PVP.stage) pvpDrawScreen(c, w, h, cursor);
  else {
    const info = DISC_INFO[d.kind];
    c.fillStyle = info.accent; c.font = `900 32px ${FONT}`; c.fillText(info.title, 18, 44);
    c.fillStyle = '#c8f0d8'; c.font = `500 17px ${FONT}`;
    let y = 90; for (const para of info.body.split('\n')) { for (const l of wrapText(c, para, w - 36)) { c.fillText(l, 18, y); y += 23; } y += 6; }
    const opts = lobbyOptions();
    c.font = `800 22px ${FONT}`;
    opts.forEach((o, i) => { c.fillStyle = o.locked ? '#4a6a5a' : green; c.fillText(`[${i + 1}] ${o.label}${o.locked ? TR('  (엔딩 후 해금)', '  (unlocks after an ending)') : ''}`, 18 + (i % 2) * 300, h - 70 + Math.floor(i / 2) * 32); });
    c.fillStyle = '#5ab884'; c.font = `500 16px ${FONT}`; c.fillText(TR('키보드 숫자 키를 누르세요 · ESC = 디스크 빼기', 'Press a number key · ESC = eject disk') + cursor, 18, h - 100);
  }
  // 주사선
  c.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 2);
  LOBBY.screen.commit();
}

// ── 디스크 넣기 / 빼기 ──
function lobbyInsert(d) {
  if (LOBBY.starting) return;
  if (LOBBY.inserted && LOBBY.inserted !== d) lobbyEject(LOBBY.inserted);
  d.held = null; LOBBY.inserted = d; d.anim = { t: 0, from: d.g.position.clone(), fromQ: d.g.quaternion.clone(), insert: true };
  audio.init(); audio.sfx('clunk'); audio.sfx('scan');
}
function lobbyEject(d) {
  if (d.kind === 'pvp' && !PVP.on) pvpReset();
  if (LOBBY.inserted === d) LOBBY.inserted = null;
  d.anim = { t: 0, from: d.g.position.clone(), fromQ: d.g.quaternion.clone(), insert: false };
  audio.sfx('click');
}
function lobbyKey(id) {
  const k = LOBBY.keys.find((k) => k.id === id); if (k) k.press = 1;
  audio.init();
  if (LOBBY.starting) return;
  if (id === 'esc') { // 뒤로 가기
    if (LOBBY.starting) return;
    if (LOBBY.inserted?.kind === 'pvp' && PVP.stage) { pvpReset(); audio.sfx('click'); return; }
    if (LOBBY.inserted) { lobbyEject(LOBBY.inserted); return; }
    audio.sfx('deny'); return;
  }
  if (LOBBY.inserted?.kind === 'pvp') return pvpLobbyKey(id);
  if (id === 'lang') return setLang(LANG === 'en' ? 'ko' : 'en');
  const o = lobbyOptions()[Number(id) - 1];
  if (!o) { audio.sfx('deny'); return; }
  if (o.locked) { audio.sfx('deny'); return; }
  audio.sfx('scanDone');
  LOBBY.starting = { t: 0, kind: LOBBY.inserted.kind, mode: o.mode };
}
function lobbyStartUpdate(dt) {
  const q = LOBBY.starting; q.t += dt;
  if (q.t > 0.9 && !q.fading) { q.fading = true; G.fadeTo = 1; }
  if (q.t > 1.7 && !q.done) {
    q.done = true; LOBBY.active = false; G.state = 'title';
    camera.fov = 70; camera.updateProjectionMatrix();
    document.getElementById('help').style.display = 'block';
    if (q.kind === 'oil' || (q.kind === 'pvp' && q.mode === 'sec')) {
      room.scene.add(rig); rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
      if (!renderer.xr.isPresenting) camera.position.copy(DESK_CAM); else G.recenterT = 0.2;
      if (q.kind === 'pvp') pvpBeginSec(); else begin(q.mode);
      G.fadeTo = 0;
    } else startHuman(q.kind === 'pvp' ? 'pvp' : q.mode);
  }
}

// ── PC 클릭 ──
const lobbyRay = new THREE.Raycaster();
function lobbyPick() {
  lobbyRay.setFromCamera(mouse.ndc, camera);
  return lobbyRay.intersectObjects(LOBBY.scene.children, true).find((h) => h.object.userData.lobby)?.object.userData.lobby || null;
}
function lobbyClick() {
  audio.init();
  const L = lobbyPick(); if (!L) return;
  if (L.type === 'disc') { const d = LOBBY.discs.find((x) => x.kind === L.kind); if (LOBBY.inserted === d) lobbyEject(d); else lobbyInsert(d); }
  else if (L.type === 'key') lobbyKey(L.id);
}
// ── VR(AR) 집기 ──
function lobbyGrab(c) {
  if (LOBBY.starting || c.userData.lobbyHeld) return false;
  const gi = grabInfo(c); if (!gi) return false;
  const d = LOBBY.discs.find((x) => !x.held && x.g.getWorldPosition(new THREE.Vector3()).distanceTo(gi.point) < 0.12);
  if (!d) return false;
  if (LOBBY.inserted === d) LOBBY.inserted = null; // 넣어 둔 걸 다시 빼서 잡음
  d.anim = null;
  gi.anchor.updateMatrixWorld(true); d.g.updateMatrixWorld(true);
  d.offset = new THREE.Matrix4().copy(gi.anchor.matrixWorld).invert().multiply(d.g.matrixWorld);
  d.held = { anchor: gi.anchor }; c.userData.lobbyHeld = d;
  audio.init(); audio.sfx('click'); haptic(c, 0.4, 30);
  return true;
}
function lobbyRelease(u) { // 놓으면: 드라이브 근처면 쏙, 아니면 제자리로
  const d = u.lobbyHeld; u.lobbyHeld = null; if (!d) return;
  d.held = null;
  if (d.g.position.distanceTo(SLOT) < 0.09) lobbyInsert(d);
  else d.anim = { t: 0, from: d.g.position.clone(), fromQ: d.g.quaternion.clone(), insert: false };
}
const _lrc = new THREE.Vector3();
const LOBBY_EYE_DROP = 0.72; // AR: 테이블 윗면이 눈보다 이만큼(m) 아래
function lobbyRecenter() {
  if (renderer.xr.isPresenting) {
    // 기기 기준 머리 위치 = 실제(월드) 위치 − rig 위치. (camera.position을 그대로 쓰면 누를수록 조금씩 밀려서 점점 낮아졌음)
    camera.getWorldPosition(_lrc);
    const hx = _lrc.x - rig.position.x, hy = _lrc.y - rig.position.y, hz = _lrc.z - rig.position.z;
    rig.position.set(LOBBY_SPOT.x - hx, STAND_Y + LOBBY_EYE_DROP - hy, LOBBY_SPOT.z - hz); // 테이블 윗면 = 눈보다 LOBBY_EYE_DROP 아래
  }
  else rig.position.set(0.06, 0, STAND_Z + 0.9); // PC: 컴퓨터 · 키보드 · 디스크가 화면 가득
}
function lobbyPcCam() { lobbyRecenter(); camera.position.set(0, 1.36, 0); camera.fov = 50; camera.updateProjectionMatrix(); yaw = 0; pitch = -0.3; }
lobbyPcCam();

const _lm = new THREE.Matrix4(), _ls = new THREE.Vector3(), _lv = new THREE.Vector3(), _lw = new THREE.Vector3();
const SLOT_IN = SLOT.clone().add(new THREE.Vector3(0, 0, -0.07));
const SLOT_Q = new THREE.Quaternion();
const _hq = new THREE.Quaternion(), _hy = new THREE.Quaternion(), _lup = new THREE.Vector3(0, 1, 0);
function lobbyUpdate(dt, t) {
  const vr = renderer.xr.isPresenting;
  LOBBY.scene.background = vr ? null : LOBBY_BG;  // AR: 패스스루(내 방)가 보이게
  for (const o of LOBBY.pcOnly) o.visible = !vr;
  for (const o of LOBBY.legs) o.visible = !vr;
  if (vr && !LOBBY.fitted) { LOBBY.fitT = (LOBBY.fitT ?? 0) + dt; if (LOBBY.fitT > 1) { LOBBY.fitted = true; lobbyRecenter(); } } // AR 시작 1초 뒤 한 번만 높이 맞춤
  if (!vr) { LOBBY.fitT = 0; LOBBY.fitted = false; }
  if (vr) { LOBBY.neon.position.set(0, 1.95, -2.8); LOBBY.neon.scale.setScalar(1); } // AR: 멀리 크게
  else { LOBBY.neon.position.set(0.04, 1.4, -1.5); LOBBY.neon.scale.setScalar(0.5); } // PC: 컴퓨터 바로 뒤 위
  if (LOBBY.starting) lobbyStartUpdate(dt);
  // 디스크
  for (const d of LOBBY.discs) {
    const g = d.g;
    if (d.held) {
      const owner = controllers.find((c) => c.userData.lobbyHeld === d);
      const gp = owner?.userData.input?.gamepad;
      const pressing = owner && (owner.userData.isHand ? true : (gp?.buttons?.[0]?.value || 0) > 0.25 || (gp?.buttons?.[1]?.value || 0) > 0.25);
      if (!owner) { d.held = null; d.anim = { t: 0, from: g.position.clone(), fromQ: g.quaternion.clone(), insert: false }; continue; } // 주인 없는 디스크 → 제자리로
      if (!pressing) { lobbyRelease(owner.userData); continue; } // 트리거·그립 다 놓았으면 놓기
      _lm.multiplyMatrices(d.held.anchor.matrixWorld, d.offset); _lm.decompose(g.position, g.quaternion, _ls);
      if (g.position.distanceTo(SLOT) < 0.09 && !d.nearSlot) { d.nearSlot = true; for (const c of controllers) if (c.userData.lobbyHeld === d) haptic(c, 0.3, 20); }
      else if (g.position.distanceTo(SLOT) >= 0.09) d.nearSlot = false;
      if (d.nearSlot && !LOBBY.starting) { for (const c of controllers) if (c.userData.lobbyHeld === d) { c.userData.lobbyHeld = null; } lobbyInsert(d); } // 구멍에 대면 쏙
    } else if (d.anim) {
      const a = d.anim; a.t += dt;
      if (a.insert) { // 입구 앞 → 안으로 미끄러져 들어감
        if (a.t < 0.35) { const k = a.t / 0.35; g.position.lerpVectors(a.from, SLOT, k * k * (3 - 2 * k)); g.quaternion.slerpQuaternions(a.fromQ, SLOT_Q, k); }
        else if (a.t < 0.6) { g.position.lerpVectors(SLOT, SLOT_IN, (a.t - 0.35) / 0.25); g.quaternion.copy(SLOT_Q); }
        else { g.position.copy(SLOT_IN); d.anim = null; }
      } else { // 제자리로
        const k = Math.min(1, a.t / 0.4); g.position.lerpVectors(a.from, d.home, k * k * (3 - 2 * k)); g.quaternion.slerpQuaternions(a.fromQ, d.homeQ, k);
        if (k >= 1) d.anim = null;
      }
    } else if (LOBBY.inserted !== d) {
      const hov = !vr && !LOBBY.starting && LOBBY.hoverKind === d.kind;
      d.lift = THREE.MathUtils.damp(d.lift || 0, hov ? 1 : 0, 9, dt);
      camera.getWorldPosition(_lw);
      _lv.lerpVectors(d.home, _lw, 0.5 * d.lift); _lv.y += 0.012 * d.lift * Math.sin(t * 3); // 카메라 쪽으로 반쯤 + 둥실
      _hq.setFromUnitVectors(_lup, _lw.clone().sub(_lv).normalize()); _hq.multiply(_hy.setFromAxisAngle(_lup, rig.rotation.y + yaw)); // 라벨이 나를 향하게
      g.position.lerp(_lv, Math.min(1, dt * 14)); g.quaternion.slerpQuaternions(d.homeQ, _hq, 0.85 * d.lift);
    }
  }
  LOBBY.led.material.color.setHex(LOBBY.inserted ? (Math.sin(t * 9) > 0 ? 0x33ff66 : 0x115522) : 0x113311);
  // 키보드: 누름 애니메이션 + VR 검지로 누르기
  for (const k of LOBBY.keys) {
    k.press = Math.max(0, k.press - dt * 6); k.mesh.position.y = 0.036 - 0.01 * k.press;
    if (!vr) continue;
    k.mesh.getWorldPosition(_lw);
    let near = false;
    for (const c of controllers) { const tip = tipOf(c.userData); if (!tip) continue; tip.getWorldPosition(_lv);
      if (Math.abs(_lv.x - _lw.x) < 0.03 && Math.abs(_lv.z - _lw.z) < 0.035 && _lv.y - _lw.y < 0.025 && _lv.y - _lw.y > -0.03) { near = true; if (!k.pokeHeld) haptic(c, 0.6, 40); } }
    if (near && !k.pokeHeld) { k.pokeHeld = true; lobbyKey(k.id); }
    else if (!near) k.pokeHeld = false;
  }
  LOBBY.neon.material.opacity = 0.85 + 0.15 * Math.sin(t * 2.3) * (Math.random() < 0.02 ? 3 : 1);
  LOBBY.hoverT -= dt;
  if (LOBBY.hoverT <= 0) {
    LOBBY.hoverT = 1 / 15; lobbyDrawScreen(t);
    if (!vr) {
      const L = mouse.down?.moved ? null : lobbyPick();
      if (!mouse.down?.moved) renderer.domElement.style.cursor = L ? 'pointer' : 'default';
      const k = L?.type === 'disc' ? L.kind : null;
      if (k !== LOBBY.hoverKind) { LOBBY.hoverKind = k; if (k && audio.ctx && LOBBY.inserted?.kind !== k) audio.sfx('tick'); }
    }
  }
}
// PC 키보드 숫자 키
addEventListener('keydown', (e) => {
  if (!LOBBY.active || e.repeat) return;
  if (/^Digit[1-3]$/.test(e.code)) lobbyKey(e.code.slice(5));
  else if (e.code === 'Escape' || e.code === 'Backspace') lobbyKey('esc');
});

// 시작 화면(HTML)은 로고만 — 고르기는 3D 물건으로
document.querySelector('#overlay .items').style.display = 'none';
for (const sel of ['#overlay h1', '#overlay .sub', '#overlay .rule', '#overlay p']) document.querySelector(sel).style.display = 'none'; // 로고는 3D 네온 간판이 대신함
document.querySelector('#overlay .keys').innerHTML = TR('<b>디스크 클릭</b> → 드라이브에 넣기 · <b>1 2 3</b> 모드 선택 · <b>드래그</b> 둘러보기 · 키보드 <b>한/EN</b> 키 = 언어 &nbsp;|&nbsp; 퀘스트: 아래 <b>START AR</b> → 디스크를 집어 드라이브 구멍에 대고, 키보드는 검지로',
  '<b>Click a disk</b> → insert · <b>1 2 3</b> choose · <b>drag</b> look around · keyboard <b>한/EN</b> key = language &nbsp;|&nbsp; Quest: <b>START AR</b> below → grab a disk, bring it to the drive slot, press keys with your index finger');

// ═════════════ pvp.js — 대결 모드: 감시로봇 1명 vs 인간 여러 명 (PeerJS · P2P) ═════════════
// 감시로봇이 방장: 방을 만들면 5자리 코드(1~3). 인간들은 키보드 1/2/3으로 코드 입력 → 대기 → 방장이 [1]로 시작.
// 감시로봇 쪽 클럽이 '진짜'. 인간들은 자기 상태(자리·박자 정확도·땀·얼굴에 손·재채기)만 보내고,
// 감시로봇 쪽은 그 상태로 각자의 손님(아바타)을 움직임. 인간들의 자리는 바·플로어에서 무작위라 위치로는 못 알아냄.
const PVP = { on: false, role: null, stage: null, code: '', typed: '', err: '', peer: null, conn: null, ready: false,
  players: new Map(), slot: null, watch: false, scan: false, acc: 1, over: false, why: '', sendT: 0, retry: 0 };
const PVP_DUR = 150, PVP_MAX = 4;
// 연결 경로: STUN(직접 연결 시도) + TURN(학교·회사 와이파이처럼 직접 연결이 막힐 때 중계)
// TURN 아이디/비번은 코드에 두지 않음 → Netlify 함수(netlify/functions/turn.mjs)가 환경 변수에서 꺼내 줌
const PVP_ICE = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'stun:stun.l.google.com:19302' },
];
let PVP_TURN = null; // 함수에서 받아 온 TURN 서버들 (없으면 빈 배열 → STUN만)
async function pvpIce() {
  if (PVP_TURN) return [...PVP_ICE, ...PVP_TURN];
  try {
    const r = await fetch('/.netlify/functions/turn', { cache: 'no-store' });
    if (r.ok) PVP_TURN = (await r.json()).iceServers || [];
  } catch {}
  if (!PVP_TURN) PVP_TURN = [];
  return [...PVP_ICE, ...PVP_TURN];
}
const PVP_ID = (code) => 'club-overclock-pvp-v3-' + code;
const PVP_PRIV_ID = (code) => 'club-overclock-pvp-v3-priv-' + code; // 비공개 방: 인간 대기열엔 안 잡히고 코드로만
const PVP_CODES = []; for (const a of '123') for (const b of '123') for (const c of '123') PVP_CODES.push(a + b + c); // 방 27개
const PVP_NIGHT = {
  title: TR('대결 · 인간 vs 감시로봇', 'VERSUS · Humans vs Security'), duration: PVP_DUR, scans: 3,
  initial: Array.from({ length: 13 }, () => robot()), // 대결: 진짜 인간 말고는 전부 평범한 로봇 (가발·녹·냉각수·테이프 같은 헷갈리는 장식 없음)
  spawns: [], brief: [], barks: [],
};
const H_PVP = { n: 1, dur: PVP_DUR, pool: { order: 2, talk: 3, floor: 3, offer: 1 }, urges: true,
  title: TR('대결 · 인간 vs 감시로봇', 'VERSUS · Humans vs Security'),
  intro: TR('보안실에 진짜 사람이 앉아 있다. 손님 중 누가 인간인지 찾고 있다. 150초만 버티자.', 'A real player is in the security room, hunting for the humans among the guests. Survive 150 seconds.') };

async function pvpNewPeer(id) {
  const m = await import('https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm');
  const Peer = m.Peer || m.default;
  const opts = { debug: 1, config: { iceServers: await pvpIce() } };
  return id ? new Peer(id, opts) : new Peer(opts);
}
function pvpReset() {
  clearInterval(PVP.keep);
  try { PVP.conn?.close(); } catch {} for (const pl of PVP.players.values()) { try { pl.conn.close(); } catch {} }
  try { PVP.peer?.destroy(); } catch {}
  PVP.players.clear();
  Object.assign(PVP, { stage: null, code: '', typed: '', err: '', peer: null, conn: null, role: null, ready: false, slot: null, retry: 0, rounds: 0, cd: null, qn: 0, qcd: null });
}
function pvpFail(msg) { PVP.stage = 'error'; PVP.err = msg; audio.sfx('deny'); try { PVP.peer?.destroy(); } catch {} PVP.peer = null; PVP.conn = null; }
const pvpErrText = (e) => e?.type === 'peer-unavailable' ? TR('그 코드의 방을 못 찾았어요. ① 코드 확인 ② 감시로봇 화면에 「● 접속 가능」이 떠 있는지 ③ 다 같이 최신 버전으로 새로고침', "Couldn't find that room. Check the code, that the host shows '● Ready', and that everyone reloaded the latest version.")
  : e?.type === 'network' || e?.type === 'server-error' || e?.type === 'socket-error' ? TR('연결 서버에 닿지 않아요. 인터넷을 확인하세요.', 'Cannot reach the connection server. Check your internet.')
  : TR('연결 실패: ', 'Connection failed: ') + (e?.type || e?.message || e);
function pvpSend(m) { try { if (PVP.conn?.open) PVP.conn.send(m); } catch {} }           // 인간 → 감시로봇
function pvpSendTo(pl, m) { try { if (pl.conn?.open) pl.conn.send(m); } catch {} }      // 감시로봇 → 인간 한 명

// ── 방 만들기 (감시로봇) ──
async function pvpHost(idx = 0, priv = false) {
  PVP.role = 'sec'; PVP.stage = 'hosting'; PVP.err = ''; PVP.ready = false; PVP.priv = priv;
  PVP.code = priv ? pick(PVP_CODES) : PVP_CODES[idx % PVP_CODES.length]; // 비공개는 무작위 번호
  let peer;
  try { peer = await pvpNewPeer((priv ? PVP_PRIV_ID : PVP_ID)(PVP.code)); } catch (e) { return pvpFail(TR('PeerJS를 불러오지 못했어요 (인터넷 확인).', 'Could not load PeerJS (check internet).')); }
  if (PVP.stage !== 'hosting') { peer.destroy(); return; } // 그새 디스크를 뺐음
  PVP.peer = peer;
  peer.on('open', () => { PVP.ready = true; });
  peer.on('disconnected', () => { PVP.ready = false; if (!peer.destroyed && (PVP.stage === 'hosting' || PVP.on)) setTimeout(() => { try { peer.reconnect(); } catch {} }, 800); });
  clearInterval(PVP.keep); PVP.keep = setInterval(() => { // 보험: 주기적으로 연결 확인
    if (PVP.peer !== peer) return clearInterval(PVP.keep);
    if (peer.disconnected && !peer.destroyed && PVP.stage === 'hosting') { try { peer.reconnect(); } catch {} }
  }, 4000);
  peer.on('error', (e) => { if (e.type === 'unavailable-id') { peer.destroy(); if (PVP.stage === 'hosting') pvpHost(idx + 1, priv); } else if (!PVP.on && e.type !== 'peer-unavailable') pvpFail(pvpErrText(e)); });
  peer.on('connection', (conn) => {
    conn.on('open', () => {
      if (PVP.on || PVP.stage !== 'hosting' || PVP.players.size >= PVP_MAX) { conn.send({ t: 'full', started: PVP.on }); setTimeout(() => conn.close(), 300); return; }
      const used = new Set([...PVP.players.values()].map((p) => p.n));
      let n = 1; while (used.has(n)) n++;
      const pl = { id: conn.peer, conn, n, remote: {}, avatar: null, out: null, slot: null };
      PVP.players.set(conn.peer, pl);
      conn.on('data', (m) => pvpHostData(pl, m));
      conn.on('close', () => pvpPlayerLeft(pl));
      conn.on('error', () => pvpPlayerLeft(pl));
      conn.send({ t: 'hello', n });
      audio.sfx('scanDone');
    });
  });
}
function pvpPlayerLeft(pl) {
  if (!PVP.players.has(pl.id)) return;
  if (!PVP.on) { PVP.players.delete(pl.id); audio.sfx('click'); return; } // 시작 전: 그냥 빠짐
  if (pl.out) return;
  pl.out = 'left';
  const p = pl.avatar; if (p && p.alive) { p.showBubble(TR('먼저 갈게~', 'Gotta go~'), 2); p.target = DOOR.clone(); p.wanderT = Infinity; setTimeout(() => { if (p.alive) club.remove(p); }, 6000); }
  pvpCheckAllOut();
}
function pvpStartAll() { // 방장이 [1] = 시작
  if (!PVP.players.size) { audio.sfx('deny'); return; }
  // 자리 배정: 바 의자 · 플로어 자리 중 무작위 (서로 떨어지게)
  const bars = shuffle(club.spots.filter((s) => s.type === 'bar').map((s) => s.pos.z));
  const dance = shuffle(club.spots.filter((s) => s.type === 'dance'));
  const floors = [];
  for (const s of dance) if (floors.every((f) => Math.hypot(f.x - s.pos.x, f.z - s.pos.z) > 1.8)) floors.push({ x: s.pos.x, z: s.pos.z });
  let i = 0;
  for (const pl of PVP.players.values()) {
    const f = floors[i % floors.length] || { x: 0.2, z: -1.0 };
    const fy = Math.atan2(-(DJ_POS.x - f.x), -(DJ_POS.z - f.z)); // DJ 쪽을 봄
    pl.slot = { barZ: bars[i % bars.length], fx: f.x, fz: f.z, fy };
    pvpSendTo(pl, { t: 'start', slot: pl.slot, total: PVP.players.size });
    i++;
  }
  PVP.on = true; PVP.over = false; PVP.stage = 'go';
  audio.sfx('scanDone');
  LOBBY.starting = { t: 0, kind: 'pvp', mode: 'sec' };
}
function pvpHostData(pl, m) {
  if (!m || typeof m !== 'object' || pl.out) return;
  if (m.t === 'h') pl.remote = m;
  else if (m.t === 'ev') {
    const p = pl.avatar; if (!p || !p.alive) return;
    if (m.e === 'sneeze') { p.sneezing = 0.5; p.showBubble(TR('에취!', 'Achoo!'), 1.3); }
    else if (m.e === 'drip') p.dripT = 3;
  } else if (m.t === 'end') { // 인간 쪽에서 결판: 클럽 AI에 들킴 / 시간 끝까지 버팀
    if (m.winner === 'sec') { // AI에 들킴 → 바닥으로
      pl.out = 'ai';
      const p = pl.avatar; if (p && p.alive) { p.eject(); club.trapdoor(p.root.position); audio.sfx('eject'); audio.sfx('human'); }
      bark(BENE, TR(`클럽 AI가 인간 하나를 잡았어요. 사장님은... 구경하셨죠.`, 'The club AI caught a human. You were... watching.'), 5);
    } else pl.out = 'survived';
    pvpCheckAllOut();
  }
}

// ── 방 참가 (인간) ──
async function pvpJoin(code) {
  PVP.role = 'human'; PVP.stage = 'connecting'; PVP.code = code; PVP.err = ''; PVP.retry = 0;
  let peer;
  try { peer = await pvpNewPeer(); } catch (e) { return pvpFail(TR('PeerJS를 불러오지 못했어요 (인터넷 확인).', 'Could not load PeerJS (check internet).')); }
  if (PVP.stage !== 'connecting') { peer.destroy(); return; }
  PVP.peer = peer;
  let tries = 0;
  const tryConnect = () => {
    const conn = peer.connect((tries % 2 ? PVP_ID : PVP_PRIV_ID)(code), { reliable: true, serialization: 'json' }); // 비공개 방 먼저, 없으면 공개 방
    PVP.conn = conn;
    conn.on('data', pvpHumanData);
    conn.on('close', pvpHostLost);
    conn.on('error', pvpHostLost);
  };
  peer.on('error', (e) => {
    if (PVP.on) return;
    if (e.type === 'peer-unavailable' && ++tries < 8 && PVP.stage === 'connecting') { PVP.retry = Math.ceil(tries / 2); setTimeout(() => { if (PVP.stage === 'connecting') tryConnect(); }, tries % 2 ? 200 : 1500); return; }
    pvpFail(pvpErrText(e));
  });
  peer.on('open', () => {
    tryConnect();
    setTimeout(() => { if (PVP.stage === 'connecting' && !PVP.retry) pvpFail(TR('방은 찾았는데 연결이 안 돼요. 와이파이가 P2P를 막는 것 같아요. 휴대폰 핫스팟으로 바꿔 보세요.', 'Found the room but could not connect. The network may block P2P. Try a phone hotspot.')); }, 25000);
  });
}
async function pvpQuick() { // 빠른 참가: 방 27개에 한꺼번에 노크 → 처음 받아 준 방으로. 없으면 몇 초마다 다시
  PVP.role = 'human'; PVP.stage = 'searching'; PVP.err = ''; PVP.rounds = 0;
  let peer;
  try { peer = await pvpNewPeer(); } catch (e) { return pvpFail(TR('PeerJS를 불러오지 못했어요 (인터넷 확인).', 'Could not load PeerJS (check internet).')); }
  if (PVP.stage !== 'searching') { peer.destroy(); return; }
  PVP.peer = peer;
  let pos = 0, batch = null;
  const found = (conn, code, m) => {
    batch.done = true; PVP.conn = conn; PVP.code = code;
    conn.on('close', pvpHostLost); conn.on('error', pvpHostLost);
    for (const c of batch.conns) if (c !== conn) { try { c.close(); } catch {} }
    pvpHumanData(m);
  };
  const next = () => { // 다음 3개
    if (PVP.stage !== 'searching' || PVP.peer !== peer) return;
    if (peer.disconnected) { try { peer.reconnect(); } catch {} setTimeout(next, 2000); return; }
    if (pos >= PVP_CODES.length) { pos = 0; PVP.rounds++; setTimeout(next, 4000); return; } // 한 바퀴 다 돌았는데 없음 → 잠깐 쉬고 다시
    const codes = PVP_CODES.slice(pos, pos + 3); pos += 3;
    const bt = batch = { left: codes.length, done: false, conns: [] };
    const miss = () => { if (batch !== bt || bt.done) return; if (--bt.left <= 0) { bt.done = true; setTimeout(next, 250); } };
    bt.miss = miss;
    for (const code of codes) {
      const conn = peer.connect(PVP_ID(code), { reliable: true, serialization: 'json' });
      bt.conns.push(conn);
      conn.on('data', (m) => {
        if (PVP.conn === conn) return pvpHumanData(m);
        if (bt.done || PVP.stage !== 'searching') { try { conn.close(); } catch {} return; }
        if (m?.t === 'hello') found(conn, code, m);
        else if (m?.t === 'full') { try { conn.close(); } catch {} miss(); }
      });
    }
    setTimeout(() => { if (batch === bt && !bt.done) { bt.done = true; for (const c of bt.conns) { try { c.close(); } catch {} } next(); } }, 7000); // 대답 없는 방은 건너뜀
  };
  peer.on('error', (e) => {
    if (PVP.on || PVP.stage !== 'searching') return;
    if (e.type === 'peer-unavailable') { batch?.miss?.(); return; }
    if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' || e.type === 'disconnected') return; // next()가 재접속
    pvpFail(pvpErrText(e));
  });
  PVP.rounds = 1;
  peer.on('open', next);
}
function pvpHostLost() {
  if (!PVP.on) { if (PVP.stage === 'waiting' || PVP.stage === 'connecting') pvpFail(TR('감시로봇이 방을 닫았어요.', 'The host closed the room.')); return; }
  if (PVP.over) return;
  PVP.over = true; PVP.why = 'left';
  if (H.active && !H.ending) hEnd(true); // 감시로봇이 나감 → 남은 인간 승리
}
function pvpHumanData(m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'hello') { PVP.stage = 'waiting'; PVP.n = m.n; PVP.qn = m.n; PVP.qcd = null; audio.sfx('scanDone'); return; }
  if (m.t === 'q') { PVP.qn = m.n; PVP.qcd = m.cd; return; }
  if (m.t === 'full') { pvpFail(m.started ? TR('이미 시작한 방이에요.', 'That game already started.') : TR(`방이 꽉 찼어요 (인간 최대 ${PVP_MAX}명).`, `Room is full (max ${PVP_MAX} humans).`)); return; }
  if (m.t === 'start') { PVP.slot = m.slot; PVP.total = m.total; pvpApplySlot(m.slot); PVP.on = true; PVP.over = false; PVP.acc = 1; PVP.stage = 'go'; audio.sfx('scanDone'); LOBBY.starting = { t: 0, kind: 'pvp', mode: 'human' }; return; }
  if (m.t === 'end') { if (!PVP.over) { PVP.over = true; PVP.why = m.why; if (H.active && !H.ending) hEnd(m.winner === 'human'); } return; }
  if (m.t === 'rally') return pvpHumanRally();
  if (m.t === 's') {
    if (m.sc && !PVP.scan && H.active && !H.ending) { audio.sfx('scan'); hSay(TR('(경고) 감시로봇이 나를 스캔하고 있다!', '(WARNING) The security robot is scanning me!'), 3); }
    PVP.watch = !!m.w; PVP.scan = !!m.sc;
  }
}
function pvpApplySlot(s) { // 내 자리: 바 의자 · 플로어 위치 (감시로봇 화면과 같은 곳)
  H_LOCS.bar.pos.z = s.barZ;
  H_LOCS.floor.pos.set(s.fx, 0, s.fz); H_LOCS.floor.yaw = s.fy;
  const b = hBoards[0]; if (b) { b.position.z = s.barZ - 0.57; b.rotation.y = Math.atan2(H_LOCS.bar.pos.x - b.position.x, H_LOCS.bar.pos.z - b.position.z); }
}

// ── 결과 ──
function pvpEndText(winner) { // 인간 쪽 엔딩 문구
  const why = PVP.why, won = winner === 'human';
  const T = {
    eject: TR('감시로봇이 나를 정확히 찍었다. 발밑 바닥이 열렸다.', 'The security robot picked me out. The floor opened.'),
    ai: TR('의심 100%. 감시로봇보다 클럽 AI가 먼저 눈치챘다.', 'Suspicion 100%. The club AI noticed before the security robot did.'),
    time: TR(`${PVP_DUR}초 생존! 감시로봇은 끝내 나를 찾지 못했다.`, `Survived ${PVP_DUR} seconds! The security robot never found me.`),
    complaints: TR('감시로봇이 애꿎은 로봇만 셋 떨어뜨렸다. 영업 정지. 나는 춤을 마저 췄다.', 'Security dropped three innocent robots. Club shut down. I finished my dance.'),
    left: TR('감시로봇이 퇴근했다 (연결 끊김).', 'The security robot clocked out (disconnected).'),
  };
  return `${won ? TR('승리!', 'YOU WIN!') : TR('패배...', 'YOU LOSE...')}\n\n${T[why] || ''}\n\n${won ? TR('— 인간 승리', '— HUMAN WINS') : TR('— 감시로봇 승리', '— SECURITY WINS')}`;
}
function pvpCaught(pl, why) { // 감시로봇이 귀가 조치
  pl.out = why;
  pvpSendTo(pl, { t: 'end', winner: 'sec', why });
  pvpCheckAllOut();
}
function pvpCheckAllOut() {
  if (PVP.over || !PVP.on) return;
  const pls = [...PVP.players.values()];
  if (pls.every((p) => p.out)) pvpHostEnd(pls.some((p) => p.out === 'survived') ? 'time' : 'all');
}
function pvpHostEnd(why) { // 감시로봇 쪽 결판
  if (PVP.over) return;
  PVP.over = true; G.state = 'ending'; G.scanning = null;
  const pls = [...PVP.players.values()];
  for (const pl of pls) if (!pl.out) { pl.out = 'survived'; pvpSendTo(pl, { t: 'end', winner: 'human', why: why === 'complaints' ? 'complaints' : 'time' }); }
  const caught = pls.filter((p) => p.out === 'eject' || p.out === 'ai').length, total = pls.filter((p) => p.out !== 'left').length;
  const win = why !== 'complaints' && caught === total && total > 0;
  if (win) audio.sfx('scanDone'); else { audio.sfx('rise'); club.party = 1; }
  const head = win ? TR('승리!', 'YOU WIN!') : TR('패배...', 'YOU LOSE...');
  const body = why === 'complaints' ? TR('로봇 민원 3건. 영업 정지입니다. 인간들은 유유히 걸어 나갔습니다.', 'Three robot complaints. Club shut down. The humans strolled out.')
    : win ? TR(`인간 ${total}명을 전부 찾아 귀가시켰습니다. 완벽한 근무였어요.`, `You found and ejected all ${total} human(s). Flawless shift.`)
    : TR(`영업 종료. 인간 ${total}명 중 ${caught}명만 찾았습니다. 나머지는 끝까지 로봇인 척 춤췄어요.`, `Closing time. You found ${caught} of ${total} human(s). The rest danced like robots to the end.`);
  setTimeout(() => showEnd(`${head}\n\n${body}\n\n${win ? TR('— 감시로봇 승리', '— SECURITY WINS') : TR('— 인간 승리', '— HUMANS WIN')}`, 0.85, true), 2400);
}

// ── 감시로봇 쪽: 시작 · 인간 손님들 ──
const pvpLocs = (pl) => ({
  bar: { pos: new THREE.Vector3(H_LOCS.bar.pos.x, 0, pl.slot.barZ), yaw: H_LOCS.bar.yaw },
  floor: { pos: new THREE.Vector3(pl.slot.fx, 0, pl.slot.fz), yaw: pl.slot.fy },
});
function pvpReserveSpots() { // 인간들이 서는 바 · 플로어 자리는 비워 둠 (나머지 자리엔 로봇이 섞여 있음)
  for (const pl of PVP.players.values()) {
    if (!pl.slot) continue;
    for (const L of Object.values(pvpLocs(pl))) for (const s of club.spots) if (Math.hypot(s.pos.x - L.pos.x, s.pos.z - L.pos.z) < 0.9) s.occ = 'player';
  }
}
function pvpBeginSec() {
  audio.init();
  overlay.style.display = 'none'; document.getElementById('help').style.display = 'block';
  yaw = 0; pitch = -0.1; G.hard = false; G.complaints = 0;
  setupNight('pvp');
  spawnDJ(false, false);
  const bt = new Patron({ kind: 'robot', role: 'staff', name: TR('바텐더 B-52', 'Bartender B-52') });
  club.add(bt, new THREE.Vector3(7.75, 0, 0.65)); bt.face = -Math.PI / 2; bt.root.rotation.y = bt.face; bt.state = 'idle';
  for (const pl of PVP.players.values()) {
    const L = pvpLocs(pl).bar;
    const p = makePatron({ kind: 'human', tells: ['sweat'] });
    p.sweaty = false; p.wanderT = Infinity; p.speed = 1.3; p._loc = 'bar'; p.pvpPlayer = pl;
    club.add(p, L.pos.clone()); p.face = L.yaw + Math.PI; p.root.rotation.y = p.face; p.state = 'idle';
    const base = p.update.bind(p);
    p.update = (dt, t, beat, cl) => { // 얼굴에 손 대고 있으면 그대로 보여 줌
      base(dt, t, beat, cl);
      if (p.remoteFace && p.alive && !p.target) { p.armR.rotation.set(-2.6, 0, 0.7); p.neck.rotation.x = 0.25; }
    };
    pl.avatar = p;
  }
  PVP.rallies = 2; PVP.rallyT = 0;
  for (const s of club.spots) if (s.type === 'bar' && !s.occ) { // ① 남은 바 의자는 전부 로봇으로 (바에 오래 있는 것만으론 티 안 나게)
    const r = club.patrons.find((p) => p.alive && p.role === 'guest' && !p.pvpPlayer && p.spot?.type !== 'bar');
    if (r) { if (r.spot) r.spot.occ = null; s.occ = r; r.spot = s; r.root.position.copy(s.pos); r.face = s.face; r.root.rotation.y = s.face; r.state = 'idle'; r.spotType = 'idle'; r.target = null; }
  }
  G.state = 'night';
  const n = PVP.players.size;
  bark(BENE, TR(`대결 모드입니다, 사장님. 손님 중 ${n}명은 '진짜' 인간 플레이어예요. ${PVP_DUR}초 안에 전부 찾아서 귀가시키세요. 스캔 3회, 민원 3건이면 패배. 노란 레버 = 플로어 소집(2번): 전원을 플로어로 불러 춤을 시켜요.`,
    `Versus mode, boss. ${n} of the guests are REAL human players. Find and eject them all within ${PVP_DUR} seconds. 3 scans; 3 complaints and you lose. Yellow lever = floor rally (x2): sends everyone to dance.`), 9);
}
function pvpAvatarUpdate(pl) {
  const p = pl.avatar, r = pl.remote;
  if (!p || !p.alive || pl.out || !r.loc) return;
  if (p.dripT > 0) p.dripT -= 1 / 60;
  if (r.loc !== p._loc) { // 바 ↔ 플로어로 걸어감
    p._loc = r.loc; const L = pvpLocs(pl)[r.loc];
    p.target = L.pos.clone(); p.faceAfter = L.yaw + Math.PI; p.spotType = r.d ? 'dance' : 'idle';
  }
  if (!p.target) p.state = r.d ? 'dance' : 'idle';
  const off = r.d && r.acc < 0.7, has = p.tells.includes('offbeat');
  if (off && !has) p.tells.push('offbeat'); else if (!off && has) p.tells.splice(p.tells.indexOf('offbeat'), 1);
  p.remoteFace = !!r.f;
  p.sweaty = r.sw > 55 || p.dripT > 0;
  // ③ 의심 단서: 40%부터 머리 위가 붉게, 65%부터 근처 로봇들이 쳐다봄
  if (!p.susGlow) { p.susGlow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2030, transparent: true, opacity: 0, depthWrite: false })); p.susGlow.scale.set(1, 0.35, 1); p.susGlow.position.y = 2.25; p.susGlow.raycast = () => {}; p.root.add(p.susGlow); }
  const k = clamp(((r.sus || 0) - 40) / 60, 0, 1);
  p.susGlow.material.opacity = k * (0.35 + 0.15 * Math.sin(performance.now() / 180));
  if ((r.sus || 0) > 65) for (const o of club.patrons) if (o !== p && o.alive && o.role === 'guest' && !o.pvpPlayer && !o.target && o.root.position.distanceTo(p.root.position) < 2.5) { o.face = Math.atan2(p.root.position.x - o.root.position.x, p.root.position.z - o.root.position.z); if (o.state === 'dance' && Math.random() < 0.01) o.state = 'idle'; }
}
let pvpDecoyT = 12;
function pvpDecoys(dt) { // 바 ↔ 플로어를 오가는 로봇들 (인간만 움직이면 티 나니까)
  pvpDecoyT -= dt; if (pvpDecoyT > 0) return;
  pvpDecoyT = rand(3.5, 7);
  const cand = club.patrons.filter((p) => p.alive && p.role === 'guest' && !p.pvpPlayer && !p.target);
  if (!cand.length) return;
  const atBar = cand.filter((p) => p.spot?.type === 'bar'), elsewhere = cand.filter((p) => p.spot?.type !== 'bar');
  if (atBar.length && Math.random() < 0.5) { const a = pick(atBar), b = pick(elsewhere.length ? elsewhere : cand); club.assign(a, 'dance'); if (b !== a) club.assign(b, 'bar'); } // 바 자리 교대
  else club.assign(pick(cand), Math.random() < 0.5 ? 'bar' : 'dance');
}

// ── 매 프레임 (양쪽 공통) ──
const PVP_CD = 15; // 마지막 인간이 들어온 뒤 15초 동안 아무도 안 오면 시작
function pvpQueueTick(dt) { // 감시로봇 대기열: 인간이 1명 이상이면 카운트다운 → 자동 시작
  const n = PVP.players.size;
  if (!n) PVP.cd = null;
  else {
    if (PVP.cd == null || n > (PVP.lastN || 0)) { PVP.cd = PVP_CD; audio.sfx('select'); } // 새로 들어오면 15초 다시
    PVP.cd -= dt;
    if (n >= PVP_MAX || PVP.cd <= 0) { PVP.cd = null; return pvpStartAll(); }
  }
  PVP.lastN = n;
  PVP.qT = (PVP.qT || 0) - dt;
  if (PVP.qT <= 0) { PVP.qT = 0.5; for (const pl of PVP.players.values()) pvpSendTo(pl, { t: 'q', n, cd: PVP.cd }); }
}
function pvpTick(dt) {
  if (PVP.stage === 'hosting' && !PVP.on) { if (PVP.priv) { PVP.cd = null; return; } return pvpQueueTick(dt); }
  if (!PVP.on || PVP.over) return;
  PVP.sendT -= dt;
  if (PVP.role === 'sec') {
    if (G.state !== 'night') return;
    for (const pl of PVP.players.values()) pvpAvatarUpdate(pl);
    if (PVP.rallyT > 0) { PVP.rallyT -= dt; if (PVP.rallyT <= 0) club.party = 0; }
    pvpDecoys(dt);
    if (PVP.sendT <= 0) {
      PVP.sendT = 0.2;
      for (const pl of PVP.players.values()) if (!pl.out) { const p = pl.avatar; pvpSendTo(pl, { t: 's', w: !!p && G.sel === p, sc: !!p && G.scanning?.p === p }); }
    }
  } else if (H.active && !H.ending) {
    if (!H.dancing) PVP.acc = Math.min(1, PVP.acc + dt * 0.3);
    if (PVP.sendT <= 0) { PVP.sendT = 0.12; pvpSend({ t: 'h', loc: H.loc, d: H.dancing, acc: PVP.acc, sw: H.sweat, f: H.face > 0.2, sus: H.sus }); }
  }
}
function pvpRally() { // 감시로봇: 전원 댄스플로어로! → 로봇은 칼박, 인간은 따라가서 박자 맞춰야
  room.buttons.dj.push();
  if (PVP.rallies <= 0) return deny(TR('소집은 다 썼어요.', 'No rallies left.'));
  if (PVP.rallyT > 0) return deny(TR('소집 중이에요.', 'Rally in progress.'));
  PVP.rallies--; PVP.rallyT = 14;
  audio.sfx('alarm'); club.party = 0.6;
  bark(BENE, TR(`전원 댄스플로어로! 로봇은 박자를 틀리지 않습니다. (소집 ${PVP.rallies}번 남음)`, `Everyone to the dance floor! Robots never miss a beat. (${PVP.rallies} rallies left)`), 5);
  for (const p of club.patrons) if (p.alive && p.role === 'guest' && !p.pvpPlayer) { club.assign(p, 'dance'); p.speed = 2.2; p.wanderT = rand(18, 26); }
  for (const pl of PVP.players.values()) if (!pl.out) pvpSendTo(pl, { t: 'rally' });
}
function pvpHumanRally() { // 인간: 소집 방송 → 잠깐 뒤 플로어로, 평소보다 길게 춤
  if (!H.active || H.ending || H.between) return;
  audio.sfx('alarm');
  hSay(TR('BENE-9 (방송): 「전원 댄스플로어로! 지금 바로! 로봇은 박자를 틀리지 않습니다.」', 'BENE-9 (PA): "Everyone to the dance floor! Now! Robots never miss a beat."'), 4);
  H.enc = null; encHand.visible = false; hRemoveDrink();
  if (H.loc === 'floor') { const e = Math.floor(audio.beat() ?? 0) + 24; if (!H.stay) H.danceEnd = Math.max(H.danceEnd, e); H.rallyEnd = e; return; }
  H.rally = true;
  setTimeout(() => { if (H.active && !H.ending) hGoto('floor'); }, 1500);
}
function pvpHumanWatch() { // 인간 쪽: 감시 카메라 = 감시로봇이 나를 선택했을 때
  if (PVP.watch && !H.watch) { audio.sfx('tick'); if (!H.enc) hSay(TR('감시로봇이 나를 보고 있다! (실수하면 의심 2배)', 'The security robot is watching me! (mistakes count double)'), 3); }
  H.watch = PVP.watch;
}

// ── 메인 화면(로비) ──
function pvpLobbyKey(id) {
  if (id === 'lang') return setLang(LANG === 'en' ? 'ko' : 'en');
  if (!PVP.stage) {
    if (id === '1') { PVP.stage = 'secmenu'; audio.sfx('click'); return; }
    else if (id === '2') pvpQuick();
    else { PVP.stage = 'typing'; PVP.typed = ''; }
    audio.sfx('scanDone'); return;
  }
  if (PVP.stage === 'secmenu') {
    if (id === '1') pvpHost(0, false); else if (id === '2') pvpHost(0, true); else return audio.sfx('deny');
    audio.sfx('scanDone'); return;
  }
  if (PVP.stage === 'typing') {
    PVP.typed += id; audio.sfx('click');
    if (PVP.typed.length >= 3) pvpJoin(PVP.typed);
    return;
  }
  if (PVP.stage === 'hosting' && id === '1') return pvpStartAll();
  if (PVP.stage === 'error' || PVP.stage === 'searching') { pvpReset(); audio.sfx('click'); return; }
  audio.sfx('deny');
}
function pvpDrawScreen(c, w, h, cursor) {
  const green = '#7dffb0', info = DISC_INFO.pvp;
  c.fillStyle = info.accent; c.font = `900 32px ${FONT}`; c.fillText(info.title, 18, 44);
  const big = (s, y, col = green) => { c.fillStyle = col; c.font = `900 64px ${FONT}`; c.fillText(s, 18, y); };
  const small = (s, y, col = '#c8f0d8') => { c.fillStyle = col; c.font = `500 19px ${FONT}`; wrapText(c, s, w - 36).forEach((l, i) => c.fillText(l, 18, y + i * 25)); };
  if (PVP.stage === 'secmenu') {
    small(TR('감시로봇으로 방 열기', 'Open a room as Security'), 92);
    c.fillStyle = green; c.font = `800 26px ${FONT}`;
    c.fillText(TR('[1] 공개 대기열', '[1] Public queue'), 18, 160);
    small(TR('인간 대기열에서 아무나 들어와요. 15초 동안 새로 안 오면 자동 시작.', 'Anyone in the human queue can join. Auto-starts after 15s with no new joins.'), 196);
    c.fillStyle = green; c.font = `800 26px ${FONT}`;
    c.fillText(TR('[2] 비공개 방 (친구끼리)', '[2] Private room (friends)'), 18, 270);
    small(TR('코드를 아는 사람만 들어와요. 내가 [1]을 눌러야 시작.', 'Only people with the code can join. Starts when you press [1].'), 306);
    small(TR('ESC = 뒤로', 'ESC = back'), h - 50, '#5ab884');
  } else if (PVP.stage === 'hosting' && PVP.priv) {
    const n = PVP.players.size;
    small(TR('비공개 방 · 친구들에게 코드를 알려 주세요', 'Private room · tell your friends the code'), 88);
    c.fillStyle = PVP.ready ? '#7dffb0' : '#ffb02e'; c.font = `700 18px ${FONT}`; c.fillText(PVP.ready ? TR('● 접속 가능', '● Ready') : TR('○ 서버 접속 중...', '○ Connecting...'), 430, 88);
    c.fillStyle = PVP.ready ? '#ffe14a' : '#4a6a5a'; c.font = `900 120px ${FONT}`; c.fillText(PVP.code.split('').join(' '), 18, 120);
    small(TR(`참가한 인간: ${n} / ${PVP_MAX}명`, `Humans: ${n} / ${PVP_MAX}`) + (n ? '  ' + '●'.repeat(n) : ''), 262, n ? '#ffe14a' : '#c8f0d8');
    small(TR('친구들: 파란 디스크 → [3] 코드로 참가', 'Friends: VERSUS disk → [3] Join by code'), 294);
    c.fillStyle = n ? green : '#4a6a5a'; c.font = `800 20px ${FONT}`; c.fillText((n ? TR('[1] 시작 · ', '[1] Start · ') : '') + TR('ESC = 방 닫기', 'ESC = close room'), 18, h - 50);
  } else if (PVP.stage === 'hosting') {
    const n = PVP.players.size, dots = '.'.repeat(1 + Math.floor(performance.now() / 333) % 3);
    small(TR('감시로봇 대기열', 'Security queue'), 88, '#c8f0d8');
    c.fillStyle = PVP.ready ? '#7dffb0' : '#ffb02e'; c.font = `700 18px ${FONT}`; c.fillText(PVP.ready ? TR('● 대기열 등록됨', '● In queue') : TR('○ 서버 접속 중...', '○ Connecting...'), 300, 88);
    if (!n) big(TR('인간 찾는 중', 'FINDING HUMANS'), 150, PVP.ready ? green : '#4a6a5a');
    else big(PVP.cd != null ? TR(`${Math.ceil(PVP.cd)}초 뒤 시작`, `START IN ${Math.ceil(PVP.cd)}`) : TR('시작!', 'GO!'), 150, '#ffe14a');
    small(TR(`참가한 인간: ${n} / ${PVP_MAX}명`, `Humans: ${n} / ${PVP_MAX}`) + (n ? '  ' + '●'.repeat(n) : dots), 236, n ? '#ffe14a' : '#c8f0d8');
    small(n ? TR(`15초 안에 새로 안 들어오면 시작. 누가 들어오면 다시 15초. ${PVP_MAX}명이 차면 바로 시작.`, `Starts if nobody new joins for 15s (resets on each join). Starts at once with ${PVP_MAX}.`) : TR('인간 대기열에서 자동으로 들어와요. 인간이 들어오면 카운트다운 시작.', 'Humans from the queue join automatically. Countdown starts when one joins.'), 268);
    small(TR(`친구랑 하려면 코드: ${PVP.code}  ([3] 코드로 참가)`, `Playing with friends? Code: ${PVP.code}  ([3] Join by code)`), h - 96, '#5ab884');
    c.fillStyle = n ? green : '#4a6a5a'; c.font = `800 20px ${FONT}`; c.fillText((n ? TR('[1] 지금 바로 시작 · ', '[1] Start now · ') : '') + TR('ESC = 대기 취소', 'ESC = leave queue'), 18, h - 50);
  } else if (PVP.stage === 'typing') {
    small(TR('방 코드 3자리를 키보드 1 · 2 · 3으로 입력하세요.', 'Type the 3-digit room code with keys 1 · 2 · 3.'), 96);
    big((PVP.typed + '___').slice(0, 3).split('').join(' ') + cursor, 170);
    small(TR('나는 인간 역할로 들어가요.', 'You join as a Human.'), h - 70, '#5ab884');
  } else if (PVP.stage === 'connecting') {
    big(PVP.code.split('').join(' '), 150);
    small((PVP.retry ? TR(`방 찾는 중 (${PVP.retry}/4)`, `Looking for room (${PVP.retry}/4)`) : TR('연결 중', 'Connecting')) + '.'.repeat(1 + Math.floor(performance.now() / 333) % 3), 250);
  } else if (PVP.stage === 'searching') {
    small(TR('인간 대기열', 'Human queue'), 88, '#c8f0d8');
    big(TR('방 찾는 중', 'SEARCHING'), 150);
    if (PVP.rounds > 1) {
      small(TR('감시로봇 대기 중인 방 없음', 'No Security waiting right now'), 236, '#ffb02e');
      small(TR(`감시로봇이 대기열에 들어오면 바로 매칭돼요. 계속 찾는 중 (${PVP.rounds}번째 확인)`, `You will be matched as soon as Security queues. Still looking (check #${PVP.rounds})`) + '.'.repeat(1 + Math.floor(performance.now() / 333) % 3), 268);
    } else small(TR('감시로봇 대기 중인 방을 찾고 있어요', 'Looking for a waiting Security') + '.'.repeat(1 + Math.floor(performance.now() / 333) % 3), 236);
    small(TR('ESC = 대기 취소', 'ESC = leave queue'), h - 70, '#5ab884');
  } else if (PVP.stage === 'waiting') {
    big(TR('매칭됨!', 'MATCHED!'), 150);
    small(TR(`나는 인간 ${PVP.n}번 · 참가 인간 ${PVP.qn || 1}/${PVP_MAX}명`, `You are Human #${PVP.n} · humans ${PVP.qn || 1}/${PVP_MAX}`), 236, '#ffe14a');
    small(PVP.qcd != null ? TR(`${Math.ceil(PVP.qcd)}초 뒤 시작`, `Starting in ${Math.ceil(PVP.qcd)}`) : TR('곧 시작', 'Starting soon') + '.'.repeat(1 + Math.floor(performance.now() / 333) % 3), 268);
  } else if (PVP.stage === 'error') {
    small(PVP.err, 110, '#ff8aa8');
    small(TR('아무 숫자 키 = 처음으로', 'Any number key = back'), h - 70, '#5ab884');
  } else if (PVP.stage === 'go') {
    big(TR('시작!', 'GO!'), 150);
    small(PVP.role === 'sec' ? TR('나는 감시로봇', 'You are Security') : TR(`나는 인간 ${PVP.n}번`, `You are Human #${PVP.n}`), 250);
  }
}

setupNight(0);
drawDialog();
const BLANK_SCENE = new THREE.Scene(); BLANK_SCENE.background = new THREE.Color(0x000000);
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt, now / 1000);
  if (LOBBY.active) renderer.render(LOBBY.scene, camera); // 메인 화면: 지하 귀가 처리장
  else if (H.active) renderer.render(club.scene, camera);
  else if (G.state === 'human') renderer.render(BLANK_SCENE, camera); // 인간 모드 준비 중: 보안실이 비치지 않게
  else if (G.state === 'title' && titleMode === 'human' && overlay.style.display !== 'none' && !renderer.xr.isPresenting) {
    const tt = now / 1000;
    titleCam.aspect = innerWidth / innerHeight; titleCam.updateProjectionMatrix();
    titleCam.position.set(-3.4 + 0.5 * Math.sin(tt * 0.11), 1.75 + 0.08 * Math.sin(tt * 0.17), 3.0);
    titleCam.lookAt(0.6, 1.1, -3.2); titleCam.filmOffset = -9; titleCam.updateProjectionMatrix(); // 렌즈 오프셋: 댄스플로어가 화면 오른쪽(메뉴 반대편)에 오게
    renderer.render(club.scene, titleCam);
  }
  else { renderCCTV(); renderer.render(room.scene, camera); }
});

window.__game = { hWatch, hCards, drawWatch, drawCard, hVrUi, PVP, pvpHostData, pvpBeginSec, G, H, HE, HT, hStartNight, makePatron, BOX_HEAD, LOBBY, lobbyInsert, lobbyKey, OIL_MODEL, makeOilCan, hEncChoose, hGoto, club, room, audio, camera, mouse, D, drawGuide, startNight, endNight, startHuman, humanHit, lever: { set: setLeverAngle, release: releaseLever, from: leverAngleFrom }, step: (dt) => update(dt, performance.now() / 1000) }; // 디버그용

