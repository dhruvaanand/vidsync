@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0\.."

echo ============================================================
echo VIDSYNC MPV DIAGNOSTICS
echo ============================================================
echo Time: %DATE% %TIME%
echo CWD:  %CD%
echo.

echo --- [1] Git / repo ---
git rev-parse --short HEAD 2>nul || echo git: unavailable
git status -sb 2>nul
if exist scripts\copy-mpv-runtime.js (echo script copy-mpv-runtime.js: YES) else (echo script copy-mpv-runtime.js: NO ^(git pull needed^))
if exist scripts\test-mpv.js (echo script test-mpv.js: YES) else (echo script test-mpv.js: NO)
echo.

echo --- [2] Node toolchain ---
where node 2>nul || echo where node: NOT FOUND
node -v 2>nul || echo node -v: FAILED
node -p "process.platform + ' ' + process.arch + ' modules=' + process.versions.modules" 2>nul
echo.

echo --- [3] Native build output ---
if exist native\mpv-addon\build\Release\mpv_addon.node (
  echo mpv_addon.node: YES
  dir native\mpv-addon\build\Release\mpv_addon.node
) else (
  echo mpv_addon.node: NO
)
if exist native\mpv-addon\build\Release\libmpv-2.dll (
  echo libmpv-2.dll: YES
  dir native\mpv-addon\build\Release\libmpv-2.dll
) else (
  echo libmpv-2.dll: NO
)
echo DLLs in Release:
dir /b native\mpv-addon\build\Release\*.dll 2>nul
for /f %%A in ('dir /b native\mpv-addon\build\Release\*.dll 2^>nul ^| find /c /v ""') do echo DLL count: %%A
echo.

echo --- [4] Build inputs (headers/import lib) ---
if exist native\mpv-addon\deps\include\mpv\client.h (echo deps client.h: YES) else (echo deps client.h: NO)
if exist native\mpv-addon\deps\lib\mpv.lib (echo deps mpv.lib: YES) else (echo deps mpv.lib: NO)
echo.

echo --- [5] MSYS2 / libmpv source ---
if exist C:\msys64\ucrt64\bin\libmpv-2.dll (echo C:\msys64\ucrt64\bin\libmpv-2.dll: YES) else (echo C:\msys64\ucrt64\bin\libmpv-2.dll: NO)
if exist C:\msys64\usr\bin\bash.exe (echo C:\msys64\usr\bin\bash.exe: YES) else (echo bash.exe: NO)
if exist C:\msys64\usr\bin\ldd.exe (echo C:\msys64\usr\bin\ldd.exe: YES) else (echo usr ldd.exe: NO)
if exist C:\msys64\ucrt64\bin\ldd.exe (echo C:\msys64\ucrt64\bin\ldd.exe: YES) else (echo ucrt64 ldd.exe: NO)
echo Sample ffmpeg DLLs in ucrt64\bin:
dir /b C:\msys64\ucrt64\bin\avcodec*.dll 2>nul
dir /b C:\msys64\ucrt64\bin\avformat*.dll 2>nul
echo.

echo --- [6] copy-mpv-runtime (re-run) ---
call npm run copy-mpv-runtime
echo.

echo --- [7] ldd dependency tree (MSYS2 bash) ---
if exist C:\msys64\usr\bin\bash.exe (
  for /f "delims=" %%I in ('node -p "('/'+process.cwd()[0].toLowerCase()+process.cwd().slice(2).replace(/\\\\/g,'/')+'/native/mpv-addon/build/Release/libmpv-2.dll')"') do set "MSYS_MPVDLL=%%I"
  echo ldd target: !MSYS_MPVDLL!
  C:\msys64\usr\bin\bash.exe -lc "ldd '!MSYS_MPVDLL!'" 2>&1
) else (
  echo bash not found - skip ldd
)
echo.

echo --- [8] TEST A: load addon with Release ONLY on PATH ---
set "PATH=%CD%\native\mpv-addon\build\Release;%PATH%"
node -e "const a=require('path').resolve('native/mpv-addon/build/Release/mpv_addon.node');try{const {MpvPlayer}=require(a);new MpvPlayer(0).destroy();console.log('TEST A: PASS');}catch(e){console.log('TEST A: FAIL -',e.message);}"
echo.

echo --- [9] TEST B: load addon with Release + ucrt64\bin on PATH ---
set "PATH=%CD%\native\mpv-addon\build\Release;C:\msys64\ucrt64\bin;%PATH%"
node -e "const a=require('path').resolve('native/mpv-addon/build/Release/mpv_addon.node');try{const {MpvPlayer}=require(a);new MpvPlayer(0).destroy();console.log('TEST B: PASS');}catch(e){console.log('TEST B: FAIL -',e.message);}"
echo.

echo --- [10] TEST C: Vidsync worker (npm run test:mpv) ---
call npm run test:mpv
echo.

echo --- [11] Optional: mpv CLI (if installed separately) ---
where mpv 2>nul || echo mpv.exe not on PATH
echo.

echo ============================================================
echo DONE - paste ALL output above back to support
echo ============================================================
endlocal
