@echo off
rem Starts Plexo Prompter. Double-click this file.
rem If Python isn't installed, it explains why it's needed and offers to install it.
cd /d "%~dp0"

call :find_python
if defined PYTHON goto start

echo.
echo   Plexo Prompter needs Python, a free program from python.org, to run on
echo   your computer. It isn't installed yet.
echo.
where winget >nul 2>nul || goto manual
choice /c YN /m "  Install Python now? It takes about a minute"
if errorlevel 2 goto manual

echo.
echo   Installing Python 3.14 for you. Please wait...
echo.
winget install --exact --id Python.Python.3.14 --scope user --silent --accept-package-agreements --accept-source-agreements
call :find_python
if not defined PYTHON (
  echo.
  echo   That didn't work.
  goto manual
)
echo.
echo   Python is ready. Starting Plexo Prompter...

:start
rem pythonw runs it without leaving a black window open.
start "" "%PYTHONW%" prompter_server.py %*
exit /b

:manual
echo.
echo   The Python download page will open now. Install Python, then
echo   double-click "Start Plexo Prompter" again.
echo.
start "" https://www.python.org/downloads/
pause
exit /b

:find_python
rem Finds Python 3.8 or later. Sets PYTHON (to check it) and PYTHONW (to run without a window).
set "PYTHON="
set "PYTHONW="
rem "py" comes with Python from python.org. Its check stays visible, so a newly installed
rem Python can finish setting itself up if it needs to ask anything.
where py >nul 2>nul && py -c "import sys; sys.exit(sys.version_info < (3, 8))" && (set "PYTHON=py" & set "PYTHONW=pyw" & exit /b)
rem "python" also covers other installs. Its check is hidden, because on a PC without Python,
rem Windows answers with a placeholder that only prints a Microsoft Store message.
where python >nul 2>nul && python -c "import sys; sys.exit(sys.version_info < (3, 8))" >nul 2>nul && (set "PYTHON=python" & set "PYTHONW=pythonw" & exit /b)
rem Just installed: this window doesn't know where Python went yet, so look where it installs.
for %%D in ("%LOCALAPPDATA%\Programs\Python\Launcher" "%LOCALAPPDATA%\Programs\Python\Python314") do (
  if exist "%%~D\pyw.exe" if not defined PYTHON (set "PYTHON=%%~D\py.exe" & set "PYTHONW=%%~D\pyw.exe")
  if exist "%%~D\pythonw.exe" if not defined PYTHON (set "PYTHON=%%~D\python.exe" & set "PYTHONW=%%~D\pythonw.exe")
)
exit /b
