'use strict';
/** Управление виртуальным принтером через PowerShell-скрипты. */
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function isElevated() {
  if (process.platform !== 'win32') return false;
  const r = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
    ],
    { encoding: 'utf8', windowsHide: true }
  );
  return String(r.stdout || '').trim() === 'True';
}

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/**
 * Запуск PowerShell-скрипта.
 * @param {object} opts { scriptsDir, printerName, portFile, elevated }
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
function runScript(scriptName, args, opts = {}) {
  return new Promise((resolve) => {
    const script = path.join(opts.scriptsDir, scriptName);
    const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script];
    for (const [k, v] of Object.entries(args || {})) {
      if (v === undefined || v === null) continue;
      psArgs.push('-' + k, String(v));
    }

    let child;
    if (opts.elevated && !isElevated()) {
      // Подъём прав через UAC: Start-Process -Verb RunAs -Wait
      const argList = '[' + psArgs.map(psQuote).join(',') + ']';
      const cmd =
        "$p = Start-Process -FilePath 'powershell.exe' -ArgumentList " +
        argList +
        ' -Verb RunAs -Wait -PassThru; exit $p.ExitCode';
      child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
        windowsHide: true
      });
    } else {
      child = spawn('powershell.exe', psArgs, { windowsHide: true });
    }

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code: code == null ? -1 : code, stdout, stderr }));
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: String(e) }));
  });
}

/** Статус принтера → { installed, spooler, printerName, driverName, portName, shared, error } */
async function printerStatus(opts) {
  const res = await runScript('status-printer.ps1', { PrinterName: opts.printerName }, opts);
  const out = (res.stdout || '').trim();
  try {
    const jsonLine = out.split(/\r?\n/).filter(Boolean).pop();
    const obj = JSON.parse(jsonLine);
    obj.exitCode = res.code;
    if (res.code !== 0 && !obj.error) obj.error = res.stderr || 'exit ' + res.code;
    return obj;
  } catch (_) {
    return { installed: false, printerName: opts.printerName, error: res.stderr || out || ('exit ' + res.code) };
  }
}

async function installPrinter(opts) {
  return runScript('install-printer.ps1', {
    PrinterName: opts.printerName,
    PortFile: opts.portFile
  }, Object.assign({ elevated: true }, opts));
}

async function uninstallPrinter(opts) {
  return runScript('uninstall-printer.ps1', {
    PrinterName: opts.printerName,
    PortFile: opts.portFile
  }, Object.assign({ elevated: true }, opts));
}

/** Печать тестовой страницы через драйвер (попадёт в capture.pdf → в «Отложенные»). */
async function printTestPage(opts) {
  const cmd =
    '$p = Get-CimInstance Win32_Printer -Filter ' +
    psQuote("Name='" + String(opts.printerName).replace(/'/g, "\\'") + "'") +
    '; if (-not $p) { Write-Error "printer not found"; exit 1 }; $r = Invoke-CimMethod -InputObject $p -MethodName PrintTestPage; exit $r.ReturnValue';
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
      windowsHide: true
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code: code == null ? -1 : code, stderr }));
    child.on('error', (e) => resolve({ code: -1, stderr: String(e) }));
  });
}

module.exports = { printerStatus, installPrinter, uninstallPrinter, printTestPage, isElevated };
