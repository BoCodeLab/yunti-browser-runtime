// O02 follow-up: the first spike only tested a dedicated Web Worker created from
// a blob URL. The audit's original failure was a *service-worker* recovery task,
// and the audit itself noted that its own evidence had "not exhausted all
// underlying CDP workarounds". This probe widens the question to every non-tab
// target flavour a normal page can produce, and reports for each one:
//
//   - is it listed by chrome.debugger.getTargets()
//   - does it appear after Target.setDiscoverTargets / Target.setAutoAttach
//   - can chrome.debugger.attach({targetId}) reach it
//
// A "no" only counts when the control (attaching to the page) succeeded in the
// same run, so a broken harness cannot be mistaken for a Chrome limitation.
import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import { copyIsolatedExtension } from "../tests/helpers/isolated-extension.js"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const EXTENSION_DIR = join(ROOT, "extension")
const DEAD_BRIDGE = "http://127.0.0.1:59999"

const DEDICATED_WORKER_JS = "self.onmessage = (e) => self.postMessage(e.data * 2)"
const SHARED_WORKER_JS = "self.onconnect = (e) => e.ports[0].postMessage('shared-ready')"
const PAGE_SW_JS = `
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('message', (e) => { if (e.source) e.source.postMessage('sw-ready') })
`

const PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>non-tab target probe</title></head>
<body><h1>non-tab target probe</h1>
<script>
  // 1. dedicated worker (blob URL)
  const blob = new Blob([${JSON.stringify(DEDICATED_WORKER_JS)}], { type: "text/javascript" })
  window.__dedicated = new Worker(URL.createObjectURL(blob))
  window.__dedicated.postMessage(21)

  // 2. shared worker
  try {
    window.__shared = new SharedWorker("/shared-worker.js")
    window.__sharedReady = new Promise((resolve) => {
      window.__shared.port.onmessage = (e) => resolve(e.data)
      window.__shared.port.start()
    })
  } catch (error) { window.__sharedError = String(error) }

  // 3. page-registered service worker
  window.__swReady = navigator.serviceWorker
    ? navigator.serviceWorker.register("/page-sw.js")
        .then((registration) => navigator.serviceWorker.ready.then(() => registration.active?.state || "ready"))
        .catch((error) => "sw-error: " + String(error))
    : Promise.resolve("no-serviceworker-api")
</script>
</body></html>`

function startFixtureServer() {
  const server = createServer((req, res) => {
    const path = String(req.url || "").split("?")[0]
    if (path === "/shared-worker.js") {
      res.writeHead(200, { "content-type": "text/javascript" })
      res.end(SHARED_WORKER_JS)
      return
    }
    if (path === "/page-sw.js") {
      res.writeHead(200, { "content-type": "text/javascript", "service-worker-allowed": "/" })
      res.end(PAGE_SW_JS)
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(PAGE_HTML)
  })
  return new Promise((resolve_) => {
    server.listen(0, "127.0.0.1", () => resolve_({
      url: `http://127.0.0.1:${server.address().port}/`,
      close: () => new Promise((r) => server.close(r)),
    }))
  })
}

async function getExtensionWorker(context) {
  const existing = context.serviceWorkers()[0]
  if (existing) return existing
  return context.waitForEvent("serviceworker", { timeout: 10_000 })
}

const report = { flavours: {} }
let context = null
let fixture = null
let userDataDir = null

try {
  userDataDir = await mkdtemp(join(tmpdir(), "yunti-nontab-probe-"))
  const isolated = join(userDataDir, "extension")
  await copyIsolatedExtension(EXTENSION_DIR, isolated, DEAD_BRIDGE)

  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${isolated}`, `--load-extension=${isolated}`],
  })
  const worker = await getExtensionWorker(context)

  fixture = await startFixtureServer()
  const page = await context.newPage()
  await page.goto(fixture.url, { waitUntil: "load" })
  await page.evaluate(() => window.__swReady).catch(() => null)
  await page.evaluate(() => window.__sharedReady).catch(() => null)
  // Let every worker flavour actually start before asking for targets.
  await new Promise((r) => setTimeout(r, 2500))

  report.pageState = await page.evaluate(() => ({
    sw: "controlled" in navigator ? Boolean(navigator.serviceWorker?.controller) : null,
    swState: document.readyState,
  })).catch(() => null)

  report.result = await worker.evaluate(async ({ pageOrigin }) => {
    const out = { beforeAttach: [], afterAttach: [], notifications: [], attempts: [] }
    const snapshot = async () => {
      const list = await chrome.debugger.getTargets()
      return list.map((t) => ({ id: t.id, type: t.type, url: t.url, attached: t.attached, tabId: t.tabId ?? null }))
    }
    const describe = (list) => list
      .filter((t) => !String(t.url).startsWith("chrome-extension://"))
      .map((t) => ({ type: t.type, url: String(t.url).slice(0, 80) }))

    out.beforeAttach = describe(await snapshot())
    const all = await snapshot()
    const pageTarget = all.find((t) => t.type === "page" && String(t.url).startsWith(pageOrigin))
    if (!pageTarget) return { ...out, fatal: "no http page target found" }
    out.pageTargetId = pageTarget.id

    const onEvent = (source, method, params) => {
      if (String(method).startsWith("Target.")) {
        out.notifications.push({ method, targetType: params?.targetInfo?.type, url: String(params?.targetInfo?.url || "").slice(0, 80) })
      }
    }
    chrome.debugger.onEvent.addListener(onEvent)

    try {
      await chrome.debugger.attach({ targetId: pageTarget.id }, "1.3")
      out.pageAttached = true
    } catch (error) {
      return { ...out, pageAttachError: String(error?.message || error) }
    }

    for (const [method, params] of [
      ["Target.setDiscoverTargets", { discover: true }],
      ["Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }],
    ]) {
      try {
        await chrome.debugger.sendCommand({ targetId: pageTarget.id }, method, params)
        out.attempts.push({ method, ok: true })
      } catch (error) {
        out.attempts.push({ method, ok: false, error: String(error?.message || error) })
      }
    }
    await new Promise((r) => setTimeout(r, 2000))
    out.afterAttach = describe(await snapshot())

    // Now try to reach every non-page, non-extension target we can see.
    const candidates = (await snapshot()).filter(
      (t) => t.type !== "page" && !String(t.url).startsWith("chrome-extension://")
    )
    out.candidateCount = candidates.length
    for (const target of candidates) {
      try {
        await chrome.debugger.attach({ targetId: target.id }, "1.3")
        const result = await chrome.debugger.sendCommand({ targetId: target.id }, "Runtime.evaluate", {
          expression: "typeof self", returnByValue: true,
        })
        out.attempts.push({ target: { type: target.type, url: String(target.url).slice(0, 80) }, attach: true, evaluate: result?.result?.value })
        await chrome.debugger.detach({ targetId: target.id }).catch(() => {})
      } catch (error) {
        out.attempts.push({ target: { type: target.type, url: String(target.url).slice(0, 80) }, attach: false, error: String(error?.message || error) })
      }
    }

    chrome.debugger.onEvent.removeListener(onEvent)
    await chrome.debugger.detach({ targetId: pageTarget.id }).catch(() => {})
    return out
  }, { pageOrigin: fixture.url.slice(0, fixture.url.lastIndexOf("/")) })
} catch (error) {
  report.fatal = String(error?.stack || error)
} finally {
  if (context) await context.close().catch(() => {})
  if (fixture) await fixture.close().catch(() => {})
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
}

console.log(JSON.stringify(report, null, 2))
