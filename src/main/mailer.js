'use strict';
/** Отправка PDF-документа по e-mail (SMTP через nodemailer). */
const nodemailer = require('nodemailer');

function renderTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (all, key) =>
    vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : all
  );
}

function sanitizeFilename(s) {
  return String(s || 'document')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'document';
}

async function sendDocument({ smtp, password, subject, body, to, filePath, fileName }) {
  if (!smtp || !smtp.host) throw new Error('SMTP-сервер не настроен (Настройки → Почта)');
  if (!to) throw new Error('Не задан адрес получателя');

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: !!smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: password || '' } : undefined,
    tls: smtp.insecureTls ? { rejectUnauthorized: false } : undefined,
    connectionTimeout: 20000,
    greetingTimeout: 15000
  });

  try {
    return await transport.sendMail({
      from: smtp.from || undefined,
      to,
      subject,
      text: body,
      attachments: filePath ? [{ filename: fileName || 'document.pdf', path: filePath }] : undefined
    });
  } finally {
    transport.close && transport.close();
  }
}

module.exports = { sendDocument, renderTemplate, sanitizeFilename };
