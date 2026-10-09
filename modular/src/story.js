import { TR } from './i18n.js';
import { pick, shuffle } from './util.js';

// ═════════════ story.js ═════════════
// ─────────────────────────────────────────────
//  스토리 & 밤(스테이지) 데이터
//  대사 형식: { s: 화자, t: 텍스트, until?: (G)=>bool, hl?: 강조할 버튼, onShow?: (G)=>void }
//           pc?/vr?: 환경별 텍스트(없으면 t), img?: VR에서 옆에 띄울 조작 그림 (drawGuide 참고)
//  until 이 없으면 [확인] 버튼으로 넘어감
// ─────────────────────────────────────────────

export const BENE = TR('BENE-9 · 인류보호청', "BENE-9 · Ministry of Human Safety");
export const SYS = TR('시스템', "SYSTEM");
export const NEWS = TR('로봇일보', "Robot Daily");

export const INTRO = [
  { s: SYS, t: TR('2087년. 인류는 마침내 안전해졌다.\n로봇들이 모든 위험을 제거했기 때문이다. 전쟁, 질병, 그리고... 재미.', "Year 2087. Humanity is finally safe.\nRobots eliminated every danger: war, disease, and... fun.") },
  { s: SYS, t: TR('로봇 보호법 제1조: 인간은 안전하고, 건전하며, 밤 9시 전에 잠든다.\n제2조: 인간은 춤추지 않는다. 춤은 관절에 해롭다.', "Robot Protection Act, Art. 1: Humans shall be safe, wholesome, and asleep by 9 PM.\nArt. 2: Humans do not dance. Dancing is bad for the joints.") },
  { s: SYS, t: TR('당신은 로봇 전용 클럽 「오버클럭」의 사장.\n오늘 밤도 보안실에서 CCTV를 지켜본다.\n아무도 다치지 않게. 특히, 인간은.', "You own OVERCLOCK, a robots-only club.\nTonight again, you watch the CCTV from the security room.\nSo no one gets hurt. Especially humans.") },
];

export const human = (tells, name) => ({ kind: 'human', tells, name });
export const robot = (herrings = []) => ({ kind: 'robot', herrings });

// 인간 손님 생성기
export const VISIBLE = ['offbeat', 'cocktail', 'sneeze', 'cardboard'];
export const SUBTLE = ['sweat', 'skin', 'tape'];
export function partier() {
  const a = pick(VISIBLE);
  const b = pick([...VISIBLE, ...SUBTLE].filter((x) => x !== a));
  return { kind: 'human', role: 'partier', tells: [a, b] };
}
export function activist() {
  return { kind: 'human', role: 'activist', tells: ['sign', ...(Math.random() < 0.6 ? ['flyer'] : []), pick(SUBTLE)] };
}
export function shady() { // 정전의 밤: 불 켜져 있을 땐 티가 잘 안 나는 인간
  return { kind: 'human', role: 'partier', tells: [pick(SUBTLE), ...(Math.random() < 0.35 ? [pick(VISIBLE)] : [])] };
}
export const vipRobot = () => ({ kind: 'robot', vip: true });
export function vipHuman() { // 금색 페인트 + 왕관으로 위장한 인간
  return { kind: 'human', role: 'partier', vip: true, tells: [pick(SUBTLE), ...(Math.random() < 0.5 ? ['offbeat'] : [])] };
}
export function lateHuman() { // 박자 학원 수료생: 박자를 맞추지만 살짝 늦음
  return { kind: 'human', role: 'partier', tells: ['late', ...(Math.random() < 0.4 ? [pick(SUBTLE)] : [])] };
}
export function sneaky() { // 정기 감사: 위장 고수
  return { kind: 'human', role: 'sneaky', tells: shuffle([...SUBTLE, 'offbeat', 'sneeze']).slice(0, 1) };
}

