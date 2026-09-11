import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import {
  BRIDGE_TOKEN_HEADER,
  BridgeHub,
  CURRENT_EXTENSION_PROTOCOL_VERSION,
  handleJsonRpc,
  startBridgeServer,
  TOOLS,
} from "../mcp/server.js"

const require = createRequire(import.meta.url)
const packageJson = require("../package.json")
const PACKAGE_VERSION = packageJson.version

async function withHttpBridge(fn, options = {}) {
  const bridge = await startBridgeServer({
    host: "127.0.0.1",
    port: 0,
    bridgeToken: options.bridgeToken ?? "test-token",
  })
  const address = bridge.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  try {
    await fn({ baseUrl, bridge })
  } finally {
    await new Promise((resolve) => bridge.server.close(resolve))
  }
}

function authHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    [BRIDGE_TOKEN_HEADER]: "test-token",
    ...extra,
  }
}

async function readJsonResponse(response) {
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  }
}

async function readTextResponse(response) {
  return {
    status: response.status,
    headers: response.headers,
    body: await response.text(),
  }
}

test("bridge routes a tool request to the registered browser session", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://shop.example.test/" })

  const call = hub.callTool("yunti_get_page_snapshot", { browserSessionId: "tab-1", userId: "u1" }, 1000)
  const event = await hub.poll("tab-1", 100)

  assert.equal(event.type, "tool_request")
  assert.equal(event.tool, "yunti_get_page_snapshot")
  assert.equal(event.arguments.browserSessionId, undefined)

  const outcome = hub.submitResult({
    browserSessionId: "tab-1",
    requestId: event.id,
    ok: true,
    result: { title: "Yunti" },
  })

  assert.equal(outcome.accepted, true)
  assert.deepEqual(await call, { title: "Yunti" })
})

test("controller polls preserve pages in other browsers with different tab inventories", async () => {
  const hub = new BridgeHub()
  for (const [id, tabId] of [["a", 101], ["b", 202]]) {
    hub.registerSession({
      browserSessionId: `controller-${id}`, browserInstanceId: id, userId: "local",
      kind: "browser_controller", liveTabIds: [tabId],
    })
    hub.registerSession({
      browserSessionId: `page-${id}`, browserInstanceId: id, userId: "local",
      browserControllerSessionId: `controller-${id}`, tabId,
    })
  }
  for (const id of ["a", "b"]) {
    const abort = new AbortController()
    const poll = hub.poll(`controller-${id}`, 1000, abort.signal)
    abort.abort()
    await poll
    assert.ok(hub.sessions.has("page-a"))
    assert.ok(hub.sessions.has("page-b"))
  }
})

test("expired queued writes are never delivered to a later controller poll", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "page", userId: "local" })
  await assert.rejects(hub.callTool("yunti_click", {
    browserSessionId: "page", userId: "local", selector: "#submit",
  }, 10), /Timed out/)
  assert.equal(hub.sessions.get("page").queue.length, 0)
  const call = hub.callTool("yunti_observe_page", { browserSessionId: "page", userId: "local" }, 1000)
  const event = await hub.poll("page")
  assert.equal(event.tool, "yunti_observe_page")
  assert.ok(event.deadlineAt > Date.now())
  hub.submitResult({ browserSessionId: "page", requestId: event.id, ok: true, result: {} })
  await call
})

test("bridge HTTP routes require the configured token", async () => {
  await withHttpBridge(async ({ baseUrl }) => {
    const unauthorized = await readJsonResponse(await fetch(`${baseUrl}/sessions/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ browserSessionId: "tab-1", userId: "u1" }),
    }))
    assert.equal(unauthorized.status, 401)
    assert.match(unauthorized.body.error, /missing or invalid/)

    const authorized = await readJsonResponse(await fetch(`${baseUrl}/sessions/register`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ browserSessionId: "tab-1", userId: "u1" }),
    }))
    assert.equal(authorized.status, 200)
    assert.equal(authorized.body.ok, true)
    assert.equal(authorized.body.session.browserSessionId, "tab-1")
  })
})

test("local bridge defaults to no token requirement", async () => {
  await withHttpBridge(async ({ baseUrl, bridge }) => {
    assert.equal(bridge.authRequired, false)
    assert.equal(bridge.bridgeToken, "")

    const registered = await readJsonResponse(await fetch(`${baseUrl}/sessions/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ browserSessionId: "tab-1", userId: "u1" }),
    }))
    assert.equal(registered.status, 200)
    assert.equal(registered.body.ok, true)

    const health = await readJsonResponse(await fetch(`${baseUrl}/health?userId=u1`))
    assert.equal(health.status, 200)
    assert.equal(health.body.authorized, true)
    assert.equal(health.body.auth.required, false)
    assert.equal(health.body.sessionCount, 1)
    assert.equal(health.body.sessions.length, 1)
  }, { bridgeToken: "" })
})

test("local runtime console exposes an optional page and sanitized state", async () => {
  await withHttpBridge(async ({ baseUrl }) => {
    const head = await fetch(`${baseUrl}/console`, { method: "HEAD" })
    assert.equal(head.status, 200)
    assert.match(head.headers.get("content-type"), /text\/html/)

    const page = await readTextResponse(await fetch(`${baseUrl}/console`))
    assert.equal(page.status, 200)
    assert.match(page.headers.get("content-type"), /text\/html/)
    assert.match(page.body, /Yunti Browser Runtime/)

    await fetch(`${baseUrl}/sessions/register`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        browserSessionId: "tab-1",
        userId: "u1",
        userName: "owner@example.test",
        title: "Checkout owner@example.test",
        url: "https://shop.example.test/cart?token=secret-token-1234567890",
        tabId: 7,
        client: {
          family: "chrome",
          extensionVersion: PACKAGE_VERSION,
          protocolVersion: CURRENT_EXTENSION_PROTOCOL_VERSION,
        },
        protocolVersion: CURRENT_EXTENSION_PROTOCOL_VERSION,
      }),
    })

    const state = await readJsonResponse(await fetch(`${baseUrl}/console/state?userId=u1`, {
      headers: authHeaders(),
    }))
    assert.equal(state.status, 200)
    assert.equal(state.body.ok, true)
    assert.equal(state.body.runtime.version, PACKAGE_VERSION)
    assert.equal(state.body.runtime.expectedExtensionVersion, PACKAGE_VERSION)
    assert.equal(state.body.sessionCount, 1)
    assert.equal(state.body.sessions[0].browserSessionId, "tab-1")
    assert.equal(state.body.sessions[0].extensionVersion, PACKAGE_VERSION)
    assert.deepEqual(state.body.warnings, [])
    assert.doesNotMatch(JSON.stringify(state.body), /owner@example\.test/)
    assert.doesNotMatch(JSON.stringify(state.body), /secret-token-1234567890/)
    assert.match(state.body.guidance.noSessions, /reload the extension/)
  })
})

test("local runtime console reports extension version mismatch warnings", () => {
  const hub = new BridgeHub()
  hub.registerSession({
    browserSessionId: "tab-1",
    userId: "u1",
    client: { family: "chrome", extensionVersion: "0.1.0" },
  })

  const state = hub.consoleState({
    userId: "u1",
    runtimeVersion: PACKAGE_VERSION,
    expectedExtensionVersion: PACKAGE_VERSION,
  })

  assert.equal(state.runtime.version, PACKAGE_VERSION)
  assert.equal(state.sessions[0].extensionVersion, "0.1.0")
  assert.equal(state.warnings[0].code, "EXTENSION_VERSION_MISMATCH")
  assert.match(state.warnings[0].message, /0\.1\.0/)
  assert.match(state.guidance.versionMismatch, /Reload the unpacked extension/)
})

test("local runtime console state stays protected when bridge auth is enabled", async () => {
  await withHttpBridge(async ({ baseUrl }) => {
    const page = await readTextResponse(await fetch(`${baseUrl}/console`))
    assert.equal(page.status, 200)

    const unauthorized = await readJsonResponse(await fetch(`${baseUrl}/console/state?userId=u1`))
    assert.equal(unauthorized.status, 401)
    assert.match(unauthorized.body.error, /missing or invalid/)

    const authorized = await readJsonResponse(await fetch(`${baseUrl}/console/state?userId=u1`, {
      headers: authHeaders(),
    }))
    assert.equal(authorized.status, 200)
    assert.equal(authorized.body.ok, true)
  })
})

test("local runtime console can cancel pending and queued browser requests", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  const call = hub.callTool("yunti_get_page_snapshot", { browserSessionId: "tab-1", userId: "u1" }, 1000)

  const result = hub.cancelPendingRequests({ userId: "u1" })

  assert.equal(result.ok, true)
  assert.equal(result.pendingCancelled, 0)
  assert.equal(result.queuedCancelled, 1)
  assert.match(result.note, /browser-side effects/)
  await assert.rejects(call, /cancelled from local runtime console/)

  const state = hub.consoleState({ userId: "u1" })
  assert.equal(state.pendingRequests.length, 0)
  assert.equal(state.queuedRequests.length, 0)
  assert.ok(state.recentActivity.some((event) => event.status === "cancelled"))
})

test("bridge health is limited without token and complete with token", async () => {
  await withHttpBridge(async ({ baseUrl }) => {
    await fetch(`${baseUrl}/sessions/register`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ browserSessionId: "tab-1", userId: "u1" }),
    })

    const limited = await readJsonResponse(await fetch(`${baseUrl}/health?userId=u1`))
    assert.equal(limited.status, 200)
    assert.equal(limited.body.ok, true)
    assert.equal(limited.body.authorized, false)
    assert.equal(limited.body.auth.header, BRIDGE_TOKEN_HEADER)
    assert.equal(limited.body.sessions, undefined)

    const complete = await readJsonResponse(await fetch(`${baseUrl}/health?userId=u1`, {
      headers: authHeaders(),
    }))
    assert.equal(complete.status, 200)
    assert.equal(complete.body.sessionCount, 1)
    assert.equal(complete.body.sessions.length, 1)
    assert.equal(complete.body.activeSessionId, "tab-1")
  })
})

test("bridge requires a token when binding to a non-loopback host", async () => {
  await assert.rejects(
    () => startBridgeServer({ host: "0.0.0.0", port: 0, bridgeToken: "" }),
    /YUNTI_BROWSER_BRIDGE_TOKEN is required/
  )
})

