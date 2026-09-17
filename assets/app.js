/**
 * 取名工坊 · 交互逻辑
 */
import {
  loadData, store, surnameInfo, TONE_NAMES, TONE_SHORT, WUXING, genderText, hotText,
} from './data.js';
import { defaultPos, filterChars, facetsFor } from './filters.js';
import { COMBO_DEFAULT, generate, estimateTotal, sortResults, orderPools } from './combo.js';
import * as EX from './export.js';

/* ------------------------------------------------------------------ */
/* 状态                                                                */
/* ------------------------------------------------------------------ */
const LS_KEY = 'name-web-state-v1';

const state = {
  surname: '张',
  len: 2,
  pos: [defaultPos(), defaultPos()],
  rules: { ...COMBO_DEFAULT },
  pools: [[], []],
  results: [],
  truncated: false,
  criteria: '',
  stale: false,
  generated: false,
  sort: 'recommend',
  page: 1,
  pageSize: 48,
  favorites: new Set(),
  pickerType: '1',
  browse: { q: '', level: '12', page: 1, size: 100, rows: [] },
};

function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      surname: state.surname, len: state.len, pos: state.pos, rules: state.rules,
      sort: state.sort, pageSize: state.pageSize, favorites: [...state.favorites],
    }));
  } catch { /* ignore */ }
}

function restoreState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.surname) state.surname = s.surname;
    if (s.len) state.len = s.len;
    if (Array.isArray(s.pos) && s.pos.length === 2) {
      state.pos = [Object.assign(defaultPos(), s.pos[0]), Object.assign(defaultPos(), s.pos[1])];
    }
    if (s.rules) state.rules = { ...COMBO_DEFAULT, ...s.rules };
    if (s.sort) state.sort = s.sort;
    if (s.pageSize) state.pageSize = s.pageSize;
    if (Array.isArray(s.favorites)) state.favorites = new Set(s.favorites);
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 1900);
}

/* ------------------------------------------------------------------ */
/* 1. 顶栏 / 姓氏                                                      */
/* ------------------------------------------------------------------ */
function renderTopline() {
  const m = store.meta;
  $('#corpus-line').textContent =
    `字库 ${m.total.toLocaleString()} 字（一级 ${m.levels['1']} / 二级 ${m.levels['2']} / 三级 ${m.levels['3']}）` +
    ` · 姓氏 ${m.surnameCount.toLocaleString()} 个 · 人名语料 105 万条`;
}

function renderSurnameMeta() {
  const info = surnameInfo(state.surname);
  const w = info.wuxing.filter(Boolean).join('、') || '—';
  const r = info.radicals.filter(Boolean).join('、') || '—';
  const t = info.tones.filter(Boolean).map(x => TONE_SHORT[x]).join('-') || '—';
  $('#surname-meta').innerHTML = info.surname
    ? `「${esc(info.surname)}」　拼音 ${esc(info.pinyin.join(' ') || '—')}　声调 ${t}　笔画 ${info.strokes}　五行 ${w}　部首 ${r}` +
      (info.known ? '' : '　<span style="color:#b23a2f">（此姓不在字库中，笔画按估算值参与计算）</span>')
    : '';
}

function renderSurnameList() {
  const box = $('#surname-list');
  const q = $('#surname-search').value.trim().toLowerCase();
  let list = store.surnames;
  if (state.pickerType === '2') list = list.filter(s => s.len === 2);
  else if (state.pickerType === 'hot') list = list.filter(s => s.len === 1).slice(0, 100);
  else list = list.filter(s => s.len === 1);
  if (q) {
    list = list.filter(s => s.n.includes(q) || stripTone(s.py).includes(q) || stripTone(s.py).startsWith(q));
  }
  list = list.slice(0, 400);
  box.innerHTML = list.map(s =>
    `<button class="surname-item" data-surname="${esc(s.n)}">${esc(s.n)}<small>${esc(s.py)}</small></button>`
  ).join('') || '<span class="hint">没有匹配的姓氏</span>';
}

