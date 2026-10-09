// ── 언어 (ko / en) — 시작 화면 버튼 또는 L 키로 전환, 새로고침해서 적용 ──
export const LANG = (() => { try { const v = localStorage.getItem('overclock.lang'); if (v === 'ko' || v === 'en') return v; } catch {} return /^ko/i.test(navigator.language) ? 'ko' : 'en'; })();
export const TR = (ko, en) => (LANG === 'en' ? en : ko);
export function setLang(l) { try { localStorage.setItem('overclock.lang', l); } catch {} location.reload(); }
document.documentElement.lang = LANG;
