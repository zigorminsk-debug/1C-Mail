#Requires -RunAsAdministrator
<#
  1C-Mail: установка/восстановление виртуального принтера.
  Создаёт файловый порт (фиксированный PDF-файл) и очередь печати
  "Microsoft Print to PDF", в которую 1С отправляет документы на печать.
#>
[CmdletBinding()]
param(
  [string]$PrinterName = '1C-Mail',
  [string]$PortFile = '',
  [switch]$NoShare
)

$ErrorActionPreference = 'Stop'
$DataDir    = Join-Path $env:ProgramData '1C-Mail'
if (-not $PortFile) { $PortFile = Join-Path $DataDir 'spool\capture.pdf' }
$LogDir     = Join-Path $DataDir 'logs'
$ScriptDir  = Join-Path $DataDir 'scripts'
New-Item -ItemType Directory -Force -Path $LogDir, $ScriptDir, (Split-Path -Parent $PortFile) | Out-Null
$LogFile = Join-Path $LogDir 'install-printer.log'

function Log([string]$m) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch {}
  Write-Host $line
}

function Enable-PdfFeature {
  $features = @(
    'Printing-PrintToPDFServices-Features',
    'Printing-PrintToPDFServices'
  )
  foreach ($f in $features) {
    try {
      Log "Пробуем включить компонент Windows: $f"
      $r = Enable-WindowsOptionalFeature -Online -FeatureName $f -All -NoRestart -ErrorAction Stop
      Log ("  включён. RestartNeeded={0}" -f $r.RestartNeeded)
      return $true
    } catch { Log ("  не удалось: {0}" -f $_.Exception.Message) }
    try {
      $p = Start-Process -FilePath 'dism.exe' -ArgumentList @('/Online','/Enable-Feature',('/FeatureName:' + $f),'/All','/NoRestart') -Wait -PassThru -WindowStyle Hidden
      Log ("  dism.exe {0}: exit={1}" -f $f, $p.ExitCode)
      if ($p.ExitCode -eq 0 -or $p.ExitCode -eq 3010) { return $true }
    } catch { Log ("  dism.exe не запустился: {0}" -f $_.Exception.Message) }
  }
  return $false
}

function Get-PdfDriverName {
  if (Get-Command Get-PrinterDriver -ErrorAction SilentlyContinue) {
    $d = Get-PrinterDriver -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match 'PDF' } |
      Select-Object -First 1
    if ($d) { return $d.Name }
    foreach ($n in @('Microsoft Print to PDF', 'Microsoft Print To PDF')) {
      if (Get-PrinterDriver -Name $n -ErrorAction SilentlyContinue) { return $n }
    }
  }
  return $null
}

function Ensure-Port {
  $existing = $null
  if (Get-Command Get-PrinterPort -ErrorAction SilentlyContinue) {
    $existing = Get-PrinterPort -Name $PortFile -ErrorAction SilentlyContinue
  }
  if ($existing) { Log ("Порт уже существует: {0}" -f $PortFile); return }

  try {
    Add-PrinterPort -Name $PortFile -ErrorAction Stop | Out-Null
    Log ("Создан файловый порт (Add-PrinterPort): {0}" -f $PortFile)
    return
  } catch { Log ("Add-PrinterPort не сработал: {0}" -f $_.Exception.Message) }

  # Fallback: запись имени порта в реестр монитора Local Port + перезапуск спулера
  $portsKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Print\Monitors\Local Port\Ports'
  if (-not (Test-Path $portsKey)) { New-Item -Path $portsKey -Force | Out-Null }
  New-ItemProperty -Path $portsKey -Name $PortFile -Value '' -PropertyType String -Force | Out-Null
  Log "Порт добавлен через реестр Local Port; перезапуск службы печати..."
  Restart-Service -Name Spooler -Force
  Start-Sleep -Seconds 4
}

function Remove-ExistingPrinter {
  if (Get-Command Remove-Printer -ErrorAction SilentlyContinue) {
    if (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue) {
      Remove-Printer -Name $PrinterName -ErrorAction Stop
      Log ("Удалена старая очередь: {0}" -f $PrinterName)
    }
  } else {
    $p = Get-CimInstance -ClassName Win32_Printer -Filter ("Name='" + ($PrinterName -replace "'", "\'") + "'") -ErrorAction SilentlyContinue
    if ($p) { Remove-CimInstance -InputObject $p; Log "Удалена старая очередь (WMI): $PrinterName" }
  }
}

function New-PrinterQueue([string]$DriverName) {
  $shared = -not $NoShare
  if (Get-Command Add-Printer -ErrorAction SilentlyContinue) {
    $params = @{ Name = $PrinterName; DriverName = $DriverName; PortName = $PortFile }
    if ($shared) { $params['Shared'] = $true; $params['ShareName'] = $PrinterName }
    Add-Printer @params -ErrorAction Stop | Out-Null
    Log ("Создана очередь печати: {0} (драйвер: {1}, порт: {2}, общий: {3})" -f $PrinterName, $DriverName, $PortFile, $shared)
    return
  }
  # Fallback: WMI
  $pr = [wmiclass]'Win32_Printer'
  $res = $pr.Create($PrinterName, $DriverName, $PortFile, '1C-Mail virtual printer', '', [bool]$shared, $PrinterName)
  if ($res.ReturnValue -ne 0) { throw ("Win32_Printer.Create вернул код {0}" -f $res.ReturnValue) }
  Log ("Создана очередь печати через WMI: {0}" -f $PrinterName)
}

