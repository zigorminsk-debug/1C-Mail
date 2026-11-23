'use strict';
/**
 * Сопоставление реквизитов из документа с базой клиентов:
 *  1) точное совпадение УНП;
 *  2) совпадение названия (нормализация + вхождение / пересечение токенов).
 */

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`]/g, ' ')
    .replace(/[.,;:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s) {
  return normalize(s)
    .split(/[^a-zа-я0-9]+/)
    .filter((t) => t.length > 1);
}

function scoreName(clientName, parsed) {
  const cn = normalize(clientName);
  if (cn.length < 3) return 0;
  const textN = normalize(parsed.text || '');
  if (textN.includes(cn)) return 1;
  const ct = new Set(tokenize(clientName));
  if (!ct.size) return 0;
  const tt = new Set(tokenize(parsed.text || ''));
  let inter = 0;
  for (const t of ct) if (tt.has(t)) inter++;
  return inter / ct.size;
}

/**
 * @returns {{type:'exact', client:object, method:string}
 *          |{type:'candidates', candidates:Array<{client:object, score:number, method:string}>}
 *          |{type:'none'}}
 */
function matchClients(clients, parsed) {
  const list = Array.isArray(clients) ? clients : [];

  // 1. УНП
  const byUnp = [];
  for (const unp of parsed.unps || []) {
    const u = String(unp).toLowerCase();
    for (const c of list) {
      if ((c.unp || '').toLowerCase() === u && !byUnp.includes(c)) byUnp.push(c);
    }
  }
  if (byUnp.length === 1) return { type: 'exact', client: byUnp[0], method: 'unp' };
  if (byUnp.length > 1) {
    return {
      type: 'candidates',
      candidates: byUnp.map((c) => ({ client: c, score: 1, method: 'unp' }))
    };
  }

  // 2. Название
  const scored = list
    .map((c) => ({ client: c, score: scoreName(c.name, parsed), method: 'name' }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { type: 'none' };
  if (scored[0].score >= 0.99 && (scored.length === 1 || scored[1].score < 0.99)) {
    return { type: 'exact', client: scored[0].client, method: 'name' };
  }
  return { type: 'candidates', candidates: scored.slice(0, 8) };
}

module.exports = { matchClients, normalize };
