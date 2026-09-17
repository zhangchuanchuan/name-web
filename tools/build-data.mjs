/**
 * 构建字库数据：tools/build-data.mjs
 *
 * 数据来源
 *  1. 通用规范汉字表（一级 3500 / 二级 3000 / 三级 1605，共 8105 字） —— tools/sources/通用规范汉字表.txt
 *  2. 新华字典数据（拼音、笔画、部首、释义） —— pwxcoo/chinese-xinhua data/word.json（首次运行自动下载并缓存）
 *  3. 中文人名语料库 120 万条（性别标注） —— wainshine/Chinese-Names-Corpus（首次运行自动下载并缓存）
 *  4. 百家姓 1074 姓（含人口序） —— tools/sources/surnames.txt
 *  5. cnchar + cnchar-info + cnchar-radical —— 结构、五行、造字法、多音字、规范化笔画
 *
 * 产物
 *  data/chars.json      8105 个汉字的全部属性
 *  data/surnames.json   姓氏（含拼音、笔画、五行、人口序）
 *  data/meta.json       统计信息与筛选项（结构/部首/声调等分布）
 *
 * 运行：cd tools && npm install && node build-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const cacheDir = path.join(__dirname, '.cache');
const dataDir = path.join(root, 'data');
const srcDir = path.join(__dirname, 'sources');

for (const d of [cacheDir, dataDir]) fs.mkdirSync(d, { recursive: true });

/* ------------------------------------------------------------------ */
/* 远程数据下载（带缓存）                                              */
/* ------------------------------------------------------------------ */
const REMOTE = {
  'word.json':
    'https://raw.githubusercontent.com/pwxcoo/chinese-xinhua/master/data/word.json',
  'names_gender.txt':
    'https://raw.githubusercontent.com/wainshine/Chinese-Names-Corpus/master/Chinese_Names_Corpus/Chinese_Names_Corpus_Gender%EF%BC%88120W%EF%BC%89.txt',
};

