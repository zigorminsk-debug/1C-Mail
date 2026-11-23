'use strict';
/**
 * 1C-Mail — главный процесс Electron.
 * Виртуальный принтер «1C-Mail» принимает печать из 1С, PDF попадает в
 * capture.pdf → incoming/ → разбор реквизитов → база клиентов → SMTP.
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { DataStore, defaultDataDir } = require('./store');
const { SpoolWatcher } = require('./watcher');
const { extractFromPdf, parseRequisites } = require('./extract');
const { matchClients } = require('./match');
const { sendDocument, renderTemplate, sanitizeFilename } = require('./mailer');
const printer = require('./printer');

const isWin = process.platform === 'win32';
let mainWindow = null;
let tray = null;
let store = null;
let watcher = null;
let quitting = false;
const processing = new Set();

function scriptsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'scripts')
    : path.join(app.getAppPath(), 'scripts');
}

function resourcePath(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(app.getAppPath(), name);
}

function printerOpts() {
  const portFile = path.join(store.spoolDir, 'capture.pdf');
  return {
    scriptsDir: scriptsDir(),
    printerName: store.getSettings().printerName || '1C-Mail',
    portFile
  };
}

// ---------------------------------------------------------------- отправка
function decryptPassword(passEnc) {
  if (!passEnc) return '';
  try {
    if (passEnc.startsWith('enc:')) {
      const { safeStorage } = require('electron');
      return safeStorage.decryptString(Buffer.from(passEnc.slice(4), 'base64'));
    }
    if (passEnc.startsWith('b64:')) {
      return Buffer.from(passEnc.slice(4), 'base64').toString('utf8');
    }
  } catch (e) {
    console.error('decrypt failed', e);
  }
  return '';
}

function buildVars(parsed, client) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
  return {
    name: (client && client.name) || (parsed.names[0] || 'Клиент'),
    unp: (client && client.unp) || parsed.unps[0] || '',
    date: parsed.date || today,
    email: (client && client.email) || ''
  };
}

async function sendToClient({ filePath, parsed, client, email, journalId }) {
  const settings = store.getSettings();
  const vars = buildVars(parsed, client);
  const subject = renderTemplate(settings.mail.subject, vars);
  const body = renderTemplate(settings.mail.body, vars);
  const baseName = sanitizeFilename(`${vars.name}_${vars.unp || vars.date}`);
  const fileName = `${baseName}.pdf`;
  const password = decryptPassword(settings.passEnc);

  const result = await sendDocument({
    smtp: settings.smtp,
    password,
    subject,
    body,
    to: email,
    filePath,
    fileName
  });

  // успех: клиент запоминается (база «нарабатывается»), файл уходит в архив
  if (client && client.id) store.bumpSend(client.id);
  else if (email) {
    client = store.upsertClient({
      unp: parsed.unps[0] || '',
      name: parsed.names[0] || email,
      email
    });
    store.bumpSend(client.id);
  }

  const archivePath = path.join(store.archiveDir, path.basename(filePath));
  try {
    if (fs.existsSync(filePath)) fs.renameSync(filePath, archivePath);
  } catch (_) { /* файл может быть недоступен — не критично */ }

  if (journalId) {
    store.updateJournal(journalId, {
      status: 'sent',
      email,
      messageId: result && result.messageId,
      file: path.basename(archivePath),
      error: null
    });
  } else {
    store.addJournal({
      status: 'sent',
      unp: vars.unp,
      name: vars.name,
      email,
      file: path.basename(archivePath),
      source: path.basename(filePath)
    });
  }
  notify('Документ отправлен', `${vars.name} <${email}>`);
  broadcast('journal');
  return true;
}

function failJournal(journalId, error) {
  if (journalId) store.updateJournal(journalId, { status: 'failed', error: String(error) });
  else
    store.addJournal({
      status: 'failed',
      email: '',
      name: '',
      unp: '',
      file: '',
      error: String(error)
    });
  broadcast('journal');
}

