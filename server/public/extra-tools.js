/* BADPDF extra browser tools: Compare PDFs (text diff) and Image Watermark. Loaded after editor-tools.js. */
(() => {
  document.head.appendChild(Object.assign(document.createElement("style"), { textContent: `
.cmp ins{background:#dcfce7;color:#166534;text-decoration:none;border-radius:3px;padding:0 2px}.cmp del{background:#fee2e2;color:#991b1b;border-radius:3px;padding:0 2px}
.cmp details{margin-top:8px}.cmp .body{line-height:1.8;margin-top:8px;word-break:break-word}.cmp summary b.s{font-weight:600;color:var(--mut)}` }));

  /* ---------- Compare PDFs ---------- */
  async function pageTexts(js) {
    const out = [];
    for (let i = 1; i <= js.numPages; i++) {
      const p = await js.getPage(i);
      out.push((await p.getTextContent()).items.map((x) => x.str).join(" ").replace(/\s+/g, " ").trim()); p.cleanup();
    }
    return out;
  }
  /** Word-level diff (LCS). Very different pages fall back to "all removed / all added". */
  function diff(a, b) {
    let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let ea = a.length, eb = b.length; while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
    const A = a.slice(s, ea), B = b.slice(s, eb), ops = a.slice(0, s).map((x) => ({ k: "=", s: x })), n = A.length, m = B.length;
    if (n * m > 6e6) { A.forEach((x) => ops.push({ k: "-", s: x })); B.forEach((x) => ops.push({ k: "+", s: x })); }
    else {
      const w = m + 1, T = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i * w + j] = A[i] === B[j] ? T[(i + 1) * w + j + 1] + 1 : Math.max(T[(i + 1) * w + j], T[i * w + j + 1]);
      let i = 0, j = 0;
      while (i < n && j < m) { if (A[i] === B[j]) { ops.push({ k: "=", s: A[i] }); i++; j++; } else if (T[(i + 1) * w + j] >= T[i * w + j + 1]) ops.push({ k: "-", s: A[i++] }); else ops.push({ k: "+", s: B[j++] }); }
      while (i < n) ops.push({ k: "-", s: A[i++] }); while (j < m) ops.push({ k: "+", s: B[j++] });
    }
    b.slice(eb).forEach((x) => ops.push({ k: "=", s: x }));
    return ops;
  }
  function renderOps(ops) {
    const out = []; let i = 0;
    while (i < ops.length) {
      if (ops[i].k === "=") {
        let j = i; while (j < ops.length && ops[j].k === "=") j++;
        const run = ops.slice(i, j).map((o) => esc(o.s));
        out.push(run.length > 30 ? run.slice(0, 8).join(" ") + " <span class=small>… (" + (run.length - 16) + " unchanged words) …</span> " + run.slice(-8).join(" ") : run.join(" ")); i = j;
      } else { out.push(`<${ops[i].k === "+" ? "ins" : "del"}>${esc(ops[i].s)}</${ops[i].k === "+" ? "ins" : "del"}>`); i++; }
    }
    return out.join(" ");
  }

  function compareUI(t) {
    revoke(); document.title = t.n + " Online Free | BADPDF";
    const docs = {};
    app.innerHTML = `<div class="crumb"><a href="#">Home</a> › ${t.cat} › ${t.n}</div><h1 style="margin:0">${t.n}</h1>
    <p class="small">${t.d} <b>Processing: Browser · PDF.js</b> – files stay on your device.</p>
    <div class="panel cmp"><div class="msg note" style="margin-top:0">Compares the text layer only, word by word, page by page. Layout, images and formatting changes are not detected, and scanned PDFs have no text to compare.</div>
    <div class="opts"><label>Original PDF<input id="f_a" type="file" accept=".pdf,application/pdf"></label><label>Revised PDF<input id="f_b" type="file" accept=".pdf,application/pdf"></label></div>
    <div id="info" class="small" style="margin-top:8px"></div>
    <div style="margin-top:16px;display:flex;gap:8px"><button class="btn" id="go" disabled>Compare PDFs</button><button class="btn sec" id="reset">Reset</button></div>
    <div id="status" role="status"></div><div id="summary"></div><div id="pages"></div><div id="res"></div></div>`;
    const info = () => { $("#info").innerHTML = ["a", "b"].filter((k) => docs[k]).map((k) => `${k === "a" ? "Original" : "Revised"}: <b>${esc(docs[k].name)}</b> · ${docs[k].js.numPages} pages`).join("<br>"); $("#go").disabled = !(docs.a && docs.b); };
    for (const k of ["a", "b"]) $("#f_" + k).onchange = async (e) => {
      const f = e.target.files[0]; delete docs[k]; info(); if (!f) return;
      try {
        if (!f.size) throw Error("The file is empty.");
        if (f.size > MAXMB * 1048576) throw Error("The file is larger than " + MAXMB + " MB.");
        const buf = await f.arrayBuffer();
        if (!new TextDecoder().decode(buf.slice(0, 1024)).includes("%PDF-")) throw Error("That is not a valid PDF.");
        let js; try { js = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise; } catch (er) { throw Error(/password/i.test(er.message + er.name) ? "Password-protected PDFs are not supported. Unlock it first." : "This PDF could not be read (it may be damaged)."); }
        docs[k] = { name: f.name, js }; $("#status").innerHTML = ""; info();
      } catch (er) { e.target.value = ""; $("#status").innerHTML = `<div class="msg err">${esc(er.message)}</div>`; }
    };
    $("#reset").onclick = () => compareUI(t);
    $("#go").onclick = async () => {
      $("#go").disabled = true; $("#status").innerHTML = '<div class="msg note">Comparing in your browser…</div>';
      try {
        const [ta, tb] = [await pageTexts(docs.a.js), await pageTexts(docs.b.js)];
        if (!ta.some(Boolean) || !tb.some(Boolean)) throw Error("One of the PDFs has no selectable text (it may be scanned). Run OCR first, then compare.");
        const n = Math.max(ta.length, tb.length); let added = 0, removed = 0, changed = 0, rows = "", report = `Compare: ${docs.a.name} → ${docs.b.name}\n\n`;
        for (let i = 0; i < n; i++) {
          let label, body = "", cls = "";
          if (i >= ta.length) { label = "only in revised"; const w = tb[i].split(" ").filter(Boolean); added += w.length; body = `<ins>${esc(w.join(" "))}</ins>`; changed++; }
          else if (i >= tb.length) { label = "only in original"; const w = ta[i].split(" ").filter(Boolean); removed += w.length; body = `<del>${esc(w.join(" "))}</del>`; changed++; }
          else {
            const ops = diff(ta[i].split(" ").filter(Boolean), tb[i].split(" ").filter(Boolean)), a = ops.filter((o) => o.k === "+"), r = ops.filter((o) => o.k === "-");
            added += a.length; removed += r.length;
            if (a.length || r.length) { changed++; label = `+${a.length} added, −${r.length} removed`; body = renderOps(ops); report += `Page ${i + 1}: +${a.map((o) => o.s).join(" ")} | -${r.map((o) => o.s).join(" ")}\n`; } else label = "no text changes";
          }
          if (body) report += "";
          rows += `<details class="pg-row" ${body ? "open" : ""}><summary><b>Page ${i + 1}</b> <b class="s">– ${label}</b></summary>${body ? `<div class="body">${body}</div>` : ""}</details>`;
        }
        $("#summary").innerHTML = `<div class="msg ${changed ? "note" : "ok"}" id="sum">${changed ? `${changed} of ${n} page(s) differ: <ins>${added} word(s) added</ins> <del>${removed} word(s) removed</del>` : "No text differences found."}${ta.length !== tb.length ? ` Page counts differ (${ta.length} vs ${tb.length}).` : ""}</div>`;
        $("#pages").innerHTML = rows; $("#status").innerHTML = "";
        const u = URL.createObjectURL(new Blob([report + `\nTotal: +${added} / −${removed} words`], { type: "text/plain" })); urls.push(u);
        $("#res").innerHTML = `<div class="file"><span>comparison-report.txt</span><a class="btn" style="padding:4px 12px" href="${u}" download="comparison-report.txt">Download report</a></div>`;
      } catch (er) { $("#status").innerHTML = `<div class="msg err">Failed: ${esc(er.message)}</div>`; }
      $("#go").disabled = false;
    };
  }

  /* ---------- Image watermark ---------- */
  function wmUI(t) {
    BP.start(t, async (pdf) => {
      let img = null;
      $("#work").innerHTML = `<p class="small"><b>${esc(pdf.name)}</b> · ${pdf.n} pages</p>
      <div class="opts"><label>Watermark image (PNG, JPG, WebP)<input id="wi" type="file" accept="image/*"></label>
      <label>Position<select id="pos">${["Center", "Top left", "Top right", "Bottom left", "Bottom right", "Tile"].map((x) => `<option>${x}</option>`).join("")}</select></label>
      <label>Size (% of page width)<input id="sz" type="number" value="40" min="5" max="100"></label>
      <label>Opacity (0.05–1)<input id="op" type="number" value="0.3" step="0.05" min="0.05" max="1"></label>
      <label>Rotation (°)<input id="rot" type="number" value="0"></label>
      <label>Pages (blank = all, e.g. 1-3,5)<input id="pg" type="text"></label></div>
      <div class="msg note">Placement assumes the page's own orientation; on pages with a built-in rotation the mark may be turned.</div>
      <div style="margin-top:16px;display:flex;gap:8px"><button class="btn" id="go">Add watermark</button><button class="btn sec" id="again">Choose another PDF</button></div>
      <div id="status" role="status"></div><div id="res"></div>`;
      $("#again").onclick = () => wmUI(t);
      $("#wi").onchange = async (e) => { try { img = await BP.fileToPng(e.target.files[0]); BP.say("ok", "Image loaded."); } catch (er) { img = null; BP.say("err", er.message); } };
      $("#go").onclick = async () => {
        if (!img) return BP.say("err", "Choose a watermark image first.");
        try {
          const pages = parseRange($("#pg").value, pdf.n), size = Math.min(100, Math.max(5, +$("#sz").value || 40)), op = Math.min(1, Math.max(0.05, +$("#op").value || 0.3)), th = (+$("#rot").value || 0) * Math.PI / 180, pos = $("#pos").value;
          const out = await L.PDFDocument.load(pdf.buf), im = await out.embedPng(Uint8Array.from(atob(img.src.split(",")[1]), (c) => c.charCodeAt(0))), all = out.getPages();
          for (const i of pages) {
            const pg = all[i], { width: W, height: H } = pg.getSize(), w = W * size / 100, h = w * im.height / im.width, m = 24, c = [];
            if (pos === "Center") c.push([W / 2, H / 2]);
            else if (pos === "Tile") for (let y = h / 2 + m; y < H; y += h * 1.8) for (let x = w / 2 + m; x < W; x += w * 1.6) c.push([x, y]);
            else c.push([pos.includes("left") ? m + w / 2 : W - m - w / 2, pos.startsWith("Top") ? H - m - h / 2 : m + h / 2]);
            for (const [cx, cy] of c) pg.drawImage(im, { x: cx - (w / 2) * Math.cos(th) + (h / 2) * Math.sin(th), y: cy - (w / 2) * Math.sin(th) - (h / 2) * Math.cos(th), width: w, height: h, opacity: op, rotate: L.degrees(+$("#rot").value || 0) });
          }
          BP.offer(await pdfBlob(out), base(pdf.name) + "-watermarked.pdf");
        } catch (er) { BP.say("err", er.message); }
      };
    });
  }

  TOOLS.push(
    { id: "compare", n: "Compare PDFs", d: "Highlight added and removed words between two PDFs.", cat: "Edit", ic: "⇄", how: "PDF.js", opts: [], ui: compareUI },
    { id: "imgwatermark", n: "Image Watermark", d: "Stamp a logo or image on pages with opacity and rotation.", cat: "Edit", ic: "◩", how: "pdf-lib", opts: [], ui: wmUI },
  );
  const i = SERVER.indexOf("Compare PDFs"); if (i > -1) SERVER.splice(i, 1);
  route();
})();
