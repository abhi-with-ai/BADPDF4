# BADPDF

Free PDF toolkit. **Browser tools** run entirely in the page (pdf-lib, PDF.js, JSZip). **Server tools** run on your own
Express server using free open-source programs. No paid APIs, no accounts, no database.

> Honest scope note: this is a simplified architecture (one static page + an Express API), not the React/Vite/Tailwind
> layout in the original spec. MongoDB is not used because no feature needs persistent data.

See `requirements.txt` for a plain checklist of requirements and run steps.

## Layout
```
badpdf/
├── package.json            root scripts
├── playwright.config.js, e2e/badpdf.spec.js   browser tests
├── Dockerfile, docker-compose.yml   optional (VPS)
└── server/
    ├── package.json, .env.example
    ├── src/ config.js util.js processors.js routes.js app.js server.js
    ├── public/ index.html (browser tools) + server-tools.js (11 server tools) + editor-tools.js (Organize, Edit, Sign) + extra-tools.js (Compare, Image Watermark)
    └── test/api.test.js (HTTP, needs express) + test/processors.test.js (real tools, no HTTP)
```

## Windows 10/11 (PowerShell)
1. Install **Node.js 20 or newer** from https://nodejs.org (check: `node -v`).
2. ```powershell
   cd badpdf
   npm run install:all
   Copy-Item server\.env.example server\.env   # optional; the server reads real environment variables
   npm run dev
   ```
   Open http://localhost:5000. **All browser tools work now**, with nothing else installed.
3. For server tools install the native programs and either add them to `PATH` or set the `*_PATH` variables
   (see `server/.env.example`; set them in PowerShell with `$env:SOFFICE_PATH="C:\...\soffice.exe"` before `npm run dev`):

| Needed for | Program | Get it from |
|---|---|---|
| Word/Excel/PowerPoint/HTML to PDF | LibreOffice | https://www.libreoffice.org/download |
| Repair, Protect, Unlock, OCR merge | qpdf (**10.2+**) | https://github.com/qpdf/qpdf/releases |
| Compress (Ghostscript) | Ghostscript | https://ghostscript.com/releases |
| PDF to Word/Excel/PowerPoint, OCR | Poppler (`pdftotext`, `pdftoppm`) | a Windows Poppler build, e.g. https://github.com/oschwartz10612/poppler-windows |
| OCR | Tesseract | https://github.com/UB-Mannheim/tesseract/wiki |

Check what the server can find: http://localhost:5000/api/health (each tool shows `true`/`false`).

## Linux (Debian/Ubuntu)
```bash
sudo apt install libreoffice-writer libreoffice-calc libreoffice-impress qpdf ghostscript poppler-utils tesseract-ocr
npm run install:all && npm start
```
Extra OCR languages: `sudo apt install tesseract-ocr-deu` etc.

## Commands
| Command | Does |
|---|---|
| `npm run install:all` | install root (Playwright, pdf-lib) **and** server dependencies |
| `npm run setup:e2e` | one-time download of the Chromium browser used by the browser tests |
| `npm run dev` | start with auto-restart |
| `npm start` | production mode |
| `npm test` | API tests (`node --test`; qpdf round-trip test is skipped if qpdf is missing) |
| `npm install` then `npx playwright install chromium` | one-time setup for browser tests |
| `npm run test:e2e` | Playwright browser tests (starts the server on :5000; set `E2E_API=1` to include the protect/unlock test that needs qpdf) |

## Tools
Browser (no upload): Compare PDFs (word-level text diff + report), Image Watermark (position/tile, opacity, rotation, page range), **Organize PDF (page thumbnails, drag-and-drop reorder, rotate, delete)**, **Edit PDF (text, highlight, rectangle, ellipse, pen, image)**, **Sign PDF (draw or upload, apply to this/all/selected pages)**, Merge, Split, Extract/Reorder, Delete pages, Rotate, Compress (rasterising), Repair (basic), Flatten
(forms), Images/JPG/PNG to PDF, PDF to JPG/PNG, PDF to Text, Page numbers, Watermark (text), Crop, Metadata.

Server (uploads the file, deleted after processing): Word/Excel/PowerPoint/HTML to PDF (LibreOffice), PDF to Word
(Poppler + docx), PDF to Excel (Poppler + ExcelJS), PDF to PowerPoint (Poppler + PptxGenJS), OCR (Poppler + Tesseract +
qpdf), Compress (Ghostscript), Repair, Protect, Unlock (qpdf).

