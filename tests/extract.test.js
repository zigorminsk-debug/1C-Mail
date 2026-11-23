'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseRequisites } = require('../src/main/extract');

test('УНП после подписи «УНП»', () => {
  const p = parseRequisites('ООО Ромашка\nУНП: 100123456\nСчёт №5');
  assert.deepStrictEqual(p.unps, ['100123456']);
});

test('несколько УНП, дубли снимаются, приоритет у подписанного', () => {
  const p = parseRequisites('УНП 200112233\nи ещё 100123456\nУНП: 100123456');
  assert.deepStrictEqual(p.unps, ['200112233', '100123456']);
});

test('название клиента из реквизитов', () => {
  const p = parseRequisites('Покупатель: ООО «Ромашка», УНП 100123456\nПродавец: ИП Иванов');
  assert.ok(p.names.includes('ООО «Ромашка»') || p.names.some((n) => n.includes('Ромашка')), JSON.stringify(p.names));
});

test('e-mail и дата из документа', () => {
  const p = parseRequisites('Счёт от 15.03.2026\nmail: client@example.by');
  assert.deepStrictEqual(p.emails, ['client@example.by']);
  assert.strictEqual(p.date, '15.03.2026');
});

test('пустой текст не падает', () => {
  const p = parseRequisites('');
  assert.deepStrictEqual(p.unps, []);
  assert.deepStrictEqual(p.names, []);
  assert.deepStrictEqual(p.emails, []);
});
