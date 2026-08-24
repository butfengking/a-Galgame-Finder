// 搜索模块：独立于 Electron，便于单独测试。
// fetchImpl 由调用方注入（Electron 主进程传 net.fetch，测试脚本传全局 fetch）。
const { parse } = require('node-html-parser');

const MAX_RESULTS = 30;
const SEARCH_TIMEOUT = 15000;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 常见 galgame 缩写/俗称 -> 全名列表（按顺序尝试；匹配时不区分大小写，并忽略空格/符号）。
// 每项可配多个写法（如英文全名 + 中文名），适配 VNDB/Steam/中文站等不同网站。
const ABBREVIATIONS = {
  cl: ['CLANNAD'],
  lb: ['Little Busters!'],
  lbex: ['Little Busters! EX'],
  kud: ['Kud Wafter'],
  rew: ['Rewrite'],
  fsn: ['Fate/stay night'],
  fha: ['Fate/hollow ataraxia'],
  fgo: ['Fate/Grand Order'],
  wa2: ['WHITE ALBUM 2', '白色相簿2'],
  th2: ['ToHeart2'],
  toheart2: ['ToHeart2'],
  muv: ['Muv-Luv'],
  muvluv: ['Muv-Luv'],
  mla: ['Muv-Luv Alternative'],
  ever17: ['Ever17 -the out of infinity-'],
  remember11: ['Remember11 -the age of infinity-'],
  's;g': ['STEINS;GATE', '命运石之门'],
  sg: ['STEINS;GATE'],
  'c;c': ['Chaos;Child'],
  'c;h': ['Chaos;Head'],
  'r;n': ['Robotics;Notes'],
  grisaia: ['Grisaia no Kajitsu'],
  katawa: ['Katawa Shoujo'],
  ef: ['ef - a fairy tale of the two'],
  sayanouta: ['Saya no Uta'],
  saya: ['Saya no Uta'],
  // 中文缩写 / 俗称
  白学: ['WHITE ALBUM 2', '白色相簿2'],
  白2: ['WHITE ALBUM 2', '白色相簿2'],
  白1: ['WHITE ALBUM', '白色相簿'],
  石头门: ['STEINS;GATE', '命运石之门'],
  命运石之门: ['STEINS;GATE'],
  罚抄: ['Rewrite'],
  素晴日: ['Subarashiki Hibi', '素晴らしき日々'],
  樱之诗: ['Sakura no Uta', 'サクラノ詩'],
  近月: ['Tsuki ni Yorisou Otome no Sahou', '近月少女的礼仪'],
  千恋万花: ['Senren Banka', '千恋＊万花'],
  缘之空: ['Yosuga no Sora', '緣之空'],
  月姬: ['Tsukihime', '月姫'],
  空境: ['Kara no Kyoukai', '空之境界'],
  空之境界: ['Kara no Kyoukai'],
  海猫: ['Umineko no Naku Koro ni', 'うみねこのなく頃に'],
  寒蝉: ['Higurashi no Naku Koro ni', 'ひぐらしのなく頃に'],
  魔夜: ['Mahoutsukai no Yoru', '魔法使いの夜'],
  沙耶之歌: ['Saya no Uta'],
  沙耶: ['Saya no Uta'],
  星白: ['星空列车与白的旅行', 'Hoshizora Tetsudou to Shiro no Tabi'],
  巧2: ['巧克甜恋2', 'Amairo Chocolata 2'],
  巧1: ['巧克甜恋', 'Amairo Chocolata'],
};

// 常见会社中文别称/简称 -> VNDB 规范名（用于识别会社；作品列表实时从 VNDB 获取）
const COMPANY_ALIASES = {
  'key社': 'Key',
  键社: 'Key',
  型月: 'TYPE-MOON',
  蘑菇社: 'TYPE-MOON',
  柚子社: 'Yuzusoft',
  ゆずソフト: 'Yuzusoft',
  八月社: 'AUGUST',
  八月: 'AUGUST',
  中二社: 'minori',
  巨乳社: 'minori',
  叶子社: 'Leaf',
  叶社: 'Leaf',
  雪碧社: 'Sprite',
  马戏团: 'CIRCUS',
  枕头社: 'Makura',
  戏画: 'GIGA',
  戯画: 'GIGA',
  调色板: 'Palette',
  大魔王: 'Alice Soft',
  软屋: 'soft-house chara',
  'N+': 'Nitroplus',
};