Not built: nothing from the original tool list is left unbuilt, but several tools are best-effort (see limits above and per-tool notes). Compare PDFs compares the text layer only (no visual/layout diff, no scanned PDFs).

Editor limits: added text uses the built-in Helvetica font (Latin characters only); existing text in the PDF is not edited; drawing tools need a pointer (mouse, pen or touch), so they are not keyboard-operable; a visual signature is not a cryptographic digital signature; password-protected PDFs must be unlocked first.

## Security controls implemented
Content sniffing (never trusts MIME/extension alone), size limit, one file per request, random temp directory per job
(client filenames never touch the filesystem), native tools run **without a shell**, per-tool timeouts, concurrency
limit + queue cap, cleanup in `finally` plus a 10-minute sweep of stale folders, Helmet + CSP, explicit CORS, rate
limiting, JSON errors with no stack traces or paths, passwords not logged and passed to qpdf via files in the private job
folder. Jobs are synchronous (the response is the file), so there are no job IDs or download links to expire.

Limits you should know: HTML stripping is best-effort, so only expose HTML-to-PDF to trusted users or behind extra
isolation; the OCR/PowerPoint page cap is `MAX_PAGES_OCR`; one request can still use significant CPU.

## Deployment
**Simplest (one VPS, ~1 GB RAM+):** install the native tools (or use the `Dockerfile`), run `npm start` under systemd or
`docker compose up -d`, put nginx or Caddy in front for HTTPS, and set `client_max_body_size` above `MAX_FILE_MB`. The
server serves the page itself, so no CORS setup is needed.

**Static frontend elsewhere:** upload `server/public/*` to any static host, add
`<script>window.BADPDF_API="https://api.yourdomain.com"</script>` before `server-tools.js` in `index.html`, run the server
with `SERVE_CLIENT=false` and `CORS_ORIGINS=https://your-static-site`.

Not for serverless hosts: LibreOffice, Ghostscript and Tesseract need a real filesystem and long-running processes.

## Licences
pdf-lib (MIT), PDF.js (Apache-2.0), JSZip (MIT or GPLv3), Express, multer, helmet, cors, express-rate-limit, zod,
file-type, docx, ExcelJS, PptxGenJS (all MIT). Native programs: LibreOffice (MPL-2.0), qpdf (Apache-2.0), Poppler (GPL, run as
a separate program), Tesseract (Apache-2.0), **Ghostscript (AGPL-3.0, or a paid commercial licence)**. The AGPL matters
if you offer Ghostscript compression as a public network service: either publish your source as AGPL requires, or
remove the Ghostscript compress tool (browser Compress still works). Verify all licences yourself before launch.

## Status checklist
| Item | Status |
|---|---|
| JS syntax of server, page scripts, tests | Checked (`node --check`) |
| Range parser, 11 cases | Run, all pass |
| qpdf repair / encrypt / unlock, pdftotext, pdftoppm, Tesseract, LibreOffice HTML→PDF command lines | Run by hand in a sandbox, working |
| Playwright browser tests (21 pass + 1 skipped; covers home/search, merge, validation, password-protected, ranges, split+ZIP, rotate, images→PDF, Organize thumbnails/reorder/drag-drop/rotate/delete, Edit, Sign, server-tool error) | **Run in Chromium, 16 passed, 1 skipped.** Run against a static server with local copies of pdf-lib/JSZip and a newer PDF.js than the page uses on cdnjs (3.11), so re-run with `npm run test:e2e` on your machine |
| Edit export on a rotated page | Checked visually: shapes and upright text land where placed |
| Real processing pipelines via `test/processors.test.js` (LibreOffice: HTML/DOCX/PPTX→PDF; qpdf: repair, protect, unlock incl. wrong password and special characters; Poppler: PDF→Word/PowerPoint, no-text-layer error; Tesseract OCR; timeout, missing-tool and temp-folder cleanup) | **Run: 17 pass, 3 skipped** (Excel tests need `exceljs`, compress needs Ghostscript – neither was installed in the build sandbox) |
| Route wiring: all 12 endpoints + `/api/health` registered; handlers driven with fake requests (no file, empty file, fake PDF, path-traversal filename, headers, cleanup) | Run with stubbed Express/multer/zod, all assertions pass |
| Express itself (`npm test` api.test.js, real uploads over HTTP, helmet/CORS/rate limit), Ghostscript compress, PDF→Excel, XLSX→PDF | **Not run** (no npm registry in the build sandbox) |
| `protect then unlock through the real server` Playwright test | Written, skipped here (needs the Express server) |
| Output opened in several PDF viewers, other browsers, mobile | Not tested |