test("bridge CORS only echoes allowed origins", async () => {
  await withHttpBridge(async ({ baseUrl }) => {
    const local = await fetch(`${baseUrl}/health`, {
      headers: { origin: "http://localhost:3000" },
    })
    assert.equal(local.headers.get("access-control-allow-origin"), "http://localhost:3000")

    const extension = await fetch(`${baseUrl}/health`, {
      headers: { origin: "chrome-extension://abc123" },
    })
    assert.equal(extension.headers.get("access-control-allow-origin"), "chrome-extension://abc123")

    const remote = await fetch(`${baseUrl}/health`, {
      headers: { origin: "https://evil.example" },
    })
    assert.equal(remote.headers.get("access-control-allow-origin"), null)
  })
})

test("browser sessions expire without heartbeat and are cleaned up", () => {
  const hub = new BridgeHub({ sessionTtlMs: 10 })
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })

  const expired = hub.cleanupExpiredSessions(Date.now() + 6000)

  assert.equal(expired.length, 1)
  assert.equal(hub.listSessions({ userId: "u1" }).length, 0)
  assert.equal(hub.health({ userId: "u1" }).activeSessionId, null)
})

test("old browserSessionId fails fast with recovery guidance", async () => {
  const hub = new BridgeHub({ sessionTtlMs: 10 })
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  hub.cleanupExpiredSessions(Date.now() + 6000)

  await assert.rejects(
    hub.callTool("yunti_get_page_snapshot", { browserSessionId: "tab-1", userId: "u1" }, 10),
    /stale or disconnected.*yunti_list_browser_targets/
  )
})

test("poll heartbeat refreshes session expiry", async () => {
  const hub = new BridgeHub({ sessionTtlMs: 1000 })
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  const firstExpiresAt = hub.sessions.get("tab-1").expiresAt

  const call = hub.callTool("yunti_get_page_snapshot", { browserSessionId: "tab-1", userId: "u1" }, 1000)
  const event = await hub.poll("tab-1", 1)
  const secondExpiresAt = hub.sessions.get("tab-1").expiresAt

  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: {} })
  await call
  assert.ok(secondExpiresAt >= firstExpiresAt)
  assert.equal(hub.listSessions({ userId: "u1" }).length, 1)
})

test("aborted extension poll is removed before it can consume a tool request", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "controller-1", userId: "u1", kind: "browser_controller" })
  const controller = new AbortController()
  const pendingPoll = hub.poll("controller-1", 10_000, controller.signal)
  assert.equal(hub.sessions.get("controller-1").pollers.length, 1)

  controller.abort()
  const event = await pendingPoll
  assert.equal(event.aborted, true)
  assert.equal(hub.sessions.get("controller-1").pollers.length, 0)
})

test("browser controller heartbeat is distinct from page sessions", async () => {
  const hub = new BridgeHub()
  hub.registerSession({
    browserSessionId: "controller-1",
    userId: "u1",
    kind: "browser_controller",
    tabId: null,
    url: "browser://yunti-runtime",
  })

  const health = hub.health({ userId: "u1" })
  assert.equal(health.extensionConnected, true)
  assert.equal(health.controllerCount, 1)
  assert.equal(health.pageSessionCount, 0)
  assert.equal(health.activeSessionId, null)
  assert.equal(health.browserControllerSessionId, "controller-1")
  assert.equal(hub.listPages({ userId: "u1" }).pages.length, 0)

  const call = hub.callTool("yunti_list_browser_targets", { userId: "u1" }, 1000)
  const event = await hub.poll("controller-1", 100)
  assert.equal(event.tool, "yunti_list_browser_targets")
  hub.submitResult({
    browserSessionId: "controller-1",
    requestId: event.id,
    ok: true,
    result: { browserSessionId: "controller-1", targets: [], total: 0 },
  })
  assert.equal((await call).browserSessionId, "controller-1")

  await assert.rejects(
    hub.callTool("yunti_observe_page", { browserSessionId: "controller-1", userId: "u1" }, 1000),
    /requires a concrete page session/
  )
})

test("0.2.3 controller is the single transport for page tools", async () => {
  const hub = new BridgeHub()
  hub.registerSession({
    browserSessionId: "controller-1",
    userId: "u1",
    kind: "browser_controller",
    tabId: null,
    liveTabIds: [42],
    capabilities: { singleControllerTransport: true },
  })
  hub.registerSession({
    browserSessionId: "yunti-page-42-controller",
    userId: "u1",
    kind: "page",
    tabId: 42,
    active: true,
  })

  const call = hub.callTool("yunti_observe_page", {
    browserSessionId: "yunti-page-42-controller",
    userId: "u1",
  }, 1000)
  const event = await hub.poll("controller-1", 100)

  assert.equal(event.tool, "yunti_observe_page")
  assert.equal(event.route.browserSessionId, "yunti-page-42-controller")
  assert.equal(event.route.tabId, 42)
  assert.equal(event.route.viaController, true)
  assert.equal(hub.sessions.get("yunti-page-42-controller").pollers.length, 0)

  hub.submitResult({
    browserSessionId: "controller-1",
    requestId: event.id,
    ok: true,
    result: { browserSessionId: "yunti-page-42-controller", elementCount: 1 },
  })
  assert.equal((await call).elementCount, 1)
})

test("controller recovers a legacy stale page session by embedded tab id", async () => {
  const hub = new BridgeHub()
  hub.registerSession({
    browserSessionId: "controller-1",
    userId: "u1",
    kind: "browser_controller",
    tabId: null,
    liveTabIds: [77],
    capabilities: { singleControllerTransport: true },
  })

  const call = hub.callTool("yunti_observe_page", {
    browserSessionId: "yunti-77-expired-random-id",
    userId: "u1",
  }, 1000)
  const event = await hub.poll("controller-1", 100)

  assert.equal(event.route.tabId, 77)
  assert.equal(event.route.recoveredStaleRoute, true)
  hub.submitResult({
    browserSessionId: "controller-1",
    requestId: event.id,
    ok: true,
    result: { recovered: true },
  })
  assert.equal((await call).recovered, true)
})

test("target inventory ignores a stale explicit page route when controller is online", async () => {
  const hub = new BridgeHub()
  hub.registerSession({
    browserSessionId: "controller-1",
    userId: "u1",
    kind: "browser_controller",
    tabId: null,
  })

  const call = hub.callTool("yunti_list_browser_targets", {
    browserSessionId: "expired-page-without-parseable-tab",
    userId: "u1",
  }, 1000)
  const event = await hub.poll("controller-1", 100)
  assert.equal(event.route.recoveredStaleRoute, true)
  assert.equal(event.route.browserSessionId, "controller-1")
  hub.submitResult({
    browserSessionId: "controller-1",
    requestId: event.id,
    ok: true,
    result: { targets: [] },
  })
  assert.deepEqual(await call, { targets: [] })
})

test("controller routes a page tool to the active tab when no page session exists", async () => {
  const hub = new BridgeHub()
  hub.registerSession({
    browserSessionId: "controller-1",
    userId: "u1",
    kind: "browser_controller",
    tabId: null,
    liveTabIds: [9],
    capabilities: { singleControllerTransport: true },
  })

  const call = hub.callTool("yunti_observe_page", { userId: "u1" }, 1000)
  const event = await hub.poll("controller-1", 100)
  assert.equal(event.route.tabId, null)
  assert.equal(event.route.viaController, true)
  hub.submitResult({
    browserSessionId: "controller-1",
    requestId: event.id,
    ok: true,
    result: { browserSessionId: "fresh-page" },
  })
  assert.equal((await call).browserSessionId, "fresh-page")
})

test("one controller heartbeat keeps many live page metadata sessions without page pollers", () => {
  const hub = new BridgeHub({ sessionTtlMs: 5000 })
  for (let tabId = 1; tabId <= 30; tabId += 1) {
    hub.registerSession({
      browserSessionId: `yunti-page-${tabId}-controller`,
      userId: "u1",
      kind: "page",
      tabId,
    })
  }
  hub.registerSession({
    browserSessionId: "controller-1",
    userId: "u1",
    kind: "browser_controller",
    tabId: null,
    liveTabIds: Array.from({ length: 30 }, (_, index) => index + 1),
    capabilities: { singleControllerTransport: true },
  })

  const future = Date.now() + 10_000
  assert.equal(hub.refreshPageSessionsForUser("u1", future, Array.from({ length: 30 }, (_, index) => index + 1)), 30)
  hub.cleanupExpiredSessions(future + 4000)
  const pages = hub.listSessions({ userId: "u1" }).filter((session) => session.kind !== "browser_controller")
  assert.equal(pages.length, 30)
  assert.ok(pages.every((session) => session.pollers === 0))
})

test("controller inventory removes closed tabs and fresh page registration replaces old tab route", () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "old-page", userId: "u1", kind: "page", tabId: 5 })
  hub.registerSession({ browserSessionId: "fresh-page", userId: "u1", kind: "page", tabId: 5 })
  assert.equal(hub.sessions.has("old-page"), false)
  assert.equal(hub.sessions.has("fresh-page"), true)

  hub.registerSession({
    browserSessionId: "controller-1",
    userId: "u1",
    kind: "browser_controller",
    tabId: null,
    liveTabIds: [],
    capabilities: { singleControllerTransport: true },
  })
  assert.equal(hub.sessions.has("fresh-page"), false)
})

test("fresh controller registration replaces only the same browser instance", () => {
  const hub = new BridgeHub()
  hub.registerSession({
    browserSessionId: "controller-old",
    browserInstanceId: "chrome-profile-1",
    userId: "u1",
    kind: "browser_controller",
  })
  hub.registerSession({
    browserSessionId: "controller-new",
    browserInstanceId: "chrome-profile-1",
    userId: "u1",
    kind: "browser_controller",
  })

  assert.equal(hub.sessions.has("controller-old"), false)
  assert.equal(hub.sessions.has("controller-new"), true)
  assert.equal(hub.health({ userId: "u1" }).controllerCount, 1)
  assert.equal(hub.health({ userId: "u1" }).browserControllerSessionId, "controller-new")
})

