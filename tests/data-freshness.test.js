import test from "node:test"
import assert from "node:assert/strict"
import { annotateDataFreshness, dataFreshnessFor } from "../mcp/server.js"

// An agent that cannot tell a static definition or a capture buffer from a real
// page read will reason confidently about stale data. These tests pin the
// convention: live reads stay unmarked, everything else is labelled.

test("live tools report live and stay unmarked", () => {
  const liveTools = [
    "yunti_observe_page",
    "yunti_get_page_snapshot",
    "yunti_click",
    "yunti_fill",
    "yunti_take_screenshot",
    "yunti_evaluate_script",
  ]
  for (const tool of liveTools) {
    assert.equal(dataFreshnessFor(tool), "live", `${tool} must be live`)
    const result = { ok: true, value: 1 }
    assert.deepEqual(
      annotateDataFreshness(tool, result),
      result,
      `${tool} must not gain a marker`
    )
  }
})

test("process-local definitions are marked static", () => {
  assert.equal(dataFreshnessFor("yunti_get_tool_usage_hints"), "static")
  assert.equal(
    annotateDataFreshness("yunti_get_tool_usage_hints", { ok: true }).dataFreshness,
    "static"
  )
})

test("local memory reads are marked local", () => {
  assert.equal(dataFreshnessFor("yunti_get_learning_memory"), "local")
  assert.equal(
    annotateDataFreshness("yunti_get_learning_memory", { entries: [] }).dataFreshness,
    "local"
  )
})

test("extension capture buffers are marked buffered", () => {
  const buffered = [
    "yunti_list_console_messages",
    "yunti_get_console_message",
    "yunti_list_network_requests",
    "yunti_get_network_request",
    "yunti_get_network_log",
    "yunti_get_cdp_events",
  ]
  for (const tool of buffered) {
    assert.equal(dataFreshnessFor(tool), "buffered", `${tool} must be buffered`)
    assert.equal(
      annotateDataFreshness(tool, { ok: true }).dataFreshness,
      "buffered",
      `${tool} must gain a buffered marker`
    )
  }
})

test("annotation keeps the original fields and never overwrites a marker", () => {
  const original = { ok: true, count: 3, entries: [{ id: 1 }] }
  const annotated = annotateDataFreshness("yunti_list_network_requests", original)
  assert.equal(annotated.ok, true)
  assert.equal(annotated.count, 3)
  assert.deepEqual(annotated.entries, [{ id: 1 }])
  assert.equal(annotated.dataFreshness, "buffered")
  // The input object is not mutated: callers may still hold a reference.
  assert.equal(original.dataFreshness, undefined)

  const explicit = { ok: true, dataFreshness: "live" }
  assert.equal(
    annotateDataFreshness("yunti_list_network_requests", explicit).dataFreshness,
    "live",
    "an explicit marker from the tool wins"
  )
})

test("annotation tolerates non-object results", () => {
  assert.equal(annotateDataFreshness("yunti_list_network_requests", null), null)
  assert.equal(annotateDataFreshness("yunti_list_network_requests", "text"), "text")
  assert.deepEqual(annotateDataFreshness("yunti_list_network_requests", [1, 2]), [1, 2])
})
