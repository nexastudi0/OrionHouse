@echo off
setlocal
cd /d "%~dp0"
set PORT=8765

where py >nul 2>&1
if %errorlevel%==0 (
  start "Orion Home - Servidor" /min py -3 -m http.server %PORT% --bind 127.0.0.1
  timeout /t 2 /nobreak >nul
  start "" "http://localhost:%PORT%"
  exit /b
)

where python >nul 2>&1
if %errorlevel%==0 (
  start "Orion Home - Servidor" /min python -m http.server %PORT% --bind 127.0.0.1
  timeout /t 2 /nobreak >nul
  start "" "http://localhost:%PORT%"
  exit /b
)

where npx >nul 2>&1
if %errorlevel%==0 (
  start "Orion Home - Servidor" /min cmd /c npx --yes http-server . -p %PORT% -a 127.0.0.1
  timeout /t 4 /nobreak >nul
  start "" "http://localhost:%PORT%"
  exit /b
)

echo.
echo Nao encontrei Python nem Node.js neste computador.
echo Para manter a permissao do microfone, publique a pasta em HTTPS
 echo (por exemplo GitHub Pages/Hostinger) e abra pelo endereco do site.
echo.
pause
