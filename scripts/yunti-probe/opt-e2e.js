#!/usr/bin/env node
// End-to-end optimization verification.
//
// Launches an isolated Chromium/Edge profile with the repo's unpacked extension,
// points it at an ephemeral bridge, and drives the real tool chain (bridge hub ->
// extension controller -> content script/CDP) against local fixtures.
//
// The user's own browser is never touched.
//
// Usage:
//   node scripts/yunti-probe/opt-e2e.js
//   node scripts/yunti-probe/opt-e2e.js --headless
//   YUNTI_OPT_EXECUTABLE=<path to msedge.exe|chrome.exe> node scripts/yunti-probe/opt-e2e.js
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..")
const EXTENSION_DIR = join(ROOT, "extension")

const args = { headless: false, keepOpen: false }
for (const raw of process.argv.slice(2)) {
  const [key] = raw.replace(/^--/, "").split("=")
  if (key === "headless") args.headless = true
  if (key === "keep-open") args.keepOpen = true
}

const log = (...parts) => console.error("[opt-e2e]", ...parts)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []

function check(name, passed, detail = "") {
  results.push({ name, passed, detail })
  log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}

async function loadPlaywright() {
  for (const pkg of ["playwright-core", "playwright"]) {
    try {
      const mod = await import(pkg)
      return mod.default ?? mod
    } catch {
      // try next
    }
  }
  throw new Error(
    "需要 playwright-core：请在仓库根目录执行 npm install（package.json 已声明 playwright-core 依赖）"
  )
}

function findBrowserExecutable(playwright) {
  const explicit = process.env.YUNTI_OPT_EXECUTABLE || process.env.YUNTI_E2E_EXECUTABLE_PATH
  if (explicit && existsSync(explicit)) return explicit
  // Prefer Playwright's Chromium for Testing: branded Chrome/Edge builds ignore
  // --load-extension (and could clash with the user's running browser).
  try {
    const bundled = playwright?.chromium?.executablePath?.()
    if (bundled && existsSync(bundled)) return bundled
  } catch {
    // fall through to system browsers
  }
  const candidates = [
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean)
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  return null
}

async function startFixtureServer() {
  const page = (title, body, script = "") =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}${script ? `<script>${script}</script>` : ""}</body></html>`
  const routes = {
    "/": page("Opt E2E", "<h1 id=title>opt e2e</h1>"),
    "/dialog.html": page(
      "Opt Dialog",
      `<button id="alert">alert</button><button id="confirm">confirm</button><p id="state">idle</p>`,
      `document.getElementById('alert').addEventListener('click',()=>{window.alert('opt e2e alert');document.getElementById('state').textContent='after-alert';});
       document.getElementById('confirm').addEventListener('click',()=>{const r=window.confirm('opt e2e confirm');document.getElementById('state').textContent='confirm:'+r;});`
    ),
    "/plain.html": page("Opt Plain", `<p id="ready">plain ready</p><div id="box">box</div>`),
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1")
    const body = routes[url.pathname] || routes["/"]
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
    res.end(body)
  })
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen))
  const port = server.address().port
  return { server, url: `http://127.0.0.1:${port}/` }
}

