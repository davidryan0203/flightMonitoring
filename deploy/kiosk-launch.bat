@echo off
:: ============================================================================
::  kiosk-launch.bat
::
::  Deploys via GPO on each kiosk PC:
::    Computer Configuration > Windows Settings > Scripts > Startup
::    — OR —
::    User Configuration > Windows Settings > Scripts > Logon
::
::  What it does:
::    1. Waits for the dedicated server to be reachable on the network
::    2. Launches Chrome in full-screen kiosk mode pointing at the server
::    3. Chrome shows the flight display — no address bar, no tabs, no UI
::
::  !! CHANGE SERVER_IP BELOW to the dedicated server's static IP !!
:: ============================================================================

SET SERVER_IP=192.168.1.100
SET SERVER_PORT=3001
SET APP_URL=http://%SERVER_IP%:%SERVER_PORT%

:: Path to Chrome — adjust if installed in a different location
SET CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
SET CHROME_X86="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

:: ── Wait for server to be reachable (retry up to 10 times, 3 s apart) ───────
SET /A RETRIES=0
:WAIT_LOOP
ping -n 2 %SERVER_IP% >nul 2>&1
IF %ERRORLEVEL% EQU 0 GOTO LAUNCH
SET /A RETRIES=%RETRIES%+1
IF %RETRIES% GEQ 10 (
  echo [FlightMonitor] WARNING: Server unreachable after 10 retries. Launching anyway.
  GOTO LAUNCH
)
echo [FlightMonitor] Waiting for server... attempt %RETRIES%/10
timeout /t 3 /nobreak >nul
GOTO WAIT_LOOP

:LAUNCH
:: ── Detect Chrome installation path ─────────────────────────────────────────
IF EXIST %CHROME% (
  SET CHROME_EXE=%CHROME%
) ELSE IF EXIST %CHROME_X86% (
  SET CHROME_EXE=%CHROME_X86%
) ELSE (
  echo [FlightMonitor] ERROR: Chrome not found. Please install Google Chrome.
  pause
  EXIT /B 1
)

:: ── Launch Chrome in kiosk mode ──────────────────────────────────────────────
echo [FlightMonitor] Launching kiosk display -> %APP_URL%
start "" %CHROME_EXE% ^
  --kiosk ^
  --app=%APP_URL% ^
  --no-first-run ^
  --disable-infobars ^
  --disable-session-crashed-bubble ^
  --disable-restore-session-state ^
  --disable-pinch ^
  --overscroll-history-navigation=0 ^
  --autoplay-policy=no-user-gesture-required ^
  --disable-features=TranslateUI ^
  --noerrdialogs

EXIT /B 0