// 关键词是否命中会社别名词典；返回 VNDB 规范名或 null。
function resolveCompanyAlias(keyword) {
  const k = String(keyword || '').trim();
  if (!k) return null;
  if (Object.prototype.hasOwnProperty.call(COMPANY_ALIASES, k)) return COMPANY_ALIASES[k];
  const stripped = k.replace(/(社|会社|工作室|スタジオ|ソフト)$/i, '');
  if (stripped !== k && Object.prototype.hasOwnProperty.call(COMPANY_ALIASES, stripped)) {
    return COMPANY_ALIASES[stripped];
  }
  return null;
}

// 判断厂商搜索的榜首结果是否与关键词强相关（避免误触发）
function producerMatches(top, keyword) {
  const name = String((top && top.name) || '').toLowerCase();
  const aliasList = String((top && top.aliases) || '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  const k = String(keyword || '').trim().toLowerCase();
  if (!k) return false;
  if (name === k) return true;
  if (aliasList.includes(k)) return true;
  if (k.length >= 3 && (name.includes(k) || k.includes(name))) return true;
  return false;
}

// VNDB 厂商搜索：按名称/别名匹配，返回 {id, name, aliases} 列表。
async function vndbProducerSearch(keyword, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
  try {
    const res = await fetchImpl('https://api.vndb.org/kana/producer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'galgame-finder/1.0' },
      body: JSON.stringify({ filters: ['search', '=', keyword], fields: 'id, name, aliases', results: 8 }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.results || []).map((r) => ({ id: r.id, name: r.name, aliases: r.aliases || '' }));
  } finally {
    clearTimeout(timer);
  }
}

// VNDB 按厂商 ID 取作品（id 如 "p98"，去掉短横线）。
async function vndbWorksByProducer(producerId, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
  try {
    const res = await fetchImpl('https://api.vndb.org/kana/vn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'galgame-finder/1.0' },
      body: JSON.stringify({
        filters: ['developer', '=', ['id', '=', String(producerId).replace('-', '')]],
        fields: 'id, title, alttitle, aliases, image.url',
        results: 30,
        sort: 'rating',
        reverse: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.results || []).map((r) => ({
      id: r.id,
      title: r.title,
      alttitle: r.alttitle || '',
      aliases: Array.isArray(r.aliases) ? r.aliases.filter(Boolean) : [],
      url: 'https://vndb.org/' + r.id,
      image: (r.image && r.image.url) || null,
    }));
  } finally {
    clearTimeout(timer);
  }
}

// 标题归一化（用于同名匹配）
function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

// 判断某个网站结果标题是否为某作品的同款（标题/别名 归一化相等或互相包含）
function sameWork(resultTitle, workTitles) {
  const rt = normTitle(resultTitle);
  if (!rt) return false;
  for (const wt of workTitles || []) {
    const n = normTitle(wt);
    if (!n) continue;
    if (rt === n) return true;
    if (n.length >= 4 && (rt.includes(n) || n.includes(rt))) return true;
  }
  return false;
}

// 在普通网站上搜索某个作品：依次用 标题/别名 搜索，取通过同名校验的结果（最多 2 条）。
async function searchWorkOnHtmlSite(work, site, fetchImpl, limit) {
  const workTitles = [work.title, work.alttitle, ...(work.aliases || [])].filter((t) => t && String(t).trim());
  const candidates = [...new Set(workTitles)].slice(0, 4);
  for (const c of candidates) {
    try {
      const list = await fetchHtmlResults(c, site, fetchImpl, limit);
      const matches = list.filter((r) => sameWork(r.title, workTitles));
      if (matches.length) return matches.slice(0, 2).map((m) => ({ title: m.title, url: m.url }));
    } catch (e) {
      // 该写法失败则换下一个
    }
  }
  return [];
}

// 若关键词命中缩写词典，返回 { keyword, expanded, expansions }，否则返回 null。
function expandKeyword(keyword) {
  const k = String(keyword || '').trim().toLowerCase();
  if (!k) return null;
  const stripped = k.replace(/[\s\-_.\/\\:;()\[\]'"!?]/g, '');
  const candidates = [k, stripped];
  for (const c of candidates) {
    if (Object.prototype.hasOwnProperty.call(ABBREVIATIONS, c)) {
      const list = Array.isArray(ABBREVIATIONS[c]) ? ABBREVIATIONS[c] : [ABBREVIATIONS[c]];
      return { keyword: String(keyword).trim(), expanded: list[0], expansions: list };
    }
  }
  return null;
}

// 构造依次尝试的查询词：原词 -> 展开后的全名列表 -> 外部补充查询 -> 去空格符号后的形式。
function buildQueries(keyword, extraQueries) {
  const raw = String(keyword || '').trim();
  const qs = [raw];
  const exp = expandKeyword(raw);
  if (exp) {
    for (const e of exp.expansions) {
      if (e !== raw && !qs.includes(e)) qs.push(e);
    }
  }
  if (Array.isArray(extraQueries)) {
    for (const e of extraQueries) {
      if (e !== raw && !qs.includes(e)) qs.push(e);
    }
  }
  const stripped = raw.replace(/[\s,._\-/\\:;()\[\]'"!?]/g, '');
  if (stripped && !qs.includes(stripped)) qs.push(stripped);
  return qs.slice(0, 6);
}

// “拓展”站点：在关键词后追加 gal / 旮旯给木 / galgame / 二创 等词，用于在视频平台找二创
const EXPAND_SUFFIXES = ['gal', '旮旯给木', 'galgame', '二创', '旮旯给木二创'];

// 拓展查询：gal 后缀词排最前（优先找二创），原关键词放最后（仅补位，避免无关结果占满）
function buildExpandQueries(keyword, extraQueries) {
  const raw = String(keyword || '').trim();
  const qs = [];
  for (const suf of EXPAND_SUFFIXES) {
    qs.push(raw + suf);
  }
  if (Array.isArray(extraQueries)) {
    for (const e of extraQueries) {
      if (!qs.includes(e)) qs.push(e);
    }
  }
  qs.push(raw);
  return qs.slice(0, 8);
}

// 用标题索引做通用中文缩写解析：对含中文的短词（2-5 字），按“首字相同 + 字符按顺序出现（子序列）”匹配游戏标题，
// 返回命中最优的若干游戏的全名（各语言标题）作为展开查询词。
function matchAbbreviationsByIndex(keyword, games) {
  const kw = String(keyword || '').trim();
  if (kw.length < 2 || kw.length > 5) return [];
  if (!/[\u4e00-\u9fff]/.test(kw)) return []; // 仅处理含中文的短词
  const first = kw[0];
  const rest = kw.slice(1);
  const hits = [];
  for (const g of games || []) {
    for (const t of g.titles) {
      if (!t || t.length < kw.length) continue;
      if (t[0] !== first) continue;
      // 其余字符必须按顺序出现在标题中
      let pos = 0;
      let ok = true;
      let gap = 0;
      for (const ch of rest) {
        const idx = t.indexOf(ch, pos + 1);
        if (idx === -1) {
          ok = false;
          break;
        }
        gap += idx - pos - 1;
        pos = idx;
      }
      if (!ok) continue;
      const score = 10000 - gap * 10 - t.length;
      hits.push({ titles: g.titles, score });
      break; // 每个游戏只记一次
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const out = [];
  const seen = new Set();
  for (const h of hits.slice(0, 5)) {
    for (const t of h.titles) {
      if (!t || t === kw || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 4) break;
    }
    if (out.length >= 4) break;
  }
  return out;
}

// 用关键词替换网址模板中的占位符（{keyword} 或 {kw}）。
function buildUrl(template, keyword) {
  const kw = encodeURIComponent(keyword);
  let url = template;
  if (url.includes('{keyword}')) url = url.split('{keyword}').join(kw);
  else if (url.includes('{kw}')) url = url.split('{kw}').join(kw);
  return url;
}

// VNDB API 查询：支持翻页（API 单次上限 100，需要更多时按 page 翻页）
async function vndbQuery(keyword, fetchImpl, limit) {
  const want = limit || MAX_RESULTS;
  const perPage = Math.min(want, 100);
  const all = [];
  let page = 1;
  while (all.length < want) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
    let res;
    try {
      res = await fetchImpl('https://api.vndb.org/kana/vn', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'galgame-finder/1.0',
        },
        body: JSON.stringify({
          filters: ['search', '=', keyword],
          fields: 'id, title, alttitle, image.url',
          results: perPage,
          page,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      if (all.length) break; // 已有部分结果时容错返回
      throw new Error('HTTP ' + res.status);
    }
    const data = await res.json();
    const items = (data.results || []).map((r) => ({
      id: r.id,
      title: r.alttitle ? r.title + '（' + r.alttitle + '）' : r.title,
      alttitle: r.alttitle || '',
      url: 'https://vndb.org/' + r.id,
      image: (r.image && r.image.url) || null,
    }));
    if (!items.length) break;
    all.push(...items);
    page++;
  }
  return all.slice(0, want);
}

// 本地重排 VNDB 结果：标题精确/前缀/包含、以及首字母缩写匹配优先，避免缩写搜索时无关结果排前面。
function rankVndb(items, keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  const kwNorm = kw.replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  const initialsOf = (s) =>
    s
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('');
  return items
    .map((it) => {
      const t = (it.title || '').toLowerCase();
      const a = (it.alttitle || '').toLowerCase();
      const tNorm = t.replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
      const initials = initialsOf(t);
      let score = 0;
      if (kwNorm && tNorm === kwNorm) score = 100;
      else if (kwNorm && tNorm.startsWith(kwNorm)) score = 80;
      else if (kwNorm && tNorm.includes(kwNorm)) score = 60;
      if (kw && initials === kw) score = Math.max(score, 95); // 首字母缩写完全匹配，如 Little Busters! -> lb
      else if (kw && initials.startsWith(kw)) score = Math.max(score, 90);
      if (kw && t.includes(kw)) score = Math.max(score, 60);
      if (kw && a.includes(kw)) score = Math.max(score, 40);
      return { ...it, score };
    })
    .sort((x, y) => y.score - x.score);
}

// VNDB 搜索：按候选词依次查询（有结果即停止），合并去重后本地重排。
async function vndbSearch(keyword, fetchImpl, extraQueries, limit) {
  const queries = buildQueries(keyword, extraQueries);
  const merged = new Map();
  let lastErr = null;
  for (let i = 0; i < queries.length; i++) {
    if (i > 0 && merged.size > 0) break;
    try {
      const list = await vndbQuery(queries[i], fetchImpl, limit);
      for (const it of list) merged.set(it.id, it);
    } catch (e) {
      lastErr = e;
    }
  }
  if (!merged.size && lastErr) throw lastErr;
  return rankVndb([...merged.values()], keyword)
    .slice(0, limit || MAX_RESULTS)
    .map(({ score, ...it }) => it);
}

// 普通网页搜索：对候选词依次请求并合并去重；若存在展开词，则把标题命中展开词的结果排前面。
async function htmlSearch(keyword, site, fetchImpl, extraQueries, limit) {
  const queries = site.expand ? buildExpandQueries(keyword, extraQueries) : buildQueries(keyword, extraQueries);
  const cap = limit || MAX_RESULTS;
  const seen = new Set();
  const out = [];
  let lastErr = null;
  let gotAny = false;
  for (let i = 0; i < queries.length; i++) {
    let list = [];
    try {
      list = await fetchHtmlResults(queries[i], site, fetchImpl, limit);
      gotAny = gotAny || list.length > 0;
    } catch (e) {
      lastErr = e;
    }
    for (const it of list) {
      if (!seen.has(it.url)) {
        seen.add(it.url);
        out.push(it);
      }
    }
    if (out.length >= cap) break;
  }
  if (!out.length && lastErr && !gotAny) throw lastErr;

  // 有展开词时，标题包含任一展开词的结果排前面（让缩写目标置顶；拓展站点交给后续智能排序）
  if (!site.expand && queries.length > 1) {
    const lowers = queries.slice(1).map((q) => String(q).toLowerCase());
    for (const it of out) {
      const tl = String(it.title || '').toLowerCase();
      it._boost = lowers.some((q) => q.length >= 2 && tl.includes(q)) ? 1 : 0;
    }
    out.sort((a, b) => b._boost - a._boost);
  }

  // 拓展站点：抓取结果页（标题/简介/评论）与关键词比对，相似度高的排前面
  if (site.expand && out.length) {
    const scored = await scoreResultsByKeyword(out.slice(0, cap), keyword, fetchImpl);
    return scored.slice(0, cap);
  }
  return out.slice(0, cap).map(({ _boost, ...it }) => it);
}

// 抓取结果页的标题 / 简介 / 评论（Bilibili 视频页可拿到 aid，再取评论区）
async function fetchResultTexts(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
  let html;
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  let title = '';
  let desc = '';
  // Bilibili 视频页：从 __INITIAL_STATE__ 的 videoData 提取真实标题与简介
  if (/bilibili\.com\/video/i.test(url)) {
    const seg = html.indexOf('"videoData":{');
    if (seg !== -1) {
      const chunk = html.slice(seg, seg + 3000);
      const unescape = (raw) => {
        try {
          return JSON.parse('"' + raw + '"');
        } catch (e) {
          return raw;
        }
      };
      const mT = chunk.match(/"title":"((?:[^"\\]|\\.)*)"/);
      if (mT) title = unescape(mT[1]);
      const mD = chunk.match(/"desc":"((?:[^"\\]|\\.)*)"/);
      if (mD) desc = unescape(mD[1]);
    }
  }
  const mTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!title && mTitle) title = mTitle[1].trim();
  if (!desc) {
    const mDesc =
      html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i) ||
      html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i) ||
      html.match(/<meta[^>]+content="([^"]*)"[^>]+name="description"/i);
    if (mDesc) desc = mDesc[1];
  }

  let comments = '';
  if (/bilibili\.com/i.test(url)) {
    const aid = (html.match(/"aid":(\d+)/) || [])[1];
    if (aid) {
      try {
        const cr = await fetchImpl('https://api.bilibili.com/x/v2/reply?type=1&oid=' + aid + '&sort=2&ps=20', {
          headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
        });
        if (cr.ok) {
          const cj = await cr.json();
          const replies = (cj.data && cj.data.replies) || [];
          comments = replies.map((r) => (r.content && r.content.message) || '').join(' ');
        }
      } catch (e) {
        /* 评论抓取失败不影响结果 */
      }
    }
  }
  return { title, desc, comments };
}

// 关键词与（标题+简介+评论）的相似度：关键词出现的位置与次数加权
function computeSimilarity(keyword, texts) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return 1;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  const kwNorm = norm(kw);
  const title = String(texts.title || '').toLowerCase();
  const desc = String(texts.desc || '').toLowerCase();
  const comments = String(texts.comments || '').toLowerCase();
  let score = 1; // 保底，避免抓取失败时无法区分
  if (kwNorm && norm(title).includes(kwNorm)) score += 40;
  if (kwNorm && norm(desc).includes(kwNorm)) score += 25;
  if (kwNorm && norm(comments).includes(kwNorm)) score += 20;
  if (kw && title.includes(kw)) score += 15;
  if (kw && desc.includes(kw)) score += 10;
  if (kw && comments.includes(kw)) score += 8;
  return score;
}

async function scoreResultsByKeyword(results, keyword, fetchImpl) {
  const CONC = 4;
  const scored = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(CONC, results.length) }, async () => {
    while (idx < results.length) {
      const i = idx++;
      let score = 0;
      try {
        const texts = await fetchResultTexts(results[i].url, fetchImpl);
        score = computeSimilarity(keyword, texts);
      } catch (e) {
        score = 0;
      }
      scored.push({ ...results[i], _score: score });
    }
  });
  await Promise.all(workers);
  scored.sort((a, b) => b._score - a._score);
  return scored.map(({ _score, ...it }) => it);
}

