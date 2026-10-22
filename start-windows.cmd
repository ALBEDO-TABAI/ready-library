@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.12 or newer from https://nodejs.org and try again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit((a===20&&b>=19)||(a===22&&b>=12)||a>22?0:1)"
if errorlevel 1 (
  echo Please upgrade Node.js to 22.12 or newer and try again.
  pause
  exit /b 1
)
call npm ci
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
echo Keep this window open while using Ready Library. Press Ctrl+C to stop.
node server/index.mjs --open
if errorlevel 1 goto failed
exit /b 0
:failed
echo Ready Library could not start. See the message above.
pause
exit /b 1
