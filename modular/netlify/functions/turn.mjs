// 대결 모드용 TURN 중계 서버 정보를 내려 주는 Netlify 함수
// 아이디/비번은 코드에 없고, Netlify 사이트 설정의 환경 변수에서 읽음:
//   TURN_USER = Metered credential의 username
//   TURN_PASS = Metered credential의 password
// 게임(index.html)은 /.netlify/functions/turn 을 불러서 이 목록을 받음
export default async () => {
  const username = process.env.TURN_USER, credential = process.env.TURN_PASS;
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (!username || !credential) return new Response(JSON.stringify({ iceServers: [] }), { headers }); // 설정 전: STUN만
  const host = 'global.relay.metered.ca';
  const iceServers = [
    `turn:${host}:80`,
    `turn:${host}:80?transport=tcp`,
    `turn:${host}:443`,
    `turns:${host}:443?transport=tcp`, // 방화벽이 빡센 곳: 443 TLS
  ].map((urls) => ({ urls, username, credential }));
  return new Response(JSON.stringify({ iceServers }), { headers });
};
