/**
 * 逻辑自测：直接在 Node 里跑筛选与组合引擎（不依赖浏览器）
 * 运行：cd tools && node smoke-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store, surnameInfo, TONE_SHORT } from '../assets/data.js';
import { defaultPos, filterChars, facetsFor } from '../assets/filters.js';
import { allReadings as readingsOf } from '../assets/filters.js';

/** 一个字的全部声调（含多音字） */
function readingsTones(c) {
  const MARK = { 1: ['ā', 'ō', 'ē', 'ī', 'ū', 'ǖ'], 2: ['á', 'ó', 'é', 'í', 'ú', 'ǘ'], 3: ['ǎ', 'ǒ', 'ě', 'ǐ', 'ǔ', 'ǚ'], 4: ['à', 'ò', 'è', 'ì', 'ù', 'ǜ'] };
  return readingsOf(c).map(r => {
    if (r.t) return r.t;
    for (const [t, ms] of Object.entries(MARK)) if (ms.some(m => (r.p || '').includes(m))) return Number(t);
    return 5;
  });
}
import { COMBO_DEFAULT, generate, estimateTotal, sortResults, orderPools } from '../assets/combo.js';
import { checkName, BAD_CHARS, BAD_WORDS } from '../assets/homophone.js';
import { calcWuge, luckOf } from '../assets/wuge.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
store.chars = JSON.parse(fs.readFileSync(path.join(root, 'data/chars.json'), 'utf8'));
store.surnames = JSON.parse(fs.readFileSync(path.join(root, 'data/surnames.json'), 'utf8'));
store.meta = JSON.parse(fs.readFileSync(path.join(root, 'data/meta.json'), 'utf8'));
store.byChar = new Map(store.chars.map(c => [c.c, c]));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

console.log('\n【1】字库基本检查');
ok(store.chars.length > 7000, `字库 ${store.chars.length} 条`);
ok(store.surnames.length > 1000, `姓氏 ${store.surnames.length} 个`);
const bad = store.chars.filter(c => !c.c || !c.p || !c.s || c.t === undefined);
ok(bad.length === 0, `关键字段完整（字/拼音/笔画/声调），缺字段 ${bad.length} 条`);
const noStruct = store.chars.filter(c => !c.st || c.st === '未收录');
ok(noStruct.length / store.chars.length < 0.11, `结构未收录 ${noStruct.length} 条（占 ${(noStruct.length / store.chars.length * 100).toFixed(1)}%，几乎都是三级生僻字）`);
ok(!noStruct.some(c => c.lv === 1 && c.hf > 500), '常用字（语料高频）均有结构数据');
ok(store.byChar.get('张').s === 7 && store.byChar.get('张').t === 1, '张 = 7 画 / 一声');
ok(store.byChar.get('乐').ps.length === 2, '乐 是多音字（lè / yuè）');

console.log('\n【2】逐字条件筛选');
const f1 = defaultPos();
f1.tones = [2, 4];
f1.structs = ['左右结构'];
f1.strokeMin = 8; f1.strokeMax = 12;
const pool1 = filterChars(f1);
const toneOk = (c) => [c.t, ...readingsTones(c)].some(t => t === 2 || t === 4);
ok(pool1.length > 0 && pool1.every(toneOk), `声调筛选：${pool1.length} 字，均含二声或四声读音`);
const f1b = { ...f1, polyMatch: false };
const pool1b = filterChars(f1b);
ok(pool1b.every(c => c.t === 2 || c.t === 4), `关闭多音字匹配后 ${pool1b.length} 字全部以主读音命中`);
ok(pool1b.length < pool1.length, '多音字匹配确实扩大了候选池');
ok(pool1.every(c => c.st === '左右结构'), '结构筛选生效');
ok(pool1.every(c => c.s >= 8 && c.s <= 12), '普通笔画范围生效');

const f2 = { ...defaultPos(), useKangxi: true, strokeMin: 9, strokeMax: 9, levels: [1, 2, 3] };
const pool2 = filterChars(f2);
ok(pool2.every(c => c.kx === 9), `康熙笔画 = 9 的字 ${pool2.length} 个`);

const f3 = { ...defaultPos(), radicals: ['氵'], wuxing: ['水'], levels: [1, 2, 3] };
const pool3 = filterChars(f3);
ok(pool3.every(c => c.r === '氵' && c.w === '水'), `氵+水 的字 ${pool3.length} 个`);

