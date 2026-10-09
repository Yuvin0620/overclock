import * as THREE from 'three';
import { TR } from './i18n.js';
import { FONT, rand, pick, flat, glow, roundRect, PSX, psxifyTree, pixelTex, canvasTexture } from './util.js';
import { AURA } from './patron.js';
import { makeOilCan } from './room.js';

// ═════════════ club.js ═════════════

// 클럽 '오버클럭' — CCTV 카메라로만 보는 장소
export const DOOR = new THREE.Vector3(-8.3, 0, 4.6);
export const DJ_POS = new THREE.Vector3(0, 0.4, -5.25);
export const INSPECTOR_POS = new THREE.Vector3(5.9, 0, 3.4);

export const TILE_COLORS = [0xff2a6d, 0x05d9e8, 0xd1f7ff, 0xffc93c, 0x9d4edd, 0x2bd27a];

export class Club {
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

