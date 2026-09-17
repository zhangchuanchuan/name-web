/**
 * 导出：CSV / TXT / JSON / 剪贴板
 */
const TONE_SHORT = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '轻' };

function download(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function csvCell(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 组合结果 → 行数据 */
function resultRows(list) {
  return list.map((r, i) => {
    const g = r.given;
    const row = {
      序号: i + 1,
      姓名: r.full,
      拼音: r.pinyin,
      声调: r.tones.map(t => TONE_SHORT[t] || '').join('-'),
      总笔画: r.strokes,
      康熙笔画: r.kxTotal,
      五行: r.wuxing,
      五格: r.wuge ? `天${r.wuge.grid.天格}/人${r.wuge.grid.人格}/地${r.wuge.grid.地格}/外${r.wuge.grid.外格}/总${r.wuge.grid.总格}` : '',
      三才: r.sancai || '',
      语料热度: r.hot,
      提示: [...r.reasons, ...r.notes].join('；'),
    };
    g.forEach((c, idx) => {
      const n = idx + 1;
      row[`第${n}字`] = c.c;
      row[`第${n}字拼音`] = c.p;
      row[`第${n}字笔画`] = c.s;
      row[`第${n}字五行`] = c.w;
      row[`第${n}字部首`] = c.r;
      row[`第${n}字结构`] = c.st;
      row[`第${n}字释义`] = c.m;
    });
    return row;
  });
}

function toCSV(rows) {
  const headers = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map(h => csvCell(r[h])).join(','));
  return lines.join('\r\n');
}

/** 纯函数：返回 CSV 文本（便于测试与复用） */
export function resultsCSVText(list, criteria = '') {
  const head = criteria ? `# 取名工坊导出 ${new Date().toLocaleString()} ${criteria}\n` : '';
  return '\ufeff' + head + toCSV(resultRows(list));
}

export function exportResultsCSV(list, criteria = '') {
  download(`取名结果-${stamp()}.csv`, resultsCSVText(list, criteria), 'text/csv;charset=utf-8');
}

export function resultsTXTText(list, criteria = '') {
  const lines = [];
  lines.push('取名工坊 · 组合结果');
  lines.push(`导出时间：${new Date().toLocaleString()}`);
  if (criteria) lines.push(`筛选条件：${criteria}`);
  lines.push(`共 ${list.length} 条`);
  lines.push('='.repeat(60));
  list.forEach((r, i) => {
    const tones = r.tones.map(t => TONE_SHORT[t] || '').join('-');
    lines.push(`${String(i + 1).padStart(4, '0')}. ${r.full}　${r.pinyin}　[${tones}]　总笔画 ${r.strokes}`);
    lines.push(`      五行：${r.wuxing || '—'}　语料热度：${r.hot}` +
      (r.wuge ? `　五格：${r.wuge.grid.天格}/${r.wuge.grid.人格}/${r.wuge.grid.地格}/${r.wuge.grid.外格}/${r.wuge.grid.总格}` : ''));
    for (const c of r.given) {
      lines.push(`      ${c.c}（${c.p}，${c.s}画，${c.w}，${c.st}，部首${c.r}）：${c.m || '—'}`);
    }
    const tips = [...r.reasons, ...r.notes];
    if (tips.length) lines.push(`      ⚠ ${tips.join('；')}`);
  });
  return lines.join('\r\n');
}

export function exportResultsTXT(list, criteria = '') {
  download(`取名结果-${stamp()}.txt`, resultsTXTText(list, criteria));
}

export function resultsJSONText(list, criteria = '') {
  const data = {
    generator: '取名工坊',
    exportedAt: new Date().toISOString(),
    criteria,
    count: list.length,
    names: list.map(r => ({
      full: r.full,
      pinyin: r.pinyin,
      tones: r.tones,
      strokes: r.strokes,
      kangxiStrokes: r.kxTotal,
      wuxing: r.wuxing,
      hot: r.hot,
      wuge: r.wuge ? { ...r.wuge.grid, 吉数: r.wuge.good, 凶数: r.wuge.bad } : null,
      sancai: r.sancai || null,
      notes: [...r.reasons, ...r.notes],
      chars: r.given.map(c => ({
        char: c.c, pinyin: c.p, tone: c.t, strokes: c.s, kangxi: c.kx,
        radical: c.r, structure: c.st, wuxing: c.w, level: c.lv,
        nameFreq: c.hf, nameRank: c.hr + 1, gender: c.g, meaning: c.m,
      })),
    })),
  };
  return JSON.stringify(data, null, 2);
}

export function exportResultsJSON(list, criteria = '') {
  download(`取名结果-${stamp()}.json`, resultsJSONText(list, criteria), 'application/json;charset=utf-8');
}

/** 候选字池导出 */
export function poolCSVText(pools, surname) {
  const rows = [];
  pools.forEach((pool, pi) => {
    for (const c of pool) {
      rows.push({
        字位: `第${pi + 1}字`,
        姓氏: surname,
        字: c.c,
        拼音: c.p,
        声调: TONE_SHORT[c.t] || '',
        笔画: c.s,
        康熙笔画: c.kx,
        部首: c.r,
        部首笔画: c.rc,
        结构: c.st,
        五行: c.w,
        造字法: c.mth,
        字库级别: c.lv,
        人名出现次数: c.hf,
        人名热度排名: c.hr + 1,
        性别倾向: c.g,
        释义: c.m,
      });
    }
  });
  return '\ufeff' + toCSV(rows);
}

export function exportPoolCSV(pools, surname) {
  download(`候选字-${surname}-${stamp()}.csv`, poolCSVText(pools, surname), 'text/csv;charset=utf-8');
}

/** 字库浏览导出 */
export function charsCSVText(chars) {
  const rows = chars.map(c => ({
    字: c.c, 拼音: c.p, 多音字: (c.ps || []).join('/'), 声调: TONE_SHORT[c.t] || '',
    声母: c.i, 韵母: c.f, 笔画: c.s, 康熙笔画: c.kx, 部首: c.r, 部首笔画: c.rc,
    结构: c.st, 五行: c.w, 造字法: c.mth, 字库级别: c.lv,
    人名出现次数: c.hf, 热度排名: c.hr + 1, 性别倾向: c.g, 释义: c.m,
  }));
  return '\ufeff' + toCSV(rows);
}

export function exportCharsCSV(chars) {
  download(`字库-${stamp()}.csv`, charsCSVText(chars), 'text/csv;charset=utf-8');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export { TONE_SHORT, download, csvCell, stamp };