test("Chrome and Edge controllers coexist and route their own page sessions", async () => {
  const hub = new BridgeHub()
  for (const [browserSessionId, browserInstanceId, family] of [
    ["controller-chrome", "chrome-profile-1", "chrome"],
    ["controller-edge", "edge-profile-1", "edge"],
  ]) {
    hub.registerSession({
      browserSessionId,
      browserInstanceId,
      userId: "u1",
      kind: "browser_controller",
      liveTabIds: [7],
      client: { family },
      capabilities: { singleControllerTransport: true },
    })
    hub.registerSession({
      browserSessionId: `yunti-page-7-${browserInstanceId}`,
      browserControllerSessionId: browserSessionId,
      browserInstanceId,
      userId: "u1",
      kind: "page",
      tabId: 7,
      client: { family },
    })
  }

  const health = hub.health({ userId: "u1" })
  assert.equal(health.controllerCount, 2)
  assert.equal(health.pageSessionCount, 2)
  assert.deepEqual(
    new Set(health.browserControllerSessionIds),
    new Set(["controller-chrome", "controller-edge"])
  )

  const call = hub.callTool("yunti_observe_page", {
    browserSessionId: "yunti-page-7-chrome-profile-1",
    userId: "u1",
  }, 1000)
  const event = await hub.poll("controller-chrome", 100)
  assert.equal(event.route.browserSessionId, "yunti-page-7-chrome-profile-1")
  hub.submitResult({
    browserSessionId: "controller-chrome",
    requestId: event.id,
    ok: true,
    result: { browserFamily: "chrome" },
  })
  assert.equal((await call).browserFamily, "chrome")
  assert.equal(hub.sessions.get("controller-edge").queue.length, 0)

  const inventoryCall = hub.callTool("yunti_list_browser_targets", { userId: "u1" }, 1000)
  const [chromeInventoryEvent, edgeInventoryEvent] = await Promise.all([
    hub.poll("controller-chrome", 100),
    hub.poll("controller-edge", 100),
  ])
  hub.submitResult({
    browserSessionId: "controller-chrome",
    requestId: chromeInventoryEvent.id,
    ok: true,
    result: {
      pages: [{ tabId: 7, title: "Chrome page" }],
      targets: [{ targetId: "tab-7", tabId: 7, type: "page" }],
    },
  })
  hub.submitResult({
    browserSessionId: "controller-edge",
    requestId: edgeInventoryEvent.id,
    ok: true,
    result: {
      pages: [{ tabId: 7, title: "Edge page" }],
      targets: [{ targetId: "tab-7", tabId: 7, type: "page" }],
    },
  })
  const inventory = await inventoryCall
  assert.equal(inventory.multiBrowser, true)
  assert.equal(inventory.browserCount, 2)
  assert.equal(inventory.pages.length, 2)
  assert.deepEqual(
    new Set(inventory.pages.map((page) => page.browserFamily)),
    new Set(["chrome", "edge"])
  )

  hub.registerSession({
    browserSessionId: "controller-chrome",
    browserInstanceId: "chrome-profile-1",
    userId: "u1",
    kind: "browser_controller",
    liveTabIds: [],
    client: { family: "chrome" },
    capabilities: { singleControllerTransport: true },
  })
  assert.equal(hub.sessions.has("yunti-page-7-chrome-profile-1"), false)
  assert.equal(hub.sessions.has("yunti-page-7-edge-profile-1"), true)
})

test("protocol mismatch fails before a browser request is queued", async () => {
  const hub = new BridgeHub({
    expectedExtensionVersion: PACKAGE_VERSION,
    expectedProtocolVersion: CURRENT_EXTENSION_PROTOCOL_VERSION,
  })
  hub.registerSession({
    browserSessionId: "controller-old",
    browserInstanceId: "chrome-profile-old",
    userId: "u1",
    kind: "browser_controller",
    client: { family: "chrome", extensionVersion: "0.2.2" },
    capabilities: { singleControllerTransport: true },
  })

  assert.equal(hub.health({ userId: "u1" }).compatibility.ok, false)
  await assert.rejects(
    hub.callTool("yunti_list_browser_targets", { userId: "u1" }, 1000),
    /YUNTI_EXTENSION_PROTOCOL_MISMATCH.*retryBudget=0/
  )
  assert.equal(hub.sessions.get("controller-old").queue.length, 0)

  const response = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 25,
    method: "tools/call",
    params: { name: "yunti_list_browser_targets", arguments: { userId: "u1" } },
  }, { mode: "owner", hub })
  assert.equal(response.result.isError, true)
  assert.equal(
    response.result.structuredContent.code,
    "YUNTI_EXTENSION_PROTOCOL_MISMATCH"
  )
  assert.equal(response.result.structuredContent.retryable, false)
  assert.equal(response.result.structuredContent.retryBudget, 0)
})

test("proxy MCP fails fast when an older bridge still owns the port", async () => {
  const oldBridge = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({
      ok: true,
      runtime: { version: "0.2.4", expectedExtensionVersion: "0.2.4" },
    }))
  })
  await new Promise((resolve) => oldBridge.listen(0, "127.0.0.1", resolve))
  const port = oldBridge.address().port
  try {
    const response = await handleJsonRpc({
      jsonrpc: "2.0",
      id: 26,
      method: "tools/call",
      params: { name: "yunti_list_browser_targets", arguments: { userId: "u1" } },
    }, { mode: "proxy", port, bridgeToken: "" })
    assert.equal(response.result.isError, true)
    assert.equal(
      response.result.structuredContent.code,
      "YUNTI_BRIDGE_RUNTIME_MISMATCH"
    )
    assert.equal(response.result.structuredContent.retryable, false)
    assert.equal(response.result.structuredContent.retryBudget, 0)
  } finally {
    await new Promise((resolve) => oldBridge.close(resolve))
  }
})

test("browser controller heartbeat does not replace the active page route", async () => {
  const hub = new BridgeHub()
  hub.registerSession({
    browserSessionId: "controller-1",
    userId: "u1",
    kind: "browser_controller",
    tabId: null,
  })
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", tabId: 1 })
  hub.registerSession({
    browserSessionId: "controller-1",
    userId: "u1",
    kind: "browser_controller",
    tabId: null,
  })

  const health = hub.health({ userId: "u1" })
  assert.equal(health.activeSessionId, "tab-1")
  assert.equal(health.browserControllerSessionId, "controller-1")

  const call = hub.callTool("yunti_get_page_snapshot", { userId: "u1" }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_get_page_snapshot")
  hub.submitResult({
    browserSessionId: "tab-1",
    requestId: event.id,
    ok: true,
    result: { browserSessionId: "tab-1" },
  })
  assert.equal((await call).browserSessionId, "tab-1")
})

test("list targets can recover route after another fresh session registers", async () => {
  const hub = new BridgeHub({ sessionTtlMs: 10 })
  hub.registerSession({ browserSessionId: "stale-tab", userId: "u1" })
  hub.cleanupExpiredSessions(Date.now() + 6000)
  hub.registerSession({ browserSessionId: "fresh-tab", userId: "u1" })

  const call = hub.callTool("yunti_list_browser_targets", { userId: "u1" }, 1000)
  const event = await hub.poll("fresh-tab", 100)

  assert.equal(event.tool, "yunti_list_browser_targets")
  hub.submitResult({
    browserSessionId: "fresh-tab",
    requestId: event.id,
    ok: true,
    result: {
      browserSessionId: "fresh-tab",
      targets: [{ targetId: "tab-10", type: "page", tabId: 10 }],
      total: 1,
    },
  })
  assert.equal((await call).browserSessionId, "fresh-tab")
})

test("bridge rejects calls when no browser session is active", async () => {
  const hub = new BridgeHub()
  await assert.rejects(
    hub.callTool("yunti_get_page_snapshot", {}, 10),
    /userId is required/
  )
})

test("bridge routes default tool calls by user id when multiple users are connected", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "u1-tab", userId: "u1" })
  hub.registerSession({ browserSessionId: "u2-tab", userId: "u2" })

  await assert.rejects(
    hub.callTool("yunti_get_page_snapshot", {}, 10),
    /userId is required/
  )

  const call = hub.callTool("yunti_get_page_snapshot", { userId: "u1" }, 1000)
  const event = await hub.poll("u1-tab", 100)

  assert.equal(event.type, "tool_request")
  assert.equal(event.tool, "yunti_get_page_snapshot")
  assert.equal(event.arguments.userId, undefined)

  hub.submitResult({
    browserSessionId: "u1-tab",
    requestId: event.id,
    ok: true,
    result: { user: "u1" },
  })

  assert.deepEqual(await call, { user: "u1" })
})

test("bridge rejects explicit browser session ids owned by another user", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "u1-tab", userId: "u1" })
  hub.registerSession({ browserSessionId: "u2-tab", userId: "u2" })

  await assert.rejects(
    hub.callTool(
      "yunti_get_page_snapshot",
      { browserSessionId: "u2-tab", userId: "u1" },
      10
    ),
    /not owned by userId/
  )
})

test("mcp tools/list exposes Yunti tools", async () => {
  const response = await handleJsonRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {
    mode: "owner",
    hub: new BridgeHub(),
  })
  assert.equal(response.result.tools.length, TOOLS.length)
  assert.ok(response.result.tools.some((tool) => tool.name === "yunti_fetch_with_cookie"))
  assert.ok(response.result.tools.some((tool) => tool.name === "yunti_get_network_log"))
  assert.ok(response.result.tools.some((tool) => tool.name === "yunti_cdp_send_command"))
  assert.ok(response.result.tools.some((tool) => tool.name === "yunti_list_browser_targets"))
  assert.ok(response.result.tools.some((tool) => tool.name === "yunti_get_browser_target"))
  assert.ok(response.result.tools.some((tool) => tool.name === "yunti_get_cdp_events"))
  assert.ok(response.result.tools.some((tool) => tool.name === "yunti_remember_learning"))
  assert.ok(response.result.tools.some((tool) => tool.name === "yunti_get_tool_usage_hints"))
  const remember = response.result.tools.find((tool) => tool.name === "yunti_remember_learning")
  const getMemory = response.result.tools.find((tool) => tool.name === "yunti_get_learning_memory")
  const forgetMemory = response.result.tools.find((tool) => tool.name === "yunti_forget_learning_memory")
  assert.equal(remember.inputSchema.properties.userId.type, "string")
  assert.equal(Boolean(remember.inputSchema.required?.includes("userId")), false)
  assert.equal(Boolean(getMemory.inputSchema.required?.includes("userId")), false)
  assert.equal(Boolean(forgetMemory.inputSchema.required?.includes("userId")), false)
})

