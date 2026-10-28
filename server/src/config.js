import os from 'node:os';
import path from 'node:path';

const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : d);
const win = process.platform === 'win32';
const e = process.env;

export const config = {
  port: num(e.PORT, 5000),
  corsOrigins: (e.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  serveClient: e.SERVE_CLIENT !== 'false',
  maxFileBytes: num(e.MAX_FILE_MB, 50) * 1024 * 1024,
  jobTimeoutMs: num(e.JOB_TIMEOUT_SEC, 120) * 1000,
  maxConcurrent: num(e.MAX_CONCURRENT_JOBS, 2),
  maxQueue: 10,
  maxPages: num(e.MAX_PAGES_OCR, 50),
  rateLimitMax: num(e.RATE_LIMIT_MAX, 60),
  tmpRoot: e.TMP_ROOT || path.join(os.tmpdir(), 'badpdf'),
  staleJobMs: 30 * 60 * 1000,
  bins: {
    soffice: e.SOFFICE_PATH || 'soffice',
    qpdf: e.QPDF_PATH || 'qpdf',
    gs: e.GS_PATH || (win ? 'gswin64c' : 'gs'),
    pdftotext: e.PDFTOTEXT_PATH || 'pdftotext',
    pdftoppm: e.PDFTOPPM_PATH || 'pdftoppm',
    tesseract: e.TESSERACT_PATH || 'tesseract',
  },
};
