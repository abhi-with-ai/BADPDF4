/* BADPDF visual tools: Organize (thumbnails + drag reorder), Edit PDF (canvas editor), Sign PDF.
   Loaded after the main page script; uses its globals (L = pdf-lib, pdfjsLib, $, esc, fmtSize, base, pdfBlob, parseRange, TOOLS, CATS, SERVER, app, urls, revoke, route, MAXMB). */
(() => {
  const css = `
.pgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:14px}
.pgc{border:1px solid var(--bd);border-radius:10px;padding:8px;background:var(--bg);text-align:center;cursor:grab}.pgc.del{opacity:.35}.pgc.over{outline:2px dashed var(--red)}.pgc:focus-within{border-color:var(--red)}
.pgc .im{height:170px;display:grid;place-items:center;overflow:hidden}.pgc img{max-width:100%;max-height:160px;transition:transform .15s;background:#fff;box-shadow:0 1px 4px #0003;pointer-events:none}
.pgc .bt{display:flex;justify-content:center;gap:4px;margin-top:6px;flex-wrap:wrap}.pgc button,.tb button{border:1px solid var(--bd);background:var(--card);border-radius:6px;cursor:pointer;padding:3px 9px}
.tb{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}.tb button[aria-pressed=true]{background:var(--red);color:#fff;border-color:var(--red)}
.tb label{display:flex;gap:4px;align-items:center;font-size:13px;font-weight:600}.tb input[type=text],.tb input[type=number],.tb select{padding:5px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg)}
.stage{position:relative;margin:10px auto;width:max-content;max-width:100%;overflow:auto;border:1px solid var(--bd);background:#888}.stage canvas{display:block}.stage #ov{position:absolute;left:0;top:0;touch-action:none;cursor:crosshair}
.pad{border:1px solid var(--bd);border-radius:8px;background:#fff;touch-action:none;cursor:crosshair}`;
  document.head.appendChild(Object.assign(document.createElement("style"), { textContent: css }));

  const $$ = (s, e = document) => [...e.querySelectorAll(s)];
  const say = (c, m) => { const s = $("#status"); if (s) s.innerHTML = `<div class="msg ${c}">${esc(m)}</div>`; };
  const rgbOf = (h) => L.rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

  async function openPdf(f) {
    if (f.size > MAXMB * 1048576) throw Error(f.name + " is larger than " + MAXMB + " MB.");
    if (!f.size) throw Error("The file is empty.");
    const buf = await f.arrayBuffer();
    if (!new TextDecoder().decode(buf.slice(0, 1024)).includes("%PDF-")) throw Error("That is not a valid PDF.");
    let lib;
    try { lib = await L.PDFDocument.load(buf); }
    catch (e) { throw Error(/encrypt/i.test(e.message) ? "Password-protected PDFs are not supported. Unlock it first." : "This PDF could not be read (it may be damaged)."); }
    const js = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
    return { name: f.name, buf, lib, js, n: lib.getPageCount() };
  }

  function start(t, onFile, note = "") {
    revoke(); document.title = t.n + " Online Free | BADPDF";
    app.innerHTML = `<div class="crumb"><a href="#">Home</a> › ${t.cat} › ${t.n}</div><h1 style="margin:0">${t.n}</h1>
    <p class="small">${t.d} <b>Processing: Browser · ${t.how}</b> – files stay on your device.</p>
    <div class="panel" id="work"><div class="drop" id="drop" tabindex="0" role="button" aria-label="Choose a PDF"><b>Drop a PDF here</b><br><span class="small">or click to browse · max ${MAXMB} MB</span>
    <input id="fi" type="file" hidden accept=".pdf,application/pdf"></div>${note ? `<div class="msg note">${note}</div>` : ""}<div id="status" role="status"></div></div>`;
    const dz = $("#drop"), fi = $("#fi");
    const go = async (f) => { if (!f) return; try { say("note", "Loading…"); const pdf = await openPdf(f); await onFile(pdf); } catch (e) { say("err", e.message); } };
    dz.onclick = () => fi.click();
    dz.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fi.click(); } };
    fi.onchange = () => { go(fi.files[0]); fi.value = ""; };
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
    dz.ondragleave = () => dz.classList.remove("over");
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("over"); go(e.dataTransfer.files[0]); };
  }

  function offer(blob, name) {
    revoke();
    const u = URL.createObjectURL(blob); urls.push(u);
    $("#res").innerHTML = `<div class="file"><span>${esc(name)}</span><small>${fmtSize(blob.size)}</small><a class="btn" style="padding:4px 12px" href="${u}" download="${esc(name)}">Download</a></div>`;
    say("ok", "Done – your PDF is ready.");
  }

  const loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(Error("That image could not be read.")); i.src = url; });
  async function fileToPng(f) {
    if (!/^image\//.test(f.type) || f.size > 10 * 1048576) throw Error("Choose an image file under 10 MB.");
    const src = URL.createObjectURL(f);
    try {
      const im = await loadImg(src), c = document.createElement("canvas");
      c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext("2d").drawImage(im, 0, 0);
      return loadImg(c.toDataURL("image/png"));
    } finally { URL.revokeObjectURL(src); }
  }

  /* ================= Organize: thumbnails, drag to reorder, rotate, delete ================= */
  async function thumb(js, i) {
    const p = await js.getPage(i + 1), v = p.getViewport({ scale: 1 }), vp = p.getViewport({ scale: 300 / Math.max(v.width, v.height) });
    const c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    await p.render({ canvasContext: c.getContext("2d"), viewport: vp, background: "#fff" }).promise;
    const u = c.toDataURL("image/jpeg", 0.7); c.width = c.height = 0; p.cleanup(); return u;
  }

  function organizeUI(t) {
    start(t, async (pdf) => {
      let items = pdf.lib.getPageIndices().map((i) => ({ i, rot: 0, del: false })), thumbs = [], drag = -1;
      $("#work").innerHTML = `<p class="small"><b>${esc(pdf.name)}</b> · ${pdf.n} pages. Drag pages to reorder (or use ◀ ▶), rotate with ↺ ↻, remove with ✕.</p>
      <div class="pgs" id="pgs"></div><div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="exp">Export PDF</button><button class="btn sec" id="again">Choose another file</button></div>
      <div id="status" role="status"></div><div id="res"></div>`;
      const draw = () => {
        $("#pgs").innerHTML = items.map((x, k) => `<div class="pgc ${x.del ? "del" : ""}" draggable="true" data-k="${k}" role="group" aria-label="Page ${x.i + 1}, position ${k + 1}">
          <div class="im">${thumbs[x.i] === "fail" ? '<span class="small">Preview unavailable</span>' : thumbs[x.i] ? `<img src="${thumbs[x.i]}" alt="Page ${x.i + 1}" style="transform:rotate(${x.rot}deg)">` : `<span class="small">${thumbs[x.i] === "" ? "No preview" : "Loading…"}</span>`}</div>
          <div class="small">Page ${x.i + 1}${x.rot ? " · " + x.rot + "°" : ""}${x.del ? " · removed" : ""}</div>
          <div class="bt"><button data-a="ml" aria-label="Move page ${x.i + 1} earlier">◀</button><button data-a="l" aria-label="Rotate page ${x.i + 1} left">↺</button><button data-a="r" aria-label="Rotate page ${x.i + 1} right">↻</button><button data-a="d" aria-label="${x.del ? "Restore" : "Remove"} page ${x.i + 1}">${x.del ? "↩" : "✕"}</button><button data-a="mr" aria-label="Move page ${x.i + 1} later">▶</button></div></div>`).join("");
      };
      const move = (a, b) => { if (b < 0 || b >= items.length || a === b) return; items.splice(b, 0, items.splice(a, 1)[0]); };
      const pgs = $("#pgs");
      pgs.onclick = (e) => {
        const b = e.target.closest("button"), c = e.target.closest(".pgc"); if (!b || !c) return;
        const k = +c.dataset.k, x = items[k], a = b.dataset.a;
        if (a === "l") x.rot = (x.rot + 270) % 360; else if (a === "r") x.rot = (x.rot + 90) % 360;
        else if (a === "d") x.del = !x.del; else if (a === "ml") move(k, k - 1); else if (a === "mr") move(k, k + 1);
        draw();
      };
      pgs.ondragstart = (e) => { const c = e.target.closest(".pgc"); if (c) { drag = +c.dataset.k; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(drag)); } };
      pgs.ondragover = (e) => { if (drag < 0) return; e.preventDefault(); $$(".pgc.over", pgs).forEach((n) => n.classList.remove("over")); e.target.closest(".pgc")?.classList.add("over"); };
      pgs.ondrop = (e) => { e.preventDefault(); const c = e.target.closest(".pgc"); if (c && drag >= 0) move(drag, +c.dataset.k); drag = -1; draw(); };
      pgs.ondragend = () => { drag = -1; draw(); };
      $("#again").onclick = () => organizeUI(t);
      $("#exp").onclick = async () => {
        const keep = items.filter((x) => !x.del);
        if (!keep.length) return say("err", "You removed every page – the PDF would be empty.");
        try {
          const out = await L.PDFDocument.create(), pages = await out.copyPages(pdf.lib, keep.map((x) => x.i));
          pages.forEach((p, k) => { p.setRotation(L.degrees((p.getRotation().angle + keep[k].rot + 360) % 360)); out.addPage(p); });
          offer(await pdfBlob(out), base(pdf.name) + "-organized.pdf");
        } catch (e) { say("err", "Failed: " + e.message); }
      };
      draw();
      for (let i = 0; i < pdf.n; i++) {
        try { thumbs[i] = await thumb(pdf.js, i); } catch { thumbs[i] = "fail"; }
        if (drag < 0 && $("#pgs")) draw(); else if (!$("#pgs")) return; // user left the page
      }
    });
  }

  /* ================= Edit PDF and Sign PDF share one canvas editor ================= */
  function editorUI(t, sign) {
    const note = sign ? "A drawn or uploaded signature is a visual mark only – it is not a cryptographically verifiable digital signature."
      : "Added text, shapes and images sit on top of the page. Existing text inside the PDF is not edited or removed.";
    start(t, async (pdf) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const S = { tool: sign ? "sign" : "text", p: 0, objs: [], scale: 1, v1: null, cur: null, img: null, sig: null, g: 0, vps: [], task: null, tk: 0 };
      const tools = [["text", "Text"], ["hl", "Highlight"], ["rect", "Rectangle"], ["ell", "Ellipse"], ["pen", "Pen"], ["img", "Image"]];
      $("#work").innerHTML = `<div class="msg note" style="margin-top:0">${note} Drawing tools need a mouse, pen or touch.</div>
      ${sign ? `<div class="tb"><canvas id="pad" class="pad" width="360" height="130" style="width:360px;max-width:100%;height:auto" aria-label="Signature drawing pad"></canvas>
        <div style="display:grid;gap:6px"><button id="padclr">Clear pad</button><button id="padok">Use drawn signature</button><label>or upload <input type="file" id="sigf" accept="image/*"></label></div><div id="sigprev" class="small">No signature yet</div></div>
        <div class="tb"><label>Width (pt) <input type="number" id="iw" value="140" min="20" max="500" style="width:70px"></label>
        <label>Apply to <select id="ap"><option value="this">This page only</option><option value="all">All pages</option><option value="range">Page range…</option></select></label><input type="text" id="rng" placeholder="e.g. 1,3-5" hidden aria-label="Page range"></div>`
      : `<div class="tb" role="toolbar" aria-label="Tools">${tools.map(([k, l]) => `<button data-tool="${k}" aria-pressed="${k === "text"}">${l}</button>`).join("")}
        <label>Color <input type="color" id="col" value="#e5322d"></label><label>Line <input type="number" id="lw" value="2" min="1" max="20" style="width:58px"></label>
        <label>Text <input type="text" id="txt" value="Text" maxlength="200"></label><label>Size <input type="number" id="fs" value="18" min="6" max="120" style="width:62px"></label>
        <label id="imgl" hidden>Image <input type="file" id="imgf" accept="image/*"></label><label id="iwl" hidden>Width (pt) <input type="number" id="iw" value="150" min="10" max="800" style="width:70px"></label></div>`}
      <div class="tb"><button id="prev" aria-label="Previous page">◀</button><label>Page <input type="number" id="pn" value="1" min="1" max="${pdf.n}" style="width:64px"> of ${pdf.n}</label><button id="next" aria-label="Next page">▶</button>
        <button id="undo">Undo</button><button id="clr">Clear this page</button><button class="btn" id="exp" style="padding:6px 16px">Export PDF</button><button id="again">Choose another file</button></div>
      <div id="status" role="status"></div><div class="stage"><canvas id="pc"></canvas><canvas id="ov"></canvas></div><div id="res"></div>`;
      const pc = $("#pc"), ov = $("#ov");
      const vpOf = async (p) => (S.vps[p] ??= (await pdf.js.getPage(p + 1)).getViewport({ scale: 1 }));

      function drawObj(c, o) {
        c.save(); c.strokeStyle = c.fillStyle = o.c; c.lineWidth = o.lw; c.lineCap = c.lineJoin = "round";
        if (o.t === "rect") c.strokeRect(o.x, o.y, o.w, o.h);
        else if (o.t === "hl") { c.globalAlpha = 0.35; c.fillRect(o.x, o.y, o.w, o.h); }
        else if (o.t === "ell") { c.beginPath(); c.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.abs(o.w / 2), Math.abs(o.h / 2), 0, 0, 7); c.stroke(); }
        else if (o.t === "pen") { c.beginPath(); o.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); }
        else if (o.t === "text") { c.font = `${o.fs}px Helvetica,Arial,sans-serif`; c.fillText(o.s, o.x, o.y); }
        else if (o.t === "img") c.drawImage(o.el, o.x, o.y, o.w, o.h);
        c.restore();
      }
      function redraw() {
        const c = ov.getContext("2d"); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, ov.width, ov.height);
        c.setTransform(dpr * S.scale, 0, 0, dpr * S.scale, 0, 0);
        S.objs.filter((o) => o.p === S.p).forEach((o) => drawObj(c, o)); if (S.cur) drawObj(c, S.cur);
      }
      async function show(p) {
        S.p = p; const tk = ++S.tk;
        if (S.task) { S.task.cancel(); try { await S.task.promise; } catch { /* cancelled */ } }
        const pg = await pdf.js.getPage(p + 1), v1 = pg.getViewport({ scale: 1 });
        if (tk !== S.tk) return;
        S.v1 = v1; S.scale = Math.min(2, Math.max(0.3, Math.min(860, $("#work").clientWidth - 24) / v1.width));
        const vp = pg.getViewport({ scale: S.scale * dpr });
        pc.width = ov.width = Math.ceil(vp.width); pc.height = ov.height = Math.ceil(vp.height);
        pc.style.width = ov.style.width = v1.width * S.scale + "px"; pc.style.height = ov.style.height = v1.height * S.scale + "px";
        S.task = pg.render({ canvasContext: pc.getContext("2d"), viewport: vp, background: "#fff" });
        try { await S.task.promise; } catch { return; }
        $("#pn").value = p + 1; redraw();
      }
      const go = (p) => { if (p >= 0 && p < pdf.n) show(p); };
      $("#prev").onclick = () => go(S.p - 1); $("#next").onclick = () => go(S.p + 1);
      $("#pn").onchange = (e) => go((+e.target.value || 1) - 1);
      $("#undo").onclick = () => { const l = S.objs.at(-1); if (l) S.objs = S.objs.filter((o) => o.g !== l.g); redraw(); };
      $("#clr").onclick = () => { S.objs = S.objs.filter((o) => o.p !== S.p); redraw(); };
      $("#again").onclick = () => editorUI(t, sign);

      if (!sign) {
        $$("[data-tool]").forEach((b) => (b.onclick = () => {
          S.tool = b.dataset.tool; $$("[data-tool]").forEach((x) => x.setAttribute("aria-pressed", x === b));
          $("#imgl").hidden = $("#iwl").hidden = S.tool !== "img"; if (S.tool === "hl") $("#col").value = "#ffeb3b";
        }));
        $("#imgf").onchange = async (e) => { try { S.img = await fileToPng(e.target.files[0]); say("ok", "Image loaded – click on the page to place it."); } catch (er) { say("err", er.message); } };
      } else {
        const pad = $("#pad"), pcx = pad.getContext("2d"); let down = false, ink = null;
        pcx.lineWidth = 2.5; pcx.lineCap = pcx.lineJoin = "round"; pcx.strokeStyle = "#14213d";
        const pp = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
        pad.onpointerdown = (e) => { e.preventDefault(); down = true; pad.setPointerCapture(e.pointerId); const [x, y] = pp(e); pcx.beginPath(); pcx.moveTo(x, y); pcx.lineTo(x + 0.01, y); pcx.stroke(); ink ||= { a: x, b: y, c: x, d: y }; };
        pad.onpointermove = (e) => { if (!down) return; const [x, y] = pp(e); pcx.lineTo(x, y); pcx.stroke(); ink.a = Math.min(ink.a, x); ink.b = Math.min(ink.b, y); ink.c = Math.max(ink.c, x); ink.d = Math.max(ink.d, y); };
        pad.onpointerup = () => { down = false; };
        $("#padclr").onclick = () => { pcx.clearRect(0, 0, pad.width, pad.height); ink = null; };
        $("#padok").onclick = async () => {
          if (!ink) return say("err", "Draw your signature on the pad first.");
          const x = Math.max(0, ink.a - 6), y = Math.max(0, ink.b - 6), w = Math.min(pad.width, ink.c + 6) - x, h = Math.min(pad.height, ink.d + 6) - y, c = document.createElement("canvas");
          c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); c.getContext("2d").drawImage(pad, x, y, w, h, 0, 0, w, h);
          S.sig = await loadImg(c.toDataURL("image/png")); $("#sigprev").innerHTML = `<img src="${S.sig.src}" alt="Your signature" style="height:48px;background:#fff;border:1px solid var(--bd);border-radius:6px"> Click on the page to place it.`;
        };
        $("#sigf").onchange = async (e) => { try { S.sig = await fileToPng(e.target.files[0]); $("#sigprev").innerHTML = `<img src="${S.sig.src}" alt="Your signature" style="height:48px;background:#fff;border:1px solid var(--bd);border-radius:6px"> Click on the page to place it.`; } catch (er) { say("err", er.message); } };
        $("#ap").onchange = (e) => { $("#rng").hidden = e.target.value !== "range"; };
      }

      const pos = (e) => { const r = ov.getBoundingClientRect(); return [(e.clientX - r.left) / S.scale, (e.clientY - r.top) / S.scale]; };
      async function place(x, y) {
        const el = sign ? S.sig : S.img;
        if (!el) return say("err", sign ? "Create or upload a signature first." : "Choose an image first.");
        const w = +$("#iw").value || 140, h = w * el.naturalHeight / el.naturalWidth, g = ++S.g;
        let pages = [S.p];
        if (sign && $("#ap").value === "all") pages = [...Array(pdf.n).keys()];
        else if (sign && $("#ap").value === "range") { try { pages = parseRange($("#rng").value, pdf.n); } catch (er) { return say("err", er.message); } }
        const fx = x / S.v1.width, fy = y / S.v1.height;
        for (const q of new Set(pages)) {
          const v = q === S.p ? S.v1 : await vpOf(q);
          S.objs.push({ t: "img", p: q, g, el, w, h, x: Math.min(Math.max(0, fx * v.width - w / 2), Math.max(0, v.width - w)), y: Math.min(Math.max(0, fy * v.height - h / 2), Math.max(0, v.height - h)) });
        }
        say("ok", `Placed on ${new Set(pages).size} page(s). Use Undo to remove it.`); redraw();
      }
      ov.onpointerdown = (e) => {
        e.preventDefault(); const [x, y] = pos(e), T = S.tool, c = $("#col")?.value || "#000000", lw = +($("#lw")?.value || 2), g = ++S.g;
        if (T === "text") {
          const s = $("#txt").value, fs = +$("#fs").value || 18;
          if (!s.trim()) return say("err", "Type the text first.");
          if (!/^[\x20-\x7E\u00A0-\u00FF]+$/.test(s)) return say("err", "Only Latin characters are supported for added text (built-in PDF font).");
          S.objs.push({ t: "text", p: S.p, g, x, y: y + fs, s, fs, c, lw }); return redraw();
        }
        if (T === "img" || T === "sign") { place(x, y); return; }
        S.cur = { t: T, p: S.p, g, x, y, w: 0, h: 0, pts: [[x, y]], c, lw }; ov.setPointerCapture(e.pointerId);
      };
      ov.onpointermove = (e) => {
        const o = S.cur; if (!o) return; const [x, y] = pos(e);
        if (o.t === "pen") { const l = o.pts.at(-1); if (Math.hypot(x - l[0], y - l[1]) >= 1) o.pts.push([x, y]); } else { o.w = x - o.x; o.h = y - o.y; }
        redraw();
      };
      ov.onpointerup = () => {
        const o = S.cur; if (!o) return; S.cur = null;
        if (o.t === "pen") { if (o.pts.length > 1) S.objs.push(o); }
        else if (Math.abs(o.w) >= 2 && Math.abs(o.h) >= 2) { if (o.w < 0) { o.x += o.w; o.w = -o.w; } if (o.h < 0) { o.y += o.h; o.h = -o.h; } S.objs.push(o); }
        redraw();
      };

      $("#exp").onclick = async () => {
        if (!S.objs.length) return say("err", sign ? "Place a signature on the page first." : "Nothing to export yet – add something to a page first.");
        try {
          const out = await L.PDFDocument.load(pdf.buf), font = await out.embedFont(L.StandardFonts.Helvetica), pages = out.getPages(), cache = new Map();
          for (const o of S.objs) {
            const pg = pages[o.p], vp = await vpOf(o.p), rot = L.degrees(vp.rotation || 0), P = (x, y) => vp.convertToPdfPoint(x, y), col = o.c && rgbOf(o.c);
            if (o.t === "text") { const [x, y] = P(o.x, o.y); pg.drawText(o.s, { x, y, size: o.fs, font, color: col, rotate: rot }); }
            else if (o.t === "pen") for (let i = 1; i < o.pts.length; i++) { const a = P(...o.pts[i - 1]), b = P(...o.pts[i]); pg.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: o.lw, color: col, lineCap: L.LineCapStyle.Round }); }
            else if (o.t === "ell") { const [x, y] = P(o.x + o.w / 2, o.y + o.h / 2); pg.drawEllipse({ x, y, xScale: o.w / 2, yScale: o.h / 2, borderColor: col, borderWidth: o.lw, rotate: rot }); }
            else if (o.t === "img") {
              let im = cache.get(o.el.src);
              if (!im) { const b = Uint8Array.from(atob(o.el.src.split(",")[1]), (ch) => ch.charCodeAt(0)); im = await out.embedPng(b); cache.set(o.el.src, im); }
              const [x, y] = P(o.x, o.y + o.h); pg.drawImage(im, { x, y, width: o.w, height: o.h, rotate: rot });
            } else {
              const [x, y] = P(o.x, o.y + o.h);
              pg.drawRectangle(o.t === "hl" ? { x, y, width: o.w, height: o.h, color: col, opacity: 0.35, borderWidth: 0, rotate: rot } : { x, y, width: o.w, height: o.h, borderColor: col, borderWidth: o.lw, rotate: rot });
            }
          }
          offer(await pdfBlob(out), base(pdf.name) + (sign ? "-signed.pdf" : "-edited.pdf"));
        } catch (e) { say("err", "Failed: " + e.message); }
      };
      await show(0);
    }, note);
  }

  const mk = (o) => ({ how: "pdf-lib + PDF.js + Canvas", opts: [], ...o });
  TOOLS.push(
    mk({ id: "organize", n: "Organize PDF", d: "See page thumbnails; drag to reorder, rotate or remove pages.", cat: "Organize", ic: "⇅", ui: organizeUI }),
    mk({ id: "edit", n: "Edit PDF", d: "Add text, highlights, shapes, drawings and images.", cat: "Edit", ic: "✎", ui: (t) => editorUI(t, false) }),
    mk({ id: "sign", n: "Sign PDF", d: "Draw or upload a signature and place it on pages.", cat: "Edit", ic: "✍", ui: (t) => editorUI(t, true) }),
  );
  ["Sign PDF", "Edit PDF (canvas editor)"].forEach((n) => { const i = SERVER.indexOf(n); if (i > -1) SERVER.splice(i, 1); });
  window.BP = { start, openPdf, say, offer, fileToPng };
  route();
})();