test("yunti-browser-runtime keeps the complete core tool surface", async () => {
  const requiredTools = [
    "yunti_get_tool_usage_hints",
    "yunti_observe_page",
    "yunti_find_elements",
    "yunti_get_page_snapshot",
    "yunti_get_selected_context",
    "yunti_fetch_with_cookie",
    "yunti_get_network_log",
    "yunti_clear_network_log",
    "yunti_clear_network_requests",
    "yunti_list_network_requests",
    "yunti_get_network_request",
    "yunti_remember_learning",
    "yunti_get_learning_memory",
    "yunti_forget_learning_memory",
    "yunti_apply_preview_patch",
    "yunti_rollback_preview_patch",
    "yunti_capture_visible_tab",
    "yunti_click_at",
    "yunti_type_text",
    "yunti_press_key",
    "yunti_scroll",
    "yunti_drag",
    "yunti_upload_file",
    "yunti_click",
    "yunti_hover",
    "yunti_fill",
    "yunti_select",
    "yunti_fill_form",
    "yunti_wait_for",
    "yunti_list_console_messages",
    "yunti_get_console_message",
    "yunti_clear_console_messages",
    "yunti_list_browser_targets",
    "yunti_get_browser_target",
    "yunti_cdp_send_command",
    "yunti_cdp_detach",
    "yunti_get_cdp_events",
    "yunti_clear_cdp_events",
    "yunti_list_pages",
    "yunti_select_page",
    "yunti_navigate_page",
    "yunti_take_screenshot",
    "yunti_evaluate_script",
    "yunti_take_snapshot",
    "yunti_handle_dialog",
    "yunti_resize_page",
    "yunti_emulate",
    "yunti_performance_start_trace",
    "yunti_performance_stop_trace",
    "yunti_new_page",
    "yunti_close_page",
    "yunti_request_user_confirmation",
  ]
  const response = await handleJsonRpc(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { mode: "owner", hub: new BridgeHub() }
  )
  const names = response.result.tools.map((tool) => tool.name)

  assert.equal(names.length, TOOLS.length)
  assert.equal(new Set(names).size, names.length)
  for (const name of requiredTools) {
    assert.ok(names.includes(name), `${name} should remain exposed`)
  }
})

test("single MCP entry keeps low-level browser tools inside yunti-browser-runtime", async () => {
  const response = await handleJsonRpc(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { mode: "owner", hub: new BridgeHub() }
  )
  const names = response.result.tools.map((tool) => tool.name)

  assert.ok(names.includes("yunti_cdp_send_command"))
  assert.ok(names.includes("yunti_list_browser_targets"))
  assert.ok(names.includes("yunti_fetch_with_cookie"))
  assert.ok(names.includes("yunti_request_user_confirmation"))
})

test("browser target inventory routes through the selected browser session", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  hub.registerSession({ browserSessionId: "tab-2", userId: "u1" })

  const call = hub.callTool(
    "yunti_list_browser_targets",
    { browserSessionId: "tab-1", userId: "u1" },
    1000
  )
  const event = await hub.poll("tab-1", 100)

  assert.equal(event.type, "tool_request")
  assert.equal(event.tool, "yunti_list_browser_targets")
  assert.equal(event.arguments.browserSessionId, undefined)
  assert.equal(event.arguments.userId, undefined)

  hub.submitResult({
    browserSessionId: "tab-1",
    requestId: event.id,
    ok: true,
    result: {
      targets: [{ targetId: "tab-10", type: "page", tabId: 10 }],
      total: 1,
    },
  })

  assert.deepEqual(await call, {
    targets: [{ targetId: "tab-10", type: "page", tabId: 10 }],
    total: 1,
  })
})

test("yunti_list_pages uses the live browser target inventory route", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })

  const call = hub.callTool(
    "yunti_list_pages",
    { browserSessionId: "tab-1", userId: "u1" },
    1000
  )
  const event = await hub.poll("tab-1", 100)

  assert.equal(event.type, "tool_request")
  assert.equal(event.tool, "yunti_list_pages")
  assert.equal(event.arguments.browserSessionId, undefined)
  assert.equal(event.arguments.userId, undefined)

  hub.submitResult({
    browserSessionId: "tab-1",
    requestId: event.id,
    ok: true,
    result: {
      pages: [{ browserSessionId: "tab-1", targetId: "tab-10", tabId: 10 }],
      targets: [{ targetId: "tab-10", type: "page", tabId: 10 }],
      total: 1,
    },
  })

  assert.deepEqual(await call, {
    pages: [{ browserSessionId: "tab-1", targetId: "tab-10", tabId: 10 }],
    targets: [{ targetId: "tab-10", type: "page", tabId: 10 }],
    total: 1,
  })
})

test("browser target detail routes through the selected browser session", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })

  const call = hub.callTool(
    "yunti_get_browser_target",
    { browserSessionId: "tab-1", userId: "u1", targetId: "tab-10" },
    1000
  )
  const event = await hub.poll("tab-1", 100)

  assert.equal(event.type, "tool_request")
  assert.equal(event.tool, "yunti_get_browser_target")
  assert.equal(event.arguments.browserSessionId, undefined)
  assert.equal(event.arguments.userId, undefined)
  assert.equal(event.arguments.targetId, "tab-10")

  hub.submitResult({
    browserSessionId: "tab-1",
    requestId: event.id,
    ok: true,
    result: {
      target: { targetId: "tab-10", type: "page", tabId: 10 },
    },
  })

  assert.deepEqual(await call, {
    target: { targetId: "tab-10", type: "page", tabId: 10 },
  })
})

test("cdp command can target an unregistered browser tab through the user's session", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "u1-session", userId: "u1" })

  const call = hub.callTool(
    "yunti_cdp_send_command",
    {
      userId: "u1",
      tabId: 99,
      method: "Runtime.evaluate",
      params: { expression: "document.title", returnByValue: true },
    },
    1000
  )
  const event = await hub.poll("u1-session", 100)

  assert.equal(event.type, "tool_request")
  assert.equal(event.tool, "yunti_cdp_send_command")
  assert.equal(event.arguments.userId, undefined)
  assert.equal(event.arguments.browserSessionId, undefined)
  assert.equal(event.arguments.tabId, 99)
  assert.equal(event.arguments.method, "Runtime.evaluate")

  hub.submitResult({
    browserSessionId: "u1-session",
    requestId: event.id,
    ok: true,
    result: { tabId: 99, result: { result: { value: "Target tab" } } },
  })

  assert.deepEqual(await call, {
    tabId: 99,
    result: { result: { value: "Target tab" } },
  })
})

test("mcp entry injects the default local browser user scope", async () => {
  const response = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "yunti_list_pages",
      arguments: {},
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(response.result.isError, true)
  assert.match(response.result.content[0].text, /No Yunti browser route is connected for userId: local/)
})