const f4 = { ...defaultPos(), meaning: '美玉', levels: [1, 2, 3] };
const pool4 = filterChars(f4);
ok(pool4.length > 3, `释义含「美玉」的字 ${pool4.length} 个：${pool4.slice(0, 8).map(c => c.c).join('')}`);

const f5 = { ...defaultPos(), genderMode: 'f', genderMin: 0.5, levels: [1, 2] };
const pool5 = filterChars(f5);
ok(pool5.length > 100 && pool5.every(c => c.g <= -0.5), `偏女性用字 ${pool5.length} 个`);

const f6 = { ...defaultPos(), maxHotRank: 300, levels: [1, 2] };
const pool6 = filterChars(f6);
ok(pool6.every(c => c.hr >= 300), `排除热度前 300 名后剩 ${pool6.length} 字`);
ok(!pool6.some(c => ['文', '明', '华', '伟'].includes(c.c)), '爆款字（文/明/华/伟）已被排除');

const f7 = { ...defaultPos(), excludeBad: true, levels: [1, 2, 3] };
const pool7 = filterChars(f7);
ok(!pool7.some(c => BAD_CHARS.has(c.c)), '不吉字已被排除');
ok(pool7.some(c => c.c === '思') && pool7.some(c => c.c === '清'), '常用美字（思/清）未被误伤');

const f8 = { ...defaultPos(), finals: ['ang'], initials: ['zh'], levels: [1, 2], polyMatch: false };
const pool8 = filterChars(f8);
ok(pool8.length > 5 && pool8.every(c => c.f === 'ang' && c.i === 'zh'), `zh + ang：${pool8.slice(0, 12).map(c => c.c).join('')}`);

console.log('\n【3】数据质量（IPA 修正 / 结构补齐 / 生僻字门槛）');
ok(store.chars.every(c => !/[\u0261\u0251]/.test(c.p)), '拼音中没有残留的 IPA 字符 ɡ/ɑ');
const gao = store.byChar.get('高');
ok(gao.i === 'g' && gao.f === 'ao', `高 = 声母 g + 韵母 ao（修正前会被判成零声母）`);
ok(store.byChar.get('剑').st === '左右结构', '剑 的结构已人工补齐');
const noSt = store.chars.filter(c => c.st === '未收录' && c.lv === 1);
ok(noSt.length === 0, `一级字结构全覆盖（未收录 ${noSt.length} 个）`);
const rare = filterChars({ ...defaultPos(), levels: [1, 2, 3] });
ok(rare.every(c => c.hf >= 1), `默认只用人名语料出现过的字：${rare.length} 个（全部 hf ≥ 1）`);
const all = filterChars({ ...defaultPos(), levels: [1, 2, 3], minNameFreq: 0 });
ok(all.length > rare.length, `放开生僻字门槛后增加到 ${all.length} 个`);

console.log('\n【4】姓氏解析');
const zhang = surnameInfo('张');
ok(zhang.strokes === 7 && zhang.wuxing[0] === '火', `张：${zhang.strokes} 画，五行 ${zhang.wuxing[0]}`);
const ouyang = surnameInfo('欧阳');
ok(ouyang.chars.length === 2 && ouyang.strokes === 14, `欧阳：${ouyang.strokes} 画（复姓）`);

console.log('\n【5】组合与整名规则');
const pf = { ...defaultPos(), tones: [2], strokeMin: 6, strokeMax: 12 };
const p1 = filterChars(pf);
const pf2 = { ...defaultPos(), tones: [4], strokeMin: 6, strokeMax: 12 };
const p2 = filterChars(pf2);
console.log(`  第 1 字候选 ${p1.length}，第 2 字候选 ${p2.length}，理论组合 ${estimateTotal([p1, p2], 2).toLocaleString()}`);
const rules = { ...COMBO_DEFAULT };
const { list, truncated } = generate({ surnameInfo: zhang, pools: orderPools([p1, p2], 'hot-asc'), len: 2, rules, cap: 20000 });
ok(list.length > 100, `生成 ${list.length} 条（截断=${truncated}）`);
ok(list.every(r => r.givenChars[0] !== r.givenChars[1]), '名内不重复用字规则生效');
ok(list.every(r => [r.given[0].t, ...readingsTones(r.given[0])].includes(2) &&
  [r.given[1].t, ...readingsTones(r.given[1])].includes(4)), '两字均含所需声调读音');
