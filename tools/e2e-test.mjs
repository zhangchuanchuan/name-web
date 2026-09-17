/**
 * 端到端测试：启动静态服务器 + 无头 Chrome，用 CDP 真实点击页面
 * 运行：node tools/e2e-test.mjs        （需要本机装有 Google Chrome）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8791;
const CDP_PORT = 9333;
const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0; let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); }
};

const server = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), String(PORT)], { stdio: 'ignore' });
const profile = fs.mkdtempSync('/tmp/nameweb-chrome-');
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const cleanup = () => {
  try { chrome.kill('SIGKILL'); } catch { /* ignore */ }
  try { server.kill('SIGKILL'); } catch { /* ignore */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
};
process.on('exit', cleanup);

async function targetUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const list = await res.json();
      const page = list.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await sleep(300);
  }
  throw new Error('无法连接 Chrome 调试端口');
}

const wsUrl = await targetUrl();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('exception: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

await send('Runtime.enable');
await send('Page.enable');

console.log('\n【1】页面加载与首屏');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(2500);
ok(await evaluate('document.querySelectorAll(".card").length') === 0, '初始不自动生成结果');
ok((await evaluate('document.querySelector("#corpus-line").textContent')).includes('7,485'), '顶栏显示字库统计');
ok((await evaluate('document.querySelectorAll("#position-filters .chip[data-kind]").length')) > 200, '逐字条件面板已渲染 chip');
ok((await evaluate('document.querySelectorAll("#presets .chip").length')) === 6, '6 个快速开始预设');

console.log('\n【2】六个预设的候选字池都够用');
for (const id of ['girl', 'boy', 'classic', 'rare', 'single', 'wuge']) {
  await evaluate(`__nameWeb.applyPreset("${id}")`);
  await sleep(150);
  const lens = await evaluate('__nameWeb.state.pools.slice(0, __nameWeb.state.len).map(p => p.length)');
  const min = Math.min(...lens);
  ok(min >= 15, `预设 ${id}：候选字池 ${lens.join(' / ')}`);
}

console.log('\n【3】预设 → 生成结果');
await evaluate('__nameWeb.applyPreset("girl") && __nameWeb.doGenerate()');
await sleep(600);
const girlCount = await evaluate('Number(document.querySelector("#result-count").textContent.replace(/,/g,""))');
ok(girlCount > 100, `清新女孩预设生成 ${girlCount} 条`);
ok(await evaluate('document.querySelectorAll(".card").length') > 0, '结果卡片已渲染');
const firstName = await evaluate('document.querySelector(".card .name").textContent');
ok(firstName.startsWith('张'), `第一张卡片是「${firstName}」`);
ok(await evaluate('__nameWeb.state.pools[0].length > 50 && __nameWeb.state.pools[1].length > 50'), '候选字池非空');

console.log('\n【4】逐字条件联动');
const before = await evaluate('__nameWeb.state.pools[0].length');
await evaluate(`(() => {
  const chip = [...document.querySelectorAll('#position-filters [data-pos-block="0"] .chip[data-kind="wuxing"]')]
    .find(c => c.dataset.val === '金');
  chip.click();
  return true;
})()`);
await sleep(400);
const after = await evaluate('__nameWeb.state.pools[0].length');
ok(after < before, `勾选「五行=金」后第 1 字候选从 ${before} 降到 ${after}`);
ok(await evaluate('__nameWeb.state.pos[0].wuxing.includes("金")'), '条件写入 state');
await evaluate(`[...document.querySelectorAll('#position-filters [data-pos-block="0"] .chip[data-kind="wuxing"]')]
  .find(c => c.dataset.val === '金').click()`);
await sleep(300);

console.log('\n【5】字数切换 / 单字名');
await evaluate('document.querySelector(\'#len-seg button[data-len="1"]\').click()');
await sleep(400);
ok(await evaluate('__nameWeb.state.len') === 1, '切换到单字名');
await evaluate('__nameWeb.doGenerate()');
await sleep(400);
const singleName = await evaluate('document.querySelector(".card .name").textContent');
ok(singleName.length === 2, `单字名结果是两个字：「${singleName}」`);
await evaluate('document.querySelector(\'#len-seg button[data-len="2"]\').click()');
await sleep(300);

console.log('\n【6】排序 / 分页 / 收藏');
await evaluate('__nameWeb.applyPreset("classic") && __nameWeb.doGenerate()');
await sleep(600);
const topRecommend = await evaluate('document.querySelector(".card .name").textContent');
await evaluate('(() => { const s = document.querySelector("#sort-select"); s.value = "hot-asc"; s.dispatchEvent(new Event("change")); })()');
await sleep(400);
const topCold = await evaluate('document.querySelector(".card .name").textContent');
ok(topCold !== topRecommend, `切换排序后首条结果变化：「${topRecommend}」→「${topCold}」`);
const poolLens = await evaluate('__nameWeb.state.pools.map(p => p.length).join("/")');
console.log('    候选字池长度:', poolLens, '| 排序:', await evaluate('__nameWeb.state.sort'));
ok(await evaluate('__nameWeb.state.pools[0].length > 1 && __nameWeb.state.pools[0][0].hf <= __nameWeb.state.pools[0][__nameWeb.state.pools[0].length - 1].hf'), '候选字池按排序键（冷门优先）升序排列');
await evaluate('document.querySelector(\'#pager button[data-page="2"]\').click()');
await sleep(400);
ok(await evaluate('__nameWeb.state.page') === 2, '翻到第 2 页');
const favBefore = await evaluate('__nameWeb.state.favorites.size');
await evaluate('document.querySelector(".card .fav").click()');
await sleep(200);
ok(await evaluate('__nameWeb.state.favorites.size') === favBefore + 1, '收藏按钮生效（写入 localStorage）');

console.log('\n【7】候选字点击排除 / 高级条件');
await evaluate('document.querySelectorAll(".pool .pchar")[0].click()');
await sleep(400);
ok(await evaluate('__nameWeb.state.pos[0].exclude.length') > 0, '点击候选字会把它加入排除列表');
await evaluate('__nameWeb.state.pos[0].exclude = ""; __nameWeb.refreshPool();');
await evaluate('document.querySelector(\'[data-adv="0"]\').click()');
await sleep(200);
ok(await evaluate('!document.querySelector(\'[data-adv-box="0"]\').classList.contains("hidden")'), '高级条件面板可展开');

console.log('\n【8】导出（纯文本生成 + 下载触发）');
const csvLen = await evaluate(`(async () => {
  const EX = await import('/assets/export.js');
  return EX.resultsCSVText(__nameWeb.state.results, 'e2e').split('\\r\\n').length;
})()`);
ok(csvLen > 10, `CSV 文本生成 ${csvLen} 行`);
const txt = await evaluate(`(async () => {
  const EX = await import('/assets/export.js');
  return EX.resultsTXTText(__nameWeb.state.results, 'e2e').slice(0, 40);
})()`);
ok(txt.startsWith('取名工坊'), 'TXT 文本开头正确');
const jsonOk = await evaluate(`(async () => {
  const EX = await import('/assets/export.js');
  const d = JSON.parse(EX.resultsJSONText(__nameWeb.state.results, 'e2e'));
  return d.count + '|' + d.names[0].chars.length;
})()`);
ok(/^\d+\|[12]$/.test(jsonOk), `JSON 结构正确（${jsonOk}）`);
const poolCsv = await evaluate(`(async () => {
  const EX = await import('/assets/export.js');
  return EX.poolCSVText(__nameWeb.state.pools.slice(0, __nameWeb.state.len), '张').split('\\r\\n').length;
})()`);
ok(poolCsv > 10, `候选字 CSV 生成 ${poolCsv} 行`);
// 真实点击下载按钮，确认不抛异常
await evaluate('document.querySelector("#export-csv").click()');
await sleep(300);
await evaluate('document.querySelector("#export-txt").click(); document.querySelector("#export-json").click();');
await sleep(300);

console.log('\n【9】字库浏览 / 关于');
await evaluate('document.querySelector(\'.tab[data-view="browse"]\').click()');
await sleep(700);
const rows = await evaluate('document.querySelectorAll("#browse-body tr").length');
ok(rows === 100, `字库表格渲染 ${rows} 行`);
ok((await evaluate('document.querySelector("#browse-count").textContent')).includes('6,442'), '一级+二级共 6442 字');
await evaluate('(() => { const i = document.querySelector("#browse-search"); i.value = "美玉"; i.dispatchEvent(new Event("input")); })()');
await sleep(400);
ok(await evaluate('document.querySelectorAll("#browse-body tr").length') > 0, '释义关键词搜索有结果');
await evaluate('document.querySelector(\'#browse-export\').click()');
await sleep(200);
await evaluate('document.querySelector(\'.tab[data-view="about"]\').click()');
await sleep(300);
ok((await evaluate('document.querySelector("#about-body").textContent')).includes('通用规范汉字表'), '关于页包含数据来源说明');

console.log('\n【10】控制台错误');
const real = consoleErrors.filter(e => !/favicon|Download is disallowed|net::ERR_/i.test(e));
ok(real.length === 0, real.length ? `发现 ${real.length} 条错误：${real.slice(0, 3).join(' | ')}` : '无 JS 异常与控制台错误');

console.log(`\n通过 ${pass} 项，失败 ${fail} 项\n`);
ws.close();
cleanup();
process.exit(fail ? 1 : 0);