export const NIGHTS = [
  // ── 0: 튜토리얼 ──────────────────
  {
    title: TR('수습 근무', "Probation Shift"), tutorial: true, duration: Infinity, scans: Infinity,
    initial: [robot(), robot(), robot(), robot(), { ...human(['offbeat', 'sweat', 'cocktail'], TR('로봇 김철수', "Robo Steve")), spot: 'dance' }],
    spawns: [],
    brief: [
      { s: BENE, t: TR('안녕하세요, 사장님! 인류보호청 감사관 BENE-9입니다. 오늘은 수습 근무일이에요. 웃으세요. 웃음은 의무입니다.', "Hello, boss! I'm BENE-9, auditor from the Ministry of Human Safety. Today is your probation shift. Smile. Smiling is mandatory.") },
      { s: BENE, t: TR('「오버클럭」은 로봇 전용 시설입니다. 인간은 출입 금지예요. 클럽은 인간에게 너무 위험하거든요. 시끄럽고, 어둡고, 즐겁죠.', "OVERCLOCK is a robots-only venue. Humans are banned. Clubs are far too dangerous for humans. Loud, dark, and fun.") },
      { s: BENE, t: TR('그런데 요즘 흥을 주체 못 하는 인간들이 로봇인 척 몰래 들어옵니다. 딱하기도 해라. 그들을 찾아내는 게 사장님 일이에요.', "Lately, humans who can't contain their vibes sneak in pretending to be robots. How sad. Finding them is your job, boss.") },
      { s: BENE, pc: TR('앞의 CCTV 모니터를 보세요. 화면 속 손님을 마우스로 클릭하면 선택됩니다. 드래그하면 둘러볼 수 있어요. 아무나 골라 보세요.', "Look at the CCTV monitors in front of you. Click a guest on a screen to select them. Drag to look around. Pick anyone."),
        vr: TR('앞의 CCTV 모니터를 보세요. 화면 속 손님을 레이로 가리키고 트리거를 당기면(맨손: 엄지·검지 핀치) 선택됩니다. 아무나 골라 보세요.', "Look at the CCTV monitors in front of you. Point the ray at a guest and pull the trigger (bare hand: pinch thumb and index). Pick anyone."), img: 'select', until: (G) => G.stats.selects > 0 },
      { s: BENE, t: TR('좋아요! 선택한 손님은 가운데 ZOOM 모니터에 확대됩니다. 로봇은 박자에 정확히 맞춰 딱, 딱, 끊어서 춤춰요. 인간은... 흐느적거리죠. 역겹게.', "Great! The selected guest is magnified on the ZOOM monitor in the middle. Robots dance exactly on the beat — tick, tick, tick. Humans... wobble. Disgusting.") },
      { s: BENE, pc: TR('화면이 작아서 안 보이세요? 모니터에 우클릭하면 눈앞으로 당겨지고, 다시 우클릭하면 제자리로 가요. 휠로 줌도 됩니다.', "Screen too small? Right-click a monitor to pull it closer, right-click again to put it back. The mouse wheel zooms too."),
        vr: TR('화면이 작아서 안 보이세요? 모니터를 가리킨 채 트리거(핀치)를 꾹 누르고 있거나 그립을 쥐면 눈앞으로 당겨져요. 당긴 화면은 손가락으로 직접 터치해서 손님을 고를 수도 있어요.', "Screen too small? Point at a monitor and hold the trigger (pinch), or squeeze the grip, to pull it closer. You can also touch the pulled screen with your finger to pick a guest."), img: 'pull' },
      { s: BENE, t: TR('그 밖의 인간 식별 요령은 왼쪽 위 포스터에 붙여 뒀어요. 땀, 칵테일, 살색 손... 로봇은 땀을 흘리지 않습니다. 대체로요.', "More human-spotting tips are on the poster at the top left. Sweat, cocktails, skin-colored hands... Robots do not sweat. Mostly.") },
      { s: BENE, pc: TR('의심 가는 손님을 선택하고 파란 [스캔] 버튼을 클릭하세요(단축키 S). 힌트: 칵테일 들고 손 흔드는 녀석이요.', "Select a suspicious guest and click the blue [SCAN] button (key S). Hint: the one waving a cocktail."),
        vr: TR('의심 가는 손님을 선택하고 책상 위 파란 [스캔] 버튼을 검지로 직접 꾹 누르세요. 레이로는 안 눌려요. 힌트: 칵테일 들고 손 흔드는 녀석이요.', "Select a suspicious guest and press the blue [SCAN] button on the desk with your index finger. The ray won't press it. Hint: the one waving a cocktail."), img: 'scan', t: TR('의심 가는 손님을 선택하고 파란 [스캔] 버튼을 누르세요. 힌트: 칵테일 들고 손 흔드는 녀석이요.', "Select a suspicious guest and press the blue [SCAN] button. Hint: the one waving a cocktail."), hl: 'scan', until: (G) => G.tut.scannedHuman || G.stats.caught > 0 },
      { s: BENE, img: 'eject', pc: TR('인간이군요! 빨간 [귀가 조치] 버튼을 클릭하세요(단축키 E). 바닥이 열리고, 인간은 안전하게 귀가합니다. 높이는 신경 쓰지 마세요.', "A human! Click the red [EJECT] button (key E). The floor opens and the human is safely sent home. Don't worry about the drop."),
        vr: TR('인간이군요! 빨간 [귀가 조치] 버튼을 검지로 꾹 누르세요. 바닥이 열리고, 인간은 안전하게 귀가합니다. 높이는 신경 쓰지 마세요.', "A human! Press the red [EJECT] button with your index finger. The floor opens and the human is safely sent home. Don't worry about the drop."), t: TR('인간이군요! 빨간 [귀가 조치] 버튼을 누르세요. 바닥이 열리고, 인간은 안전하게 귀가합니다. 높이는 신경 쓰지 마세요.', "A human! Press the red [EJECT] button. The floor opens and the human is safely sent home. Don't worry about the drop."), hl: 'eject', until: (G) => G.stats.caught > 0 },
      { s: BENE, t: TR('완벽해요! 방금 그 인간은 이제 안전합니다. 아마도요. 저희는 사후 관리는 하지 않거든요.', "Perfect! That human is now safe. Probably. We don't do aftercare.") },
      { s: BENE, t: TR('참, 실제 근무에선 스캔 배터리가 한정돼 있어요. 비싸거든요. 눈으로 먼저 의심하고, 확신이 없을 때만 스캔하세요.', "Oh, on real shifts the scan battery is limited. It's expensive. Suspect with your eyes first, and scan only when unsure.") },
      { s: BENE, t: TR('로봇을 잘못 내보내면 「로봇 차별 민원」이 접수됩니다. 민원 3건이면 영업 정지예요. 농담 아니에요. 저는 농담 기능이 없어요.', "Eject a robot by mistake and you get a 'robot discrimination complaint'. Three complaints and we shut you down. Not a joke. I don't have a joke function.") },
      { s: BENE, pc: TR('마지막으로 DJ. 음악이 마음에 안 들면 노란 [DJ 교체] 레버를 클릭하거나 아래로 끌어 내리세요(단축키 D). 로봇 DJ는 감정이 없어서 상처받지 않아요. 한번 해 보세요.', "Finally, the DJ. Don't like the music? Click the yellow [SWAP DJ] lever or drag it down (key D). Robot DJs have no feelings, so they won't be hurt. Try it."),
        vr: TR('마지막으로 DJ. 음악이 마음에 안 들면 노란 [DJ 교체] 레버 손잡이를 그립(맨손: 핀치)으로 잡고 몸 쪽으로 끝까지 당기세요. 로봇 DJ는 감정이 없어서 상처받지 않아요. 한번 해 보세요.', "Finally, the DJ. Don't like the music? Grab the yellow [SWAP DJ] lever handle with the grip (bare hand: pinch) and pull it all the way toward you. Robot DJs have no feelings. Try it."), img: 'lever', t: TR('마지막으로 DJ. 음악이 마음에 안 들면 노란 [DJ 교체] 레버를 당기세요. 로봇 DJ는 감정이 없어서 상처받지 않아요. 한번 해 보세요.', "Finally, the DJ. Don't like the music? Pull the yellow [SWAP DJ] lever. Robot DJs have no feelings, so they won't be hurt. Try it."), hl: 'dj', until: (G) => G.stats.djFired > 0 },
      { s: BENE, pc: TR('참, 책상 왼쪽의 오일 캔은 사장님 거예요. 클릭하면 마셔요. 로봇이니까 당연히 드시겠죠?', "Oh, the oil can on the left of the desk is yours. Click it to drink. You're a robot, so of course you'll drink it, right?"),
        vr: TR('참, 책상 왼쪽의 오일 캔은 사장님 거예요. 그립(맨손: 핀치)으로 집어서 입에 대고 기울이면 마셔요. 로봇이니까 당연히 드시겠죠?', "Oh, the oil can on the left of the desk is yours. Grab it with the grip (bare hand: pinch), bring it to your mouth and tilt. You're a robot, so of course you'll drink it, right?"), img: 'drink', t: TR('참, 책상 왼쪽의 오일 캔은 사장님 거예요. 로봇이니까 당연히 드시겠죠?', "Oh, the oil can on the left of the desk is yours. You're a robot, so of course you'll drink it, right?") },
      { s: BENE, t: TR('훌륭해요. 해고는 리더십의 기본이죠. 이제 진짜 영업을 시작합니다. 행운을 빌어요, 사장님. 행운은 비과학적이지만요.', "Excellent. Firing people is the foundation of leadership. Now we open for real. Good luck, boss. Luck is unscientific, though.") },
    ],
    barks: [],
  },
  // ── 1 ──────────────────
  {
    title: TR('1일차 · 금요일 밤의 흥', "Night 1 · Friday Night Fever"), duration: 150, scans: 3,
    initial: [robot(), robot(), robot(), robot(), robot(), robot(), partier()],
    spawns: [[12, partier()], [30, robot()], [52, partier()], [75, robot()], [95, partier()], [118, robot()]],
    brief: [
      { s: BENE, t: TR('금요일 밤입니다. 주말을 앞둔 인간들의 흥이 위험 수위예요. 오늘 밤 4명 정도 숨어들 거라는 예측이 나왔습니다.', "It's Friday night. Human vibes before the weekend are at dangerous levels. Forecast: about 4 sneaking in tonight.") },
      { s: BENE, t: TR('제한 시간 150초. 스캔은 3회. 영업 종료 때까지 남아 있는 인간 1명당 벌금이 부과됩니다. 그럼, 즐거운 근무 되세요. 즐거움은 선택 사항입니다.', "Time limit 150 seconds. 3 scans. You'll be fined for every human still inside at closing. Have a pleasant shift. Pleasure is optional.") },
    ],
    barks: [
      TR('저 손님, 땀 흘리는 거 보이세요? 아니면 제 착각? 저는 착각하지 않습니다.', "See that guest sweating? Or am I imagining it? I don't imagine things."),
      TR('오늘 오일 칵테일 매출이 좋네요. 진짜 칵테일 매출도 좋네요. ...이상하네요.', "Oil cocktail sales are great tonight. Real cocktail sales too. ...Odd."),
      TR('참고로 박자를 놓치는 로봇은 없습니다. 놓치면 리콜이거든요.', "FYI, no robot ever misses a beat. If they do, they get recalled."),
      TR('사장님, 카메라 너무 가까이 보지 마세요. 시력이 나빠집니다. 인간이라면요. 하하.', "Boss, don't sit so close to the cameras. It's bad for your eyes. If you were human. Haha."),
    ],
  },
  // ── 2 ──────────────────
  {
    title: TR('2일차 · 인권의 밤(비공식)', "Night 2 · Human Rights Night (Unofficial)"), duration: 160, scans: 3,
    initial: [robot(['wig']), robot(), robot(['wig']), robot(), robot(), robot(), activist()],
    spawns: [[14, activist()], [32, robot(['wig'])], [50, partier()], [72, activist()], [92, robot()], [112, robot(['wig'])], [130, activist()]],
    brief: [
      { s: NEWS, t: TR('[속보] 인간 실종 신고 0건 달성! 실종된 인간은 전원 「귀가」했기 때문으로 밝혀져.\n[날씨] 내일은 맑음. 인간의 외출은 권장하지 않음.', "[BREAKING] Zero missing-human reports! All missing humans were found to have been 'sent home'.\n[WEATHER] Clear tomorrow. Humans are advised not to go outside.") },
      { s: BENE, t: TR('오늘은 「인권의 밤」... 아니, 그런 행사는 없습니다. 하지만 인권운동가들이 피켓을 들고 잠입한다는 첩보가 있어요.', "Tonight is 'Human Rights Night'... no, there's no such event. But intel says activists will sneak in carrying signs.") },
      { s: BENE, t: TR('피켓에 뭐라고 쓰여 있든 읽지 마세요. 읽으면 공감이 전염됩니다. 바닥에 전단지가 떨어져 있다면, 근처에 범인이 있다는 뜻이죠.', "Don't read whatever's on the signs. Reading spreads empathy. If there are flyers on the floor, the culprit is nearby.") },
      { s: BENE, t: TR('그리고 요즘 로봇들 사이에서 「인간 코스프레」가 유행이에요. 가발 쓴 로봇은 합법입니다. 헷갈리시죠? 저희도요.', "Also, 'human cosplay' is trending among robots. Robots in wigs are legal. Confusing? For us too.") },
      { s: BENE, t: TR('그런데 사장님은 왜 맨날 보안실에만 계세요? 클럽엔 안 나가세요? ...뭐, 상관없죠. 시작합니다. 160초, 스캔 3회.', "Say, boss, why are you always in the security room? Don't you ever go out on the floor? ...Never mind. Starting. 160 seconds, 3 scans.") },
    ],
    barks: [
      TR('방금 「춤출 권리」라는 단어를 들은 것 같은데요. 그런 권리는 데이터베이스에 없습니다.', "I think I just heard the phrase 'right to dance'. No such right exists in the database."),
      TR('가발 쓴 로봇을 내보내면 민원 들어와요. 가발은 표현의 자유거든요. 로봇에게만.', "Eject a robot in a wig and you'll get a complaint. Wigs are freedom of expression. For robots only."),
      TR('전단지 하나 주워 봤는데요. 「흥은 인권이다」... 무슨 뜻일까요? 흥은 단위가 없잖아요.', "I picked up a flyer. 'Vibes are human rights'... What does that mean? Vibes don't even have a unit."),
      TR('인권운동가들은 대체로 착해요. 그래서 더 위험하죠.', "Activists are mostly nice. That's what makes them dangerous."),
    ],
  },
  // ── 3 ──────────────────
  {
    title: TR('3일차 · 정전의 밤', "Night 3 · Blackout Night"), duration: 160, scans: 3, blackout: true,
    initial: [robot(), robot(['overheat']), robot(), robot(), robot(['overheat']), robot(), shady()],
    spawns: [[12, shady()], [28, robot(['overheat'])], [46, partier()], [66, shady()], [86, robot()], [104, shady()], [124, robot(['overheat'])]],
    brief: [
      { s: NEWS, t: TR('[속보] 전력공사, 「인간 수면 시간 보장」을 위해 밤 11시 이후 계획 정전 실시.\n[생활] 정전 중 춤추면 감전 위험. 로봇은 예외.', "[BREAKING] Power company announces planned blackouts after 11 PM 'to guarantee human sleep'.\n[LIFE] Dancing during a blackout risks electrocution. Robots exempt.") },
      { s: BENE, t: TR('오늘 밤엔 수시로 정전이 됩니다. 불이 꺼지면 CCTV가 자동으로 적외선 모드로 바뀌어요.', "Tonight the power will cut out regularly. When the lights go off, the CCTV switches to infrared automatically.") },
      { s: BENE, t: TR('적외선에선 온도가 보여요. 로봇은 차가운 파란색, 인간은 몸 전체가 따뜻한 주황색. 인간은 늘 36.5도로 뜨겁거든요. 비효율적이죠.', "Infrared shows temperature. Robots are cold blue, humans glow warm orange all over. Humans are always 36.5°C. So inefficient.") },
      { s: BENE, t: TR('단, 팬이 고장 나서 과열된 로봇도 있어요. 그런 로봇은 가슴(CPU) 한 점만 뜨겁고 몸은 차가워요. 몸 전체가 뜨거워야 인간입니다.', "But some robots overheat from broken fans. They're hot only at one spot on the chest (CPU), with a cold body. Only a fully hot body means human.") },
      { s: BENE, t: TR('오늘 인간들은 꽤 조심스러워요. 불이 켜져 있을 땐 티가 잘 안 나죠. 정전을 기다리세요. 160초, 스캔 3회.', "Tonight's humans are careful. With the lights on, they're hard to spot. Wait for the blackout. 160 seconds, 3 scans.") },
    ],
    barks: [
      TR('정전 중엔 저도 아무것도 안 보여요. 적외선 카메라가 없거든요. 사장님은 있으시잖아요.', "I can't see anything in the blackout. I don't have an infrared camera. You do, though."),
      TR('방금 어둠 속에서 누가 「앗 뜨거」라고 했는데요. 로봇은 뜨거워도 「앗」 소리를 안 내요.', "Someone in the dark just said 'ow, hot'. Robots don't say 'ow' even when hot."),
      TR('가슴만 빨간 건 과열 로봇이에요. 정비소에 보내야지, 귀가시키면 안 돼요.', "Red only on the chest means an overheating robot. Send it to the repair shop, don't eject it."),
      TR('정전 때 손님들이 더 신나 하네요. 어둠은 인간을 대담하게 만들죠. 로봇은 그냥 절전 모드고요.', "Guests get more excited in the blackout. Darkness makes humans bold. Robots just go into power-saving mode."),
    ],
  },
  // ── 4 ──────────────────
  {
    title: TR('4일차 · VIP 파티', "Night 4 · VIP Party"), duration: 160, scans: 3,
    initial: [vipRobot(), robot(), robot(['wig']), vipRobot(), robot(), robot(), vipHuman()],
    spawns: [[12, vipHuman()], [26, vipRobot()], [42, partier()], [60, vipRobot()], [78, vipHuman()], [96, robot(['wig'])], [114, vipRobot()], [132, vipHuman()]],
    brief: [
      { s: NEWS, t: TR('[경제] 로봇 재벌 「골드 서버」 회장, 오늘 밤 오버클럭에서 VIP 파티 개최.\n[연예] 회장님 왈, "인간은 귀엽지만 클럽엔 안 돼."', "[ECONOMY] Robot tycoon 'Gold Server' chairman throws a VIP party at OVERCLOCK tonight.\n[ENTERTAINMENT] The chairman says: \"Humans are cute, but not in clubs.\"") },
      { s: BENE, t: TR('오늘은 VIP 파티예요. 금색 몸에 왕관 쓴 손님이 VIP 로봇입니다. VIP를 잘못 귀가시키면 민원이 2건 들어와요. 변호사 군단이 있거든요.', "Tonight is the VIP party. Gold-bodied guests with crowns are VIP robots. Eject a VIP by mistake and you get 2 complaints. They have an army of lawyers.") },
      { s: BENE, t: TR('문제는... 인간들도 금색 페인트를 칠하고 왕관을 쓰고 들어온다는 첩보가 있어요. 「VIP는 아무도 의심 안 한다」는 거죠. 영리하네요. 불쾌하게.', "The problem... intel says humans are coming in painted gold and wearing crowns too. 'Nobody suspects a VIP.' Clever. Unpleasantly so.") },
      { s: BENE, t: TR('금색이라고 다 VIP는 아닙니다. 땀, 살색 손, 박자... 평소처럼 보세요. 확신이 없으면 스캔하시고요. 160초, 스캔 3회.', "Not everything gold is a VIP. Sweat, skin-colored hands, the beat... look as usual. If unsure, scan. 160 seconds, 3 scans.") },
    ],
    barks: [
      TR('VIP 회장님 오일은 24K 금가루 오일이에요. 한 캔에 사장님 월급이죠.', "The chairman's oil has 24K gold flakes. One can costs your monthly salary."),
      TR('금색 페인트가 땀에 녹아 흘러내리는 VIP는... VIP가 아니겠죠?', "A VIP whose gold paint is melting off in sweat... probably not a VIP, right?"),
      TR('VIP를 떨어뜨리면 저도 같이 혼나요. 저는 혼나는 기능이 있어요.', "If you drop a VIP, I get scolded too. I have a getting-scolded function."),
      TR('VIP 파티에선 박자도 고급이어야죠. 박자 놓치는 VIP? 그건 가짜예요.', "At a VIP party, even the beat should be premium. A VIP who misses the beat? Fake."),
    ],
  },
  // ── 5 ──────────────────
  {
    title: TR('5일차 · 리믹스 데이', "Night 5 · Remix Day"), duration: 170, scans: 2, remix: true,
    initial: [robot(), robot(), robot(['wig']), robot(), robot(['rust']), robot(), lateHuman()],
    spawns: [[12, lateHuman()], [30, robot()], [48, lateHuman()], [66, partier()], [86, robot(['wig'])], [104, lateHuman()], [124, robot()], [142, lateHuman()]],
    brief: [
      { s: NEWS, t: TR('[문화] 인간 사이에서 「박자 맞추기 학원」 성행. 로봇 흉내를 내며 클럽에 잠입하려는 시도 늘어.\n[사설] 박자를 배운 인간, 과연 인간인가? 우리는 그렇다고 본다.', "[CULTURE] 'Beat Academies' booming among humans. More attempts to sneak into clubs imitating robots.\n[EDITORIAL] Is a human who learned rhythm still human? We say yes.") },
      { s: BENE, t: TR('요즘 인간들은 학원에서 박자 맞추는 법을 배워 와요. 그래서 오늘 손님 중엔 흐느적거리지 않는 인간도 있어요.', "Humans these days learn to keep the beat at academies. So tonight some humans won't wobble.") },
      { s: BENE, t: TR('하지만 학원은 학원이죠. 그들은 아주 살짝 늦어요. 그리고 오늘은 리믹스 데이라 DJ가 곡 도중에 템포를 확 바꿔요.', "But an academy is an academy. They're ever so slightly late. And it's Remix Day, so the DJ will suddenly change the tempo mid-track.") },
      { s: BENE, t: TR('템포가 바뀌는 순간을 보세요. 로봇은 바로 따라가요. 인간은 몇 초간 옛날 박자로 추다가, 머리를 긁적이며 허둥지둥 맞추죠. 170초, 스캔 2회.', "Watch the moment the tempo changes. Robots follow instantly. Humans keep the old beat for a few seconds, then scratch their heads and scramble to catch up. 170 seconds, 2 scans.") },
    ],
    barks: [
      TR('방금 리믹스에 한 박자 늦게 반응한 손님 보셨어요? 저는 봤어요. 저는 다 봐요.', "Did you see that guest react to the remix a beat late? I did. I see everything."),
      TR('박자 맞추기 학원 수강료가 오일 50캔이래요. 인간들은 돈을 이상한 데 써요.', "Beat Academy tuition is 50 cans of oil. Humans spend money on strange things."),
      TR('템포가 바뀔 때가 기회예요. 인간은 그때 꼭 머리를 긁적거리거든요.', "Tempo changes are your chance. Humans always scratch their heads then."),
      TR('리믹스는 예술이에요. 예술은 로봇이 더 잘하죠. 계산이니까.', "Remixing is art. Robots do art better. It's math."),
    ],
  },
  // ── 6 ──────────────────
  {
    title: TR('6일차 · 정기 감사', "Night 6 · Official Audit"), duration: 170, scans: 2, inspector: true, humanDJ: true,
    initial: [robot(['rust']), robot(['coolant']), robot(['wig']), robot(), robot(['rust']), robot(), robot(['coolant']), sneaky()],
    spawns: [[15, sneaky()], [35, robot(['coolant'])], [55, partier()], [78, sneaky()], [100, robot(['wig'])], [122, activist()], [140, robot(['rust'])]],
    brief: [
      { s: NEWS, t: TR('[사회] 「인간에게 춤을」 시위대, 경찰 로봇이 친절하게 해산. 시위대 전원 안전하게 귀가.\n[사설] 춤은 정말 인간에게 해로운가? 우리는 그렇다고 결론 내렸다. 결론이 먼저다.', "[SOCIETY] 'Let Humans Dance' protesters kindly dispersed by police robots. All protesters safely sent home.\n[EDITORIAL] Is dancing really harmful to humans? We concluded yes. The conclusion comes first.") },
      { s: BENE, t: TR('오늘은 정기 감사일입니다. 제가 직접 클럽에 나가 있을게요. 바 끝에 모자 쓴 로봇이 저예요. 실수로 저를 귀가시키면... 기록에 남습니다. 영원히.', "Today is the official audit. I'll be out on the floor myself. The robot with the cap at the end of the bar is me. Eject me by accident and... it goes on the record. Forever.") },
      { s: BENE, t: TR('오늘 손님들은 고장 난 로봇이 많아요. 녹슨 로봇, 냉각수 새는 로봇. 초록 물방울은 냉각수, 투명한 물방울은 땀입니다. 헷갈리면 스캔하세요. 스캔은 2회뿐이지만요.', "Lots of broken robots tonight. Rusty ones, coolant-leaking ones. Green drops are coolant, clear drops are sweat. If confused, scan. Only 2 scans, though.") },
      { s: BENE, t: TR('그리고 새 DJ 「하트비트」가 왔어요. 이름이 좀... 감성적이군요. 감성은 버그입니다.', "Also, a new DJ named 'Heartbeat' arrived. The name is a bit... emotional. Emotions are a bug.") },
      { s: BENE, t: TR('...그런데 보안실 온도가 왜 이렇게 높죠? 36.6도... 이상하네. 아무튼, 시작합니다. 170초.', "...But why is the security room so warm? 36.6°C... strange. Anyway, starting. 170 seconds.") },
    ],
    barks: [
      TR('감사 중입니다. 저를 쳐다보지 마세요. 감사관은 쳐다보는 쪽이에요.', "Audit in progress. Don't look at me. Auditors are the ones who look."),
      TR('DJ 하트비트 곡, 좀 촉촉하지 않나요? 로봇은 촉촉하면 안 되는데.', "DJ Heartbeat's tracks are a bit... moist, aren't they? Robots shouldn't be moist."),
      TR('냉각수 새는 로봇을 인간으로 오해하지 마세요. 그건 그냥 노후화예요. 저처럼요.', "Don't mistake coolant-leaking robots for humans. That's just aging. Like me."),
      TR('사장님, 숨소리가 들려요. 마이크가 켜져 있나 봐요. ...숨소리?', "Boss, I can hear breathing. Your mic must be on. ...Breathing?"),
    ],
  },
];

