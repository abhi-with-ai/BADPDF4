import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { ApiError, run, withJob, sniff, baseName } from './util.js';
import * as P from './processors.js';

export const router = express.Router();
const B = config.bins;
const upload = multer({
  storage: multer.memoryStorage(), // nothing is written under the client's filename
  limits: { fileSize: config.maxFileBytes, files: 1, fields: 10, fieldSize: 4096 },
}).single('file');

const parse = (schema, body) => {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new ApiError(400, 'INVALID_OPTIONS', r.error.issues[0]?.message || 'Invalid options.');
  return r.data;
};

/** Register a tool: validates upload → sniffs content → runs in an isolated temp dir → returns the file. */
function tool(name, { kind, schema, suffix, mime, work }) {
  router.post('/' + name, (req, res, next) => upload(req, res, (e) => (e ? next(e) : next())), async (req, res, next) => {
    try {
      if (!req.file) throw new ApiError(400, 'NO_FILE', 'No file was uploaded.');
      if (!req.file.size) throw new ApiError(400, 'EMPTY_FILE', 'The uploaded file is empty.');
      const { ext } = await sniff(req.file.buffer, kind, req.file.originalname);
      const opts = schema ? parse(schema, req.body) : {};
      const out = await withJob(async (dir) => {
        const input = path.join(dir, 'input.' + ext);
        await writeFile(input, req.file.buffer);
        return work({ dir, input, ext, opts, size: req.file.size });
      });
      if (!out.buffer?.length) throw new ApiError(422, 'EMPTY_OUTPUT', 'The tool produced no output.');
      res.set({
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${baseName(req.file.originalname)}${suffix}"`,
        'Cache-Control': 'no-store',
        ...(out.note ? { 'X-Badpdf-Note': out.note } : {}),
      });
      res.send(out.buffer);
    } catch (e) { next(e); }
  });
}

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/* ---------- Tool table: endpoint → content kind, options schema, processor ---------- */
for (const [name, kind] of [['word-to-pdf', 'word'], ['excel-to-pdf', 'excel'], ['powerpoint-to-pdf', 'ppt']])
  tool(name, { kind, suffix: '.pdf', mime: PDF, work: P.officeToPdf });
tool('html-to-pdf', { kind: 'html', suffix: '.pdf', mime: PDF, work: P.htmlToPdf });
tool('repair', { kind: 'pdf', suffix: '-repaired.pdf', mime: PDF, work: P.repair });

const pw = z.string().min(1, 'Enter a password.').max(64, 'Password is too long (max 64).')
  .regex(/^[^"\\\r\n]+$/, 'Password may not contain quotes, backslashes or line breaks.');
tool('protect', {
  kind: 'pdf', suffix: '-protected.pdf', mime: PDF,
  schema: z.object({ password: pw, ownerPassword: pw.optional().or(z.literal('').transform(() => undefined)) }),
  work: P.protect,
});
tool('unlock', { kind: 'pdf', suffix: '-unlocked.pdf', mime: PDF, schema: z.object({ password: z.string().max(128).optional().default('') }), work: P.unlock });
tool('compress', {
  kind: 'pdf', suffix: '-compressed.pdf', mime: PDF,
  schema: z.object({ level: z.enum(['recommended', 'strong', 'maximum']).default('recommended') }), work: P.compress,
});
tool('to-word', { kind: 'pdf', suffix: '.docx', mime: DOCX, work: P.toWord });
tool('to-excel', { kind: 'pdf', suffix: '.xlsx', mime: XLSX, work: P.toExcel });
tool('to-powerpoint', { kind: 'pdf', suffix: '.pptx', mime: PPTX, work: P.toPowerpoint });
tool('ocr', {
  kind: 'pdf', suffix: '-ocr.pdf', mime: PDF,
  schema: z.object({ lang: z.string().regex(/^[a-z]{3}(_[a-z]+)?(\+[a-z]{3}(_[a-z]+)?)*$/, 'Invalid language code.').default('eng') }),
  work: P.ocr,
});

/* ---------- Health / tool availability ---------- */
let toolCache = { at: 0, data: null };
router.get('/health', async (_req, res) => {
  if (Date.now() - toolCache.at > 60_000) {
    const check = async (cmd, args) => run(cmd, args, { timeout: 20_000, okCodes: [0, 1, 99] }).then(() => true, () => false);
    const [soffice, qpdf, gs, pdftotext, pdftoppm, tesseract] = await Promise.all([
      check(B.soffice, ['--version']), check(B.qpdf, ['--version']), check(B.gs, ['--version']),
      check(B.pdftotext, ['-v']), check(B.pdftoppm, ['-v']), check(B.tesseract, ['--version']),
    ]);
    toolCache = { at: Date.now(), data: { soffice, qpdf, gs, pdftotext, pdftoppm, tesseract } };
  }
  res.json({ success: true, tools: toolCache.data });
});
