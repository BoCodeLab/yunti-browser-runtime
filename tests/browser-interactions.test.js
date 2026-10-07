import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { handleJsonRpc, startBridgeServer } from "../mcp/server.js"

// Interaction-level browser tests. The unit suites exercise the dispatcher with
// a fake chrome API, and the e2e smoke test proves the whole chain once; this
// file sits in between: it drives real click / fill / select / scroll / dialog
// paths in a real browser and asserts on the resulting page state, so a
// regression in actionability, uid scoping or dialog handling fails here
// instead of silently shipping.
const runE2e = process.env.YUNTI_E2E === "1"
const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)))
const extensionDir = join(rootDir, "extension")

const FIXTURE_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Yunti Interaction Fixture</title></head>
  <body>
    <h1>Yunti Interaction Fixture</h1>
    <label>Name <input id="name" /></label>
    <label>Notes <textarea id="notes"></textarea></label>
    <label>Color
      <select id="color">
        <option value="red">red</option>
        <option value="blue">blue</option>
      </select>
    </label>
    <button id="go">Click me</button>
    <output id="result"></output>
    <button id="dialog-button" type="button" onclick="alert('native dialog from fixture')">Open dialog</button>
    <div id="scroller" style="height:160px;overflow:auto;border:1px solid #ccc">
      <div style="height:1500px">tall scroller content</div>
    </div>
    <div style="height:2200px"></div>
    <div id="bottom">bottom of page</div>
    <script>
      window.__clicked = 0
      document.querySelector("#go").addEventListener("click", () => {
        window.__clicked += 1
        document.querySelector("#result").textContent =
          document.querySelector("#name").value + "/" + document.querySelector("#color").value
      })
    </script>
  </body>