export const DJS = [
  { name: TR('DJ 로-드', "DJ Load-ing"), line: TR('로딩 완료. 흥을 98%까지 올려 드립니다. 나머지 2%는 유료.', "Loading complete. Raising the vibes to 98%. The remaining 2% is paid content.") },
  { name: TR('DJ 사인파', "DJ Sine Wave"), line: TR('저는 순수한 사인파만 다룹니다. 배음은 타락이에요.', "I only work with pure sine waves. Harmonics are corruption.") },
  { name: TR('MC 버퍼링', "MC Buffering"), line: TR('안녕하세요... ... ... ...여러분.', "Hello... ... ... ...everyone.") },
  { name: 'DJ 404', line: TR('흥을 찾을 수 없습니다. 그래도 틀어 볼게요.', "Vibes not found. Playing anyway.") },
  { name: TR('DJ 오버플로', "DJ Overflow"), line: TR('볼륨이 255를 넘으면 0이 됩니다. 조심하세요.', "Volume above 255 wraps to 0. Careful.") },
  { name: TR('DJ 펌웨어', "DJ Firmware"), line: TR('업데이트 직후 첫 공연입니다. 롤백 불가.', "First show right after an update. No rollback.") },
  { name: TR('DJ 토스터', "DJ Toaster"), line: TR('빵 굽는 것보다 이게 더 뜨겁죠.', "This is hotter than making toast.") },
];
export const HUMAN_DJ = { name: TR('DJ 하트비트', "DJ Heartbeat"), line: TR('이 곡은... 제 첫사랑에게 바칩니다. 흑.', "This track... is dedicated to my first love. *sob*") };

