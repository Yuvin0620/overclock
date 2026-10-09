import * as THREE from 'three';
import { LANG, TR, setLang } from './i18n.js';
import { FONT, rand, pick, clamp, shuffle, wrapText } from './util.js';
import { audio } from './audio.js';
import { Patron } from './patron.js';
import { DOOR, DJ_POS } from './club.js';
import { BENE, robot } from './story.js';
import { club, room, G, bark, makePatron, spawnDJ, setupNight, deny, showEnd, overlay, setLook } from './game.js';
import { H_LOCS, H, hSay, hGoto, hEnd, encHand, hRemoveDrink, hBoards } from './human.js';
import { LOBBY, DISC_INFO } from './lobby.js';

// ═════════════ pvp.js — 대결 모드: 감시로봇 1명 vs 인간 여러 명 (PeerJS · P2P) ═════════════
// 감시로봇이 방장: 방을 만들면 5자리 코드(1~3). 인간들은 키보드 1/2/3으로 코드 입력 → 대기 → 방장이 [1]로 시작.
// 감시로봇 쪽 클럽이 '진짜'. 인간들은 자기 상태(자리·박자 정확도·땀·얼굴에 손·재채기)만 보내고,
// 감시로봇 쪽은 그 상태로 각자의 손님(아바타)을 움직임. 인간들의 자리는 바·플로어에서 무작위라 위치로는 못 알아냄.
export const PVP = { on: false, role: null, stage: null, code: '', typed: '', err: '', peer: null, conn: null, ready: false,
  players: new Map(), slot: null, watch: false, scan: false, acc: 1, over: false, why: '', sendT: 0, retry: 0 };
export const PVP_DUR = 150, PVP_MAX = 4;
// 연결 경로: STUN(직접 연결 시도) + TURN(학교·회사 와이파이처럼 직접 연결이 막힐 때 중계)
// TURN 아이디/비번은 코드에 두지 않음 → Netlify 함수(netlify/functions/turn.mjs)가 환경 변수에서 꺼내 줌
export const PVP_ICE = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'stun:stun.l.google.com:19302' },
];
export let PVP_TURN = null; // 함수에서 받아 온 TURN 서버들 (없으면 빈 배열 → STUN만)
export async function pvpIce() {
  if (PVP_TURN) return [...PVP_ICE, ...PVP_TURN];
  try {
    const r = await fetch('/.netlify/functions/turn', { cache: 'no-store' });
    if (r.ok) PVP_TURN = (await r.json()).iceServers || [];
  } catch {}
  if (!PVP_TURN) PVP_TURN = [];
  return [...PVP_ICE, ...PVP_TURN];
}
export const PVP_ID = (code) => 'club-overclock-pvp-v3-' + code;
export const PVP_PRIV_ID = (code) => 'club-overclock-pvp-v3-priv-' + code; // 비공개 방: 인간 대기열엔 안 잡히고 코드로만
export const PVP_CODES = []; for (const a of '123') for (const b of '123') for (const c of '123') PVP_CODES.push(a + b + c); // 방 27개
export const PVP_NIGHT = {
  title: TR('대결 · 인간 vs 감시로봇', 'VERSUS · Humans vs Security'), duration: PVP_DUR, scans: 3,
  initial: Array.from({ length: 13 }, () => robot()), // 대결: 진짜 인간 말고는 전부 평범한 로봇 (가발·녹·냉각수·테이프 같은 헷갈리는 장식 없음)
  spawns: [], brief: [], barks: [],
};
export const H_PVP = { n: 1, dur: PVP_DUR, pool: { order: 2, talk: 3, floor: 3, offer: 1 }, urges: true,
  title: TR('대결 · 인간 vs 감시로봇', 'VERSUS · Humans vs Security'),
  intro: TR('보안실에 진짜 사람이 앉아 있다. 손님 중 누가 인간인지 찾고 있다. 150초만 버티자.', 'A real player is in the security room, hunting for the humans among the guests. Survive 150 seconds.') };

