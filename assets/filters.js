/**
 * 逐字条件：单个汉字的筛选
 */
import { store } from './data.js';
import { BAD_CHARS } from './homophone.js';

/** 一个字位（第 1 字 / 第 2 字）的默认条件 */
export function defaultPos(exclude = '') {
  return {
    strokeMin: 1,
    strokeMax: 30,
    useKangxi: false,     // 笔画按康熙笔画算
    tones: [],            // 声调（1-4 + 5 轻声），空 = 不限
    structs: [],          // 结构
    radicals: [],         // 部首
    wuxing: [],           // 五行
    initials: [],         // 声母（'' 表示零声母）
    finals: [],           // 韵母
    finalText: '',        // 韵母包含
    levels: [1, 2],       // 字库级别
    meaning: '',          // 释义关键词（空格分隔，任一命中）
    genderMode: 'any',    // any | f | m
    genderMin: 0.5,       // 性别倾向阈值
    minNameFreq: 1,       // 名字用字的最少出现次数（1 = 只用人名语料里出现过的字）
    polyMatch: true,      // 多音字按「任一读音命中」（关闭则只看主读音）
    excludeBad: true,     // 排除不吉字
    maxHotRank: 0,        // 排除人名用字热度前 N 名（0 = 不限）
    exclude,              // 手动排除的字
    pick: [],             // 手动指定的字（白名单，非空时只从这些字里选）
  };
}

/**
 * 释义关键词命中判断。
 * 中文没有词边界，直接 includes 会让「神志不清」命中「清」、「无用」命中「用」，
 * 因此命中后要看前一个字是不是否定词。
 */
const NEG = '不无未非莫勿别没失难';
export function meaningHit(text, kw) {
  if (!text || !kw) return false;
  let from = 0;
  for (;;) {
    const i = text.indexOf(kw, from);
    if (i < 0) return false;
    const prev = i > 0 ? text[i - 1] : '';
    const prev2 = i > 1 ? text[i - 2] : '';
    // 前一个字或前两个字里出现否定词 → 这次命中不算
    if (!NEG.includes(prev) && !(NEG.includes(prev2) && /[一二三四五六七八九十]/.test(prev))) return true;
    from = i + kw.length;
  }
}

const plain = (p) => (p || '').replace(/[āáǎàōóǒòēéěèīíǐìūúǔùǖǘǚǜ]/g, m =>
  ({ ā: 'a', á: 'a', ǎ: 'a', à: 'a', ō: 'o', ó: 'o', ǒ: 'o', ò: 'o', ē: 'e', é: 'e', ě: 'e', è: 'e', ī: 'i', í: 'i', ǐ: 'i', ì: 'i', ū: 'u', ú: 'u', ǔ: 'u', ù: 'u', ǖ: 'v', ǘ: 'v', ǚ: 'v', ǜ: 'v' }[m] || m));

export const plainPinyin = plain;

/** 一个字的全部读音（主读音 + 多音字读音），统一成 {p, t, i, f} */
export function allReadings(c, poly = true) {
  if (!c) return [];
  const out = [{ p: c.p, t: c.t, i: c.i, f: c.f }];
  if (!poly) return out;
  if (c.ps && c.ps.length) {
    for (const p of c.ps) {
      if (p === c.p) continue;
      out.push({ p, t: 0, i: '', f: '' });
    }
  }
  return out;
}

