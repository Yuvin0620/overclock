import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TR } from './i18n.js';
import { FONT, flat, glow, roundRect, wrapText, CanvasPanel, PSX, psxifyTree, pixelTex, noiseFill, canvasTexture } from './util.js';

// ═════════════ room.js ═════════════

// 보안실 — 플레이어가 실제로 '서 있는' XR 공간.
// 눈높이 1.25m(앉은 자세) 기준으로 배치. XR에서는 진입 시 자동으로 맞춤.
export const EYE = new THREE.Vector3(0, 1.25, 0.15);
export const DESK_Y = 0.78;

export const CRT_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
export const CRT_FRAG = /* glsl */`
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
export function screenUvToNdc(uv) {
  const cx = uv.x - 0.5, cy = uv.y - 0.5, d = cx * cx + cy * cy, k = 1 + 0.12 * d;
  return new THREE.Vector2((0.5 + cx * k) * 2 - 1, (0.5 + cy * k) * 2 - 1);
}

export class Monitor {
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

export class DeskButton {
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

export class Lever {
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
export const OIL_MODEL = { tpl: null, waiting: [] };
export function oilPlaceholder(g, h) {
  const k = h / 0.12;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.033 * k, 0.033 * k, h, 8), flat(0x1b1b1b, { metalness: 0.6 }));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0336 * k, 0.0336 * k, 0.045 * k, 8), flat(0xffc800));
  g.add(body, band);
}
export function oilSwapIn(g, h) { // 임시 캔을 모델로 교체 (잡기·클릭용 userData는 그대로 옮김)
  let ud = null; g.traverse((o) => { if (o.isMesh && !ud && Object.keys(o.userData).length) ud = { ...o.userData }; });
  g.clear();
  const m = OIL_MODEL.tpl.clone(true); m.scale.multiplyScalar(h / OIL_MODEL.h); g.add(m);
  if (ud) g.traverse((o) => { if (o.isMesh) Object.assign(o.userData, ud); });
}
export function makeOilCan(h = 0.12) { // 가운데가 원점, 높이 h(m)
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
export class Grabbable {
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
export const onDesk = (x, z) => (Math.abs(x) < 0.76 && z > -0.99 && z < -0.37) || (Math.abs(x) > 0.6 && Math.abs(x) < 1.3 && z > -0.85 && z < -0.15);

export class Room {
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

