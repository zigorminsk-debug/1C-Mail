'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DataStore } = require('../src/main/store');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), '1cmail-test-'));
}

test('база: upsert, поиск, удаление, переживает перезапуск', () => {
  const dir = tmpDir();
  let s = new DataStore(dir);
  const rec = s.upsertClient({ unp: '100123456', name: 'ООО Ромашка', email: 'r@example.by' });
  assert.ok(rec.id);
  assert.strictEqual(s.getClients('ромашка').length, 1);
  assert.strictEqual(s.getClients('100123456').length, 1);

  // перезапуск приложения → данные на месте (файл хранится отдельно)
  s = new DataStore(dir);
  assert.strictEqual(s.getClients().length, 1);

  // обновление по УНП не создаёт дубль
  s.upsertClient({ unp: '100123456', name: 'ООО Ромашка', email: 'new@example.by' });
  assert.strictEqual(s.getClients().length, 1);
  assert.strictEqual(s.getClients()[0].email, 'new@example.by');

  assert.ok(s.deleteClient(rec.id));
  assert.strictEqual(s.getClients().length, 0);
});

test('база: внешнее изменение файла подхватывается', () => {
  const dir = tmpDir();
  const s = new DataStore(dir);
  assert.strictEqual(s.getClients().length, 0);

  // «снаружи» пишет другая программа
  const ext = { version: 1, clients: [{ id: 'x1', unp: '777777777', name: 'Внешний', email: 'ext@example.by' }] };
  const future = Date.now() + 10000;
  fs.writeFileSync(s.clientsFile, JSON.stringify(ext));
  fs.utimesSync(s.clientsFile, future, future);

  assert.strictEqual(s.reloadClientsIfChanged(), true);
  assert.strictEqual(s.getClients().length, 1);
  assert.strictEqual(s.getClients()[0].name, 'Внешний');
});

test('CSV: экспорт и импорт', () => {
  const dir = tmpDir();
  const s = new DataStore(dir);
  s.upsertClient({ unp: '100123456', name: 'ООО Ромашка', email: 'r@example.by' });
  const csv = s.clientsToCsv();
  assert.ok(csv.includes('УНП'));

  const s2 = new DataStore(tmpDir());
  const res = s2.importClientsCsv(csv);
  assert.strictEqual(res.added, 1);
  assert.strictEqual(s2.getClients()[0].unp, '100123456');
});

test('журнал и отложенные', () => {
  const dir = tmpDir();
  const s = new DataStore(dir);
  const e = s.addJournal({ status: 'sent', email: 'a@b.by', name: 'X', unp: '1', file: 'f.pdf' });
  assert.strictEqual(s.getJournal()[0].id, e.id);
  s.updateJournal(e.id, { status: 'failed', error: 'boom' });
  assert.strictEqual(s.getJournal()[0].status, 'failed');

  s.addPending({ id: 'p1', file: '/x/y.pdf', unps: [], names: [], emails: [] });
  assert.strictEqual(s.getPending().length, 1);
  assert.ok(s.removePending('p1'));
  assert.strictEqual(s.getPending().length, 0);
});

test('настройки сохраняются и не теряют дефолты', () => {
  const dir = tmpDir();
  const s = new DataStore(dir);
  s.saveSettings({ smtp: { host: 'smtp.example.by' } });
  const s2 = new DataStore(dir);
  const st = s2.getSettings();
  assert.strictEqual(st.smtp.host, 'smtp.example.by');
  assert.strictEqual(st.smtp.port, 587);
  assert.strictEqual(st.printerName, '1C-Mail');
});
