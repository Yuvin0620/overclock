import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { up } from './up.js';
import { LANG, TR, setLang } from './i18n.js';
import { FONT, rand, randi, pick, clamp, roundRect, wrapText, CanvasPanel, PSX } from './util.js';
import { audio } from './audio.js';
import { resetNames, robotName, humanName, activistName, mixedName, Patron } from './patron.js';
import { DJ_POS, INSPECTOR_POS, Club } from './club.js';
import { DESK_Y, screenUvToNdc, onDesk, Room } from './room.js';
import { BENE, SYS, NEWS, INTRO, robot, NIGHTS, DJS, HUMAN_DJ, LINES, gradeOf, summary, finale, ENDINGS } from './story.js';

// ═════════════ main.js ═════════════

// ── 렌더러 / 씬 ─────────────────────────────
export const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // alpha: AR에서 패스스루가 비치도록
// PSX 저해상도 렌더 (데스크톱). P 키로 단계 변경
export const PSX_LEVELS = [
  { h: 0, club: 0, room: 0, label: TR('PSX 끔', "PSX off") },
  { h: 0, club: 320, room: 0, label: TR('PSX 선명 (기본)', "PSX crisp (default)") },
  { h: 480, club: 160, room: 320, label: TR('PSX 강하게 (저해상도)', "PSX heavy (low-res)") },
];
export let psxLevel = 1;
export function applyPixelRatio() {
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
export const vrButton = ARButton.createButton(renderer, { optionalFeatures: ['local-floor', 'hand-tracking'] });
document.body.appendChild(vrButton);
// VR을 못 쓰는 환경(일반 PC 브라우저)에선 'VR NOT SUPPORTED' 버튼을 숨김
// (three.js가 지원 여부를 확인한 뒤 버튼을 다시 보이게 하므로, 버튼 글자를 지켜보다가 숨김)
export const hideVRIfUnsupported = () => { if (/NOT SUPPORTED|NOT ALLOWED|NEEDS HTTPS/i.test(vrButton.textContent)) vrButton.style.display = 'none'; };
new MutationObserver(hideVRIfUnsupported).observe(vrButton, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
hideVRIfUnsupported();

export const club = new Club();
export const room = new Room(club);
club.cams.forEach((c) => c.updateMatrixWorld());

export const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.03, 50);
camera.rotation.order = 'YXZ';
export const rig = new THREE.Group();
rig.add(camera);
room.scene.add(rig);
export const DESK_CAM = new THREE.Vector3(0, 1.34, 0.62); // 책상·모니터에서 조금 떨어져 앉음
camera.position.copy(DESK_CAM);
export let yaw = 0, pitch = -0.1;
export function setLook(y, p) { yaw = y; pitch = p; }

// 페이드 / 엔딩 패널 (머리에 붙어 다님)
export const fade = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false }));
fade.renderOrder = 1000; camera.add(fade);
export const endPanel = new CanvasPanel(1.0, 0.66, 1024, 676, { transparent: true, depthTest: false });
endPanel.mesh.position.set(0, 0, -1.1); endPanel.mesh.renderOrder = 1001; endPanel.mesh.visible = false;
camera.add(endPanel.mesh);

