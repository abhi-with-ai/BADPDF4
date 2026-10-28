/* Pure processing functions: (job dir + input file + validated options) → { buffer, note }.
   No Express here, so they can be tested directly. Native tools run through util.run (no shell). */
import crypto from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Document, Packer, Paragraph, TextRun, PageBreak } from 'docx';
import PptxGenJS from 'pptxgenjs';
import { config } from './config.js';
import { ApiError, run } from './util.js';

const B = config.bins;

const readOut = async (p) => {
  try { const b = await readFile(p); if (b.length) return b; } catch { /* fall through */ }
  throw new ApiError(422, 'CONVERSION_FAILED', 'The conversion produced no output.');
};

/* ---- LibreOffice ---- */
async function soffice(dir, input, filter = 'pdf') {
  await run(B.soffice, [
    '--headless', '--norestore', '--nolockcheck', '--nodefault', '--nologo',
    `-env:UserInstallation=${pathToFileURL(path.join(dir, 'lo')).href}`,
    '--convert-to', filter, '--outdir', dir, input,
  ], { cwd: dir });
  return readOut(path.join(dir, 'input.pdf'));
}
export const officeToPdf = async ({ dir, input }) => ({ buffer: await soffice(dir, input) });

/** Best-effort HTML hardening. LibreOffice never runs scripts; we also strip active/remote content. */
export const cleanHtml = (h) => h
  // 1) remove whole active elements including their contents, 2) remove any leftover/unpaired tags
  .replace(/<\s*(script|iframe|object|embed|form|style)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
  .replace(/<\s*\/?\s*(script|iframe|object|embed|link|base|form|style|meta)\b[^>]*>/gi, '')
  .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  .replace(/\s(src|href|background|poster)\s*=\s*("\s*(https?:|file:|ftp:|\/\/)[^"]*"|'\s*(https?:|file:|ftp:|\/\/)[^']*')/gi, '')
  .replace(/url\(\s*['"]?\s*(https?:|file:|ftp:|\/\/)[^)]*\)/gi, 'none');
export async function htmlToPdf({ dir, input }) {
  await writeFile(input, cleanHtml((await readFile(input, 'utf8')).slice(0, 2_000_000)));
  return { buffer: await soffice(dir, input, 'pdf:writer_web_pdf_Export') };
}

/* ---- qpdf ---- */
export async function repair({ dir, input }) {
  const out = path.join(dir, 'out.pdf');
  const r = await run(B.qpdf, [input, out], { cwd: dir, okCodes: [0, 3] });
  return { buffer: await readOut(out), note: r.code === 3 ? 'Repaired with warnings; some content may be missing.' : undefined };
}
export async function protect({ dir, input, opts }) {
  const out = path.join(dir, 'out.pdf');
  const owner = opts.ownerPassword || crypto.randomBytes(12).toString('hex');
  // Passwords go through an argument file inside the private job dir, not the process command line.
  const argFile = path.join(dir, 'args.txt');
  await writeFile(argFile, ['--encrypt', opts.password, owner, '256', '--', input, out].join('\n'));
  await run(B.qpdf, ['@' + argFile], { cwd: dir, okCodes: [0, 3] }); // 3 = succeeded with warnings
  return { buffer: await readOut(out) };
}
export async function unlock({ dir, input, opts }) {
  const out = path.join(dir, 'out.pdf');
  const pwFile = path.join(dir, 'pw.txt');
  await writeFile(pwFile, opts.password ?? '');
  try {
    await run(B.qpdf, ['--password-file=' + pwFile, '--decrypt', input, out], { cwd: dir, okCodes: [0, 3] });
  } catch (e) {
    if (e.code === 'PASSWORD_REQUIRED') throw new ApiError(401, 'INVALID_PASSWORD', 'The password is missing or incorrect.');
    throw e;
  }
  return { buffer: await readOut(out) };
}

/* ---- Ghostscript ---- */
const GS = {
  recommended: ['-dPDFSETTINGS=/ebook'],
  strong: ['-dPDFSETTINGS=/screen'],
  maximum: ['-dPDFSETTINGS=/screen', '-dDownsampleColorImages=true', '-dColorImageResolution=50', '-dDownsampleGrayImages=true', '-dGrayImageResolution=50'],
};
export async function compress({ dir, input, opts, size }) {
  const out = path.join(dir, 'out.pdf');
  await run(B.gs, ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', ...GS[opts.level || 'recommended'], '-dNOPAUSE', '-dQUIET', '-dBATCH', '-dSAFER', `-sOutputFile=${out}`, input], { cwd: dir });
  const buffer = await readOut(out);
  if (buffer.length >= size) return { buffer: await readFile(input), note: 'This PDF could not be made smaller; your original was returned unchanged.' };
  return { buffer, note: `Reduced from ${(size / 1024).toFixed(0)} KB to ${(buffer.length / 1024).toFixed(0)} KB.` };
}

/* ---- Poppler: PDF → Word / Excel / PowerPoint ---- */
export async function pdfPages(dir, input) {
  const out = path.join(dir, 'text.txt');
  await run(B.pdftotext, ['-layout', '-enc', 'UTF-8', input, out], { cwd: dir });
  const pages = (await readFile(out, 'utf8')).split('\f');
  if (pages.length > 1 && !pages.at(-1).trim()) pages.pop();
  if (!pages.some((p) => p.trim()))
    throw new ApiError(422, 'NO_TEXT_LAYER', 'No selectable text found. This looks like a scanned PDF – run OCR first.');
  return pages;
}
export async function pageCount(dir, input) {
  const n = parseInt((await run(B.qpdf, ['--show-npages', input], { cwd: dir, okCodes: [0, 3] })).stdout, 10);
  if (!Number.isInteger(n)) throw new ApiError(422, 'PROCESSING_FAILED', 'Could not read the PDF page count.');
  if (n > config.maxPages) throw new ApiError(413, 'TOO_MANY_PAGES', `This tool is limited to ${config.maxPages} pages per file.`);
  return n;
}

export async function toWord({ dir, input }) {
  const pages = await pdfPages(dir, input);
  const children = [];
  pages.forEach((p, i) => {
    if (i) children.push(new Paragraph({ children: [new PageBreak()] }));
    for (const block of p.split(/\n\s*\n/)) {
      const t = block.replace(/\s*\n\s*/g, ' ').trim();
      if (t) children.push(new Paragraph({ children: [new TextRun(t)], spacing: { after: 160 } }));
    }
  });
  return { buffer: await Packer.toBuffer(new Document({ sections: [{ children }] })), note: 'Text and paragraphs only; layout, fonts, tables and images are not reproduced.' };
}

export async function toExcel({ dir, input }) {
  const { default: ExcelJS } = await import('exceljs');
  const pages = await pdfPages(dir, input);
  const wb = new ExcelJS.Workbook();
  pages.forEach((p, i) => {
    const ws = wb.addWorksheet('Page ' + (i + 1));
    p.split('\n').filter((l) => l.trim()).forEach((l) => ws.addRow(l.trim().split(/\s{2,}/)));
  });
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), note: 'Columns are guessed from text spacing. Check every value; complex tables will need manual fixing.' };
}

async function rasterise(dir, input, dpi) {
  await run(B.pdftoppm, ['-r', String(dpi), '-png', input, path.join(dir, 'pg')], { cwd: dir });
  const files = (await readdir(dir)).filter((f) => /^pg-\d+\.png$/.test(f)).sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)));
  if (!files.length) throw new ApiError(422, 'PROCESSING_FAILED', 'No pages could be rendered.');
  return files.map((f) => path.join(dir, f));
}

export async function toPowerpoint({ dir, input }) {
  await pageCount(dir, input);
  const imgs = await rasterise(dir, input, 110);
  const first = await readFile(imgs[0]);
  const W = 10, H = (W * first.readUInt32BE(20)) / first.readUInt32BE(16);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'PG', width: W, height: H });
  pptx.layout = 'PG';
  for (const f of imgs) pptx.addSlide().addImage({ data: 'image/png;base64,' + (await readFile(f)).toString('base64'), x: 0, y: 0, w: W, h: H });
  return { buffer: await pptx.write({ outputType: 'nodebuffer' }), note: 'Each slide is a picture of the PDF page, so text is not editable.' };
}

/* ---- Tesseract: OCR → searchable PDF ---- */
export async function ocr({ dir, input, opts }) {
  await pageCount(dir, input);
  const imgs = await rasterise(dir, input, 200);
  const pdfs = [];
  for (const img of imgs) {
    const outBase = img.replace(/\.png$/, '');
    await run(B.tesseract, [img, outBase, '-l', opts.lang || 'eng', 'pdf'], { cwd: dir });
    pdfs.push(outBase + '.pdf');
  }
  const out = path.join(dir, 'ocr.pdf');
  await run(B.qpdf, ['--empty', '--pages', ...pdfs, '--', out], { cwd: dir });
  return { buffer: await readOut(out), note: 'Pages are re-created from images; OCR accuracy depends on scan quality and installed language data.' };
}
