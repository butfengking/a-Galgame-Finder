// 单测：pixivSearch 的 relatedTags 人名扩展队列逻辑（沙箱连不上 Pixiv，用 mock 响应验证真实代码）
const fs = require('fs');

const src = fs.readFileSync('main.js', 'utf8');
const start = src.indexOf('async function pixivSearch(');
const endMarker = '// Pixiv 图片代理';
const end = src.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('cannot extract pixivSearch');
const fnSrc = src.slice(start, end);

// 依赖 stub
const BROWSER_UA = 'Mozilla/5.0 (test)';
function expandKeyword(kw) {
  const map = { '巧克甜恋2': { expansions: ['あまいろショコラータ2'] }, 御园莓华: { expansions: ['御園莓華'] } };
  return map[kw] || null;
}
function tify(s) { return s.replace(/园/g, '園').replace(/华/g, '華'); }
function sify(s) { return s.replace(/園/g, '园').replace(/華/g, '华'); }
function readPixivCookie() { return 'fake-session'; }

// 每个标签的返回量（模拟 Pixiv 真实情况：原词“莓华”几乎没有直配作品，完整人名才有大量作品）
const WORK_COUNT = { 莓华: 0, 御园莓华: 4, 御園莓華: 30, 莓華: 10, 御園いちか: 6, 白色相簿2: 10, 九條莓華: 8, 柚子: 30, 柚子社: 30, 初音: 50, 初音ミク: 50 };
// 原词直搜的作品总量（人名片段很少，系列/常用词很多）
const TOTAL = { 莓华: 0, 莓華: 10, 柚子: 5, 初音: 800, 白色相簿2: 19 };
const RELATED_FOR = {
  莓华: ['御園莓華', '莓華', '御园莓华'],
  莓華: ['御園莓華', '九條莓華'], // 同名角色：另一个姓 + 同名“莓華”
  御園莓華: ['御園いちか'],
  柚子: ['柚子社'], // 系列/公司：柚子社 以“社”结尾，不能当人名
  初音: ['初音ミク'], // 常用词：直搜已有大量作品，不需要人名扩展
};

const searched = [];
function mockFetch(url) {
  const u = new URL(url);
  const word = u.searchParams.get('word');
  const page = Number(u.searchParams.get('p') || 1);
  searched.push(word + '@p' + page);
  const count = WORK_COUNT[word] || 0;
  const data = [];
  for (let i = 0; i < count; i++) data.push({ id: (word + page + i).split('').reduce((a, c) => a + c.charCodeAt(0), 0), title: word + ' #' + (page - 1) * 30 + i, url: '' });
  const body = { illustManga: { data, total: TOTAL[word] || 0 } };
  if (RELATED_FOR[word]) body.relatedTags = RELATED_FOR[word];
  return { ok: true, json: async () => ({ error: false, body }) };
}

async function runSearch(keyword, extra, limit, refine, personMode) {
  const fn = new Function('keyword', 'fetchImpl', 'extra', 'limit', 'refine', 'personMode', 'BROWSER_UA', 'expandKeyword', 'tify', 'sify', 'readPixivCookie', 'personCandidates',
    'return (' + fnSrc + ').call(null, keyword, arguments[1], arguments[2], arguments[3], arguments[4], arguments[5]);');
  const personCandidates = (kw, ex) => {
    const raw = String(kw || '').trim();
    const out = [raw];
    const exp = expandKeyword(raw);
    if (exp) for (const e of exp.expansions) if (e && !out.includes(e)) out.push(e);
    for (const e of ex || []) if (e && !out.includes(e)) out.push(e);
    if (/[\u4e00-\u9fff]/.test(raw)) {
      const t = tify(raw);
      const s = sify(raw);
      if (t && t !== raw && !out.includes(t)) out.push(t);
      if (s && s !== raw && !out.includes(s)) out.push(s);
    }
    return out.slice(0, 6);
  };
  return await fn(keyword, mockFetch, extra, limit, refine, personMode, BROWSER_UA, expandKeyword, tify, sify, readPixivCookie, personCandidates);
}