async function main() {
  const playwright = await loadPlaywright()
  const executablePath = findBrowserExecutable(playwright)
  if (!executablePath) {
    throw new Error(
      "未找到可用的 Chromium/Edge。请设置 YUNTI_OPT_EXECUTABLE=<msedge.exe 或 chrome.exe 路径>，或运行 npx playwright-core install chromium"
    )
  }
  log(`browser: ${executablePath}`)

  const { startBridgeServer } = await import("../../mcp/http-server.js")
  const bridge = await startBridgeServer({ host: "127.0.0.1", port: 0, sessionTtlMs: 120_000 })
  // startBridgeServer reports the *configured* port; the bound port lives on the
  // server handle when port 0 was requested.
  const bridgePort = bridge.server?.address?.()?.port ?? bridge.port
  const bridgeBase = `http://127.0.0.1:${bridgePort}`
  log(`bridge: ${bridge.mode} on ${bridgeBase}`)

  const fixture = await startFixtureServer()
  log(`fixture: ${fixture.url}`)

  const profileDir = await mkdtemp(join(tmpdir(), "yunti-opt-e2e-"))
  const context = await playwright.chromium.launchPersistentContext(profileDir, {
    executablePath,
    headless: args.headless,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  })

  try {
    // Point the extension at the ephemeral bridge (same wiring as the soak/e2e suite).
    let [worker] = context.serviceWorkers()
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 20_000 })
    await worker.evaluate(
      async ({ bridgeUrl }) => {
        await chrome.storage.local.set({
          bridgeUrl,
          bridgeToken: "",
          platformMatches: ["*"],
          localUserId: "local",
          localUserName: "local",
        })
      },
      { bridgeUrl: bridgeBase }
    )
    // The extension's settings snapshot is cached in service-worker module state
    // for a couple of seconds; the background script re-registers on its fast
    // recovery timers, which re-read settings, so give it a moment before the
    // session wait below starts counting.
    await sleep(3_500)

    const page = await context.newPage()
    await page.goto(`${fixture.url}plain.html`)
    await page.bringToFront()

    context.on("serviceworker", (sw) => {
      log(`service worker attached: ${sw.url()}`)
      sw.on("console", (message) => log(`sw console ${message.type()}: ${message.text()}`))
    })
    worker.on("console", (message) => log(`sw console ${message.type()}: ${message.text()}`))

    // Wait for the controller + page session to register.
    const deadline = Date.now() + 25_000
    let pageSession = null
    let lastHealth = null
    while (Date.now() < deadline) {
      lastHealth = await fetch(`${bridgeBase}/health?userId=local`).then((r) => r.json()).catch(() => null)
      pageSession = (lastHealth?.sessions || []).find((s) => s.kind !== "browser_controller") || null
      if (pageSession) break
      await sleep(500)
    }
    log(
      `bridge after wait: mode=${bridge.mode} sessions=${lastHealth?.sessionCount ?? "?"} controllers=${lastHealth?.controllerCount ?? "?"} pages=${lastHealth?.pageSessionCount ?? "?"}`
    )
    log(`bridge sessions: ${JSON.stringify((lastHealth?.sessions || []).map((s) => ({ kind: s.kind, url: s.url, tabId: s.tabId, userId: s.userId }))).slice(0, 400)}`)
    if (!pageSession) {
      const workerStorage = await worker
        .evaluate(async () => {
          const stored = await chrome.storage.local.get(["bridgeUrl", "bridgeToken", "platformMatches", "localUserId"])
          return { stored, tabs: (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url })) }
        })
        .catch((error) => ({ error: error.message }))
      log(`diagnostics: ${JSON.stringify(workerStorage).slice(0, 600)}`)
    }
    check("extension controller + page session register against the ephemeral bridge", Boolean(pageSession))
    if (!pageSession) throw new Error("page session registration timed out")

    const sessionId = pageSession.browserSessionId
    const call = (tool, toolArgs = {}, timeoutMs = 30_000) =>
      bridge.hub.callTool(tool, { ...toolArgs, browserSessionId: sessionId, userId: "local" }, timeoutMs)

    // Warm the CDP attachment so Page.javascriptDialogOpening is subscribed
    // before the modal opens (this is what a real agent workflow does).
    await call("yunti_take_screenshot", { format: "png" }, 20_000)

    // ---- 1. native dialog must not deadlock the tab ---------------------
    await page.goto(`${fixture.url}dialog.html`)
    await page.waitForSelector("#alert")
    await sleep(400)
    const dialogSession = pageSession.browserSessionId

    const clickStartedAt = Date.now()
    let clickResult = null
    let clickError = null
    try {
      clickResult = await bridge.hub.callTool(
        "yunti_click",
        { browserSessionId: dialogSession, userId: "local", selector: "#alert" },
        20_000
      )
    } catch (error) {
      clickError = error.message
    }
    const clickMs = Date.now() - clickStartedAt
    check(
      "yunti_click returns promptly while a native alert is open",
      !clickError && clickMs < 6_000,
      `elapsed=${clickMs}ms error=${clickError || "none"}`
    )
    log(`click payload dialogOpened=${clickResult?.dialogOpened} dialog=${JSON.stringify(clickResult?.dialog)} recovery=${JSON.stringify(clickResult?.recoveryHint)}`)
    check(
      "click result reports the opened dialog instead of a bare timeout",
      clickResult?.dialogOpened === true &&
        ["observe-again", "handle-then-observe"].includes(clickResult?.recoveryHint?.nextAction),
      `dialogOpened=${clickResult?.dialogOpened} nextAction=${clickResult?.recoveryHint?.nextAction} autoDismissed=${clickResult?.dialog?.autoDismissed}`
    )

    // ---- 2. a modal that stays open is handleable and the tab recovers ----
    // Edge auto-dismisses alert() in a background tab, so use confirm(): it also
    // freezes the renderer until someone answers it.
    const confirmStartedAt = Date.now()
    let confirmClick = null
    let confirmError = null
    try {
      confirmClick = await bridge.hub.callTool(
        "yunti_click",
        { browserSessionId: dialogSession, userId: "local", selector: "#confirm" },
        20_000
      )
    } catch (error) {
      confirmError = error.message
    }
    const confirmMs = Date.now() - confirmStartedAt
    log(`confirm click: ${confirmMs}ms error=${confirmError || "none"} dialogOpened=${confirmClick?.dialogOpened} autoDismissed=${confirmClick?.dialog?.autoDismissed}`)

    const handleStartedAt = Date.now()
    let handleResult = null
    let handleError = null
    try {
      handleResult = await bridge.hub.callTool(
        "yunti_handle_dialog",
        { browserSessionId: dialogSession, userId: "local", action: "accept" },
        15_000
      )
    } catch (error) {
      handleError = error.message
    }
    const handleMs = Date.now() - handleStartedAt
    check(
      "yunti_handle_dialog closes a modal that is still open",
      !handleError && handleResult?.handled === true,
      `elapsed=${handleMs}ms error=${handleError || "none"} result=${JSON.stringify(handleResult ?? {}).slice(0, 160)}`
    )

    // After handling, the same call must be a clean no-op rather than an error.
    let afterHandle = null
    try {
      afterHandle = await bridge.hub.callTool(
        "yunti_handle_dialog",
        { browserSessionId: dialogSession, userId: "local", action: "accept" },
        15_000
      )
    } catch (error) {
      afterHandle = { error: error.message }
    }
    check(
      "a second handle_dialog call is a NO_DIALOG no-op",
      afterHandle?.handled === false && afterHandle?.code === "NO_DIALOG",
      JSON.stringify(afterHandle).slice(0, 160)
    )

    const recoverStartedAt = Date.now()
    let recovered = null
    try {
      recovered = await call("yunti_get_page_snapshot", {}, 15_000)
    } catch (error) {
      recovered = { error: error.message }
    }
    const recoverMs = Date.now() - recoverStartedAt
    check(
      "page tools answer again right after the dialog is dismissed",
      Boolean(recovered?.url) && recoverMs < 6_000,
      `elapsed=${recoverMs}ms url=${recovered?.url || recovered?.error || "none"}`
    )

    // ---- 3. no dialog: handle_dialog is a structured no-op --------------
    let noDialog = null
    try {
      noDialog = await call("yunti_handle_dialog", { action: "dismiss" }, 15_000)
    } catch (error) {
      noDialog = { error: error.message }
    }
    check(
      "yunti_handle_dialog reports NO_DIALOG instead of failing the call",
      noDialog?.handled === false && noDialog?.code === "NO_DIALOG",
      JSON.stringify(noDialog).slice(0, 200)
    )

    // ---- 4. capture diagnostics expose the filter ------------------------
    let consoleList = null
    try {
      consoleList = await call("yunti_list_console_messages", { limit: 10 }, 15_000)
    } catch (error) {
      consoleList = { error: error.message }
    }
    check(
      "console diagnostics carry captureFilters metadata",
      Boolean(consoleList?.captureFilters && Array.isArray(consoleList.captureFilters.platformMatches)),
      JSON.stringify(consoleList?.captureFilters ?? consoleList).slice(0, 200)
    )

    // ---- 5. screenshot payload self-describes its size ------------------
    let shot = null
    try {
      shot = await call("yunti_take_screenshot", { format: "png" }, 25_000)
    } catch (error) {
      shot = { error: error.message }
    }
    const shotBytes = Number(shot?.imageBytes ?? 0)
    check(
      "screenshot reports imageBytes and captureEmpty",
      typeof shot?.captureEmpty === "boolean" && shotBytes > 0,
      `bytes=${shotBytes} captureEmpty=${shot?.captureEmpty}`
    )
  } finally {
    if (!args.keepOpen) {
      await context.close().catch(() => {})
      await rm(profileDir, { recursive: true, force: true }).catch(() => {})
      fixture.server.close()
      await bridge.close?.().catch?.(() => {})
    }
  }

  const failed = results.filter((r) => !r.passed)
  console.log(JSON.stringify({ checks: results, failed: failed.length, passed: results.length - failed.length }, null, 2))
  if (failed.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(`[opt-e2e] fatal: ${error.stack || error.message}`)
  process.exitCode = 1
})
