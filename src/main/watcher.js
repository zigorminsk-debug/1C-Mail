'use strict';
/**
 * Наблюдатель за файлом захвата печати (spool/capture.pdf).
 * Виртуальный принтер пишет PDF в фиксированный файл; когда служба печати
 * закрывает файл (задание завершено) и размер перестал расти — файл
 * переименовывается в incoming/ и обрабатывается.
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class SpoolWatcher extends EventEmitter {
  constructor({ spoolFile, incomingDir, interval = 300, stableMs = 700 }) {
    super();
    this.spoolFile = spoolFile;
    this.incomingDir = incomingDir;
    this.interval = interval;
    this.stableMs = stableMs;
    this.timer = null;
    this.lastSize = -1;
    this.lastChangeAt = 0;
    this.seq = 0;
    this.busy = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), this.interval);
    this.timer.unref && this.timer.unref();
    this._tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  _tick() {
    if (this.busy) return;
    let st;
    try {
      st = fs.statSync(this.spoolFile);
    } catch (_) {
      this.lastSize = -1;
      return;
    }
    if (!st.size) return;
    const now = Date.now();
    if (st.size !== this.lastSize) {
      this.lastSize = st.size;
      this.lastChangeAt = now;
      return;
    }
    if (now - this.lastChangeAt < this.stableMs) return;

    // размер стабилен — пробуем забрать файл (rename падает, пока спулер держит ручку)
    this.busy = true;
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      this.seq = (this.seq + 1) % 1000;
      const dest = path.join(this.incomingDir, `${ts}-${String(this.seq).padStart(3, '0')}.pdf`);
      fs.renameSync(this.spoolFile, dest);
      this.lastSize = -1;
      this.lastChangeAt = 0;
      this.emit('file', dest);
    } catch (_) {
      // EPERM/EBUSY — файл ещё открыт, попробуем в следующем тике
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { SpoolWatcher };
