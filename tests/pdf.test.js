'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { extractFromPdf, parseRequisites } = require('../src/main/extract');

const FIXTURE = path.join(__dirname, 'fixtures', 'requisites.pdf');

test('сквозной: PDF читается, текст извлекается, реквизиты разбираются', async () => {
  const buf = fs.readFileSync(FIXTURE);
  const { text, pages } = await extractFromPdf(buf);
  assert.ok(pages >= 1);
  assert.ok(text.includes('100123456'), 'text=' + JSON.stringify(text));
  assert.ok(text.includes('client@example.by'));

  const p = parseRequisites(text);
  assert.deepStrictEqual(p.unps, ['100123456']);
  assert.deepStrictEqual(p.emails, ['client@example.by']);
  assert.strictEqual(p.date, '15.03.2026');
  assert.ok(p.names.some((n) => /Romashka/i.test(n)), JSON.stringify(p.names));
});

test('битый PDF не роняет разбор (rejects)', async () => {
  await assert.rejects(() => extractFromPdf(Buffer.from('not a pdf at all')));
});
