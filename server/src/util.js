import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Run a native tool WITHOUT a shell (arguments are never interpreted). stderr is never sent to clients. */
export function run(cmd, args, { cwd, timeout = config.jobTimeoutMs, okCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd, args,
      { cwd, timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, HOME: cwd || process.env.HOME } },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout, stderr, code: 0 });
        if (typeof err.code === 'number' && okCodes.includes(err.code)) return resolve({ stdout, stderr, code: err.code });
        if (err.code === 'ENOENT')
          return reject(new ApiError(501, 'TOOL_NOT_INSTALLED', `The server tool "${path.basename(cmd)}" is not installed or not configured.`));
        if (err.killed || err.signal === 'SIGTERM')
          return reject(new ApiError(504, 'TIMEOUT', 'Processing took too long and was stopped.'));
        if (/password/i.test(String(stderr)))
          return reject(new ApiError(401, 'PASSWORD_REQUIRED', 'This PDF is password-protected.'));
        reject(new ApiError(422, 'PROCESSING_FAILED', 'The tool could not process this file. It may be damaged or unsupported.'));
      },
    );
  });
}

/* ---- Job isolation: random temp dir per job, concurrency limit, guaranteed cleanup ---- */
let active = 0;
const waiting = [];
const acquire = () =>
  new Promise((resolve, reject) => {
    if (active < config.maxConcurrent) { active++; return resolve(); }
    if (waiting.length >= config.maxQueue) return reject(new ApiError(503, 'SERVER_BUSY', 'The server is busy. Please try again shortly.'));
    waiting.push(resolve);
  });
const release = () => { const next = waiting.shift(); if (next) next(); else active--; };

export async function withJob(fn) {
  await acquire();
  let dir;
  try {
    await mkdir(config.tmpRoot, { recursive: true });
    dir = await mkdtemp(path.join(config.tmpRoot, 'job-'));
    return await fn(dir);
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    release();
  }
}

/** Remove abandoned job folders (crash/kill leftovers). */
export async function sweepStale() {
  try {
    for (const name of await readdir(config.tmpRoot)) {
      if (!name.startsWith('job-')) continue;
      const p = path.join(config.tmpRoot, name);
      const s = await stat(p).catch(() => null);
      if (s && Date.now() - s.mtimeMs > config.staleJobMs) await rm(p, { recursive: true, force: true }).catch(() => {});
    }
  } catch { /* tmp root does not exist yet */ }
}

/* ---- Content sniffing: never trust client MIME type or extension alone ---- */
const OOXML = {
  word: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', 'doc'],
  excel: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx', 'xls'],
  ppt: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx', 'ppt'],
};

export async function sniff(buf, kind, originalName = '') {
  const bad = () => new ApiError(415, 'INVALID_FILE_TYPE', 'The uploaded file is not a supported file type.');
  if (kind === 'pdf') {
    if (!buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw bad();
    return { ext: 'pdf' };
  }
  if (kind === 'html') {
    if (buf.subarray(0, 2000).includes(0)) throw bad();
    return { ext: 'html' };
  }
  const [mime, ext, legacy] = OOXML[kind];
  const { fileTypeFromBuffer } = await import('file-type');
  const t = await fileTypeFromBuffer(buf);
  if (t?.mime === mime) return { ext };
  if (t?.mime === 'application/x-cfb' && originalName.toLowerCase().endsWith('.' + legacy)) return { ext: legacy };
  throw bad();
}

export const baseName = (n = 'document') => path.parse(String(n)).name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'document';