(async () => {
  // 场景1（用户原话）：人名模式开启，搜“莓华”（名）→ 名/姓名 都搜出来 —— cap 60 足够大
  searched.length = 0;
  const r1 = await runSearch('莓华', [], 60, false, true);
  const s1 = [...new Set(searched.map((s) => s.split('@')[0]))];
  const t1 = new Set(r1.items.map((r) => r.title.split(' ')[0]));
  console.log('[场景1] 搜索标签:', s1.join(' | '));
  console.log('[场景1] 结果标签:', [...t1].join(' | '), '| 结果数:', r1.items.length);
  const ok1 = ['莓华', '莓華', '御園莓華', '御园莓华'].every((t) => s1.includes(t)) &&
              ['莓華', '御園莓華', '御园莓华'].every((t) => t1.has(t)) &&
              r1.tags.includes('御園莓華');
  console.log('[场景1] 人名模式：名/姓名全部入队并呈现, 人物候选返回:', ok1, '\n');

  // 场景10（关键）：人名模式关闭时，即使搜人名片段也不做相关标签扩展、不弹选择器
  // （简繁变体 莓華 仍会搜 —— 那是普通搜索自带的简繁互转，不属于人名扩展）
  searched.length = 0;
  const r10 = await runSearch('莓华', [], 10, false, false);
  const s10 = [...new Set(searched.map((s) => s.split('@')[0]))];
  console.log('[场景10] 搜索标签:', s10.join(' | '), '| 结果数:', r10.items.length, '| 人物候选:', r10.tags.length);
  const ok10 = !s10.includes('御園莓華') && !s10.includes('御园莓华') && r10.tags.length === 0;
  console.log('[场景10] 人名模式关闭时不做相关标签扩展:', ok10, '\n');

  // 场景2：人名模式开启，默认结果上限 10 —— 每个变体按配额至少贡献几条，不单一标签占满
  searched.length = 0;
  const r2 = await runSearch('莓华', [], 10, false, true);
  const s2 = [...new Set(searched.map((s) => s.split('@')[0]))];
  const t2 = new Set(r2.items.map((r) => r.title.split(' ')[0]));
  console.log('[场景2] 搜索标签:', s2.join(' | '), '| 结果标签:', [...t2].join(' | '), '| 结果数:', r2.items.length);
  const ok2 = r2.items.length === 10 && ['莓華', '御園莓華', '御园莓华'].filter((t) => t2.has(t)).length >= 2;
  console.log('[场景2] 上限 10 时各变体均呈现:', ok2, '\n');

  // 场景3：人名模式开启，搜“名”莓華 → 相关标签“御園莓華”（姓名）必须入队；同一 (标签,页) 不重复抓取
  searched.length = 0;
  await runSearch('莓華', [], 60, false, true);
  const s3 = [...new Set(searched.map((s) => s.split('@')[0]))];
  const dup = searched.filter((s, i) => searched.indexOf(s) !== i);
  console.log('[场景3] 搜索标签:', s3.join(' | '), '| 重复(标签,页):', dup.length ? dup.join(',') : '无');
  const ok3 = s3.includes('御園莓華') && dup.length === 0;
  console.log('[场景3] 姓名入队且无重复抓取:', ok3, '\n');

  // 场景5（重名角色）：人名模式开启，搜“莓华”时，另一个姓+同名“莓華”的角色（九條莓華）也要被搜到并呈现
  searched.length = 0;
  const r5 = await runSearch('莓华', [], 80, false, true);
  const s5 = [...new Set(searched.map((s) => s.split('@')[0]))];
  const t5 = new Set(r5.items.map((r) => r.title.split(' ')[0]));
  console.log('[场景5] 搜索标签:', s5.join(' | '));
  console.log('[场景5] 结果标签:', [...t5].join(' | '), '| 人物候选:', r5.tags.join(' | '));
  const ok5 = s5.includes('九條莓華') && t5.has('九條莓華') && t5.has('御園莓華') && r5.tags.includes('九條莓華');
  console.log('[场景5] 同名角色全部呈现且进人物候选:', ok5, '\n');

  // 场景6（人物选择器 refine）：点选 御園莓華 → 只搜该标签，不做相关标签扩展
  searched.length = 0;
  const r6 = await runSearch('御園莓華', [], 30, true);
  const s6 = [...new Set(searched.map((s) => s.split('@')[0]))];
  console.log('[场景6] 搜索标签:', s6.join(' | '), '| 结果数:', r6.items.length, '| 人物候选:', r6.tags.length);
  const ok6 = s6.length === 1 && s6[0] === '御園莓華' && r6.items.length === 30 && r6.tags.length === 0;
  console.log('[场景6] 精确搜索只搜该人物:', ok6, '\n');

  // 场景7（多选人物 refine）：勾选 御園莓華 + 九條莓華 → 只搜这两个标签，结果合并且两个都呈现
  searched.length = 0;
  const r7 = await runSearch('', [], 60, ['御園莓華', '九條莓華']);
  const s7 = [...new Set(searched.map((s) => s.split('@')[0]))];
  const t7 = new Set(r7.items.map((r) => r.title.split(' ')[0]));
  console.log('[场景7] 搜索标签:', s7.join(' | '), '| 结果数:', r7.items.length);
  const ok7 = s7.length === 2 && s7.includes('御園莓華') && s7.includes('九條莓華') && t7.has('御園莓華') && t7.has('九條莓華') && r7.tags.length === 0;
  console.log('[场景7] 多选合并搜索:', ok7, '\n');

  // 场景4：人名模式开启但 Pixiv 无相关标签（长词）→ 不扩展
  searched.length = 0;
  const r4 = await runSearch('白色相簿2', [], 10, false, true);
  const s4 = [...new Set(searched.map((s) => s.split('@')[0]))];
  console.log('[场景4] 搜索标签:', s4.join(' | '), '| 结果数:', r4.items.length, '| 人物候选:', r4.tags.length);
  const ok4 = s4.length === 1 && s4[0] === '白色相簿2' && r4.items.length === 10 && r4.tags.length === 0;
  console.log('[场景4] 无相关标签时不扩展:', ok4, '\n');

  // 场景8：人名模式开启，但相关标签是系列/公司（柚子社）→ 不进人名队列
  searched.length = 0;
  const r8 = await runSearch('柚子', [], 30, false, true);
  const s8 = [...new Set(searched.map((s) => s.split('@')[0]))];
  console.log('[场景8] 搜索标签:', s8.join(' | '), '| 结果数:', r8.items.length, '| 人物候选:', r8.tags.length);
  const ok8 = s8.length === 1 && s8[0] === '柚子' && r8.tags.length === 0;
  console.log('[场景8] 柚子社不当成人名:', ok8, '\n');

  // 场景9：人名模式开启，搜“初音” → 信任用户，扩展出 初音ミク
  searched.length = 0;
  const r9 = await runSearch('初音', [], 30, false, true);
  const s9 = [...new Set(searched.map((s) => s.split('@')[0]))];
  console.log('[场景9] 搜索标签:', s9.join(' | '), '| 人物候选:', r9.tags.join(' | '));
  const ok9 = s9.includes('初音') && s9.includes('初音ミク') && r9.tags.includes('初音ミク');
  console.log('[场景9] 手动开启后常用词也按人名扩展:', ok9, '\n');

  if (ok1 && ok10 && ok2 && ok3 && ok5 && ok6 && ok7 && ok4 && ok8 && ok9) { console.log('PASS'); } else { console.error('FAIL'); process.exit(1); }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
