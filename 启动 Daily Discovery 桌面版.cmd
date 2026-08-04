@echo off
setlocal
cd /d "%~dp0"
call npm.cmd run desktop
endlocal
