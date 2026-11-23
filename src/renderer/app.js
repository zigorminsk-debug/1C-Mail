'use strict';
/* 1C-Mail — рендерер (HTML GUI) */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  settings: null,
  journal: [],
  pending: [],
  clients: [],
  printerStatus: null,
  paths: null
};

// ------------------------------------------------------------- вкладки
$$('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.nav-btn').forEach((b) => b.classList.remove('active'));
    $$('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
    refreshTab(btn.dataset.tab);
  });
});

function refreshTab(name) {
  if (name === 'journal') loadJournal();
  if (name === 'pending') loadPending();
  if (name === 'clients') loadClients();
  if (name === 'settings') loadSettings();
}

// ------------------------------------------------------------- журнал
async function loadJournal() {
  state.journal = await window.api.listJournal(300);
  renderJournal();
}

function renderJournal() {
  const tbody = $('#journal-table tbody');
  tbody.innerHTML = '';
  const items = state.journal;
  $('#journal-empty').style.display = items.length ? 'none' : 'block';
  for (const j of items) {
    const tr = document.createElement('tr');
    const ts = j.ts ? new Date(j.ts).toLocaleString('ru-RU') : '';
    const statusLabel = { sent: 'Отправлен', failed: 'Ошибка', received: 'Получен', skipped: 'Пропущен' }[j.status] || j.status;
    tr.innerHTML = `
      <td>${esc(ts)}</td>
      <td>${esc(j.name || '—')} ${j.error ? `<div class="sub" style="color:var(--err)">${esc(j.error)}</div>` : ''}</td>
      <td>${esc(j.unp || '—')}</td>
      <td>${esc(j.email || '—')}</td>
      <td><span class="status ${esc(j.status)}">${esc(statusLabel)}</span></td>
      <td></td>`;
    const cell = tr.lastElementChild;
    if (j.status === 'sent' && j.email) {
      const btn = document.createElement('button');
      btn.className = 'btn ghost';
      btn.textContent = 'Повторить';
      btn.style.padding = '4px 10px';
      btn.style.fontSize = '12px';
      btn.onclick = async () => {
        btn.disabled = true;
        const r = await window.api.retryJournal(j.id);
        if (!r.ok) alert('Ошибка: ' + r.error);
        loadJournal();
      };
      cell.appendChild(btn);
    }
    tbody.appendChild(tr);
  }
}

// ------------------------------------------------------------- отложенные
async function loadPending() {
  state.pending = await window.api.listPending();
  renderPending();
}

function renderPending() {
  const wrap = $('#pending-list');
  wrap.innerHTML = '';
  if (!state.pending.length) {
    wrap.innerHTML = '<div class="empty">Нет документов, ожидающих адреса.</div>';
    return;
  }
  for (const p of state.pending) {
    const card = document.createElement('div');
    card.className = 'card-pending';
    const title = p.names[0] || (p.unps[0] ? 'УНП ' + p.unps[0] : 'Документ без реквизитов');
    const meta = [];
    if (p.unps.length) meta.push('УНП: ' + p.unps.join(', '));
    if (p.names.length > 1) meta.push('Названия: ' + p.names.slice(1).join(' | '));
    if (p.emails.length) meta.push('E-mail в документе: ' + p.emails.join(', '));
    if (p.date) meta.push('Дата: ' + p.date);

    card.innerHTML = `
      <h3>${esc(title)}</h3>
      <div class="meta">${esc(meta.join(' · ')) || 'Реквизиты не распознаны — введите адрес вручную'}</div>
      <div class="file">${esc(p.file)}</div>
      <div class="candidates"></div>
      <div class="resolve-row">
        <input type="text" placeholder="client@example.by" value="${esc(p.suggestedEmail || '')}" data-email />
        <label class="check" style="margin:0"><input type="checkbox" data-save checked /> запомнить в базе</label>
        <button class="btn primary" data-send>Отправить</button>
        <button class="btn danger ghost" data-drop>Отклонить</button>
      </div>
      <div class="error-line" data-err style="display:none"></div>`;

    const candWrap = card.querySelector('.candidates');
    let selectedId = p.candidates.length === 1 ? p.candidates[0].id : null;
    for (const c of p.candidates) {
      const chip = document.createElement('button');
      chip.className = 'chip' + (c.id === selectedId ? ' sel' : '');
      chip.textContent = `${c.name || 'без названия'}${c.unp ? ' · УНП ' + c.unp : ''}${c.email ? ' · ' + c.email : ''}`;
      chip.onclick = () => {
        selectedId = selectedId === c.id ? null : c.id;
        candWrap.querySelectorAll('.chip').forEach((x) => x.classList.remove('sel'));
        if (selectedId) chip.classList.add('sel');
        if (c.email) card.querySelector('[data-email]').value = c.email;
      };
      candWrap.appendChild(chip);
    }

    card.querySelector('[data-send]').onclick = async (ev) => {
      const btn = ev.target;
      const email = card.querySelector('[data-email]').value.trim();
      const err = card.querySelector('[data-err]');
      btn.disabled = true;
      const r = await window.api.resolvePending({
        id: p.id,
        email,
        clientId: selectedId,
        save: card.querySelector('[data-save]').checked
      });
      if (!r.ok) {
        err.style.display = 'block';
        err.textContent = 'Ошибка: ' + r.error;
        btn.disabled = false;
      } else {
        card.remove();
        if (!$('#pending-list').children.length) renderPending();
        updateBadges();
        loadJournal();
      }
    };
    card.querySelector('[data-drop]').onclick = async () => {
      await window.api.removePending(p.id);
      card.remove();
      if (!$('#pending-list').children.length) renderPending();
      updateBadges();
    };
    wrap.appendChild(card);
  }
}