export async function pvpNewPeer(id) {
  const m = await import('https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm');
  const Peer = m.Peer || m.default;
  const opts = { debug: 1, config: { iceServers: await pvpIce() } };
  return id ? new Peer(id, opts) : new Peer(opts);
}
export function pvpReset() {
  clearInterval(PVP.keep);
  try { PVP.conn?.close(); } catch {} for (const pl of PVP.players.values()) { try { pl.conn.close(); } catch {} }
  try { PVP.peer?.destroy(); } catch {}
  PVP.players.clear();
  Object.assign(PVP, { stage: null, code: '', typed: '', err: '', peer: null, conn: null, role: null, ready: false, slot: null, retry: 0, rounds: 0, cd: null, qn: 0, qcd: null });
}
export function pvpFail(msg) { PVP.stage = 'error'; PVP.err = msg; audio.sfx('deny'); try { PVP.peer?.destroy(); } catch {} PVP.peer = null; PVP.conn = null; }
export const pvpErrText = (e) => e?.type === 'peer-unavailable' ? TR('그 코드의 방을 못 찾았어요. ① 코드 확인 ② 감시로봇 화면에 「● 접속 가능」이 떠 있는지 ③ 다 같이 최신 버전으로 새로고침', "Couldn't find that room. Check the code, that the host shows '● Ready', and that everyone reloaded the latest version.")
  : e?.type === 'network' || e?.type === 'server-error' || e?.type === 'socket-error' ? TR('연결 서버에 닿지 않아요. 인터넷을 확인하세요.', 'Cannot reach the connection server. Check your internet.')
  : TR('연결 실패: ', 'Connection failed: ') + (e?.type || e?.message || e);
export function pvpSend(m) { try { if (PVP.conn?.open) PVP.conn.send(m); } catch {} }           // 인간 → 감시로봇
export function pvpSendTo(pl, m) { try { if (pl.conn?.open) pl.conn.send(m); } catch {} }      // 감시로봇 → 인간 한 명

