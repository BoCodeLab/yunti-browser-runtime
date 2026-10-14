// O05 feasibility spike: can the Yunti extension observe downloads without
// taking them over?
//
// The decision for O05 was to leave downloads in the browser's own directory and
// only report them (id, state, filename, bytes). That requires the Browser
// domain's download events to be reachable through chrome.debugger, which is
// attached to a tab rather than to the browser target. This probe answers that
// before any reporting tool is built.
import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import { copyIsolatedExtension } from "../tests/helpers/isolated-extension.js"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const EXTENSION_DIR = join(ROOT, "extension")
// A bridge URL nothing listens on, so this fixture cannot register with the
// user's live bridge while the spike runs.
const DEAD_BRIDGE = "http://127.0.0.1:59999"

const PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>download spike</title></head>
<body><a id="dl" href="/payload.bin" download="payload.bin">download</a></body></html>`

function startFixtureServer() {
  const server = createServer((req, res) => {
    if (req.url === "/payload.bin") {
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="payload.bin"',
      })
      res.end(Buffer.alloc(256 * 1024, 7))
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

const report = { steps: [] }
let context = null
let fixture = null
let userDataDir = null

try {
  userDataDir = await mkdtemp(join(tmpdir(), "yunti-dl-spike-"))
  const isolated = join(userDataDir, "extension")
  await copyIsolatedExtension(EXTENSION_DIR, isolated, DEAD_BRIDGE)

  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${isolated}`, `--load-extension=${isolated}`],
  })
  const worker = await getExtensionWorker(context)
  report.hasDebuggerApi = await worker.evaluate(() => typeof chrome?.debugger?.attach === "function")

  fixture = await startFixtureServer()
  const page = await context.newPage()
  await page.goto(fixture.url, { waitUntil: "load" })
  await new Promise((r) => setTimeout(r, 500))

  const outcome = await worker.evaluate(async ({ pageUrl }) => {
    const out = { events: [], commands: [] }
    const targets = await chrome.debugger.getTargets()
    const target = targets.find((t) => t.type === "page" && String(t.url).startsWith(pageUrl.slice(0, 22)))
      || targets.find((t) => t.type === "page" && String(t.url).startsWith("http"))
    if (!target) return { ...out, fatal: "no http page target" }
    out.targetId = target.id

    const onEvent = (source, method, params) => {
      out.events.push({ method, params: method.includes("download") ? params : undefined })
    }
    chrome.debugger.onEvent.addListener(onEvent)
    try {
      await chrome.debugger.attach({ targetId: target.id }, "1.3")
      out.attached = true
    } catch (error) {
      out.attachError = String(error?.message || error)
      return out
    }

    // Which Browser-domain calls does an extension debuggee accept?
    for (const [method, params] of [
      ["Browser.setDownloadBehavior", { behavior: "default", eventsEnabled: true }],
      ["Page.setDownloadBehavior", { behavior: "default" }],
    ]) {
      try {
        const result = await chrome.debugger.sendCommand({ targetId: target.id }, method, params)
        out.commands.push({ method, ok: true, result })
      } catch (error) {
        out.commands.push({ method, ok: false, error: String(error?.message || error) })
      }
    }

    // Trigger a real download from the page and watch for Browser/Page events.
    await chrome.debugger.sendCommand({ targetId: target.id }, "Runtime.evaluate", {
      expression: "document.getElementById('dl').click(); 'clicked'", returnByValue: true,
    }).catch((error) => out.clickError = String(error?.message || error))
    await new Promise((r) => setTimeout(r, 3000))

    chrome.debugger.onEvent.removeListener(onEvent)
    await chrome.debugger.detach({ targetId: target.id }).catch(() => {})
    return out
  }, { pageUrl: fixture.url })

  report.downloadSpike = outcome
} catch (error) {
  report.fatal = String(error?.stack || error)
} finally {
  if (context) await context.close().catch(() => {})
  if (fixture) await fixture.close().catch(() => {})
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
}

console.log(JSON.stringify(report, null, 2))