// ------------------------------------------------------------- клиенты
async function loadClients() {
  const q = $('#client-search').value.trim();
  state.clients = await window.api.listClients(q || undefined);
  if (!state.paths) state.paths = await window.api.paths();
  $('#clients-path').textContent = 'Файл базы: ' + state.paths.clientsFile;
  renderClients();
}

function renderClients() {
  const tbody = $('#clients-table tbody');
  tbody.innerHTML = '';
  $('#clients-empty').style.display = state.clients.length ? 'none' : 'block';
  for (const c of state.clients) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(c.unp || '—')}</td>
      <td>${esc(c.name || '—')}</td>
      <td>${esc(c.email || '—')}</td>
      <td>${c.sends || 0}</td>
      <td></td>`;
    const cell = tr.lastElementChild;

    const edit = document.createElement('button');
    edit.className = 'btn ghost';
    edit.textContent = 'Изм.';
    edit.style.cssText = 'padding:4px 10px;font-size:12px;margin-right:6px';
    edit.onclick = () => openClientModal(c);
    cell.appendChild(edit);

    const del = document.createElement('button');
    del.className = 'btn danger ghost';
    del.textContent = 'Удалить';
    del.style.cssText = 'padding:4px 10px;font-size:12px';
    del.onclick = async () => {
      if (!confirm(`Удалить клиента «${c.name || c.unp || c.email}»?`)) return;
      await window.api.deleteClient(c.id);
      loadClients();
    };
    cell.appendChild(del);
    tbody.appendChild(tr);
  }
}

$('#client-search').addEventListener('input', debounce(loadClients, 300));
$('#btn-add-client').onclick = () => openClientModal(null);

function openClientModal(client) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay show';
  overlay.innerHTML = `
    <div class="modal">
      <h2>${client ? 'Изменить клиента' : 'Новый клиент'}</h2>
      <div class="row"><label>УНП</label><input type="text" id="m-unp" value="${esc(client ? client.unp : '')}" placeholder="100123456" /></div>
      <div class="row"><label>Название</label><input type="text" id="m-name" value="${esc(client ? client.name : '')}" /></div>
      <div class="row"><label>E-mail</label><input type="text" id="m-email" value="${esc(client ? client.email : '')}" placeholder="client@example.by" /></div>
      <div class="row"><label>Телефон</label><input type="text" id="m-phone" value="${esc(client ? client.phone : '')}" /></div>
      <div class="row"><label>Примечание</label><input type="text" id="m-note" value="${esc(client ? client.note : '')}" /></div>
      <div class="btn-row">
        <button class="btn ghost" id="m-cancel">Отмена</button>
        <button class="btn primary" id="m-save">Сохранить</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#m-cancel').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#m-save').onclick = async () => {
    const rec = {
      id: client ? client.id : undefined,
      unp: overlay.querySelector('#m-unp').value.trim(),
      name: overlay.querySelector('#m-name').value.trim(),
      email: overlay.querySelector('#m-email').value.trim(),
      phone: overlay.querySelector('#m-phone').value.trim(),
      note: overlay.querySelector('#m-note').value.trim()
    };
    if (!rec.unp && !rec.name && !rec.email) { alert('Заполните хотя бы одно поле'); return; }
    await window.api.saveClient(rec);
    close();
    loadClients();
  };
}

