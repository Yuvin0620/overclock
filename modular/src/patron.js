import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TR } from './i18n.js';
import { FONT, rand, randi, pick, lerpAngle, flat, glow, metalTex, canvasTexture, bubbleTexture, makeBubble } from './util.js';
import { audio } from './audio.js';
import { makeOilCan } from './room.js';

// ═════════════ patron.js ═════════════

// ── 공용 지오메트리 (로우폴리) ──────────────────
export const GEO = {
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
export const HITMAT = new THREE.MeshBasicMaterial({ visible: false });

export const METALS = [0x8a9099, 0x5d6a75, 0xb0a48a, 0x6f7f6a, 0x9b6f6f, 0x48506a, 0xc0c4c8, 0x7a6a8f];
export const VISORS = [0x39f5ff, 0xff3b5c, 0x7dff6a, 0xffc23b, 0xb46bff];
export const SKINS = [0xf1c7a5, 0xd9a67e, 0x8d5a3b, 0xffe0c4];
export const WIGS = [0xf6d2dc, 0xffffff, 0xff8ac4, 0xfff0a0];

export const MAT = {
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
export const AURA = {
  geo: new THREE.SphereGeometry(1, 10, 8),
  spot: new THREE.SphereGeometry(0.16, 8, 6),
  warm: new THREE.MeshBasicMaterial({ color: 0xff5a1e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, visible: false }),
  cold: new THREE.MeshBasicMaterial({ color: 0x1e46ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, visible: false }),
  hot: new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, visible: false, depthTest: false }),
};
export const THERMAL_TINT = new THREE.Vector3(1.25, 0.8, 0.55);

export let FACE_TEX = null;
// ── 상자 머리 모델 (3D/Assets/box.glb) ──
// 서버로 열면 파일을 직접 읽고, index.html을 더블클릭(file://)으로 열면 html 맨 아래에 넣어 둔 사본(BOX_GLB_B64)을 씀
export const BOX_HEAD = { geo: null, mat: null, faceRot: 0 };
export const boxHeadWaiting = new Set(); // 모델이 오기 전에 만들어진 상자 머리 → 도착하면 교체
export function applyBoxHead(m) { m.geometry = BOX_HEAD.geo; m.material = BOX_HEAD.mat; }
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
export function cardboardFace() {
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
export const SIGN_TEXTS = [TR('인간에게\n춤을!', "LET HUMANS\nDANCE!"), TR('춤출 권리!', "RIGHT TO DANCE!"), TR('땀은\n죄가 아니다', "SWEAT IS\nNOT A CRIME"), 'HUMAN\nRIGHTS', TR('흥 = 인권', "VIBES =\nRIGHTS")];
export const signTexCache = new Map();
export function signTex(text) {
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
export const ROBOT_FUNNY = [TR('토스터-3000', "Toaster-3000"), TR('세탁기 프로', "WashMaster Pro"), TR('냉장고 형님', "Big Bro Fridge"), TR('로봇청소기 7세대', "Roomba Gen 7"), TR('전자레인지 MAX', "Microwave MAX"), TR('자판기 K', "Vending K"), TR('계산기-2', "Calculator-2"), TR('HUMAN-8 (로봇)', "HUMAN-8 (robot)")];
export const HUMAN_FAKE = [TR('로봇 김철수', "Robo Steve"), TR('R2-영희', "R2-Karen"), TR('삐빅-민수', "Beep-Boop Mike"), TR('진짜로봇 박씨', "Real Robot Bob"), TR('ROBOT-지훈', "ROBOT-Jason"), TR('기계인간 수진', "Mecha Jessica"), TR('전자두뇌 1호', "E-Brain No.1"), TR('로봇입니다-3', "Am-Robot-3"), TR('메탈 혜원', "Metal Emily"), TR('볼트앤너트 준호', "Nuts&Bolts Kevin"), TR('삐-리-릭 동현', "Bee-Doo-Bop Dave"), TR('T-800(아님)', "T-800 (not)"), TR('알루미늄 지은', "Aluminum Amy")];
export const ACTIVIST_FAKE = [TR('평범한 로봇 이씨', "Normal Robot Lee"), TR('R-인권', "R-Rights"), TR('토스터 (진짜임)', "Toaster (legit)"), TR('중립적 로봇 7', "Neutral Robot 7"), TR('아무 생각 없는 로봇', "Thoughtless Robot"), TR('혁명 아님-1', "Not-A-Revolt-1")];
export const used = new Set();
export function uniq(gen) { for (let i = 0; i < 30; i++) { const n = gen(); if (!used.has(n)) { used.add(n); return n; } } return gen() + '′'; }
export function resetNames() { used.clear(); }
export const robotName = () => uniq(() => Math.random() < 0.2 ? pick(ROBOT_FUNNY)
  : `${pick(['TX', 'RB', 'KX', 'ZR', 'MK', 'VN', 'QB', 'AX'])}-${randi(100, 9999)}`);
export const humanName = () => uniq(() => pick(HUMAN_FAKE));
export const activistName = () => uniq(() => pick(ACTIVIST_FAKE));
// 인간·로봇 구분 없이 같은 이름 풀에서 뽑음 (이름으로 정체를 알 수 없게)
export const mixedName = () => uniq(() => { const r = Math.random();
  return r < 0.5 ? `${pick(['TX', 'RB', 'KX', 'ZR', 'MK', 'VN', 'QB', 'AX'])}-${randi(100, 9999)}`
    : r < 0.7 ? pick(ROBOT_FUNNY) : pick([...HUMAN_FAKE, ...ACTIVIST_FAKE]); });

// ─────────────────────────────────────────────
export class Patron {
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

