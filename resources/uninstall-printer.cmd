@echo off
rem 1C-Mail: удаление виртуального принтера при деинсталляции.
setlocal
set "SCRIPTSDIR=%~dp0scripts"
if not exist "%SCRIPTSDIR%\uninstall-printer.ps1" (
  echo [1C-Mail] scripts\uninstall-printer.ps1 не найден в %SCRIPTSDIR%
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPTSDIR%\uninstall-printer.ps1"
exit /b %errorlevel%
