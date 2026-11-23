'use strict';
/**
 * DataStore — хранилище данных приложения.
 * Все данные лежат ВНЕ каталога программы (по умолчанию %ProgramData%\1C-Mail),
 * поэтому обновление программы (новый setup.exe) их не затрагивает,
 * а новая версия сразу подхватывает существующую базу.
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  smtp: {
    host: '',
    port: 587,
    secure: false,
    user: '',
    from: '1C-Mail <noreply@example.by>',
    insecureTls: false
  },
  mail: {
    subject: 'Документы для {name} от {date}',
    body:
      'Здравствуйте, {name}!\n\n' +
      'Во вложении — документ (УНП {unp}) от {date}.\n\n' +
      'С уважением,\n' +
      '1C-Mail'
  },
  autoSend: true,
  confirmEverySend: false,
  startWithWindows: false,
  minimizeToTray: true,
  printerName: '1C-Mail',
  passEnc: '' // 'enc:<base64>' (DPAPI) или 'b64:<base64>' (резерв)
};

function defaultDataDir() {
  const base =
    process.env.ONECMAIL_DATA_DIR ||
    (process.platform === 'win32'
      ? process.env.ProgramData || 'C:\\ProgramData'
      : path.join(process.env.HOME || os.tmpdir(), '.1c-mail'));
  return path.join(base, '1C-Mail');
}

let os = require('os');

function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    // повреждённый файл — не роняем приложение, отдаём фолбэк
    try {
      fs.copyFileSync(file, file + '.corrupt-' + Date.now());
    } catch (_) { /* ignore */ }
    return fallback;
  }
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ';' || ch === '\t') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

class DataStore {
  constructor(dataDir) {
    this.dataDir = dataDir || defaultDataDir();
    this.clientsFile = path.join(this.dataDir, 'clients.json');
    this.journalFile = path.join(this.dataDir, 'journal.json');
    this.settingsFile = path.join(this.dataDir, 'settings.json');
    this.pendingFile = path.join(this.dataDir, 'pending.json');
    this.spoolDir = path.join(this.dataDir, 'spool');
    this.incomingDir = path.join(this.dataDir, 'incoming');
    this.archiveDir = path.join(this.dataDir, 'archive');
    this.logsDir = path.join(this.dataDir, 'logs');

    for (const d of [this.dataDir, this.spoolDir, this.incomingDir, this.archiveDir, this.logsDir]) {
      fs.mkdirSync(d, { recursive: true });
    }

    this.settings = Object.assign({}, DEFAULTS, readJson(this.settingsFile, {}));
    this.settings.smtp = Object.assign({}, DEFAULTS.smtp, this.settings.smtp || {});
    this.settings.mail = Object.assign({}, DEFAULTS.mail, this.settings.mail || {});

    const clientsData = readJson(this.clientsFile, { version: 1, clients: [] });
    this.clients = Array.isArray(clientsData.clients) ? clientsData.clients : [];
    this.clientsMtime = this._mtime(this.clientsFile);

    const journalData = readJson(this.journalFile, { entries: [] });
    this.journal = Array.isArray(journalData.entries) ? journalData.entries : [];

    this.pending = readJson(this.pendingFile, []);
    if (!Array.isArray(this.pending)) this.pending = [];
  }

  _mtime(file) {
    try { return fs.statSync(file).mtimeMs; } catch (_) { return 0; }
  }

  // ---------- настройки ----------
  getSettings() {
    return JSON.parse(JSON.stringify(this.settings));
  }

  saveSettings(patch) {
    const s = this.settings;
    if (patch.smtp) Object.assign(s.smtp, patch.smtp);
    if (patch.mail) Object.assign(s.mail, patch.mail);
    for (const k of ['autoSend', 'confirmEverySend', 'startWithWindows', 'minimizeToTray', 'printerName', 'passEnc']) {
      if (patch[k] !== undefined) s[k] = patch[k];
    }
    atomicWrite(this.settingsFile, JSON.stringify(s, null, 2));
    return this.getSettings();
  }

  // ---------- база клиентов ----------
  /**
   * Подхватывает изменения файла, сделанные снаружи (другая программа,
   * правка в текстовом редакторе, старая версия 1C-Mail и т.п.).
   */
  reloadClientsIfChanged() {
    const m = this._mtime(this.clientsFile);
    if (m !== this.clientsMtime) {
      const data = readJson(this.clientsFile, null);
      if (data && Array.isArray(data.clients)) {
        this.clients = data.clients;
        this.clientsMtime = m;
        return true;
      }
      // файл битый — оставляем текущую копию в памяти
      this.clientsMtime = m;
    }
    return false;
  }

