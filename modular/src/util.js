import * as THREE from 'three';

// ═════════════ util.js ═════════════

export const FONT = '"Pretendard","Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';

export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
export function lerpAngle(a, b, k) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(k, 0, 1);
}

// 로우폴리 느낌: 전부 flatShading
export function flat(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, metalness: 0.15, ...o });
}
export function glow(color, intensity = 1) {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, flatShading: true });
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 한국어 줄바꿈: 공백 우선, 없으면 글자 단위
export function wrapText(ctx, text, maxW) {
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

export class CanvasPanel {
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
export const PSX = {
  club: { value: new THREE.Vector2(160, 120) }, // CCTV 속 클럽: 강하게
  room: { value: new THREE.Vector2(320, 240) }, // 보안실(데스크톱): 약하게, VR에선 꺼짐
};
export function psxify(mat, snap, affine = true) {
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
export function psxifyTree(obj, snap, affine) {
  obj.traverse((o) => {
    if (!o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => psxify(m, snap, affine));
  });
}
// 작은 해상도 + nearest = 픽셀이 깨지는 텍스처
export function pixelTex(pw, ph, draw, repeat) {
  const t = canvasTexture(pw, ph, draw);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
export const noiseFill = (c, w, h, base, amp, step = 1) => {
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const v = base + (Math.random() - 0.5) * amp | 0;
    c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x, y, step, step);
  }
};
export let METAL_TEX = null;
export function metalTex() { // 로봇 몸통용 32px 패널 텍스처 (색은 material color가 곱해짐)
  if (!METAL_TEX) METAL_TEX = pixelTex(32, 32, (c, w, h) => {
    noiseFill(c, w, h, 205, 50, 2);
    c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(0, 15, w, 1); c.fillRect(15, 0, 1, 15);
    c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(0, 16, w, 1);
    c.fillStyle = '#555'; [[3, 3], [28, 3], [3, 28], [28, 28], [12, 20], [20, 20]].forEach(([x, y]) => c.fillRect(x, y, 2, 2));
    c.fillStyle = 'rgba(60,30,10,.35)'; for (let i = 0; i < 6; i++) c.fillRect(Math.random() * 30, Math.random() * 30, 3, 2);
  });
  return METAL_TEX;
}

export function canvasTexture(pw, ph, draw) {
  const c = document.createElement('canvas');
  c.width = pw; c.height = ph;
  draw(c.getContext('2d'), pw, ph);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const bubbleCache = new Map();
export function bubbleTexture(text, bg = '#ffffff', fg = '#111111') {
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

export function makeBubble() {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
  s.scale.set(1.15, 0.38, 1);
  s.visible = false;
  s.renderOrder = 10;
  return s;
}

