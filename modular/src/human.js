import * as THREE from 'three';
import { up } from './up.js';
import { LANG, TR } from './i18n.js';
import { FONT, rand, pick, clamp, lerpAngle, flat, roundRect, wrapText, CanvasPanel, PSX } from './util.js';
import { audio } from './audio.js';
import { THERMAL_TINT, resetNames, Patron } from './patron.js';
import { INSPECTOR_POS } from './club.js';
import { makeOilCan } from './room.js';
import { BENE, SYS, robot, activist, vipRobot, NIGHTS, LINES, ENDINGS } from './story.js';
import { renderer, club, room, camera, rig, yaw, pitch, fade, G, D, updateDialog, bark, drawGuide, makePatron, spawnPatron, spawnDJ, endNight, canAct, showEnd, overlay, lsGet, HAND_MAT, haptic, grabInfo, updateItems, tipOf, updatePoke, updateHands, raycaster, controllers, headLocal, recenter, mouse, updatePointers, updatePanels, updateZoom, setLook } from './game.js';

// ═════════════ human.js — 인간 모드: 손님으로 보내는 6일 ═════════════
// 보안실 모드와 같은 6일. 플레이어는 은박지로 위장한 인간 손님.
// 평소엔 '바'에 있고, DJ가 부르면 댄스플로어로. 이동은 전부 암전 순간이동 (멀미 최소화).
// 리듬 판정은 플로어에서 춤출 때만. 대화·주문·몸짓(얼굴에 손 / 손 들기)으로 의심을 피한다.
export const H_LOCS = {
  bar: { pos: new THREE.Vector3(6.0, 0, 0.65), yaw: -Math.PI / 2, name: TR('바', 'Bar') },
  floor: { pos: new THREE.Vector3(0.2, 0, -1.0), yaw: 0, name: TR('댄스플로어', 'Dance floor') },
};
export const hFwd = (yaw) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
export const hRight = (yaw) => new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

