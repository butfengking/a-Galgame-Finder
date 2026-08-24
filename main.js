// 启动依赖完整性检查：git pull 更新后新增了软件包时自动 npm install 补齐，避免无法启动（打包版自动跳过）
require('./ensure-deps').ensureDependencies();

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { tify, sify } = require('chinese-conv'); // 简繁转换
const {
  vndbSearch,
  htmlSearch,
  expandKeyword,
  matchAbbreviationsByIndex,
  resolveCompanyAlias,
  producerMatches,
  vndbProducerSearch,
  vndbWorksByProducer,
  normTitle,
  searchWorkOnHtmlSite,
  BROWSER_UA,
} = require('./search');

const DEFAULT_SITES = [
  {
    id: 'vndb',
    name: 'VNDB（视觉小说数据库）',
    type: 'vndb',
    url: '',
    selector: '',
    titleSelector: '',
    category: '游戏',
    enabled: true,
    builtin: true,
  },
  {
    id: 'steam',
    name: 'Steam 商店',
    type: 'html',
    url: 'https://store.steampowered.com/search/?term={keyword}&l=schinese',
    selector: 'a.search_result_row',
    titleSelector: '.title',
    category: '游戏',
    enabled: true,
    builtin: true,
  },
  {
    id: 'shionlib',
    name: '书音的图书馆（shionlib）',
    type: 'html',
    url: 'https://shionlib.com/zh/search/game?q={keyword}',
    selector: '.game-grid a[href^="/zh/game/"]',
    titleSelector: 'img',
    category: '游戏',
    enabled: true,
    builtin: true,
  },
  {
    id: 'bilibili',
    name: '哔哩哔哩（视频·拓展）',
    type: 'html',
    url: 'https://search.bilibili.com/all?keyword={keyword}',
    selector: '.bili-video-card a[href*="/video/BV"]',
    titleSelector: 'img',
    expand: true, // 拓展：搜索时自动追加 gal/旮旯给木/galgame/二创 等词，并抓标题/简介/评论排序
    category: '视频',
    enabled: false,
    builtin: true,
  },
  {
    id: 'wallpaper',
    name: 'Wallpaper Engine 壁纸',
    type: 'wallpaper', // 本地壁纸索引 + 公开创意工坊搜索（无需登录）
    url: '',
    selector: '',
    titleSelector: '',
    category: '壁纸',
    enabled: false,
    builtin: true,
  },
  {
    id: 'pixiv',
    name: 'Pixiv 插画',
    type: 'pixiv', // 需登录 Pixiv（应用内登录，保存 PHPSESSID）
    url: '',
    selector: '',
    titleSelector: '',
    category: '图片',
    enabled: false,
    builtin: true,
  },
];

const SETTINGS_VERSION = 4;

const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  theme: 'light', // 'light' | 'dark'
  panelOpacity: 0.85, // 面板透明度 0.3 ~ 1
  resultLimit: 10, // 每个搜索源最多返回的结果数
  downloadDir: '', // 全局下载目录；留空则用系统“下载”文件夹
  personMode: false, // 人名搜索开关：自动展开 姓/名/姓名 变体（所有网站生效，Pixiv 另显示人物选择器）
  proxy: { enabled: false, type: 'http', host: '127.0.0.1', port: 7890 }, // 仅 Pixiv 域名走代理
  background: {
    mode: 'color', // 'color' | 'image' | 'video'
    color: '#e9edf3',
    image: '', // appbg:// URL（图片/GIF）
    video: '', // appbg:// URL（视频）
    filename: '',
    overlay: 0.9, // 遮罩深浅默认 90%，深色模式下背景不会过亮
  },
};

// 自定义协议，用于安全地读取用户数据目录里的背景图片。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'appbg',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
  {
    scheme: 'wpimg', // 本地 Wallpaper Engine 壁纸预览图
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
  {
    scheme: 'piximg', // Pixiv 图片代理（带登录 Cookie + Referer）
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
]);

function dataDir() {
  return app.getPath('userData');
}

function sitesFile() {
  return path.join(dataDir(), 'sites.json');
}