ok(!list.some(r => r.reasons.length), '默认规则下无谐音/不吉字告警');
const sorted = sortResults(list, 'hot-asc');
console.log('  最冷门 5 个:', sorted.slice(0, 5).map(r => `${r.full}(${r.maxHf})`).join(' '));
ok(sorted[0].given.every(c => c.hf > 0), '冷门优先不会推出「语料中从未出现」的怪字');
console.log('  最热门 3 个:', sortResults(list, 'hot-desc').slice(0, 3).map(r => r.full).join(' '));
ok(sorted[0].maxHf <= sorted[sorted.length - 1].maxHf, '冷门优先排序正确（按名字中最热的字）');
ok(sorted[0].maxHf <= 60, `最冷门一条「${sorted[0].full}」中最热的字仅出现 ${sorted[0].maxHf} 次`);

const radicalRules = { ...COMBO_DEFAULT, noRepeatRadical: true, noRepeatStruct: true };
const { list: list2 } = generate({ surnameInfo: zhang, pools: [p1, p2], len: 2, rules: radicalRules, cap: 20000 });
ok(list2.every(r => r.given[0].r !== r.given[1].r), '偏旁不重复规则生效');
ok(list2.every(r => r.given[0].st !== r.given[1].st), '结构不重复规则生效');

const toneRules = { ...COMBO_DEFAULT, toneMode: 'no-adjacent-same' };
const { list: list3 } = generate({ surnameInfo: zhang, pools: [p1, p2], len: 2, rules: toneRules, cap: 20000 });
ok(list3.every(r => r.tones.every((t, i) => i === 0 || t !== r.tones[i - 1])), '相邻声调不同规则生效（含姓氏）');

const patRules = { ...COMBO_DEFAULT, toneMode: 'pattern', tonePattern: '142' };
const { list: list4 } = generate({ surnameInfo: zhang, pools: [p1, p2], len: 2, rules: patRules, cap: 20000 });
ok(list4.every(r => r.tones.join('') === '142'), `声调模式 1-4-2 筛选出 ${list4.length} 条：${list4.slice(0, 6).map(r => r.full).join(' ')}`);

const wugeRules = { ...COMBO_DEFAULT, wugeMode: 'no-bad' };
const { list: list5 } = generate({ surnameInfo: zhang, pools: [p1, p2], len: 2, rules: wugeRules, cap: 20000 });
ok(list5.every(r => r.wuge.bad === 0), `五格无凶数：${list5.length} 条`);

console.log('\n【6】谐音与不吉字');
ok(checkName('吴', [store.byChar.get('用')], 'wu').bad === true, '吴 + 用 → 命中「无用」');
ok(checkName('张', [store.byChar.get('令'), store.byChar.get('仪')], 'zhang').bad === false, '张令仪 → 无告警');
ok(checkName('张', [store.byChar.get('卫'), store.byChar.get('生')], 'zhang').notes.some(n => n.includes('连读成词')), '张卫生 → 提示「卫生」');
ok(BAD_WORDS.size > 20, `负面词库 ${BAD_WORDS.size} 条`);

console.log('\n【7】五格与数理');
const w = calcWuge(zhang.kxList, [5, 5]);
console.log('  张(7) + 令(5) + 仪(5) →', JSON.stringify(w.grid), '吉/凶:', w.good, w.bad);
ok(w.grid.天格 === 8 && w.grid.人格 === 12 && w.grid.地格 === 10 && w.grid.总格 === 17, '五格公式正确');
ok(luckOf(1) === 2 && luckOf(2) === 0 && luckOf(81) === 2, '数理吉凶表正常');
const w2 = calcWuge(ouyang.kxList, [10]);
ok(w2.grid.天格 === 14 + 0 || w2.grid.天格 === ouyang.kxList[0] + ouyang.kxList[1], '复姓天格 = 两字笔画和');

console.log('\n【8】排序与导出数据（结构检查）');
const sample = sorted[0];
ok(sample.given.every(c => c.m !== undefined && c.r && c.w), '结果项含释义/部首/五行，可用于导出');

console.log(`\n通过 ${pass} 项，失败 ${fail} 项\n`);
process.exit(fail ? 1 : 0);
