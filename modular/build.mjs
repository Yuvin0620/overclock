// 빌드: src/*.js (모듈) → dist/game.js (한 파일) + dist/models.js (3D 모델 사본)
// 이렇게 하면 index.html 을 더블클릭(file://)으로 열어도 그대로 실행됩니다.
//   npm run build     한 번 빌드
//   npm run watch     저장할 때마다 자동 빌드
import fs from 'fs';
import * as esbuild from 'esbuild';

// 3D 모델(.glb)을 base64로 바꿔서 file:// 에서도 읽히게 함 (서버로 열 땐 파일을 직접 읽음)
fs.mkdirSync('dist', { recursive: true });
const b64 = (p) => fs.readFileSync(p).toString('base64');
fs.writeFileSync('dist/models.js',
  `window.OIL_GLB_B64 = "${b64('3D/Assets/oil1.glb')}";\nwindow.BOX_GLB_B64 = "${b64('3D/Assets/box.glb')}";\n`);

const opts = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  outfile: 'dist/game.js',
  external: ['https://*'], // PeerJS 는 대결 모드에서 CDN으로 불러옴
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
};
if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log('watching src/ ...');
} else {
  await esbuild.build(opts);
}