function settingsFile() {
  return path.join(dataDir(), 'settings.json');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function loadSites() {
  const data = readJson(sitesFile(), null);
  if (!data || !Array.isArray(data.sites)) return DEFAULT_SITES.map((s) => ({ ...s }));
  // 确保内置站点始终存在（即使旧数据缺失），同时保留用户自定义站点。
  const map = new Map();
  for (const s of data.sites) map.set(s.id, s);
  const builtin = DEFAULT_SITES.map((s) => ({ ...s, ...(map.get(s.id) || {}) }));
  const custom = data.sites
    .filter((s) => !s.builtin)
    .map((s) => ({
      ...s,
      category: s.category ? String(s.category).trim() || '未分类' : '游戏',
    }));
  return [...builtin, ...custom];
}

function saveSites(sites) {
  writeJson(sitesFile(), { sites });
  return sites;
}

function loadSettings() {
  const data = readJson(settingsFile(), null);
  const merged = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (data && data.background) {
    if (data.version === SETTINGS_VERSION) {
      // 当前版本：完全尊重已保存的设置（含用户改过的遮罩强度）
      merged.background = { ...merged.background, ...data.background };
      if (data.theme) merged.theme = data.theme;
      if (typeof data.panelOpacity === 'number') merged.panelOpacity = data.panelOpacity;
      if (typeof data.resultLimit === 'number') merged.resultLimit = data.resultLimit;
      if (typeof data.downloadDir === 'string') merged.downloadDir = data.downloadDir;
      if (typeof data.personMode === 'boolean') merged.personMode = data.personMode;
      if (data.proxy && typeof data.proxy === 'object') merged.proxy = { ...merged.proxy, ...data.proxy };
    } else if (data.version === 2 || data.version === 3) {
      // 旧版本迁移：仅此一次把过浅的遮罩默认修正为 90%，其余保留
      merged.background = { ...merged.background, ...data.background };
      if (data.theme) merged.theme = data.theme;
      if (typeof data.panelOpacity === 'number') merged.panelOpacity = data.panelOpacity;
      if (typeof data.resultLimit === 'number') merged.resultLimit = data.resultLimit;
      if (typeof data.downloadDir === 'string') merged.downloadDir = data.downloadDir;
      if (data.proxy && typeof data.proxy === 'object') merged.proxy = { ...merged.proxy, ...data.proxy };
      merged.background.overlay = DEFAULT_SETTINGS.background.overlay;
    } else {
      // 更旧的版本：保留背景图片，颜色/遮罩/主题按新默认（浅色）重置
      merged.background.image = data.background.image || '';
      merged.background.filename = data.background.filename || '';
      if (data.background.mode === 'image' && data.background.image) {
        merged.background.mode = 'image';
      }
    }
  }
  merged.version = SETTINGS_VERSION;
  return merged;
}

function saveSettings(settings) {
  writeJson(settingsFile(), settings);
  return settings;
}

function genId() {
  return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// 规范化 HTML 站搜索网址：已有 {keyword} 直接用；否则用“示例关键词”自动替换。
function normalizeHtmlUrl(url, exampleKeyword) {
  url = String(url || '').trim();
  if (!url) throw new Error('请填写搜索网址');
  if (!/^https?:\/\//i.test(url)) throw new Error('搜索网址需以 http:// 或 https:// 开头');
  if (url.includes('{keyword}') || url.includes('{kw}')) return url;
  const ex = String(exampleKeyword || '').trim();
  if (!ex) throw new Error('网址中没有 {keyword} 占位符。请填写“示例关键词”（即网址里试搜用的那个词），保存时会自动替换为 {keyword}');
  const enc = encodeURIComponent(ex);
  let newUrl = url;
  if (newUrl.includes(enc)) {
    newUrl = newUrl.split(enc).join('{keyword}');
  } else {
    const idx = newUrl.toLowerCase().indexOf(ex.toLowerCase());
    if (idx === -1) throw new Error('在网址中找不到示例关键词“' + ex + '”，请确认填写正确');
    newUrl = newUrl.slice(0, idx) + '{keyword}' + newUrl.slice(idx + ex.length);
  }
  return newUrl;
}

function validateSite(s) {
  const name = String(s.name || '').trim();
  if (!name) throw new Error('请填写网站名称');
  const type = s.type === 'vndb' ? 'vndb' : 'html';
  const url = type === 'html' ? normalizeHtmlUrl(s.url, s.exampleKeyword) : String(s.url || '').trim();
  return {
    id: genId(),
    name,
    type,
    url,
    selector: String(s.selector || '').trim(),
    titleSelector: String(s.titleSelector || '').trim(),
    expand: !!s.expand,
    category: String(s.category || '游戏').trim() || '游戏',
    enabled: s.enabled !== false,
    builtin: false,
  };
}

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
};

const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov']);

function mimeOf(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function registerAppBgProtocol() {
  protocol.handle('appbg', (request) => {
    const dir = path.join(dataDir(), 'backgrounds');
    let rel;
    try {
      rel = decodeURIComponent(new URL(request.url).pathname).replace(/^[/\\]+/, '');
    } catch (e) {
      return new Response('bad request', { status: 400 });
    }
    const filePath = path.normalize(path.join(dir, rel));
    if (!filePath.startsWith(path.normalize(dir))) return new Response('forbidden', { status: 403 });
    try {
      const data = fs.readFileSync(filePath);
      return new Response(data, { headers: { 'Content-Type': mimeOf(filePath) } });
    } catch (e) {
      return new Response('not found', { status: 404 });
    }
  });
}

// ---------- Wallpaper Engine 本地壁纸 ----------
let wallpapersCache = null; // { root, items: [{id, dir, title, tags, preview}] }

function getWallpapersRoot() {
  try {
    const out = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', { encoding: 'utf8' });
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/);
    if (m) {
      const sp = m[1].trim().replace(/\\\\/g, '\\').replace(/\\+$/, '');
      const root = path.join(sp, 'steamapps', 'workshop', 'content', '431960');
      if (fs.existsSync(root)) return root;
    }
  } catch (e) {
    /* ignore */
  }
  for (const c of ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'D:\\Steam', 'E:\\Steam', 'D:\\SteamLibrary', 'E:\\SteamLibrary']) {
    const root = path.join(c, 'steamapps', 'workshop', 'content', '431960');
    if (fs.existsSync(root)) return root;
  }
  return null;
}

function loadWallpapersIndex() {
  if (wallpapersCache) return wallpapersCache;
  const root = getWallpapersRoot();
  if (!root) {
    wallpapersCache = { root: null, items: [] };
    return wallpapersCache;
  }
  const items = [];
  try {
    for (const id of fs.readdirSync(root)) {
      const dir = path.join(root, id);
      if (!fs.statSync(dir).isDirectory()) continue;
      const pj = path.join(dir, 'project.json');
      if (!fs.existsSync(pj)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(pj, 'utf8'));
        let preview = (j.preview && String(j.preview).replace(/^.*[\\/]/, '')) || '';
        if (preview && !fs.existsSync(path.join(dir, preview))) preview = '';
        if (!preview) {
          const found = ['preview.jpg', 'preview.png', 'preview.gif', 'preview.webp'].find((f) => fs.existsSync(path.join(dir, f)));
          if (found) preview = found;
        }
        items.push({
          id,
          dir,
          title: j.title || id,
          tags: Array.isArray(j.tags) ? j.tags.map((t) => (t && t.value) || '').filter(Boolean) : [],
          preview,
        });
      } catch (e) {
        /* ignore */
      }
    }
  } catch (e) {
    /* ignore */
  }
  wallpapersCache = { root, items };
  return wallpapersCache;
}

function searchLocalWallpapers(keyword, extra, limit) {
  const idx = loadWallpapersIndex();
  if (!idx || !idx.items.length) return [];
  const terms = [String(keyword || ''), ...(extra || [])].map((t) => String(t).trim().toLowerCase()).filter((t) => t.length >= 2);
  const out = [];
  for (const it of idx.items) {
    const hay = (it.title + ' ' + it.tags.join(' ')).toLowerCase();
    if (terms.some((t) => hay.includes(t))) {
      out.push({
        title: it.title,
        url: 'file://' + it.dir.replace(/\\/g, '/'),
        image: it.preview ? 'wpimg://wallpaper/' + it.id + '?f=' + encodeURIComponent(it.preview) : null,
      });
    }
    if (out.length >= limit) break;
  }
  return out;
}

// 本地壁纸 + 公开创意工坊搜索（无需登录；工坊抓取失败时仅返回本地结果）
async function wallpaperSearch(keyword, fetchImpl, extra, limit) {
  const cap = limit || 10;
  const local = searchLocalWallpapers(keyword, extra, cap);
  let online = [];
  try {
    const workshopSite = {
      url: 'https://steamcommunity.com/workshop/browse/?appid=431960&searchtext={keyword}&browsesort=textsearch&actualsort=textsearch&p=1',
      selector: 'a[href*="sharedfiles/filedetails"]',
      titleSelector: 'img',
    };
    online = await htmlSearch(keyword, workshopSite, fetchImpl, extra, cap);
  } catch (e) {
    /* 工坊不可用时忽略 */
  }
  return [...local, ...online].slice(0, cap);
}

function registerWpImgProtocol() {
  protocol.handle('wpimg', (request) => {
    try {
      const url = new URL(request.url);
      const id = url.pathname.replace(/^\/+/, '');
      const f = url.searchParams.get('f') || '';
      const idx = loadWallpapersIndex();
      if (!idx || !idx.root) return new Response('no index', { status: 404 });
      const filePath = path.normalize(path.join(idx.root, id, f));
      if (!filePath.startsWith(path.normalize(idx.root))) return new Response('forbidden', { status: 403 });
      const data = fs.readFileSync(filePath);
      return new Response(data, { headers: { 'Content-Type': mimeOf(filePath) } });
    } catch (e) {
      return new Response('bad request', { status: 400 });
    }
  });
}

// ---------- Pixiv（需登录） ----------
function pixivCookieFile() {
  return path.join(dataDir(), 'pixiv-session.json');
}

function readPixivCookie() {
  const data = readJson(pixivCookieFile(), null);
  return data && data.phpsessid ? data.phpsessid : null;
}

function savePixivCookie(phpsessid) {
  writeJson(pixivCookieFile(), { phpsessid, savedAt: Date.now() });
}

function clearPixivCookie() {
  try {
    fs.unlinkSync(pixivCookieFile());
  } catch (e) {
    /* ignore */
  }
}

