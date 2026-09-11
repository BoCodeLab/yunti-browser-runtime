import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { handleJsonRpc, startBridgeServer } from "../mcp/server.js"
import packageJson from "../package.json" with { type: "json" }

const runE2e = process.env.YUNTI_E2E === "1"
const headless = process.env.YUNTI_E2E_HEADLESS === "1"
const e2eExecutablePath = String(process.env.YUNTI_E2E_EXECUTABLE_PATH || "").trim()
const secondE2eExecutablePath = String(
  process.env.YUNTI_E2E_SECOND_EXECUTABLE_PATH || ""
).trim()
const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)))
const extensionDir = join(rootDir, "extension")

test("real browser extension bridge smoke", { skip: runE2e ? false : "set YUNTI_E2E=1 to run real-browser smoke test" }, async (t) => {
  const playwright = await loadPlaywright()

  const artifactDir = await mkdtemp(join(tmpdir(), "yunti-browser-e2e-"))
  const bridge = await startBridgeServer({
    host: "127.0.0.1",
    port: 0,
    sessionTtlMs: 120_000,
  })
  const bridgePort = bridge.server.address().port
  const bridgeUrl = `http://127.0.0.1:${bridgePort}`
  const pageServer = await startTestPageServer()
  const userDataDir = await mkdtemp(join(tmpdir(), "yunti-browser-profile-"))
  const secondUserDataDir = secondE2eExecutablePath
    ? await mkdtemp(join(tmpdir(), "yunti-browser-profile-second-"))
    : ""
  let context = null
  let page = null
  let secondContext = null
  let secondPage = null

  try {
    context = await playwright.chromium.launchPersistentContext(userDataDir, {
      headless,
      ...(e2eExecutablePath ? { executablePath: e2eExecutablePath } : {}),
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
      ],
    })

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

    page = await context.newPage()
    await page.goto(pageServer.url)
    const browserSessionId = await waitForBrowserSession(bridgeUrl)
    const consoleState = await getConsoleState(bridgeUrl)
    assert.equal(consoleState.ok, true)
    assert.equal(consoleState.runtime.version, packageJson.version)
    assert.equal(consoleState.runtime.expectedExtensionVersion, packageJson.version)
    assert.ok(consoleState.sessions.some((session) => session.browserSessionId === browserSessionId))
    const consoleSession = consoleState.sessions.find((session) => session.browserSessionId === browserSessionId)
    const controllerSession = consoleState.sessions.find((session) => session.kind === "browser_controller")
    assert.equal(consoleSession.extensionVersion, packageJson.version)
    assert.equal(consoleSession.pollers, 0)
    assert.ok(controllerSession)
    assert.ok(consoleState.sessions.every((session) =>
      session.kind === "browser_controller" || session.pollers === 0
    ))
    assert.ok(consoleState.sessions.reduce((total, session) => total + session.pollers, 0) <= 1)
    assert.equal(consoleState.warnings.some((warning) => warning.code === "NO_EXTENSION_CONTROLLER"), false)
    assert.equal(consoleState.warnings.some((warning) => warning.code === "NO_PAGE_SESSIONS"), false)
    assert.equal(consoleState.warnings.some((warning) => warning.code === "EXTENSION_VERSION_MISMATCH"), false)

    if (secondE2eExecutablePath) {
      secondContext = await playwright.chromium.launchPersistentContext(secondUserDataDir, {
        headless,
        executablePath: secondE2eExecutablePath,
        args: [
          `--disable-extensions-except=${extensionDir}`,
          `--load-extension=${extensionDir}`,
        ],
      })
      const secondWorker = await getExtensionWorker(secondContext)
      await secondWorker.evaluate(
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
      secondPage = await secondContext.newPage()
      await secondPage.goto(`${pageServer.url}?browser=second`)
      await waitForControllerCount(bridgeUrl, 2)

      const multiBrowserTargets = await callTool(
        bridge,
        "yunti_list_browser_targets",
        {}
      )
      assert.equal(multiBrowserTargets.multiBrowser, true)
      assert.equal(multiBrowserTargets.browserCount, 2)
      assert.deepEqual(
        new Set(multiBrowserTargets.browsers.map((browser) => browser.browserFamily)),
        new Set(["chrome", "edge"])
      )
    }

    const targets = await callTool(bridge, "yunti_list_browser_targets", { browserSessionId })
    assert.ok(targets.total >= 1)
    const pageTarget = targets.pages.find((target) => target.url === pageServer.url)
    assert.ok(pageTarget)
    assert.equal(pageTarget.browserSessionId, browserSessionId)
    assert.equal(pageTarget.pageSessionId, browserSessionId)
    assert.notEqual(pageTarget.routeBrowserSessionId, browserSessionId)
    assert.equal(pageTarget.registered, true)

    const recoveredObservation = await callTool(bridge, "yunti_observe_page", {
      browserSessionId: `yunti-${pageTarget.tabId}-expired-legacy-session`,
      redaction: "balanced",
    })
    assert.equal(recoveredObservation.browserSessionId, browserSessionId)
    assert.match(recoveredObservation.textTree, /Click me/)

    const tabObservation = await callTool(bridge, "yunti_observe_page", {
      tabId: pageTarget.tabId,
      redaction: "balanced",
    })
    assert.equal(tabObservation.browserSessionId, browserSessionId)
    assert.match(tabObservation.textTree, /Click me/)

    const snapshot = await callTool(bridge, "yunti_get_page_snapshot", {
      browserSessionId,
      mode: "detailed",
    })
    assert.equal(snapshot.browserSessionId, browserSessionId)
    assert.match(snapshot.visibleText, /Yunti E2E Smoke/)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const repeatedSnapshot = await callTool(bridge, "yunti_get_page_snapshot", {
        browserSessionId,
        mode: "compact",
      })
      assert.equal(repeatedSnapshot.browserSessionId, browserSessionId)
      assert.match(repeatedSnapshot.visibleText, /Yunti E2E Smoke/)
    }

    const observation = await callTool(bridge, "yunti_observe_page", {
      browserSessionId,
      redaction: "balanced",
    })
    assert.equal(observation.browserSessionId, browserSessionId)
    assert.match(observation.textTree, /Click me/)
    const clickTarget = observation.elements.find((element) => element.uid && element.name === "Click me")
    assert.ok(clickTarget?.uid)
    assert.equal(observation.redactions.screenshotRedacted, false)

    await callTool(bridge, "yunti_fill", {
      browserSessionId,
      selector: "#name",
      value: "Yunti",
    })
    await callTool(bridge, "yunti_click", {
      browserSessionId,
      uid: clickTarget.uid,
    })

    const evaluated = await callTool(bridge, "yunti_evaluate_script", {
      browserSessionId,
      expression:
        "JSON.stringify({ value: document.querySelector('#name').value, clicked: window.__clicked || 0 })",
    })
    assert.deepEqual(JSON.parse(evaluated.value), { value: "Yunti", clicked: 1 })

    const axSnapshot = await callTool(bridge, "yunti_take_snapshot", { browserSessionId })
    const axButton = axSnapshot.elements.find((element) => element.role === "button" && element.name === "Click me")
    assert.ok(axButton?.backendNodeId)
    const axClick = await callTool(bridge, "yunti_click", { browserSessionId, uid: axButton.uid })
    assert.equal(axClick.clicked, true)
    const afterAxClick = await callTool(bridge, "yunti_evaluate_script", {
      browserSessionId,
      expression: "window.__clicked",
    })
    assert.equal(afterAxClick.value, 2)
    await rm(artifactDir, { recursive: true, force: true })
  } catch (error) {
    if (page) {
      await page.screenshot({ path: join(artifactDir, "failure.png"), fullPage: true }).catch(() => {})
    }
    await writeFile(join(artifactDir, "error.log"), error?.stack || String(error))
    await writeFile(
      join(artifactDir, "bridge-state.json"),
      JSON.stringify(bridge.hub?.consoleState({
        userId: "local",
        runtimeVersion: packageJson.version,
        expectedExtensionVersion: packageJson.version,
      }) || {}, null, 2)
    ).catch(() => {})
    t.diagnostic(`E2E artifacts: ${artifactDir}`)
    throw error
  } finally {
    await secondContext?.close().catch(() => {})
    await context?.close().catch(() => {})
    await pageServer.close()
    await new Promise((resolvePromise) => bridge.server.close(resolvePromise))
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    if (secondUserDataDir) {
      await rm(secondUserDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }
})

async function loadPlaywright() {
  try {
    return await import("playwright-core")
  } catch {
    throw new Error("Real-browser E2E requires the declared playwright-core dependency. Install dependencies before enabling YUNTI_E2E.")
  }
}

async function getExtensionWorker(context) {
  const existing = context.serviceWorkers()[0]
  if (existing) return existing
  return context.waitForEvent("serviceworker", { timeout: 10_000 })
}

async function startTestPageServer() {
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Yunti E2E Smoke</title></head>
  <body>
    <h1>Yunti E2E Smoke</h1>
    <label>Name <input id="name" /></label>
    <button id="go">Click me</button>
    <output id="result"></output>
    <script>
      window.__clicked = 0;
      document.querySelector("#go").addEventListener("click", () => {
        window.__clicked += 1;
        document.querySelector("#result").textContent = document.querySelector("#name").value;
      });
    </script>
  </body>
</html>`
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(html)
  })
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise))
  const port = server.address().port
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolvePromise) => server.close(resolvePromise)),
  }
}

async function waitForBrowserSession(bridgeUrl) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const response = await fetch(`${bridgeUrl}/health?userId=local`)
    const health = await response.json()
    const sessions = Array.isArray(health.sessions) ? health.sessions : []
    const active = sessions.find((session) => session.active && session.kind !== "browser_controller")
      || sessions.find((session) => session.kind !== "browser_controller")
    if (active?.browserSessionId) return active.browserSessionId
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  throw new Error("Timed out waiting for extension page registration")
}

async function waitForControllerCount(bridgeUrl, expectedCount) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const response = await fetch(`${bridgeUrl}/health?userId=local`)
    const health = await response.json()
    if (Number(health.controllerCount || 0) >= expectedCount) return health
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  throw new Error(`Timed out waiting for ${expectedCount} browser controllers`)
}

async function getConsoleState(bridgeUrl) {
  const head = await fetch(`${bridgeUrl}/console`, { method: "HEAD" })
  assert.equal(head.status, 200)
  assert.match(head.headers.get("content-type") || "", /text\/html/)

  const page = await fetch(`${bridgeUrl}/console`)
  const html = await page.text()
  assert.equal(page.status, 200)
  assert.match(html, /Yunti Browser Runtime/)

  const response = await fetch(`${bridgeUrl}/console/state?userId=local`)
  assert.equal(response.status, 200)
  return response.json()
}

async function callTool(bridge, name, args) {
  const response = await handleJsonRpc(
    {
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1_000_000),
      method: "tools/call",
      params: { name, arguments: args },
    },
    bridge
  )
  const text = response?.result?.content?.[0]?.text || ""
  assert.equal(response?.result?.isError, undefined, text)
  return response.result.structuredContent ?? JSON.parse(text)
}
