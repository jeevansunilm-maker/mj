@echo off
REM Double-click to start Personal AI on Windows.
REM To start it automatically when you log in: press Win+R, type  shell:startup
REM and put a shortcut to this file in the folder that opens.
cd /d "%~dp0\.."
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Installing for the first time...
  call npm install || (pause & exit /b 1)
)
if not exist .env copy .env.example .env >nul
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
call npm start
pause
