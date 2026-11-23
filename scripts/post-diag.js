'use strict';
// Временная диагностика CI: публикует содержимое diag.txt как комментарий к коммиту
// через GitHub API (api.github.com), чтобы можно было прочитать ошибку сборки/тестов
// из песочницы, где логи Actions (blob storage) недоступны.
const fs = require('fs');
const sha = process.env.GITHUB_SHA;
const runId = process.env.GITHUB_RUN_ID;
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
let text = '';
try { text = fs.readFileSync('diag.txt', 'utf8'); } catch (_) { text = '(diag.txt пуст/нет)'; }
if (text.length > 6000) text = text.slice(text.length - 6000);
const body = `DIAG run ${runId}\n\`\`\`\n${text}\n\`\`\``;
(async () => {
  try {
    const r = await fetch(`https://api.github.com/repos/zigorminsk-debug/1C-Mail/commits/${sha}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({ body })
    });
    const x = await r.text();
    console.log('diag-post status', r.status, x.slice(0, 200));
  } catch (e) {
    console.log('diag-err', e.message);
  }
})();