// Pixiv 搜索：官方 ajax 接口（需 PHPSESSID + Referer），翻页拉满到上限
// 人名搜索候选词：原词 + 缩写/索引展开（最多递归两层）+ 简体/繁体变体（去重，最多 6 个）
function personCandidates(keyword, extra) {
  const raw = String(keyword || '').trim();
  const out = [raw];
  const seen = new Set([raw]);
  const push = (s) => {
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  };
  const walk = (word, depth) => {
    if (depth > 2) return;
    const exp = expandKeyword(word);
    if (exp) {
      for (const e of exp.expansions) {
        push(e);
        walk(e, depth + 1);
      }
    }
  };
  walk(raw, 0);
  for (const e of extra || []) push(e);
  if (/[\u4e00-\u9fff]/.test(raw)) {
    const t = tify(raw);
    const s = sify(raw);
    push(t);
    push(s);
  }
  return out.slice(0, 6);
}

// 多关键词（分号分隔）Pixiv 搜索：每个关键词展开 缩写/简繁 变体，取变体组合（AND）逐个搜索，
// 按作品去重合并 —— 搜 莓华；巧克甜恋 只命中该游戏的角色，不会搜错同名角色
async function pixivMultiTagSearch(parts, fetchImpl, limit) {
  const cookie = readPixivCookie();
  if (!cookie) throw new Error('未登录 Pixiv：请在左侧 Pixiv 行点“登录”完成登录后再搜索');
  const cap = Math.max(1, Math.min(300, Number(limit) || 10));
  const variants = parts.map((p) => personCandidates(p, []));
  // 变体组合（笛卡尔积，最多 8 个组合，原文组合优先）
  const combos = [];
  const gen = (idx, cur) => {
    if (combos.length >= 8) return;
    if (idx === variants.length) {
      const s = cur.join(' ').trim();
      if (s) combos.push(s);
      return;
    }
    for (const v of variants[idx]) gen(idx + 1, [...cur, v]);
  };
  gen(0, []);

  const results = [];
  const seen = new Set();
  const headers = {
    'User-Agent': BROWSER_UA,
    Referer: 'https://www.pixiv.net/',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Cookie: 'PHPSESSID=' + cookie,
  };
  for (const combo of combos) {
    if (results.length >= cap) break;
    const enc = encodeURIComponent(combo);
    for (let p = 1; p <= 5 && results.length < cap; p++) {
      const url =
        'https://www.pixiv.net/ajax/search/artworks/' +
        enc +
        '?word=' +
        enc +
        '&order=date_d&mode=all&p=' +
        p +
        '&s_mode=s_tag_full&type=all&lang=zh';
      const res = await fetchImpl(url, { headers });
      if (!res.ok) {
        if (results.length) break; // 已有结果时容错返回
        throw new Error('Pixiv HTTP ' + res.status);
      }
      const data = await res.json();
      if (data.error) {
        if (results.length) break;
        throw new Error(data.message || 'Pixiv 搜索失败');
      }
      const items = (data.body && data.body.illustManga && data.body.illustManga.data) || [];
      if (!items.length) break;
      for (const it of items) {
        if (results.length >= cap) break;
        const u = 'https://www.pixiv.net/artworks/' + it.id;
        if (seen.has(u)) continue;
        seen.add(u);
        results.push({
          title: it.title,
          url: u,
          image: it.url ? 'piximg://img/' + encodeURIComponent(it.url) : null,
        });
      }
    }
  }
  return { items: results, tags: [] };
}

async function pixivSearch(keyword, fetchImpl, extra, limit, refine, personMode) {
  const cookie = readPixivCookie();
  if (!cookie) throw new Error('未登录 Pixiv：请在左侧 Pixiv 行点“登录”完成登录后再搜索');
  const cap = limit || 10;
  const raw = String(keyword || '').trim();
  // 候选查询：原词 + 缩写/全称展开 + 索引展开（覆盖 缩写/全称/日英中/繁简 变体）
  const candidates = personCandidates(raw, extra);

  // 人名搜索：因为人名分 姓/名，搜姓或名时 Pixiv 会返回“相关标签”（如搜 莓华 → 御園莓華）。
  // 由搜索框下方的“人名搜索”复选框手动开启（personMode），不再自动识别 —— 勾选后：
  // 把包含该名/姓片段的完整人名标签加入队列，按配额轮流呈现 名/姓/姓名，再补满上限。
  // 未勾选时不做任何相关标签扩展（不弹人物选择器）。
  // 公司/系列后缀标记：相关标签以此结尾（柚子社、電撃文庫 等）判定为系列/公司，不进人名队列
  const NAME_MARKER_RE =
    /(社|屋|組|组|団|团|部|会|祭|展|協会|协会|委員会|委员会|製作|制作|工房|工坊|文庫|文库|書店|书店|ワークス|Works|works|スタジオ|Studio|studio|プロダクション|Production|production|同好会|同人誌)$/;
  const results = [];
  const nameTags = []; // 人物选择器候选：所有从相关标签扩展出来的完整人名
  const queued = new Set(candidates);
  const queue = candidates.slice();
  const perTagCount = new Map(); // 标签 -> 已贡献结果数
  const pageDone = new Map(); // 标签 -> 已抓页数

  const fetchPage = async (q, page) => {
    const enc = encodeURIComponent(q);
    const url =
      'https://www.pixiv.net/ajax/search/artworks/' +
      enc +
      '?word=' +
      enc +
      '&order=date_d&mode=all&p=' +
      page +
      '&s_mode=s_tag_full&type=all&lang=zh';
    const res = await fetchImpl(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Referer: 'https://www.pixiv.net/',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Cookie: 'PHPSESSID=' + cookie,
      },
    });
    if (!res.ok) {
      pageDone.set(q, page); // 失败页也标记，避免反复重试
      if (results.length) return {};
      throw new Error('Pixiv HTTP ' + res.status);
    }
    const data = await res.json();
    if (data.error) {
      pageDone.set(q, page);
      if (results.length) return {};
      throw new Error(data.message || 'Pixiv 搜索失败');
    }
    pageDone.set(q, page);
    return data.body || {};
  };
  const pushItems = (q, items) => {
    for (const it of items) {
      if (results.length >= cap) break;
      perTagCount.set(q, (perTagCount.get(q) || 0) + 1);
      results.push({
        title: it.title,
        url: 'https://www.pixiv.net/artworks/' + it.id,
        image: it.url ? 'piximg://img/' + encodeURIComponent(it.url) : null,
      });
    }
  };

  // 精确人物搜索：用户从“人物”选择器勾选了若干完整人名标签，只搜这些标签（不做相关标签扩展）。
  // 单选：该人物的作品不受配额限制全部取；多选：按配额轮流，保证每个勾选的人物都呈现。
  if (refine) {
    const tags = (Array.isArray(refine) ? refine : [raw]).map((t) => String(t || '').trim()).filter(Boolean);
    if (tags.length > 1) {
      const quota = Math.max(2, Math.floor(cap / tags.length));
      for (let qi = 0; qi < tags.length && results.length < cap; qi++) {
        const tag = tags[qi];
        for (let p = 1; p <= 5 && results.length < cap; p++) {
          if ((perTagCount.get(tag) || 0) >= quota) break;
          const body = await fetchPage(tag, p);
          const items = (body.illustManga && body.illustManga.data) || [];
          if (!items.length) break;
          const room = quota - (perTagCount.get(tag) || 0);
          if (room > 0) pushItems(tag, items.slice(0, room));
        }
      }
      // 补足剩余上限
      if (results.length < cap) {
        for (const tag of tags) {
          if (results.length >= cap) break;
          for (let p = (pageDone.get(tag) || 0) + 1; p <= 5 && results.length < cap; p++) {
            const body = await fetchPage(tag, p);
            const items = (body.illustManga && body.illustManga.data) || [];
            if (!items.length) break;
            pushItems(tag, items);
          }
        }
      }
    } else {
      const tag = tags[0];
      for (let p = 1; p <= 5 && results.length < cap; p++) {
        const body = await fetchPage(tag, p);
        const items = (body.illustManga && body.illustManga.data) || [];
        if (!items.length) break;
        pushItems(tag, items);
      }
    }
    return { items: results, tags: [] };
  }

  // 原词第 1 页：决定是否人名模式。
  // 同名角色很多，所以不“猜”是哪一个人：只要相关标签里包含该名/姓片段的完整人名
  // （如 御園莓華、○○莓華），全部加入队列一起搜，所有同名角色的作品都会呈现。
  let nameMode = false;
  let quota = 0;
  const variants = [...new Set([raw, tify(raw), sify(raw)].filter(Boolean))];
  const rawBody = await fetchPage(raw, 1);
  if (personMode && Array.isArray(rawBody.relatedTags)) {
    const relevant = rawBody.relatedTags.filter(
      (rt) =>
        typeof rt === 'string' &&
        rt !== raw &&
        !NAME_MARKER_RE.test(rt) &&
        variants.some((v) => rt.length > v.length && rt.includes(v))
    );
    // 手动开启人名搜索：不做自动识别（不设长度/结果量闸门），只过滤系列/公司后缀
    if (relevant.length) {
      nameMode = true;
      quota = Math.max(2, Math.floor(cap / Math.max(2, relevant.length + 1)));
      for (const rt of relevant) {
        if (!queued.has(rt)) {
          queued.add(rt);
          queue.push(rt);
          nameTags.push(rt);
        }
      }
    }
  }
  const rawItems = (rawBody.illustManga && rawBody.illustManga.data) || [];
  if (nameMode) pushItems(raw, rawItems.slice(0, quota)); // 人名模式：原词也受配额约束，防止占满上限饿死其他姓名变体
  else pushItems(raw, rawItems);

  // 阶段1：每人名变体按配额贡献结果（保证 名/姓/姓名 都呈现）；阶段2：补满上限
  let phase = 1;
  while (results.length < cap) {
    let progressed = false;
    for (let qi = 0; qi < queue.length && results.length < cap; qi++) {
      const q = queue[qi];
      if (phase === 1 && nameMode && (perTagCount.get(q) || 0) >= quota) continue;
      const startPage = (pageDone.get(q) || 0) + 1;
      for (let p = startPage; p <= 5 && results.length < cap; p++) {
        if (phase === 1 && nameMode && (perTagCount.get(q) || 0) >= quota) break;
        const body = await fetchPage(q, p);
        progressed = true;
        // 同名角色广度扩展：人名模式下，每个标签第 1 页的相关标签里，
        // 凡包含原名/姓片段的完整人名（重名角色）都继续加入队列，直至找全或达上限
        if (nameMode && p === 1 && Array.isArray(body.relatedTags)) {
          for (const rt of body.relatedTags) {
            if (typeof rt !== 'string' || !rt || queued.has(rt)) continue;
            if (queue.length >= 40) break;
            if (NAME_MARKER_RE.test(rt)) continue; // 系列/公司后缀，不是人名
            if (variants.some((v) => rt.length > v.length && rt.includes(v))) {
              queued.add(rt);
              queue.push(rt);
              nameTags.push(rt);
            }
          }
        }
        const items = (body.illustManga && body.illustManga.data) || [];
        if (!items.length) break;
        if (phase === 1 && nameMode) {
          const room = quota - (perTagCount.get(q) || 0);
          if (room > 0) pushItems(q, items.slice(0, room));
        } else {
          pushItems(q, items);
        }
      }
    }
    if (results.length >= cap) break;
    if (!progressed) {
      if (phase === 1 && nameMode) {
        phase = 2; // 配额阶段完成，进入补足阶段
        continue;
      }
      break;
    }
  }
  return { items: results.slice(0, cap), tags: nameTags };
}

