@echo off
rem Abre la oficina (juego) en su propia ventana. Las ordenes a los hilos solo
rem se ejecutan mientras el panel "Oficina" este abierto en Claude.
cd /d "%~dp0"
start "Oficina de chats (servidor)" /min node server.js
timeout /t 2 /nobreak >nul
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:4317/ --window-size=1280,860