  _saveClients() {
    atomicWrite(this.clientsFile, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), clients: this.clients }, null, 2));
    this.clientsMtime = this._mtime(this.clientsFile);
  }

  getClients(query) {
    this.reloadClientsIfChanged();
    let list = this.clients;
    if (query) {
      const q = String(query).toLowerCase().trim();
      list = list.filter(
        (c) =>
          (c.unp || '').toLowerCase().includes(q) ||
          (c.name || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q)
      );
    }
    return JSON.parse(JSON.stringify(list));
  }

  upsertClient(client) {
    this.reloadClientsIfChanged();
    const now = new Date().toISOString();
    const norm = (s) => (s || '').toLowerCase().trim();
    let found = null;
    if (client.id) found = this.clients.find((c) => c.id === client.id) || null;
    if (!found && client.unp) found = this.clients.find((c) => norm(c.unp) === norm(client.unp)) || null;
    if (!found && client.email) found = this.clients.find((c) => norm(c.email) === norm(client.email)) || null;

    if (found) {
      if (client.unp !== undefined) found.unp = client.unp;
      if (client.name !== undefined) found.name = client.name;
      if (client.email !== undefined) found.email = client.email;
      if (client.phone !== undefined) found.phone = client.phone;
      if (client.note !== undefined) found.note = client.note;
      found.updatedAt = now;
      this._saveClients();
      return found;
    }
    const rec = {
      id: client.id || 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      unp: client.unp || '',
      name: client.name || '',
      email: client.email || '',
      phone: client.phone || '',
      note: client.note || '',
      sends: 0,
      createdAt: now,
      updatedAt: now
    };
    this.clients.push(rec);
    this._saveClients();
    return rec;
  }

  deleteClient(id) {
    this.reloadClientsIfChanged();
    const before = this.clients.length;
    this.clients = this.clients.filter((c) => c.id !== id);
    if (this.clients.length !== before) {
      this._saveClients();
      return true;
    }
    return false;
  }

  bumpSend(id) {
    this.reloadClientsIfChanged();
    const c = this.clients.find((x) => x.id === id);
    if (c) {
      c.sends = (c.sends || 0) + 1;
      c.lastSentAt = new Date().toISOString();
      c.updatedAt = c.lastSentAt;
      this._saveClients();
    }
  }

  /** CSV: unp;name;email[;phone;note] — с BOM для Excel. */
  clientsToCsv() {
    this.reloadClientsIfChanged();
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['УНП', 'Название', 'Email', 'Телефон', 'Примечание', 'Отправок'].join(';')];
    for (const c of this.clients) {
      rows.push([c.unp, c.name, c.email, c.phone, c.note, c.sends || 0].map(esc).join(';'));
    }
    return '\uFEFF' + rows.join('\r\n');
  }

  importClientsCsv(text) {
    this.reloadClientsIfChanged();
    const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
    let added = 0;
    let updated = 0;
    for (let line of lines) {
      const cells = parseCsvLine(line);
      if (!cells.length) continue;
      const head = (cells[0] || '').toLowerCase();
      if (head === 'унп' || head === 'unp') continue; // заголовок
      const unp = (cells[0] || '').trim();
      const name = (cells[1] || '').trim();
      const email = (cells[2] || '').trim();
      const phone = (cells[3] || '').trim();
      const note = (cells[4] || '').trim();
      if (!unp && !name && !email) continue;
      const norm = (s) => (s || '').toLowerCase().trim();
      const exists =
        (unp && this.clients.some((c) => norm(c.unp) === norm(unp))) ||
        (email && this.clients.some((c) => norm(c.email) === norm(email)));
      this.upsertClient({ unp, name, email, phone, note });
      if (exists) updated++; else added++;
    }
    return { added, updated, total: this.clients.length };
  }

  // ---------- журнал ----------
addJournal(entry) {
  this.journal.push(Object.assign({ id: 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), ts: new Date().toISOString() }, entry));
  if (this.journal.length > 5000) this.journal = this.journal.slice(-4000);
  atomicWrite(this.journalFile, JSON.stringify({ entries: this.journal }, null, 2));
  return this.journal[this.journal.length - 1];
}

updateJournal(id, patch) {
  const e = this.journal.find((x) => x.id === id);
  if (e) {
    Object.assign(e, patch);
    atomicWrite(this.journalFile, JSON.stringify({ entries: this.journal }, null, 2));
  }
  return e;
}

getJournal(limit) {
  const n = limit || 500;
  return this.journal.slice(-n).reverse();
}

// ---------- отложенные (ожидают адреса) ----------
getPending() {
  return JSON.parse(JSON.stringify(this.pending));
}

savePending() {
  atomicWrite(this.pendingFile, JSON.stringify(this.pending, null, 2));
}

addPending(item) {
  this.pending.push(item);
  this.savePending();
  return item;
}

removePending(id) {
  const before = this.pending.length;
  this.pending = this.pending.filter((p) => p.id !== id);
  if (this.pending.length !== before) this.savePending();
  return this.pending.length !== before;
}

getPendingItem(id) {
  return this.pending.find((p) => p.id === id) || null;
}
}

module.exports = { DataStore, defaultDataDir, DEFAULTS };