// ------------------------------------------------------- обработка файла
async function processIncomingFile(filePath) {
  if (processing.has(filePath)) return;
  processing.add(filePath);
  try {
    let parsed;
    try {
      const buf = fs.readFileSync(filePath);
      const { text } = await extractFromPdf(buf);
      parsed = parseRequisites(text);
    } catch (e) {
      parsed = { text: '', unps: [], names: [], emails: [], date: null, parseError: String(e) };
    }

    const settings = store.getSettings();
    const clients = store.getClients();
    const match = matchClients(clients, parsed);

    const journalEntry = store.addJournal({
      status: 'received',
      unp: (match.client && match.client.unp) || parsed.unps[0] || '',
      name: (match.client && match.client.name) || parsed.names[0] || '',
      email: '',
      file: path.basename(filePath),
      source: path.basename(filePath)
    });
    broadcast('journal');

    const canAuto =
      settings.autoSend &&
      !settings.confirmEverySend &&
      match.type === 'exact' &&
      match.client &&
      match.client.email;

    if (canAuto) {
      try {
        await sendToClient({
          filePath,
          parsed,
          client: match.client,
          email: match.client.email,
          journalId: journalEntry.id
        });
        return;
      } catch (e) {
        failJournal(journalEntry.id, e);
        // падаем в ручной режим — покажем в «Отложенных»
      }
    }

    // ручной режим: ждём выбора адреса в GUI
    const item = {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      ts: new Date().toISOString(),
      file: filePath,
      journalId: journalEntry.id,
      unps: parsed.unps,
      names: parsed.names,
      emails: parsed.emails,
      date: parsed.date,
      matchType: match.type,
      candidates:
        match.type === 'candidates'
          ? match.candidates.map((c) => ({ id: c.client.id, name: c.client.name, unp: c.client.unp, email: c.client.email, score: c.score }))
          : match.type === 'exact'
          ? [{ id: match.client.id, name: match.client.name, unp: match.client.unp, email: match.client.email, score: 1 }]
          : [],
      suggestedEmail:
        (match.client && match.client.email) ||
        parsed.emails[0] ||
        ''
    };
    store.addPending(item);
    broadcast('pending');
    notify('Требуется адрес получателя', (item.names[0] || item.unps[0] || path.basename(filePath)));
    // показываем окно, чтобы оператор сразу выбрал адрес
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
    if (mainWindow) mainWindow.focus();
  } catch (e) {
    console.error('processIncomingFile', e);
    store.addJournal({ status: 'failed', file: path.basename(filePath), error: String(e), email: '', name: '', unp: '' });
    broadcast('journal');
  } finally {
    processing.delete(filePath);
  }
}

function scanIncoming() {
  let files = [];
  try {
    files = fs.readdirSync(store.incomingDir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
  } catch (_) { return; }
  for (const f of files) processIncomingFile(path.join(store.incomingDir, f));
}

// ------------------------------------------------------------- GUI helpers
function notify(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  } catch (_) { /* ignore */ }
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('evt', { channel, payload });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: '1C-Mail',
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    backgroundColor: '#12141a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('close', (e) => {
    const s = store.getSettings();
    if (!quitting && s.minimizeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, '..', 'renderer', 'tray.png'));
    const menu = Menu.buildFromTemplate([
      { label: 'Открыть 1C-Mail', click: () => { mainWindow && mainWindow.show(); } },
      { type: 'separator' },
      { label: 'Выход', click: () => { quitting = true; app.quit(); } }
    ]);
    tray.setToolTip('1C-Mail — печать из 1С по e-mail');
    tray.setContextMenu(menu);
    tray.on('double-click', () => { mainWindow && mainWindow.show(); });
  } catch (e) {
    console.error('tray', e);
  }
}

