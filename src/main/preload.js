'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // настройки
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // база клиентов
  listClients: (q) => ipcRenderer.invoke('clients:list', q),
  saveClient: (c) => ipcRenderer.invoke('clients:save', c),
  deleteClient: (id) => ipcRenderer.invoke('clients:delete', id),
  exportClients: () => ipcRenderer.invoke('clients:export'),
  importClients: (text) => ipcRenderer.invoke('clients:import', text),

  // журнал
  listJournal: (limit) => ipcRenderer.invoke('journal:list', limit),
  retryJournal: (id) => ipcRenderer.invoke('journal:retry', id),

  // отложенные отправки
  listPending: () => ipcRenderer.invoke('pending:list'),
  resolvePending: (args) => ipcRenderer.invoke('pending:resolve', args),
  removePending: (id) => ipcRenderer.invoke('pending:remove', id),

  // принтер
  printerStatus: () => ipcRenderer.invoke('printer:status'),
  printerInstall: () => ipcRenderer.invoke('printer:install'),
  printerUninstall: () => ipcRenderer.invoke('printer:uninstall'),
  printerTestPage: () => ipcRenderer.invoke('printer:testpage'),

  // почта
  testMail: (args) => ipcRenderer.invoke('mail:test', args),

  // утилиты
  paths: () => ipcRenderer.invoke('app:paths'),
  openPath: (p) => ipcRenderer.invoke('app:openPath', p),
  testPdf: () => ipcRenderer.invoke('app:testpdf'),
  saveCsv: (args) => ipcRenderer.invoke('dialog:saveCsv', args),
  openCsv: () => ipcRenderer.invoke('dialog:openCsv'),

  // события из main
  onEvent: (cb) => ipcRenderer.on('evt', (_e, data) => cb(data))
});
