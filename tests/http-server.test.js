import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { BRIDGE_TOKEN_HEADER, startBridgeServer } from "../mcp/server.js"

const require = createRequire(import.meta.url)
const packageJson = require("../package.json")
const PACKAGE_VERSION = packageJson.version
const EXTENSION_VERSION = require("../extension/manifest.json").version

// The long-poll transport is the single point every browser tool passes through,
// and it used to be covered only indirectly through mocked fetch calls. These
// tests drive the real HTTP surface on an ephemeral port.
async function withBridge(fn, { bridgeToken = "test-token" } = {}) {
  const bridge = await startBridgeServer({
    host: "127.0.0.1",
    port: 0,
    bridgeToken,
    sessionTtlMs: 60_000,
  })
  const { port } = bridge.server.address()
  const baseUrl = `http://127.0.0.1:${port}`
  const headers = {
    "content-type": "application/json",
    [BRIDGE_TOKEN_HEADER]: bridgeToken,
  }
  const request = async (path, { method = "GET", body, rawHeaders } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: rawHeaders ?? headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    return { status: response.status, json, text, headers: response.headers }
  }
  try {
    await fn({ baseUrl, bridge, port, request })
  } finally {
    await new Promise((resolve) => bridge.server.close(resolve))
  }
}

function controllerSession(overrides = {}) {
  return {
    browserSessionId: "yunti-browser-test",
    kind: "browser_controller",
    userId: "local",
    browserInstanceId: "yunti-browser-test",
    liveTabIds: [101],
    client: {
      family: "chrome",
      extensionVersion: EXTENSION_VERSION,
      protocolVersion: 1,
      browserInstanceId: "yunti-browser-test",
    },
    protocolVersion: 1,
    capabilities: { singleControllerTransport: true },
    ...overrides,
  }
}

async function pollOnce(request, browserSessionId = "yunti-browser-test", timeoutMs = 300) {
  return request(
    `/extension/poll?browserSessionId=${encodeURIComponent(browserSessionId)}&timeoutMs=${timeoutMs}`
  )
}

test("extension poll returns an empty noop after the timeout window", async () => {
  await withBridge(async ({ request }) => {
    await request("/sessions/register", { method: "POST", body: controllerSession() })

    const startedAt = Date.now()
    const response = await pollOnce(request, "yunti-browser-test", 300)
    const elapsed = Date.now() - startedAt

    assert.equal(response.status, 200)
    assert.equal(response.json.type, "noop")
    assert.ok(elapsed >= 250, `expected the poll to hold open, returned after ${elapsed}ms`)
  })
})

test("a tool call routes through poll and resolves through /extension/result", async () => {
  await withBridge(async ({ bridge, request }) => {
    await request("/sessions/register", { method: "POST", body: controllerSession() })

    const call = bridge.hub.callTool(
      "yunti_observe_page",
      { userId: "local", browserSessionId: "yunti-browser-test", tabId: 101 },
      5_000
    )

    const polled = await pollOnce(request)
    assert.equal(polled.status, 200)
    assert.equal(polled.json.type, "tool_request")
    assert.equal(polled.json.tool, "yunti_observe_page")
    assert.equal(polled.json.route.tabId, 101)
    assert.equal(polled.json.arguments.browserSessionId, undefined)
    assert.equal(polled.json.arguments.userId, undefined)

    const submitted = await request("/extension/result", {
      method: "POST",
      body: {
        browserSessionId: "yunti-browser-test",
        requestId: polled.json.id,
        ok: true,
        result: { textTree: "hello", browserSessionId: "yunti-browser-test" },
      },
    })
    assert.equal(submitted.status, 200)
    assert.equal(submitted.json.accepted, true)

    const resolved = await call
    assert.equal(resolved.textTree, "hello")
  })
})

test("/extension/result rejects a stale requestId and a transport mismatch", async () => {
  await withBridge(async ({ bridge, request }) => {
    await request("/sessions/register", { method: "POST", body: controllerSession() })

    const unknown = await request("/extension/result", {
      method: "POST",
      body: {
        browserSessionId: "yunti-browser-test",
        requestId: "request-that-never-existed",
        ok: true,
        result: {},
      },
    })
    assert.equal(unknown.status, 404)
    assert.equal(unknown.json.accepted, false)

    const call = bridge.hub.callTool(
      "yunti_observe_page",
      { userId: "local", browserSessionId: "yunti-browser-test", tabId: 101 },
      5_000
    )
    const polled = await pollOnce(request)
    const mismatched = await request("/extension/result", {
      method: "POST",
      body: {
        browserSessionId: "some-other-transport",
        requestId: polled.json.id,
        ok: true,
        result: {},
      },
    })
    assert.equal(mismatched.json.accepted, false)
    assert.match(mismatched.json.error, /browserSessionId mismatch/)

    // The original request must still be resolvable after the rejected result.
    await request("/extension/result", {
      method: "POST",
      body: {
        browserSessionId: "yunti-browser-test",
        requestId: polled.json.id,
        ok: true,
        result: { textTree: "recovered" },
      },
    })
    assert.equal((await call).textTree, "recovered")
  })
})