// Pixiv 图片代理：带登录 Cookie + Referer 抓取 i.pximg.net
function registerPixImgProtocol() {
  protocol.handle('piximg', async (request) => {
    try {
      const encoded = new URL(request.url).pathname.replace(/^\/img\//, '');
      const target = decodeURIComponent(encoded);
      const cookie = readPixivCookie();
      const res = await net.fetch(target, {
        headers: {
          'User-Agent': BROWSER_UA,
          Referer: 'https://www.pixiv.net/',
          Cookie: cookie ? 'PHPSESSID=' + cookie : '',
        },
      });
      if (!res.ok) return new Response('fetch failed', { status: 502 });
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get('content-type') || 'image/jpeg';
      return new Response(buf, { headers: { 'Content-Type': ct } });
    } catch (e) {
      return new Response('bad request', { status: 400 });
    }
  });
}

// 登录窗口：用户登录后自动捕获 PHPSESSID 并保存
ipcMain.handle('pixiv:login', () => {
  if (readPixivCookie()) return Promise.resolve({ ok: true, already: true });
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1000,
      height: 720,
      title: '登录 Pixiv',
      autoHideMenuBar: true,
    });
    win.loadURL('https://accounts.pixiv.net/login?lang=zh&source=pc&view_type=page&ref=wwwtop_accounts_index');
    let finished = false;
    const finish = (ok) => {
      if (!finished) {
        finished = true;
        resolve({ ok });
      }
    };
    const check = async () => {
      if (finished) return;
      try {
        const cookies = await win.webContents.session.cookies.get({ url: 'https://www.pixiv.net/' });
        const ph = cookies.find((c) => c.name === 'PHPSESSID' && c.value);
        if (ph) {
          savePixivCookie(ph.value);
          win.close();
          finish(true);
          return;
        }
      } catch (e) {
        /* ignore */
      }
      setTimeout(check, 2000);
    };
    check();
    win.on('closed', () => finish(false));
  });
});

ipcMain.handle('pixiv:status', () => {
  return { loggedIn: !!readPixivCookie() };
});

ipcMain.handle('pixiv:logout', () => {
  clearPixivCookie();
  return { loggedIn: false };
});

// 在应用内打开作品页（共享登录会话），并注入“下载全部”工具条（轮询等待作品 ID，下载走主进程最稳）
ipcMain.handle('open-in-app', (e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '查看作品',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL(url);
  const inject = () => {
    const code = `
      (async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const makeBar = (text, btnText, onBtn) => {
          const bar = document.createElement('div');
          bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:rgba(20,30,40,.92);color:#fff;padding:8px 14px;font:13px sans-serif;display:flex;gap:12px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.3);';
          const t = document.createElement('span');
          t.textContent = text;
          t.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
          bar.appendChild(t);
          if (onBtn) {
            const b = document.createElement('button');
            b.textContent = btnText;
            b.style.cssText = 'background:#3b82f6;color:#fff;border:none;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:13px;flex-shrink:0;';
            b.onclick = async () => {
              if (b.disabled) return;
              b.disabled = true;
              b.textContent = '下载中…';
              try {
                const res = await window.api.downloadPixivById({ id });
                if (res && res.ok) b.textContent = '已保存 ' + res.files.length + ' 张：' + res.files[0];
                else b.textContent = '失败：' + ((res && res.message) || '未知错误');
              } catch (err) {
                b.textContent = '下载失败';
              }
              b.disabled = false;
            };
            bar.appendChild(b);
          }
          document.body.appendChild(bar);
        };
        let id = null;
        for (let i = 0; i < 20; i++) {
          const m = location.href.match(/artworks\\/(\\d+)/);
          if (m) { id = m[1]; break; }
          await sleep(1000);
        }
        if (!id) { makeBar('未识别到 Pixiv 作品页'); return; }
        makeBar('Pixiv 作品 #' + id + '（原图将保存到下载目录）', '下载全部', true);
      })();
    `;
    win.webContents.executeJavaScript(code).catch(() => {});
  };
  win.webContents.on('dom-ready', inject);
  win.webContents.on('did-finish-load', inject);
  return { ok: true };
});