test("mcp usage hints can be called without browser user scope", async () => {
  const response = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { tool: "yunti_close_page" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(response.result.isError, undefined)
  const payload = JSON.parse(response.result.content[0].text)
  assert.equal(payload.tools.yunti_close_page.schema.required.includes("browserSessionId"), true)
  assert.match(payload.tools.yunti_close_page.commonMistakes.join("\n"), /tabId/)
})

test("mcp usage hints include P3.2 parameter guidance for fill and CDP", async () => {
  const fillResponse = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { tool: "yunti_fill" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(fillResponse.result.isError, undefined)
  const fillPayload = JSON.parse(fillResponse.result.content[0].text)
  assert.equal(fillPayload.version, "2026-07-22")
  assert.equal(fillPayload.tools.yunti_fill.schema.required.includes("value"), true)
  assert.match(fillPayload.tools.yunti_fill.notes.join("\n"), /Coordinate-only fill is not supported/)

  const cdpResponse = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { tool: "yunti_cdp_send_command" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(cdpResponse.result.isError, undefined)
  const cdpPayload = JSON.parse(cdpResponse.result.content[0].text)
  assert.match(cdpPayload.tools.yunti_cdp_send_command.commonMistakes.join("\n"), /params must be an object/)
  assert.match(cdpPayload.tools.yunti_cdp_send_command.commonMistakes.join("\n"), /Target.closeTarget/)
})

test("mcp usage hints document wait_for structured timeout recovery", async () => {
  const response = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { tool: "yunti_wait_for" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(response.result.isError, undefined)
  const payload = JSON.parse(response.result.content[0].text)
  assert.match(payload.tools.yunti_wait_for.notes.join("\n"), /WAIT_TIMEOUT/)
  assert.match(payload.tools.yunti_wait_for.recovery.join("\n"), /observe the current page/)
  assert.match(payload.tools.yunti_wait_for.commonMistakes.join("\n"), /reuse old uids/)
})

test("mcp usage hints document select uid value and text paths", async () => {
  const response = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { tool: "yunti_select" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(response.result.isError, undefined)
  const payload = JSON.parse(response.result.content[0].text)
  const selectHints = payload.tools.yunti_select

  assert.equal(selectHints.schema.anyOf.some((entry) => entry.required.join(",") === "selector,value"), true)
  assert.equal(selectHints.schema.anyOf.some((entry) => entry.required.join(",") === "uid,value"), true)
  assert.equal(selectHints.schema.anyOf.some((entry) => entry.required.join(",") === "uid,text"), true)
  assert.equal(selectHints.schema.properties.uid.type, "string")
  assert.equal(selectHints.schema.properties.text.type, "string")
  assert.match(selectHints.notes.join("\n"), /selector\/value, uid\/value, and uid\/text/)
  assert.match(selectHints.notes.join("\n"), /visible option text/)
  assert.match(selectHints.recovery.join("\n"), /available options/)
  assert.match(selectHints.commonMistakes.join("\n"), /text without uid/)
  assert.match(selectHints.commonMistakes.join("\n"), /selector\/value compatibility/)
})

test("mcp usage hints include observe-first page operation guidance", async () => {
  const response = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { tool: "yunti_observe_page" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(response.result.isError, undefined)
  const payload = JSON.parse(response.result.content[0].text)
  const schema = payload.tools.yunti_observe_page.schema

  assert.ok(schema.properties.mode.enum.includes("viewport"))
  assert.ok(schema.properties.responseMode.enum.includes("full"))
  assert.ok(schema.properties.responseMode.enum.includes("delta"))
  assert.ok(schema.properties.redaction.enum.includes("balanced"))
  assert.ok(schema.properties.redaction.enum.includes("strict"))
  assert.ok(schema.properties.redaction.enum.includes("off"))
  assert.match(payload.tools.yunti_observe_page.notes.join("\n"), /fresh for the latest observation/)
  assert.match(payload.tools.yunti_observe_page.notes.join("\n"), /responseMode=delta/)
  assert.match(payload.tools.yunti_observe_page.commonMistakes.join("\n"), /permanent selectors/)
  assert.match(payload.tools.yunti_observe_page.commonMistakes.join("\n"), /responseMode=delta as a full replacement/)
})

test("mcp usage hints expose targeted find guidance", async () => {
  const response = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { tool: "yunti_find_elements" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(response.result.isError, undefined)
  const payload = JSON.parse(response.result.content[0].text)
  const schema = payload.tools.yunti_find_elements.schema
  assert.equal(schema.properties.maxResults.maximum, 50)
  assert.match(payload.tools.yunti_find_elements.notes.join("\n"), /full-page observation would be too large/)
  assert.match(payload.tools.yunti_find_elements.commonMistakes.join("\n"), /full-page verification/)
})

test("mcp usage hints treat CDP as an unrestricted first-class backend", async () => {
  const focusedResponse = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { tool: "yunti_cdp_send_command" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(focusedResponse.result.isError, undefined)
  const focusedPayload = JSON.parse(focusedResponse.result.content[0].text)
  const cdpHints = focusedPayload.tools.yunti_cdp_send_command
  assert.match(cdpHints.purpose, /first-class browser backend/)
  assert.match(cdpHints.commonMistakes.join("\n"), /Do not avoid CDP merely because Chrome may show a debugger banner/)
  assert.match(cdpHints.commonMistakes.join("\n"), /verify page state before replaying/)

  const workflowResponse = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { topic: "workflow" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(workflowResponse.result.isError, undefined)
  const workflowPayload = JSON.parse(workflowResponse.result.content[0].text)
  assert.match(workflowPayload.coreRules.join("\n"), /CDP is not a restricted fallback/)
  assert.match(workflowPayload.coreRules.join("\n"), /Use CDP proactively/)
  assert.match(workflowPayload.workflows.defaultPageOperation.join("\n"), /switch to CDP freely/)
  assert.match(workflowPayload.workflows.actionRecovery.join("\n"), /CDP does not require extra user confirmation by itself/)
  assert.match(workflowPayload.workflows.copyableAgentPrompt.join("\n"), /complementary first-class backends/)
})

test("mcp usage hints document raw CDP and screenshot safety boundaries", async () => {
  const cdpResponse = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { tool: "yunti_get_cdp_events" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(cdpResponse.result.isError, undefined)
  const cdpPayload = JSON.parse(cdpResponse.result.content[0].text)
  const cdpHints = cdpPayload.tools.yunti_get_cdp_events
  assert.match(cdpHints.notes.join("\n"), /intentionally returns raw CDP event payloads/)
  assert.match(cdpHints.notes.join("\n"), /Clear raw CDP events/)
  assert.match(cdpHints.recovery.join("\n"), /yunti_clear_cdp_events/)
  assert.match(cdpHints.commonMistakes.join("\n"), /Do not copy raw CDP params/)

  const screenshotResponse = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { tool: "yunti_take_screenshot" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(screenshotResponse.result.isError, undefined)
  const screenshotPayload = JSON.parse(screenshotResponse.result.content[0].text)
  const screenshotHints = screenshotPayload.tools.yunti_take_screenshot
  assert.match(screenshotHints.notes.join("\n"), /real visible pixels/)
  assert.match(screenshotHints.notes.join("\n"), /redaction=strict first/)
  assert.match(screenshotHints.commonMistakes.join("\n"), /DOM redaction/)
  assert.match(screenshotHints.commonMistakes.join("\n"), /default data extraction path/)
})

test("mcp usage hints include action recovery guidance", async () => {
  const clickResponse = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { tool: "yunti_click" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(clickResponse.result.isError, undefined)
  const clickPayload = JSON.parse(clickResponse.result.content[0].text)
  assert.match(clickPayload.tools.yunti_click.notes.join("\n"), /observe again/)
  assert.match(clickPayload.tools.yunti_click.recovery.join("\n"), /Stale or missing uid/)
  assert.match(clickPayload.tools.yunti_click.recovery.join("\n"), /yunti_scroll/)
  assert.match(clickPayload.tools.yunti_click.commonMistakes.join("\n"), /successful dispatch/)

  const fillResponse = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { tool: "yunti_fill" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(fillResponse.result.isError, undefined)
  const fillPayload = JSON.parse(fillResponse.result.content[0].text)
  assert.match(fillPayload.tools.yunti_fill.notes.join("\n"), /verify through yunti_observe_page/)
  assert.match(fillPayload.tools.yunti_fill.recovery.join("\n"), /fresh editable uid/)
  assert.match(fillPayload.tools.yunti_fill.recovery.join("\n"), /contenteditable/)
  assert.match(fillPayload.tools.yunti_fill.recovery.join("\n"), /yunti_wait_for/)

  const scrollResponse = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { tool: "yunti_scroll" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(scrollResponse.result.isError, undefined)
  const scrollPayload = JSON.parse(scrollResponse.result.content[0].text)
  assert.match(scrollPayload.tools.yunti_scroll.notes.join("\n"), /scrollable container uid/)
  assert.match(scrollPayload.tools.yunti_scroll.notes.join("\n"), /scrollTarget/)
  assert.match(scrollPayload.tools.yunti_scroll.notes.join("\n"), /NO_SCROLL_MOVEMENT/)
  assert.match(scrollPayload.tools.yunti_scroll.notes.join("\n"), /possible-bottom-edge/)
  assert.match(scrollPayload.tools.yunti_scroll.notes.join("\n"), /recoveryHint/)
  assert.match(scrollPayload.tools.yunti_scroll.recovery.join("\n"), /fresh scrollable container uid/)
  assert.match(scrollPayload.tools.yunti_scroll.recovery.join("\n"), /edgeHint/)
  assert.match(scrollPayload.tools.yunti_scroll.recovery.join("\n"), /recoveryHint/)
  assert.match(scrollPayload.tools.yunti_scroll.recovery.join("\n"), /yunti_wait_for/)
  assert.match(scrollPayload.tools.yunti_scroll.commonMistakes.join("\n"), /moved=false/)
  assert.match(scrollPayload.tools.yunti_scroll.commonMistakes.join("\n"), /edgeHint/)
  assert.match(scrollPayload.tools.yunti_scroll.commonMistakes.join("\n"), /recoveryHint/)

  const workflowResponse = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: {},
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(workflowResponse.result.isError, undefined)
  const workflowPayload = JSON.parse(workflowResponse.result.content[0].text)
  assert.match(workflowPayload.workflows.actionRecovery.join("\n"), /observe -> act by fresh uid -> observe\/verify/)
  assert.match(workflowPayload.workflows.actionRecovery.join("\n"), /yunti_wait_for/)
  assert.match(workflowPayload.workflows.actionRecovery.join("\n"), /fresh uid/)
  assert.match(workflowPayload.workflows.actionRecovery.join("\n"), /blind retries/)
  assert.match(workflowPayload.workflows.actionRecovery.join("\n"), /coordinate fallbacks/)
})

test("mcp usage hints expose default agent workflow contract", async () => {
  const response = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { topic: "workflow" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(response.result.isError, undefined)
  const payload = JSON.parse(response.result.content[0].text)
  const defaultWorkflow = payload.workflows.defaultPageOperation.join("\n")
  const confirmationBoundary = payload.workflows.confirmationBoundary.join("\n")
  const copyablePrompt = payload.workflows.copyableAgentPrompt.join("\n")

  assert.deepEqual(Object.keys(payload.tools), [
    "yunti_get_tool_usage_hints",
    "yunti_list_browser_targets",
    "yunti_observe_page",
    "yunti_find_elements",
    "yunti_wait_for",
  ])
  assert.match(defaultWorkflow, /yunti_list_browser_targets/)
  assert.match(defaultWorkflow, /yunti_observe_page/)
  assert.match(defaultWorkflow, /yunti_find_elements/)
  assert.match(defaultWorkflow, /fresh uid/)
  assert.match(defaultWorkflow, /yunti_wait_for/)
  assert.match(defaultWorkflow, /recoveryHint/)
  assert.match(confirmationBoundary, /submitting forms/)
  assert.match(confirmationBoundary, /uploading sensitive files/)
  assert.match(confirmationBoundary, /secrets/)
  assert.match(copyablePrompt, /Please operate my browser through Yunti Browser Runtime/)
  assert.match(copyablePrompt, /Ask me before submitting/)
})

test("mcp usage hints expose minimal browser workflow use cases", async () => {
  const response = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: { topic: "workflow" },
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(response.result.isError, undefined)
  const payload = JSON.parse(response.result.content[0].text)
  const useCases = payload.workflows.minimalUseCases

  assert.deepEqual(Object.keys(useCases), [
    "clickByUid",
    "fillForm",
    "scrollToFind",
    "switchTab",
    "waitForAsyncResult",
    "findTargetedElement",
  ])
  assert.match(useCases.findTargetedElement.join("\n"), /yunti_find_elements/)
  assert.match(useCases.findTargetedElement.join("\n"), /fall back to yunti_observe_page/)
  assert.match(useCases.clickByUid.join("\n"), /fresh observation/)
  assert.match(useCases.clickByUid.join("\n"), /yunti_click/)
  assert.match(useCases.fillForm.join("\n"), /fillable/)
  assert.match(useCases.fillForm.join("\n"), /yunti_select/)
  assert.match(useCases.scrollToFind.join("\n"), /scrollableContainers/)
  assert.match(useCases.scrollToFind.join("\n"), /partialMovement/)
  assert.match(useCases.switchTab.join("\n"), /yunti_select_page/)
  assert.match(useCases.switchTab.join("\n"), /Target.activateTarget/)
  assert.match(useCases.waitForAsyncResult.join("\n"), /WAIT_TIMEOUT/)
  assert.match(useCases.waitForAsyncResult.join("\n"), /pre-wait uids/)
})

test("mcp usage hints document action result contract", async () => {
  const response = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "yunti_get_tool_usage_hints",
      arguments: {},
    },
  }, { mode: "owner", hub: new BridgeHub() })

  assert.equal(response.result.isError, undefined)
  const payload = JSON.parse(response.result.content[0].text)
  const contract = payload.workflows.actionResultContract.join("\n")

  assert.match(contract, /compatibility-shaped/)
  assert.match(contract, /clicked, hovered, filled, scrolled/)
  assert.match(contract, /action, browserSessionId, target, ok, code, recoverable, nextStepHint/)
  assert.match(contract, /Do not remove existing success booleans/)
  assert.match(contract, /verify page state/)

  assert.match(payload.tools.yunti_click.notes.join("\n"), /Current results are compatibility-shaped/)
  assert.match(payload.tools.yunti_click.notes.join("\n"), /P6\.2 will converge action outputs/)
  assert.match(payload.tools.yunti_fill.notes.join("\n"), /value\/valueLength/)
})

test("bridge stores sanitized network observations", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://shop.example.test/" })

  const stored = hub.recordNetworkEvent({
    browserSessionId: "tab-1",
    requestId: "req-1",
    url: "https://shop.example.test/api/search?token=abc&keyword=test",
    method: "POST",
    statusCode: 200,
    ok: true,
    requestBody: {
      kind: "formData",
      fieldNames: ["password", "keyword"],
      formData: { password: "secret", keyword: "needle" },
    },
  })

  assert.equal(stored.accepted, true)
  const log = hub.listNetworkEvents({ browserSessionId: "tab-1", userId: "u1" })
  assert.equal(log.returned, 1)
  assert.match(log.events[0].url, /token=%5BREDACTED%5D/)
  assert.equal(log.events[0].requestBody.formData.password, "[REDACTED]")
  assert.equal(log.events[0].requestBody.formData.keyword, "needle")
})

test("bridge stores raw CDP events separately from sanitized network observations", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://shop.example.test/" })

  const stored = hub.recordCdpEvent({
    browserSessionId: "tab-1",
    tabId: 123,
    method: "Runtime.consoleAPICalled",
    params: { type: "log", args: [{ value: "hello" }] },
    receivedAt: "2026-06-22T00:00:00.000Z",
  })

  assert.equal(stored.accepted, true)
  const log = hub.listCdpEvents({ browserSessionId: "tab-1", userId: "u1" })
  assert.equal(log.returned, 1)
  assert.equal(log.events[0].method, "Runtime.consoleAPICalled")
  assert.deepEqual(log.events[0].params, {
    type: "log",
    args: [{ value: "hello" }],
  })
  assert.equal(log.events[0].capturedBy, "extension.chrome.debugger")

  const cleared = hub.clearCdpEvents({ browserSessionId: "tab-1", userId: "u1" })
  assert.equal(cleared.deleted, 1)
  assert.equal(hub.listCdpEvents({ browserSessionId: "tab-1", userId: "u1" }).returned, 0)
})

test("learning memory can be written and searched", async (t) => {
  const previousHome = process.env.YUNTI_HOME
  const previousDataDir = process.env.YUNTI_BROWSER_DATA_DIR
  const tempDir = await import("node:fs/promises").then((fs) =>
    fs.mkdtemp(join(tmpdir(), "yunti-browser-runtime-test-"))
  )
  t.after(() => rm(tempDir, { recursive: true, force: true }))
  process.env.YUNTI_HOME = tempDir
  delete process.env.YUNTI_BROWSER_DATA_DIR
  try {
    const remember = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "yunti_remember_learning",
          arguments: {
            userId: "u1",
            kind: "api",
            title: "Search endpoint",
            detail: "POST /api/search with keyword. token=abc should be redacted.",
            tags: ["search"],
          },
        },
      },
      { mode: "owner", hub: new BridgeHub() }
    )
    assert.equal(remember.result.isError, undefined)
    assert.equal(remember.result.structuredContent.remembered, true)

    const search = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "yunti_get_learning_memory",
          arguments: { userId: "u1", query: "search" },
        },
      },
      { mode: "owner", hub: new BridgeHub() }
    )
    assert.equal(search.result.structuredContent.returned, 1)
    assert.match(search.result.structuredContent.memories[0].detail, /token=\[REDACTED\]/)

    const otherUserSearch = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "yunti_get_learning_memory",
          arguments: { userId: "u2", query: "search" },
        },
      },
      { mode: "owner", hub: new BridgeHub() }
    )
    assert.equal(otherUserSearch.result.structuredContent.returned, 0)
  } finally {
    if (previousHome === undefined) delete process.env.YUNTI_HOME
    else process.env.YUNTI_HOME = previousHome
    if (previousDataDir === undefined) delete process.env.YUNTI_BROWSER_DATA_DIR
    else process.env.YUNTI_BROWSER_DATA_DIR = previousDataDir
  }
})

test("learning memory redacts secrets and PII-like values before storage", async (t) => {
  const previousHome = process.env.YUNTI_HOME
  const previousDataDir = process.env.YUNTI_BROWSER_DATA_DIR
  const tempDir = await import("node:fs/promises").then((fs) =>
    fs.mkdtemp(join(tmpdir(), "yunti-memory-redaction-test-"))
  )
  t.after(() => rm(tempDir, { recursive: true, force: true }))
  process.env.YUNTI_HOME = tempDir
  delete process.env.YUNTI_BROWSER_DATA_DIR
  try {
    const bearer = "Bearer abcdefghijklmnopqrstuvwxyz1234567890"
    const jwt = "eyJaaaaaaaaaaa.bbbbbbbbbbbbb.ccccccccccccc"
    const card = "4111 1111 1111 1111"
    const email = "jane.doe@example.com"
    const phone = "+1 (415) 555-1234"
    const address = "123 Market Street"
    const privateKey = "-----BEGIN PRIVATE KEY-----\\nabc123\\n-----END PRIVATE KEY-----"
    const response = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "yunti_remember_learning",
          arguments: {
            userId: "u1",
            kind: "workflow",
            title: `Login contact ${email}`,
            detail: `Use ${bearer}, jwt ${jwt}, card ${card}, phone ${phone}, address ${address}, ${privateKey}`,
            source: `https://example.test/callback?token=secret-value&email=${email}`,
            tags: ["login", email],
          },
        },
      },
      { mode: "owner", hub: new BridgeHub() }
    )

    assert.equal(response.result.isError, undefined)
    const memory = response.result.structuredContent.memory
    const serialized = JSON.stringify(memory)
    assert.equal(serialized.includes("abcdefghijklmnopqrstuvwxyz1234567890"), false)
    assert.equal(serialized.includes(jwt), false)
    assert.equal(serialized.includes(card), false)
    assert.equal(serialized.includes(email), false)
    assert.equal(serialized.includes(phone), false)
    assert.equal(serialized.includes(address), false)
    assert.equal(serialized.includes("abc123"), false)
    assert.match(memory.detail, /Bearer \[REDACTED\]/)
    assert.match(memory.detail, /\[REDACTED_JWT\]/)
    assert.match(memory.detail, /\[REDACTED_PAYMENT_CARD\]/)
    assert.match(memory.detail, /\[REDACTED_PHONE\]/)
    assert.match(memory.detail, /\[REDACTED_ADDRESS\]/)
    assert.match(memory.title, /\[REDACTED_EMAIL\]/)
    assert.match(memory.source, /token=\[REDACTED\]/)
    assert.ok(memory.tags.includes("[REDACTED_EMAIL]"))
  } finally {
    if (previousHome === undefined) delete process.env.YUNTI_HOME
    else process.env.YUNTI_HOME = previousHome
    if (previousDataDir === undefined) delete process.env.YUNTI_BROWSER_DATA_DIR
    else process.env.YUNTI_BROWSER_DATA_DIR = previousDataDir
  }
})

