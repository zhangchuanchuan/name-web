/**
 * 字库访问与基础工具
 */

export const TONE_NAMES = {
  1: '阴平（一声）',
  2: '阳平（二声）',
  3: '上声（三声）',
  4: '去声（四声）',
  5: '轻声',
};
export const TONE_SHORT = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '轻' };
export const WUXING = ['金', '木', '水', '火', '土'];
export const WUXING_SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };

export const store = {
  chars: [],
  byChar: new Map(),
  surnames: [],
  meta: null,
  finals: [],   // [{v, n}]
  initials: [],
  loaded: false,
};

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 载入失败（HTTP ${res.status}）`);
  return res.json();
}

export async function loadData() {
  const [chars, surnames, meta] = await Promise.all([
    getJSON('data/chars.json'),
    getJSON('data/surnames.json'),
    getJSON('data/meta.json'),
  ]);
  store.chars = chars;
  store.surnames = surnames;
  store.meta = meta;
  store.byChar = new Map(chars.map(c => [c.c, c]));

  const fin = new Map();
  for (const c of chars) fin.set(c.f, (fin.get(c.f) || 0) + 1);
  store.finals = [...fin].map(([v, n]) => ({ v, n })).sort((a, b) => b.n - a.n);
  store.initials = Object.entries(meta.initials).map(([v, n]) => ({ v: v || '零声母', raw: v, n }));
  store.loaded = true;
  return store;
}

/** 姓氏信息（在字库里查该字的笔画/五行/部首，缺失时用姓氏表数据） */
export function surnameInfo(surname) {
  const chars = [...surname];
  let strokes = 0;
  let kx = 0;
  const wuxing = [];
  const radicals = [];
  const structs = [];
  const tones = [];
  const pinyin = [];
  const kxList = [];
  const strokeList = [];
  const missing = [];
  const row = store.surnames.find(s => s.n === surname);
  for (const ch of chars) {
    const c = store.byChar.get(ch);
    if (c) {
      strokes += c.s; kx += c.kx;
      kxList.push(c.kx); strokeList.push(c.s);
      wuxing.push(c.w); radicals.push(c.r); structs.push(c.st);
      tones.push(c.t); pinyin.push(c.p);
    } else {
      missing.push(ch);
      const guess = row ? Math.round(row.s / chars.length) : 0;
      strokes += guess; kx += guess;
      kxList.push(guess); strokeList.push(guess);
      wuxing.push(''); radicals.push(''); structs.push(''); tones.push(0);
      pinyin.push(row ? row.py.split(' ')[0] || '' : '');
    }
  }
  return {
    surname, chars, strokes, kx, wuxing, radicals, structs, tones, pinyin,
    kxList, strokeList, missing, known: missing.length === 0,
  };
}

/** 用字热度的文字描述 */
export function hotText(c) {
  if (!c.hf) return '人名语料未出现';
  return `语料出现 ${c.hf.toLocaleString()} 次 · 热度第 ${c.hr + 1} 名`;
}

export function genderText(g) {
  if (g >= 0.6) return '偏男性';
  if (g >= 0.25) return '略偏男性';
  if (g > -0.25) return '中性';
  if (g > -0.6) return '略偏女性';
  return '偏女性';
}