// 把任意 Pixiv 图片地址规整为原图（img-original）地址；无法规整则返回 null
function toPixivOriginal(u) {
  if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return null;
  let s = u;
  // 去掉 c/<尺寸>/ 前缀（缩略图/中等图路径）
  s = s.replace(/^https?:\/\/i\.pximg\.net\/c\/[^/]+\//i, 'https://i.pximg.net/');
  // 中等图 -> 原图：img-master -> img-original，去掉 _masterNNNN 后缀
  if (/img-master\//i.test(s)) {
    s = s.replace('/img-master/', '/img-original/').replace(/_master\d+\.(?:jpg|jpeg|png|gif)$/i, '.png');
  }
  if (!/img-original\//i.test(s)) return null;
  return s;
}

// 从 ajax 返回的 body 中收集图片地址（兼容多种字段结构），只保留原图并去重
function collectPixivImageUrls(body) {
  const raw = [];
  const src = (body && (body.images || body.urls || body.originalImages || body.imageList)) || null;
  if (Array.isArray(src)) {
    for (const it of src) {
      if (typeof it === 'string') raw.push(it);
      else raw.push(it && (it.url || it.original || it.master));
    }
  } else if (src && typeof src === 'object') {
    for (const v of Object.values(src)) {
      if (typeof v === 'string') raw.push(v);
      else raw.push(v && (v.url || v.original || v.master));
    }
  }
  const urls = [];
  for (const u of raw) {
    const o = toPixivOriginal(u);
    if (o && urls.indexOf(o) === -1) urls.push(o);
  }
  return urls;
}

// 兜底：抓作品页 HTML，从内嵌数据中提取原图地址（i.pximg.net/img-original/...）
async function extractPixivImagesFromPage(id, cookie) {
  try {
    const res = await net.fetch('https://www.pixiv.net/artworks/' + id, {
      headers: { 'User-Agent': BROWSER_UA, Referer: 'https://www.pixiv.net/', Cookie: 'PHPSESSID=' + cookie },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const urls = [];
    const re = /i\.pximg\.net[^"'\s\\]+/g;
    let m;
    while ((m = re.exec(html)) && urls.length < 30) {
      const u = 'https://' + m[0].replace(/\\\//g, '/');
      const o = toPixivOriginal(u);
      if (o && urls.indexOf(o) === -1) urls.push(o);
    }
    if (!urls.length) {
      const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
      if (og) {
        const o = toPixivOriginal(og[1]);
        if (o) urls.push(o);
      }
    }
    return urls;
  } catch (e) {
    return [];
  }
}

// 获取作品全部原图地址：优先 pages 接口（直接给 urls.original，不猜测扩展名），其次 illust 接口，再其次页面提取
async function getPixivImageUrls(id, cookie) {
  const headers = { 'User-Agent': BROWSER_UA, Referer: 'https://www.pixiv.net/', Cookie: 'PHPSESSID=' + cookie };
  // 1) /ajax/illust/{id}/pages —— 最可靠
  try {
    const res = await net.fetch('https://www.pixiv.net/ajax/illust/' + id + '/pages', { headers });
    if (res.ok) {
      const j = await res.json();
      if (!j.error && Array.isArray(j.body)) {
        const urls = [];
        for (const p of j.body) {
          const o = p && p.urls && p.urls.original;
          if (o && urls.indexOf(o) === -1) urls.push(o);
        }
        if (urls.length) return urls;
      }
    }
  } catch (e) {
    /* ignore */
  }
  // 2) /ajax/illust/{id}
  try {
    const res = await net.fetch('https://www.pixiv.net/ajax/illust/' + id, { headers });
    if (res.ok) {
      const j = await res.json();
      if (!j.error && j.body) {
        const urls = collectPixivImageUrls(j.body);
        if (urls.length) return urls;
      }
    }
  } catch (e) {
    /* ignore */
  }
  // 3) 页面兜底
  return extractPixivImagesFromPage(id, cookie);
}

// 下载单张图片：先按给定地址，失败时尝试扩展名互换 / master 版本
async function downloadPixivImage(url, headers, file) {
  const variants = [url];
  variants.push(url.replace(/\.png$/i, '.jpg'));
  variants.push(url.replace(/\.jpg$/i, '.png'));
  variants.push(url.replace('/img-original/', '/img-master/').replace(/\.(png|jpg|jpeg)$/i, '_master1200.jpg'));
  const seen = new Set();
  for (const u of variants) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    try {
      const res = await net.fetch(u, { headers });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(file, buf);
        return true;
      }
    } catch (e) {
      /* try next variant */
    }
  }
  return false;
}

ipcMain.handle('pixiv:download-by-id', async (e, payload) => {
  const id = payload && String(payload.id || '').trim();
  if (!/^\d+$/.test(id)) return { ok: false, message: '作品 ID 无效' };
  const cookie = readPixivCookie();
  if (!cookie) return { ok: false, message: '未登录 Pixiv，请先登录' };
  // 1) 获取作品信息与全部原图地址
  let info = null;
  try {
    const infoRes = await net.fetch('https://www.pixiv.net/ajax/illust/' + id, {
      headers: { 'User-Agent': BROWSER_UA, Referer: 'https://www.pixiv.net/', Cookie: 'PHPSESSID=' + cookie },
    });
    if (!infoRes.ok) return { ok: false, message: '获取作品信息失败 HTTP ' + infoRes.status };
    info = await infoRes.json();
  } catch (err) {
    return { ok: false, message: '获取作品信息失败：' + err.message };
  }
  if (info.error || !info.body) return { ok: false, message: info.message || '获取作品信息失败（可能需要重新登录）' };
  const title = (info.body.title || payload.title || id).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  // 2) 收集图片地址（优先 pages 接口的真实原图）
  let urls = await getPixivImageUrls(id, cookie);
  if (!urls.length) return { ok: false, message: '未找到图片地址（作品 ID ' + id + '，可能需要重新登录 Pixiv）' };
  // 3) 逐个下载原图到全局下载目录（失败时自动尝试变体地址）
  const base = getDownloadDir();
  fs.mkdirSync(base, { recursive: true });
  const headers = { 'User-Agent': BROWSER_UA, Referer: 'https://www.pixiv.net/', Cookie: 'PHPSESSID=' + cookie };
  const files = [];
  for (let i = 0; i < urls.length; i++) {
    let ext = '.png';
    try {
      ext = path.extname(new URL(urls[i]).pathname) || '.png';
    } catch (err) {
      /* ignore */
    }
    const file = path.join(base, urls.length > 1 ? title + '_p' + i + ext : title + ext);
    const ok = await downloadPixivImage(urls[i], headers, file);
    if (!ok) return { ok: false, message: '下载失败（第 ' + (i + 1) + ' 张，HTTP 404 或网络错误）' };
    files.push(file);
  }
  return { ok: true, files };
});

function createWindow() {
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  const win = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    title: 'Galgame 搜索',
    backgroundColor: '#e9edf3',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // 窗口失焦/隐藏时不节流，保证视频背景不因失焦暂停
    },
  });
  if (process.env.SMOKE_TEST) {
    const slog = (line) => {
      try { fs.appendFileSync(path.join(__dirname, 'smoke.log'), line + '\n'); } catch (e) { /* ignore */ }
    };
    win.webContents.on('did-finish-load', () => {
      slog('SMOKE_READY');
      setTimeout(() => app.quit(), 3000);
    });
    win.webContents.on('did-fail-load', (e, code, desc) => {
      slog('SMOKE_FAIL ' + code + ' ' + desc);
      app.quit();
    });
    win.webContents.on('console-message', (e, level, message) => {
      slog('RENDERER_LOG[' + level + '] ' + message);
    });
    win.webContents.on('render-process-gone', (e, details) => {
      slog('RENDERER_GONE ' + JSON.stringify(details));
    });
  }
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow = win;
  win.on('closed', () => {
    mainWindow = null;
  });
  return win;
}

// ---------- 站点 IPC ----------
ipcMain.handle('sites:list', () => loadSites());

ipcMain.handle('sites:add', (e, site) => {
  const valid = validateSite(site || {});
  const sites = loadSites();
  sites.push(valid);
  return saveSites(sites);
});

ipcMain.handle('sites:update', (e, site) => {
  const sites = loadSites();
  const idx = sites.findIndex((s) => s.id === (site && site.id));
  if (idx === -1) throw new Error('未找到该网站');
  const merged = { ...sites[idx], ...site, id: sites[idx].id, builtin: sites[idx].builtin };
  merged.name = String(merged.name || '').trim();
  if (!merged.name) throw new Error('请填写网站名称');
  if (merged.type === 'html') {
    merged.url = normalizeHtmlUrl(merged.url, site && site.exampleKeyword);
  }
  merged.selector = String(merged.selector || '').trim();
  merged.titleSelector = String(merged.titleSelector || '').trim();
  merged.expand = !!merged.expand;
  merged.category = merged.category ? String(merged.category).trim() : '游戏';
  sites[idx] = merged;
  return saveSites(sites);
});

ipcMain.handle('sites:remove', (e, id) => {
  const sites = loadSites().filter((s) => s.id !== id);
  return saveSites(sites);
});

ipcMain.handle('sites:set-enabled', (e, id, enabled) => {
  const sites = loadSites().map((s) => (s.id === id ? { ...s, enabled: !!enabled } : s));
  return saveSites(sites);
});

ipcMain.handle('sites:reset', () => {
  const custom = loadSites().filter((s) => !s.builtin);
  return saveSites([...DEFAULT_SITES.map((s) => ({ ...s })), ...custom]);
});

// ---------- 搜索 IPC ----------
// 人名模式下的非 Pixiv 站点搜索：把 姓名变体（原词/缩写/简繁等）逐个在该站搜索，按网址去重合并
async function personSearchSite(keyword, site, fetchImpl, extra, limit) {
  const qs = personCandidates(keyword, extra);
  const seen = new Set();
  const out = [];
  for (const q of qs) {
    let list;
    if (site.type === 'vndb') list = await vndbSearch(q, fetchImpl, [], limit);
    else if (site.type === 'wallpaper') list = await wallpaperSearch(q, fetchImpl, [], limit);
    else list = await htmlSearch(q, site, fetchImpl, [], limit);
    for (const it of list || []) {
      if (out.length >= limit) break;
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      out.push(it);
    }
    if (out.length >= limit) break;
  }
  return out;
}

ipcMain.handle('search', async (e, keyword, opts) => {
  keyword = String(keyword || '').trim();
  if (!keyword) return { error: '请输入要查找的关键词' };
  const personMode = !!(opts && opts.personMode);
  // 多关键词搜索：用 中文/英文分号（；;）分隔多个 tag，组合（AND）搜索，避免同名角色搜错游戏
  const parts = keyword.split(/[;；]/).map((s) => s.trim()).filter(Boolean);
  const multiTag = parts.length > 1;

  // 人物选择器：勾选若干完整人名标签时，只精确搜索这些标签对应的 Pixiv 站点
  const refineOpt = opts && opts.pixivRefine && typeof opts.pixivRefine === 'object' ? opts.pixivRefine : null;
  if (refineOpt) {
    const site = loadSites().find((s) => s.id === refineOpt.siteId && s.type === 'pixiv');
    if (!site) return { error: '未找到对应的 Pixiv 站点' };
    let refineTags = [];
    if (Array.isArray(refineOpt.tags)) {
      refineTags = refineOpt.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 20);
    } else if (refineOpt.tag) {
      refineTags = [String(refineOpt.tag).trim()];
    }
    if (!refineTags.length) return { error: '请至少选择一个完整人名标签' };
    const limit = Math.max(1, Math.min(300, Number(loadSettings().resultLimit) || 10));
    try {
      const res = await pixivSearch('', net.fetch, [], limit, refineTags);
      return {
        keyword: refineTags.join(' / '),
        results: [{ siteId: site.id, siteName: site.name, ok: true, count: res.items.length, results: res.items }],
      };
    } catch (err) {
      return {
        keyword: refineTags.join(' / '),
        results: [{ siteId: site.id, siteName: site.name, ok: false, error: String((err && err.message) || err) }],
      };
    }
  }

  const sites = loadSites().filter((s) => s.enabled);
  if (!sites.length) return { error: '没有启用任何网站，请先在左侧启用或导入网站' };

  // 若标题索引缺失/过期，触发后台构建（幂等；构建中不重复启动）
  ensureShionlibIndex();

  // 缩写解析：本地词典优先（大部分缩写已内置，离线可用）；
  // 词典未命中时，才用联网下载的标题索引做通用中文缩写匹配作补充。
  const exp = expandKeyword(keyword);
  let extra = [];
  if (exp) {
    extra = exp.expansions.filter((e) => e !== keyword); // 本地展开也喂给拓展站点/Pixiv 等
  } else {
    const idx = readIndexCache();
    if (idx) extra = matchAbbreviationsByIndex(keyword, idx.games);
  }

  // 每站结果数上限（可配置，默认 10，最高 300）
  const limit = Math.max(1, Math.min(300, Number(loadSettings().resultLimit) || 10));

  // 会社识别（并行进行）：关键词若命中 VNDB 厂商，取该社作品
  const companyPromise = resolveCompanyWorks(keyword);

  const results = await Promise.allSettled(
    sites.map(async (site) => {
      try {
        let list;
        let pixivTags;
        if (site.type === 'pixiv') {
          // 多关键词：变体组合 AND 搜索；单关键词：人名模式走相关标签扩展
          const r = multiTag
            ? await pixivMultiTagSearch(parts, net.fetch, limit)
            : await pixivSearch(keyword, net.fetch, extra, limit, false, personMode);
          list = r.items;
          pixivTags = r.tags;
        } else if (personMode || multiTag) {
          // 人名模式或多关键词对非 Pixiv 站同样生效：姓名变体逐个搜索后按网址去重合并
          list = await personSearchSite(multiTag ? parts.join(' ') : keyword, site, net.fetch, extra, limit);
        } else if (site.type === 'vndb') {
          list = await vndbSearch(keyword, net.fetch, extra, limit);
        } else if (site.type === 'wallpaper') {
          list = await wallpaperSearch(keyword, net.fetch, extra, limit);
        } else {
          list = await htmlSearch(keyword, site, net.fetch, extra, limit);
        }
        const wrapped = { siteId: site.id, siteName: site.name, ok: true, count: list.length, results: list };
        if (pixivTags && pixivTags.length) wrapped.pixivTags = pixivTags; // 人物选择器候选
        return wrapped;
      } catch (err) {
        return { siteId: site.id, siteName: site.name, ok: false, error: String((err && err.message) || err) };
      }
    })
  );

  const out = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    const reason = r.reason || {};
    return {
      siteId: sites[i].id,
      siteName: sites[i].name,
      ok: false,
      error: String((reason && reason.message) || reason || '未知错误'),
    };
  });

  // 会社识别：把该社作品合并进各勾选网站自己的结果里（不单独分组）
  const primary = exp ? exp.expanded : extra[0] || null;
  let companyName = null;
  try {
    const company = await companyPromise;
    if (company && company.works && company.works.length) {
      companyName = company.name;
      const enriched = await Promise.all(
        out.map((r) => enrichSiteWithCompanyWorks(r, sites, company, limit))
      );
      return { keyword, expanded: primary, companyName, results: enriched };
    }
  } catch (err) {
    console.log('会社识别失败（忽略）:', err.message);
  }

  return { keyword, expanded: primary, companyName, results: out };
});