test("learning memory uses the default local user scope", async (t) => {
  const previousHome = process.env.YUNTI_HOME
  const previousDataDir = process.env.YUNTI_BROWSER_DATA_DIR
  const tempDir = await import("node:fs/promises").then((fs) =>
    fs.mkdtemp(join(tmpdir(), "yunti-agent-home-test-"))
  )
  t.after(() => rm(tempDir, { recursive: true, force: true }))
  try {
    process.env.YUNTI_HOME = tempDir
    delete process.env.YUNTI_BROWSER_DATA_DIR
    const response = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "yunti_remember_learning",
          arguments: {
            title: "Local default",
            detail: "This should be written to the default local memory.",
          },
        },
      },
      { mode: "owner", hub: new BridgeHub() }
    )

    assert.equal(response.result.structuredContent.remembered, true)
    assert.match(response.result.structuredContent.memory.title, /Local default/)
  } finally {
    if (previousHome === undefined) delete process.env.YUNTI_HOME
    else process.env.YUNTI_HOME = previousHome
    if (previousDataDir === undefined) delete process.env.YUNTI_BROWSER_DATA_DIR
    else process.env.YUNTI_BROWSER_DATA_DIR = previousDataDir
  }
})

test("default learning memory lives under Yunti agent home", async (t) => {
  const previousHome = process.env.YUNTI_HOME
  const previousDataDir = process.env.YUNTI_BROWSER_DATA_DIR
  const tempDir = await import("node:fs/promises").then((fs) =>
    fs.mkdtemp(join(tmpdir(), "yunti-agent-home-test-"))
  )
  t.after(() => rm(tempDir, { recursive: true, force: true }))
  process.env.YUNTI_HOME = tempDir
  delete process.env.YUNTI_BROWSER_DATA_DIR
  try {
    const remember = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "yunti_remember_learning",
          arguments: {
            userId: "u-default",
            kind: "workflow",
            title: "Default runtime home",
            detail: "Yunti memories use the canonical runtime home by default.",
          },
        },
      },
      { mode: "owner", hub: new BridgeHub() }
    )
    assert.equal(remember.result.structuredContent.remembered, true)

    const search = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "yunti_get_learning_memory",
          arguments: { userId: "u-default", query: "runtime home" },
        },
      },
      { mode: "owner", hub: new BridgeHub() }
    )
    assert.equal(search.result.structuredContent.returned, 1)
    assert.equal(
      search.result.structuredContent.storagePath,
      join(tempDir, "users", "u-default", "memory", "learning-memory.json")
    )
  } finally {
    if (previousHome === undefined) delete process.env.YUNTI_HOME
    else process.env.YUNTI_HOME = previousHome
    if (previousDataDir === undefined) delete process.env.YUNTI_BROWSER_DATA_DIR
    else process.env.YUNTI_BROWSER_DATA_DIR = previousDataDir
  }
})