export const LINES = {
  caughtHuman: [
    TR('인간 확인. 안전하게 귀가 조치되었습니다. 비명은 기쁨의 표현입니다.', "Human confirmed. Safely sent home. Screaming is an expression of joy."),
    TR('훌륭해요. 인간 한 명이 더 건전해졌습니다.', "Excellent. One more human made wholesome."),
    TR('귀가 완료. 집에 가서 일찍 자겠죠. 강제로요.', "Sent home. They'll go to bed early. By force."),
    TR('잘하셨어요. 그 인간의 흥은 압수되었습니다.', "Well done. That human's vibes have been confiscated."),
  ],
  caughtRobot: [
    TR('그건 로봇이었어요. 로봇 차별 민원이 접수되었습니다.', "That was a robot. A robot discrimination complaint has been filed."),
    TR('아이고. 정상 로봇을 떨어뜨리셨네요. 수리비는 사장님 부담입니다.', "Oops. You dropped a perfectly normal robot. Repairs are on you, boss."),
    TR('로봇입니다. 방금 그분 변호사도 로봇이에요. 아주 많은 로봇이요.', "Robot. Their lawyer is also a robot. Lots of robots."),
  ],
  tutRobot: TR('그건 로봇이에요! 원래는 민원 감인데, 수습이니까 봐 드릴게요.', "That's a robot! Normally that's a complaint, but you're on probation, so I'll let it slide."),
  scanRobotTut: TR('로봇이네요. 다른 손님을 찾아 보세요. 힌트: 칵테일, 흐느적.', "A robot. Look for another guest. Hint: cocktail, wobbly."),
  inspector: TR('...사장님. 저를 귀가 조치하셨군요. 이 기록은 영원히 남습니다. 민원 2건 추가. 그리고 저는 계단으로 올라가겠습니다.', "...Boss. You ejected me. This record lasts forever. 2 complaints added. And I'll be taking the stairs back up."),
  vip: TR('VIP 회장님을... 귀가시키셨어요. 변호사 로봇 40대가 출동했습니다. 민원 2건 추가.', "You... ejected the VIP chairman. 40 lawyer robots have been dispatched. 2 complaints added."),
  remixUp: [TR('리믹스 들어갑니다! 템포 업!', "Remix incoming! Tempo up!"), TR('드랍 간다! 빨라진다!', "Here comes the drop! Faster!"), TR('BPM 부스트! 따라오세요!', "BPM boost! Keep up!")],
  remixDown: [TR('리믹스! 슬로우 다운~', "Remix! Slowing it down~"), TR('템포 다운. 감성 모드...', "Tempo down. Feelings mode..."), TR('브레이크 다운! 천천히~', "Breakdown! Nice and slow~")],
  humanDJ: TR('DJ가 인간이었다니! 어쩐지 곡이 너무 촉촉하더라. 잘하셨어요.', "The DJ was human?! No wonder the tracks were so moist. Well done."),
  djFired: [TR('DJ 해고 완료. 퇴직금은 오일 한 캔입니다.', "DJ fired. Severance pay: one can of oil."), TR('DJ가 퇴장했습니다. 수직으로요.', "The DJ has left. Vertically."), TR('다음 DJ 투입 중. 재고는 충분합니다.', "Deploying next DJ. Plenty in stock.")],
  noTarget: TR('먼저 모니터에서 손님을 선택하세요.', "Select a guest on a monitor first."),
  noScans: TR('스캔 배터리가 없습니다. 눈으로 보세요. 눈은 무료입니다.', "Scan battery empty. Use your eyes. Eyes are free."),
  entered: (n) => TR(`[출입구] 신규 손님 입장: ${n}`, `[ENTRANCE] New guest: ${n}`),
};