async function ensureCached(name) {
  const file = path.join(cacheDir, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) {
    console.log(`  · 命中缓存 ${name}`);
    return file;
  }
  const url = REMOTE[name];
  console.log(`  · 下载 ${name} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  console.log(`  · 完成 ${name}（${(buf.length / 1048576).toFixed(1)} MB）`);
  return file;
}

/* ------------------------------------------------------------------ */
/* 拼音工具                                                            */
/* ------------------------------------------------------------------ */
const TONE_MAP = {
  ā: ['a', 1], á: ['a', 2], ǎ: ['a', 3], à: ['a', 4],
  ō: ['o', 1], ó: ['o', 2], ǒ: ['o', 3], ò: ['o', 4],
  ē: ['e', 1], é: ['e', 2], ě: ['e', 3], è: ['e', 4],
  ī: ['i', 1], í: ['i', 2], ǐ: ['i', 3], ì: ['i', 4],
  ū: ['u', 1], ú: ['u', 2], ǔ: ['u', 3], ù: ['u', 4],
  ǖ: ['ü', 1], ǘ: ['ü', 2], ǚ: ['ü', 3], ǜ: ['ü', 4],
  ń: ['n', 2], ň: ['n', 3], ǹ: ['n', 4], ḿ: ['m', 2],
};

const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l',
  'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];

/** 修正数据源里的 IPA 字符（新华字典用 ɡ U+0261 表示 g，会让声母判断失败） */
function normalizePinyin(raw) {
  return String(raw || '').replace(/\u0261/g, 'g').replace(/[\u0251]/g, 'a');
}

/** 把带声调的拼音拆成 { plain, tone, initial, final } */
function splitPinyin(raw) {
  if (!raw) return null;
  let s = normalizePinyin(raw).trim().replace(/[0-9]/g, '');
  let tone = 5; // 轻声
  let plain = '';
  for (const ch of s) {
    const hit = TONE_MAP[ch];
    if (hit) {
      plain += hit[0];
      tone = hit[1];
    } else {
      plain += ch.toLowerCase();
    }
  }
  plain = plain.replace(/[^a-zü]/g, '');
  if (!plain) return null;
  let initial = '';
  for (const ini of INITIALS) {
    if (plain.startsWith(ini)) { initial = ini; break; }
  }
  let final = plain.slice(initial.length);
  if (!final) final = plain; // 兜底
  return { plain, tone, initial, final, marked: s.toLowerCase() };
}

/* 五笔/康熙笔画：简体部首 → 康熙部首 的笔画差（用于五格剖象） */
const KANGXI_DELTA = {
  氵: 1, 忄: 1, 扌: 1, 艹: 3, 犭: 1, 王: 1, 月: 2, 礻: 1, 衤: 1,
  讠: 5, 钅: 3, 纟: 3, 饣: 6, 冫: 2, 辶: 4, 门: 5, 马: 7, 车: 3,
  见: 3, 贝: 3, 页: 3, 风: 5, 鸟: 6, 鱼: 3, 长: 4, 韦: 5, 齿: 7,
  龙: 11, 龟: 9, 齐: 8, 师: 4, 麦: 4, 卤: 4, 乔: 6, 尧: 6, 单: 4,
  乐: 10, 为: 8, 罒: 1, 耂: 2, 灬: 0, 刂: 0, 亻: 0, 彳: 0, 囗: 0,
  攵: 0, 卩: 0, 阝: 5, // 阝 左为阜(8)右为邑(7)，此处取通用 7 画的折中值 +5
};

/* cnchar 未收录结构的一级字（多为兵器/负面字，但「剑」等会用于取名），人工补齐 */
const STRUCT_FIX = {
  刀: '独体结构', 叉: '独体结构', 仇: '左右结构', 币: '上下结构', 死: '左右结构',
  杀: '上下结构', 枪: '左右结构', 刺: '左右结构', 毒: '上下结构', 钞: '左右结构',
  剑: '左右结构', 炸: '左右结构', 炮: '左右结构', 淫: '左右结构', 弹: '左右结构',
  棒: '左右结构', 棍: '左右结构', 硝: '左右结构', 赌: '左右结构', 箭: '上下结构',
  爆: '左右结构',
};

function kangxiStrokes(strokes, radical) {
  const delta = KANGXI_DELTA[radical] ?? 0;
  return strokes + delta;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */
console.log('① 准备数据源');
const wordFile = await ensureCached('word.json');
const corpusFile = await ensureCached('names_gender.txt');

console.log('② 解析通用规范汉字表');
const tableText = fs.readFileSync(path.join(srcDir, '通用规范汉字表.txt'), 'utf8');
const chars = [];
let level = 0;
for (const line of tableText.split(/\r?\n/)) {
  const t = line.trim();
  if (!t) continue;
  if (t.startsWith('#')) {
    if (t.includes('一級') || t.includes('一级')) level = 1;
    else if (t.includes('二級') || t.includes('二级')) level = 2;
    else if (t.includes('三級') || t.includes('三级')) level = 3;
    continue;
  }
  for (const ch of t) {
    if (/[\u4e00-\u9fff]/.test(ch)) chars.push({ c: ch, lv: level || 1 });
  }
}
console.log(`  · 共 ${chars.length} 字（一级 ${chars.filter(x => x.lv === 1).length}、二级 ${chars.filter(x => x.lv === 2).length}、三级 ${chars.filter(x => x.lv === 3).length}）`);

console.log('③ 解析新华字典（释义 / 笔画 / 拼音）');
const dict = JSON.parse(fs.readFileSync(wordFile, 'utf8'));
const dictMap = new Map();
for (const item of dict) {
  const w = String(item.word || '').trim();
  if (w.length !== 1) continue;
  if (!dictMap.has(w)) dictMap.set(w, item);
}

/**
 * 把《新华字典》的长释义压成一句可读的“字义”。
 * 原文形如：李〈名〉\n\n (形声。从木,子声。本义李树)\n\n 同本义。落叶乔木……
 */
function cleanMeaning(text, ch) {
  if (!text) return '';
  // 换行是新华字典的段落分界（释义 / 引证），先换成哨兵字符保留分界，再拆句
  let s = String(text).replace(/\r?\n+/g, '\u0001').replace(/[ \t\u3000]+/g, '').replace(/^./, '');
  s = s.replace(/^[〈【〔《][^〉】〕》]*[〉】〕》]/, '');  // 去掉 〈名〉 之类的词性标记
  s = s.replace(/[”“"]/g, '');
  // 释义里经常把字头再写一遍并接拼音（如「…破土的铁片铧鏵huá装在…」），
  // 只在「再次出现后紧跟拉丁字母」时截断，避免误伤「本义李树」这类正常表述。
  if (ch) {
    const again = s.indexOf(ch, 6);
    if (again > 6 && /[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]{1,4}/.test(s.slice(again + 1, again + 8))) {
      s = s.slice(0, again);
    }
  }
  const byiM = s.match(/本义[：:]?([^。；;，,、）)]{1,22})/);
  const byi = byiM ? byiM[1].replace(/^[）)]/, '').trim() : '';
  let core;
  const idx = s.indexOf('同本义');
  if (idx >= 0) {
    core = s.slice(idx + 3);
  } else {
    core = s.replace(/^[（(]?(?:形声|会意|象形|指事|会意兼形声)[^）)]*[）)]?/, '');
  }
  core = core.replace(/^[。；;，,、）)]+/, '');
  // 拆成短句后，优先取「释义句」而不是古文引证句（引证句含《》或 -- ）
  const cands = core.split(/[。；;\u0001]/)
    .map(x => x.replace(/^[（(）)]/, '').trim())
    .filter(x => x.length >= 2 && !x.includes('《') && !x.includes('--')
      && !/简化字|异体字|繁体字|俗字|本作|通作|亦作/.test(x));
  const first = cands.find(x => !/^(从|同|又|见|参见|如|另见|本义|形声|会意|象形|指事|引申)/.test(x)) || cands[0] || '';
  let out = [byi, first].filter(Boolean).join('；').replace(/[（()）]/g, '');
  if (!out) out = s.replace(/[（()）]/g, '').slice(0, 46);   // 兜底：至少给出一段原文
  if (out.length > 46) out = out.slice(0, 46) + '…';
  return out;
}

console.log('④ 统计 120 万人名语料（用字热度 / 性别倾向）');
const freq = new Map();
const male = new Map();
const female = new Map();
const raw = fs.readFileSync(corpusFile, 'utf8');
let counted = 0;
for (const line of raw.split(/\r?\n/)) {
  const idx = line.lastIndexOf(',');
  if (idx <= 0) continue;
  const name = line.slice(0, idx).trim();
  const sex = line.slice(idx + 1).trim();
  if (!/^[\u4e00-\u9fff]{1,3}$/.test(name)) continue;
  if (sex !== '男' && sex !== '女') continue;
  counted++;
  // 语料里的名字含姓氏，统计用字时把姓氏去掉（复姓极少，忽略）
  const given = name.length > 1 ? name.slice(1) : name;
  const seen = new Set();
  for (const ch of given) {
    freq.set(ch, (freq.get(ch) || 0) + 1);
    if (!seen.has(ch)) {
      seen.add(ch);
      if (sex === '男') male.set(ch, (male.get(ch) || 0) + 1);
      else female.set(ch, (female.get(ch) || 0) + 1);
    }
  }
}
console.log(`  · 统计 ${counted} 个人名，命中用字 ${freq.size} 个`);

console.log('⑤ 调用 cnchar 计算结构 / 五行 / 多音字');
const cnchar = require('cnchar');
cnchar.use(require('cnchar-info'));
cnchar.use(require('cnchar-radical'));
const warn = console.warn;
console.warn = () => {};

const allChars = chars.map(x => x.c);
const structArr = cnchar.radical(allChars);   // [{radical, struct, radicalCount}]
const infoArr = cnchar.info(allChars);        // [{method, fiveElement, markSpell}]

let missingSpell = 0;
let missingStrokes = 0;
const out = [];
const structCount = new Map();
const radicalCount = new Map();
const toneCount = new Map();
const wuxingCount = new Map();

chars.forEach((item, idx) => {
  const ch = item.c;
  const d = dictMap.get(ch);
  let spell = null;
  let fallbackPinyin = false;
  try {
    const raw = cnchar.spell(ch, 'tone', 'low');
    // cnchar 查不到时会把原字返回，这种情况要退回新华字典
    if (raw && raw !== ch) spell = splitPinyin(raw);
  } catch { /* ignore */ }
  if (!spell || !spell.plain) {
    spell = splitPinyin(d && d.pinyin);
    fallbackPinyin = true;
    if (!spell) { missingSpell++; return; }
  }
  let poly = null;
  try {
    const p = cnchar.spell(ch, 'poly', 'tone', 'low');
    const list = String(p).replace(/[()]/g, '').split('|')
      .map(x => splitPinyin(x)).filter(Boolean)
      .map(x => x.marked);
    if (list.length > 1) poly = [...new Set(list)];
  } catch { /* ignore */ }

  let strokes = 0;
  try { strokes = Number(cnchar.stroke(ch)) || 0; } catch { strokes = 0; }
  if (!strokes && d) strokes = Number(d.strokes) || 0;
  if (!strokes) { missingStrokes++; return; }   // 笔画缺失的字无法参与笔画筛选，直接不入库

  const rad = structArr[idx] || {};
  const info = infoArr[idx] || {};
  const radical = rad.radical || (d && d.radicals) || '';
  // cnchar 与新华字典都未收录结构的字（约 10%，几乎都是三级生僻字），标为「未收录」而不是留空，
  // 这样界面上的结构筛选与统计口径保持一致，也不会被误当成任何一种结构。
  const struct = rad.struct || STRUCT_FIX[ch] || '未收录';
  const fiveElement = info.fiveElement || '';

  const f = freq.get(ch) || 0;
  const m = male.get(ch) || 0;
  const fe = female.get(ch) || 0;
  const gender = (m + fe) > 0 ? Math.round(((m - fe) / (m + fe)) * 100) / 100 : 0;

  structCount.set(struct, (structCount.get(struct) || 0) + 1);
  radicalCount.set(radical, (radicalCount.get(radical) || 0) + 1);
  toneCount.set(spell.tone, (toneCount.get(spell.tone) || 0) + 1);
  wuxingCount.set(fiveElement, (wuxingCount.get(fiveElement) || 0) + 1);

  out.push({
    c: ch,
    p: spell.marked,
    ps: poly,
    t: spell.tone,
    i: spell.initial,
    f: spell.final,
    s: strokes,
    kx: kangxiStrokes(strokes, radical),
    r: radical,
    rc: rad.radicalCount || 0,
    st: struct,
    w: fiveElement,
    mth: info.method || '',
    lv: item.lv,
    m: cleanMeaning(d && d.explanation, ch),
    hf: f,
    g: gender,
  });
});
console.warn = warn;
if (missingSpell) console.log(`  · 跳过 ${missingSpell} 个无拼音的字`);
if (missingStrokes) console.log(`  · 跳过 ${missingStrokes} 个无笔画数据的字`);

/* 用字热度排名（0 = 最热） */
const sortedByFreq = [...out].sort((a, b) => b.hf - a.hf);
sortedByFreq.forEach((x, i) => { x.hr = i; });

console.log(`  · 生成 ${out.length} 条字记录`);

console.log('⑥ 生成姓氏数据');
const surnameText = fs.readFileSync(path.join(srcDir, 'surnames.txt'), 'utf8');
const surnames = [];
for (const line of surnameText.split(/\r?\n/)) {
  const name = line.trim();
  if (!name || !/^[\u4e00-\u9fff]{1,2}$/.test(name)) continue;
  let py = '';
  let strokes = 0;
  let wuxing = '';
  try { py = name.split('').map(c => cnchar.spell(c, 'tone', 'low')).join(' '); } catch { /* ignore */ }
  try { strokes = name.split('').reduce((s, c) => s + (Number(cnchar.stroke(c)) || 0), 0); } catch { /* ignore */ }
  try {
    const infos = cnchar.info(name.split(''));
    wuxing = infos.map(x => x.fiveElement || '').join('');
  } catch { /* ignore */ }
  surnames.push({ n: name, py, s: strokes, w: wuxing, len: name.length });
}
console.log(`  · 共 ${surnames.length} 个姓氏（复姓 ${surnames.filter(s => s.len === 2).length}）`);

console.log('⑦ 写出文件');
const meta = {
  generatedAt: new Date().toISOString(),
  total: out.length,
  levels: { 1: out.filter(x => x.lv === 1).length, 2: out.filter(x => x.lv === 2).length, 3: out.filter(x => x.lv === 3).length },
  structs: Object.fromEntries([...structCount].filter(([k]) => k).sort((a, b) => b[1] - a[1])),
  radicals: Object.fromEntries([...radicalCount].filter(([k]) => k).sort((a, b) => b[1] - a[1])),
  tones: Object.fromEntries([...toneCount].sort((a, b) => a[0] - b[0])),
  wuxing: Object.fromEntries([...wuxingCount].filter(([k]) => k).sort((a, b) => b[1] - a[1])),
  initials: Object.fromEntries(
    [...out.reduce((map, x) => map.set(x.i, (map.get(x.i) || 0) + 1), new Map())]
      .sort((a, b) => b[1] - a[1])
  ),
  surnameCount: surnames.length,
};

fs.writeFileSync(path.join(dataDir, 'chars.json'), JSON.stringify(out));
fs.writeFileSync(path.join(dataDir, 'surnames.json'), JSON.stringify(surnames));
fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify(meta, null, 1));
console.log(`  · data/chars.json ${(fs.statSync(path.join(dataDir, 'chars.json')).size / 1048576).toFixed(2)} MB`);
console.log('完成 ✅');
