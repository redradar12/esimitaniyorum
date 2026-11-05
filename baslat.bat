@echo off
chcp 65001 >nul
title Seni Taniyorum
cd /d "%~dp0"

if not exist node_modules (
  echo Paketler yukleniyor, lutfen bekleyin...
  call npm install --no-audit --no-fund
)

start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:4173'"
node server.js

echo.
echo Sunucu kapandi. Kapatmak icin bir tusa basin.
pause >nul
