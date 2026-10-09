import * as THREE from 'three';
import { up } from './up.js';
import { LANG, TR, setLang } from './i18n.js';
import { FONT, flat, glow, wrapText, CanvasPanel, canvasTexture } from './util.js';
import { audio } from './audio.js';
import { renderer, room, camera, rig, DESK_CAM, yaw, G, lsGet, begin, haptic, grabInfo, tipOf, controllers, mouse, setLook } from './game.js';
import { startHuman } from './human.js';

// ═════════════ lobby.js — 메인 화면: AR 「OVERCLOCK 단말기」 ═════════════
// 퀘스트(AR): 내 방(패스스루) 위에 레트로 컴퓨터 · 디스크 두 장 · 네온 간판이 뜸. PC: 같은 물건을 어두운 빈 공간에.
// 디스크를 집어 드라이브에 넣으면 화면에 모드 설명 → 키보드 숫자 키로 튜토리얼/플레이/하드 고르기.
export const LOBBY = { scene: new THREE.Scene(), active: true, discs: [], keys: [], inserted: null, starting: null, hoverT: 0, screen: null, hits: [] };
export const LOBBY_SPOT = new THREE.Vector3(0, 0, 0);          // 플레이어 자리
export const STAND_Y = 0.86, STAND_Z = -0.5;                     // 받침대 윗면 높이 · 위치
export const SLOT = new THREE.Vector3(-0.02, STAND_Y + 0.035, STAND_Z + 0.118); // 디스크 드라이브 입구
export const LOBBY_BG = new THREE.Color(0x060608);
export const DISC_INFO = {
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
export function lobbyOptions() {
  const d = LOBBY.inserted; if (!d) return [];
  const info = DISC_INFO[d.kind], opts = [];
  if (d.kind === 'pvp') return [{ label: TR('감시로봇 (방 열기)', 'Security (host)') }, { label: TR('인간 대기열', 'Human queue') }, { label: TR('코드로 참가 · 인간', 'Join by code · Human') }];
  if (!lsGet(info.tut)) opts.push({ mode: 'tut', label: TR('튜토리얼', 'Tutorial') });
  opts.push({ mode: 'play', label: TR('플레이', 'Play') });
  if (d.kind === 'oil') opts.push({ mode: 'hard', label: TR('하드 모드', 'Hard mode'), locked: !lsGet('overclock.cleared') });
  return opts;
}
export function lobbyDrawScreen(t) {
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
  } else if (d.kind === 'pvp' && up.PVP.stage) up.pvpDrawScreen(c, w, h, cursor);
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
export function lobbyInsert(d) {
  if (LOBBY.starting) return;
  if (LOBBY.inserted && LOBBY.inserted !== d) lobbyEject(LOBBY.inserted);
  d.held = null; LOBBY.inserted = d; d.anim = { t: 0, from: d.g.position.clone(), fromQ: d.g.quaternion.clone(), insert: true };
  audio.init(); audio.sfx('clunk'); audio.sfx('scan');
}
export function lobbyEject(d) {
  if (d.kind === 'pvp' && !up.PVP.on) up.pvpReset();
  if (LOBBY.inserted === d) LOBBY.inserted = null;
  d.anim = { t: 0, from: d.g.position.clone(), fromQ: d.g.quaternion.clone(), insert: false };
  audio.sfx('click');
}
export function lobbyKey(id) {
  const k = LOBBY.keys.find((k) => k.id === id); if (k) k.press = 1;
  audio.init();
  if (LOBBY.starting) return;
  if (id === 'esc') { // 뒤로 가기
    if (LOBBY.starting) return;
    if (LOBBY.inserted?.kind === 'pvp' && up.PVP.stage) { up.pvpReset(); audio.sfx('click'); return; }
    if (LOBBY.inserted) { lobbyEject(LOBBY.inserted); return; }
    audio.sfx('deny'); return;
  }
  if (LOBBY.inserted?.kind === 'pvp') return up.pvpLobbyKey(id);
  if (id === 'lang') return setLang(LANG === 'en' ? 'ko' : 'en');
  const o = lobbyOptions()[Number(id) - 1];
  if (!o) { audio.sfx('deny'); return; }
  if (o.locked) { audio.sfx('deny'); return; }
  audio.sfx('scanDone');
  LOBBY.starting = { t: 0, kind: LOBBY.inserted.kind, mode: o.mode };
}
export function lobbyStartUpdate(dt) {
  const q = LOBBY.starting; q.t += dt;
  if (q.t > 0.9 && !q.fading) { q.fading = true; G.fadeTo = 1; }
  if (q.t > 1.7 && !q.done) {
    q.done = true; LOBBY.active = false; G.state = 'title';
    camera.fov = 70; camera.updateProjectionMatrix();
    document.getElementById('help').style.display = 'block';
    if (q.kind === 'oil' || (q.kind === 'pvp' && q.mode === 'sec')) {
      room.scene.add(rig); rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
      if (!renderer.xr.isPresenting) camera.position.copy(DESK_CAM); else G.recenterT = 0.2;
      if (q.kind === 'pvp') up.pvpBeginSec(); else begin(q.mode);
      G.fadeTo = 0;
    } else startHuman(q.kind === 'pvp' ? 'pvp' : q.mode);
  }
}

// ── PC 클릭 ──
export const lobbyRay = new THREE.Raycaster();
export function lobbyPick() {
  lobbyRay.setFromCamera(mouse.ndc, camera);
  return lobbyRay.intersectObjects(LOBBY.scene.children, true).find((h) => h.object.userData.lobby)?.object.userData.lobby || null;
}
export function lobbyClick() {
  audio.init();
  const L = lobbyPick(); if (!L) return;
  if (L.type === 'disc') { const d = LOBBY.discs.find((x) => x.kind === L.kind); if (LOBBY.inserted === d) lobbyEject(d); else lobbyInsert(d); }
  else if (L.type === 'key') lobbyKey(L.id);
}
// ── VR(AR) 집기 ──
export function lobbyGrab(c) {
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
export function lobbyRelease(u) { // 놓으면: 드라이브 근처면 쏙, 아니면 제자리로
  const d = u.lobbyHeld; u.lobbyHeld = null; if (!d) return;
  d.held = null;
  if (d.g.position.distanceTo(SLOT) < 0.09) lobbyInsert(d);
  else d.anim = { t: 0, from: d.g.position.clone(), fromQ: d.g.quaternion.clone(), insert: false };
}
export const _lrc = new THREE.Vector3();
export const LOBBY_EYE_DROP = 0.72; // AR: 테이블 윗면이 눈보다 이만큼(m) 아래
export function lobbyRecenter() {
  if (renderer.xr.isPresenting) {
    // 기기 기준 머리 위치 = 실제(월드) 위치 − rig 위치. (camera.position을 그대로 쓰면 누를수록 조금씩 밀려서 점점 낮아졌음)
    camera.getWorldPosition(_lrc);
    const hx = _lrc.x - rig.position.x, hy = _lrc.y - rig.position.y, hz = _lrc.z - rig.position.z;
    rig.position.set(LOBBY_SPOT.x - hx, STAND_Y + LOBBY_EYE_DROP - hy, LOBBY_SPOT.z - hz); // 테이블 윗면 = 눈보다 LOBBY_EYE_DROP 아래
  }
  else rig.position.set(0.06, 0, STAND_Z + 0.9); // PC: 컴퓨터 · 키보드 · 디스크가 화면 가득
}
export function lobbyPcCam() { lobbyRecenter(); camera.position.set(0, 1.36, 0); camera.fov = 50; camera.updateProjectionMatrix(); setLook(0, -0.3); }
lobbyPcCam();

export const _lm = new THREE.Matrix4(), _ls = new THREE.Vector3(), _lv = new THREE.Vector3(), _lw = new THREE.Vector3();
export const SLOT_IN = SLOT.clone().add(new THREE.Vector3(0, 0, -0.07));
export const SLOT_Q = new THREE.Quaternion();
export const _hq = new THREE.Quaternion(), _hy = new THREE.Quaternion(), _lup = new THREE.Vector3(0, 1, 0);
export function lobbyUpdate(dt, t) {
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

