import * as espree from 'espree';
import * as escope from 'eslint-scope';

function analyze(code) {
  const ast = espree.parse(code, { ecmaVersion: 2022, sourceType: 'module', range: true });
  const sm = escope.analyze(ast, { ecmaVersion: 2022, sourceType: 'module' });
  const mod = sm.globalScope.childScopes[0];
  return { ast, through: mod.through };
}

export function freeIds(code) {
  return new Set(analyze(code).through.map((r) => r.identifier.name));
}

// names 에 든 이름의 "모듈 밖에서 온 참조"를 prefix.name 으로 바꾼 코드를 돌려줌
export function rewriteRefs(code, names, prefix) {
  const { ast, through } = analyze(code);
  const shorthand = new Set();
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Property' && n.shorthand) shorthand.add(n.value.range[0] + ':' + n.value.range[1]);
    for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); }
  })(ast);
  const edits = through.filter((r) => names.has(r.identifier.name)).map((r) => r.identifier.range);
  // 같은 위치 중복 제거, 뒤에서부터 치환
  const seen = new Set(); const list = [];
  for (const [a, b] of edits) { const key = a + ':' + b; if (!seen.has(key)) { seen.add(key); list.push([a, b]); } }
  list.sort((x, y) => y[0] - x[0]);
  let out = code;
  for (const [a, b] of list) {
    const name = out.slice(a, b);
    const rep = shorthand.has(a + ':' + b) ? `${name}: ${prefix}.${name}` : `${prefix}.${name}`;
    out = out.slice(0, a) + rep + out.slice(b);
  }
  return out;
}
