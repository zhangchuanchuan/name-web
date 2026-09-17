/**
 * 五格剖象（民俗参考，非科学结论）
 *
 * 五格由「康熙笔画」推算：天格、人格、地格、外格、总格，
 * 再按 1–81 数理判断吉凶。本模块只提供参考值，界面中默认关闭。
 */

/** 1–81 数理的吉凶：2=吉，1=半吉，0=凶 */
const LUCK = [
  /* 1 */ 2, 0, 2, 0, 2, 2, 2, 2, 0, 0,
  /* 11 */ 2, 0, 2, 0, 2, 2, 2, 2, 0, 0,
  /* 21 */ 2, 0, 2, 2, 2, 1, 1, 0, 2, 1,
  /* 31 */ 2, 2, 2, 0, 2, 0, 2, 1, 2, 1,
  /* 41 */ 2, 0, 1, 0, 2, 0, 2, 2, 0, 1,
  /* 51 */ 1, 2, 1, 0, 1, 0, 2, 1, 0, 0,
  /* 61 */ 2, 0, 2, 0, 2, 0, 2, 2, 0, 0,
  /* 71 */ 1, 0, 2, 0, 1, 0, 1, 1, 0, 1,
  /* 81 */ 2,
];

export function luckOf(n) {
  if (n < 1) return 0;
  // 超过 81 的按「减 80」循环
  let x = n;
  while (x > 81) x -= 80;
  return LUCK[x - 1];
}

export function luckText(v) {
  return v === 2 ? '吉' : v === 1 ? '半吉' : '凶';
}

/**
 * 计算五格（传入康熙笔画数组：姓的每字笔画 + 名的每字笔画）
 * @param {number[]} surnameStrokes
 * @param {number[]} givenStrokes
 */
export function calcWuge(surnameStrokes, givenStrokes) {
  const s = surnameStrokes;
  const g = givenStrokes;
  if (!s.length || !g.length) return null;

  const tian = s.length === 1 ? s[0] + 1 : s[0] + s[1];
  const ren = s[s.length - 1] + g[0];
  const di = g.length === 1 ? g[0] + 1 : g[0] + g[1];
  const zong = s.reduce((a, b) => a + b, 0) + g.reduce((a, b) => a + b, 0);
  let wai;
  if (s.length === 1 && g.length === 1) wai = 2;
  else if (s.length === 1) wai = g[1] + 1;
  else if (g.length === 1) wai = s[0] + 1;
  else wai = s[0] + g[1];

  const grid = { 天格: tian, 人格: ren, 地格: di, 外格: wai, 总格: zong };
  const luck = {};
  let good = 0;
  let bad = 0;
  for (const [k, v] of Object.entries(grid)) {
    const l = luckOf(v);
    luck[k] = l;
    if (l === 2) good++;
    else if (l === 0) bad++;
  }
  // 以「人格、地格、总格」为核心（传统上三才以人格为主）
  const core = (luck.人格 === 2 ? 1 : 0) + (luck.地格 === 2 ? 1 : 0) + (luck.总格 === 2 ? 1 : 0);
  return { grid, luck, good, bad, core };
}

/** 三才（天格/人格/地格的五行） */
const NUM_WUXING = (n) => {
  const last = n % 10;
  if (last === 1 || last === 2) return '木';
  if (last === 3 || last === 4) return '火';
  if (last === 5 || last === 6) return '土';
  if (last === 7 || last === 8) return '金';
  return '水';
};
export function sancai(wuge) {
  if (!wuge) return '';
  return NUM_WUXING(wuge.grid.天格) + NUM_WUXING(wuge.grid.人格) + NUM_WUXING(wuge.grid.地格);
}
