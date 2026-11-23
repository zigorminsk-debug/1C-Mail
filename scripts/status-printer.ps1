# 1C-Mail: статус виртуального принтера → JSON в stdout
# (Get-Printer не требует прав администратора)
[CmdletBinding()]
param(
  [string]$PrinterName = '1C-Mail'
)
$ErrorActionPreference = 'SilentlyContinue'
$out = [ordered]@{
  printerName = $PrinterName
  installed   = $false
  spooler     = 'unknown'
  driverName  = $null
  portName    = $null
  shared      = $false
  shareName   = $null
  status      = $null
  error       = $null
}
try {
  $svc = Get-Service -Name Spooler
  $out.spooler = [string]$svc.Status
} catch { $out.spooler = 'missing' }

try {
  $p = $null
  if (Get-Command Get-Printer -ErrorAction SilentlyContinue) {
    $p = Get-Printer -Name $PrinterName
  }
  if (-not $p) {
    $p = Get-CimInstance -ClassName Win32_Printer -Filter ("Name='" + ($PrinterName -replace "'", "\'") + "'")
  }
  if ($p) {
    $out.installed = $true
    $out.driverName = [string]$p.DriverName
    $out.portName = [string]$p.PortName
    $out.shared = [bool]$p.Shared
    if ($p.PSObject.Properties['ShareName']) { $out.shareName = [string]$p.ShareName }
    $out.status = [string]$p.PrinterStatus
  }
} catch { $out.error = $_.Exception.Message }

ConvertTo-Json -InputObject $out -Compress
exit 0