// ---------------------------------------------------------------- IPC
function registerIpc() {
  ipcMain.handle('settings:get', () => store.getSettings());

  ipcMain.handle('settings:set', async (_e, patch) => {
    // шифрование пароля SMTP через DPAPI (safeStorage)
    if (patch && patch.smtpPassword !== undefined) {
      const plain = String(patch.smtpPassword || '');
      delete patch.smtpPassword;
      let enc = '';
      if (plain) {
        try {
          const { safeStorage } = require('electron');
          enc = safeStorage.isEncryptionAvailable()
            ? 'enc:' + safeStorage.encryptString(plain).toString('base64')
            : 'b64:' + Buffer.from(plain, 'utf8').toString('base64');
        } catch (_) {
          enc = 'b64:' + Buffer.from(plain, 'utf8').toString('base64');
        }
      }
      patch.passEnc = enc;
    }
    const saved = store.saveSettings(patch || {});
    // автозагрузка
    try {
      app.setLoginItemSettings({
        openAtLogin: !!saved.startWithWindows,
        path: process.execPath,
        args: []
      });
    } catch (_) { /* ignore */ }
    if (patch && patch.printerName) broadcast('settings');
    return saved;
  });

  ipcMain.handle('clients:list', (_e, q) => store.getClients(q));
  ipcMain.handle('clients:save', (_e, c) => store.upsertClient(c));
  ipcMain.handle('clients:delete', (_e, id) => store.deleteClient(id));
  ipcMain.handle('clients:export', () => store.clientsToCsv());
  ipcMain.handle('clients:import', (_e, text) => store.importClientsCsv(text));

  ipcMain.handle('journal:list', (_e, limit) => store.getJournal(limit));
  ipcMain.handle('journal:retry', async (_e, journalId) => {
    const entry = store.getJournal(5000).find((j) => j.id === journalId);
    if (!entry) return { ok: false, error: 'Запись не найдена' };
    // повтор — из архива, если файл ещё там
    const arch = path.join(store.archiveDir, entry.file || '');
    const inc = path.join(store.incomingDir, entry.file || '');
    const file = fs.existsSync(arch) ? arch : fs.existsSync(inc) ? inc : null;
    if (!file) return { ok: false, error: 'Файл документа не найден' };
    const clients = store.getClients();
    const client =
      clients.find((c) => c.email && c.email === entry.email) ||
      clients.find((c) => c.unp && c.unp === entry.unp) ||
      null;
    const parsed = { unps: entry.unp ? [entry.unp] : [], names: entry.name ? [entry.name] : [], emails: entry.email ? [entry.email] : [], date: null, text: '' };
    try {
      await sendToClient({ filePath: file, parsed, client, email: entry.email || (client && client.email), journalId: entry.id });
      return { ok: true };
    } catch (e) {
      failJournal(entry.id, e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle('pending:list', () => store.getPending());

  ipcMain.handle('pending:resolve', async (_e, args) => {
    const item = store.getPendingItem(args.id);
    if (!item) return { ok: false, error: 'Запись не найдена' };
    const email = String(args.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Некорректный e-mail' };

    let client = null;
    if (args.clientId) client = store.getClients().find((c) => c.id === args.clientId) || null;
    if (!client && args.save !== false) {
      client = store.upsertClient({
        unp: item.unps[0] || '',
        name: item.names[0] || email,
        email,
        note: args.note || ''
      });
    }

    try {
      await sendToClient({
        filePath: item.file,
        parsed: { unps: item.unps, names: item.names, emails: item.emails, date: item.date, text: '' },
        client,
        email,
        journalId: item.journalId
      });
      store.removePending(item.id);
      broadcast('pending');
      return { ok: true };
    } catch (e) {
      if (item.journalId) failJournal(item.journalId, e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle('pending:remove', (_e, id) => {
    const item = store.getPendingItem(id);
    if (item) {
      try { if (fs.existsSync(item.file)) fs.unlinkSync(item.file); } catch (_) { /* ignore */ }
      if (item.journalId) store.updateJournal(item.journalId, { status: 'skipped' });
      store.removePending(id);
      broadcast('pending');
      broadcast('journal');
    }
    return { ok: true };
  });

  // ---- принтер ----
  ipcMain.handle('printer:status', async () => printer.printerStatus(printerOpts()));

  ipcMain.handle('printer:install', async () => {
    const r = await printer.installPrinter(printerOpts());
    const status = await printer.printerStatus(printerOpts());
    return { ok: r.code === 0 && status.installed, log: r.stdout + r.stderr, status };
  });

  ipcMain.handle('printer:uninstall', async () => {
    const r = await printer.uninstallPrinter(printerOpts());
    const status = await printer.printerStatus(printerOpts());
    return { ok: r.code === 0 && !status.installed, log: r.stdout + r.stderr, status };
  });

  ipcMain.handle('printer:testpage', async () => {
    const r = await printer.printTestPage(printerOpts());
    return { ok: r.code === 0, error: r.stderr };
  });

  ipcMain.handle('printer:statusIsElevated', () => printer.isElevated());

  // ---- почта ----
  ipcMain.handle('mail:test', async (_e, args) => {
    const settings = store.getSettings();
    try {
      await sendDocument({
        smtp: settings.smtp,
        password: decryptPassword(settings.passEnc),
        subject: '1C-Mail — тестовое письмо',
        body: 'Тест успешно настроен. Это письмо отправлено из приложения 1C-Mail.',
        to: args && args.to
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // ---- утилиты ----
  ipcMain.handle('app:paths', () => ({
    dataDir: store.dataDir,
    clientsFile: store.clientsFile,
    journalFile: store.journalFile,
    spoolFile: path.join(store.spoolDir, 'capture.pdf'),
    incomingDir: store.incomingDir
  }));
  ipcMain.handle('app:openPath', (_e, p) => shell.openPath(p));

  ipcMain.handle('app:testpdf', () => {
    // сквозной тест без 1С: копируем подготовленный PDF в incoming
    const src = resourcePath(path.join('resources', 'sample-invoice.pdf'));
    if (!fs.existsSync(src)) return { ok: false, error: 'Файл образца не найден: ' + src };
    const f = path.join(store.incomingDir, `test-${Date.now()}.pdf`);
    fs.copyFileSync(src, f);
    setTimeout(() => processIncomingFile(f), 100);
    return { ok: true, file: f };
  });

  ipcMain.handle('dialog:saveCsv', async (_e, { defaultName, content }) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const r = await dialog.showSaveDialog(win, {
      defaultPath: defaultName || 'clients.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, content, 'utf8');
    return { ok: true, path: r.filePath };
  });

  ipcMain.handle('dialog:openCsv', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const r = await dialog.showOpenDialog(win, {
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    return { ok: true, path: r.filePaths[0], content: fs.readFileSync(r.filePaths[0], 'utf8') };
  });
}

// ---------------------------------------------------------------- lifecycle
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    store = new DataStore(defaultDataDir());

    // подхватываем изменения базы, сделанные снаружи (другая копия программы и т.п.)
    const reloadTimer = setInterval(() => {
      if (store.reloadClientsIfChanged()) broadcast('clients');
    }, 5000);
    if (reloadTimer.unref) reloadTimer.unref();

    registerIpc();
    createWindow();
    createTray();

    watcher = new SpoolWatcher({
      spoolFile: path.join(store.spoolDir, 'capture.pdf'),
      incomingDir: store.incomingDir
    });
    watcher.on('file', (f) => processIncomingFile(f));
    watcher.start();

    // файлы, оставшиеся с прошлого запуска
    setTimeout(scanIncoming, 500);

    // статус принтера — обновляем при старте (тихо)
    printer.printerStatus(printerOpts()).then((st) => broadcast('printerStatus', st)).catch(() => {});
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    if (watcher) watcher.stop();
  });
}
