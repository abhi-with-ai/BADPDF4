// Run with: npm test   (requires `npm run install:all` first; qpdf tests are skipped if qpdf is missing)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

process.env.MAX_FILE_MB = '1';
process.env.RATE_LIMIT_MAX = '1000';
const { app } = await import('../src/app.js');
const { config } = await import('../src/config.js');
const { readdir } = await import('node:fs/promises');

let server, base;
before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => server.close());

const hasQpdf = (() => { try { execFileSync(config.bins.qpdf, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const MIN_PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF');
const post = (path, buf, name, fields = {}) => {
  const fd = new FormData();
  if (buf) fd.append('file', new Blob([buf]), name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fetch(base + '/api/' + path, { method: 'POST', body: fd });
};
const err = async (r) => (await r.json()).error.code;

test('health reports tool availability', async () => {
  const j = await (await fetch(base + '/api/health')).json();
  assert.equal(j.success, true);
  assert.equal(typeof j.tools.qpdf, 'boolean');
});
test('unknown API route returns JSON 404', async () => {
  const r = await fetch(base + '/api/nope');
  assert.equal(r.status, 404);
  assert.equal(await err(r), 'NOT_FOUND');
});
test('missing file is rejected', async () => {
  const r = await post('repair');
  assert.equal(r.status, 400);
  assert.equal(await err(r), 'NO_FILE');
});
test('empty file is rejected', async () => {
  const r = await post('repair', Buffer.alloc(0), 'a.pdf');
  assert.equal(await err(r), 'EMPTY_FILE');
});
test('non-PDF with .pdf name is rejected by content sniffing', async () => {
  const r = await post('repair', Buffer.from('hello world'), 'fake.pdf');
  assert.equal(r.status, 415);
  assert.equal(await err(r), 'INVALID_FILE_TYPE');
});
test('text renamed to .docx is rejected', async () => {
  const r = await post('word-to-pdf', Buffer.from('not a word file'), 'x.docx');
  assert.equal(r.status, 415);
});
test('oversized upload is rejected (limit 1 MB in tests)', async () => {
  const r = await post('repair', Buffer.alloc(2 * 1024 * 1024, 1), 'big.pdf');
  assert.equal(r.status, 413);
  assert.equal(await err(r), 'FILE_TOO_LARGE');
});
test('invalid OCR language is rejected', async () => {
  const r = await post('ocr', MIN_PDF, 'a.pdf', { lang: 'eng;rm -rf' });
  assert.equal(await err(r), 'INVALID_OPTIONS');
});
test('protect rejects passwords with quotes', async () => {
  const r = await post('protect', MIN_PDF, 'a.pdf', { password: 'ab"c' });
  assert.equal(await err(r), 'INVALID_OPTIONS');
});
test('protect → unlock round trip, wrong password rejected', { skip: !hasQpdf }, async () => {
  const p = await post('protect', MIN_PDF, 'a.pdf', { password: 'secret1' });
  assert.equal(p.status, 200);
  const enc = Buffer.from(await p.arrayBuffer());
  assert.ok(enc.includes(Buffer.from('/Encrypt')));
  assert.equal((await post('unlock', enc, 'a.pdf', { password: 'wrong' })).status, 401);
  const u = await post('unlock', enc, 'a.pdf', { password: 'secret1' });
  assert.equal(u.status, 200);
  assert.ok(!Buffer.from(await u.arrayBuffer()).includes(Buffer.from('/Encrypt')));
});
test('temporary job folders are cleaned up', async () => {
  const left = (await readdir(config.tmpRoot).catch(() => [])).filter((n) => n.startsWith('job-'));
  assert.equal(left.length, 0);
});
