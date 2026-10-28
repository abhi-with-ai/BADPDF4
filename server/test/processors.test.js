// Runs the REAL processing pipelines (no HTTP). Each test is skipped if its native tool is not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import PptxGenJS from 'pptxgenjs';
import { config } from '../src/config.js';
import { ApiError, run, withJob, sniff } from '../src/util.js';
import * as P from '../src/processors.js';

const B = config.bins;
const has = (cmd, args = ['--version']) => { try { execFileSync(cmd, args, { stdio: 'ignore', timeout: 30000 }); return true; } catch { return false; } };
const HAS = { soffice: has(B.soffice), qpdf: has(B.qpdf), gs: has(B.gs), poppler: has(B.pdftotext, ['-v']) && has(B.pdftoppm, ['-v']), tess: has(B.tesseract) };
const hasExcel = await import('exceljs').then(() => true, () => false);

/** Run a processor inside a real job dir, like the HTTP layer does. */
const job = (fn, ext, buf, opts = {}) => withJob(async (dir) => {
  const input = path.join(dir, 'input.' + ext);
  await writeFile(input, buf);
  return fn({ dir, input, ext, opts, size: buf.length });
});
const text = (pdf) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp-')), 'o.pdf');
  fs.writeFileSync(f, pdf);
  return execFileSync(B.pdftotext, [f, '-']).toString();
};
const HTML = Buffer.from('<html><body><h1>Hello badpdf world</h1><p>Second paragraph.</p></body></html>');
const isPdf = (b) => b.subarray(0, 5).toString() === '%PDF-';
const rejects = (p, code) => assert.rejects(p, (e) => e instanceof ApiError && e.code === code);