/** 判断一个字是否满足某个字位的条件 */
export function matchChar(c, f) {
  if (f.pick && f.pick.length) {
    if (!f.pick.includes(c.c)) return false;
  }
  if (f.levels && f.levels.length && !f.levels.includes(c.lv)) return false;
  const strokes = f.useKangxi ? c.kx : c.s;
  if (strokes < f.strokeMin || strokes > f.strokeMax) return false;
  if (f.exclude && f.exclude.includes(c.c)) return false;
  if (f.excludeBad && BAD_CHARS.has(c.c)) return false;
  if (f.maxHotRank > 0 && c.hf > 0 && c.hr < f.maxHotRank) return false;
  if (f.minNameFreq > 0 && c.hf < f.minNameFreq) return false;
  if (f.structs.length && !f.structs.includes(c.st)) return false;
  if (f.radicals.length && !f.radicals.includes(c.r)) return false;
  if (f.wuxing.length && !f.wuxing.includes(c.w)) return false;
  if (f.meaning) {
    const kws = f.meaning.split(/[\s,，、]+/).filter(Boolean);
    if (kws.length && !kws.some(k => meaningHit(c.m, k))) return false;
  }
  if (f.genderMode === 'f') {
    if (!(c.hf > 0) || c.g > -f.genderMin) return false;
  } else if (f.genderMode === 'm') {
    if (!(c.hf > 0) || c.g < f.genderMin) return false;
  }
  // 声调 / 声母 / 韵母：多音字按「任一读音命中」处理
  const needTone = f.tones.length > 0;
  const needInitial = f.initials.length > 0;
  const needFinal = f.finals.length > 0;
  if (needTone || needInitial || needFinal) {
    const readings = allReadings(c, f.polyMatch !== false);
    let ok = false;
    for (const r of readings) {
      let t = r.t;
      if (!t) t = toneFromPinyin(r.p);
      let i = r.i || initialFromPinyin(r.p);
      let fin = r.f || finalFromPinyin(r.p, i);
      if (needTone && !f.tones.includes(t)) continue;
      if (needInitial && !f.initials.includes(i)) continue;
      if (needFinal && !f.finals.includes(fin)) continue;
      ok = true;
      break;
    }
    if (!ok) return false;
  }
  if (f.finalText) {
    const readings = allReadings(c, f.polyMatch !== false);
    if (!readings.some(r => (r.f || finalFromPinyin(r.p, r.i)).includes(f.finalText))) return false;
  }
  return true;
}

const TONE_MARK = { 1: ['ā', 'ō', 'ē', 'ī', 'ū', 'ǖ'], 2: ['á', 'ó', 'é', 'í', 'ú', 'ǘ'], 3: ['ǎ', 'ǒ', 'ě', 'ǐ', 'ǔ', 'ǚ'], 4: ['à', 'ò', 'è', 'ì', 'ù', 'ǜ'] };
export function toneFromPinyin(p) {
  if (!p) return 0;
  for (const [t, marks] of Object.entries(TONE_MARK)) {
    if (marks.some(m => p.includes(m))) return Number(t);
  }
  return 5; // 无声调符号 = 轻声
}

const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];
export function initialFromPinyin(p) {
  const s = plain(p);
  for (const i of INITIALS) if (s.startsWith(i)) return i;
  return '';
}
export function finalFromPinyin(p, initial) {
  const s = plain(p);
  const ini = initial !== undefined ? initial : initialFromPinyin(p);
  const f = s.slice(ini.length);
  return f || s;
}

/** 依条件筛选整个字库 */
export function filterChars(f) {
  return store.chars.filter(c => matchChar(c, f));
}

/** 生成筛选项统计（供界面渲染 chip 及数量） */
export function facetsFor(pool) {
  const count = (key) => {
    const m = new Map();
    for (const c of pool) {
      const v = c[key];
      m.set(v, (m.get(v) || 0) + 1);
    }
    return m;
  };
  return {
    structs: [...count('st')].sort((a, b) => b[1] - a[1]),
    radicals: [...count('r')].sort((a, b) => b[1] - a[1]),
    wuxing: [...count('w')].sort((a, b) => b[1] - a[1]),
    initials: [...count('i')].sort((a, b) => b[1] - a[1]),
    finals: [...count('f')].sort((a, b) => b[1] - a[1]),
    levels: [...count('lv')].sort((a, b) => a[0] - b[0]),
  };
}