// 밤별 구성 (보안실 모드의 NIGHTS[1..6]과 같은 날)
export const H_NIGHTS = [
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

export const H = {
  active: false, night: -1, t: 0, sus: 0, maxSus: 0, sweat: 0, face: 0, keyFace: false, keyRaise: 0,
  loc: 'bar', dancing: false, danceEnd: 0, moving: false, hp: 2, drink: null,
  hits: new Set(), judged: -1, combo: 0, misses: 0, feedback: null, fbT: 0, grace: -1,
  watch: false, watchT: 8, sneeze: null, sneezeT: 18, freeze: null, freezeT: 16, rmT: 14,
  bo: false, boT: 12, cool: 0, chatT: 8, evT: 6, enc: null, lastDef: null, warned: false, asked: false,
  msg: '', msgT: 0, lastHead: new THREE.Vector3(), lastHands: [], ending: false, between: false, hudT: 0, cam: null, bartender: null,
};
export const hPos = () => H_LOCS[H.loc].pos;

// HUD: 게임식 UI — 큰 판 대신 자막(아래) · 선택지 카드 · 구석 게이지 · 감시 표시(위)
// 시선을 '느긋하게' 따라오는 투명 레이어 (VR: 고개를 크게 돌렸을 때만 천천히 따라옴)
export const hHud = new CanvasPanel(1.44, 0.72, 1280, 640, { transparent: true, depthTest: false });
hHud.mesh.visible = false; hHud.mesh.renderOrder = 50; hHud.material.fog = false;
export const hTop = new CanvasPanel(1.2, 0.24, 1280, 256, { transparent: true, depthTest: false });
hTop.mesh.renderOrder = 51; hTop.material.fog = false; hTop.mesh.position.set(0, 0.4, -1.15); hTop.mesh.rotation.x = -0.15;
export const hUI = new THREE.Group(); hUI.add(hHud.mesh, hTop.mesh);
hHud.mesh.position.set(0, -0.14, -1.15); hHud.mesh.rotation.x = 0.1;
// 화면 테두리 (감시 중 = 빨강). 카메라에 붙음
export const hVig = new CanvasPanel(1.6, 1.2, 512, 384, { transparent: true, depthTest: false });
{
  const { ctx: c, w, h } = hVig;
  // 가장자리로 갈수록 진해지는 빨간 테두리 + 안쪽 경고선
  for (let i = 0; i < 56; i++) { const a = Math.pow(1 - i / 56, 2.2) * 0.95; c.strokeStyle = `rgba(255,${20 + i},40,${a})`; c.lineWidth = 1.5; c.strokeRect(i, i, w - 2 * i, h - 2 * i); }
  c.strokeStyle = 'rgba(255,80,90,.9)'; c.lineWidth = 3; c.strokeRect(10, 10, w - 20, h - 20);
  hVig.commit();
}
hVig.mesh.position.set(0, 0, -0.3); hVig.mesh.renderOrder = 999; hVig.material.opacity = 0; hVig.mesh.visible = false;
camera.add(hVig.mesh);
export const hSweatFx = new CanvasPanel(1.6, 1.2, 512, 384, { transparent: true, depthTest: false });
hSweatFx.mesh.position.set(0, 0, -0.29); hSweatFx.mesh.renderOrder = 998; hSweatFx.mesh.visible = false;
camera.add(hSweatFx.mesh);
export const sweatDrops = []; let sweatFxT = 0;
export function drawSweatFx(dt, k) { // k: 0~1 땀 정도
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
export const _uq = new THREE.Quaternion(), _uf = new THREE.Vector3();
export function hFollowUI(dt) {
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
export function hPlaceHud() { /* 이제 시선을 따라오므로 자리별 배치 불필요 */ }

// 천장 감시 카메라 (자리마다 하나씩 보이게 위치 이동)
export function buildWatchCam() {
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
export function hPlaceCam() {
  const L = H_LOCS[H.loc];
  H.cam.position.copy(L.pos).addScaledVector(hFwd(L.yaw), 2.4).addScaledVector(hRight(L.yaw), 1.3).setY(3.2);
}

// 속마음 대사는 쓰지 않음 — '(속마음)' / '(inner voice)'로 시작하는 줄은 자막에서 제외
export const hStrip = (text) => String(text).split('\n').filter((l) => !/^\s*\((속마음|inner voice)\)/.test(l)).join('\n').trim();
export function hSay(text, dur = 3.5) { const t = hStrip(text); if (!t) return; H.msg = t; H.msgT = dur; }
// 인간 모드 블랙코미디 대사
export const HL = {
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

export function hNear(filter = (p) => p.role === 'guest') {
  let near = null, best = 9;
  for (const p of club.patrons) if (p.alive && !p.target && filter(p)) { const d = p.root.position.distanceTo(hPos()); if (d < best) { best = d; near = p; } }
  return near;
}
export function hChat(pair) { // 가까운 로봇 말풍선 + HUD에 속마음
  const near = hNear();
  if (near) near.showBubble(pair[0], 3.5);
  if (!(renderer.xr.isPresenting && near)) hSay(TR('옆 로봇: ', 'Robot next to you: ') + pair[0] + '\n' + pair[1], 5);
}

// ── 시작 / 밤 진행 / 이동 ─────────────────────────────
export function startHuman(mode = 'auto') { // 'tut' 튜토리얼 · 'play' 1일차부터 · 'auto' 튜토리얼 안 했으면 튜토리얼
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
export function hStartNight(i) { // i = -1: 튜토리얼(수습 잠입)
  H.tutorial = i < 0; if (H.tutorial) { HT.step = -1; HT.leaving = false; }
  const N = H.pvp ? up.H_PVP : i < 0 ? H_TUT : H_NIGHTS[i];
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
export function hGoto(loc, instant = false) {
  const apply = () => {
    if (!H.walkGo) H.stay = false; H.walkGo = false; // 이벤트(DJ 호출 등)로 이동 → 춤 끝나면 자동 복귀
    H.loc = loc;
    const L = H_LOCS[loc];
    rig.rotation.y = L.yaw; setLook(0, loc === 'bar' ? -0.12 : -0.05);
    hRecenter(); hPlaceHud(); hPlaceCam();
    if (loc === 'floor') { H.dancing = true; H.hits.clear(); H.judged = -1; H.grace = -2; H.danceEnd = 0; }
    else H.dancing = false;
  };
  if (instant) { apply(); return; }
  H.moving = true; G.fadeTo = 1;
  setTimeout(() => { apply(); G.fadeTo = 0; H.moving = false; }, 450); // 짧은 암전 순간이동
}
export const H_EYE = 1.65; // 인간 모드 VR 눈높이 (로봇 손님들과 눈이 맞는 높이)
export function hRecenter() {
  const L = H_LOCS[H.loc];
  if (renderer.xr.isPresenting) {
    const h = headLocal(), p = h.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), L.yaw);
    rig.position.set(L.pos.x - p.x, H_EYE - h.y, L.pos.z - p.z); // 눈높이를 항상 1.65m로 (앉아서 해도, 기기가 바닥을 몰라도)
  } else rig.position.set(L.pos.x, 0, L.pos.z);
}
export function hNightEnd() {
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
export function hEnd(win) {
  if (H.ending) return;
  if (H.pvp && !up.PVP.over) { up.PVP.over = true; up.PVP.why = win ? 'time' : 'ai'; up.pvpSend({ t: 'end', winner: win ? 'human' : 'sec', why: up.PVP.why }); }
  H.ending = true; G.state = 'ending'; H.enc = null; encHand.visible = false;
  if (win) { audio.sfx('rise'); club.party = 1; setTimeout(() => { hHud.mesh.visible = false; hTop.mesh.visible = false; hVig.mesh.visible = false; hSweatFx.mesh.visible = false; sweatDrops.length = 0; showEnd(H.pvp ? up.pvpEndText('human') : ENDINGS.humanWin, 0.6, true); }, 1500); }
  else {
    audio.sfx('alarm'); audio.stop(true);
    // 덜컹! 발밑 바닥이 열리고 떨어짐
    setTimeout(() => { club.trapdoor(hPos().clone()); audio.sfx('clunk'); audio.sfx('eject'); if (!renderer.xr.isPresenting) H.fall = { t: 0, v: 0 }; for (const c of controllers) haptic(c, 1, 300); }, 500); // 추락 연출은 PC만 (VR은 멀미 방지로 진동+암전만)
    setTimeout(() => { G.fadeTo = 1; }, 1300);
    setTimeout(() => { hHud.mesh.visible = false; hTop.mesh.visible = false; hVig.mesh.visible = false; hSweatFx.mesh.visible = false; sweatDrops.length = 0; showEnd(H.pvp ? up.pvpEndText('sec') : ENDINGS.humanCaught, 0.9, true); }, 2400);
  }
}
export function hAddSus(v, why, allowDown = false) {
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
export const hRest = (n) => Math.floor(n / 4) % 4 === 3;
export const hFrozen = () => H.freeze && H.freeze.phase === 'on';
export const hGrace = (n) => n < H.grace;
export function humanHit() {
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
  if (H.pvp) up.PVP.acc = err < P2 ? Math.min(1, up.PVP.acc + 0.2) : up.PVP.acc * 0.65;
  const inBattle = H.enc?.kind === 'battle' && n >= H.enc.n0 && n <= H.enc.n0 + 3;
  if (err < P1) { H.combo++; if (inBattle) H.enc.good++; if (H.tutorial) HT.hits++; hAddSus(-2.5, TR('완벽', 'PERFECT')); if (H.combo === 12) hChat(pick(HL.combo)); }
  else if (err < P2) { H.combo++; if (inBattle) H.enc.good++; if (H.tutorial) HT.hits++; hAddSus(-0.5, TR('좋아', 'GOOD')); }
  else hAddSus(6, TR('박자 어긋남', 'Off beat'));
  for (const c of controllers) haptic(c, 0.3, 25);
}

// ── 몸짓 감지 ─────────────────────────────
export const _hp = new THREE.Vector3(), _cp = new THREE.Vector3();
export function hHandsAtFace() {
  if (!renderer.xr.isPresenting) return H.keyFace;
  camera.getWorldPosition(_hp);
  for (const c of controllers) { if (!c.userData.input) continue; c.getWorldPosition(_cp); if (_cp.distanceTo(_hp) < 0.2) return true; }
  return false;
}
export function hRaised() { // [왼손, 오른손] 머리 위로 들었나
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
export function hMotion(dt) {
  if (!renderer.xr.isPresenting) return 0;
  camera.getWorldPosition(_hp);
  let m = _hp.distanceTo(H.lastHead) / dt; H.lastHead.copy(_hp);
  controllers.forEach((c, i) => { if (!c.userData.input) return; c.getWorldPosition(_cp); const l = H.lastHands[i] ||= _cp.clone(); m = Math.max(m, _cp.distanceTo(l) / dt * 0.6); l.copy(_cp); });
  return m;
}

// ── 조우 이벤트: 로봇이 말을 걸어온다. 로봇답게 대응해야 함 ─────────────
// 선택지: VR = 왼손/오른손 들기 · PC = 1/2 키 또는 화면 왼쪽/오른쪽 클릭
// r: 로봇다운 대답, h: 인간다운 대답(들킴), rr/hr: 로봇의 반응
export const ENC_TALK = [
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
export const ENC_PHYS = [
  { type: 'shake', who: TR('사업가 로봇', 'Business robot'), q: TR('동기화 프로토콜: 악수 요청. 짧고 차갑게 부탁해.', 'Sync protocol: handshake request. Short and cold, please.') },
  { type: 'battle', who: TR('댄스 배틀 로봇', 'Dance-battle robot'), q: TR('삐빅! 댄스 배틀! 다음 한 마디, 4박 전부 완벽하게 따라 해 봐!', 'Beep! Dance battle! Match the next bar — all 4 beats, perfectly!') },
];
export const EL = {
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
export const encHand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.6, depthWrite: false }));
encHand.visible = false;



// ── 바 음료: 카운터에 실제 잔이 나오고, 직접 집어 마신다 (VR: 잡고 입에 대고 기울이기 · PC: 잔 클릭) ──
// 의심을 낮추는 유일한 방법. 대신 체력() 1 소모. 0에서 또 마시면 쓰러짐.
export const H_HP_MAX = 3;
export function makeBarGlass() { return makeOilCan(); } // 바 음료도 오일 캔 모델
export function hServeDrink(gold) {
  hRemoveDrink();
  const L = H_LOCS.bar, g = makeBarGlass(gold);
  const home = new THREE.Vector3(6.72, 1.15 + 0.06, L.pos.z - 0.12); // 상판 위에 정확히 // 카운터 앞쪽, 살짝 왼쪽
  g.position.copy(home).add(new THREE.Vector3(0.5, 0, 0)); // 바텐더 쪽에서 미끄러져 옴
  club.scene.add(g);
  H.drink = { g, home, gold, slide: 0.6, held: null, anim: null, drinkT: 0, done: false };
  audio.sfx('click');
}
export function hRemoveDrink() { if (H.drink) { club.scene.remove(H.drink.g); H.drink = null; } }
export function hTryGrabDrink(c) {
  const d = H.drink; if (!d || d.held || d.done || d.anim) return false;
  const gi = grabInfo(c); if (!gi) return false;
  if (gi.point.distanceTo(d.g.position) > 0.15) return false;
  gi.anchor.updateMatrixWorld(true); d.g.updateMatrixWorld(true);
  d.offset = new THREE.Matrix4().copy(gi.anchor.matrixWorld).invert().multiply(d.g.matrixWorld);
  d.held = { anchor: gi.anchor }; c.userData.hDrink = d;
  audio.sfx('click'); haptic(c, 0.4, 30);
  return true;
}
export function hReleaseDrink(u) { const d = u.hDrink; u.hDrink = null; if (d) d.held = null; }
export function hClickDrink() { // 데스크톱: 잔을 클릭하면 들어서 마심
  const d = H.drink; if (!d || d.done || d.anim) return false;
  raycaster.setFromCamera(mouse.ndc, camera);
  if (!raycaster.intersectObject(d.g, true).length) return false;
  d.anim = { t: 0, from: d.g.position.clone() };
  return true;
}
export const _dm = new THREE.Matrix4(), _dup = new THREE.Vector3(), _dsc = new THREE.Vector3(), _dcam = new THREE.Vector3(), _dfwd = new THREE.Vector3();
export function hUpdateDrink(dt) {
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
export function hDrinkDone() {
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
export function hApproach(p, dist = 0.8) {
  const L = H_LOCS[H.loc], side = Math.random() < 0.5 ? -1 : 1;
  if (p.spot) { p.spot.occ = null; p.spot = null; }
  const tgt = L.pos.clone().addScaledVector(hFwd(L.yaw), H.loc === 'bar' ? 0.25 : dist).addScaledVector(hRight(L.yaw), side * (H.loc === 'bar' ? 0.75 : 0.55));
  p.target = tgt; p.spotType = 'idle';
  p.faceAfter = Math.atan2(L.pos.x - tgt.x, L.pos.z - tgt.z);
}
export function hEncBubble(p, text, dur) { // VR: 질문을 그 로봇 말풍선으로 (가까이 서 있으니 조금 작고 낮게)
  const t = hStrip(text); if (!t) return;
  p.showBubble(t, dur); p.bubble.scale.multiplyScalar(0.7); p.bubble.position.y = 2.12 + p.bubble.scale.y / 2;
}
export function hChoice(o) { // o: { who, q, p, opts: [{ t, ok, reply, d? }], time, approach, onPick }
  const opts = Math.random() < 0.5 ? [o.opts[0], o.opts[1]] : [o.opts[1], o.opts[0]];
  if (o.p && o.approach !== false) hApproach(o.p);
  if (o.p) { if (renderer.xr.isPresenting && o.q) hEncBubble(o.p, o.q, o.time ?? 7); else o.p.showBubble(TR('삐빅!', 'Beep!'), 1.2); }
  H.enc = { kind: 'choice', who: o.who, q: o.q, p: o.p, opts, t: o.time ?? 7, T: o.time ?? 7, raise: [0, 0], onPick: o.onPick, timeout: o.timeout };
  H.grace = 1e9; audio.sfx('select');
}
export function hAct(o) { // o: { who, q, p, need, hold, time, ok: {d, reply}, fail: {d, reply}, after }
  H.enc = { kind: 'act', ...o, t: o.time ?? 6, T: o.time ?? 6, prog: 0, touch: 0 };
  if (o.p && o.q && renderer.xr.isPresenting) hEncBubble(o.p, o.q, o.time ?? 6);
  H.grace = 1e9; audio.sfx('select');
}
export function hEncFinish(d, reply, why, who) {
  const e = H.enc; if (!e) return;
  H.enc = null; encHand.visible = false;
  if (d) hAddSus(d, why);
  if (reply && !(renderer.xr.isPresenting && e.p?.alive && !reply.startsWith('('))) hSay(reply.startsWith('(') ? reply : `${who ?? e.who}: ${reply}`, 4.5); // 속마음은 화자 없이
  if (e.p?.alive && reply && !reply.startsWith('(')) e.p.showBubble(reply, Math.min(6, 2.5 + reply.length * 0.05));
  if (e.p?.alive && e.p.role === 'guest') setTimeout(() => { if (e.p.alive && H.enc?.p !== e.p) club.assign(e.p); }, 1600);
  H.grace = Math.floor(audio.beat() ?? 0) + 5;
  H.evT = rand(9, 13);
}
export function hEncChoose(i) {
  const e = H.enc; if (!e || e.kind !== 'choice') return;
  const o = e.opts[i];
  audio.sfx(o.ok ? 'scanDone' : 'deny');
  const d = o.d ?? (o.ok ? -6 : 18);
  const why = o.ok ? TR('로봇다운 대답', 'Robotic answer') : TR('인간 같은 대답!', 'Too human!');
  hEncFinish(d, o.reply, why);
  o.then?.(); e.onPick?.(o);
}
export function hActBeat() { // PC 악수 등: 박에 맞춰 Space
  const e = H.enc, b = audio.beat(); if (b == null) return;
  const err = Math.abs(b - Math.round(b)) * 60 / (audio.liveBpm || 120);
  if (err < 0.16) { audio.sfx('scanDone'); hEncFinish(e.ok.d, e.ok.reply, TR('완벽', 'PERFECT')); e.after?.(true); }
  else { audio.sfx('deny'); hEncFinish(e.fail.d, e.fail.reply, TR('어긋남', 'Off')); e.after?.(false); }
}

// 이벤트 정의
export const HE = {
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
export function hPickEvent() {
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

export function hEncUpdate(dt, t) {
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
export function hEncPose() {
  const e = H.enc; if (!e?.p || e.p.target) return;
  if (e.kind === 'act' && e.need === 'touch') e.p.armR.rotation.set(-1.45, 0, 0);
  else if (e.kind === 'choice') e.p.neck.rotation.x = 0.15;
}

// ── 메인 갱신 ─────────────────────────────

// ── 인간 모드 튜토리얼: 수습 잠입 ─────────────────────────────
// 이어폰 속 박자 학원 강사가 하나씩 알려 줌. 실제로 해야 넘어가고, 그동안 의심은 오르지 않음.
export const H_TUT = { n: 0, dur: Infinity, pool: {}, urges: true, tutorial: true };
export const hN = () => (H.pvp ? up.H_PVP : H.tutorial ? H_TUT : H_NIGHTS[H.night] || H_NIGHTS[0]);
export const HT = { step: -1, t: 0, yawAcc: 0, lastYaw: null, hits: 0, ok: null, wait: 0, hp0: 0 };
export const TUT_WHO = TR('이어폰 속 학원 강사', 'Earpiece instructor');
export const hTutSay = (pc, vr) => hSay(`${TUT_WHO}: ${renderer.xr.isPresenting && vr ? vr : pc}`, 999);
export const _ty = new THREE.Vector3();
export function hCamYaw() { camera.getWorldDirection(_ty); return Math.atan2(-_ty.x, -_ty.z); }
export const H_TUT_STEPS = [
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
export function hTutUpdate(dt) {
  if (HT.leaving) return;
  if (HT.step < 0) { HT.step = 0; HT.t = 0; H_TUT_STEPS[0].enter(); return; }
  HT.t += dt;
  if (H_TUT_STEPS[HT.step].update(dt)) {
    HT.step++; HT.t = 0; H.msgT = 0;
    if (HT.step < H_TUT_STEPS.length) H_TUT_STEPS[HT.step].enter();
  }
}

export function updateHuman(dt, t) {
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
    if (H.pvp) up.pvpHumanWatch(); // 대결: 감시 = 상대가 나를 선택했을 때
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
      if (H.sweat >= 100) { H.sweat = 45; if (H.pvp) up.pvpSend({ t: 'ev', e: 'drip' }); hAddSus(15, TR('땀이 뚝뚝!', 'Dripping sweat!')); hSay(pick(HL.sweatDrip), 4.5); }
      if (!H.sneeze) { H.sneezeT -= dt; if (H.sneezeT <= 0 && !H.enc && !H.tutorial) { H.sneeze = { t: H.tutSneeze ? 2.6 : 4 }; audio.sfx('tick');
        if (!H.tutSneeze) { H.tutSneeze = true; hSay(renderer.xr.isPresenting ? TR('재채기가 나오려 한다! 로봇은 재채기를 안 한다. 손으로 얼굴을 가려라.', 'A sneeze is coming! Robots don\'t sneeze. Cover your face with your hand.') : TR('재채기가 나오려 한다! 로봇은 재채기를 안 한다. F 키를 꾹 눌러 얼굴을 가려라.', 'A sneeze is coming! Robots don\'t sneeze. Hold F to cover your face.'), 5); } } }
      else {
        H.sneeze.t -= dt;
        if (H.sneeze.t <= 0) {
          H.sneezeOk = atFace;
          if (atFace) { hAddSus(H.watch ? 3 : 0, TR('재채기 참음!', 'Sneeze held!')); hSay(pick(HL.sneezeHeld), 4); }
          else { audio.sfx('cough'); if (H.pvp) up.pvpSend({ t: 'ev', e: 'sneeze' }); hAddSus(25, TR('에취!!', 'ACHOO!!')); hSay(pick(HL.sneezeFail), 5); }
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
          up.PVP.acc *= 0.6; hAddSus(H.face > 0.2 ? 2 : 4, TR('박자 놓침', 'Missed beat'));
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
export const hChalk = new CanvasPanel(0.3, 0.2, 600, 400);
hChalk.material.fog = false;
export const hBoards = [];
export const CHALK_WOOD = flat(0xa8743e, { roughness: 0.85 });
export function buildChalkboard(scale, standH) { // standH: 이젤 높이(칠판 가운데). 0이면 탁상용
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
export let hChalkT = 0, hChalkKey = '';
export function chalkText(c, text, x, y, font, color) { // 분필 글씨: 살짝 번진 테두리 + 거친 질감
  c.font = font; c.fillStyle = color;
  c.globalAlpha = 0.25; c.fillText(text, x + 1.5, y + 1); c.globalAlpha = 0.9; c.fillText(text, x, y); c.globalAlpha = 1;
}
export function drawChalk(N) {
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
export const hWatch = new THREE.Group();
export const hWatchFace = new CanvasPanel(0.064, 0.064, 256, 256, { transparent: true });
{
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.075), flat(0x1b1b1b, { roughness: 0.9 }));
  strap.rotation.y = Math.PI / 2; // 손목 둘레 방향
  const caseM = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.008, 0.07), flat(0xc8ccd2, { metalness: 0.8, roughness: 0.35 }));
  caseM.position.y = 0.003;
  hWatchFace.mesh.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); hWatchFace.mesh.position.y = 0.0075; // 글자 위쪽 = 엄지 쪽
  hWatch.add(strap, caseM, hWatchFace.mesh);
  hWatch.visible = false;
}
export let hWatchT = 0;
export function drawWatch(t) {
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
export function hLeftHand() { // 왼손: 맨손이면 손목 관절, 컨트롤러면 손 모델
  for (const c of controllers) {
    const u = c.userData; if (u.input?.handedness !== 'left') continue;
    if (u.isHand) { const j = u.hand.joints?.wrist; return j ? { obj: j, pos: [0, 0.022, 0.035] } : null; }
    if (u.ctrlHand) return { obj: u.ctrlHand.root, pos: [0, 0.026, 0.11] };
  }
  return null;
}

// 선택지 카드 (왼손 위 = 1번, 오른손 위 = 2번)
export const hCards = [0, 1].map(() => {
  const p = new CanvasPanel(0.24, 0.12, 512, 256, { transparent: true, depthTest: false });
  p.mesh.renderOrder = 60; p.mesh.visible = false; p.key = '';
  club.scene.add(p.mesh);
  return p;
});
export function drawCard(p, i, e) {
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
export function hThump(vol, delay = 0) {
  const a = audio.ctx; if (!a) return;
  const t0 = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(70, t0); o.frequency.exponentialRampToValueAtTime(38, t0 + 0.14);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
  o.connect(g); g.connect(audio.sfxG || a.destination); o.start(t0); o.stop(t0 + 0.2);
}
export const VISOR_YEL = new THREE.Color(0xffc23b), VISOR_RED = new THREE.Color(0xff2030);
export function hVrUi(dt, t) {
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
export const hWalkSign = new CanvasPanel(0.26, 0.085, 520, 170, { transparent: true });
hWalkSign.mesh.renderOrder = 40; hWalkSign.material.fog = false; hWalkSign.mesh.visible = false;
club.scene.add(hWalkSign.mesh);
export let hWalkKey = '';
export function hCanWalk() { return H.active && !H.ending && !H.between && !H.moving && !H.enc && !hFrozen() && !(H.freeze?.phase === 'warn') && !(H.walkCD > 0) && !H.tutorial; }
export function hWalk() {
  if (!hCanWalk()) { audio.sfx('deny'); return; }
  const to = H.loc === 'bar' ? 'floor' : 'bar';
  const beat = audio.beat() ?? 0;
  if (to === 'bar' && H.rallyEnd > beat) hAddSus(10, TR('소집 중 이탈!', 'Left during rally!')); // 대결: 소집 춤 도중에 빠지면 수상
  H.walkCD = 3; H.stay = to === 'floor'; H.walkGo = true;
  audio.sfx('click');
  hGoto(to);
}
export function drawWalkSign() {
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
export const _ws = new THREE.Vector3(), _wt = new THREE.Vector3();
export function hWalkUpdate(dt) {
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
export function hClickWalk() { // PC: 표지판 클릭
  if (!hWalkSign.mesh.visible) return false;
  raycaster.setFromCamera(mouse.ndc, camera);
  if (!raycaster.intersectObject(hWalkSign.mesh).length) return false;
  hWalk(); return true;
}

// ── HUD ─────────────────────────────
// 그림자 있는 글자 (배경판 없이도 읽히게)
export function hText(c, s, x, y, font, color, align = 'left', outline = true) {
  c.font = font; c.textAlign = align; c.textBaseline = 'middle';
  if (outline) { c.lineJoin = 'round'; c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,.85)'; c.strokeText(s, x, y); }
  c.fillStyle = color; c.fillText(s, x, y);
}
export const SUB_FONT = (px) => `400 ${px}px "Pretendard", ${FONT}`; // 자막: 프리텐다드 레귤러
export function hPill(c, x, y, w, h, fill, stroke) {
  c.fillStyle = fill; roundRect(c, x, y, w, h, Math.min(16, h / 2)); c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 2; roundRect(c, x, y, w, h, Math.min(16, h / 2)); c.stroke(); }
}
export function drawHumanHud(beat, t) {
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
export function drawEncHud() { /* 자막/선택지 카드로 통합됨 */ }
export function drawHeart(c, x, y, r, full) { // 체력 아이콘 (이모지 대신 도형)
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
export function drawHumanTop(t, N) {
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
export function update(dt, t) {
  up.pvpTick(dt);
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
  if (up.LOBBY.active) up.lobbyUpdate(dt, t); // 지하에선 보안실 버튼·물건·레이를 건드리지 않음
  else { updatePoke(); updateItems(dt); updatePointers(); }
  room.update(dt, t);
  updatePanels(dt, t);
}

export let frameNo = 0;
export function renderCCTV() {
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