// ── 방 만들기 (감시로봇) ──
export async function pvpHost(idx = 0, priv = false) {
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
export function pvpPlayerLeft(pl) {
  if (!PVP.players.has(pl.id)) return;
  if (!PVP.on) { PVP.players.delete(pl.id); audio.sfx('click'); return; } // 시작 전: 그냥 빠짐
  if (pl.out) return;
  pl.out = 'left';
  const p = pl.avatar; if (p && p.alive) { p.showBubble(TR('먼저 갈게~', 'Gotta go~'), 2); p.target = DOOR.clone(); p.wanderT = Infinity; setTimeout(() => { if (p.alive) club.remove(p); }, 6000); }
  pvpCheckAllOut();
}
export function pvpStartAll() { // 방장이 [1] = 시작
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
export function pvpHostData(pl, m) {
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
export async function pvpJoin(code) {
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
export async function pvpQuick() { // 빠른 참가: 방 27개에 한꺼번에 노크 → 처음 받아 준 방으로. 없으면 몇 초마다 다시
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
export function pvpHostLost() {
  if (!PVP.on) { if (PVP.stage === 'waiting' || PVP.stage === 'connecting') pvpFail(TR('감시로봇이 방을 닫았어요.', 'The host closed the room.')); return; }
  if (PVP.over) return;
  PVP.over = true; PVP.why = 'left';
  if (H.active && !H.ending) hEnd(true); // 감시로봇이 나감 → 남은 인간 승리
}
export function pvpHumanData(m) {
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
export function pvpApplySlot(s) { // 내 자리: 바 의자 · 플로어 위치 (감시로봇 화면과 같은 곳)
  H_LOCS.bar.pos.z = s.barZ;
  H_LOCS.floor.pos.set(s.fx, 0, s.fz); H_LOCS.floor.yaw = s.fy;
  const b = hBoards[0]; if (b) { b.position.z = s.barZ - 0.57; b.rotation.y = Math.atan2(H_LOCS.bar.pos.x - b.position.x, H_LOCS.bar.pos.z - b.position.z); }
}

// ── 결과 ──
export function pvpEndText(winner) { // 인간 쪽 엔딩 문구
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
export function pvpCaught(pl, why) { // 감시로봇이 귀가 조치
  pl.out = why;
  pvpSendTo(pl, { t: 'end', winner: 'sec', why });
  pvpCheckAllOut();
}
export function pvpCheckAllOut() {
  if (PVP.over || !PVP.on) return;
  const pls = [...PVP.players.values()];
  if (pls.every((p) => p.out)) pvpHostEnd(pls.some((p) => p.out === 'survived') ? 'time' : 'all');
}
export function pvpHostEnd(why) { // 감시로봇 쪽 결판
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
export const pvpLocs = (pl) => ({
  bar: { pos: new THREE.Vector3(H_LOCS.bar.pos.x, 0, pl.slot.barZ), yaw: H_LOCS.bar.yaw },
  floor: { pos: new THREE.Vector3(pl.slot.fx, 0, pl.slot.fz), yaw: pl.slot.fy },
});
export function pvpReserveSpots() { // 인간들이 서는 바 · 플로어 자리는 비워 둠 (나머지 자리엔 로봇이 섞여 있음)
  for (const pl of PVP.players.values()) {
    if (!pl.slot) continue;
    for (const L of Object.values(pvpLocs(pl))) for (const s of club.spots) if (Math.hypot(s.pos.x - L.pos.x, s.pos.z - L.pos.z) < 0.9) s.occ = 'player';
  }
}
export function pvpBeginSec() {
  audio.init();
  overlay.style.display = 'none'; document.getElementById('help').style.display = 'block';
  setLook(0, -0.1); G.hard = false; G.complaints = 0;
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
export function pvpAvatarUpdate(pl) {
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
export let pvpDecoyT = 12;
export function pvpDecoys(dt) { // 바 ↔ 플로어를 오가는 로봇들 (인간만 움직이면 티 나니까)
  pvpDecoyT -= dt; if (pvpDecoyT > 0) return;
  pvpDecoyT = rand(3.5, 7);
  const cand = club.patrons.filter((p) => p.alive && p.role === 'guest' && !p.pvpPlayer && !p.target);
  if (!cand.length) return;
  const atBar = cand.filter((p) => p.spot?.type === 'bar'), elsewhere = cand.filter((p) => p.spot?.type !== 'bar');
  if (atBar.length && Math.random() < 0.5) { const a = pick(atBar), b = pick(elsewhere.length ? elsewhere : cand); club.assign(a, 'dance'); if (b !== a) club.assign(b, 'bar'); } // 바 자리 교대
  else club.assign(pick(cand), Math.random() < 0.5 ? 'bar' : 'dance');
}

// ── 매 프레임 (양쪽 공통) ──
export const PVP_CD = 15; // 마지막 인간이 들어온 뒤 15초 동안 아무도 안 오면 시작
export function pvpQueueTick(dt) { // 감시로봇 대기열: 인간이 1명 이상이면 카운트다운 → 자동 시작
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
export function pvpTick(dt) {
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
export function pvpRally() { // 감시로봇: 전원 댄스플로어로! → 로봇은 칼박, 인간은 따라가서 박자 맞춰야
  room.buttons.dj.push();
  if (PVP.rallies <= 0) return deny(TR('소집은 다 썼어요.', 'No rallies left.'));
  if (PVP.rallyT > 0) return deny(TR('소집 중이에요.', 'Rally in progress.'));
  PVP.rallies--; PVP.rallyT = 14;
  audio.sfx('alarm'); club.party = 0.6;
  bark(BENE, TR(`전원 댄스플로어로! 로봇은 박자를 틀리지 않습니다. (소집 ${PVP.rallies}번 남음)`, `Everyone to the dance floor! Robots never miss a beat. (${PVP.rallies} rallies left)`), 5);
  for (const p of club.patrons) if (p.alive && p.role === 'guest' && !p.pvpPlayer) { club.assign(p, 'dance'); p.speed = 2.2; p.wanderT = rand(18, 26); }
  for (const pl of PVP.players.values()) if (!pl.out) pvpSendTo(pl, { t: 'rally' });
}
export function pvpHumanRally() { // 인간: 소집 방송 → 잠깐 뒤 플로어로, 평소보다 길게 춤
  if (!H.active || H.ending || H.between) return;
  audio.sfx('alarm');
  hSay(TR('BENE-9 (방송): 「전원 댄스플로어로! 지금 바로! 로봇은 박자를 틀리지 않습니다.」', 'BENE-9 (PA): "Everyone to the dance floor! Now! Robots never miss a beat."'), 4);
  H.enc = null; encHand.visible = false; hRemoveDrink();
  if (H.loc === 'floor') { const e = Math.floor(audio.beat() ?? 0) + 24; if (!H.stay) H.danceEnd = Math.max(H.danceEnd, e); H.rallyEnd = e; return; }
  H.rally = true;
  setTimeout(() => { if (H.active && !H.ending) hGoto('floor'); }, 1500);
}
export function pvpHumanWatch() { // 인간 쪽: 감시 카메라 = 감시로봇이 나를 선택했을 때
  if (PVP.watch && !H.watch) { audio.sfx('tick'); if (!H.enc) hSay(TR('감시로봇이 나를 보고 있다! (실수하면 의심 2배)', 'The security robot is watching me! (mistakes count double)'), 3); }
  H.watch = PVP.watch;
}

// ── 메인 화면(로비) ──
export function pvpLobbyKey(id) {
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
export function pvpDrawScreen(c, w, h, cursor) {
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