function stripTone(p) {
  return (p || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
}

function setSurname(name) {
  state.surname = name;
  $('#surname-input').value = name;
  renderSurnameMeta();
  saveState();
  refreshPool();
}

/* ------------------------------------------------------------------ */
/* 2. 逐字条件面板                                                      */
/* ------------------------------------------------------------------ */
const F = {
  structs: null, radicals: null, wuxing: null, initials: null, finals: null, levels: null,
};

function buildFacetSource() {
  F.structs = Object.entries(store.meta.structs).map(([v, n]) => ({ v, n }));
  F.radicals = Object.entries(store.meta.radicals).map(([v, n]) => ({ v, n }));
  F.wuxing = WUXING.map(v => ({ v, n: store.meta.wuxing[v] || 0 }));
  F.initials = Object.entries(store.meta.initials).map(([v, n]) => ({ v, label: v || '零声母', n }));
  F.finals = store.finals.map(x => ({ v: x.v, n: x.n }));
  F.levels = [
    { v: 1, label: '一级（最常用 3500）', n: store.meta.levels['1'] },
    { v: 2, label: '二级（通用 3000）', n: store.meta.levels['2'] },
    { v: 3, label: '三级（较生僻）', n: store.meta.levels['3'] },
  ];
}

function chipHtml(kind, posIdx, item, selected, extraClass = '') {
  const label = item.label || item.v || '—';
  return `<button class="chip ${selected ? 'on' : ''} ${extraClass}" data-kind="${kind}" data-pos="${posIdx}" data-val="${esc(item.v)}"${item.title ? ` title="${esc(item.title)}"` : ''}>
    ${esc(label)}<span class="n" data-n="${kind}-${esc(item.v)}">${item.n}</span></button>`;
}

function posBlockHtml(idx) {
  const f = state.pos[idx];
  const toneItems = [1, 2, 3, 4, 5].map(t => ({
    v: t, label: TONE_SHORT[t], n: store.meta.tones[t] || 0, title: TONE_NAMES[t],
  }));
  return `
  <div class="pos-block" data-pos-block="${idx}">
    <div class="pos-head">
      <span>第 ${idx + 1} 字</span>
      <span class="badge" data-pool-count="${idx}">0 字可选</span>
    </div>
    <div class="pos-tools">
      ${state.len === 2 && idx === 1 ? `<button class="btn tiny ghost" data-copy-from="0">⬅ 沿用第 1 字条件</button>` : ''}
      ${state.len === 2 && idx === 0 ? `<button class="btn tiny ghost" data-copy-to="1">第 1 字条件 → 第 2 字</button>` : ''}
      <button class="btn tiny ghost" data-clear-pos="${idx}">清空此字条件</button>
    </div>

    <div class="field">
      <label class="lab">笔画范围 <span class="val" data-stroke-label="${idx}">${f.strokeMin} – ${f.strokeMax} 画</span></label>
      <div class="range-row">
        <input type="number" min="1" max="40" value="${f.strokeMin}" data-num="strokeMin" data-pos="${idx}" />
        <span class="hint">—</span>
        <input type="number" min="1" max="40" value="${f.strokeMax}" data-num="strokeMax" data-pos="${idx}" />
        <label class="inline" style="margin-left:auto"><input type="checkbox" data-chk="useKangxi" data-pos="${idx}" ${f.useKangxi ? 'checked' : ''}/>康熙笔画</label>
      </div>
      <div class="chips" style="margin-top:6px">
        <button class="chip mini" data-preset-stroke="${idx}" data-a="3" data-b="8">3–8 画</button>
        <button class="chip mini" data-preset-stroke="${idx}" data-a="5" data-b="10">5–10 画</button>
        <button class="chip mini" data-preset-stroke="${idx}" data-a="8" data-b="13">8–13 画</button>
        <button class="chip mini" data-preset-stroke="${idx}" data-a="1" data-b="40">不限</button>
      </div>
    </div>

    <div class="field">
      <label class="lab">声调（多选，可多音字按任一读音匹配）</label>
      <div class="chips">${toneItems.map(t => chipHtml('tones', idx, t, f.tones.includes(t.v))).join('')}</div>
    </div>

    <div class="field">
      <label class="lab">汉字结构</label>
      <div class="chips">${F.structs.map(s => chipHtml('structs', idx, s, f.structs.includes(s.v))).join('')}</div>
    </div>

    <div class="field">
      <label class="lab">五行</label>
      <div class="chips">${F.wuxing.map(s => chipHtml('wuxing', idx, s, f.wuxing.includes(s.v))).join('')}</div>
    </div>

    <div class="field">
      <label class="lab">声母</label>
      <div class="chips">${F.initials.map(s => chipHtml('initials', idx, s, f.initials.includes(s.v))).join('')}</div>
    </div>

    <div class="field">
      <label class="lab">韵母 <input class="input" style="width:110px;display:inline-block;padding:2px 6px;font-size:12px" placeholder="筛选韵母" data-final-filter="${idx}" /></label>
      <div class="chips" data-final-box="${idx}">${F.finals.map(s => chipHtml('finals', idx, s, f.finals.includes(s.v))).join('')}</div>
    </div>

    <div class="field">
      <label class="lab">部首 <input class="input" style="width:110px;display:inline-block;padding:2px 6px;font-size:12px" placeholder="筛选部首" data-radical-filter="${idx}" /></label>
      <div class="chips" data-radical-box="${idx}">${F.radicals.map(s => chipHtml('radicals', idx, s, f.radicals.includes(s.v))).join('')}</div>
    </div>

    <button class="adv-toggle" data-adv="${idx}">▸ 展开高级条件（寓意 / 性别倾向 / 热度 / 排除字）</button>
    <div class="adv hidden" data-adv-box="${idx}">
      <div class="field">
        <label class="lab">字库级别</label>
        <div class="chips">${F.levels.map(s => chipHtml('levels', idx, { v: s.v, label: s.label.split('（')[0], n: s.n }, f.levels.includes(s.v))).join('')}</div>
      </div>
      <div class="field">
        <label class="lab">释义关键词（空格分隔，命中任一即可）</label>
        <input class="input" data-text="meaning" data-pos="${idx}" value="${esc(f.meaning)}" placeholder="如玉、光明、美好" />
      </div>
      <div class="field">
        <label class="lab">性别倾向（依据 105 万人名语料）</label>
        <div class="range-row">
          <select data-sel="genderMode" data-pos="${idx}">
            <option value="any"${f.genderMode === 'any' ? ' selected' : ''}>不限</option>
            <option value="f"${f.genderMode === 'f' ? ' selected' : ''}>偏女性用字</option>
            <option value="m"${f.genderMode === 'm' ? ' selected' : ''}>偏男性用字</option>
          </select>
          <input type="number" min="0.1" max="1" step="0.1" value="${f.genderMin}" data-num="genderMin" data-pos="${idx}" title="倾向阈值" />
        </div>
      </div>
      <div class="field">
        <label class="lab">用字范围</label>
        <div class="range-row">
          <span class="hint">只用人名语料中出现过 ≥</span>
          <input type="number" min="0" max="5000" step="1" value="${f.minNameFreq}" data-num="minNameFreq" data-pos="${idx}" />
          <span class="hint">次的字（1 = 排除几乎没人用的生僻字，0 = 不限）</span>
        </div>
      </div>
      <div class="field">
        <label class="lab">避开爆款字</label>
        <div class="range-row">
          <span class="hint">排除人名语料中最常见的前</span>
          <input type="number" min="0" max="2000" step="50" value="${f.maxHotRank}" data-num="maxHotRank" data-pos="${idx}" />
          <span class="hint">名的用字（0 = 不限）</span>
        </div>
      </div>
      <div class="field">
        <label class="lab">排除字（直接写汉字）</label>
        <input class="input" data-text="exclude" data-pos="${idx}" value="${esc(f.exclude)}" placeholder="如：梓涵" />
      </div>
      <div class="field">
        <label class="lab">只用这些字（白名单，留空则不限）</label>
        <input class="input" data-text="pick" data-pos="${idx}" value="${esc((f.pick || []).join(''))}" placeholder="如：清和知远" />
      </div>
      <div class="field">
        <label class="inline"><input type="checkbox" data-chk="excludeBad" data-pos="${idx}" ${f.excludeBad ? 'checked' : ''}/>排除不吉、不雅字（死病亡丧等）</label>
      </div>
      <div class="field">
        <label class="inline"><input type="checkbox" data-chk="polyMatch" data-pos="${idx}" ${f.polyMatch !== false ? 'checked' : ''}/>多音字按任一读音命中声调/声母/韵母</label>
      </div>
    </div>
  </div>`;
}

function renderPositions() {
  const box = $('#position-filters');
  const n = state.len;
  box.innerHTML = Array.from({ length: n }, (_, i) => posBlockHtml(i)).join('');
  bindPosEvents(box);
}

function bindPosEvents(box) {
  // chips
  $$('.chip[data-kind]', box).forEach(chip => {
    chip.addEventListener('click', () => {
      const kind = chip.dataset.kind;
      const pi = Number(chip.dataset.pos);
      const raw = chip.dataset.val;
      const val = kind === 'levels' ? Number(raw) : raw;
      const arr = state.pos[pi][kind];
      const i = arr.indexOf(val);
      if (i >= 0) arr.splice(i, 1); else arr.push(val);
      chip.classList.toggle('on');
      markStale();
      refreshPool();
      saveState();
    });
  });
  // number inputs
  $$('input[data-num]', box).forEach(inp => {
    inp.addEventListener('change', () => {
      const pi = Number(inp.dataset.pos);
      const key = inp.dataset.num;
      let v = Number(inp.value);
      if (Number.isNaN(v)) v = key === 'genderMin' ? 0.5 : 0;
      state.pos[pi][key] = v;
      const lab = $(`[data-stroke-label="${pi}"]`);
      if (lab) lab.textContent = `${state.pos[pi].strokeMin} – ${state.pos[pi].strokeMax} 画`;
      markStale(); refreshPool(); saveState();
    });
  });
  // checkboxes
  $$('input[data-chk]', box).forEach(inp => {
    inp.addEventListener('change', () => {
      state.pos[Number(inp.dataset.pos)][inp.dataset.chk] = inp.checked;
      markStale(); refreshPool(); saveState();
    });
  });
  // text inputs
  let t = null;
  $$('input[data-text]', box).forEach(inp => {
    inp.addEventListener('input', () => {
      const pi = Number(inp.dataset.pos);
      const key = inp.dataset.text;
      const val = inp.value;
      state.pos[pi][key] = key === 'pick' ? [...val] : val;
      clearTimeout(t);
      t = setTimeout(() => { markStale(); refreshPool(); saveState(); }, 220);
    });
  });
  // selects
  $$('select[data-sel]', box).forEach(sel => {
    sel.addEventListener('change', () => {
      state.pos[Number(sel.dataset.pos)][sel.dataset.sel] = sel.value;
      markStale(); refreshPool(); saveState();
    });
  });
  // presets
  $$('[data-preset-stroke]', box).forEach(btn => {
    btn.addEventListener('click', () => {
      const pi = Number(btn.dataset.presetStroke);
      state.pos[pi].strokeMin = Number(btn.dataset.a);
      state.pos[pi].strokeMax = Number(btn.dataset.b);
      renderPositions(); markStale(); refreshPool(); saveState();
    });
  });
  // copy / clear
  $$('[data-copy-to]', box).forEach(btn => btn.addEventListener('click', () => {
    state.pos[1] = JSON.parse(JSON.stringify(state.pos[0]));
    renderPositions(); markStale(); refreshPool(); saveState();
    toast('已把第 1 字条件复制到第 2 字');
  }));
  $$('[data-copy-from]', box).forEach(btn => btn.addEventListener('click', () => {
    state.pos[0] = JSON.parse(JSON.stringify(state.pos[1]));
    renderPositions(); markStale(); refreshPool(); saveState();
    toast('已把第 2 字条件复制到第 1 字');
  }));
  $$('[data-clear-pos]', box).forEach(btn => btn.addEventListener('click', () => {
    const pi = Number(btn.dataset.clearPos);
    const keepLevel = state.pos[pi].levels;
    state.pos[pi] = defaultPos();
    state.pos[pi].levels = keepLevel;
    renderPositions(); markStale(); refreshPool(); saveState();
  }));
  // advanced toggle
  $$('[data-adv]', box).forEach(btn => btn.addEventListener('click', () => {
    const pi = btn.dataset.adv;
    const adv = $(`[data-adv-box="${pi}"]`);
    adv.classList.toggle('hidden');
    btn.textContent = adv.classList.contains('hidden')
      ? '▸ 展开高级条件（寓意 / 性别倾向 / 热度 / 排除字）'
      : '▾ 收起高级条件';
  }));
  // radical / final quick filter
  const quick = (sel, boxSel) => {
    const inp = $(sel);
    if (!inp) return;
    inp.addEventListener('input', () => {
      const q = inp.value.trim();
      $$(`${boxSel} .chip`).forEach(ch => {
        ch.style.display = !q || ch.textContent.includes(q) || ch.classList.contains('on') ? '' : 'none';
      });
    });
  };
  quick('[data-radical-filter="0"]', '[data-radical-box="0"]');
  quick('[data-radical-filter="1"]', '[data-radical-box="1"]');
  quick('[data-final-filter="0"]', '[data-final-box="0"]');
  quick('[data-final-filter="1"]', '[data-final-box="1"]');
}

/* ------------------------------------------------------------------ */
/* 2.5 快速开始预设                                                     */
/* ------------------------------------------------------------------ */
const PRESETS = [
  {
    id: 'girl', name: '清新女孩',
    build() {
      const mk = (t) => {
        const f = defaultPos();
        f.tones = t; f.strokeMin = 6; f.strokeMax = 14;
        f.structs = ['左右结构', '上下结构'];
        f.genderMode = 'f'; f.genderMin = 0.3;
        f.maxHotRank = 300; f.minNameFreq = 5;
        return f;
      };
      return {
        len: 2, pos: [mk([1, 2]), mk([1, 2, 3])], sort: 'recommend',
        rules: { ...COMBO_DEFAULT, noRepeatRadical: true, noRepeatStruct: true, avoidBadWord: true },
      };
    },
  },
  {
    id: 'boy', name: '大气男孩',
    build() {
      const mk = (t) => {
        const f = defaultPos();
        f.tones = t; f.strokeMin = 7; f.strokeMax = 17;
        f.structs = ['左右结构', '上下结构', '独体结构'];
        f.genderMode = 'm'; f.genderMin = 0.2;
        f.maxHotRank = 300; f.minNameFreq = 5;
        return f;
      };
      return {
        len: 2, pos: [mk([1, 2, 4]), mk([1, 2, 4])], sort: 'recommend',
        rules: { ...COMBO_DEFAULT, noRepeatRadical: true, avoidBadWord: true },
      };
    },
  },
  {
    id: 'classic', name: '古典雅致',
    build() {
      const mk = (t) => {
        const f = defaultPos();
        f.tones = t; f.strokeMin = 5; f.strokeMax = 15;
        f.meaning = '美玉 美好 光明 明亮 安宁 温和 文采 芳香 玉 美 明 雅 贤 善 德 文 清 和 瑞 嘉 静 宁 韵';
        f.maxHotRank = 200; f.minNameFreq = 3;
        return f;
      };
      return {
        len: 2, pos: [mk([1, 2]), mk([2, 3, 4])], sort: 'recommend',
        rules: { ...COMBO_DEFAULT, noRepeatRadical: true, noRepeatStruct: true, avoidBadWord: true },
      };
    },
  },
  {
    id: 'rare', name: '冷门不撞名',
    build() {
      const mk = () => {
        const f = defaultPos();
        f.strokeMin = 6; f.strokeMax = 18;
        f.maxHotRank = 1000; f.minNameFreq = 3; f.excludeBad = true;
        return f;
      };
      return {
        len: 2, pos: [mk(), mk()], sort: 'hot-asc',
        rules: { ...COMBO_DEFAULT, noRepeatRadical: true, noRepeatStruct: true, noRepeatWuxing: true, avoidBadWord: true },
      };
    },
  },
  {
    id: 'single', name: '单字名',
    build() {
      const f = defaultPos();
      f.strokeMin = 5; f.strokeMax = 13; f.maxHotRank = 500;
      return {
        len: 1, pos: [f, defaultPos()], sort: 'recommend',
        rules: { ...COMBO_DEFAULT, avoidBadWord: true },
      };
    },
  },
  {
    id: 'wuge', name: '五格全吉',
    build() {
      const f = defaultPos();
      f.strokeMin = 5; f.strokeMax = 16; f.maxHotRank = 200;
      return {
        len: 2, pos: [f, { ...f }], sort: 'wuge',
        rules: { ...COMBO_DEFAULT, wugeMode: 'core-good', noRepeatRadical: true, avoidBadWord: true },
      };
    },
  },
];

function applyPreset(id) {
  const preset = PRESETS.find(x => x.id === id);
  if (!preset) return false;
  const cfg = preset.build();
  state.len = cfg.len;
  state.pos = [Object.assign(defaultPos(), cfg.pos[0]), Object.assign(defaultPos(), cfg.pos[1])];
  state.rules = cfg.rules;
  state.sort = cfg.sort;
  if (cfg.sort === 'wuge' && cfg.rules.wugeMode === 'off') state.rules.wugeMode = 'core-good';
  $('#sort-select').value = state.sort;
  $$('#len-seg button').forEach(x => x.classList.toggle('active', Number(x.dataset.len) === state.len));
  renderPositions(); renderRules();
  refreshPool(); saveState();
  return true;
}

function renderPresets() {
  const box = $('#presets');
  box.innerHTML = PRESETS.map(p => `<button class="chip" data-preset="${p.id}">${p.name}</button>`).join('');
  $$('[data-preset]', box).forEach(btn => btn.addEventListener('click', () => {
    if (applyPreset(btn.dataset.preset)) doGenerate();
  }));
}

/** 支持 ?surname=李&preset=classic&len=1 形式的链接（便于分享与自动化测试） */
function applyUrlParams() {
  const q = new URLSearchParams(location.search);
  const sn = q.get('surname');
  if (sn) {
    const clean = [...sn].filter(c => /[\u4e00-\u9fa5]/.test(c)).slice(0, 2).join('');
    if (clean) { state.surname = clean; $('#surname-input').value = clean; renderSurnameMeta(); }
  }
  const len = q.get('len');
  if (len === '1' || len === '2') {
    state.len = Number(len);
    $$('#len-seg button').forEach(x => x.classList.toggle('active', Number(x.dataset.len) === state.len));
  }
  return q;
}

/* ------------------------------------------------------------------ */
/* 3. 整名规则                                                          */
/* ------------------------------------------------------------------ */
const RULE_DEFS = [
  { key: 'noRepeatChar', label: '名内不重复用字', desc: '如「张梓梓」这类叠字直接排除' },
  { key: 'noRepeatRadical', label: '名字两字偏旁不重复', desc: '避免「林梓桐」三木并列，字形更透气' },
  { key: 'radicalWithSurname', label: '偏旁与姓氏也不重复', desc: '连姓氏一起看，如「江浩然」三水' },
  { key: 'noRepeatStruct', label: '名字两字结构不同', desc: '左右 + 上下 搭配，书写更均衡' },
  { key: 'noRepeatWuxing', label: '名字两字五行不同', desc: '民俗用法，让五行分布更均匀' },
  { key: 'wuxingSheng', label: '名字两字五行相生', desc: '木→火→土→金→水→木 的顺序为相生' },
  { key: 'wuxingFromSurname', label: '名首字与姓氏五行相生', desc: '姓氏五行需在字库中可查' },
  { key: 'avoidBadWord', label: '排除不吉字与负面谐音', desc: '死病亡丧等字，以及「无用」「有病」这类连读谐音' },
  { key: 'avoidWord', label: '再排除连读成常用词', desc: '更严格：连「卫生」「开心」这类中性常用词也排除' },
];

function renderRules() {
  const box = $('#combo-rules');
  const r = state.rules;
  box.innerHTML = `
    ${RULE_DEFS.map(d => `
      <label class="rule">
        <input type="checkbox" data-rule="${d.key}" ${r[d.key] ? 'checked' : ''}/>
        <span class="txt">${d.label}<small>${d.desc}</small></span>
      </label>`).join('')}
    <div class="sub-field">
      <label class="inline">声调搭配（含姓氏）
        <select data-rule-sel="toneMode">
          <option value="none"${r.toneMode === 'none' ? ' selected' : ''}>不限</option>
          <option value="no-adjacent-same"${r.toneMode === 'no-adjacent-same' ? ' selected' : ''}>相邻不同调</option>
          <option value="diff-all"${r.toneMode === 'diff-all' ? ' selected' : ''}>全名各字声调互不相同</option>
          <option value="pattern"${r.toneMode === 'pattern' ? ' selected' : ''}>指定声调模式</option>
        </select>
      </label>
      <input class="input" style="margin-top:6px" data-rule-text="tonePattern" value="${esc(r.tonePattern)}"
        placeholder="声调模式：如 142（含姓）或 42（仅名字）" ${r.toneMode === 'pattern' ? '' : 'disabled'} />
    </div>
    <div class="sub-field">
      <label class="inline">五格剖象（康熙笔画 · 民俗参考）
        <select data-rule-sel="wugeMode">
          <option value="off"${r.wugeMode === 'off' ? ' selected' : ''}>不使用</option>
          <option value="no-bad"${r.wugeMode === 'no-bad' ? ' selected' : ''}>五格无凶数</option>
          <option value="core-good"${r.wugeMode === 'core-good' ? ' selected' : ''}>人格/地格/总格皆吉</option>
          <option value="min-good"${r.wugeMode === 'min-good' ? ' selected' : ''}>至少 N 格为吉</option>
        </select>
      </label>
      <div class="range-row" style="margin-top:6px">
        <span class="hint">吉数至少</span>
        <input type="number" min="1" max="5" value="${r.wugeMinGood}" data-rule-num="wugeMinGood" />
        <span class="hint">格</span>
      </div>
    </div>`;
  $$('[data-rule]', box).forEach(inp => inp.addEventListener('change', () => {
    state.rules[inp.dataset.rule] = inp.checked;
    markStale(); refreshPool(); saveState();
  }));
  $$('[data-rule-sel]', box).forEach(sel => sel.addEventListener('change', () => {
    state.rules[sel.dataset.ruleSel] = sel.value;
    if (sel.dataset.ruleSel === 'toneMode') {
      const t = $('[data-rule-text="tonePattern"]');
      t.disabled = sel.value !== 'pattern';
      if (!t.disabled) t.focus();
    }
    saveState();
  }));
  let t2 = null;
  const tp = $('[data-rule-text="tonePattern"]');
  tp.addEventListener('input', () => {
    state.rules.tonePattern = tp.value;
    clearTimeout(t2); t2 = setTimeout(saveState, 250);
  });
  $$('[data-rule-num]', box).forEach(inp => inp.addEventListener('change', () => {
    state.rules[inp.dataset.ruleNum] = Number(inp.value) || 1; saveState();
  }));
}

/* ------------------------------------------------------------------ */
/* 4. 候选字池                                                          */
/* ------------------------------------------------------------------ */
function refreshPool() {
  const pools = [];
  for (let i = 0; i < state.len; i++) {
    let pool = filterChars(state.pos[i]);
    if (state.pos[i].pick && state.pos[i].pick.length) {
      // 设置了「白名单」时，按用户书写顺序展示
      const order = state.pos[i].pick;
      pool = [...pool].sort((a, b) => order.indexOf(a.c) - order.indexOf(b.c));
    } else {
      // 否则按当前排序键排队，候选字列表与生成结果口径一致
      pool = orderPools([pool], state.sort)[0];
    }
    pools.push(pool);
    const badge = $(`[data-pool-count="${i}"]`);
    if (badge) badge.textContent = `${pool.length.toLocaleString()} 字可选`;
  }
  state.pools = pools;
  updateFacetCounts();
  renderPool();
  updateEstimate();
}

function updateFacetCounts() {
  for (let i = 0; i < state.len; i++) {
    const f = facetsFor(state.pools[i]);
    const map = {
      structs: f.structs, radicals: f.radicals, wuxing: f.wuxing,
      initials: f.initials, finals: f.finals, levels: f.levels,
    };
    const toneMap = new Map();
    for (const c of state.pools[i]) toneMap.set(c.t, (toneMap.get(c.t) || 0) + 1);
    map.tones = [...toneMap];
    for (const [kind, pairs] of Object.entries(map)) {
      const lookup = new Map(pairs.map(([v, n]) => [String(v), n]));
      $$(`[data-pos-block="${i}"] [data-n^="${kind}-"]`).forEach(span => {
        const v = span.dataset.n.slice(kind.length + 1);
        span.textContent = lookup.get(v) ?? 0;
      });
    }
  }
}

function renderPool() {
  const body = $('#pool-body');
  const used = state.pools.slice(0, state.len);
  if (!used.length || used.every(p => !p.length)) {
    body.innerHTML = '<div class="hint">当前条件下没有可用的字，请放宽条件。</div>';
    return;
  }
  const lines = state.pools.slice(0, state.len).map((pool, i) => {
    const show = pool.slice(0, 300);
    return `<div class="pool-line">
      <span class="tag">第 ${i + 1} 字<br><b>${pool.length.toLocaleString()}</b></span>
      <span class="chars">${show.map(c => `<span class="pchar" data-pchar="${esc(c.c)}" data-pi="${i}" title="${esc(c.p)}｜${c.s}画｜${esc(c.w || '—')}｜${esc(c.st || '未收录')}｜部首${esc(c.r || '—')}｜${esc(c.m)}">${esc(c.c)}</span>`).join('')}
      ${pool.length > show.length ? `<span class="more-note">… 还有 ${(pool.length - show.length).toLocaleString()} 字，见导出</span>` : ''}</span>
    </div>`;
  });
  body.innerHTML = lines.join('') +
    '<div class="hint">点击任意字可把它排除，方便手动微调。</div>';
  $$('.pchar', body).forEach(el => el.addEventListener('click', () => {
    const pi = Number(el.dataset.pi);
    const ch = el.dataset.pchar;
    const ex = state.pos[pi].exclude || '';
    state.pos[pi].exclude = ex.includes(ch) ? ex.replace(ch, '') : ex + ch;
    const input = $(`input[data-text="exclude"][data-pos="${pi}"]`);
    if (input) input.value = state.pos[pi].exclude;
    el.classList.toggle('bad');
    markStale(); refreshPool(); saveState();
  }));
}

function updateEstimate() {
  const est = estimateTotal(state.pools.slice(0, state.len), state.len);
  const hint = $('#generate-hint');
  const names = state.pools.slice(0, state.len).map(p => p.length);
  if (names.some(n => n === 0)) {
    hint.textContent = '有字位的候选字为 0，无法组合。';
    return;
  }
  hint.innerHTML = `候选字 ${names.join(' × ')}，理论组合 <b>${est.toLocaleString()}</b> 个` +
    (state.stale && state.generated ? '　·　条件已修改，记得重新生成' : '');
}

function markStale() {
  if (state.generated) state.stale = true;
}

/* ------------------------------------------------------------------ */
/* 5. 生成与结果                                                        */
/* ------------------------------------------------------------------ */
const CAP = 20000;

function doGenerate() {
  refreshPool();
  const pools = orderPools(state.pools.slice(0, state.len), state.sort);
  if (pools.some(p => !p.length)) { toast('候选字为空，请放宽条件'); return; }
  const t0 = performance.now();
  // 组合数量可能远超上限，先按排序键给每个字位的候选字排队，
  // 这样被截断下来的两万条也是「排序意义上最优」的那一批。

  const { list, truncated } = generate({
    surnameInfo: surnameInfo(state.surname),
    pools,
    len: state.len,
    rules: state.rules,
    cap: CAP,
  });
  const ms = Math.round(performance.now() - t0);
  state.results = sortResults(list, state.sort);
  state.truncated = truncated;
  state.generated = true;
  state.stale = false;
  state.page = 1;
  state.criteria = describeCriteria();
  renderResults();
  toast(`生成 ${list.length.toLocaleString()} 条，用时 ${ms} ms`);
  // 窄屏下条件面板较长，用一个浮动按钮提示结果在下方（不自动滚动，避免用户丢失上下文）
  if (window.innerWidth < 1081) $('#jump-results').classList.remove('hidden');
}

function describeCriteria() {
  const parts = [`姓氏 ${state.surname}`, `名字 ${state.len} 字`];
  state.pools.slice(0, state.len).forEach((p, i) => parts.push(`第${i + 1}字候选 ${p.length} 个`));
  const r = state.rules;
  const on = RULE_DEFS.filter(d => r[d.key]).map(d => d.label);
  if (r.toneMode !== 'none') on.push(`声调规则:${r.toneMode}${r.tonePattern ? '=' + r.tonePattern : ''}`);
  if (r.wugeMode !== 'off') on.push(`五格:${r.wugeMode}`);
  if (on.length) parts.push('整名规则: ' + on.join('、'));
  return parts.join('；');
}

function renderResults() {
  const box = $('#results');
  const list = state.results;
  $('#result-count').textContent = list.length.toLocaleString();
  const notice = $('#result-notice');
  if (state.truncated) {
    notice.classList.remove('hidden');
    notice.innerHTML = `结果超过 ${CAP.toLocaleString()} 条，已截断。建议收紧条件（例如限定笔画区间或排除爆款字），以获得更精准的候选。`;
  } else if (!list.length) {
    notice.classList.add('hidden');
  } else {
    notice.classList.add('hidden');
  }

  if (!list.length) {
    box.innerHTML = '<div class="empty">还没有结果。<br>可以直接点左侧「快速开始」里的偏好一键生成，<br>也可以逐条设置条件后点「生成名字」。</div>';
    $('#pager').innerHTML = '';
    return;
  }
  const start = (state.page - 1) * state.pageSize;
  const pageList = list.slice(start, start + state.pageSize);
  box.innerHTML = pageList.map((r, i) => cardHtml(r, start + i)).join('');
  $$('.fav', box).forEach(btn => btn.addEventListener('click', () => {
    const name = btn.dataset.name;
    if (state.favorites.has(name)) state.favorites.delete(name); else state.favorites.add(name);
    btn.classList.toggle('on');
    btn.textContent = state.favorites.has(name) ? '★' : '☆';
    saveState();
  }));
  renderPager();
}

function cardHtml(r, idx) {
  const tones = r.tones.map(t => TONE_SHORT[t] || '').join('-');
  const pills = [];
  pills.push(`<span class="pill">总笔画 ${r.strokes}</span>`);
  if (r.wuxing) pills.push(`<span class="pill">五行 ${r.wuxing}</span>`);
  if (r.wuge) {
    const cls = r.wuge.bad === 0 ? 'pill good' : 'pill';
    pills.push(`<span class="${cls}">五格 吉${r.wuge.good}/凶${r.wuge.bad}</span>`);
  }
  for (const n of r.reasons) pills.push(`<span class="pill warn">⚠ ${esc(n)}</span>`);
  for (const n of r.notes) pills.push(`<span class="pill">${esc(n)}</span>`);
  const surname = [...r.surname].map(c => esc(c)).join('');
  const given = r.givenChars.map(c => esc(c)).join('');
  const gloss = r.given.map(c =>
    `<div><b>${esc(c.c)}</b>　${esc(c.p)}｜${c.s}画｜${esc(c.w || '—')}｜${esc(c.st || '未收录')}｜${esc(c.r || '—')}部｜热度 ${c.hf ? '#' + (c.hr + 1) : '未出现'}${c.m ? '：' + esc(c.m) : ''}</div>`
  ).join('');
  return `<div class="card">
    <button class="fav ${state.favorites.has(r.full) ? 'on' : ''}" data-name="${esc(r.full)}" title="收藏">${state.favorites.has(r.full) ? '★' : '☆'}</button>
    <div class="name-row">
      <span class="name"><span class="surname">${surname}</span>${given}</span>
    </div>
    <div class="py">${esc(r.pinyin)}　·　${tones}</div>
    <div class="meta-row">${pills.join('')}</div>
    <div class="gloss">${gloss}</div>
  </div>`;
}

function renderPager() {
  const total = state.results.length;
  const pages = Math.ceil(total / state.pageSize);
  const box = $('#pager');
  if (pages <= 1) { box.innerHTML = ''; return; }
  const cur = state.page;
  const nums = [];
  const push = (n) => nums.push(n);
  push(1);
  for (let n = cur - 3; n <= cur + 3; n++) if (n > 1 && n < pages) push(n);
  if (pages > 1) push(pages);
  const uniq = [...new Set(nums)].sort((a, b) => a - b);
  let html = `<button data-page="${cur - 1}" ${cur === 1 ? 'disabled' : ''}>‹</button>`;
  let prev = 0;
  for (const n of uniq) {
    if (prev && n - prev > 1) html += `<button disabled>…</button>`;
    html += `<button data-page="${n}" class="${n === cur ? 'active' : ''}">${n}</button>`;
    prev = n;
  }
  html += `<button data-page="${cur + 1}" ${cur === pages ? 'disabled' : ''}>›</button>`;
  html += `<span class="hint" style="margin-left:10px">共 ${pages.toLocaleString()} 页 / ${total.toLocaleString()} 条</span>`;
  box.innerHTML = html;
  $$('button[data-page]', box).forEach(b => b.addEventListener('click', () => {
    const p = Number(b.dataset.page);
    if (p >= 1 && p <= pages) {
      state.page = p;
      renderResults();
      $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }));
}

/* ------------------------------------------------------------------ */
/* 6. 字库浏览                                                          */
/* ------------------------------------------------------------------ */
function renderBrowse() {
  const b = state.browse;
  const q = b.q.trim().toLowerCase();
  let rows = store.chars.filter(c => {
    if (b.level === '1' && c.lv !== 1) return false;
    if (b.level === '12' && c.lv === 3) return false;
    if (!q) return true;
    return c.c === q || c.p.includes(q) || (c.ps || []).some(p => p.includes(q)) ||
      (c.m || '').includes(q) || c.r === q || (c.st || '').includes(q) || c.w === q;
  });
  b.rows = rows;
  $('#browse-count').textContent = `${rows.length.toLocaleString()} 字`;
  const pages = Math.max(1, Math.ceil(rows.length / b.size));
  if (b.page > pages) b.page = 1;
  const start = (b.page - 1) * b.size;
  const page = rows.slice(start, start + b.size);
  $('#browse-body').innerHTML = page.map(c => {
    const gw = c.g;
    const gtxt = c.hf ? genderText(gw) : '—';
    const barW = c.hf ? Math.min(60, Math.round(Math.log10(c.hf + 1) * 12)) : 0;
    return `<tr>
      <td class="big-char">${esc(c.c)}</td>
      <td><span${c.pf ? ' title="cnchar 未收录此字，拼音来自新华字典数据，生僻字读音可能有误" style="border-bottom:1px dotted #c9bfae;cursor:help"' : ''}>${esc(c.p)}</span>${c.ps ? `<br><small style="color:var(--muted)">${esc(c.ps.join(' / '))}</small>` : ''}</td>
      <td>${TONE_SHORT[c.t] || ''}</td>
      <td>${c.s}</td><td>${c.kx}</td>
      <td>${esc(c.r || '—')}</td><td>${esc(c.st || '未收录')}</td><td>${esc(c.w || '—')}</td>
      <td>${c.lv === 1 ? '一级' : c.lv === 2 ? '二级' : '三级'}</td>
      <td title="${esc(hotText(c))}"><span class="bar" style="width:${barW}px"></span> ${c.hf ? c.hf.toLocaleString() : '—'}</td>
      <td>${gtxt}</td>
      <td class="mean">${esc(c.m || '—')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="12" class="hint">没有匹配的字</td></tr>';

  const box = $('#browse-pager');
  if (pages <= 1) { box.innerHTML = ''; return; }
  const cur = b.page;
  const nums = [...new Set([1, ...Array.from({ length: 7 }, (_, i) => cur - 3 + i).filter(n => n > 1 && n < pages), pages])].sort((x, y) => x - y);
  let html = `<button data-bpage="${cur - 1}" ${cur === 1 ? 'disabled' : ''}>‹</button>`;
  let prev = 0;
  for (const n of nums) {
    if (prev && n - prev > 1) html += '<button disabled>…</button>';
    html += `<button data-bpage="${n}" class="${n === cur ? 'active' : ''}">${n}</button>`;
    prev = n;
  }
  html += `<button data-bpage="${cur + 1}" ${cur === pages ? 'disabled' : ''}>›</button>`;
  html += `<span class="hint" style="margin-left:10px">第 ${cur}/${pages} 页</span>`;
  box.innerHTML = html;
  $$('button[data-bpage]', box).forEach(btn => btn.addEventListener('click', () => {
    const p = Number(btn.dataset.bpage);
    if (p >= 1 && p <= pages) { state.browse.page = p; renderBrowse(); }
  }));
}

/* ------------------------------------------------------------------ */
/* 7. 关于                                                             */
/* ------------------------------------------------------------------ */
function renderAbout() {
  const m = store.meta;
  $('#about-body').innerHTML = `
  <h2>这个工具做什么</h2>
  <p>先按「笔画 / 声调 / 结构 / 部首 / 五行 / 声母韵母 / 寓意 / 用字热度」把可用汉字筛出来，
  再按整名规则（声调搭配、偏旁不重复、谐音、五格等）自动排列组合，最后导出成 CSV / TXT / JSON。</p>

  <h2>字库来源</h2>
  <ul>
    <li><b>字表</b>：《通用规范汉字表》一级 3500 + 二级 3000 + 三级 1605，共 8105 字。
      实际入库 <b>${m.total.toLocaleString()}</b> 字（一级 ${m.levels['1']}、二级 ${m.levels['2']}、三级 ${m.levels['3']}）——
      仅收录有规范读音、且在 BMP 基本区的常用字形。</li>
    <li><b>读音 / 笔画 / 部首 / 释义</b>：新华字典数据集（
      <a href="https://github.com/pwxcoo/chinese-xinhua" target="_blank" rel="noreferrer">chinese-xinhua</a>）。</li>
    <li><b>结构 / 五行 / 造字法 / 多音字</b>：<a href="https://github.com/theajack/cnchar" target="_blank" rel="noreferrer">cnchar</a>
      （含 cnchar-info、cnchar-radical 插件）。</li>
    <li><b>姓名用字热度 / 性别倾向</b>：中文人名语料库 120 万条（
      <a href="https://github.com/wainshine/Chinese-Names-Corpus" target="_blank" rel="noreferrer">Chinese-Names-Corpus</a>），
      统计时已剔除姓氏用字，实际统计 1,050,039 个人名。</li>
    <li><b>姓氏</b>：1074 个姓氏（含 56 个复姓）及人口序，来自同名语料库的姓氏表。</li>
  </ul>

  <h2>关于「用字热度」——本工具最有用的一个指标</h2>
  <p>把 105 万个真实人名里的每一个<b>名用字</b>做词频统计，就得到了每个字在真实生活里的流行度。
  热度排名越靠前，撞名概率越高。想避开烂大街，推荐这样用：</p>
  <ul>
    <li>「用字范围」默认要求该字在人名语料里出现过 <code>≥1</code> 次，先把几乎没人用的生僻字挡在外面；</li>
    <li>把「避开爆款字」设为排除热度前 <code>200~500</code> 名，避开「梓涵沐宸」这一档；</li>
    <li>排序用默认的「推荐」，它把「用得太少」和「用得太烂」都降权，只留下真实有人用、又不撞车的字。</li>
  </ul>
  <p>注意：语料跨越数十年，热度高不等于当下最潮；但<b>热度极高的字一定是撞名重灾区</b>。
  另外语料只覆盖 2156 个用字，未被收录不等于字不好，只是没有真实使用样本。</p>

  <h2>怎么用最快</h2>
  <ul>
    <li>左侧「快速开始」里挑一个偏好（清新女孩 / 大气男孩 / 古典雅致 / 冷门不撞名 / 单字名 / 五格全吉），
    条件会自动配好并立即生成，然后再逐项微调。</li>
    <li>候选字列表里<b>点任意一个字即可排除它</b>，适合手动剔掉不喜欢的字。</li>
    <li>结果可以导出 <b>CSV / TXT / JSON</b>（含拼音、声调、笔画、康熙笔画、五行、五格、释义），
    候选字池和整个字库也能导出。</li>
    <li>链接可以直接分享：<code>?surname=李&amp;preset=classic</code>，再加 <code>&amp;view=browse</code> 可直接打开字库。</li>
  </ul>

  <h2>关于「五格剖象」</h2>
  <p>五格（天格/人格/地格/外格/总格）是民国时期流行的姓名学算法，用<b>康熙笔画</b>推算 1–81 数理吉凶。
  本工具用「简体规范笔画 + 部首还原差额」近似计算康熙笔画（如 氵→水 +1、艹→艸 +3、阝 +5），
  属于近似值，与专门的字帖可能有 1 画出入。它<b>属于民俗参考，不是科学结论</b>，默认关闭。</p>

  <h2>筛选口径提醒</h2>
  <ul>
    <li>声调筛选对多音字按「任一读音命中」处理，比如「乐」既能按 lè（四声）也能按 yuè（四声）匹配。</li>
    <li>「排除了不吉字」使用一份保守黑名单（死、病、亡、丧、傻……），不会误伤「思、清、安」这类常用字。</li>
    <li>组合结果默认上限 20000 条，超出会提示截断；配合「冷门优先」排序，通常前几百条就够挑了。</li>
    <li>收藏（★）与筛选条件都保存在浏览器本地，刷新不丢。</li>
  </ul>

  <h2>重新生成字库</h2>
  <p>数据是离线生成好的静态 JSON。若需更新：
  <code>cd tools &amp;&amp; npm install &amp;&amp; node build-data.mjs</code></p>
  `;
}

/* ------------------------------------------------------------------ */
/* 8. 事件绑定                                                          */
/* ------------------------------------------------------------------ */
function switchView(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'browse' && !state.browse.rows.length) renderBrowse();
}

function bindGlobal() {
  $$('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

  $('#surname-input').addEventListener('input', (e) => {
    const v = e.target.value.replace(/[^\u4e00-\u9fa5]/g, '').slice(0, 2);
    if (v !== e.target.value) e.target.value = v;
    if (v) { state.surname = v; renderSurnameMeta(); markStale(); refreshPool(); saveState(); }
  });
  $('#surname-picker-btn').addEventListener('click', () => {
    const p = $('#surname-picker');
    p.classList.toggle('hidden');
    if (!p.classList.contains('hidden')) { renderSurnameList(); $('#surname-search').focus(); }
  });
  $('#surname-search').addEventListener('input', renderSurnameList);
  $$('.mini-tab').forEach(t => t.addEventListener('click', () => {
    $$('.mini-tab').forEach(x => x.classList.toggle('active', x === t));
    state.pickerType = t.dataset.stype;
    renderSurnameList();
  }));
  $('#surname-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.surname-item');
    if (!btn) return;
    setSurname(btn.dataset.surname);
    $('#surname-picker').classList.add('hidden');
  });

  $$('#len-seg button').forEach(b => b.addEventListener('click', () => {
    const len = Number(b.dataset.len);
    if (len === state.len) return;
    state.len = len;
    $$('#len-seg button').forEach(x => x.classList.toggle('active', x === b));
    renderPositions(); markStale(); refreshPool(); saveState();
  }));

  $('#generate').addEventListener('click', doGenerate);
  $('#jump-results').addEventListener('click', () => {
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#reset').addEventListener('click', () => {
    state.pos = [defaultPos(), defaultPos()];
    state.rules = { ...COMBO_DEFAULT };
    state.len = 2;
    $$('#len-seg button').forEach(x => x.classList.toggle('active', x.dataset.len === '2'));
    renderPositions(); renderRules(); markStale(); refreshPool(); saveState();
    toast('已重置为默认条件');
  });

  $('#sort-select').addEventListener('change', (e) => {
    state.sort = e.target.value;
    state.results = sortResults(state.results, state.sort);
    state.page = 1;
    refreshPool();          // 候选字列表也跟着换序
    renderResults(); saveState();
  });
  $('#page-size').addEventListener('change', (e) => {
    state.pageSize = Number(e.target.value);
    state.page = 1; renderResults(); saveState();
  });

  $('#export-csv').addEventListener('click', () => {
    if (!state.results.length) return toast('还没有结果可导出');
    EX.exportResultsCSV(state.results, state.criteria); toast('已导出 CSV');
  });
  $('#export-txt').addEventListener('click', () => {
    if (!state.results.length) return toast('还没有结果可导出');
    EX.exportResultsTXT(state.results, state.criteria); toast('已导出 TXT');
  });
  $('#export-json').addEventListener('click', () => {
    if (!state.results.length) return toast('还没有结果可导出');
    EX.exportResultsJSON(state.results, state.criteria); toast('已导出 JSON');
  });
  $('#export-pool').addEventListener('click', () => {
    EX.exportPoolCSV(state.pools.slice(0, state.len), state.surname); toast('已导出候选字 CSV');
  });

  $('#browse-search').addEventListener('input', (e) => {
    state.browse.q = e.target.value; state.browse.page = 1; renderBrowse();
  });
  $('#browse-level').addEventListener('change', (e) => {
    state.browse.level = e.target.value; state.browse.page = 1; renderBrowse();
  });
  $('#browse-export').addEventListener('click', () => {
    EX.exportCharsCSV(state.browse.rows); toast('已导出字库 CSV');
  });
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */
async function main() {
  try {
    await loadData();
  } catch (err) {
    document.body.insertAdjacentHTML('afterbegin',
      `<div style="padding:20px;color:#b23a2f">字库载入失败：${esc(err.message)}<br>请确认 <code>data/</code> 目录存在，并通过 HTTP 服务访问（不能直接双击打开 html 文件）。</div>`);
    return;
  }
  restoreState();
  buildFacetSource();
  renderTopline();
  renderSurnameMeta();
  renderSurnameList();
  $('#surname-input').value = state.surname;
  $$('#len-seg button').forEach(x => x.classList.toggle('active', Number(x.dataset.len) === state.len));
  $('#sort-select').value = state.sort;
  $('#page-size').value = String(state.pageSize);
  const urlParams = applyUrlParams();
  const presetFromUrl = urlParams.get('preset');
  const viewFromUrl = urlParams.get('view');
  renderPresets();
  renderPositions();
  renderRules();
  renderAbout();
  bindGlobal();
  if (viewFromUrl && ['compose', 'browse', 'about'].includes(viewFromUrl)) switchView(viewFromUrl);
  if (presetFromUrl && applyPreset(presetFromUrl)) {
    doGenerate();
  } else {
    refreshPool();
    renderResults();
  }
  if (viewFromUrl === 'browse') renderBrowse();
}

// 调试/自动化测试入口（浏览器控制台里也能直接改条件、跑生成）
window.__nameWeb = {
  state, store,
  doGenerate, refreshPool, renderResults, renderBrowse, applyPreset,
  surnameInfo: (n) => surnameInfo(n || state.surname),
};

main();