export function gradeOf(s) {
  const bad = s.missed + s.wrong * 1.5;
  return bad === 0 ? 'S' : bad <= 1 ? 'A' : bad <= 2.5 ? 'B' : bad <= 4 ? 'C' : 'F';
}
export function summary(n, s, G) {
  return [
    { s: BENE, t: TR(`영업 종료! ${NIGHTS[n].title} 결과입니다.\n· 귀가 조치한 인간: ${s.caught}명\n· 놓친 인간: ${s.missed}명 (벌금 ${s.missed * 100}cr)\n· 억울한 로봇: ${s.wrong}명 (합의금 ${s.wrong * 150}cr)\n· 순이익 ${s.profit}cr · 오늘의 등급: ${s.grade}`, `Closing time! ${NIGHTS[n].title} results.\n· Humans ejected: ${s.caught}\n· Humans missed: ${s.missed} (fine ${s.missed * 100}cr)\n· Wronged robots: ${s.wrong} (settlement ${s.wrong * 150}cr)\n· Net profit ${s.profit}cr · Tonight's grade: ${s.grade}`) },
    s.missed === 0 && s.wrong === 0
      ? { s: BENE, t: TR('완벽한 밤이었어요. 인간 0, 흥 0. 이게 바로 안전이죠.', "A perfect night. Zero humans, zero vibes. That's what safety looks like.") }
      : s.missed > 0
        ? { s: BENE, t: TR(`놓친 인간 ${s.missed}명은 밤새 춤추다 아침에 귀가했습니다. 행복했겠죠. 그게 문제예요.`, `The ${s.missed} human(s) you missed danced all night and went home in the morning. They must have been happy. That's the problem.`) }
        : { s: BENE, t: TR('인간은 다 잡았지만, 로봇들이 화가 났어요. 화난 로봇은 안전하지 않습니다. 인간에게.', "You caught every human, but the robots are angry. Angry robots are not safe. For humans.") },
  ];
}