</html>`

async function loadPlaywright() {
  for (const candidate of ["playwright", "playwright-core"]) {
    try {
      return await import(candidate)
    } catch {}
  }
  throw new Error("YUNTI_E2E=1 requires playwright or playwright-core")
}

function launchOptions(executablePath = "") {
  return {
    headless: process.env.YUNTI_E2E_HEADLESS === "1",
    ...(executablePath ? { executablePath } : {}),
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  }
}

function resolveChromiumExecutable(playwright) {
  const fromEnv = String(process.env.YUNTI_E2E_EXECUTABLE_PATH || "").trim()
  if (fromEnv) return fromEnv
  // Ask Playwright where its managed Chromium lives. Returning "" means "use
  // the default", which is exactly what launchPersistentContext expects when no
  // explicit binary was requested.
  try {
    const candidate = playwright.chromium.executablePath()
    return candidate && existsSync(candidate) ? candidate : ""
  } catch {
    return ""
  }
}

async function getExtensionWorker(context) {
  const existing = context.serviceWorkers()[0]
  if (existing) return existing
  return context.waitForEvent("serviceworker", { timeout: 15_000 })
}

async function startFixtureServer() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(FIXTURE_HTML)
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((r) => server.close(r)),
  }
}

async function waitForBrowserSession(bridgeUrl) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const health = await (await fetch(`${bridgeUrl}/health?userId=local`)).json()
    const sessions = Array.isArray(health.sessions) ? health.sessions : []
    const page = sessions.find((s) => s.kind !== "browser_controller" && s.browserSessionId)
    if (page?.browserSessionId) return page.browserSessionId
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error("Timed out waiting for the extension to register a page session")
}

function elementsOf(result) {
  if (!result) return []
  if (Array.isArray(result.elements)) return result.elements
  if (Array.isArray(result.interactive)) return result.interactive
  return []
}

test("browser interaction semantics", { skip: runE2e ? false : "set YUNTI_E2E=1 to run real-browser interaction tests" }, async (t) => {
  const playwright = await loadPlaywright()
  const fixture = await startFixtureServer()
  const bridge = await startBridgeServer({ host: "127.0.0.1", port: 0, sessionTtlMs: 120_000 })
  const bridgeUrl = `http://127.0.0.1:${bridge.server.address().port}`
  const userDataDir = await mkdtemp(join(tmpdir(), "yunti-interaction-profile-"))
  let context = null

  const callTool = async (name, args) => {
    const response = await handleJsonRpc(
      { jsonrpc: "2.0", id: Math.floor(Math.random() * 1_000_000), method: "tools/call", params: { name, arguments: args } },
      bridge
    )
    const text = response?.result?.content?.[0]?.text || ""
    assert.equal(response?.result?.isError, undefined, `${name} failed: ${text}`)
    return response.result.structuredContent ?? JSON.parse(text)
  }

  const evaluate = async (session, expression) => {
    const result = await callTool("yunti_evaluate_script", { browserSessionId: session, expression })
    return result?.value
  }

  // Every action resolves its uid from a fresh observation: uids are scoped to
  // one observation, so reusing one after another observe is a stale-uid error
  // by design.
  const freshUid = async (session, pick) => {
    const observation = await callTool("yunti_observe_page", { browserSessionId: session, mode: "balanced" })
    const match = elementsOf(observation).find(pick)
    return match?.uid || ""
  }

  try {
    const executablePath = resolveChromiumExecutable(playwright)
    t.diagnostic(`chromium executable: ${executablePath || "(playwright default)"}`)
    context = await playwright.chromium.launchPersistentContext(userDataDir, launchOptions(executablePath))
    const worker = await getExtensionWorker(context)
    await worker.evaluate(
      ({ bridgeUrl: runtimeBridgeUrl }) =>
        chrome.storage.local.set({
          bridgeUrl: runtimeBridgeUrl,
          bridgeToken: "",
          platformMatches: ["*"],
          localUserId: "local",
          localUserName: "local",
        }),
      { bridgeUrl }
    )
    const page = await context.newPage()
    await page.goto(fixture.url)
    const session = await waitForBrowserSession(bridgeUrl)
    assert.ok(session, "the fixture page must register a browser session")
    t.diagnostic(`browser session: ${session}`)

    await t.test("click by fresh uid actually changes page state", async () => {
      const inputUid = await freshUid(session, (e) => e.tag === "input")
      assert.ok(inputUid, "fixture must expose the name input")
      await callTool("yunti_fill", { browserSessionId: session, uid: inputUid, value: "Ada" })

      const buttonUid = await freshUid(session, (e) => e.tag === "button" && /click me/i.test(e.name || ""))
      assert.ok(buttonUid, "fixture must expose the click target")
      await callTool("yunti_click", { browserSessionId: session, uid: buttonUid })

      const clicked = await evaluate(session, "window.__clicked")
      assert.equal(Number(clicked), 1, "the click handler must run exactly once")
      const text = await evaluate(session, "document.querySelector('#result').textContent")
      assert.equal(text, "Ada/red", "the handler must observe the filled value")
    })

    await t.test("fill reaches input, textarea and select", async () => {
      const textareaUid = await freshUid(session, (e) => e.tag === "textarea")
      assert.ok(textareaUid, "fixture must expose the notes textarea")
      await callTool("yunti_fill", { browserSessionId: session, uid: textareaUid, value: "line one" })
      assert.equal(await evaluate(session, "document.querySelector('#notes').value"), "line one")

      const selectUid = await freshUid(session, (e) => e.tag === "select")
      assert.ok(selectUid, "fixture must expose the colour select")
      await callTool("yunti_select", { browserSessionId: session, uid: selectUid, value: "blue" })
      assert.equal(await evaluate(session, "document.querySelector('#color').value"), "blue")
    })

    await t.test("scroll moves the page and reports the no-movement edge", async () => {
      await callTool("yunti_scroll", { browserSessionId: session, direction: "down", amount: 600 })
      const scrolled = Number(await evaluate(session, "window.scrollY"))
      assert.ok(scrolled > 0, `expected the page to scroll, got scrollY=${scrolled}`)

      // Drive to the bottom, then ask for more: the runtime answers with a
      // structured diagnostic instead of silently doing nothing.
      let edge = null
      for (let i = 0; i < 12; i += 1) {
        edge = await callTool("yunti_scroll", { browserSessionId: session, direction: "down", amount: 800 })
      }
      assert.equal(edge.ok, false, "scrolling past the bottom must not report success")
      assert.equal(edge.code, "NO_SCROLL_MOVEMENT")
      assert.ok(
        edge.recoveryHint || edge.recoverable || edge.nextStepHint,
        "the no-movement answer must stay actionable"
      )
    })

    await t.test("a native dialog does not wedge the tab", async () => {
      // The scroll subtest left the page at the bottom; bring the trigger back
      // into view before asking for its uid, otherwise the observation reports
      // only what is currently visible.
      await evaluate(session, "window.scrollTo(0, 0)")
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))

      const dialogUid = await freshUid(session, (e) => e.tag === "button" && /dialog/i.test(e.name || ""))
      assert.ok(dialogUid, "fixture must expose the dialog trigger")

      const startedAt = Date.now()
      const result = await callTool("yunti_click", { browserSessionId: session, uid: dialogUid })
      const elapsedMs = Date.now() - startedAt
      assert.ok(
        elapsedMs < 20_000,
        `clicking a dialog trigger must not hang until the tool timeout (took ${elapsedMs}ms)`
      )
      assert.ok(result, "the click must return a structured result")
      assert.ok(
        result.dialogOpened === true || result.ok === false,
        "a dialog-triggering click must either report the dialog or fail structurally"
      )

      // Leave the tab usable for anything that runs after this file.
      await callTool("yunti_handle_dialog", { browserSessionId: session, action: "accept" }).catch(() => {})
    })
  } finally {
    if (context) await context.close().catch(() => {})
    await fixture.close().catch(() => {})
    // node:http close() is callback-based, not promise-based.
    await new Promise((resolvePromise) => bridge.server.close(() => resolvePromise())).catch(() => {})
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  }
})
