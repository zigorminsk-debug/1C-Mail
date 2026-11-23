'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { matchClients, normalize } = require('../src/main/match');

const clients = [
  { id: '1', unp: '100123456', name: 'ООО Ромашка', email: 'romashka@example.by' },
  { id: '2', unp: '200112233', name: 'ЗАО Ветер', email: ' veter@example.by ' },
  { id: '3', unp: '', name: 'Унитарное предприятие Атлант', email: 'atlant@example.by' }
];

test('точное совпадение по УНП', () => {
  const m = matchClients(clients, { text: 'что угодно', unps: ['100123456'], names: [] });
  assert.strictEqual(m.type, 'exact');
  assert.strictEqual(m.client.id, '1');
  assert.strictEqual(m.method, 'unp');
});

test('два совпавших УНП → кандидаты', () => {
  const m = matchClients(clients, { text: '', unps: ['100123456', '200112233'], names: [] });
  assert.strictEqual(m.type, 'candidates');
  assert.strictEqual(m.candidates.length, 2);
});

test('совпадение по названию (точное вхождение)', () => {
  const m = matchClients(clients, { text: 'Покупатель: ООО Ромашка, УНП 999999999', unps: ['999999999'], names: ['ООО Ромашка'] });
  // УНП 999999999 не найден в базе → матчимся по названию
  assert.strictEqual(m.type, 'exact');
  assert.strictEqual(m.client.id, '1');
  assert.strictEqual(m.method, 'name');
});

test('нет совпадений', () => {
  const m = matchClients(clients, { text: 'Совсем другой документ', unps: ['555555555'], names: ['ООО Пряник'] });
  assert.strictEqual(m.type, 'none');
});

test('normalize: регистр, ё, кавычки', () => {
  assert.strictEqual(normalize('  ООО «Рёмашка»  '), 'ооо ремашка');
});