// ── 게임 상태 ─────────────────────────────
export const G = {
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
export const D = { queue: [], cur: null, shown: 0, done: null, bark: null, barkT: 0 };
export const chars = (s) => Array.from(s);
export const isVR = () => renderer.xr.isPresenting || !!window.__forceVR; // __forceVR: 데스크톱에서 VR 튜토리얼 미리보기용
export const lineText = (l) => (isVR() ? l.vr : l.pc) ?? l.t ?? l.vr ?? l.pc;
export function say(lines, done) { D.queue = [...lines]; D.done = done; nextLine(); }
export function nextLine() {
  for (const b of Object.values(room.buttons)) b.hl = false;
  D.cur = D.queue.shift() || null; D.shown = 0;
  if (!D.cur) { const f = D.done; D.done = null; drawDialog(); drawGuide(); f && f(); return; }
  if (D.cur.hl) room.buttons[D.cur.hl].hl = true;
  if (D.cur.choice) { G.state = 'choice'; room.buttons.eject.hl = room.buttons.dj.hl = true; }
  D.cur.onShow?.(G);
  drawDialog(); drawGuide();
}
export function lineDone() { return D.cur && D.shown >= chars(lineText(D.cur)).length; }
export function updateDialog(dt) {
  if (D.bark) { D.barkT -= dt; if (D.barkT <= 0) { D.bark = null; drawDialog(); } }
  if (!D.cur) return;
  const len = chars(lineText(D.cur)).length;
  if (D.shown < len) {
    const prev = Math.floor(D.shown);
    D.shown = Math.min(len, D.shown + dt * 32);
    if (Math.floor(D.shown) !== prev) { audio.bleep(); drawDialog(); }
  } else if (D.cur.until && D.cur.until(G)) nextLine();
}
export function dialogOK() {
  if (!D.cur) { if (D.bark) { D.bark = null; drawDialog(); } return; }
  if (!lineDone()) { D.shown = chars(lineText(D.cur)).length; drawDialog(); return; }
  if (!D.cur.until) nextLine();
}
export function speakerColor(s) { return s === NEWS ? '#ffd84a' : s === SYS ? '#ff5c8a' : s === BENE ? '#7dffb0' : '#9fd0ff'; }
export function drawDialog() {
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
export function bark(s, t, dur = 5) { D.bark = { s, t }; D.barkT = dur; drawDialog(); }

// ── VR 조작 그림 카드 ─────────────────────────────
// 대사의 img 키 → [제목, 컨트롤러 강조 부위, 맨손 포즈, 대상, 설명]
export const GUIDES = {
  select: [TR('손님 고르기', "Pick a guest"), 'trigger', 'pinch', 'monitor', TR('모니터를 가리키고 트리거 / 핀치', "Point at a monitor, trigger / pinch")],
  pull:   [TR('모니터 당기기', "Pull a monitor"), 'grip', 'pinch', 'monitor', TR('그립, 또는 트리거·핀치를 0.6초 꾹', "Grip, or hold trigger/pinch for 0.6s")],
  scan:   [TR('스캔 버튼', "SCAN button"), null, 'poke', 'blue', TR('검지로 직접 꾹! (레이로는 안 눌려요)', "Poke it with your index finger! (no ray)")],
  eject:  [TR('귀가 조치 버튼', "EJECT button"), null, 'poke', 'red', TR('검지로 직접 꾹!', "Poke it with your index finger!")],
  lever:  [TR('DJ 교체 레버', "SWAP DJ lever"), 'grip', 'pinch', 'lever', TR('손잡이를 잡고 몸 쪽으로 끝까지', "Grab the handle, pull it toward you")],
  drink:  [TR('오일 마시기', "Drink oil"), 'grip', 'pinch', 'can', TR('집어서 입에 대고 기울이기', "Pick up, bring to mouth, tilt")],
};
export const GUIDE_HI = '#ffe14a';
export function drawGuide(t = 0) {
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
export function guideController(c, x, y, hi, k) {
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
export function guideHand(c, x, y, pose, k) {
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
export function guideTarget(c, x, y, kind, k, s) {
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
export function guideArrow(c, x1, y1, x2, y2) {
  c.save(); c.strokeStyle = c.fillStyle = GUIDE_HI; c.lineWidth = 4;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  const a = Math.atan2(y2 - y1, x2 - x1);
  c.beginPath(); c.moveTo(x2, y2); c.lineTo(x2 - 12 * Math.cos(a - 0.5), y2 - 12 * Math.sin(a - 0.5)); c.lineTo(x2 - 12 * Math.cos(a + 0.5), y2 - 12 * Math.sin(a + 0.5)); c.fill();
  c.restore();
}

// ── 손님 / DJ 생성 ─────────────────────────────
export function makePatron(spec) {
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
export function vitals(p) {
  p.temp = (36.2 + Math.random() * 0.9).toFixed(1);
  p.hr = randi(98, 138);
  p.cpu = randi(48, 79);
}
export function spawnPatron(spec, initial) {
  const p = makePatron(spec);
  if (initial) club.place(p, spec.spot);
  else { club.enter(p); audio.sfx('door'); if (!D.cur) bark(TR('출입구 센서', "Door Sensor"), LINES.entered(p.name), 4); }
}
export function spawnDJ(human, rise) {
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
export function setupNight(n) {
  G.night = n; G.cfg = n === 'pvp' ? up.PVP_NIGHT : NIGHTS[n];
  audio.stop(); club.reset(); resetNames();
  G.sel = null; G.scanning = null; G.dj = null; G.djSwapT = 0; G.track = null;
  G.stats = { selects: 0, caught: 0, wrong: 0, djFired: 0, humans: 0 };
  const hard = G.hard && !G.cfg.tutorial;
  G.time = G.cfg.duration * (hard ? 0.85 : 1); G.elapsed = 0; G.spawnIdx = 0; G.barkT = rand(16, 24);
  G.maxScans = G.scans = hard ? Math.max(1, G.cfg.scans - 1) : G.cfg.scans;
  G.boOn = false; G.boT = rand(9, 13); G.rmT = rand(10, 14); club.dark = 0;
  if (n === 'pvp') up.pvpReserveSpots();
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
export function startNight(n, pre = []) {
  setupNight(n);
  spawnDJ(!!G.cfg.humanDJ, false);
  G.state = G.cfg.tutorial ? 'tutorial' : 'brief';
  say([...pre, ...G.cfg.brief], () => {
    if (G.cfg.tutorial) { try { localStorage.setItem('overclock.secTut', '1'); } catch {} startNight(1); } // 튜토리얼은 한 번 마치면 메뉴에서 사라짐
    else { G.state = 'night'; bark(SYS, TR(`영업 시작! ${G.cfg.title}`, `Doors open! ${G.cfg.title}`), 3); }
  });
}
export function endNight() {
  if (G.night === 'pvp') return up.pvpHostEnd('time');
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

export function canAct() { return G.state === 'night' || G.state === 'tutorial'; }
export function deny(msg) { audio.sfx('deny'); if (msg) bark(SYS, msg, 3); }
export function notReady() {
  if (G.state === 'brief' || G.state === 'summary' || G.state === 'finale') deny(TR('브리핑 중입니다. [확인] 버튼으로 넘기세요.', "Briefing in progress. Press [OK] to continue."));
}

// ── 플레이어 행동 ─────────────────────────────
export function selectPatron(p) {
  if (!p || !p.alive || G.state === 'title' || G.state === 'end' || G.state === 'ending') return;
  if (G.sel !== p) { G.sel = p; G.stats.selects++; audio.sfx('select'); room.zoom.uniforms.glitch.value = 0.7; }
}
export function actOK() {
  room.buttons.ok.push(); audio.sfx('click');
  if (G.state === 'title') { begin(); return; }
  if (G.state === 'end') { if (G.endT <= 0) location.reload(); return; }
  dialogOK();
}
export function actScan() {
  if (!canAct()) return notReady();
  const p = G.sel;
  if (!p || !p.alive) return deny(LINES.noTarget);
  if (G.scanning) return;
  if (p.scanned) return deny(TR('이미 스캔한 손님입니다.', "Already scanned this guest."));
  if (G.scans <= 0) { audio.sfx('deny'); bark(TR('스캐너', "Scanner"), LINES.noScans, 4); return; }
  G.scans--; G.scanning = { p, t: 0 };
  room.buttons.scan.push(); audio.sfx('scan');
}
export function actEject() {
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
  if (up.PVP.on && p.pvpPlayer) { G.stats.caught++; audio.sfx('human'); bark(BENE, pick(LINES.caughtHuman), 5); return up.pvpCaught(p.pvpPlayer, 'eject'); }
  if (p.isHuman) { G.stats.caught++; audio.sfx('human'); bark(BENE, pick(LINES.caughtHuman), 5); }
  else if (p.role === 'inspector') { G.complaints += 2; G.stats.wrong++; audio.sfx('robot'); bark(BENE, LINES.inspector, 8); G.inspector = null; }
  else if (p.vip) { G.complaints += 2; G.stats.wrong++; audio.sfx('robot'); bark(BENE, LINES.vip, 7); }
  else if (G.cfg.tutorial) { audio.sfx('robot'); bark(BENE, LINES.tutRobot, 5); }
  else { G.complaints++; G.stats.wrong++; audio.sfx('robot'); bark(BENE, pick(LINES.caughtRobot), 5); }
  if (G.complaints >= 3 && up.PVP.on) return up.pvpHostEnd('complaints');
  if (G.complaints >= 3) { G.state = 'ending'; setTimeout(() => showEnd(ENDINGS.closed, 0.88), 2600); }
}
export function actDJ() {
  if (up.PVP.on && up.PVP.role === 'sec' && canAct()) return up.pvpRally();
  if (G.state === 'choice') return choose('dance');
  if (G.state === 'title') return up.startHuman(); // 대기 화면에서 레버 = 인간 모드
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
export function choose(kind) {
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
G.showEnd = showEnd; // story.js 가 game.js 를 직접 import 하지 않도록 G 에 달아 둠
export function showEnd(text, fadeTo, noUnlock = false) {
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
export const overlay = document.getElementById('overlay');
// mode: 'tut' 튜토리얼(수습 근무) · 'play' 1일차부터 · 'hard' 하드 모드 · 'auto' 튜토리얼 안 했으면 튜토리얼 (VR 대기 화면의 확인 버튼)
export const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
export function begin(mode = 'auto') {
  if (G.state !== 'title') return;
  if (mode === 'auto') mode = lsGet('overclock.secTut') ? 'play' : 'tut';
  audio.init();
  overlay.style.display = 'none'; document.getElementById('help').style.display = 'block';
  yaw = 0; pitch = -0.1;
  G.hard = mode === 'hard'; // 하드 모드: 시간 15% 단축, 스캔 1회 감소
  startNight(mode === 'tut' ? 0 : 1, INTRO);
}
export const onClick = (id, fn) => document.getElementById(id).addEventListener('click', (e) => { e.currentTarget.blur(); if (!e.currentTarget.classList.contains('locked')) fn(); });
onClick('secTut', () => begin('tut'));
onClick('start', () => begin('play'));
onClick('hard', () => begin('hard'));
onClick('humanTutBtn', () => up.startHuman('tut'));
onClick('humanBtn', () => up.startHuman('play'));
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
export const menuItems = () => [...document.querySelectorAll('#overlay .item')].filter((el) => el.style.display !== 'none' && !el.classList.contains('locked')
  && (el.classList.contains('ghead') || el.closest('.group')?.classList.contains('open')));
export function menuToggle(group) { // 하나만 펼침
  const open = !group.classList.contains('open');
  for (const g of document.querySelectorAll('#overlay .group')) g.classList.toggle('open', open && g === group);
  audio.ctx && audio.sfx('click');
}
for (const h of document.querySelectorAll('#overlay .ghead')) h.addEventListener('click', (e) => { e.currentTarget.blur(); menuToggle(h.closest('.group')); });
export let titleMode = 'sec';
export function menuSelect(el) {
  for (const it of document.querySelectorAll('#overlay .item')) it.classList.toggle('sel', it === el);
  const mode = el?.dataset.mode || 'sec';
  for (const g of document.querySelectorAll('#overlay .group')) g.classList.toggle('on', g.dataset.mode === mode);
  if (mode === 'etc') return; // 기타는 배경을 바꾸지 않음
  if (mode !== titleMode) { titleMode = mode; overlay.classList.remove('flash'); void overlay.offsetWidth; overlay.classList.add('flash'); if (mode === 'human') titleFillClub(); }
}
// 인간 모드 배경: 댄스플로어를 비추는 카메라 + 손님 채우기
export const titleCam = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.05, 60);
export let titleClubFilled = false;
export function titleFillClub() {
  if (titleClubFilled) return; titleClubFilled = true;
  for (let i = 0; i < 9; i++) club.place(makePatron(robot(Math.random() < 0.2 ? ['wig'] : [])), 'dance');
}
menuSelect(document.querySelector('#overlay .ghead'));
for (const it of document.querySelectorAll('#overlay .item')) it.addEventListener('mouseenter', () => menuSelect(it));
addEventListener('keydown', (e) => {
  if (overlay.style.display === 'none' || G.state !== 'title' || up.LOBBY.active) return;
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
export const XR_EYE = new THREE.Vector3(0, 1.25, 0.02); // VR: 조금 뒤로 앉되 버튼·레버엔 손이 닿는 거리
export const RAY_BUTTONS = false; // true: VR에서도 레이로 버튼 누르기 허용
export const HAND_MAT = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, metalness: 0.7, roughness: 0.35, flatShading: true });
export const HAND_DARK = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.6, roughness: 0.5, flatShading: true });
export const HAND_LED = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x7dffb0, emissiveIntensity: 2, flatShading: true });
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
export const KNUCKLE = new THREE.IcosahedronGeometry(1, 0);
export const ZAXIS = new THREE.Vector3(0, 0, 1), IDQ = new THREE.Quaternion();
export const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
export const _m4 = new THREE.Matrix4(), _tip = new THREE.Vector3(), _loc = new THREE.Vector3(), _cam = new THREE.Vector3(), _up = new THREE.Vector3(), _fwd = new THREE.Vector3();
export const FINGER_CHAINS = [
  ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ...['index', 'middle', 'ring', 'pinky'].map((f) => ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map((j) => `${f}-finger-${j}`)),
];
export const haptic = (c, s, ms) => c.userData.input?.gamepad?.hapticActuators?.[0]?.pulse?.(s, ms);

// 핸드 트래킹: 관절 사이를 금속 막대로 이어 로봇 손처럼
export function buildTrackedHand(hand) {
  const v = { segs: [], knuckles: [] };
  for (const ch of FINGER_CHAINS) for (let k = 0; k < ch.length - 1; k++) {
    const m = new THREE.Mesh(UNIT_BOX, HAND_MAT); m.visible = false; hand.add(m); v.segs.push({ m, a: ch[k], b: ch[k + 1] });
    const kn = new THREE.Mesh(KNUCKLE, HAND_DARK); kn.visible = false; hand.add(kn); v.knuckles.push({ m: kn, j: ch[k] });
  }
  v.palm = new THREE.Mesh(UNIT_BOX, HAND_MAT); v.forearm = new THREE.Mesh(UNIT_BOX, HAND_DARK); v.led = new THREE.Mesh(KNUCKLE, HAND_LED);
  [v.palm, v.forearm, v.led].forEach((m) => { m.visible = false; hand.add(m); });
  return v;
}
export function updateTrackedHand(hand, v, show) {
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
export function makeCtrlHand(side) {
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
export function poseCtrlHand(h, trigger, squeeze) {
  h.fingers.forEach((f, k) => { const cv = k === 0 ? trigger : squeeze; f.segs.forEach((sg, i) => (sg.rotation.x = -cv * (i === 0 ? 1.1 : 1.3))); });
  h.thumb.forEach((sg) => (sg.rotation.x = -squeeze * 0.6));
}

// 집기 / 놓기
export function grabInfo(c) {
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
export function tryGrab(c) {
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
export const LEVER_REST = -0.5, LEVER_MAX = 0.75, LEVER_FIRE = 0.55;
export let leverArmed = true, leverTick = 0;
export function setLeverAngle(a, c) {
  const L = room.buttons.dj;
  a = clamp(a, LEVER_REST, LEVER_MAX);
  if (Math.abs(a - leverTick) > 0.15) { leverTick = a; audio.sfx('tick'); if (c) haptic(c, 0.15, 10); } // 래칫 드르륵
  L.grabAngle = a;
  if (leverArmed && a > LEVER_FIRE) { leverArmed = false; audio.sfx('clunk'); if (c) haptic(c, 1.0, 80); actDJ(); }
  if (a < 0.1) leverArmed = true;
}
export function leverAngleFrom(worldPoint) {
  const L = room.buttons.dj;
  _loc.copy(worldPoint); L.group.worldToLocal(_loc); _loc.sub(L.pivot.position);
  return Math.atan2(_loc.z, Math.max(0.02, _loc.y));
}
export function releaseLever() { room.buttons.dj.grabAngle = null; leverArmed = true; }

export function releaseItem(u) {
  if (u.lever) { u.lever = false; releaseLever(); }
  const it = u.held; u.held = null;
  if (it) { it.held = null; it.vy = 0; it.resting = false; }
}

// 마시기 — 블랙코미디 + 복선
export const DRINK_LINES = {
  oil: [TR('사장님, 방금 오일 드셨어요? 역시 로봇이시네요. ...근데 왜 기침하세요?', "Boss, did you just drink oil? A true robot. ...But why are you coughing?"), TR('오일은 하루 한 캔이 적당합니다. 인간이라면 0캔이고요.', "One can of oil a day is plenty. For humans, zero cans."), TR('또요? 사장님 위... 아니, 연료통 괜찮으세요?', "Again? Boss, is your stomach... I mean, your fuel tank okay?"), TR('꿀꺽꿀꺽. 기록했습니다. 왜 기록하냐고요? 그냥요.', "Glug glug. Logged. Why am I logging it? No reason.")],
  coffee: [TR('커피요? 로봇은 커피를... 아, 냉각용이시구나. 그렇죠?', "Coffee? Robots don't drink... oh, it's for cooling. Right?"), TR('식은 커피네요. 사장님처럼 차갑게 식은... 아닙니다.', "Cold coffee. Cold, like you, boss... never mind."), TR('카페인 감지. 흥미롭군요. 아주 흥미로워요.', "Caffeine detected. Interesting. Very interesting.")],
};
export function drink(kind) {
  const n = ++G.drinks[kind];
  audio.sfx('glug');
  if (kind === 'oil') { setTimeout(() => audio.sfx('cough'), 900); fade.material.opacity = Math.max(fade.material.opacity, 0.45); }
  const L = DRINK_LINES[kind];
  bark(BENE, L[Math.min(n - 1, L.length - 1)], 6);
}
export function updateItems(dt) {
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
export function tipOf(u) { return u.isHand ? (u.hand.joints['index-finger-tip'] || null) : (u.ctrlHand?.indexTip || null); }
export function pressButton(b) {
  const B = room.buttons;
  if (b === B.ok) actOK(); else if (b === B.scan) actScan(); else if (b === B.eject) actEject(); else if (b === B.dj) actDJ();
}
export function updatePoke() {
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
export function updateHands(dt) {
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
export const raycaster = new THREE.Raycaster();
export const subRay = new THREE.Raycaster();
export const tmpM = new THREE.Matrix4();
export const controllers = [];
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
    if (up.LOBBY.active) { up.lobbyGrab(c); return; }
    if (up.H.active) { if (up.hTryGrabDrink(c)) return; up.humanHit(); return; }
    const u = c.userData;
    if (u.isHand && tryGrab(c)) return; // 손: 핀치로 집기
    u.hold = u.ptr?.monitor ? { mon: u.ptr.monitor, t: 0 } : null;
    if (activate(u.ptr)) haptic(c, 0.6, 40);
  });
  c.addEventListener('selectend', () => { const u = c.userData; u.hold = null; if (u.lobbyHeld) return up.lobbyRelease(u); if (u.hDrink) return up.hReleaseDrink(u); if (u.isHand) releaseItem(u); });
  c.addEventListener('squeezeend', () => { const u = c.userData; if (u.lobbyHeld) return up.lobbyRelease(u); if (u.hDrink) return up.hReleaseDrink(u); if (!u.isHand) releaseItem(u); });
  c.addEventListener('squeezestart', () => {
    if (up.LOBBY.active) { up.lobbyGrab(c); return; } // 메인 화면: 그립은 디스크 잡기만 (테이블 위치는 안 바뀜)
    if (up.H.active) { if (up.hTryGrabDrink(c)) return; up.hRecenter(); return; }
    if (!c.userData.isHand && tryGrab(c)) return; // 컨트롤러: 그립으로 집기
    const mon = c.userData.ptr?.monitor;
    if (mon || room.focused) { room.toggleFocus(mon, camera); audio.sfx('click'); c.userData.input?.gamepad?.hapticActuators?.[0]?.pulse?.(0.3, 30); }
    else recenter();
  });
  const grip = renderer.xr.getControllerGrip(i);
  rig.add(grip);
  controllers.push(c);
}
export function headLocal() { rig.updateMatrixWorld(true); return rig.worldToLocal(camera.getWorldPosition(new THREE.Vector3())); } // rig 기준 머리 위치
export function recenter() {
  if (up.LOBBY.active) return up.lobbyRecenter();
  if (up.H.active) return up.hRecenter();
  const p = headLocal();
  rig.position.set(XR_EYE.x - p.x, XR_EYE.y - p.y, XR_EYE.z - p.z);
}
renderer.xr.addEventListener('sessionstart', () => {
  setTimeout(() => { drawDialog(); drawGuide(); }, 0); // 대사·그림을 VR용으로 갱신
  overlay.style.display = 'none';
  PSX.room.value.set(0, 0); // VR에선 보안실 스냅 끔 (양안 지글거림 → 멀미 방지)
  if (up.H.active) PSX.club.value.set(0, 0); // 인간 모드: 클럽 안에 직접 서 있으므로 클럽 스냅도 끔
  room.unfocus();
  audio.init();
  G.recenterT = 0.4;
});
renderer.xr.addEventListener('sessionend', () => {
  if (up.LOBBY.active) { setTimeout(up.lobbyPcCam, 0); return; }
  setTimeout(() => { drawDialog(); drawGuide(); }, 0); rig.position.set(0, 0, 0); camera.position.copy(DESK_CAM); applyPixelRatio(); room.unfocus(); });

// ── 입력: 마우스 / 키보드 ─────────────────────────────
export const mouse = { ndc: new THREE.Vector2(0, -0.3), down: null, moved: false, ptr: null };
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  camera.fov = clamp(camera.fov + Math.sign(e.deltaY) * 4, 22, 75); camera.updateProjectionMatrix();
}, { passive: false });
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 2) { updatePointers(); room.toggleFocus(mouse.ptr?.monitor, camera); audio.sfx('click'); return; }
  if (e.button !== 0) return; mouse.down = { x: e.clientX, y: e.clientY, yaw, pitch }; mouse.moved = false;
  if (up.H.active) { if (G.state === 'end') return; mouse.ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); if (up.hClickWalk() || up.hClickDrink()) return; if (up.H.enc?.kind === 'choice') up.hEncChoose(e.clientX < innerWidth / 2 ? 0 : 1); else up.humanHit(); return; }
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
    yaw = up.H.active ? mouse.down.yaw + dx * 0.004 : clamp(mouse.down.yaw + dx * 0.004, -1.7, 1.7); // 인간 모드: 360° 둘러보기
    pitch = clamp(mouse.down.pitch + dy * 0.004, -1.1, 0.9);
  }
});
addEventListener('blur', () => { mouse.down = null; });
addEventListener('pointerup', () => {
  if (mouse.down && !mouse.moved) {
    if (G.state === 'end') { if (G.endT <= 0) location.reload(); }
    else if (up.LOBBY.active) up.lobbyClick();
    else if (!up.H.active) { updatePointers(); activate(mouse.ptr); }
  }
  if (mouse.lever) { mouse.lever = null; releaseLever(); }
  mouse.down = null;
});
addEventListener('keydown', (e) => {
  if (up.H.active) {
    if (e.code === 'KeyF') up.H.keyFace = true;
    else if (e.code === 'KeyR') up.H.keyRaise = 0.6;
    else if (e.code === 'KeyM' && !e.repeat) up.hWalk();
    else if (e.code === 'Digit1' || e.code === 'ArrowLeft') up.hEncChoose(0);
    else if (e.code === 'Digit2' || e.code === 'ArrowRight') up.hEncChoose(1);
    else if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); if (G.state === 'end') { if (G.endT <= 0) location.reload(); } else up.humanHit(); }
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
addEventListener('keyup', (e) => { if (e.code === 'KeyF') up.H.keyFace = false; });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  applyPixelRatio();
});

// ── 레이캐스트: 보안실 → (모니터면) 클럽 ─────────────────────────────
export function castFrom(origin, dir) {
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
export function updatePointers() {
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
export function activate(r) {
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
export const pad = (n) => String(Math.floor(n)).padStart(2, '0');
export function clockStr() { const s = 23 * 3600 + 1800 + (G.elapsed || 0) * 12 + performance.now() / 1000; return `${pad(s / 3600 % 24)}:${pad(s / 60 % 60)}:${pad(s % 60)}`; }
export function statusInfo() {
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
export function scanInfo() {
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
export let panelT = 0, overlayT = 0;
export function updatePanels(dt, t) {
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
export const zoomLook = new THREE.Vector3(0, 1, -1.5);
export function updateZoom(dt, t) {
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


