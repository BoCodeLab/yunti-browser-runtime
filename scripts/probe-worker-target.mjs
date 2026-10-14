// O02 feasibility spike: can the Yunti extension attach to a NON-tab CDP target
// (a web worker) through chrome.debugger, and send/detach on it?
//
// The 2026-10 audit recorded a failed service-worker recovery task and asked for
// worker attach/send/detach primitives. Whether chrome.debugger supports a
// {targetId} debuggee at all is the question this answers before any of that is
// built — shipping a tool that can only return an error is worse than not having
// it.
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
<html><head><meta charset="utf-8"><title>worker target spike</title></head>
<body><h1>worker target spike</h1>
<script>
  const blob = new Blob(["self.onmessage = (e) => self.postMessage(e.data * 2)"], { type: "text/javascript" })
  window.__worker = new Worker(URL.createObjectURL(blob))
  window.__worker.postMessage(21)
  window.__workerReady = new Promise((resolve) => { window.__worker.onmessage = (e) => resolve(e.data) })
</script>
</body></html>`

function startFixtureServer() {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(PAGE_HTML)
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
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
  userDataDir = await mkdtemp(join(tmpdir(), "yunti-worker-spike-"))
  const isolated = join(userDataDir, "extension")
  await copyIsolatedExtension(EXTENSION_DIR, isolated, DEAD_BRIDGE)

  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${isolated}`, `--load-extension=${isolated}`],
  })

  const worker = await getExtensionWorker(context)
  report.extensionWorker = worker.url()
  report.hasDebuggerApi = await worker.evaluate(() => typeof chrome?.debugger?.attach === "function")

  fixture = await startFixtureServer()
  const page = await context.newPage()
  await page.goto(fixture.url, { waitUntil: "load" })
  report.fixtureWorkerAnswer = await page.evaluate(() => window.__workerReady)
  // Give the worker target a moment to appear in the target list.
  await new Promise((r) => setTimeout(r, 800))

  const targets = await worker.evaluate(async () => {
    const list = await chrome.debugger.getTargets()
    return list.map((t) => ({ id: t.id, type: t.type, title: t.title, url: t.url, attached: t.attached, tabId: t.tabId ?? null }))
  })
  report.targetTypes = [...new Set(targets.map((t) => t.type))].sort()
  const workerTargets = targets.filter((t) => t.type === "worker")
  report.workerTargets = workerTargets.map((t) => ({
    id: t.id,
    url: t.url,
    title: t.title,
    own: String(t.url).startsWith("chrome-extension://"),
  }))
  report.pageWorkerCount = workerTargets.filter((t) => !String(t.url).startsWith("chrome-extension://")).length

  // Try every worker target: the extension's own service worker and the page's
  // web worker are different debuggees and must be reported separately. A
  // conclusion drawn from attachking to Yunti's own worker would not tell us
  // whether a caller can reach a page's worker.
  for (const target of workerTargets) {
    const kind = String(target.url).startsWith("chrome-extension://") ? "extension-own-worker" : "page-worker"
    const attach = await worker.evaluate(async ({ targetId }) => {
      try {
        await chrome.debugger.attach({ targetId }, "1.3")
        return { ok: true }
      } catch (error) {
        return { ok: false, error: String(error?.message || error) }
      }
    }, { targetId: target.id })
    const entry = { step: `attach:${kind}`, target: target.url, ...attach }

    if (attach.ok) {
      const send = await worker.evaluate(async ({ targetId }) => {
        try {
          const result = await chrome.debugger.sendCommand(
            { targetId },
            "Runtime.evaluate",
            { expression: "typeof self + ':' + (self.location ? self.location.href : 'no-location')", returnByValue: true }
          )
          return { ok: true, value: result?.result?.value }
        } catch (error) {
          return { ok: false, error: String(error?.message || error) }
        }
      }, { targetId: target.id })
      entry.sendCommand = send

      const detach = await worker.evaluate(async ({ targetId }) => {
        try {
          await chrome.debugger.detach({ targetId })
          return { ok: true }
        } catch (error) {
          return { ok: false, error: String(error?.message || error) }
        }
      }, { targetId: target.id })
      entry.detach = detach
    }
    report.steps.push(entry)
  }

  // Control: the same three calls against a normal page target must succeed,
  // otherwise a failure above would only prove the spike harness is broken.
  const pageTarget = targets.find((t) => t.type === "page" && t.url.startsWith("http"))
  if (pageTarget) {
    const control = await worker.evaluate(async ({ targetId }) => {
      try {
        await chrome.debugger.attach({ targetId }, "1.3")
        const result = await chrome.debugger.sendCommand({ targetId }, "Runtime.evaluate", { expression: "2 + 2", returnByValue: true })
        await chrome.debugger.detach({ targetId })
        return { ok: true, result }
      } catch (error) {
        return { ok: false, error: String(error?.message || error) }
      }
    }, { targetId: pageTarget.id })
    report.steps.push({ step: "control-page-target", ...control })

    // A dedicated page worker is not listed until the debugger auto-attaches to
    // the page's child targets. Do that through the page debuggee and see
    // whether the worker becomes reachable — if it does not, worker access
    // cannot be offered as a tool no matter how the extension is written.
    const autoAttach = await worker.evaluate(async ({ targetId }) => {
      const out = { targetId }
      try {
        await chrome.debugger.attach({ targetId }, "1.3")
        out.attached = true
      } catch (error) {
        out.attachError = String(error?.message || error)
        return out
      }
      try {
        await chrome.debugger.sendCommand({ targetId }, "Target.setAutoAttach", {
          autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
        })
        out.autoAttachOk = true
      } catch (error) {
        out.autoAttachError = String(error?.message || error)
      }
      await new Promise((r) => setTimeout(r, 1200))
      try {
        const listed = await chrome.debugger.getTargets()
        out.workersAfter = listed.filter((t) => t.type === "worker").map((t) => t.url)
      } catch (error) {
        out.listError = String(error?.message || error)
      }
      try {
        const all = await chrome.debugger.sendCommand({ targetId }, "Target.getTargets", {})
        out.childTargets = (all?.targetInfos || []).map((t) => ({ type: t.type, url: t.url }))
      } catch (error) {
        out.childListError = String(error?.message || error)
      }
      await chrome.debugger.detach({ targetId }).catch(() => {})
      return out
    }, { targetId: pageTarget.id })
    report.steps.push({ step: "auto-attach-page-children", ...autoAttach })
  }
} catch (error) {
  report.fatal = String(error?.stack || error)
} finally {
  if (context) await context.close().catch(() => {})
  if (fixture) await fixture.close().catch(() => {})
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
}

console.log(JSON.stringify(report, null, 2))
