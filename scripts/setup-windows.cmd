@echo off
setlocal
cd /d "%~dp0.."
echo.
echo Vidsync setup (run after: git pull)
echo.
call npm run setup
exit /b %ERRORLEVEL%