// 把会社作品补进某个网站的结果头部（去重；shionlib 用本地索引，VNDB 直接附加，其余网站逐个搜索校验）
async function enrichSiteWithCompanyWorks(siteResult, sites, company, limit) {
  if (!siteResult || !siteResult.ok || !siteResult.results) return siteResult;
  const site = sites.find((s) => s.id === siteResult.siteId);
  if (!site) return siteResult;

  let extra = [];
  try {
    if (site.type === 'vndb') {
      // VNDB 站：作品本身即 VNDB 条目，直接附加
      extra = company.works.map((w) => ({
        title: w.alttitle ? w.title + '（' + w.alttitle + '）' : w.title,
        url: w.url,
        image: w.image || null,
      }));
    } else if (site.id === 'shionlib') {
      // shionlib：用本地标题库直接匹配出条目
      extra = shionlibWorksFromIndex(company.works);
      if (!extra.length) {
        // 索引未就绪时退回逐个搜索
        extra = await htmlWorksForCompany(company.works.slice(0, 6), site, limit);
      }
    } else {
      // 其他普通网站：逐个作品搜索并校验
      extra = await htmlWorksForCompany(company.works.slice(0, 6), site, limit);
    }
  } catch (e) {
    extra = [];
  }

  const existingUrls = new Set(siteResult.results.map((x) => x.url));
  const newExtra = extra.filter((x) => !existingUrls.has(x.url));
  // 会社作品排在该网站结果的最前面（优先级最高），并受每站结果数上限约束
  siteResult.results = [...newExtra, ...siteResult.results].slice(0, limit);
  siteResult.count = siteResult.results.length;
  return siteResult;
}

