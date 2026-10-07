#!/usr/bin/env node
// Diagnose the real Page.javascriptDialogOpening path:
//   fixture page with an alert button + isolated browser + extension + ephemeral
//   bridge; click the button, then read the bridge's cdp-events buffer.
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..")
const EXTENSION_DIR = join(ROOT, "extension")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...p) => console.error("[dialog-probe]", ...p)

async function main() {
  let playwright
  for (const pkg of ["playwright-core", "playwright"]) {
    try {
      playwright = (await import(pkg)).default ?? (await import(pkg))
      break
    } catch {}
  }
  const bundled = playwright?.chromium?.executablePath?.()
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  const executablePath = bundled && existsSync(bundled) ? bundled : existsSync(edge) ? edge : null
  if (!executablePath) throw new Error("no browser")
  log(`browser: ${executablePath}`)

  const { startBridgeServer } = await import("../../mcp/http-server.js")
  const bridge = await startBridgeServer({ host: "127.0.0.1", port: 0, sessionTtlMs: 120_000 })
  const bridgePort = bridge.server.address().port
  const bridgeBase = `http://127.0.0.1:${bridgePort}`
  log(`bridge: ${bridgeBase}`)

  const html = `<!doctype html><html><body>
    <button id="alert">alert</button><p id="state">idle</p>
    <script>document.getElementById('alert').addEventListener('click',()=>{window.alert('probe alert');document.getElementById('state').textContent='after';});</script>
    </body></html>`
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(html)
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const pageUrl = `http://127.0.0.1:${server.address().port}/dialog.html`

  const profileDir = await mkdtemp(join(tmpdir(), "yunti-dialog-probe-"))
  const context = await playwright.chromium.launchPersistentContext(profileDir, {
    executablePath,
    headless: false,
    viewport: { width: 1000, height: 700 },
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`, "--no-first-run"],
  })
  try {
    let worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker", { timeout: 20_000 }))
    await worker.evaluate(async ({ bridgeUrl }) => {
      await chrome.storage.local.set({ bridgeUrl, bridgeToken: "", platformMatches: ["*"], localUserId: "local" })
    }, { bridgeUrl: bridgeBase })
    // Let the extension's fast bridge-recovery timers re-register against the
    // ephemeral bridge (the settings snapshot is re-read on every recovery).
    await sleep(3_500)

    const page = await context.newPage()
    await page.goto(pageUrl)
    await page.bringToFront()

    const deadline = Date.now() + 25_000
    let session = null
    while (Date.now() < deadline) {
      const health = await fetch(`${bridgeBase}/health?userId=local`).then((r) => r.json()).catch(() => null)
      session = (health?.sessions || []).find((s) => s.kind !== "browser_controller")
      if (session) break
      await sleep(400)
    }
    log(`page session: ${session?.browserSessionId} url=${session?.url}`)
    if (!session) throw new Error("no page session")

    const call = (tool, args = {}, timeoutMs = 20_000) =>
      bridge.hub.callTool(tool, { ...args, browserSessionId: session.browserSessionId, userId: "local" }, timeoutMs)

    // Attach the debugger the way an agent workflow does.
    await call("yunti_take_screenshot", { format: "png" })
    await sleep(400)

    // Watch the bridge's cdp-event buffer across the click.
    const clickStartedAt = Date.now()
    let clickResult = null
    let clickError = null
    try {
      clickResult = await call("yunti_click", { selector: "#alert" }, 20_000)
    } catch (error) {
      clickError = error.message
    }
    const clickMs = Date.now() - clickStartedAt
    log(`click: ${clickMs}ms error=${clickError || "none"}`)
    log(`click dialogOpened=${clickResult?.dialogOpened} dialog=${JSON.stringify(clickResult?.dialog)} recovery=${JSON.stringify(clickResult?.recoveryHint)}`)

    const events = bridge.hub
      .listCdpEvents({ browserSessionId: session.browserSessionId, userId: "local", limit: 200 })
      .events.map((e) => e.method)
    const dialogEvents = events.filter((m) => /dialog/i.test(m))
    log(`cdp events seen (last ${events.length}): dialog-related=${JSON.stringify(dialogEvents)}`)
    const counts = {}
    for (const method of events) counts[method] = (counts[method] || 0) + 1
    log(`event histogram: ${JSON.stringify(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8))}`)

    // Now try the raw route: open a dialog through CDP Runtime.evaluate and see
    // whether the opening event is forwarded while the renderer is blocked.
    const state = await call("yunti_evaluate_script", { expression: "document.getElementById('state').textContent" }).catch((error) => ({ error: error.message }))
    log(`page state after click: ${JSON.stringify(state).slice(0, 160)}`)

    await call("yunti_cdp_send_command", { method: "Target.closeTarget", params: { targetId: String(session.tabId) }, tabId: session.tabId }).catch(() => {})
  } finally {
    await context.close().catch(() => {})
    await rm(profileDir, { recursive: true, force: true }).catch(() => {})
    server.close()
    bridge.server?.close?.()
  }
}

main().catch((error) => {
  console.error(`[dialog-probe] fatal: ${error.stack || error.message}`)
  process.exitCode = 1
})
