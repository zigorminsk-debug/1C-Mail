@echo off
rem 1C-Mail: запуск установки виртуального принтера из каталога установки.
rem Запускается с правами администратора из NSIS-инсталлятора.
setlocal
set "SCRIPTSDIR=%~dp0scripts"
if not exist "%SCRIPTSDIR%\install-printer.ps1" (
  echo [1C-Mail] scripts\install-printer.ps1 не найден в %SCRIPTSDIR%
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPTSDIR%\install-printer.ps1"
exit /b %errorlevel%
