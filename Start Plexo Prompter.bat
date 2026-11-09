@echo off
rem Starts Plexo Prompter. Double-click this file.
cd /d "%~dp0"

rem "py" comes with Python from python.org. "python" covers other installs.
set "PYTHON="
where py >nul 2>nul && set "PYTHON=py"
if not defined PYTHON where python >nul 2>nul && set "PYTHON=python"
if not defined PYTHON goto nopython

rem Make sure it really runs and is new enough (3.8 or later). Output stays visible, so
rem a freshly installed Python can finish setting itself up here if it needs to.
%PYTHON% -c "import sys; sys.exit(sys.version_info < (3, 8))" || goto nopython

rem Start it without a black window staying open.
if "%PYTHON%"=="py" (start "" pyw prompter_server.py %*) else (start "" pythonw prompter_server.py %*)
exit /b

:nopython
echo.
echo   Plexo Prompter needs Python, a free program from python.org.
echo   It isn't installed on this computer yet.
echo.
echo   The download page will open now. Install Python, then
echo   double-click "Start Plexo Prompter" again.
echo.
start "" https://www.python.org/downloads/
pause
