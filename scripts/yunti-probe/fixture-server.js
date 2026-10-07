#!/usr/bin/env node
// Independent fixture HTTP server for yunti runtime probing.
// Serves deterministic pages + a tiny JSON API used for permission-free
// read-only fetch probing. Started as a background process by probe.js.
import http from "node:http"
import { readFile, stat } from "node:fs/promises"
import { dirname, extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..")
const BENCH_FIXTURES = join(ROOT, "tests", "fixtures", "benchmark")
const SOAK_FIXTURES = join(ROOT, "scripts", "soak", "fixtures")
const PORT = Number(process.env.YUNTI_PROBE_FIXTURE_PORT || 49771)

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
}

function page(title, body, script = "") {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>
 body{font-family:system-ui,sans-serif;margin:24px;line-height:1.5}
 .box{border:1px solid #ccc;padding:12px;margin:8px 0;border-radius:6px}
 .scroll{height:220px;overflow:auto;border:1px solid #999;padding:8px}
 .row{height:40px;border-bottom:1px dashed #ddd}
</style></head>
<body>
<h1 id="probe-title">${title}</h1>
${body}
${script ? `<script>${script}</script>` : ""}
</body></html>`
}

const PAGES = {
  "/": page(
    "Yunti Probe Home",
    `<div class="box" id="card">
       <p id="hello">probe ready</p>
       <button id="btn" type="button">probe button</button>
       <p id="clicks">clicks: 0</p>
     </div>
     <div class="box">
       <a id="link" href="/controls.html">to controls</a>
     </div>`,
    `let n=0;document.getElementById('btn').addEventListener('click',()=>{n++;document.getElementById('clicks').textContent='clicks: '+n;});`
  ),
  "/controls.html": page(
    "Yunti Probe Controls",
    `<form id="form" class="box">
       <label for="name">Name</label>
       <input id="name" name="name" type="text" placeholder="your name">
       <label for="note">Note</label>
       <textarea id="note" name="note" placeholder="notes"></textarea>
       <label for="pick">Pick</label>
       <select id="pick" name="pick">
         <option value="">--</option>
         <option value="alpha">Alpha</option>
         <option value="beta">Beta</option>
         <option value="gamma" disabled>Gamma</option>
       </select>
       <label for="locked">Locked</label>
       <input id="locked" name="locked" type="text" value="cannot edit" readonly>
       <button id="submit" type="submit">Submit</button>
       <input id="file" name="file" type="file">
     </form>
     <div class="box" contenteditable="true" id="editor">editable box</div>
     <div class="box" id="hoverzone" style="width:200px">hover here</div>
     <p id="state">idle</p>`,
    `document.getElementById('form').addEventListener('submit',(e)=>{e.preventDefault();document.getElementById('state').textContent='submitted';});
     document.getElementById('hoverzone').addEventListener('mouseenter',()=>{document.getElementById('state').textContent='hovered';});
     document.addEventListener('keydown',(e)=>{document.getElementById('state').textContent='key:'+e.key;});`
  ),
  "/scroll.html": page(
    "Yunti Probe Scroll",
    `<div class="scroll" id="scroller">${Array.from({ length: 40 }, (_, i) => `<div class="row">scroll row ${i}</div>`).join("")}</div>
     <div style="height:1200px">tall spacer</div>
     <p id="bottom">bottom marker</p>`
  ),
  "/async.html": page(
    "Yunti Probe Async",
    `<div class="box"><button id="go" type="button">load async</button><p id="async-state">waiting</p></div>
     <div id="late"></div>`,
    `document.getElementById('go').addEventListener('click',()=>{
       document.getElementById('async-state').textContent='loading';
       setTimeout(()=>{document.getElementById('async-state').textContent='ready';
         const d=document.createElement('div');d.id='late';d.textContent='async payload arrived';document.body.appendChild(d);},1200);
     });`
  ),
  "/shadow.html": page(
    "Yunti Probe Shadow",
    `<div class="box" id="host"></div>`,
    `const root=document.getElementById('host').attachShadow({mode:'open'});
     root.innerHTML='<button id="shadow-btn" type="button">shadow button</button><p id="shadow-state">shadow idle</p>';
     root.getElementById('shadow-btn').addEventListener('click',()=>{root.getElementById('shadow-state').textContent='shadow clicked';});`
  ),
  "/dialog.html": page(
    "Yunti Probe Dialog",
    `<div class="box"><button id="alert" type="button">alert</button>
      <button id="confirm" type="button">confirm</button>
      <button id="prompt" type="button">prompt</button></div>
     <p id="dialog-result">none</p>`,
    `document.getElementById('alert').addEventListener('click',()=>{alert('probe alert');});
     document.getElementById('confirm').addEventListener('click',()=>{document.getElementById('dialog-result').textContent='confirm:'+confirm('probe confirm');});
     document.getElementById('prompt').addEventListener('click',()=>{document.getElementById('dialog-result').textContent='prompt:'+prompt('probe prompt','seed');});`
  ),
  "/resize.html": page("Yunti Probe Resize", `<div class="box" id="viewport"></div>`, `
     const render=()=>{document.getElementById('viewport').textContent=window.innerWidth+'x'+window.innerHeight;};
     window.addEventListener('resize',render);render();`),
  "/upload.html": page(
    "Yunti Probe Upload",
    `<div class="box">
       <input id="upload" type="file">
       <output id="upload-result">no file</output>
     </div>`,
    `document.getElementById('upload').addEventListener('change',(e)=>{
       document.getElementById('upload-result').textContent='file:'+(e.target.files[0]?.name||'none');
     });`
  ),
  "/console.html": page(
    "Yunti Probe Console",
    `<div class="box"><button id="log" type="button">emit console + fetch</button></div>`,
    `document.getElementById('log').addEventListener('click',()=>{
       console.log('probe console log line');
       console.warn('probe console warn line');
       fetch('/api/ping?from=page').catch(()=>{});
     });
     console.log('probe console on load');`
  ),
}

async function readStatic(urlPath) {
  const candidates = [
    join(BENCH_FIXTURES, urlPath.replace(/^\//, "")),
    join(SOAK_FIXTURES, urlPath.replace(/^\//, "")),
  ]
  for (const candidate of candidates) {
    const normalized = normalize(candidate)
    if (!normalized.startsWith(BENCH_FIXTURES) && !normalized.startsWith(SOAK_FIXTURES)) continue
    try {
      const info = await stat(normalized)
      if (info.isFile()) return { body: await readFile(normalized), type: CONTENT_TYPES[extname(normalized)] || "application/octet-stream" }
    } catch {
      // try next candidate
    }
  }
  return null
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`)
  const pathname = url.pathname

  if (pathname === "/api/ping") {
    const delayMs = Math.max(0, Math.min(5000, Number(url.searchParams.get("delayMs") || 0)))
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
    res.end(JSON.stringify({ ok: true, from: url.searchParams.get("from") || "probe", ts: Date.now() }))
    return
  }

  if (pathname === "/api/echo") {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
    res.end(JSON.stringify({ ok: true, method: req.method, bytes: Buffer.concat(chunks).length }))
    return
  }

  const html = PAGES[pathname]
  if (html) {
    res.writeHead(200, { "content-type": CONTENT_TYPES[".html"], "cache-control": "no-store" })
    res.end(html)
    return
  }

  const staticFile = await readStatic(pathname)
  if (staticFile) {
    res.writeHead(200, { "content-type": staticFile.type })
    res.end(staticFile.body)
    return
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
  res.end("not found")
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({ ok: true, fixtureUrl: `http://127.0.0.1:${PORT}/`, port: PORT }))
})
