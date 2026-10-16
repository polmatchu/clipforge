@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel% equ 0 (
  set "PY=py -3"
) else (
  set "PY=python"
)
echo Installing/updating the free YouTube import helper...
%PY% -m pip install --upgrade "yt-dlp[default]"
if errorlevel 1 (
  echo Could not install yt-dlp. Please install Python 3.10+ first.
  pause
  exit /b 1
)
echo.
where deno >nul 2>nul
if errorlevel 1 (
  echo WARNING: Deno was not found. Recent YouTube videos may require Deno 2.3 or later.
  echo Install Deno from https://docs.deno.com/runtime/getting_started/installation/
  echo Then close and reopen this launcher.
  echo.
)
echo Leave this window open, then import a YouTube URL in ClipForge.
%PY% tools\clipforge_companion.py
pause
