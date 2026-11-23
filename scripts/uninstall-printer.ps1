#Requires -RunAsAdministrator
<#
  1C-Mail: удаление виртуального принтера (очередь + порт).
  Данные (база клиентов, журнал, настройки) не трогаем.
#>
[CmdletBinding()]
param(
  [string]$PrinterName = '1C-Mail',
  [string]$PortFile = ''
)

$ErrorActionPreference = 'Stop'
$DataDir = Join-Path $env:ProgramData '1C-Mail'
if (-not $PortFile) { $PortFile = Join-Path $DataDir 'spool\capture.pdf' }
$LogFile = Join-Path (Join-Path $DataDir 'logs') 'install-printer.log'

function Log([string]$m) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch {}
  Write-Host $line
}

try {
  Log '==== Удаление виртуального принтера 1C-Mail ===='

  if (Get-Command Remove-Printer -ErrorAction SilentlyContinue) {
    if (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue) {
      Remove-Printer -Name $PrinterName
      Log ("Очередь удалена: {0}" -f $PrinterName)
    } else { Log ("Очереди нет — нечего удалять: {0}" -f $PrinterName) }
  } else {
    $p = Get-CimInstance -ClassName Win32_Printer -Filter ("Name='" + ($PrinterName -replace "'", "\'") + "'") -ErrorAction SilentlyContinue
    if ($p) { Remove-CimInstance -InputObject $p; Log "Очередь удалена (WMI): $PrinterName" }
  }

  if (Get-Command Remove-PrinterPort -ErrorAction SilentlyContinue) {
    if (Get-PrinterPort -Name $PortFile -ErrorAction SilentlyContinue) {
      Remove-PrinterPort -Name $PortFile
      Log ("Порт удалён: {0}" -f $PortFile)
    }
  } else {
    $portsKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Print\Monitors\Local Port\Ports'
    if (Get-ItemProperty -Path $portsKey -Name $PortFile -ErrorAction SilentlyContinue) {
      Remove-ItemProperty -Path $portsKey -Name $PortFile -ErrorAction SilentlyContinue
      Restart-Service -Name Spooler -Force
      Log ("Порт удалён через реестр: {0}" -f $PortFile)
    }
  }

  Log '==== Готово ===='
  exit 0
} catch {
  Log ("ОШИБКА: {0}" -f $_.Exception.Message)
  exit 1
}
