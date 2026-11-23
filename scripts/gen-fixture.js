'use strict';
/**
 * Генерация тестового PDF-документа (счёт из 1С) с понятными реквизитами.
 * Используется pdf-lib, чтобы получить гарантированно корректный PDF,
 * который читает используемая версия pdf.js. Результат: tests/fixtures/requisites.pdf
 *
 *   npm run gen-fixture
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

async function main() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Только latin/ASCII: стандартный Helvetica (WinAnsi) не кодирует кириллицу.
  // Реквизиты (УНП, e-mail, дата) парсер проверяет именно по таким строкам.
  const lines = [
    'INVOICE No. 2026/118',
    'Date: 15.03.2026',
    'Seller: IP Ivanov',
    'Buyer: OOO Romashka',
    'UNP: 100123456',
    'Contact e-mail: client@example.by',
    'Total: 1234.56 BYN'
  ];

  let y = 800;
  for (const l of lines) {
    page.drawText(l, { x: 50, y, size: 12, font, lineHeight: 16 });
    y -= 22;
  }

  const bytes = await doc.save();
  const out = path.join(__dirname, '..', 'tests', 'fixtures', 'requisites.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, bytes);
  console.log('written', out, bytes.length, 'bytes');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