// --- Phase 1 CDP tools ---

test("yunti_select_page switches active session", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })
  hub.registerSession({ browserSessionId: "tab-2", userId: "u1", url: "https://shop.example.test/" })

  const result = hub.selectPage("tab-1", { userId: "u1" })
  assert.equal(result.browserSessionId, "tab-1")
  const health = hub.health({ userId: "u1" })
  assert.equal(health.activeSessionId, "tab-1")
})

test("yunti_select_page rejects another user's browser session", () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "u1-tab", userId: "u1", url: "https://app.example.test/" })
  hub.registerSession({ browserSessionId: "u2-tab", userId: "u2", url: "https://office.example.test/" })

  assert.throws(
    () => hub.selectPage("u2-tab", { userId: "u1" }),
    /not owned by userId/
  )
})

test("yunti_select_page rejects unknown session", () => {
  const hub = new BridgeHub()
  assert.throws(
    () => hub.selectPage("nonexistent"),
    /stale or disconnected.*yunti_list_browser_targets/
  )
})

test("bridge health and sessions do not expose other users without scope", () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "u1-tab", userId: "u1", url: "https://app.example.test/" })
  hub.registerSession({ browserSessionId: "u2-tab", userId: "u2", url: "https://office.example.test/" })

  const globalHealth = hub.health()
  assert.equal(globalHealth.sessionCount, 2)
  assert.equal(globalHealth.sessions.length, 0)
  assert.equal(globalHealth.activeSessionId, null)

  const u1Health = hub.health({ userId: "u1" })
  assert.equal(u1Health.sessions.length, 1)
  assert.equal(u1Health.sessions[0].browserSessionId, "u1-tab")
  assert.equal(u1Health.activeSessionId, "u1-tab")
})

test("yunti_navigate_page dispatches to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })

  const call = hub.callTool("yunti_navigate_page", { browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/#/new" }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.type, "tool_request")
  assert.equal(event.tool, "yunti_navigate_page")
  assert.equal(event.arguments.url, "https://app.example.test/#/new")

  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { navigated: true, url: "https://app.example.test/#/new" } })
  assert.deepEqual(await call, { navigated: true, url: "https://app.example.test/#/new" })
})

test("yunti_navigate_page supports reload and back actions", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })

  const call = hub.callTool("yunti_navigate_page", { browserSessionId: "tab-1", userId: "u1", action: "reload" }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_navigate_page")
  assert.equal(event.arguments.action, "reload")
  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { navigated: true, action: "reload" } })
  assert.deepEqual(await call, { navigated: true, action: "reload" })
})

test("yunti_take_screenshot dispatches to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })

  const call = hub.callTool("yunti_take_screenshot", { browserSessionId: "tab-1", userId: "u1" }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_take_screenshot")

  const dataUrl = "data:image/png;base64,iVBORw0KGgo="
  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { dataUrl, mimeType: "image/png", width: 1280, height: 720 } })
  assert.deepEqual(await call, { dataUrl, mimeType: "image/png", width: 1280, height: 720 })
})

test("yunti_evaluate_script dispatches to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })

  const call = hub.callTool("yunti_evaluate_script", { browserSessionId: "tab-1", userId: "u1", expression: "document.title" }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_evaluate_script")
  assert.equal(event.arguments.expression, "document.title")

  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { value: "SCM Dashboard", type: "string" } })
  assert.deepEqual(await call, { value: "SCM Dashboard", type: "string" })
})

test("yunti_take_snapshot dispatches to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })

  const call = hub.callTool("yunti_take_snapshot", { browserSessionId: "tab-1", userId: "u1" }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_take_snapshot")

  const snapshot = {
    browserSessionId: "tab-1",
    url: "https://app.example.test/",
    title: "SCM",
    elements: [
      { uid: "yunti-1", role: "button", name: "查询", rect: { x: 100, y: 50, width: 80, height: 32 } },
    ],
    elementCount: 1,
  }
  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: snapshot })
  assert.deepEqual(await call, snapshot)
})

test("yunti_observe_page dispatches to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })

  const call = hub.callTool("yunti_observe_page", {
    browserSessionId: "tab-1",
    userId: "u1",
    mode: "viewport",
    redaction: "balanced",
  }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_observe_page")
  assert.equal(event.arguments.browserSessionId, undefined)
  assert.equal(event.arguments.userId, undefined)
  assert.equal(event.arguments.mode, "viewport")
  assert.equal(event.arguments.redaction, "balanced")

  const observation = {
    observationId: "obs-1",
    browserSessionId: "tab-1",
    page: { url: "https://app.example.test/", title: "SCM" },
    elements: [{ uid: "yunti-1", role: "button", name: "查询" }],
    textTree: "[yunti-1]<button>查询</button>",
    hints: [],
  }
  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: observation })
  assert.deepEqual(await call, observation)
})

test("yunti_observe_page passes through delta mode results", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })

  const call = hub.callTool("yunti_observe_page", {
    browserSessionId: "tab-1",
    userId: "u1",
    mode: "viewport",
    responseMode: "delta",
    redaction: "balanced",
  }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_observe_page")
  assert.equal(event.arguments.responseMode, "delta")

  const observation = {
    observationId: "obs-delta-1",
    browserSessionId: "tab-1",
    responseMode: "delta",
    delta: {
      firstObservation: false,
      changedElementCount: 1,
      changedScrollableContainerCount: 0,
      changedElements: { added: [], removed: [], updated: ["button|button|Save||||20|20|120|32"] },
      changedScrollableContainers: { added: [], removed: [], updated: [] },
    },
    hints: ["Delta observation detected page changes. Run full yunti_observe_page before choosing a fresh uid for the next action."],
  }
  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: observation })
  assert.deepEqual(await call, observation)
})

test("yunti_find_elements dispatches to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })

  const call = hub.callTool("yunti_find_elements", {
    browserSessionId: "tab-1",
    userId: "u1",
    query: "save",
    role: "button",
    maxResults: 5,
  }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_find_elements")
  assert.equal(event.arguments.browserSessionId, undefined)
  assert.equal(event.arguments.userId, undefined)
  assert.equal(event.arguments.query, "save")
  assert.equal(event.arguments.role, "button")
  assert.equal(event.arguments.maxResults, 5)

  const result = {
    observationId: "find-1",
    browserSessionId: "tab-1",
    uidMapVersion: "observe-v1",
    matchCount: 1,
    matches: [{ uid: "yunti-5", role: "button", name: "Save form" }],
    hints: ["Use the returned fresh uid for click/fill/select, then verify with yunti_observe_page or evaluate."],
  }
  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result })
  assert.deepEqual(await call, result)
})

test("yunti_click dispatches uid-based click to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })

  const call = hub.callTool("yunti_click", { browserSessionId: "tab-1", userId: "u1", uid: "yunti-1" }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_click")
  assert.equal(event.arguments.uid, "yunti-1")

  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { clicked: true, uid: "yunti-1" } })
  assert.deepEqual(await call, { clicked: true, uid: "yunti-1" })
})

test("yunti_click dispatches coordinate fallback to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })

  const call = hub.callTool("yunti_click", { browserSessionId: "tab-1", userId: "u1", x: 120, y: 240 }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_click")
  assert.equal(event.arguments.x, 120)
  assert.equal(event.arguments.y, 240)

  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { clicked: true } })
  assert.deepEqual(await call, { clicked: true })
})

test("yunti_hover dispatches uid-based hover to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })

  const call = hub.callTool("yunti_hover", { browserSessionId: "tab-1", userId: "u1", uid: "yunti-2" }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_hover")
  assert.equal(event.arguments.uid, "yunti-2")

  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { hovered: true, uid: "yunti-2" } })
  assert.deepEqual(await call, { hovered: true, uid: "yunti-2" })
})

test("yunti_hover dispatches selector fallback to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })

  const call = hub.callTool("yunti_hover", { browserSessionId: "tab-1", userId: "u1", selector: ".menu" }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_hover")
  assert.equal(event.arguments.selector, ".menu")

  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { hovered: true } })
  assert.deepEqual(await call, { hovered: true })
})

test("yunti_fill dispatches uid-based fill to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })

  const call = hub.callTool("yunti_fill", { browserSessionId: "tab-1", userId: "u1", uid: "yunti-3", value: "hello" }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_fill")
  assert.equal(event.arguments.uid, "yunti-3")
  assert.equal(event.arguments.value, "hello")

  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { filled: true, uid: "yunti-3" } })
  assert.deepEqual(await call, { filled: true, uid: "yunti-3" })
})

test("yunti_fill_form dispatches batch fill to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })

  const fields = [
    { uid: "yunti-1", value: "张三" },
    { uid: "yunti-2", value: "选项A" },
  ]
  const call = hub.callTool("yunti_fill_form", { browserSessionId: "tab-1", userId: "u1", fields }, 2000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_fill_form")
  assert.equal(event.arguments.fields.length, 2)

  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { filled: 2, failed: 0 } })
  assert.deepEqual(await call, { filled: 2, failed: 0 })
})

test("yunti_wait_for dispatches to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" })

  const call = hub.callTool("yunti_wait_for", { browserSessionId: "tab-1", userId: "u1", text: "加载完成" }, 5000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_wait_for")
  assert.equal(event.arguments.text, "加载完成")

  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { found: true, text: "加载完成", waitedMs: 1200 } })
  assert.deepEqual(await call, { found: true, text: "加载完成", waitedMs: 1200 })
})

// --- Phase 2: diagnostics ---

