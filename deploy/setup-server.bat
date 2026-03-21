@echo off
:: ============================================================================
::  setup-server.bat
::
::  Run ONCE on the DEDICATED SERVER machine (as Administrator).
::  Does everything needed to go from a fresh Windows machine to a running
::  flight monitor server.
::
::  Steps:
::    1. Checks Node.js is installed
::    2. Installs npm dependencies
::    3. Builds the React production bundle (dist/)
::    4. Opens Windows Firewall on port 3001
::    5. Installs the FlightMonitorServer Windows Service
:: ============================================================================

echo.
echo ============================================================
echo   Flight Monitor — Dedicated Server Setup
echo ============================================================
echo.

:: ── 1. Check Node.js ─────────────────────────────────────────────────────────
where node >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Node.js is not installed or not on PATH.
  echo         Download it from https://nodejs.org  (LTS version)
  echo         Then re-run this script.
  pause
  EXIT /B 1
)
FOR /F "tokens=*" %%V IN ('node --version') DO SET NODE_VER=%%V
echo [OK] Node.js %NODE_VER% found.

:: ── 2. Install npm dependencies ──────────────────────────────────────────────
echo.
echo [1/4] Installing npm dependencies...
call npm install
IF %ERRORLEVEL% NEQ 0 (
  echo [ERROR] npm install failed.
  pause
  EXIT /B 1
)

:: ── 3. Install node-windows (needed for service management) ──────────────────
echo.
echo [2/4] Installing node-windows...
call npm install node-windows
IF %ERRORLEVEL% NEQ 0 (
  echo [ERROR] node-windows install failed.
  pause
  EXIT /B 1
)

:: ── 4. Build the React app ───────────────────────────────────────────────────
echo.
echo [3/4] Building React production bundle (this may take a minute)...
call npm run build
IF %ERRORLEVEL% NEQ 0 (
  echo [ERROR] npm run build failed.
  pause
  EXIT /B 1
)
echo [OK] Production build complete — dist/ folder is ready.

:: ── 5. Open firewall port 3001 ───────────────────────────────────────────────
echo.
echo [4/4] Opening Windows Firewall on port 3001...
netsh advfirewall firewall show rule name="FlightMonitor" >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
  echo [OK] Firewall rule already exists — skipping.
) ELSE (
  netsh advfirewall firewall add rule ^
    name="FlightMonitor" ^
    dir=in ^
    action=allow ^
    protocol=TCP ^
    localport=3001
  echo [OK] Firewall rule added for TCP port 3001.
)

:: ── 6. Install Windows Service ───────────────────────────────────────────────
echo.
echo [5/5] Installing FlightMonitorServer as a Windows Service...
call npm run install-service
IF %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Service installation failed. Make sure you are running as Administrator.
  pause
  EXIT /B 1
)

echo.
echo ============================================================
echo   Setup complete!
echo.
echo   The FlightMonitorServer Windows Service is now running.
echo   It will start automatically on every reboot.
echo.
echo   Test it: open a browser and go to http://localhost:3001
echo.
echo   To view service logs:
echo     Windows Event Viewer > Application > FlightMonitorServer
echo ============================================================
echo.
pause
