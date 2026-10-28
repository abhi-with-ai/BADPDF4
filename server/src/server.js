import 'node:process';
import { mkdir } from 'node:fs/promises';
import { app } from './app.js';
import { config } from './config.js';
import { sweepStale } from './util.js';

await mkdir(config.tmpRoot, { recursive: true });
await sweepStale();
setInterval(sweepStale, 10 * 60 * 1000).unref();

const server = app.listen(config.port, () => {
  console.log(`BADPDF server listening on http://localhost:${config.port}`);
  console.log(`Temp dir: ${config.tmpRoot} · max file ${config.maxFileBytes / 1048576} MB · ${config.maxConcurrent} concurrent jobs`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