$('#btn-export-clients').onclick = async () => {
  const content = await window.api.exportClients();
  const r = await window.api.saveCsv({ defaultName: 'clients-' + new Date().toISOString().slice(0, 10) + '.csv', content });
  if (r.ok) alert('Экспортировано: ' + r.path);
};

$('#btn-import-clients').onclick = async () => {
  const r = await window.api.openCsv();
  if (!r.ok) return;
  const res = await window.api.importClients(r.content);
  alert(`Импорт завершён.\nДобавлено: ${res.added}\nОбновлено: ${res.updated}\nВсего в базе: ${res.total}`);
  loadClients();
};

// ------------------------------------------------------------- настройки
async function loadSettings() {
  state.settings = await window.api.getSettings();
  if (!state.paths) state.paths = await window.api.paths();
  const s = state.settings;

  $('#set-printer-name').value = s.printerName || '1C-Mail';
  $('#lbl-printer-name').textContent = s.printerName || '1C-Mail';
  $('#set-smtp-host').value = s.smtp.host || '';
  $('#set-smtp-port').value = s.smtp.port || 587;
  $('#set-smtp-secure').checked = !!s.smtp.secure;
  $('#set-smtp-user').value = s.smtp.user || '';
  $('#set-smtp-password').value = '';
  $('#set-smtp-password').placeholder = 'пароль сохранён';
  $('#set-smtp-from').value = s.smtp.from || '';
  $('#set-smtp-insecure').checked = !!s.smtp.insecureTls;
  $('#set-subject').value = s.mail.subject || '';
  $('#set-body').value = s.mail.body || '';
  $('#set-autosend').checked = !!s.autoSend;
  $('#set-confirm').checked = !!s.confirmEverySend;
  $('#set-minimize-tray').checked = !!s.minimizeToTray;
  $('#set-autostart').checked = !!s.startWithWindows;
  $('#lbl-datadir').textContent = state.paths.dataDir;
  $('#lbl-spool').textContent = state.paths.spoolFile;
  refreshPrinterStatus();
}

$('#btn-save-settings').onclick = async () => {
  const btn = $('#btn-save-settings');
  btn.disabled = true;
  const patch = {
    printerName: $('#set-printer-name').value.trim() || '1C-Mail',
    smtp: {
      host: $('#set-smtp-host').value.trim(),
      port: Number($('#set-smtp-port').value) || 587,
      secure: $('#set-smtp-secure').checked,
      user: $('#set-smtp-user').value.trim(),
      from: $('#set-smtp-from').value.trim(),
      insecureTls: $('#set-smtp-insecure').checked
    },
    smtpPassword: $('#set-smtp-password').value,
    mail: {
      subject: $('#set-subject').value,
      body: $('#set-body').value
    },
    autoSend: $('#set-autosend').checked,
    confirmEverySend: $('#set-confirm').checked,
    minimizeToTray: $('#set-minimize-tray').checked,
    startWithWindows: $('#set-autostart').checked
  };
  state.settings = await window.api.setSettings(patch);
  $('#lbl-printer-name').textContent = state.settings.printerName;
  $('#save-state').textContent = 'Сохранено ✓';
  setTimeout(() => ($('#save-state').textContent = ''), 2500);
  btn.disabled = false;
};

$('#btn-test-mail').onclick = async () => {
  const to = $('#set-test-mail-to').value.trim();
  if (!to) { alert('Укажите тестовый e-mail'); return; }
  const btn = $('#btn-test-mail');
  btn.disabled = true;
  btn.textContent = 'Отправка…';
  const r = await window.api.testMail({ to });
  btn.disabled = false;
  btn.textContent = 'Тестовое письмо';
  alert(r.ok ? 'Тестовое письмо отправлено!' : 'Ошибка: ' + r.error);
};

// ------------------------------------------------------------- принтер
async function refreshPrinterStatus() {
  try {
    const st = await window.api.printerStatus();
    state.printerStatus = st;
    renderPrinterState(st);
    const log = $('#printer-log');
    log.classList.add('show');
    log.textContent = st.error
      ? 'Ошибка: ' + st.error
      : `Очередь: ${st.installed ? 'установлена' : 'не установлена'}\nДрайвер: ${st.driverName || '—'}\nПорт: ${st.portName || '—'}\nСлужба печати: ${st.spooler}\nОбщий: ${st.shared ? 'да (' + (st.shareName || '') + ')' : 'нет'}`;
  } catch (e) {
    renderPrinterState({ installed: false, error: String(e) });
  }
}