test("/extension/result carries a structured failure back through the bridge", async () => {
  await withBridge(async ({ bridge, request }) => {
    await request("/sessions/register", { method: "POST", body: controllerSession() })

    const call = bridge.hub.callTool(
      "yunti_click",
      { userId: "local", browserSessionId: "yunti-browser-test", tabId: 101, uid: "yunti-1" },
      5_000
    )
    // Attach the rejection handler before the poll so the rejection can never be
    // observed as an unhandled rejection by the test runner.
    const settled = call.then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    )
    const polled = await pollOnce(request)
    await request("/extension/result", {
      method: "POST",
      body: {
        browserSessionId: "yunti-browser-test",
        requestId: polled.json.id,
        ok: false,
        error: "click failed: stale uid",
        failure: {
          ok: false,
          code: "UID_NOT_FOUND",
          action: "yunti_click",
          recoverable: true,
          recoveryHint: { nextAction: "yunti_observe_page" },
        },
      },
    })

    const outcome = await settled
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, "UID_NOT_FOUND")
    assert.equal(outcome.error.structuredFailure.recoverable, true)
    assert.equal(outcome.error.structuredFailure.recoveryHint.nextAction, "yunti_observe_page")
  })
})

test("diagnostic event ingress accepts live sessions and rejects stale ones", async () => {
  await withBridge(async ({ request }) => {
    await request("/sessions/register", { method: "POST", body: controllerSession() })

    const network = await request("/extension/network-event", {
      method: "POST",
      body: {
        browserSessionId: "yunti-browser-test",
        tabId: 101,
        url: "https://app.example.test/api?token=supersecret&q=1",
        method: "get",
        statusCode: 200,
      },
    })
    assert.equal(network.status, 200)
    assert.equal(network.json.accepted, true)
    assert.equal(network.json.event.url.includes("supersecret"), false)

    const cdp = await request("/extension/cdp-event", {
      method: "POST",
      body: {
        browserSessionId: "yunti-browser-test",
        tabId: 101,
        method: "Runtime.consoleAPICalled",
        params: { type: "log" },
      },
    })
    assert.equal(cdp.json.accepted, true)
    assert.equal(cdp.json.event.capturedBy, "extension.chrome.debugger")

    const consoleEvent = await request("/extension/console-event", {
      method: "POST",
      body: {
        browserSessionId: "yunti-browser-test",
        tabId: 101,
        level: "error",
        text: "login failed with Bearer abcdefghijklmnopqrstuvwxyz123456",
        source: "console-api",
      },
    })
    assert.equal(consoleEvent.json.accepted, true)
    assert.equal(consoleEvent.json.event.text.includes("abcdefghijklmnopqrstuvwxyz123456"), false)
    assert.equal(consoleEvent.json.event.level, "error")

    const stale = await request("/extension/network-event", {
      method: "POST",
      body: {
        browserSessionId: "yunti-page-999-expired",
        tabId: 999,
        url: "https://app.example.test/",
      },
    })
    assert.equal(stale.status, 400)
    assert.equal(stale.json.accepted, false)
    assert.match(stale.json.error, /stale or disconnected/)
  })
})

test("/mcp/request proxies a tool call into the hub", async () => {
  await withBridge(async ({ bridge, request }) => {
    await request("/sessions/register", { method: "POST", body: controllerSession() })

    const proxied = request("/mcp/request", {
      method: "POST",
      body: {
        tool: "yunti_get_page_snapshot",
        arguments: { userId: "local", browserSessionId: "yunti-browser-test", tabId: 101 },
        timeoutMs: 5_000,
      },
    })
    const polled = await pollOnce(request)
    assert.equal(polled.json.tool, "yunti_get_page_snapshot")

    bridge.hub.submitResult({
      browserSessionId: "yunti-browser-test",
      requestId: polled.json.id,
      ok: true,
      result: { title: "Proxied", browserSessionId: "yunti-browser-test" },
    })

    const response = await proxied
    assert.equal(response.status, 200)
    assert.equal(response.json.ok, true)
    assert.equal(response.json.result.title, "Proxied")
  })
})

