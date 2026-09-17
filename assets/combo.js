/**
 * 排列组合引擎：把各字位的候选字组合成完整姓名，并施加整名规则
 */
import { checkName } from './homophone.js';
import { calcWuge, luckOf, sancai } from './wuge.js';
import { plainPinyin } from './filters.js';
import { WUXING_SHENG } from './data.js';

export const COMBO_DEFAULT = {
  noRepeatChar: true,        // 名内不重复用字
  noRepeatRadical: false,    // 偏旁部首不与姓/名重复
  radicalWithSurname: false, // 偏旁对比时把姓氏也算上
  noRepeatStruct: false,     // 结构不重复
  noRepeatWuxing: false,     // 五行不重复
  wuxingSheng: false,        // 名字内五行相生
  wuxingFromSurname: false,  // 与姓氏五行相生
  toneMode: 'none',          // none | no-adjacent-same | diff-all | pattern
  tonePattern: '',
  avoidBadWord: true,        // 排除不吉字与负面谐音
  avoidWord: false,          // 排除连读成常用词
  wugeMode: 'off',           // off | no-bad | core-good | min-good
  wugeMinGood: 3,
};

/**
 * @param {object} opt
 * @param {object} opt.surnameInfo 姓氏信息
 * @param {Array<Array>} opt.pools  每个字位的候选字数组
 * @param {number} opt.len         名字字数（1 或 2）
 * @param {object} opt.rules       整名规则
 * @param {number} opt.cap         结果上限
 */
export function generate({ surnameInfo, pools, len, rules, cap = 20000 }) {
  const list = [];
  let truncated = false;
  const surnamePlain = surnameInfo.pinyin.map(plainPinyin).join('');
  const surnameTones = surnameInfo.tones.filter(Boolean);

  const build = (given) => {
    const chars = given.map(g => g.c);
    const full = surnameInfo.surname + chars.join('');
    const tones = [...surnameTones, ...given.map(g => g.t)];
    const givenTones = given.map(g => g.t);
    const kxList = given.map(g => g.kx);
    const wuge = calcWuge(surnameInfo.kxList, kxList);
    const hn = checkName(surnameInfo.surname, given, surnamePlain);
    const hot = given.reduce((a, g) => a + g.hf, 0);
    const hotRank = given.reduce((a, g) => a + g.hr, 0);
    // 撞名风险主要由「名字里最热的那个字」决定，所以冷门/热门排序用它做主键
    const maxHf = given.reduce((a, g) => Math.max(a, g.hf), 0);
    return {
      full,
      givenChars: chars,
      given,
      surname: surnameInfo.surname,
      pinyin: [...surnameInfo.pinyin, ...given.map(g => g.p)].join(' '),
      tones,
      givenTones,
      strokes: surnameInfo.strokes + given.reduce((a, g) => a + g.s, 0),
      kxTotal: surnameInfo.kx + kxList.reduce((a, b) => a + b, 0),
      wuxing: given.map(g => g.w).join(''),
      hot,
      hotRank,
      maxHf,
      wuge,
      sancai: sancai(wuge),
      reasons: hn.reasons,
      notes: hn.notes,
    };
  };

  const passRules = (given) => {
    const chars = given.map(g => g.c);
    if (rules.noRepeatChar && new Set(chars).size !== chars.length) return false;
    if (len === 2) {
      const [a, b] = given;
      if (rules.noRepeatRadical && a.r && a.r === b.r) return false;
      if (rules.noRepeatStruct && a.st && a.st === b.st) return false;
      if (rules.noRepeatWuxing && a.w && a.w === b.w) return false;
      if (rules.wuxingSheng) {
        if (!a.w || !b.w || WUXING_SHENG[a.w] !== b.w) return false;
      }
    }
    if (rules.radicalWithSurname && surnameInfo.radicals.length) {
      const used = new Set(surnameInfo.radicals.filter(Boolean));
      for (const g of given) {
        if (g.r && used.has(g.r)) return false;
        used.add(g.r);
      }
    }
    if (rules.wuxingFromSurname && surnameInfo.wuxing.length) {
      const sw = surnameInfo.wuxing[surnameInfo.wuxing.length - 1];
      if (sw && given[0].w && WUXING_SHENG[sw] !== given[0].w) return false;
    }
    // 声调规则（与姓氏一起看）
    if (rules.toneMode !== 'none') {
      const t = [...surnameInfo.tones.filter(Boolean), ...given.map(g => g.t)];
      if (rules.toneMode === 'no-adjacent-same') {
        for (let i = 1; i < t.length; i++) if (t[i] === t[i - 1]) return false;
      } else if (rules.toneMode === 'diff-all') {
        if (new Set(t).size !== t.length) return false;
      } else if (rules.toneMode === 'pattern') {
        const digits = (rules.tonePattern || '').replace(/[^1-5]/g, '');
        if (digits) {
          const target = digits.length === t.length ? t : given.map(g => g.t);
          if (String(target.join('')) !== digits) return false;
        }
      }
    }
    // 谐音
    const hn = checkName(surnameInfo.surname, given, surnamePlain);
    if (rules.avoidBadWord && hn.bad) return false;
    if (rules.avoidWord && (hn.bad || hn.notes.some(n => n.includes('连读成词')))) return false;
    // 五格
    if (rules.wugeMode !== 'off') {
      const wuge = calcWuge(surnameInfo.kxList, given.map(g => g.kx));
      if (!wuge) return false;
      if (rules.wugeMode === 'no-bad' && wuge.bad > 0) return false;
      if (rules.wugeMode === 'core-good' && wuge.core < 3) return false;
      if (rules.wugeMode === 'min-good' && wuge.good < rules.wugeMinGood) return false;
    }
    return true;
  };

  if (len === 1) {
    for (const a of pools[0]) {
      const given = [a];
      if (!passRules(given)) continue;
      list.push(build(given));
      if (list.length >= cap) { truncated = true; break; }
    }
  } else {
    const [p1, p2] = pools;
    outer:
    for (const a of p1) {
      for (const b of p2) {
        const given = [a, b];
        if (!passRules(given)) continue;
        list.push(build(given));
        if (list.length >= cap) { truncated = true; break outer; }
      }
    }
  }
  return { list, truncated };
}