async function fetchHtmlResults(keyword, site, fetchImpl, limit) {
  const url = buildUrl(site.url, keyword);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
  let html;
  try {
    const res = await fetchImpl(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }
  return extractResults(html, site, url, keyword, limit);
}

function cleanTitle(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

// 从元素提取标题：优先文本，其次 img 的 alt、元素的 title / aria-label 属性。
function titleOf(el) {
  let t = cleanTitle(el.text);
  if (!t) {
    const alt = el.getAttribute('alt') || (el.querySelector('img') && el.querySelector('img').getAttribute('alt'));
    if (alt) t = cleanTitle(alt);
    else {
      const attr = el.getAttribute('title') || el.getAttribute('aria-label');
      if (attr) t = cleanTitle(attr);
    }
  }
  return t;
}

function normalizeUrl(rawHref, baseUrl) {
  if (!rawHref) return null;
  const href = String(rawHref).trim();
  if (/^(javascript:|#|mailto:|tel:|data:)/i.test(href)) return null;
  let abs;
  try {
    abs = new URL(href, baseUrl).toString();
  } catch (e) {
    return null;
  }
  if (!/^https?:\/\//i.test(abs)) return null;
  return abs;
}

// 从结果元素中提取缩略图：依次尝试 src / srcset / data-src，过滤占位图。
function extractImage(el, pageUrl) {
  const img = el.querySelector('img');
  if (!img) return null;
  let src = img.getAttribute('src') || img.getAttribute('data-src') || '';
  if (!src || src.length < 10) {
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    const first = (String(srcset).split(',')[0] || '').trim().split(/\s+/)[0];
    if (first) src = first;
  }
  if (!src) return null;
  if (/data:image|1x1|blank|placeholder|pixel/i.test(src) && src.length < 60) return null;
  return normalizeUrl(src, pageUrl);
}

// 从 HTML 中提取结果。site.selector 存在时用选择器精确提取，否则用通用启发式。
function extractResults(html, site, pageUrl, keyword, limit) {
  const cap = limit || MAX_RESULTS;
  let root;
  try {
    root = parse(html);
  } catch (e) {
    return [];
  }
  root.querySelectorAll('script, style, noscript, nav, header, footer, iframe').forEach((n) => {
    try {
      n.remove();
    } catch (e) {
      /* ignore */
    }
  });

  const kw = (keyword || '').toLowerCase();

  if (site.selector) {
    const out = [];
    const seen = new Set();
    let els = [];
    try {
      els = root.querySelectorAll(site.selector);
    } catch (e) {
      els = [];
    }
    for (const el of els) {
      let title = '';
      let href = el.getAttribute('href');
      if (site.titleSelector) {
        const t = el.querySelector(site.titleSelector);
        if (t) title = titleOf(t);
      }
      if (!title) title = titleOf(el);
      if (!href) {
        const a = el.querySelector('a');
        if (a) href = a.getAttribute('href');
      }
      const abs = normalizeUrl(href, pageUrl);
      if (!abs) continue;
      if (title.length < 2 || title.length > 200) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push({ title, url: abs, image: extractImage(el, pageUrl) });
      if (out.length >= cap) break;
    }
    return out;
  }

  // 通用启发式：收集所有链接，打分排序。
  const candidates = [];
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href');
    const title = cleanTitle(a.text);
    const abs = normalizeUrl(href, pageUrl);
    if (!abs) continue;
    if (title.length < 2 || title.length > 200) continue;
    let score = 0;
    const tl = title.toLowerCase();
    if (kw && tl.includes(kw)) score += 3;
    if (kw && (abs.toLowerCase().includes(kw) || abs.toLowerCase().includes(encodeURIComponent(keyword)))) score += 1;
    if (title.length <= 80) score += 1;
    if (/^(首页|搜索|登录|注册|下一页|上一页|更多|关于|帮助|下载客户端|登录注册|sign ?in|log ?in|register|next|prev|home|search)$/i.test(title)) score -= 5;
    candidates.push({ title, url: abs, score, image: extractImage(a, pageUrl) });
  }
  candidates.sort((x, y) => y.score - x.score);
  const out = [];
  const seen = new Set();
  for (const c of candidates) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push({ title: c.title, url: c.url, image: c.image });
    if (out.length >= cap) break;
  }
  return out;
}

module.exports = {
  MAX_RESULTS,
  SEARCH_TIMEOUT,
  BROWSER_UA,
  ABBREVIATIONS,
  COMPANY_ALIASES,
  expandKeyword,
  buildQueries,
  buildExpandQueries,
  buildUrl,
  fetchResultTexts,
  computeSimilarity,
  matchAbbreviationsByIndex,
  resolveCompanyAlias,
  producerMatches,
  vndbProducerSearch,
  vndbWorksByProducer,
  sameWork,
  normTitle,
  searchWorkOnHtmlSite,
  fetchHtmlResults,
  vndbQuery,
  rankVndb,
  vndbSearch,
  htmlSearch,
  extractResults,
};
