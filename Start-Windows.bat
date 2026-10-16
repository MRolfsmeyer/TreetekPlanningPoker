@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Treetek Planning Poker
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js ist nicht installiert.
  echo Bitte einmalig die LTS-Version von https://nodejs.org installieren und dann diese Datei erneut starten.
  echo.
  pause
  exit /b 1
)
node server.js
pause
