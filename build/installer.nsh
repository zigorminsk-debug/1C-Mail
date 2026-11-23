; 1C-Mail — кастомные секции NSIS-инсталлятора.
; Скрипты принтера попадают в %INSTDIR%\resources\scripts благодаря extraResources
; (см. package.json -> build.extraResources). Данные программы (база клиентов,
; журнал, spool) живут в %ProgramData%\1C-Mail и НЕ удаляются при деинсталляции,
; чтобы при обновлении новая версия подхватила накопленную базу.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "1C-Mail: установка виртуального принтера 1C-Mail..."
  SetOutPath "$INSTDIR\resources\scripts"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\scripts\install-printer.ps1"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "1C-Mail: установка принтера завершилась с кодом $0 (см. %ProgramData%\1C-Mail\logs\install-printer.log)"
  ${Else}
    DetailPrint "1C-Mail: виртуальный принтер 1C-Mail установлен."
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "1C-Mail: удаление виртуального принтера..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\scripts\uninstall-printer.ps1"'
  Pop $0
  DetailPrint "1C-Mail: данные в %ProgramData%\1C-Mail сохранены (база клиентов и журнал)."
!macroend