/** 估算组合总数（用于提前提示） */
export function estimateTotal(pools, len) {
  if (len === 1) return pools[0].length;
  return pools[0].length * pools[1].length;
}

/**
 * 推荐度：把「人名语料里的用字热度」分成几档。
 *   0 = 20 ~ 3000 次：真实有人用、但不是爆款，最舒服的区间
 *   1 = 超过 3000 次：偏热，撞名压力上升
 *   3 = 少于 20 次：过于生僻
 *   4 = 语料里从未出现：几乎可以断定不适合取名
 */
export function bandScore(c) {
  if (!c.hf) return 4;
  if (c.hf < 20) return 3;
  if (c.hf <= 3000) return 0;
  return Math.min(3, Math.log10(c.hf / 3000) * 2);
}

const IDEAL_LOG = Math.log10(900);
/** 名字总推荐度：档位为主，再让用字热度靠近「常见但不烂大街」 */
export function recommendScore(given) {
  let band = 0;
  let dist = 0;
  for (const c of given) {
    band += bandScore(c);
    dist += Math.abs(Math.log10(c.hf + 1) - IDEAL_LOG);
  }
  return band * 2 + dist;
}

/** 按排序键给候选字排队（生成前调用，避免结果上限截断偏向字表顺序） */
export function orderPools(pools, mode) {
  const cmp = {
    'hot-desc': (a, b) => b.hf - a.hf,
    'strokes-asc': (a, b) => a.s - b.s || a.hf - b.hf,
    'strokes-desc': (a, b) => b.s - a.s || a.hf - b.hf,
    pinyin: (a, b) => a.p.localeCompare(b.p, 'zh'),
    wuge: (a, b) => a.kx - b.kx || a.hf - b.hf,
    recommend: (a, b) => bandScore(a) - bandScore(b) || Math.abs(Math.log10(a.hf + 1) - IDEAL_LOG) - Math.abs(Math.log10(b.hf + 1) - IDEAL_LOG),
    'hot-asc': (a, b) => a.hf - b.hf,
  }[mode] || ((a, b) => bandScore(a) - bandScore(b) || a.hf - b.hf);
  return pools.map(p => [...p].sort(cmp));
}

export function sortResults(list, mode) {
  const arr = [...list];
  switch (mode) {
    case 'hot-desc': arr.sort((a, b) => b.maxHf - a.maxHf || b.hot - a.hot); break;
    case 'strokes-asc': arr.sort((a, b) => a.strokes - b.strokes || a.hotRank - b.hotRank); break;
    case 'strokes-desc': arr.sort((a, b) => b.strokes - a.strokes || a.hotRank - b.hotRank); break;
    case 'pinyin': arr.sort((a, b) => a.pinyin.localeCompare(b.pinyin, 'zh')); break;
    case 'wuge': arr.sort((a, b) => (b.wuge ? b.wuge.good * 2 - b.wuge.bad : 0) - (a.wuge ? a.wuge.good * 2 - a.wuge.bad : 0)); break;
    case 'hot-asc': arr.sort((a, b) => a.maxHf - b.maxHf || a.hot - b.hot); break;
    case 'recommend':
    default: {
      const cache = new Map();
      const score = (r) => {
        if (!cache.has(r)) cache.set(r, recommendScore(r.given));
        return cache.get(r);
      };
      arr.sort((a, b) => score(a) - score(b) || a.maxHf - b.maxHf);
      break;
    }
  }
  return arr;
}

export { luckOf };