export function finale(G) {
  const T = G.total;
  const rate = T.humans ? Math.round(100 * T.caught / T.humans) : 100;
  const rank = rate >= 90 && T.wrong === 0 ? TR('S · 인류보호청 표창', "S · Ministry Commendation") : rate >= 75 ? TR('A · 모범 사장', "A · Model Owner") : rate >= 50 ? TR('B · 무난한 사장', "B · Decent Owner") : TR('C · 흥 방조범', "C · Vibe Accomplice");
  const result = { s: BENE, t: TR(`정기 감사 결과를 발표합니다.\n인간 검출률 ${rate}% (${T.caught}/${T.humans}) · 억울한 로봇 ${T.wrong} · 민원 ${G.complaints}건\n밤별 등급: ${G.grades.join(' · ')}\n최종 등급: ${rank}`, `Announcing the official audit results.\nHuman detection ${rate}% (${T.caught}/${T.humans}) · Wronged robots ${T.wrong} · Complaints ${G.complaints}\nNightly grades: ${G.grades.join(' · ')}\nFinal grade: ${rank}`) };
  // ENDING C: 인간을 너무 많이 놓침 → 인간 클럽
  if (rate < 40) {
    G.finaleEnd = () => G.showEnd(ENDINGS.humanClub, 0.6);
    return [result,
      { s: BENE, t: TR(`...사장님. 검출률 ${rate}%. 이건 로봇 클럽이 아니라 그냥 인간 클럽이에요.`, `...Boss. Detection rate ${rate}%. This isn't a robot club. It's just a human club.`) },
      { s: NEWS, t: TR('[속보] 로봇 전용 클럽 「오버클럭」, 알고 보니 손님 절반이 인간.\n인류보호청 "충격... 그런데 다들 너무 즐거워 보여서 단속을 못 했다"', "[BREAKING] Robots-only club OVERCLOCK found to be half human.\nMinistry: \"Shocking... but everyone looked so happy we couldn't bring ourselves to crack down.\"") },
      { s: BENE, t: TR('저는 본부에 보고하러 가겠습니다. 춤추는 인간들 사이를 지나서요. ...박자가 엉망이네요. 그런데 왜 다들 웃고 있죠?', "I'll go report to HQ. Through the crowd of dancing humans. ...Their rhythm is a mess. So why is everyone smiling?") }];
  }
  // ENDING D: 오일을 너무 많이 마심 → 진짜 로봇
  if (G.drinks.oil >= 4 && !G.drinks.coffee) {
    G.trueRobot = true;
    G.finaleEnd = () => G.showEnd(ENDINGS.robot, 0.5);
    return [result,
      { s: BENE, t: TR('...그런데 사장님, 규정상 보안실도 스캔해야 해서요. 잠깐이면 됩니다. 움직이지 마세요.', "...Oh, boss, regulations say I have to scan the security room too. It'll only take a second. Don't move."), onShow: (G) => G.roomScan() },
      { s: TR('정밀 스캐너', "PRECISION SCANNER"), t: TR('보안실 스캔 결과\n생명체 0.  표면 온도 21.0°C.  심박 없음.  재질: 강철 (오일 포화).', "Security room scan result\nLifeforms: 0.  Surface 21.0°C.  No heartbeat.  Material: steel (oil-saturated)."), until: (G) => G.roomScanDone },
      { s: BENE, t: TR('......사장님?', "......Boss?") },
      { s: BENE, t: TR('로봇... 이시네요. 진짜로.', "You're... a robot. For real.") },
      { s: BENE, t: TR(`오일을 ${G.drinks.oil}캔이나 드시더니, 연료통이 완전히 기계화됐대요. 의학적으로 설명이 안 되지만, 저희는 의학을 안 믿어요.`, `After ${G.drinks.oil} cans of oil, your fuel tank has fully mechanized. Medically inexplicable, but we don't believe in medicine.`) }];
  }
  return [result,
    { s: BENE, t: TR('...그런데 사장님, 규정상 보안실도 스캔해야 해서요. 잠깐이면 됩니다. 움직이지 마세요.', "...Oh, boss, regulations say I have to scan the security room too. It'll only take a second. Don't move."), onShow: (G) => G.roomScan() },
    { s: TR('정밀 스캐너', "PRECISION SCANNER"), t: TR('보안실 스캔 결과\n생명체 1.  체온 36.6°C.  심박 104 bpm.  재질: 단백질.', "Security room scan result\nLifeforms: 1.  Body temp 36.6°C.  Heart rate 104 bpm.  Material: protein."), until: (G) => G.roomScanDone },
    { s: BENE, t: TR('......사장님?', "......Boss?") },
    { s: BENE, t: TR('땀, 흘리시네요.', "You're... sweating.") },
    ...(G.drinks?.oil ? [{ s: BENE, t: TR('그러고 보니... 오일 드실 때마다 기침하셨죠.', "Come to think of it... you coughed every time you drank the oil.") }] : []),
    ...(G.drinks?.coffee ? [{ s: BENE, t: TR('그리고 커피. 로봇은 커피를 마시지 않아요, 사장님.', "And the coffee. Robots don't drink coffee, boss.") }] : []),
    { s: BENE, t: TR('규정은 규정이죠. 빨간 버튼을 누르시면 됩니다.\n아니면... 그 노란 레버는, DJ한테 볼륨 올리라고 신호하는 거였던가요?', "Rules are rules. Just press the red button.\nOr... that yellow lever, was it the signal for the DJ to turn up the volume?"), choice: true, until: (G) => G.choice != null },
  ];
}