function Enable-ShareFirewall {
  try {
    Get-NetFirewallRule -ErrorAction SilentlyContinue |
      Where-Object { $_.Enabled -eq 'False' -and $_.DisplayGroup -match 'File and Printer|Файловая и печатная|печат' } |
      Enable-NetFirewallRule -ErrorAction SilentlyContinue
    Log "Правила брандмауэра для файловой и печатной совместности включены (best effort)"
  } catch { Log ("Брандмауэр: {0}" -f $_.Exception.Message) }
}

try {
  Log '==== Установка виртуального принтера 1C-Mail ===='
  Log ("Параметры: PrinterName={0}; PortFile={1}; NoShare={2}" -f $PrinterName, $PortFile, [bool]$NoShare)

  # 1. Служба печати
  $sp = Get-Service -Name Spooler -ErrorAction SilentlyContinue
  if ($sp -and $sp.Status -ne 'Running') { Start-Service -Name Spooler; Start-Sleep 2; Log 'Служба печати запущена' }

  # 2. Драйвер Microsoft Print to PDF
  $driver = Get-PdfDriverName
  if (-not $driver) {
    Log 'Драйвер Microsoft Print to PDF не найден — пробуем включить компонент...'
    [void](Enable-PdfFeature)
    Start-Sleep 3
    Restart-Service -Name Spooler -Force -ErrorAction SilentlyContinue
    Start-Sleep 3
    $driver = Get-PdfDriverName
  }
  if (-not $driver) { $driver = 'Microsoft Print to PDF'; Log "Драйвер не подтверждён; пробуем имя по умолчанию: $driver" }
  else { Log ("Используем драйвер: {0}" -f $driver) }

  # 3. Порт
  Ensure-Port

  # 4. Очередь печати (пересоздаём, если порт/драйвер не те)
  $cur = $null
  if (Get-Command Get-Printer -ErrorAction SilentlyContinue) {
    $cur = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
  } else {
    $cur = Get-CimInstance -ClassName Win32_Printer -Filter ("Name='" + ($PrinterName -replace "'", "\'") + "'") -ErrorAction SilentlyContinue
  }

  $needCreate = $true
  if ($cur) {
    $curPort = if ($cur.PortName) { $cur.PortName } else { $cur.PortName }
    if ($curPort -eq $PortFile) {
      $needCreate = $false
      Log ("Очередь уже существует и указывает на нужный порт: {0}" -f $PrinterName)
      # При необходимости включаем общий доступ
      if (-not $NoShare -and (Get-Command Set-Printer -ErrorAction SilentlyContinue)) {
        if (-not $cur.Shared) {
          try { Set-Printer -Name $PrinterName -Shared $true -ShareName $PrinterName -ErrorAction Stop; Log 'Очередь сделана общей' } catch { Log ("Не удалось сделать общей: {0}" -f $_.Exception.Message) }
        }
      }
    } else {
      Log ("Очередь существует, но порт другой ({0}) — пересоздаём" -f $curPort)
      Remove-ExistingPrinter
    }
  }

  if ($needCreate) {
    $created = $false
    try { New-PrinterQueue -DriverName $driver; $created = $true }
    catch {
      Log ("Создание очереди не удалось: {0}" -f $_.Exception.Message)
      if ($_.Exception.Message -match 'драйвер|driver|не найдена|not found|exists') {
        [void](Enable-PdfFeature)
        Start-Sleep 3
        $driver2 = Get-PdfDriverName
        if ($driver2) { $driver = $driver2 }
        try { New-PrinterQueue -DriverName $driver; $created = $true } catch { Log ("Повторная попытка не удалась: {0}" -f $_.Exception.Message) }
      }
    }
    if (-not $created) { throw 'Не удалось создать очередь печати 1C-Mail' }
  }

  # 5. Общий доступ: брандмауэр
  if (-not $NoShare) { Enable-ShareFirewall }

  # 6. Проверка
  $ok = $false
  if (Get-Command Get-Printer -ErrorAction SilentlyContinue) {
    $chk = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
    if ($chk) { $ok = $true; Log ("OK. Очередь '{0}': порт={1}, общий={2}" -f $PrinterName, $chk.PortName, $chk.Shared) }
  } else {
    $chk = Get-CimInstance -ClassName Win32_Printer -Filter ("Name='" + ($PrinterName -replace "'", "\'") + "'") -ErrorAction SilentlyContinue
    if ($chk) { $ok = $true; Log ("OK (WMI). Очередь '{0}': порт={1}" -f $PrinterName, $chk.PortName) }
  }
  if (-not $ok) { throw 'Очередь печати не найдена после создания' }

  # 7. Сохраняем актуальные параметры для приложения
  $cfgPath = Join-Path $DataDir 'printer.json'
  @{ printerName = $PrinterName; portFile = $PortFile; shared = (-not $NoShare); installedAt = (Get-Date -Format o) } |
    ConvertTo-Json | Set-Content -Path $cfgPath -Encoding UTF8
  Log ("Параметры принтера сохранены: {0}" -f $cfgPath)

  Log '==== Готово ===='
  exit 0
} catch {
  Log ("ОШИБКА: {0}" -f $_.Exception.Message)
  try { Log ($_ | Out-String) } catch {}
  Log '==== Завершено с ошибкой ===='
  exit 1
}
