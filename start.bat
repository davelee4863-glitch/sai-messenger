@echo off
cd /d "%~dp0"
echo Starting...

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo NPM failed!
    pause
    exit /b 1
  )
)

if not exist .env (
  echo First run - enter API keys:
  set /p DEEPSEEK_API_KEY=DeepSeek API key (Enter to skip):
  set /p OPENAI_API_KEY=OpenAI API key (Enter to skip):
  echo DEEPSEEK_API_KEY=%DEEPSEEK_API_KEY%>.env
  echo OPENAI_API_KEY=%OPENAI_API_KEY%>>.env
  echo PORT=3101>>.env
  echo Saved.
)

for /f "usebackq tokens=1* delims==" %%a in (".env") do (
  if not "%%b"=="" set "%%a=%%b"
)
if "%PORT%"=="" set PORT=3101

echo.
echo SAI Messenger: http://localhost:%PORT%
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js not found!
  pause
  exit /b 1
)

node server.js
echo.
echo Server stopped or crashed.
pause
