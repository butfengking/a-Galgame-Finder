(function () {
  'use strict';

  const api = window.api;

  const els = {
    keyword: document.getElementById('keyword'),
    btnSearch: document.getElementById('btn-search'),
    siteList: document.getElementById('site-list'),
    status: document.getElementById('status'),
    results: document.getElementById('results'),
    btnAddSite: document.getElementById('btn-add-site'),
    btnResetSites: document.getElementById('btn-reset-sites'),
    btnGear: document.getElementById('btn-gear'),

    settingsModal: document.getElementById('settings-modal'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    btnPickBg: document.getElementById('btn-pick-bg'),
    btnClearBg: document.getElementById('btn-clear-bg'),
    bgStatus: document.getElementById('bg-status'),
    bgColor: document.getElementById('bg-color'),
    overlayRange: document.getElementById('bg-overlay-range'),
    overlayVal: document.getElementById('overlay-val'),
    panelOpacityRange: document.getElementById('panel-opacity-range'),
    panelOpacityVal: document.getElementById('panel-opacity-val'),
    resultLimitInput: document.getElementById('result-limit-input'),
    btnUpdateIndex: document.getElementById('btn-update-index'),
    indexStatus: document.getElementById('index-status'),

    siteModal: document.getElementById('site-modal'),
    siteModalTitle: document.getElementById('site-modal-title'),
    btnCloseSiteModal: document.getElementById('btn-close-site-modal'),
    siteName: document.getElementById('site-name'),
    siteCategory: document.getElementById('site-category'),
    categoryOptions: document.getElementById('category-options'),
    siteUrl: document.getElementById('site-url'),
    siteExampleKw: document.getElementById('site-example-kw'),
    siteExampleHint: document.getElementById('site-example-hint'),
    siteSelector: document.getElementById('site-selector'),
    siteTitleSelector: document.getElementById('site-title-selector'),
    siteExpand: document.getElementById('site-expand'),
    siteModalError: document.getElementById('site-modal-error'),
    btnSaveSite: document.getElementById('btn-save-site'),
  };

  const themeRadios = document.querySelectorAll('input[name="theme"]');

  let sites = [];
  let settings = null;
  let editingSiteId = null;
  let exampleKwAuto = false;
  let urlDetectTimer = null;
  const collapsedSites = new Set(); // 本次会话中收起的结果分组

  // ---------- 主题与背景 ----------
  function applyBackground() {
    if (!settings) return;
    const isDark = settings.theme === 'dark';
    document.body.classList.toggle('dark', isDark);
    const bg = settings.background || {};
    const overlayEl = document.getElementById('bg-overlay');
    const videoEl = document.getElementById('bg-video');
    document.body.style.backgroundColor = bg.color || (isDark ? '#1f2937' : '#e9edf3');
    if (bg.mode === 'video' && bg.video) {
      // 视频背景：用 <video> 元素垫底播放
      document.body.style.backgroundImage = 'none';
      if (videoEl.getAttribute('src') !== bg.video) {
        videoEl.setAttribute('src', bg.video);
      }
      videoEl.classList.remove('hidden');
      videoEl.play().catch(() => {});
    } else {
      // 非视频：停止并隐藏视频
      videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.classList.add('hidden');
      if (bg.mode === 'image' && bg.image) {
        document.body.style.backgroundImage = 'url("' + bg.image + '")';
      } else {
        document.body.style.backgroundImage = 'none';
      }
    }
    const pct = Math.max(0, Math.min(1, Number(bg.overlay) || 0)).toFixed(2);
    overlayEl.style.background = isDark
      ? 'rgba(0, 0, 0, ' + pct + ')'
      : 'rgba(255, 255, 255, ' + pct + ')';
    // 面板透明度：直接由 JS 计算完整 rgba，避免嵌套 var() 不生效的问题
    const alpha = Math.max(0.3, Math.min(1, Number(settings.panelOpacity) || 0.85)).toFixed(2);
    const rgb = isDark ? '24, 30, 40' : '255, 255, 255';
    document.body.style.setProperty('--panel', 'rgba(' + rgb + ', ' + alpha + ')');
  }

  // 视频背景：窗口重新可见/聚焦时恢复播放（Chromium 失焦会暂停媒体且不自动恢复）
  function resumeBgVideo() {
    if (!settings || !settings.background) return;
    const bg = settings.background;
    if (bg.mode !== 'video' || !bg.video) return;
    const videoEl = document.getElementById('bg-video');
    if (videoEl && !videoEl.classList.contains('hidden') && videoEl.paused) {
      videoEl.play().catch(() => {});
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resumeBgVideo();
  });
  window.addEventListener('focus', resumeBgVideo);

  function syncSettingsForm() {
    if (!settings) return;
    const bg = settings.background || {};
    themeRadios.forEach((r) => {
      r.checked = r.value === (settings.theme || 'light');
    });
    els.bgColor.value = bg.color || (settings.theme === 'dark' ? '#1f2937' : '#e9edf3');
    const pct = Math.round((Number(bg.overlay) || 0) * 100);
    els.overlayRange.value = String(pct);
    els.overlayVal.textContent = pct + '%';
    const alphaPct = Math.round((Number(settings.panelOpacity) || 0.85) * 100);
    els.panelOpacityRange.value = String(alphaPct);
    els.panelOpacityVal.textContent = alphaPct + '%';
    els.resultLimitInput.value = String(Number(settings.resultLimit) || 10);
    els.bgStatus.textContent =
      (bg.mode === 'image' || bg.mode === 'video') && bg.filename ? '已设置：' + bg.filename : '未设置';
  }

  async function saveBackgroundSettings() {
    settings.background.color = els.bgColor.value;
    settings.background.overlay = Number(els.overlayRange.value) / 100;
    settings.panelOpacity = Number(els.panelOpacityRange.value) / 100;
    const v = parseInt(els.resultLimitInput.value, 10);
    settings.resultLimit = Math.max(1, Math.min(50, isNaN(v) ? 10 : v));
    els.resultLimitInput.value = String(settings.resultLimit);
    settings = await api.setSettings(settings);
    applyBackground();
    syncSettingsForm();
  }

  // ---------- 站点列表（按分类分组） ----------
  function makeSiteItem(site) {
    const li = document.createElement('li');
    li.className = 'site-item';

    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!site.enabled;
    cb.addEventListener('change', async () => {
      sites = await api.setSiteEnabled(site.id, cb.checked);
      renderSites();
    });

    const nameSpan = document.createElement('span');
    nameSpan.textContent = site.name;

    label.appendChild(cb);
    label.appendChild(nameSpan);
    li.appendChild(label);

    if (site.type === 'vndb') {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'API';
      li.appendChild(badge);
    }

    const edit = document.createElement('button');
    edit.className = 'edit-btn';
    edit.type = 'button';
    edit.title = '编辑该网站';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => openSiteModal(site));
    li.appendChild(edit);

    if (!site.builtin) {
      const del = document.createElement('button');
      del.className = 'remove-btn';
      del.type = 'button';
      del.title = '删除该网站';
      del.textContent = '×';
      del.addEventListener('click', async () => {
        sites = await api.removeSite(site.id);
        renderSites();
      });
      li.appendChild(del);
    }
    return li;
  }

  function renderSites() {
    els.siteList.textContent = '';
    const presetOrder = ['游戏', '视频'];
    const groups = new Map();
    for (const site of sites) {
      const cat = site.category || '未分类';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(site);
    }
    const cats = [...groups.keys()].sort((a, b) => {
      const ia = presetOrder.indexOf(a);
      const ib = presetOrder.indexOf(b);
      const ra = ia === -1 ? (a === '未分类' ? 99 : 50) : ia;
      const rb = ib === -1 ? (b === '未分类' ? 99 : 50) : ib;
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b, 'zh-CN');
    });
    for (const cat of cats) {
      const head = document.createElement('li');
      head.className = 'category-head';
      head.textContent = cat;
      els.siteList.appendChild(head);
      for (const site of groups.get(cat)) {
        els.siteList.appendChild(makeSiteItem(site));
      }
    }
  }

  // ---------- 结果渲染 ----------
  function makeLink(title, url, image) {
    const a = document.createElement('a');
    a.href = url;
    if (image) {
      const thumb = document.createElement('img');
      thumb.className = 'result-thumb';
      thumb.src = image;
      thumb.loading = 'lazy';
      thumb.alt = '';
      thumb.addEventListener('error', () => thumb.remove());
      a.appendChild(thumb);
      const textWrap = document.createElement('span');
      textWrap.className = 'result-text';
      const titleSpan = document.createElement('span');
      titleSpan.textContent = title;
      textWrap.appendChild(titleSpan);
      const hint = document.createElement('span');
      hint.className = 'url-hint';
      hint.textContent = url;
      textWrap.appendChild(hint);
      a.appendChild(textWrap);
    } else {
      a.textContent = title;
      const hint = document.createElement('span');
      hint.className = 'url-hint';
      hint.textContent = url;
      a.appendChild(hint);
    }
    a.addEventListener('click', (e) => {
      e.preventDefault();
      api.openExternal(url);
    });
    return a;
  }

  function renderResults(payload) {
    els.results.textContent = '';
    if (payload.error) {
      els.status.textContent = payload.error;
      return;
    }
    const total = payload.results.reduce((n, r) => n + (r.ok ? r.count : 0), 0);
    const expNote = payload.expanded ? '（已按缩写展开为“' + payload.expanded + '”搜索）' : '';
    const companyNote = payload.companyName ? '（识别为会社：“' + payload.companyName + '”，各网站结果下方已附上该社作品）' : '';
    els.status.textContent = '关键词“' + payload.keyword + '”' + expNote + companyNote + '，共 ' + total + ' 条结果。';

    for (const r of payload.results) {
      const group = document.createElement('div');
      group.className = 'site-group';
      const collapsed = collapsedSites.has(r.siteId);
      if (collapsed) group.classList.add('collapsed');

      const head = document.createElement('div');
      head.className = 'site-group-head';
      head.title = '点击展开 / 收起';

      const headTitle = document.createElement('span');
      headTitle.textContent = r.siteName;
      head.appendChild(headTitle);

      const headRight = document.createElement('span');
      headRight.className = 'head-right';

      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = r.ok ? r.count + ' 条' : '失败';
      headRight.appendChild(count);

      const toggle = document.createElement('span');
      toggle.className = 'toggle-hint';
      toggle.textContent = collapsed ? '展开' : '收起';
      headRight.appendChild(toggle);

      head.appendChild(headRight);
      head.addEventListener('click', () => {
        const nowCollapsed = group.classList.toggle('collapsed');
        toggle.textContent = nowCollapsed ? '展开' : '收起';
        if (nowCollapsed) collapsedSites.add(r.siteId);
        else collapsedSites.delete(r.siteId);
      });
      group.appendChild(head);

      const body = document.createElement('div');
      body.className = 'group-body';

      if (!r.ok) {
        const err = document.createElement('div');
        err.className = 'error-note';
        err.textContent = '抓取失败：' + r.error;
        body.appendChild(err);
      } else if (!r.results.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-note';
        empty.textContent = '没有找到相关结果。';
        body.appendChild(empty);
      } else {
        const ul = document.createElement('ul');
        ul.className = 'result-list';
        for (const item of r.results) {
          const li = document.createElement('li');
          li.appendChild(makeLink(item.title, item.url, item.image));
          ul.appendChild(li);
        }
        body.appendChild(ul);
      }

      group.appendChild(body);
      els.results.appendChild(group);
    }
  }

  // ---------- 搜索 ----------
  async function runSearch() {
    const kw = els.keyword.value.trim();
    if (!kw) {
      els.status.textContent = '请先输入要查找的关键词。';
      return;
    }
    els.btnSearch.disabled = true;
    els.status.textContent = '正在搜索“' + kw + '”……';
    els.results.textContent = '';
    try {
      const payload = await api.search(kw);
      renderResults(payload);
    } catch (e) {
      els.status.textContent = '搜索出错：' + (e && e.message ? e.message : e);
    } finally {
      els.btnSearch.disabled = false;
    }
  }

  // ---------- 导入网址：自动识别示例关键词 ----------
  function detectKeywordFromUrl(url) {
    try {
      const u = new URL(url);
      const names = ['q', 'query', 'search', 'keyword', 'kw', 'wd', 's', 'term', 'text', 'k'];
      for (const n of names) {
        const v = u.searchParams.get(n);
        if (v && v.trim()) return decodeURIComponent(v.trim());
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function updateExampleHint(text) {
    els.siteExampleHint.textContent = text;
  }

  function showSiteError(msg) {
    els.siteModalError.textContent = msg;
    els.siteModalError.classList.remove('hidden');
  }
  function hideSiteError() {
    els.siteModalError.classList.add('hidden');
  }

  // ---------- 弹窗开关 ----------
  function openSettings() {
    syncSettingsForm();
    els.settingsModal.classList.remove('hidden');
    refreshIndexStatus();
  }
  function closeSettings() {
    els.settingsModal.classList.add('hidden');
  }

  async function refreshIndexStatus() {
    try {
      const st = await api.indexStatus();
      if (st && st.exists) {
        const d = new Date(st.builtAt);
        const ds = d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        els.indexStatus.textContent = '已下载 ' + st.count + ' 款（' + ds + '）';
      } else {
        els.indexStatus.textContent = '未下载';
      }
    } catch (e) {
      els.indexStatus.textContent = '读取失败';
    }
  }
  function openSiteModal(site) {
    editingSiteId = site ? site.id : null;
    els.siteModalTitle.textContent = site ? '编辑网站' : '导入网站';
    els.siteName.value = site ? site.name : '';
    els.siteCategory.value = site ? site.category || '游戏' : '游戏';
    populateCategoryOptions();
    els.siteUrl.value = site ? (site.url || '') : '';
    els.siteSelector.value = site ? (site.selector || '') : '';
    els.siteTitleSelector.value = site ? (site.titleSelector || '') : '';
    els.siteExpand.checked = site ? !!site.expand : false;
    els.siteExampleKw.value = '';
    exampleKwAuto = false;
    hideSiteError();
    if (!site) {
      const kw = els.keyword.value.trim();
      if (kw) {
        els.siteExampleKw.value = kw;
        exampleKwAuto = true;
      }
    }
    updateExampleHint('粘贴搜索网址后会自动识别其中的关键词。保存时该词会被替换为 {keyword}。');
    els.siteModal.classList.remove('hidden');
    els.siteName.focus();
  }

  // 分类下拉建议：预置分类 + 所有已用分类
  function populateCategoryOptions() {
    els.categoryOptions.textContent = '';
    const cats = new Set(['游戏', '视频']);
    for (const s of sites) {
      if (s.category) cats.add(s.category);
    }
    for (const c of cats) {
      const opt = document.createElement('option');
      opt.value = c;
      els.categoryOptions.appendChild(opt);
    }
  }
  function closeSiteModal() {
    els.siteModal.classList.add('hidden');
  }

  // ---------- 事件绑定 ----------
  els.btnSearch.addEventListener('click', runSearch);
  els.keyword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch();
  });

  els.btnAddSite.addEventListener('click', () => openSiteModal(null));
  els.btnResetSites.addEventListener('click', async () => {
    sites = await api.resetSites();
    renderSites();
  });

  els.btnGear.addEventListener('click', openSettings);
  els.btnCloseSettings.addEventListener('click', closeSettings);
  els.settingsModal.addEventListener('click', (e) => {
    if (e.target === els.settingsModal) closeSettings();
  });

  els.btnUpdateIndex.addEventListener('click', async () => {
    if (els.btnUpdateIndex.disabled) return;
    els.btnUpdateIndex.disabled = true;
    els.btnUpdateIndex.textContent = '更新中…';
    els.indexStatus.textContent = '正在重新下载词库（约半分钟），进度见左下角…';
    try {
      const res = await api.updateIndex();
      els.indexStatus.textContent = res && res.ok ? '词库已更新' : '更新失败：' + ((res && res.message) || '未知错误');
    } catch (e) {
      els.indexStatus.textContent = '更新失败：' + (e && e.message ? e.message : e);
    } finally {
      els.btnUpdateIndex.disabled = false;
      els.btnUpdateIndex.textContent = '更新词库';
      refreshIndexStatus();
    }
  });

  themeRadios.forEach((r) => {
    r.addEventListener('change', async () => {
      if (!r.checked) return;
      settings.theme = r.value;
      settings = await api.setSettings(settings);
      applyBackground();
      syncSettingsForm();
    });
  });

  els.btnPickBg.addEventListener('click', async () => {
    const s = await api.pickBackgroundImage();
    if (s) {
      settings = s;
      applyBackground();
      syncSettingsForm();
    }
  });
  els.btnClearBg.addEventListener('click', async () => {
    settings = await api.clearBackgroundImage();
    applyBackground();
    syncSettingsForm();
  });
  els.bgColor.addEventListener('input', saveBackgroundSettings);
  els.overlayRange.addEventListener('input', () => {
    els.overlayVal.textContent = els.overlayRange.value + '%';
    saveBackgroundSettings();
  });
  els.panelOpacityRange.addEventListener('input', () => {
    els.panelOpacityVal.textContent = els.panelOpacityRange.value + '%';
    saveBackgroundSettings();
  });
  els.resultLimitInput.addEventListener('change', saveBackgroundSettings);

  els.siteUrl.addEventListener('input', () => {
    clearTimeout(urlDetectTimer);
    urlDetectTimer = setTimeout(() => {
      const detected = detectKeywordFromUrl(els.siteUrl.value.trim());
      if (detected) {
        els.siteExampleKw.value = detected;
        exampleKwAuto = true;
        updateExampleHint('已识别示例关键词：“' + detected + '”。保存时自动替换为 {keyword}。');
      } else if (exampleKwAuto && els.siteUrl.value.trim()) {
        updateExampleHint('未在网址中识别到关键词参数，请手动填写示例关键词。');
      } else {
        updateExampleHint('粘贴搜索网址后会自动识别其中的关键词。保存时该词会被替换为 {keyword}。');
      }
    }, 400);
  });
  els.siteExampleKw.addEventListener('input', () => {
    exampleKwAuto = false;
    updateExampleHint('保存时该词会被替换为 {keyword}。');
  });

  els.btnCloseSiteModal.addEventListener('click', closeSiteModal);
  els.siteModal.addEventListener('click', (e) => {
    if (e.target === els.siteModal) closeSiteModal();
  });
  els.btnSaveSite.addEventListener('click', async () => {
    const site = {
      id: editingSiteId,
      name: els.siteName.value,
      category: els.siteCategory.value.trim() || '游戏',
      url: els.siteUrl.value,
      exampleKeyword: els.siteExampleKw.value.trim(),
      selector: els.siteSelector.value,
      titleSelector: els.siteTitleSelector.value,
      expand: els.siteExpand.checked,
    };
    try {
      if (editingSiteId) {
        sites = await api.updateSite(site);
      } else {
        sites = await api.addSite(site);
      }
      hideSiteError();
      closeSiteModal();
      renderSites();
    } catch (e) {
      // 用内联错误提示，避免 alert() 导致输入框失焦后无法输入的问题
      showSiteError(e && e.message ? e.message : String(e));
    }
  });

  // 用户修改任一输入时清除错误提示
  [els.siteName, els.siteUrl, els.siteExampleKw, els.siteSelector, els.siteTitleSelector].forEach((el) => {
    el.addEventListener('input', hideSiteError);
  });

  // ---------- 标题库加载进度（左下角） ----------
  function wireIndexProgress() {
    api.onIndexProgress((p) => {
      const el = document.getElementById('index-progress');
      const text = document.getElementById('index-progress-text');
      const bar = document.getElementById('index-progress-bar');
      if (!el) return;
      if (p.phase === 'build') {
        el.classList.remove('hidden');
        const done = Math.min(p.done || 0, p.total || 1);
        const pct = p.total ? Math.round((done / p.total) * 100) : 0;
        bar.style.width = pct + '%';
        text.textContent = '正在加载标题库 ' + done + '/' + p.total;
      } else if (p.phase === 'done') {
        el.classList.add('hidden');
      } else if (p.phase === 'error') {
        text.textContent = '标题库加载失败';
        bar.style.width = '0%';
        setTimeout(() => el.classList.add('hidden'), 3000);
      }
    });
  }

  // ---------- 初始化 ----------
  (async function init() {
    try {
      sites = await api.listSites();
      settings = await api.getSettings();
      renderSites();
      applyBackground();
      wireIndexProgress();
    } catch (e) {
      els.status.textContent = '初始化失败：' + (e && e.message ? e.message : e);
    }
  })();
})();