let basePdf;
test('html → pdf (LibreOffice)', { skip: !HAS.soffice }, async () => {
  const r = await job(P.htmlToPdf, 'html', HTML);
  assert.ok(isPdf(r.buffer));
  if (HAS.poppler) assert.match(text(r.buffer), /Hello badpdf world/);
  basePdf = r.buffer;
});
test('cleanHtml strips scripts, handlers and remote resources', () => {
  const out = P.cleanHtml('<script>x()</script><img src="http://evil/x.png" onerror="y()"><a href="https://e.com">k</a><p style="background:url(http://e/x)">ok</p>');
  assert.ok(!/script|onerror|http/i.test(out), out);
  assert.match(out, /ok/);
});
test('docx → pdf', { skip: !HAS.soffice }, async () => {
  const buf = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('Word document text')] })] }] }));
  const r = await job(P.officeToPdf, 'docx', buf);
  assert.ok(isPdf(r.buffer));
  if (HAS.poppler) assert.match(text(r.buffer), /Word document text/);
});
test('pptx → pdf', { skip: !HAS.soffice }, async () => {
  const p = new PptxGenJS(); p.addSlide().addText('Slide text here', { x: 1, y: 1, fontSize: 24 });
  const r = await job(P.officeToPdf, 'pptx', await p.write({ outputType: 'nodebuffer' }));
  assert.ok(isPdf(r.buffer));
  if (HAS.poppler) assert.match(text(r.buffer), /Slide text here/);
});
test('xlsx → pdf', { skip: !HAS.soffice || !hasExcel }, async () => {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('S').addRow(['Cell value', 42]);
  const r = await job(P.officeToPdf, 'xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
  assert.ok(isPdf(r.buffer));
});
test('content sniffing rejects fake PDFs/HTML and (when file-type is installed) fake Office files', async () => {
  await rejects(sniff(Buffer.from('hello world'), 'pdf', 'x.pdf'), 'INVALID_FILE_TYPE');
  await rejects(sniff(Buffer.from([0x3c, 0, 0x3e]), 'html', 'x.html'), 'INVALID_FILE_TYPE');
  assert.deepEqual(await sniff(Buffer.from('%PDF-1.7 ...'), 'pdf', 'x.pdf'), { ext: 'pdf' });
  if (await import('file-type').then(() => true, () => false)) await rejects(sniff(Buffer.from('not a docx'), 'word', 'x.docx'), 'INVALID_FILE_TYPE');
});
test('qpdf: repair a PDF with a broken startxref pointer', { skip: !HAS.qpdf || !HAS.soffice }, async () => {
  const s = basePdf.toString('latin1').replace(/startxref\s+\d+/, 'startxref\n99999999');
  const r = await job(P.repair, 'pdf', Buffer.from(s, 'latin1'));
  assert.ok(isPdf(r.buffer));
  if (HAS.poppler) assert.match(text(r.buffer), /Hello badpdf world/);
});
test('qpdf: unrecoverable PDF fails with a clean PROCESSING_FAILED error', { skip: !HAS.qpdf || !HAS.soffice }, async () => {
  await rejects(job(P.repair, 'pdf', basePdf.subarray(0, 300)), 'PROCESSING_FAILED');
});
test('qpdf: protect → unlock round trip, wrong/missing password rejected', { skip: !HAS.qpdf || !HAS.soffice }, async () => {
  const enc = (await job(P.protect, 'pdf', basePdf, { password: 'secret1' })).buffer;
  assert.ok(enc.includes(Buffer.from('/Encrypt')));
  await rejects(job(P.unlock, 'pdf', enc, { password: 'wrong' }), 'INVALID_PASSWORD');
  await rejects(job(P.unlock, 'pdf', enc, { password: '' }), 'INVALID_PASSWORD');
  const dec = (await job(P.unlock, 'pdf', enc, { password: 'secret1' })).buffer;
  assert.ok(!dec.includes(Buffer.from('/Encrypt')));
  if (HAS.poppler) assert.match(text(dec), /Hello badpdf world/);
});
test('protect: password with special characters', { skip: !HAS.qpdf || !HAS.soffice }, async () => {
  const pw = "pä ss'w0rd #1";
  const enc = (await job(P.protect, 'pdf', basePdf, { password: pw })).buffer;
  const dec = (await job(P.unlock, 'pdf', enc, { password: pw })).buffer;
  assert.ok(isPdf(dec));
});
test('encrypted PDF into a converter → PASSWORD_REQUIRED', { skip: !HAS.qpdf || !HAS.poppler || !HAS.soffice }, async () => {
  const enc = (await job(P.protect, 'pdf', basePdf, { password: 'secret1' })).buffer;
  await rejects(job(P.toWord, 'pdf', enc), 'PASSWORD_REQUIRED');
});

test('pdf → word (docx contains the text)', { skip: !HAS.poppler || !HAS.soffice }, async () => {
  const r = await job(P.toWord, 'pdf', basePdf);
  assert.equal(r.buffer.subarray(0, 2).toString(), 'PK');
  assert.ok(r.buffer.includes(Buffer.from('word/document.xml')));
});
test('pdf → excel', { skip: !HAS.poppler || !HAS.soffice || !hasExcel }, async () => {
  const r = await job(P.toExcel, 'pdf', basePdf);
  assert.equal(r.buffer.subarray(0, 2).toString(), 'PK');
  assert.ok(r.buffer.includes(Buffer.from('xl/worksheets/sheet1.xml')));
});
test('pdf → powerpoint (one slide per page)', { skip: !HAS.poppler || !HAS.qpdf || !HAS.soffice }, async () => {
  const r = await job(P.toPowerpoint, 'pdf', basePdf);
  assert.ok(r.buffer.includes(Buffer.from('ppt/slides/slide1.xml')));
});
test('text-less PDF → NO_TEXT_LAYER', { skip: !HAS.poppler || !HAS.qpdf }, async () => {
  const blank = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF');
  await rejects(job(P.toWord, 'pdf', blank), 'NO_TEXT_LAYER');
});
test('ocr produces a searchable PDF', { skip: !HAS.tess || !HAS.poppler || !HAS.qpdf || !HAS.soffice }, async () => {
  const r = await job(P.ocr, 'pdf', basePdf, { lang: 'eng' });
  assert.ok(isPdf(r.buffer));
  assert.match(text(r.buffer), /Hello/i);
});
test('ghostscript compress returns a valid PDF (or the original)', { skip: !HAS.gs || !HAS.soffice }, async () => {
  const r = await job(P.compress, 'pdf', basePdf, { level: 'strong' });
  assert.ok(isPdf(r.buffer));
});

test('missing native tool → TOOL_NOT_INSTALLED', async () => {
  await rejects(run('definitely-not-installed-xyz', ['--version']), 'TOOL_NOT_INSTALLED');
});
test('runaway process is stopped → TIMEOUT', { skip: process.platform === 'win32' }, async () => {
  await rejects(run('sleep', ['5'], { timeout: 150 }), 'TIMEOUT');
});
test('job directories are removed after success and after failure', async () => {
  await job(async () => ({ buffer: Buffer.from('x') }), 'pdf', Buffer.from('x'));
  await assert.rejects(withJob(async () => { throw new Error('boom'); }));
  const left = (await readdir(config.tmpRoot).catch(() => [])).filter((n) => n.startsWith('job-'));
  assert.equal(left.length, 0);
});
