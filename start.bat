@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 Node.js：https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo 首次运行，正在安装依赖，请稍候……
  set "NODE_OPTIONS=--use-system-ca"
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

set "NODE_OPTIONS="
call npm.cmd start
