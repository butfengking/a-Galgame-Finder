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
const WORK_COUNT = { 莓华: 0, 御园莓华: 4, 御園莓華: 30, 莓華: 10, 御園いちか: 6, 白色相簿2: 10, 九條莓華: 8 };
const RELATED_FOR = {
  莓华: ['御園莓華', '莓華', '御园莓华'],
  莓華: ['御園莓華', '九條莓華'], // 同名角色：另一个姓 + 同名“莓華”
  御園莓華: ['御園いちか'],
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
  const body = { illustManga: { data } };
  if (RELATED_FOR[word]) body.relatedTags = RELATED_FOR[word];
  return { ok: true, json: async () => ({ error: false, body }) };
}

async function runSearch(keyword, extra, limit) {
  const fn = new Function('keyword', 'fetchImpl', 'extra', 'limit', 'BROWSER_UA', 'expandKeyword', 'tify', 'sify', 'readPixivCookie',
    'return (' + fnSrc + ').call(null, keyword, arguments[1], arguments[2], arguments[3]);');
  return await fn(keyword, mockFetch, extra, limit, BROWSER_UA, expandKeyword, tify, sify, readPixivCookie);
}

(async () => {
  // 场景1（用户原话）：搜“莓华”（名），要把 名/姓名 都搜出来 —— cap 60 足够大
  searched.length = 0;
  const r1 = await runSearch('莓华', [], 60);
  const s1 = [...new Set(searched.map((s) => s.split('@')[0]))];
  const t1 = new Set(r1.map((r) => r.title.split(' ')[0]));
  console.log('[场景1] 搜索标签:', s1.join(' | '));
  console.log('[场景1] 结果标签:', [...t1].join(' | '), '| 结果数:', r1.length);
  const ok1 = ['莓华', '莓華', '御園莓華', '御园莓华'].every((t) => s1.includes(t)) &&
              ['莓華', '御園莓華', '御园莓华'].every((t) => t1.has(t));
  console.log('[场景1] 名/姓名全部入队并呈现:', ok1, '\n');

  // 场景2：默认结果上限 10 —— 每个变体按配额至少贡献几条，不单一标签占满
  searched.length = 0;
  const r2 = await runSearch('莓华', [], 10);
  const s2 = [...new Set(searched.map((s) => s.split('@')[0]))];
  const t2 = new Set(r2.map((r) => r.title.split(' ')[0]));
  console.log('[场景2] 搜索标签:', s2.join(' | '), '| 结果标签:', [...t2].join(' | '), '| 结果数:', r2.length);
  const ok2 = r2.length === 10 && ['莓華', '御園莓華', '御园莓华'].filter((t) => t2.has(t)).length >= 2;
  console.log('[场景2] 上限 10 时各变体均呈现:', ok2, '\n');

  // 场景3：搜“名”莓華 → 相关标签“御園莓華”（姓名）必须入队；同一 (标签,页) 不重复抓取
  searched.length = 0;
  await runSearch('莓華', [], 60);
  const s3 = [...new Set(searched.map((s) => s.split('@')[0]))];
  const dup = searched.filter((s, i) => searched.indexOf(s) !== i);
  console.log('[场景3] 搜索标签:', s3.join(' | '), '| 重复(标签,页):', dup.length ? dup.join(',') : '无');
  const ok3 = s3.includes('御園莓華') && dup.length === 0;
  console.log('[场景3] 姓名入队且无重复抓取:', ok3, '\n');

  // 场景5（重名角色）：搜“莓华”时，另一个姓+同名“莓華”的角色（九條莓華）也要被搜到并呈现
  searched.length = 0;
  const r5 = await runSearch('莓华', [], 80);
  const s5 = [...new Set(searched.map((s) => s.split('@')[0]))];
  const t5 = new Set(r5.map((r) => r.title.split(' ')[0]));
  console.log('[场景5] 搜索标签:', s5.join(' | '));
  console.log('[场景5] 结果标签:', [...t5].join(' | '));
  const ok5 = s5.includes('九條莓華') && t5.has('九條莓華') && t5.has('御園莓華');
  console.log('[场景5] 同名角色全部呈现:', ok5, '\n');

  // 场景4：非人名搜索（长词/非中文）行为不变 —— 不加相关标签
  searched.length = 0;
  const r4 = await runSearch('白色相簿2', [], 10);
  const s4 = [...new Set(searched.map((s) => s.split('@')[0]))];
  console.log('[场景4] 搜索标签:', s4.join(' | '), '| 结果数:', r4.length);
  const ok4 = s4.length === 1 && s4[0] === '白色相簿2' && r4.length === 10;
  console.log('[场景4] 长词不扩展:', ok4, '\n');

  if (ok1 && ok2 && ok3 && ok4 && ok5) { console.log('PASS'); } else { console.error('FAIL'); process.exit(1); }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
