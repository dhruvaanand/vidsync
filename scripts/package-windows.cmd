@echo off
REM Package Vidsync on Windows and capture a log if packaging fails.
cd /d "%~dp0.."
call npm run kill:vidsync
echo Running npm run package (log: package.log) ...
call npm run package > package.log 2>&1
if exist "out\Vidsync-win32-x64\vidsync.exe" (
  echo.
  echo OK: out\Vidsync-win32-x64\vidsync.exe
  echo Run: out\Vidsync-win32-x64\vidsync.exe
  exit /b 0
)
echo.
echo FAIL: no out\Vidsync-win32-x64\vidsync.exe — see package.log
type package.log
exit /b 1
