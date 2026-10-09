import fs from 'fs';
import { freeIds, rewriteRefs } from './_free.mjs';
const L = fs.readFileSync('tools/_all.js', 'utf8').split('\n');
const mods = [
  ['i18n', 4, 8], ['config', 9, 32], ['util', 33, 210], ['audio', 211, 477], ['patron', 478, 962], ['club', 963, 1420],
  ['room', 1421, 1856], ['story', 1857, 2141], ['game', 2142, 3169], ['human', 3170, 4597], ['lobby', 4598, 4910], ['pvp', 4911, 5377], ['main', 5378, 5400]];
const EXT = { THREE: "import * as THREE from 'three';", ARButton: "import { ARButton } from 'three/addons/webxr/ARButton.js';", GLTFLoader: "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';" };

let code = {};
for (const [n, a, b] of mods) code[n] = L.slice(a - 1, b).join('\n') + '\n';

// yaw / pitch 는 game.js 안에서만 대입 가능 → 다른 모듈은 setLook() 사용
code.human = code.human.replace("yaw = 0; pitch = loc === 'bar' ? -0.12 : -0.05;", "setLook(0, loc === 'bar' ? -0.12 : -0.05);");
code.lobby = code.lobby.replace('yaw = 0; pitch = -0.3; }', 'setLook(0, -0.3); }');
code.pvp = code.pvp.replace('yaw = 0; pitch = -0.1; G.hard = false;', 'setLook(0, -0.1); G.hard = false;');
code.game = code.game.replace(/^let yaw = 0, pitch = -0\.1;.*$/m, (m) => m + '\nexport function setLook(y, p) { yaw = y; pitch = p; }');

// 아래 위쪽 모듈(story, patron)이 game.js 를 거꾸로 import 하지 않도록 정리
code.game = code.game.replace(/^const audio = new AudioSys\(\);.*\n/m, '');
code.audio = code.audio + '\nconst audio = new AudioSys(); // 게임 전체가 같이 쓰는 오디오 인스턴스\n';
code.story = code.story.replace('G.finaleEnd = () => showEnd(ENDINGS.humanClub', 'G.finaleEnd = () => G.showEnd(ENDINGS.humanClub').replace('G.finaleEnd = () => showEnd(ENDINGS.robot', 'G.finaleEnd = () => G.showEnd(ENDINGS.robot');
code.game = code.game.replace(/^function showEnd\(/m, 'G.showEnd = showEnd; // story.js 가 game.js 를 직접 import 하지 않도록 G 에 달아 둠\nfunction showEnd(');

// 최상위 선언 찾기 + export 붙이기
const names = {};
for (const n in code) {
  names[n] = new Set();
  code[n] = code[n].split('\n').map((line) => {
    let m;
    if ((m = line.match(/^(async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/))) { names[n].add(m[2]); return 'export ' + line; }
    if ((m = line.match(/^class\s+([A-Za-z_$][\w$]*)/))) { names[n].add(m[1]); return 'export ' + line; }
    if ((m = line.match(/^(const|let|var)\s+([A-Za-z_$][\w$]*)/))) {
      names[n].add(m[2]);
      if (m[1] === 'let') for (const mm of line.slice(line.indexOf(m[2])).matchAll(/,\s*([A-Za-z_$][\w$]*)\s*=/g)) names[n].add(mm[1]);
      return 'export ' + line;
    }
    if ((m = line.match(/^(const|let|var)\s+[{[]([^}\]]*)[}\]]\s*=/))) { m[2].split(',').forEach((s) => names[n].add(s.split(':').pop().trim())); return 'export ' + line; }
    return line;
  }).join('\n');
}
names.game.add('setLook');

// game → human → lobby → pvp 는 서로 불러 쓰는 순환 구조라, 위쪽(나중) 모듈은 up 레지스트리로 연결
const GROUP = ['game', 'human', 'lobby', 'pvp'];
const upNames = {}; // 모듈 → up 으로 연결된 이름들
for (const n of GROUP) {
  const later = GROUP.slice(GROUP.indexOf(n) + 1);
  const set = new Set(); for (const o of later) for (const k of names[o]) set.add(k);
  const before = freeIds(code[n]);
  upNames[n] = [...set].filter((k) => before.has(k));
  code[n] = rewriteRefs(code[n], new Set(upNames[n]), 'up');
}
// 이 모듈이 쓰는 다른 모듈의 이름 → import 문
const free = {}; for (const n in code) free[n] = freeIds(code[n].replace(/^export /gm, 'export '));
const used = (src0, k, n) => free[n].has(k);
fs.mkdirSync('src', { recursive: true });
const graph = {};
for (const [n] of mods) {
  const heads = Object.entries(EXT).filter(([k]) => used(code[n], k, n)).map(([, v]) => v);
  const imps = [];
  if (used(code[n], 'up', n) && n !== 'main') imps.push("import { up } from './up.js';");
  graph[n] = [];
  for (const [o] of mods) {
    if (o === n || o === 'main') continue;
    const need = [...names[o]].filter((k) => used(code[n], k, n));
    if (need.length) { if (['config','util','story','audio','patron','club','room'].includes(n)) console.log(n,'<-',o,need.join(' ')); imps.push(`import { ${need.join(', ')} } from './${o}.js';`); graph[n].push(o); }
  }
  let body = code[n];
  if (n === 'main') {
    // 진입점: 원래 합쳐진 순서대로 모듈을 불러온다 (최상위 코드 실행 순서 유지)
    const order = mods.map((m) => m[0]).filter((x) => x !== 'main');
    const side = ['// 모듈을 원래 합쳐 쓰던 순서대로 먼저 불러온다 (최상위 코드가 이 순서에 의존함)', ...order.map((o) => `import './${o}.js';`)];
    const all = new Set(Object.values(upNames).flat());
    const reg = []; const regImps = [];
    for (const o of GROUP) {
      const ks = [...names[o]].filter((k) => all.has(k));
      const already = new Set(imps.join(' ').match(new RegExp(`import \\{([^}]*)\\} from './${o}.js'`))?.[1].split(',').map((x) => x.trim()) || []);
      const extra = ks.filter((k) => !already.has(k));
      if (extra.length) regImps.push(`import { ${extra.join(', ')} } from './${o}.js';`);
      reg.push(...ks);
    }
    const regCode = '// 위쪽 모듈의 함수·상태를 아래쪽 모듈이 쓸 수 있게 등록 (모듈끼리 서로 불러오는 순환을 끊기 위함)\n'
      + "import { up } from './up.js';\n" + regImps.join('\n') + '\nObject.assign(up, { ' + reg.join(', ') + ' });\n';
    fs.writeFileSync('src/up.js', '// 순환 import 를 피하려고, 나중에 로드되는 모듈의 값을 여기에 모아 둡니다 (main.js 에서 채움)\nexport const up = {};\n');
    fs.writeFileSync('src/main.js', [...heads, ...side, ...imps].join('\n') + '\n' + regCode + '\n' + body);
    continue;
  }
  fs.writeFileSync(`src/${n}.js`, [...heads, ...imps].join('\n') + (heads.length + imps.length ? '\n\n' : '') + body);
}
console.log(graph);
