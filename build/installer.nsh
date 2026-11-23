; 1C-Mail — кастомные секции NSIS-инсталлятора.
; Скрипты принтера попадают в %INSTDIR%\resources\scripts благодаря extraResources
; (см. package.json -> build.extraResources). Данные программы (база клиентов,
; журнал, spool) живут в %ProgramData%\1C-Mail и НЕ удаляются при деинсталляции,
; чтобы при обновлении новая версия подхватила накопленную базу.
;
; ВНИМАНИЕ: в NSIS строки — только в ДВОЙНЫХ кавычках. Пути с возможными
; пробелами оборачиваем так: "$\"путь$\"" либо запускаем .cmd с внешними кавычками.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "1C-Mail: установка виртуального принтера 1C-Mail..."
  nsExec::ExecToLog '"$INSTDIR\resources\install-printer.cmd"'
  Pop $0
  ${If} $0 == 0
    DetailPrint "1C-Mail: виртуальный принтер 1C-Mail установлен."
  ${Else}
    DetailPrint "1C-Mail: установка принтера завершилась с кодом $0 (см. %ProgramData%\1C-Mail\logs\install-printer.log)"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "1C-Mail: удаление виртуального принтера..."
  nsExec::ExecToLog '"$INSTDIR\resources\uninstall-printer.cmd"'
  Pop $0
  DetailPrint "1C-Mail: данные в %ProgramData%\1C-Mail сохранены (база клиентов и журнал)."
!macroend
