import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { validateToolArguments } from "../mcp/arguments.js"
import { classifyToolFailure } from "../mcp/failure-contract.js"
import { toolOk } from "../mcp/json-rpc.js"
import { BridgeHub } from "../mcp/bridge-hub.js"
import { handleJsonRpc } from "../mcp/server.js"

test("tool arguments reject unknown budgets and invalid nested fields", () => {
  assert.throws(() => validateToolArguments("yunti_evaluate_script", { expression: "1", timeout_ms: 90000 }), /unknown argument.*timeout_ms/)
  assert.throws(() => validateToolArguments("yunti_evaluate_script", { expression: "1", maxLength: -1 }), /range/)
  assert.throws(() => validateToolArguments("yunti_click", []), /must be object/)
  assert.throws(() => validateToolArguments("yunti_evaluate_script", { awaitPromise: true }), /expression is required/)
  assert.doesNotThrow(() => validateToolArguments("yunti_cdp_send_command", { method: "Runtime.evaluate", params: { expression: "1", returnByValue: true } }))
})

test("action failures, wait misses and network event failures have distinct status", () => {
  const action = toolOk({ action: "fill", ok: false, code: "TARGET_OBSCURED" })
  assert.equal(action.isError, true)
  assert.equal(action.structuredContent.transportStatus, "completed")
  assert.equal(action.structuredContent.actionStatus, "failed")
  const wait = toolOk({ action: "wait_for", ok: false, code: "WAIT_TIMEOUT", found: false })
  assert.notEqual(wait.isError, true)
  assert.equal(wait.structuredContent.actionStatus, "condition_not_met")
  const events = toolOk({ events: [{ ok: false, status: 404 }] })
  assert.notEqual(events.isError, true)
  assert.deepEqual(events.structuredContent.events, [{ ok: false, status: 404 }])
})

test("diagnostics never ignore unsupported explicit routes or clear the active page instead", async () => {
  const hub = new BridgeHub()
  hub.registerSession({ browserSessionId: "a", userId: "local", tabId: 101 })
  hub.registerSession({ browserSessionId: "b", userId: "local", tabId: 202 })
  hub.activateSession("b", { userId: "local" })
  for (const [browserSessionId, tabId] of [["a", 101], ["b", 202]]) hub.recordNetworkEvent({ browserSessionId, tabId, method: "GET", url: "https://fixture.test/" })
  await assert.rejects(hub.callBridgeLocalTool("yunti_list_network_requests", { userId: "local", tabId: 101 }), /YUNTI_PARAMETER_INVALID/)
  await assert.rejects(hub.callBridgeLocalTool("yunti_clear_network_requests", { userId: "local", targetId: "tab-101" }), /YUNTI_PARAMETER_INVALID/)
  assert.equal(hub.listNetworkEvents({ userId: "local", browserSessionId: "a" }).returned, 1)
  assert.equal(hub.listNetworkEvents({ userId: "local", browserSessionId: "b" }).returned, 1)
  const result = await hub.callBridgeLocalTool("yunti_list_network_requests", { userId: "local", browserSessionId: "a" })
  assert.equal(result.effectiveRoute.tabId, 101)
  assert.equal(result.routeSource, "explicit")
})

test("an offline browser is not a closed tab and stale inventory does not prove closure", () => {
  const hub = new BridgeHub()
  const args = { userId: "local", pageHandleId: "yunti-tab-fixture-101-1" }
  assert.throws(() => hub.resolveToolRoute(args, "yunti_observe_page"), /YUNTI_BROWSER_INSTANCE_OFFLINE/)
  const controller = { browserSessionId: "yunti-browser-fixture", browserInstanceId: "yunti-browser-fixture", userId: "local", kind: "browser_controller", liveTabIds: [], capabilities: { singleControllerTransport: true } }
  hub.registerSession({ ...controller, inventoryCapturedAt: new Date(Date.now() - 60000).toISOString() })
  assert.throws(() => hub.resolveToolRoute(args, "yunti_observe_page"), /YUNTI_INVENTORY_STALE/)
  hub.registerSession({ ...controller, inventoryCapturedAt: new Date().toISOString() })
  assert.throws(() => hub.resolveToolRoute(args, "yunti_observe_page"), /YUNTI_PAGE_HANDLE_CLOSED/)
})

