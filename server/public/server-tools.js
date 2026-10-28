/* Registers the server-backed tools into the BADPDF page. Loaded after the main script.
   Set window.BADPDF_API = "https://api.example.com" before this file if the API is on another origin. */
(() => {
  const API = (window.BADPDF_API || "") + "/api/";
  const NOTE = "This tool uploads your file to the BADPDF server. It is processed in a temporary folder and deleted when finished.";

  async function call(path, file, fields, ctx, fallback) {
    const fd = new FormData();
    fd.append("file", file);
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    ctx.p(1, 4);
    let r;
    try { r = await fetch(API + path, { method: "POST", body: fd }); }
    catch { throw Error("Cannot reach the BADPDF server. Is it running and is the API address correct?"); }
    ctx.p(3, 4);
    if (!r.ok) {
      let m = "Server error (" + r.status + ")";
      try { m = (await r.json()).error.message; } catch {}
      throw Error(m);
    }
    const note = r.headers.get("X-Badpdf-Note"); if (note) ctx.note(note);
    const name = ((r.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/) || [])[1] || fallback;
    const blob = await r.blob();
    if (!blob.size) throw Error("The server returned an empty file.");
    return [{ name, blob }];
  }

  const mk = (id, n, d, cat, ic, endpoint, exts, attr, label, how, opts = [], extra = {}) => ({
    id, n, d, cat, ic, srv: true, accept: "any", exts, acceptAttr: attr, dropLabel: label, how, note: NOTE + (extra.note ? " " + extra.note : ""), opts,
    async run([f], o, ctx) { return call(endpoint, f, o, ctx, f.name.replace(/\.[^.]+$/, "") + (extra.ext || ".pdf")); },
  });
  const PDF = /\.pdf$/i;

  const tools = [
    mk("word-to-pdf", "Word to PDF", "Convert DOC and DOCX files to PDF.", "To PDF", "W", "word-to-pdf", /\.docx?$/i, ".doc,.docx", "Word", "Server · LibreOffice", [], { note: "Layout may differ slightly from Word." }),
    mk("excel-to-pdf", "Excel to PDF", "Convert XLS and XLSX files to PDF.", "To PDF", "X", "excel-to-pdf", /\.xlsx?$/i, ".xls,.xlsx", "Excel", "Server · LibreOffice", [], { note: "Pagination and layout can differ from the original workbook." }),
    mk("powerpoint-to-pdf", "PowerPoint to PDF", "Convert PPT and PPTX files to PDF.", "To PDF", "P", "powerpoint-to-pdf", /\.pptx?$/i, ".ppt,.pptx", "PowerPoint", "Server · LibreOffice", [], { note: "Unsupported effects and fonts may change." }),
    mk("html-to-pdf", "HTML to PDF", "Convert an HTML file to PDF.", "To PDF", "<>", "html-to-pdf", /\.html?$/i, ".html,.htm", "HTML", "Server · LibreOffice", [], { note: "Scripts, remote images and external styles are removed. Use a single self-contained file." }),
    mk("pdf2word", "PDF to Word", "Extract text into an editable DOCX.", "From PDF", "W", "to-word", PDF, ".pdf", "PDF", "Server · Poppler + docx", [], { ext: ".docx", note: "Best effort: text and paragraphs only; complex layouts are not preserved." }),
    mk("pdf2excel", "PDF to Excel", "Extract table-like text into XLSX.", "From PDF", "X", "to-excel", PDF, ".pdf", "PDF", "Server · Poppler + ExcelJS", [], { ext: ".xlsx", note: "Best effort: columns are guessed from spacing." }),
    mk("pdf2ppt", "PDF to PowerPoint", "Turn each page into a slide.", "From PDF", "P", "to-powerpoint", PDF, ".pdf", "PDF", "Server · Poppler + PptxGenJS", [], { ext: ".pptx", note: "Slides contain page images, not editable text." }),
    mk("ocr", "OCR PDF", "Make a scanned PDF searchable.", "From PDF", "◎", "ocr", PDF, ".pdf", "scanned PDF", "Server · Tesseract",
      [{ k: "lang", l: "Language code (e.g. eng, deu, eng+fra)", t: "text", v: "eng" }], { ext: "-ocr.pdf" }),
    mk("compress-strong", "Compress PDF (Ghostscript)", "Stronger compression that keeps text selectable.", "Optimize", "⇲", "compress", PDF, ".pdf", "PDF", "Server · Ghostscript",
      [{ k: "level", l: "Level", t: "select", o: ["recommended", "strong", "maximum"], v: "recommended" }], { ext: "-compressed.pdf" }),
    mk("repair-server", "Repair PDF (qpdf)", "Rebuild a damaged PDF structure.", "Optimize", "✚", "repair", PDF, ".pdf", "PDF", "Server · qpdf", [], { ext: "-repaired.pdf", note: "Severely corrupted files may not be recoverable." }),
    mk("protect", "Protect PDF", "Encrypt a PDF with a password (AES-256).", "Security", "🔒", "protect", PDF, ".pdf", "PDF", "Server · qpdf",
      [{ k: "password", l: "Password to open the PDF", t: "password", v: "" }], { ext: "-protected.pdf", note: "Your password is sent to the server only for this request and is not logged. Use HTTPS in production." }),
    mk("unlock", "Unlock PDF", "Remove the password from a PDF you are allowed to open.", "Security", "🔓", "unlock", PDF, ".pdf", "PDF", "Server · qpdf",
      [{ k: "password", l: "Current password", t: "password", v: "" }], { ext: "-unlocked.pdf", note: "Only use this on files you are authorised to unlock. Unknown passwords cannot be bypassed." }),
  ];

  CATS.push("Security");
  tools.forEach((t) => TOOLS.push(t));
  ["Word to PDF", "Excel to PDF", "PowerPoint to PDF", "HTML to PDF", "PDF to Word", "PDF to Excel", "PDF to PowerPoint", "OCR PDF", "Protect PDF (encrypt)", "Unlock PDF"]
    .forEach((n) => { const i = SERVER.indexOf(n); if (i > -1) SERVER.splice(i, 1); });
  route();
})();
