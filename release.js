// 一键打包并发布 GitHub Release
// 用法：
//   node release.js             # 用 package.json 里的版本号发布
//   node release.js 1.1.0       # 指定版本发布
//   node release.js --no-build  # 跳过打包，仅更新/上传现有资产
// 依赖：git 已登录（凭据管理器）、package.json 中 build.win.target 含 portable 和 nsis
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = 'butfengking/a-Galgame-Finder';
const UA = 'galgame-finder-release-script';

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--use-system-ca' },
  });
  if (res.status !== 0) {
    console.error('命令失败: ' + cmd + ' ' + args.join(' '));
    process.exit(1);
  }
}

function getToken() {
  const res = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n',
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    console.error('获取 git 凭据失败，请先在浏览器登录 GitHub（git push 能成功即可）。');
    process.exit(1);
  }
  const m = (res.stdout || '').match(/^password=(.*)$/m);
  if (!m) {
    console.error('未找到 GitHub 凭据。');
    process.exit(1);
  }
  return m[1].trim();
}

async function api(token, method, url, body) {
  const headers = { Authorization: 'Bearer ' + token, 'User-Agent': UA };
  const opts = { method, headers };
  if (body !== undefined) {
    if (Buffer.isBuffer(body)) {
      opts.body = body;
    } else {
      opts.body = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    /* ignore */
  }
  return { status: res.status, data };
}

function buildBody(version) {
  return [
    '在指定网站查找 galgame 的桌面应用。',
    '',
    '## 功能',
    '- 多站搜索：VNDB（官方 API）、Steam、书音的图书馆（shionlib，中文档案站），结果带链接',
    '- 缩写搜索：内置词典（fsn、cl、lb、wa2 等）+ 通用中文缩写解析（如 星白 → 星空列车与白的旅行）',
    '- 会社搜索：搜 柚子社 / Key / 型月 等会直接列出该社作品',
    '- 浅色/深色主题、界面透明度、自定义背景',
    '- 支持导入自定义网站（自动识别关键词）',
    '',
    '## 下载',
    '- GalgameFinder-' + version + '-portable.exe：便携版，免安装，双击即用',
    '- GalgameFinder-' + version + '-setup.exe：安装版，带安装向导与桌面快捷方式',
    '',
    '注意：首次启动会在左下角下载标题库（约 1.4 万款游戏）用于中文缩写解析，需联网。',
  ].join('\n');
}

async function uploadAsset(token, releaseId, filePath, name) {
  const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
  console.log('上传: ' + name + '（' + sizeMB + ' MB）...');
  const url =
    'https://uploads.github.com/repos/' + REPO + '/releases/' + releaseId + '/assets?name=' + encodeURIComponent(name);
  const buf = fs.readFileSync(filePath);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'User-Agent': UA, 'Content-Type': 'application/octet-stream' },
    body: buf,
  });
  if (!res.ok) {
    console.error('上传失败: ' + name + ' → ' + (await res.text()).slice(0, 300));
    process.exit(1);
  }
  const data = await res.json();
  console.log('完成: ' + data.name);
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  const noBuild = process.argv.includes('--no-build');
  const rawVer = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : pkg.version;
  const version = rawVer.replace(/^v/, '');
  const tag = 'v' + version;

  console.log('== Galgame 搜索 Release 发布工具 ==');
  console.log('版本: ' + version + '  标签: ' + tag + (noBuild ? '（跳过打包）' : ''));

  // 1. 打包
  if (!noBuild) {
    console.log('\n[1/3] 打包（portable + setup）...');
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dist:all']);
  } else {
    console.log('\n[1/3] 跳过打包');
  }

  // 2. 找到产物
  const distDir = path.join(__dirname, 'dist');
  let portableFile = null;
  let setupFile = null;
  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    const portables = files.filter((f) => /^Galgame搜索 .+\.exe$/.test(f) && !/Setup/.test(f));
    const setups = files.filter((f) => /^Galgame搜索-Setup-.+\.exe$/.test(f));
    if (portables.length) portableFile = path.join(distDir, portables[0]);
    if (setups.length) setupFile = path.join(distDir, setups[0]);
  }
  if (!portableFile || !setupFile) {
    console.error('未找到打包产物（需要 dist 下的便携版与 Setup exe），请先运行 npm run dist:all。');
    process.exit(1);
  }
  const portableName = 'GalgameFinder-' + version + '-portable.exe';
  const setupName = 'GalgameFinder-' + version + '-setup.exe';

  // 3. 创建或更新 Release
  console.log('\n[2/3] 创建/更新 GitHub Release...');
  const token = getToken();
  const name = 'Galgame搜索 v' + version;
  let rel;
  const existing = await api(token, 'GET', 'https://api.github.com/repos/' + REPO + '/releases/tags/' + tag);
  if (existing.status === 200) {
    console.log('Release 已存在（' + tag + '），更新名称与说明');
    const upd = await api(token, 'PATCH', existing.data.url, { name, body: buildBody(version) });
    if (upd.status >= 300) {
      console.error('更新失败:', upd.data);
      process.exit(1);
    }
    rel = upd.data;
  } else {
    const created = await api(token, 'POST', 'https://api.github.com/repos/' + REPO + '/releases', {
      tag_name: tag,
      target_commitish: 'main',
      name,
      body: buildBody(version),
      draft: false,
      prerelease: false,
    });
    if (created.status >= 300) {
      console.error('创建失败:', created.data);
      process.exit(1);
    }
    rel = created.data;
  }

  // 4. 上传资产（先删除同名旧资产，保证可重复执行）
  console.log('\n[3/3] 上传资产...');
  for (const a of rel.assets || []) {
    if (a.name === portableName || a.name === setupName) {
      await api(token, 'DELETE', a.url);
      console.log('删除旧资产: ' + a.name);
    }
  }
  await uploadAsset(token, rel.id, portableFile, portableName);
  await uploadAsset(token, rel.id, setupFile, setupName);

  console.log('\n完成！Release 地址: ' + rel.html_url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