function renderPrinterState(st) {
  const dot = $('#printer-state .dot');
  const txt = $('#printer-state-text');
  dot.className = 'dot';
  if (st.installed && st.spooler === 'Running') {
    dot.classList.add('ok');
    txt.textContent = 'Принтер «' + (st.printerName || '1C-Mail') + '» готов';
  } else if (st.installed) {
    dot.classList.add('err');
    txt.textContent = 'Принтер есть, служба печати: ' + st.spooler;
  } else {
    dot.classList.add('err');
    txt.textContent = 'Принтер не установлен — Настройки → Установить';
  }
}

$('#btn-printer-status').onclick = refreshPrinterStatus;

$('#btn-printer-install').onclick = async () => {
  const btn = $('#btn-printer-install');
  btn.disabled = true;
  btn.textContent = 'Установка…';
  const r = await window.api.printerInstall();
  const log = $('#printer-log');
  log.classList.add('show');
  log.textContent = (r.log || '').trim().slice(-4000) + (r.status && r.status.error ? '\n' + r.status.error : '');
  if (r.status) renderPrinterState(r.status);
  btn.disabled = false;
  btn.textContent = 'Установить принтер';
  if (r.ok) alert('Принтер установлен. В 1С выберите принтер «' + ($('#set-printer-name').value || '1C-Mail') + '».');
  else alert('Установка завершилась с ошибкой. Подробности в окне лога.');
};

$('#btn-printer-uninstall').onclick = async () => {
  if (!confirm('Удалить виртуальный принтер? База клиентов и журнал останутся нетронутыми.')) return;
  const btn = $('#btn-printer-uninstall');
  btn.disabled = true;
  const r = await window.api.printerUninstall();
  const log = $('#printer-log');
  log.classList.add('show');
  log.textContent = (r.log || '').trim().slice(-4000);
  if (r.status) renderPrinterState(r.status);
  btn.disabled = false;
};

$('#btn-printer-test').onclick = async () => {
  const r = await window.api.printerTestPage();
  if (r.ok) {
    alert('Тестовая страница отправлена на печать.\nОна появится во вкладке «Отложенные» (тестовая страница не содержит УНП клиента).');
    setTimeout(() => { refreshPrinterStatus(); }, 2500);
  } else {
    alert('Ошибка: ' + (r.error || 'неизвестно'));
  }
};

$('#btn-open-datadir').onclick = async () => {
  if (!state.paths) state.paths = await window.api.paths();
  await window.api.openPath(state.paths.dataDir);
};

$('#btn-test-pdf').onclick = async () => {
  const r = await window.api.testPdf();
  if (r.ok) {
    alert('Тестовый PDF создан и отправлен в обработку (вкладка «Отложенные»).');
    setTimeout(() => loadPending(), 1000);
  }
};

// ------------------------------------------------------------- события
$('#btn-refresh-journal').onclick = loadJournal;
$('#btn-refresh-pending').onclick = loadPending;

window.api.onEvent(({ channel, payload }) => {
  if (channel === 'journal') {
    updateBadges();
    if ($('#tab-journal').classList.contains('active')) loadJournal();
  }
  if (channel === 'pending') {
    updateBadges();
    if ($('#tab-pending').classList.contains('active')) loadPending();
  }
  if (channel === 'clients' && $('#tab-clients').classList.contains('active')) loadClients();
  if (channel === 'printerStatus') renderPrinterState(payload || {});
  if (channel === 'settings') loadSettings();
});

async function updateBadges() {
  const [pending, journal] = await Promise.all([window.api.listPending(), window.api.listJournal(200)]);
  const bp = $('#badge-pending');
  bp.textContent = pending.length;
  bp.classList.toggle('show', pending.length > 0);
  bp.classList.toggle('ok', false);
  const failed = journal.filter((j) => j.status === 'failed').length;
  const bj = $('#badge-journal');
  bj.textContent = failed;
  bj.classList.toggle('show', failed > 0);
}

// ------------------------------------------------------------- утилиты
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ------------------------------------------------------------- старт
(async function init() {
  await loadSettings();
  await Promise.all([loadJournal(), loadPending(), loadClients()]);
  updateBadges();
  setInterval(updateBadges, 15000);
})();