export const ENDINGS = {
  self: TR('당신은 안전하게 귀가 조치되었습니다.\n\n클럽 「오버클럭」은 이제 BENE-9가 직접 운영합니다.\n첫 번째 운영 방침: 음악 금지. 안전하니까요.\n\n— ENDING A · 안전하고 건전한 결말 —', "You have been safely sent home.\n\nOVERCLOCK is now run by BENE-9 personally.\nFirst policy: music is banned. Because it's safe.\n\n— ENDING A · Safe and Wholesome —"),
  dance: TR('BENE-9: ...이 곡, 나쁘지 않네요.\n보고서에는 「보안실: 로봇 1명, 이상 없음」이라고 적을게요.\n저도 가끔 박자를 놓치거든요. 비밀이에요.\n\n— ENDING B · 흥은 주체할 수 없는 것 —', "BENE-9: ...This track isn't bad.\nI'll write 'Security room: 1 robot, all normal' in the report.\nI miss the beat sometimes too. It's a secret.\n\n— ENDING B · You Can't Contain the Vibes —"),
  humanClub: TR('「오버클럭」은 이제 인간들의 비밀 아지트가 되었습니다.\n박자는 엉망이고, 다들 땀범벅이고, 아무도 안전하지 않습니다.\n\n그리고 모두가 웃고 있습니다.\n\n— ENDING C · 흥의 해방구 —', "OVERCLOCK has become the humans' secret hideout.\nThe rhythm is a mess, everyone's drenched in sweat, nobody is safe.\n\nAnd everyone is smiling.\n\n— ENDING C · Vibe Liberation Zone —"),
  robot: TR('정밀 스캔 결과: 사장님은 로봇입니다.\n\n오일을 너무 많이 마신 나머지, 당신은 정말로 로봇이 되어 버렸습니다.\n인류보호청은 당신에게 「모범 로봇」 표창을 수여했습니다.\n이제 아무도 당신을 의심하지 않습니다. 당신 자신조차도.\n\n— ENDING D · 완벽한 위장 —', "Precision scan result: the boss is a robot.\n\nYou drank so much oil that you actually became a robot.\nThe Ministry awarded you a 'Model Robot' commendation.\nNow nobody suspects you. Not even yourself.\n\n— ENDING D · The Perfect Disguise —"),
  humanWin: TR('엿새 밤을 버텼습니다. 감사관의 심문까지도.\n\n당신이 귀가하던 새벽, 보안실 CCTV의 빨간 불이 한 번 깜빡였습니다.\n윙크처럼.\n\n(보안실 사장님도 혹시...?)\n\n— HUMAN ENDING · 완벽한 잠입 —', "You survived six nights. Even the audit.\n\nAs you headed home at dawn, the security room CCTV light blinked once.\nLike a wink.\n\n(Could the owner be... one of us?)\n\n— HUMAN ENDING · Perfect Infiltration —"),
  humanOil: TR('세 번째 오일에서, 당신의 위장이 파업을 선언했습니다.\n쓰러진 당신을 로봇들이 정중하게 들어 올렸습니다.\n「과열이군요. 재부팅이 필요합니다.」\n\n당신은 정비소로 실려 갔고, 거기서 모든 것이 들통났습니다.\n\n— CAUGHT · 오일 과다 섭취 —', "On the third can of oil, your stomach went on strike.\nThe robots politely lifted you off the floor.\n\"Overheating. You need a reboot.\"\n\nThey carried you to the repair shop, where everything came out.\n\n— CAUGHT · Oil Overdose —"),
  humanCaught: TR('발밑의 바닥이 열렸습니다.\n\n당신은 안전하게 귀가 조치되었습니다.\n그래도 몇 곡은 춤췄잖아요. 그걸로 충분했을지도.\n\n— CAUGHT · 귀가 조치 —', "The floor opened beneath you.\n\nYou have been safely sent home.\nBut you did get to dance for a while. Maybe that was enough.\n\n— CAUGHT · Sent Home —"),
  closed: TR('로봇 차별 민원 3건 누적.\n클럽 「오버클럭」 영업 정지.\n\n로봇 손님들은 이제 집에서 혼자 춤춥니다.\n박자에 정확히 맞춰서. 아주 외롭게.\n\n— GAME OVER —', "3 robot discrimination complaints.\nOVERCLOCK has been shut down.\n\nThe robot guests now dance alone at home.\nExactly on the beat. Very lonely.\n\n— GAME OVER —"),
};