// 用本地标题库把公司作品匹配成 shionlib 条目
function shionlibWorksFromIndex(works) {
  const idx = readIndexCache();
  if (!idx || !Array.isArray(idx.games)) return [];
  const games = idx.games;
  const norms = games.map((g) => g.titles.map(normTitle));
  const out = [];
  const seenIds = new Set();
  for (const w of works) {
    const workNorms = [w.title, w.alttitle, ...(w.aliases || [])].map(normTitle).filter((t) => t.length >= 2);
    for (let gi = 0; gi < games.length; gi++) {
      const g = games[gi];
      if (seenIds.has(g.id)) continue;
      const matched = norms[gi].some((n) => {
        if (!n) return false;
        if (workNorms.includes(n)) return true;
        return n.length >= 4 && workNorms.some((wn) => wn.includes(n) || n.includes(wn));
      });
      if (matched) {
        seenIds.add(g.id);
        const zh = g.titles.find((t) => /[\u4e00-\u9fff]/.test(t) && t.trim().length >= 2);
        out.push({ title: zh || g.titles[0] || w.title, url: 'https://shionlib.com/zh/game/' + g.id });
        break;
      }
    }
    if (out.length >= 30) break;
  }
  return out;
}

// 在普通网站上逐个搜索公司作品（校验同名后才收录）
async function htmlWorksForCompany(works, site, limit) {
  const out = [];
  const seenUrls = new Set();
  for (const w of works) {
    const found = await searchWorkOnHtmlSite(w, site, net.fetch, limit);
    for (const f of found) {
      if (!seenUrls.has(f.url)) {
        seenUrls.add(f.url);
        out.push(f);
      }
    }
    if (out.length >= 20) break;
  }
  return out;
}

// 识别会社并取作品：别名词典 -> VNDB 厂商搜索（含去后缀重试）-> 按 developer 取作品
async function resolveCompanyWorks(keyword) {
  const alias = resolveCompanyAlias(keyword);
  const stripped = String(keyword).replace(/(社|会社|工作室|スタジオ|ソフト)$/i, '').trim();
  const candidates = [];
  if (alias) candidates.push(alias);
  if (stripped && stripped !== keyword) candidates.push(stripped);
  candidates.push(String(keyword).trim());

  let producer = null;
  for (const c of [...new Set(candidates)]) {
    if (!c) continue;
    try {
      const list = await vndbProducerSearch(c, net.fetch);
      if (list.length && producerMatches(list[0], keyword)) {
        producer = list[0];
        break;
      }
    } catch (e) {
      // 该候选失败则换下一个
    }
  }
  if (!producer) return null;

  const works = await vndbWorksByProducer(producer.id, net.fetch);
  if (!works.length) return null;
  return { id: producer.id, name: producer.name, works };
}

// ---------- 设置 IPC ----------
ipcMain.handle('settings:get', () => loadSettings());

ipcMain.handle('settings:set', (e, settings) => {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (settings && settings.background) {
    s.background = { ...s.background, ...settings.background };
  }
  if (settings && settings.theme) s.theme = settings.theme;
  if (settings && typeof settings.panelOpacity === 'number') s.panelOpacity = settings.panelOpacity;
  if (settings && typeof settings.resultLimit === 'number') s.resultLimit = settings.resultLimit;
  if (settings && typeof settings.downloadDir === 'string') s.downloadDir = settings.downloadDir;
  if (settings && typeof settings.personMode === 'boolean') s.personMode = settings.personMode;
  if (settings && settings.proxy && typeof settings.proxy === 'object') s.proxy = { ...s.proxy, ...settings.proxy };
  s.version = SETTINGS_VERSION;
  const saved = saveSettings(s);
  applyProxy(); // 代理设置变更后立即生效
  return saved;
});

// 应用代理：仅 Pixiv 相关域名走代理，其他网站直连
function applyProxy() {
  const p = loadSettings().proxy || {};
  const session = require('electron').session.defaultSession;
  if (!p.enabled || !p.host || !p.port) {
    session.setProxy({ mode: 'system' });
    return;
  }
  const scheme = p.type === 'socks5' ? 'socks5://' : 'http://';
  const proxy = scheme + p.host + ':' + p.port;
  const rules = ['www.pixiv.net', 'pixiv.net', 'i.pximg.net', 'accounts.pixiv.net']
    .map((d) => d + '=' + proxy)
    .join(';');
  session.setProxy({ mode: 'fixed_servers', proxyRules: rules });
}

