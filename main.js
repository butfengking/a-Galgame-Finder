const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
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
} = require('./search');

const DEFAULT_SITES = [
  {
    id: 'vndb',
    name: 'VNDB（视觉小说数据库）',
    type: 'vndb',
    url: '',
    selector: '',
    titleSelector: '',
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
  const custom = data.sites.filter((s) => !s.builtin);
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
    } else if (data.version === 2 || data.version === 3) {
      // 旧版本迁移：仅此一次把过浅的遮罩默认修正为 90%，其余保留
      merged.background = { ...merged.background, ...data.background };
      if (data.theme) merged.theme = data.theme;
      if (typeof data.panelOpacity === 'number') merged.panelOpacity = data.panelOpacity;
      if (typeof data.resultLimit === 'number') merged.resultLimit = data.resultLimit;
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
ipcMain.handle('search', async (e, keyword) => {
  keyword = String(keyword || '').trim();
  if (!keyword) return { error: '请输入要查找的关键词' };
  const sites = loadSites().filter((s) => s.enabled);
  if (!sites.length) return { error: '没有启用任何网站，请先在左侧启用或导入网站' };

  // 若标题索引缺失/过期，触发后台构建（幂等；构建中不重复启动）
  ensureShionlibIndex();

  // 通用中文缩写解析：标题索引（后台构建，未就绪时返回空，仅用词典展开）
  let extra = [];
  const idx = readIndexCache();
  if (idx) extra = matchAbbreviationsByIndex(keyword, idx.games);
  const exp = expandKeyword(keyword);

  // 每站结果数上限（可配置，默认 10）
  const limit = Math.max(1, Math.min(50, Number(loadSettings().resultLimit) || 10));

  // 会社识别（并行进行）：关键词若命中 VNDB 厂商，取该社作品
  const companyPromise = resolveCompanyWorks(keyword);

  const results = await Promise.allSettled(
    sites.map(async (site) => {
      try {
        const list =
          site.type === 'vndb'
            ? await vndbSearch(keyword, net.fetch, extra, limit)
            : await htmlSearch(keyword, site, net.fetch, extra, limit);
        return { siteId: site.id, siteName: site.name, ok: true, count: list.length, results: list };
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
  s.version = SETTINGS_VERSION;
  return saveSettings(s);
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
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
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