// Health is user-scoped. Without a selected user nothing is visible, and
// reporting that as extensionConnected:false reads as a bridge outage — the
// reader cannot tell "not visible to this scope" from "nothing is connected".
test("health names its scope instead of reporting an unscoped disconnect", () => {
  const hub = new BridgeHub()
  hub.registerSession({
    browserSessionId: "yunti-browser-fixture",
    browserInstanceId: "yunti-browser-fixture",
    userId: "local",
    kind: "browser_controller",
    liveTabIds: [],
    capabilities: { singleControllerTransport: true },
  })

  const scoped = hub.health({ userId: "local" })
  assert.equal(scoped.scope, "local")
  assert.equal(scoped.userSelected, true)
  assert.equal(scoped.extensionConnected, true)

  const unscoped = hub.health()
  assert.equal(unscoped.scope, null)
  assert.equal(unscoped.userSelected, false)
  assert.notEqual(unscoped.extensionConnected, false)
  assert.equal(unscoped.extensionConnected, null)
  // Isolation is unchanged: an unscoped caller still sees no sessions.
  assert.deepEqual(unscoped.sessions, [])
  assert.equal(unscoped.controllerCount, 0)
})

// One failure chain shares one retry budget, so the client must be able to read
// the whole budget off a single failure. Only a stale route is worth retrying,
// and it is worth exactly one attempt; an uncertain write is never retryable.
test("a failure chain offers one shared retry and never replays a terminal route", () => {
  const terminal = classifyToolFailure(new Error("YUNTI_EXTENSION_PROTOCOL_MISMATCH: reload the extension"))
  assert.equal(terminal.retryable, false)
  assert.equal(terminal.retryBudget, 0)

  const ambiguous = classifyToolFailure(new Error("YUNTI_BROWSER_INSTANCE_AMBIGUOUS: two browsers"))
  assert.equal(ambiguous.retryBudget, 0)

  const stale = classifyToolFailure(new Error("session yunti-page-1 is stale or disconnected"))
  assert.equal(stale.code, "YUNTI_SESSION_STALE")
  assert.equal(stale.retryable, true)
  assert.equal(stale.retryBudget, 1)

  const busy = classifyToolFailure(new Error("YUNTI_TAB_BUSY: a previous operation has not finished"))
  assert.equal(busy.retryable, true)
  assert.equal(busy.retryBudget, 1)

  const timedOut = classifyToolFailure(new Error("Browser tool execution timed out inside the extension"), "yunti_click")
  assert.equal(timedOut.retryable, false)
  assert.equal(timedOut.retryBudget, 0)
  assert.equal(timedOut.resultUncertain, true)

  const cdpTimeout = classifyToolFailure(new Error("YUNTI_CDP_TIMEOUT: no CDP reply"))
  assert.equal(cdpTimeout.retryBudget, 0)
  assert.equal(cdpTimeout.resultUncertain, true)
})

// Paging a held result must be cheaper and safer than re-running the
// expression: no side effect repeats, and the caller can prove it read the
// whole thing by checking the digest of the concatenated slices.
test("an oversized result is handed off in chunks instead of re-run", () => {
  const hub = new BridgeHub()
  const full = "abcdefghij".repeat(5)

  const handed = hub.stashOversizedResult({ value: null, truncated: true, totalChars: full.length, oversizedText: full })
  assert.equal(handed.oversizedText, undefined, "the full text must not reach the caller")
  assert.equal(handed.resultChars, full.length)
  assert.match(handed.resultSha256, /^[0-9a-f]{64}$/)

  const first = hub.readResultChunk({ resultId: handed.resultId, length: 20 })
  assert.equal(first.text, full.slice(0, 20))
  assert.equal(first.nextOffset, 20)
  assert.equal(first.complete, false)
  assert.match(first.nextStepHint, /offset 20/)

  const second = hub.readResultChunk({ resultId: handed.resultId, offset: first.nextOffset, length: 100 })
  assert.equal(second.complete, true)
  assert.equal(second.nextStepHint, undefined)

  const rebuilt = first.text + second.text
  assert.equal(rebuilt, full)
  assert.equal(createHash("sha256").update(rebuilt, "utf8").digest("hex"), handed.resultSha256)
})

test("a result that was not oversized passes through untouched", () => {
  const hub = new BridgeHub()
  const plain = { value: "small", truncated: false, totalChars: 5 }
  assert.deepEqual(hub.stashOversizedResult(plain), plain)
})

test("an unknown resultId reports an expired handoff rather than a partial answer", () => {
  const hub = new BridgeHub()
  assert.throws(() => hub.readResultChunk({ resultId: "res-does-not-exist" }), /YUNTI_RESULT_HANDOFF_EXPIRED/)
  assert.throws(() => hub.readResultChunk({}), /YUNTI_RESULT_HANDOFF_EXPIRED/)
})

test("stdio validates local meta tools before normalizing invalid input", async () => {
  for (const args of [{ extra: true }, []]) {
    const result = await handleJsonRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "yunti_get_tool_usage_hints", arguments: args } }, {})
    assert.equal(result.result.isError, true)
    assert.equal(result.result.structuredContent.code, "YUNTI_PARAMETER_INVALID")
  }
})