test("console messages are cached and listable by session", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })

  hub.recordConsoleEvent({ browserSessionId: "tab-1", tabId: 1, level: "error", text: "TypeError: x is undefined", source: "console-api", url: "https://app.example.test/app.js", lineNumber: 42 })
  hub.recordConsoleEvent({ browserSessionId: "tab-1", tabId: 1, level: "info", text: "Page loaded", source: "console-api" })
  hub.registerSession({ browserSessionId: "tab-2", userId: "u2" })
  hub.recordConsoleEvent({ browserSessionId: "tab-2", tabId: 2, level: "warning", text: "deprecated", source: "console-api" })

  assert.throws(() => hub.listConsoleMessages({ allSessions: true }), /userId is required/)

  const u1All = hub.listConsoleMessages({ allSessions: true, userId: "u1" })
  assert.equal(u1All.total, 2)

  const tab1 = hub.listConsoleMessages({ browserSessionId: "tab-1", userId: "u1" })
  assert.equal(tab1.returned, 2)
  assert.equal(tab1.events[0].level, "info")
  assert.equal(tab1.events[0].text, "Page loaded")

  const errors = hub.listConsoleMessages({ browserSessionId: "tab-1", userId: "u1", level: "error" })
  assert.equal(errors.returned, 1)
  assert.equal(errors.events[0].text, "TypeError: x is undefined")
  assert.equal(errors.events[0].url, "https://app.example.test/app.js")
})

test("console diagnostics redact secrets before caching", () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  const bearer = "Bearer abcdefghijklmnopqrstuvwxyz1234567890"
  const card = "4111 1111 1111 1111"
  const email = "jane.doe@example.com"

  hub.recordConsoleEvent({
    browserSessionId: "tab-1",
    level: "error",
    text: `failed auth ${bearer} card ${card}`,
    stackTrace: `at login (${email})`,
    args: [`email=${email}`, `authorization: ${bearer}`],
    source: "console-api",
  })

  const msg = hub.listConsoleMessages({ browserSessionId: "tab-1", userId: "u1" }).events[0]
  const serialized = JSON.stringify(msg)
  assert.equal(serialized.includes("abcdefghijklmnopqrstuvwxyz1234567890"), false)
  assert.equal(serialized.includes(card), false)
  assert.equal(serialized.includes(email), false)
  assert.match(msg.text, /Bearer \[REDACTED\]/)
  assert.match(msg.text, /\[REDACTED_PAYMENT_CARD\]/)
  assert.match(msg.stackTrace, /\[REDACTED_EMAIL\]/)
  assert.deepEqual(msg.args, ["email=[REDACTED_EMAIL]", "authorization: [REDACTED]"])
})

test("allSessions diagnostics are scoped to the requested user", () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "u1-tab", userId: "u1" })
  hub.registerSession({ browserSessionId: "u2-tab", userId: "u2" })
  hub.recordNetworkEvent({
    browserSessionId: "u1-tab",
    requestId: "u1-req",
    url: "https://app.example.test/api/u1",
    method: "GET",
  })
  hub.recordNetworkEvent({
    browserSessionId: "u2-tab",
    requestId: "u2-req",
    url: "https://app.example.test/api/u2",
    method: "GET",
  })
  hub.recordCdpEvent({
    browserSessionId: "u1-tab",
    method: "Target.getTargets",
    params: { targetInfos: [{ targetId: "a" }] },
  })
  hub.recordCdpEvent({
    browserSessionId: "u2-tab",
    method: "Target.getTargets",
    params: { targetInfos: [{ targetId: "b" }] },
  })

  assert.throws(() => hub.listNetworkEvents({ allSessions: true }), /userId is required/)
  assert.deepEqual(
    hub.listNetworkEvents({ allSessions: true, userId: "u1" }).events.map(e => e.requestId),
    ["u1-req"]
  )
  assert.equal(hub.listCdpEvents({ allSessions: true, userId: "u1" }).returned, 1)
  assert.equal(hub.clearNetworkEvents({ allSessions: true, userId: "u1" }).deleted, 1)
  assert.equal(hub.listNetworkEvents({ allSessions: true, userId: "u2" }).returned, 1)
})

test("yunti_clear_network_requests clears network observations like the legacy log tool", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  hub.recordNetworkEvent({
    browserSessionId: "tab-1",
    requestId: "req-1",
    url: "https://app.example.test/api/list",
    method: "GET",
  })

  assert.equal(hub.listNetworkEvents({ browserSessionId: "tab-1", userId: "u1" }).returned, 1)
  assert.deepEqual(
    await hub.callBridgeLocalTool("yunti_clear_network_requests", {
      browserSessionId: "tab-1",
      userId: "u1",
    }),
    { deleted: 1 }
  )
  assert.equal(hub.listNetworkEvents({ browserSessionId: "tab-1", userId: "u1" }).returned, 0)
})

test("console message detail can be fetched by msgid", () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  hub.recordConsoleEvent({ browserSessionId: "tab-1", level: "error", text: "fail", stackTrace: "at foo (app.js:42)", source: "console-api" })

  const log = hub.listConsoleMessages({ browserSessionId: "tab-1", userId: "u1" })
  const msg = hub.getConsoleMessage({ browserSessionId: "tab-1", userId: "u1", msgId: log.events[0].id })
  assert.equal(msg.level, "error")
  assert.equal(msg.stackTrace, "at foo (app.js:42)")
})

test("console message detail is scoped to the selected browser session", () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  hub.registerSession({ browserSessionId: "tab-2", userId: "u1" })
  hub.recordConsoleEvent({ browserSessionId: "tab-1", level: "error", text: "fail" })

  const log = hub.listConsoleMessages({ browserSessionId: "tab-1", userId: "u1" })
  assert.throws(
    () => hub.getConsoleMessage({ browserSessionId: "tab-2", userId: "u1", msgId: log.events[0].id }),
    /console message not found/
  )
})

test("console messages can be cleared", () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  hub.recordConsoleEvent({ browserSessionId: "tab-1", level: "error", text: "boom" })
  assert.equal(hub.listConsoleMessages({ browserSessionId: "tab-1", userId: "u1" }).total, 1)
  hub.clearConsoleMessages({ browserSessionId: "tab-1", userId: "u1" })
  assert.equal(hub.listConsoleMessages({ browserSessionId: "tab-1", userId: "u1" }).total, 0)
})

test("yunti_get_network_request returns single request by id", () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  const stored = hub.recordNetworkEvent({
    browserSessionId: "tab-1",
    requestId: "req-42",
    url: "https://app.example.test/api/data",
    method: "POST",
    statusCode: 200,
    ok: true,
    durationMs: 150,
    requestBody: { kind: "formData", fieldNames: ["keyword"], formData: { keyword: "test" } },
  })

  const req = hub.getNetworkRequest({ browserSessionId: "tab-1", userId: "u1", eventId: stored.event.id })
  assert.equal(req.url, "https://app.example.test/api/data")
  assert.equal(req.method, "POST")
  assert.equal(req.statusCode, 200)
  assert.equal(req.requestId, "req-42")
  assert.equal(req.id, stored.event.id)
})

test("yunti_get_network_request throws for unknown id", () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  assert.throws(
    () => hub.getNetworkRequest({ browserSessionId: "tab-1", userId: "u1", eventId: 99999 }),
    /network request not found/
  )
})

test("yunti_get_network_request is scoped to the selected browser session", () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  hub.registerSession({ browserSessionId: "tab-2", userId: "u1" })
  const stored = hub.recordNetworkEvent({
    browserSessionId: "tab-1",
    requestId: "req-42",
    url: "https://app.example.test/api/data",
    method: "GET",
  })

  assert.throws(
    () => hub.getNetworkRequest({ browserSessionId: "tab-2", userId: "u1", eventId: stored.event.id }),
    /network request not found/
  )
})

// --- Phase 3: emulation, dialog, performance ---

test("yunti_handle_dialog dispatches to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  const call = hub.callTool("yunti_handle_dialog", { browserSessionId: "tab-1", userId: "u1", action: "accept", promptText: "yes" }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_handle_dialog")
  assert.equal(event.arguments.action, "accept")
  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { handled: true } })
  assert.deepEqual(await call, { handled: true })
})

test("yunti_resize_page dispatches to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  const call = hub.callTool("yunti_resize_page", { browserSessionId: "tab-1", userId: "u1", width: 1920, height: 1080 }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_resize_page")
  assert.equal(event.arguments.width, 1920)
  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { resized: true, width: 1920, height: 1080 } })
  assert.deepEqual(await call, { resized: true, width: 1920, height: 1080 })
})

test("yunti_emulate dispatches to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  const call = hub.callTool("yunti_emulate", { browserSessionId: "tab-1", userId: "u1", deviceName: "iPhone 12" }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_emulate")
  assert.equal(event.arguments.deviceName, "iPhone 12")
  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { emulated: true } })
  assert.deepEqual(await call, { emulated: true })
})

test("yunti_performance_start_trace dispatches to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  const call = hub.callTool("yunti_performance_start_trace", { browserSessionId: "tab-1", userId: "u1" }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_performance_start_trace")
  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { tracing: true } })
  assert.deepEqual(await call, { tracing: true })
})

test("yunti_performance_stop_trace dispatches to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  const call = hub.callTool("yunti_performance_stop_trace", { browserSessionId: "tab-1", userId: "u1" }, 5000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_performance_stop_trace")
  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { events: [], durationMs: 1000 } })
  assert.deepEqual(await call, { events: [], durationMs: 1000 })
})

test("yunti_new_page dispatches to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  const call = hub.callTool("yunti_new_page", { browserSessionId: "tab-1", userId: "u1", url: "https://app.example.test/" }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_new_page")
  assert.equal(event.arguments.url, "https://app.example.test/")
  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { created: true, browserSessionId: "new-tab-99", tabId: 99, url: "https://app.example.test/" } })
  assert.deepEqual(await call, { created: true, browserSessionId: "new-tab-99", tabId: 99, url: "https://app.example.test/" })
})

test("yunti_close_page dispatches to extension", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "tab-1", userId: "u1" })
  const call = hub.callTool("yunti_close_page", { browserSessionId: "tab-1", userId: "u1" }, 1000)
  const event = await hub.poll("tab-1", 100)
  assert.equal(event.tool, "yunti_close_page")
  hub.submitResult({ browserSessionId: "tab-1", requestId: event.id, ok: true, result: { closed: true } })
  assert.deepEqual(await call, { closed: true })
})