// 测试 Pixiv 连通性（当前代理设置下）
ipcMain.handle('proxy:test', async () => {
  try {
    applyProxy();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await net.fetch('https://www.pixiv.net/', {
      headers: { 'User-Agent': BROWSER_UA },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) return { ok: true, message: 'Pixiv 连接正常' };
    return { ok: false, message: 'Pixiv 返回 HTTP ' + res.status };
  } catch (e) {
    const msg = e && e.cause && e.cause.message ? e.cause.message : e && e.message ? e.message : String(e);
    return { ok: false, message: '连接失败：' + msg };
  }
});

// 全局下载目录：留空用系统“下载”文件夹
function getDownloadDir() {
  const d = loadSettings().downloadDir;
  return d && d.trim() ? d.trim() : app.getPath('downloads');
}

// 选择下载目录
ipcMain.handle('settings:pick-download-dir', async () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const r = await dialog.showOpenDialog(win, {
    title: '选择下载目录',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const settings = loadSettings();
  settings.downloadDir = r.filePaths[0];
  saveSettings(settings);
  return settings;
});

ipcMain.handle('settings:pick-bg', async () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const r = await dialog.showOpenDialog(win, {
    title: '选择背景（图片 / GIF / 视频）',
    properties: ['openFile'],
    filters: [
      { name: '图片 / GIF / 视频', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp4', 'm4v', 'webm', 'ogv', 'mov'] },
    ],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const src = r.filePaths[0];
  const ext = path.extname(src).toLowerCase() || '.png';
  const dir = path.join(dataDir(), 'backgrounds');
  fs.mkdirSync(dir, { recursive: true });
  const name = 'bg-' + Date.now() + ext;
  fs.copyFileSync(src, path.join(dir, name));
  const settings = loadSettings();
  if (VIDEO_EXT.has(ext)) {
    settings.background.mode = 'video';
    settings.background.video = 'appbg://backgrounds/' + name;
    settings.background.image = '';
  } else {
    settings.background.mode = 'image';
    settings.background.image = 'appbg://backgrounds/' + name;
    settings.background.video = '';
  }
  settings.background.filename = path.basename(src);
  saveSettings(settings);
  return settings;
});

ipcMain.handle('settings:clear-bg', () => {
  const settings = loadSettings();
  settings.background.mode = 'color';
  settings.background.image = '';
  settings.background.video = '';
  settings.background.filename = '';
  saveSettings(settings);
  return settings;
});

ipcMain.handle('open-external', (e, url) => {
  // 普通链接或本地壁纸文件夹（file://）
  if (typeof url === 'string' && (/^https?:\/\//i.test(url) || /^file:\/\//i.test(url))) shell.openExternal(url);
});

// 词库状态：返回是否已下载、游戏数量、更新时间
ipcMain.handle('index:status', () => {
  const idx = readIndexCache();
  if (!idx || !Array.isArray(idx.games)) return { exists: false };
  return { exists: true, count: idx.games.length, builtAt: idx.builtAt };
});

// 词库强制更新：重新下载标题库（进度通过 index-progress 事件上报）
ipcMain.handle('index:update', async () => {
  if (buildingIndex) return { ok: false, message: '词库正在更新中，请稍候' };
  buildingIndex = true;
  sendIndexProgress({ phase: 'build', done: 0, total: 1 });
  try {
    await buildShionlibIndex((p) => sendIndexProgress({ phase: 'build', done: p.done, total: p.total }));
    sendIndexProgress({ phase: 'done' });
    return { ok: true };
  } catch (e) {
    console.log('词库更新失败:', e.message);
    sendIndexProgress({ phase: 'error', message: e.message });
    return { ok: false, message: e.message || String(e) };
  } finally {
    buildingIndex = false;
  }
});

// ---------- 中文缩写标题索引（shionlib 标题库，用于通用中文缩写展开） ----------
const INDEX_FILE = 'shionlib-index.json';
const INDEX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
let shionIndex = null; // { version, builtAt, games: [{id, titles: []}] }
let mainWindow = null;
let buildingIndex = false;

function sendIndexProgress(p) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('index-progress', p);
  }
}

function indexPath() {
  return path.join(dataDir(), INDEX_FILE);
}

function readIndexCache() {
  if (shionIndex) return shionIndex;
  const data = readJson(indexPath(), null);
  if (data && Array.isArray(data.games) && data.games.length > 500) {
    shionIndex = data;
    return shionIndex;
  }
  return null;
}

async function buildShionlibIndex(onProgress) {
  const fetchJson = async (url) => {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': 'galgame-finder/1.0', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  };

  const first = await fetchJson('https://shionlib.com/api/game/list?page=1&pageSize=100');
  const total = first.data && first.data.meta && first.data.meta.totalItems;
  if (!total || !Array.isArray(first.data.items)) throw new Error('无法获取游戏总数');

  const pages = Math.ceil(total / 100);
  const games = [];
  const seenIds = new Set();
  let donePages = 1;
  const addItems = (items) => {
    for (const it of items) {
      if (seenIds.has(it.id)) continue;
      seenIds.add(it.id);
      const titles = [it.title_zh, it.title_jp, it.title_en, ...(it.aliases || [])]
        .filter((t) => t && String(t).trim())
        .map((t) => String(t).trim());
      if (titles.length) games.push({ id: it.id, titles: [...new Set(titles)] });
    }
  };
  addItems(first.data.items);
  if (onProgress) onProgress({ done: donePages, total: pages });

  const CONC = 6;
  let page = 2;
  let fails = 0;
  while (page <= pages) {
    const batch = [];
    for (let i = 0; i < CONC && page <= pages; i++, page++) batch.push(page);
    const settled = await Promise.allSettled(
      batch.map((p) => fetchJson('https://shionlib.com/api/game/list?page=' + p + '&pageSize=100'))
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value && r.value.data && Array.isArray(r.value.data.items)) {
        addItems(r.value.data.items);
        donePages++;
      } else {
        fails++;
      }
    }
    if (onProgress) onProgress({ done: donePages, total: pages });
    if (fails > 12) throw new Error('获取标题库失败页过多');
    await new Promise((r) => setTimeout(r, 100));
  }

  const index = { version: 1, builtAt: Date.now(), games };
  writeJson(indexPath(), index);
  shionIndex = index;
  return index;
}

// 后台确保索引存在（缺失或超过 7 天则重建），并向前端上报进度；失败静默，不影响主功能。
function ensureShionlibIndex() {
  const cached = readIndexCache();
  if (cached && Date.now() - cached.builtAt < INDEX_STALE_MS) return;
  if (buildingIndex) return;
  buildingIndex = true;
  sendIndexProgress({ phase: 'build', done: 0, total: 1 });
  buildShionlibIndex((p) => sendIndexProgress({ phase: 'build', done: p.done, total: p.total }))
    .then(() => sendIndexProgress({ phase: 'done' }))
    .catch((e) => {
      console.log('缩写索引构建失败（不影响其他功能）:', e.message);
      sendIndexProgress({ phase: 'error', message: e.message });
    })
    .finally(() => {
      buildingIndex = false;
    });
}

app.whenReady().then(() => {
  registerAppBgProtocol();
  registerWpImgProtocol();
  registerPixImgProtocol();
  Menu.setApplicationMenu(null);
  ensureShionlibIndex(); // 后台预建中文缩写索引
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
