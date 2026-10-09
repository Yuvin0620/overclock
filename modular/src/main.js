import * as THREE from 'three';
// 모듈을 원래 합쳐 쓰던 순서대로 먼저 불러온다 (최상위 코드가 이 순서에 의존함)
import './i18n.js';
import './config.js';
import './util.js';
import './audio.js';
import './patron.js';
import './club.js';
import './room.js';
import './story.js';
import './game.js';
import './human.js';
import './lobby.js';
import './pvp.js';
import { audio } from './audio.js';
import { BOX_HEAD } from './patron.js';
import { OIL_MODEL, makeOilCan } from './room.js';
import { renderer, club, room, camera, G, D, drawDialog, drawGuide, makePatron, setupNight, startNight, endNight, overlay, titleMode, titleCam, setLeverAngle, leverAngleFrom, releaseLever, mouse } from './game.js';
import { H, startHuman, hStartNight, hGoto, humanHit, hEncChoose, HE, HT, hWatch, drawWatch, hCards, drawCard, hVrUi, update, renderCCTV } from './human.js';
import { LOBBY, lobbyInsert, lobbyKey } from './lobby.js';
import { PVP, pvpHostData, pvpBeginSec } from './pvp.js';
// 위쪽 모듈의 함수·상태를 아래쪽 모듈이 쓸 수 있게 등록 (모듈끼리 서로 불러오는 순환을 끊기 위함)
import { up } from './up.js';
import { hRecenter, hTryGrabDrink, hReleaseDrink, hClickDrink, hWalk, hClickWalk } from './human.js';
import { lobbyClick, lobbyGrab, lobbyRelease, lobbyRecenter, lobbyPcCam, lobbyUpdate } from './lobby.js';
import { PVP_NIGHT, H_PVP, pvpReset, pvpSend, pvpEndText, pvpCaught, pvpHostEnd, pvpReserveSpots, pvpTick, pvpRally, pvpHumanWatch, pvpLobbyKey, pvpDrawScreen } from './pvp.js';
Object.assign(up, { H, startHuman, hRecenter, humanHit, hTryGrabDrink, hReleaseDrink, hClickDrink, hEncChoose, hWalk, hClickWalk, LOBBY, lobbyClick, lobbyGrab, lobbyRelease, lobbyRecenter, lobbyPcCam, lobbyUpdate, PVP, PVP_NIGHT, H_PVP, pvpReset, pvpSend, pvpEndText, pvpCaught, pvpHostEnd, pvpReserveSpots, pvpBeginSec, pvpTick, pvpRally, pvpHumanWatch, pvpLobbyKey, pvpDrawScreen });

setupNight(0);
drawDialog();
export const BLANK_SCENE = new THREE.Scene(); BLANK_SCENE.background = new THREE.Color(0x000000);
export let last = performance.now();
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

