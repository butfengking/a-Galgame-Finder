// 启动依赖完整性检查：源码运行时（git pull 更新后新增了软件包）自动 npm install 补齐，避免无法启动。
// 打包版（app.asar 内依赖已内置）自动跳过。仅使用 Node 内置模块，可独立运行测试：node ensure-deps.js
'use strict';

function ensureDependencies() {
  // 打包版：依赖已打进 asar，无需检查
  if (__dirname.includes('app.asar')) return true;

  const fs = require('fs');
  const path = require('path');
  const { spawnSync } = require('child_process');

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  } catch (e) {
    return true; // 读不到 package.json（异常环境）就不检查，避免干扰启动
  }
  const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
  const names = Object.keys(deps);
  if (!names.length) return true;

  const findMissing = () =>
    names.filter((n) => {
      try {
        require.resolve(n);
        return false;
      } catch (e) {
        return true;
      }
    });
  // 复查用文件系统检查：Node 会把“找不到模块”的结果缓存在进程内（Module._pathCache 等），
  // npm 装好后同一进程再 require.resolve 仍可能报错，文件检查不受影响
  const stillMissingOnDisk = () =>
    names.filter((n) => !fs.existsSync(path.join(__dirname, 'node_modules', n, 'package.json')));

  const missing = findMissing();
  if (!missing.length) return true;

  // 有缺失依赖：自动安装
  console.log('[依赖检查] 检测到缺失依赖: ' + missing.join(', '));
  console.log('[依赖检查] 正在运行 npm install 自动安装（视网络情况可能需要几分钟）…');
  const env = Object.assign({}, process.env);
  const baseOpts = process.env.NODE_OPTIONS || '';
  env.NODE_OPTIONS = baseOpts + (baseOpts.includes('--use-system-ca') ? '' : ' --use-system-ca');
  const win = process.platform === 'win32';
  const r = win
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm.cmd install --no-audit --no-fund'], { cwd: __dirname, stdio: 'inherit', env })
    : spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: __dirname, stdio: 'inherit', env });

  const stillMissing = stillMissingOnDisk();
  if (!stillMissing.length) {
    console.log('[依赖检查] 依赖已补齐，继续启动。');
    return true;
  }
  console.error('[依赖检查] 自动安装后仍有缺失依赖: ' + stillMissing.join(', '));
  if (r && r.error) console.error('[依赖检查] 安装失败: ' + (r.error && r.error.message));
  else if (r && r.status !== 0) console.error('[依赖检查] npm install 退出码: ' + r.status);
  console.error('[依赖检查] 请手动在项目目录运行: npm install（若被安全软件拦截请允许后重试）');
  return false;
}

if (require.main === module) {
  // 独立运行：node ensure-deps.js
  const ok = ensureDependencies();
  console.log(ok ? '[依赖检查] 通过：所有依赖完整。' : '[依赖检查] 失败：依赖不完整。');
  process.exit(ok ? 0 : 1);
}

module.exports = { ensureDependencies };