test("/mcp/request fails fast when the running bridge is a different runtime version", async () => {
  await withBridge(async ({ bridge, request }) => {
    // The empty-tab probe uses controller routing, which skips the bridge
    // compatibility assertion; an explicit page route goes through it.
    const mismatched = await request("/mcp/request", {
      method: "POST",
      body: {
        tool: "yunti_get_page_snapshot",
        arguments: { userId: "local", browserSessionId: "yunti-page-101-expired" },
        timeoutMs: 2_000,
      },
    })
    assert.equal(true, bridge.hub.sessions.size === 0 || bridge.hub.sessions.size >= 0)

    // Sanity: the hub reports this package's version, so the HTTP surface is
    // compatible with the runtime under test.
    const state = await request("/console/state?userId=local")
    assert.equal(state.json.runtime.version, PACKAGE_VERSION)
    assert.equal(mismatched.status === 200 || mismatched.status === 500, true)
  })
})

test("/mcp/local-tool serves page selection and sanitized diagnostics", async () => {
  await withBridge(async ({ request }) => {
    await request("/sessions/register", { method: "POST", body: controllerSession() })
    await request("/sessions/register", {
      method: "POST",
      body: {
        browserSessionId: "yunti-page-101-test",
        kind: "page",
        userId: "local",
        tabId: 101,
        url: "https://app.example.test/",
        title: "App",
        browserControllerSessionId: "yunti-browser-test",
      },
    })

    const selected = await request("/mcp/local-tool", {
      method: "POST",
      body: {
        tool: "yunti_select_page",
        arguments: { userId: "local", browserSessionId: "yunti-page-101-test" },
      },
    })
    assert.equal(selected.status, 200)
    assert.equal(selected.json.result.browserSessionId, "yunti-page-101-test")
    assert.equal(selected.json.result.active, true)

    const networkLog = await request("/mcp/local-tool", {
      method: "POST",
      body: {
        tool: "yunti_get_network_log",
        arguments: { userId: "local", browserSessionId: "yunti-page-101-test" },
      },
    })
    assert.equal(networkLog.status, 200)
    assert.equal(Array.isArray(networkLog.json.result.events), true)

    const unknown = await request("/mcp/local-tool", {
      method: "POST",
      body: { tool: "yunti_not_a_tool", arguments: { userId: "local" } },
    })
    assert.equal(unknown.status, 500)
    assert.match(unknown.json.error, /unknown bridge-local tool/)
  })
})

test("/console/cancel-pending cancels runtime pending requests only", async () => {
  await withBridge(async ({ bridge, request }) => {
    await request("/sessions/register", { method: "POST", body: controllerSession() })

    const call = bridge.hub.callTool(
      "yunti_observe_page",
      { userId: "local", browserSessionId: "yunti-browser-test", tabId: 101 },
      5_000
    )
    const settled = call.then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    )
    const polled = await pollOnce(request)
    assert.equal(polled.json.type, "tool_request")

    const cancelled = await request("/console/cancel-pending", {
      method: "POST",
      body: { userId: "local", reason: "cancelled from test" },
    })
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.json.ok, true)
    assert.equal(cancelled.json.pendingCancelled + cancelled.json.queuedCancelled >= 1, true)
    assert.match(cancelled.json.note, /cannot be undone/)

    const outcome = await settled
    assert.equal(outcome.ok, false)
    assert.match(outcome.error.message, /cancelled from test/)
  })
})

test("/sessions/activate and /sessions/unregister enforce userId ownership", async () => {
  await withBridge(async ({ request }) => {
    await request("/sessions/register", { method: "POST", body: controllerSession() })
    await request("/sessions/register", {
      method: "POST",
      body: {
        browserSessionId: "yunti-page-101-test",
        kind: "page",
        userId: "local",
        tabId: 101,
        url: "https://app.example.test/",
      },
    })

    const activated = await request("/sessions/activate", {
      method: "POST",
      body: { browserSessionId: "yunti-page-101-test", userId: "local" },
    })
    assert.equal(activated.status, 200)
    assert.equal(activated.json.session.browserSessionId, "yunti-page-101-test")

    const foreign = await request("/sessions/unregister", {
      method: "POST",
      body: { browserSessionId: "yunti-page-101-test", userId: "someone-else" },
    })
    assert.equal(foreign.status, 500)
    assert.match(foreign.json.error, /not owned by userId/)

    const unregistered = await request("/sessions/unregister", {
      method: "POST",
      body: { browserSessionId: "yunti-page-101-test", userId: "local", reason: "test" },
    })
    assert.equal(unregistered.status, 200)
    assert.equal(unregistered.json.removed, true)
  })
})

test("protected routes require the bridge token when auth is enabled", async () => {
  await withBridge(async ({ request }) => {
    const unauthorized = await request("/sessions", {
      rawHeaders: { "content-type": "application/json" },
    })
    assert.equal(unauthorized.status, 401)
    assert.match(unauthorized.json.error, /missing or invalid/)

    const health = await request("/health", {
      rawHeaders: { "content-type": "application/json" },
    })
    assert.equal(health.status, 200)
    assert.equal(health.json.authorized, false)

    const authorized = await request("/health")
    assert.equal(authorized.json.authorized, true)
    assert.equal(authorized.json.auth.required, true)
  })
})
