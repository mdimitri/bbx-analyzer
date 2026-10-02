@echo off
rem BBX Analyzer launcher for Windows. Double-click this file.
rem First run sets everything up inside this folder (.venv, .tools); later runs start in a few seconds.
rem Nothing is installed system-wide. Close this window to stop BBX.
setlocal EnableExtensions
title BBX Analyzer
cd /d "%~dp0"
echo.
echo   bbx analyzer  -  Betaflight blackbox logs, turned into answers
echo   ------------------------------------------------------------

rem ---- must be a real, writable folder (not inside a zip preview)
set "HERE=%~dp0"
if /i not "%HERE:\AppData\Local\Temp\=%"=="%HERE%" goto :inzip
type nul > ".write_test" 2>nul || goto :readonly
del ".write_test" >nul 2>&1

set "PORT=8000"
set "VPY=%CD%\.venv\Scripts\python.exe"
set "PYCMD="
set "USEDUV="
set "CHECK=import sys; sys.exit(0 if (3,10)<=sys.version_info[:2]<=(3,13) else 1)"

rem ---- 1. existing environment still good?
if not exist "%VPY%" goto :findpy
"%VPY%" -c "%CHECK%" >nul 2>&1 && goto :pkgs
rmdir /s /q ".venv" >nul 2>&1

:findpy
rem ---- 2. a suitable Python (3.10 - 3.13); newest releases sometimes lack ready-made packages, so known-good ones first
for %%V in (3.13 3.12 3.11 3.10) do (
  py -%%V -c "%CHECK%" >nul 2>&1 && set "PYCMD=py -%%V" && goto :mkvenv
)
python -c "%CHECK%" >nul 2>&1 && set "PYCMD=python" && goto :mkvenv
goto :uvvenv

:mkvenv
echo ^> First run: setting up (1-3 minutes, needs internet once)...
%PYCMD% -m venv ".venv" >nul 2>&1 && goto :pkgs
rmdir /s /q ".venv" >nul 2>&1
goto :uvvenv

:uvvenv
rem ---- no usable Python: fetch a private one with 'uv' (a small Python manager) into .tools
if exist ".tools\uv.exe" goto :uvmake
echo ^> No suitable Python found: downloading a private Python 3.12 into this folder (one time, about 40 MB)...
if not exist ".tools" mkdir ".tools"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $env:UV_INSTALL_DIR=(Resolve-Path '.tools').Path; $env:UV_NO_MODIFY_PATH='1'; $env:INSTALLER_NO_MODIFY_PATH='1'; irm https://astral.sh/uv/install.ps1 | iex" >nul 2>&1
if not exist ".tools\uv.exe" if exist ".tools\bin\uv.exe" move /y ".tools\bin\uv.exe" ".tools\uv.exe" >nul 2>&1
if not exist ".tools\uv.exe" goto :nopython
:uvmake
set "USEDUV=1"
rmdir /s /q ".venv" >nul 2>&1
set "UV_PYTHON_INSTALL_DIR=%CD%\.tools\python"
set "UV_CACHE_DIR=%CD%\.tools\cache"
".tools\uv.exe" venv --seed --python 3.12 ".venv" >nul 2>&1 || goto :nopython

:pkgs
rem ---- 3. packages, only when requirements.txt changed
fc /b requirements.txt ".venv\.installed" >nul 2>&1 && goto :shortcut
echo ^> Installing the analysis packages (1-3 minutes, please wait)...
call :install || goto :pkgfail
copy /y requirements.txt ".venv\.installed" >nul
goto :shortcut

:pkgfail
if defined USEDUV goto :failnet
echo   Package install failed with this Python; retrying with a private Python 3.12...
goto :uvvenv

:install
"%VPY%" -m pip install --disable-pip-version-check -q --upgrade pip >nul 2>&1
"%VPY%" -m pip install --disable-pip-version-check -q -r requirements.txt || exit /b 1
rem orangebox (the .BBL decoder): its wheel has an entry point modern pip rejects, so unpack it directly
rmdir /s /q ".venv\dl" >nul 2>&1
"%VPY%" -m pip download --disable-pip-version-check -q --no-deps orangebox==0.5.0 -d ".venv\dl" || exit /b 1
"%VPY%" -c "import zipfile,glob,sysconfig; zipfile.ZipFile(glob.glob('.venv/dl/orangebox-*.whl')[0]).extractall(sysconfig.get_paths()['purelib'])" || exit /b 1
"%VPY%" -c "import fastapi, uvicorn, numpy, multipart, orangebox" || exit /b 1
exit /b 0

:shortcut
rem ---- 4. 'BBX Analyzer' shortcuts with the icon, on the Desktop and in this folder (once)
if exist ".venv\.shortcut" goto :run
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell; foreach($d in @([Environment]::GetFolderPath('Desktop'), (Get-Location).Path)){ $s=$w.CreateShortcut((Join-Path $d 'BBX Analyzer.lnk')); $s.TargetPath=(Join-Path (Get-Location).Path 'start.bat'); $s.WorkingDirectory=(Get-Location).Path; $s.IconLocation=(Join-Path (Get-Location).Path 'static\brand\bbx.ico'); $s.Description='BBX Analyzer - Betaflight blackbox analysis'; $s.Save() }" >nul 2>&1
echo ^> Added a 'BBX Analyzer' shortcut to your Desktop.
type nul > ".venv\.shortcut"

:run
rem ---- 5. free port, start the server, open the browser when it answers
"%VPY%" -c "import socket,sys; s=socket.socket(); sys.exit(s.connect_ex(('127.0.0.1',%PORT%))!=0)" >nul 2>&1
if errorlevel 1 goto :portok
set /a PORT+=1
goto :run
:portok
set "URL=http://127.0.0.1:%PORT%"
echo.
echo   BBX Analyzer is starting:  %URL%
echo   Your browser opens by itself in a moment; if not, copy the address above into it.
echo   Keep this window open while you use it. Close it to stop BBX.
echo.
start "" /b "%VPY%" open_browser.py "%URL%"
"%VPY%" -m uvicorn app:app --host 127.0.0.1 --port %PORT% --log-level warning
echo.
echo !! BBX stopped. If this happened right away, the message above says why.
pause
exit /b 0

:inzip
echo.
echo !! It looks like you opened this from inside the zip file.
echo    Right-click the downloaded zip, choose "Extract All...", then open the extracted folder
echo    and double-click start.bat there.
pause
exit /b 1

:readonly
echo.
echo !! This folder is read-only. Move the BBX Analyzer folder to e.g. your Documents and run it from there.
pause
exit /b 1

:nopython
echo.
echo !! Could not set up Python automatically (no internet, or downloads blocked).
echo    Install Python 3.12 from https://www.python.org/downloads/
echo    IMPORTANT: tick "Add python.exe to PATH" in the installer. Then double-click start.bat again.
pause
exit /b 1

:failnet
echo.
echo !! Installing the analysis packages failed. Check your internet connection and run start.bat again.
echo    If it keeps failing, open an issue on GitHub and paste the lines above.
pause
exit /b 1
