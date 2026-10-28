import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { router } from './routes.js';
import { ApiError } from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind nginx / a platform proxy

const CDN = 'https://cdnjs.cloudflare.com';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // The page ships one inline script/style block, hence 'unsafe-inline'; third-party scripts are limited to cdnjs.
      scriptSrc: ["'self'", "'unsafe-inline'", CDN],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'blob:'],
      workerSrc: ["'self'", 'blob:', CDN],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use('/api', cors({
  origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
  methods: ['GET', 'POST'],
  exposedHeaders: ['Content-Disposition', 'X-Badpdf-Note'],
}));
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000, limit: config.rateLimitMax, standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a few minutes.' } },
}));
app.use('/api', router);
app.use('/api', (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Unknown API endpoint.')));
if (config.serveClient) app.use(express.static(path.join(here, '..', 'public')));

// Consistent JSON errors. Never expose stack traces, paths or tool output.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  let { status, code, message } = err;
  if (err.name === 'MulterError') {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${Math.round(config.maxFileBytes / 1048576)} MB.` : 'The upload was rejected.';
  } else if (!(err instanceof ApiError)) {
    console.error('Unhandled error:', err.name); // name only – never document data
    status = 500; code = 'INTERNAL_ERROR'; message = 'Something went wrong on the server.';
  }
  res.status(status || 500).json({ success: false, error: { code, message } });
});
