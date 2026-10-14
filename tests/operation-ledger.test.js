import test from "node:test"
import assert from "node:assert/strict"
import { argumentFingerprint, createOperationLedger, describeOperation, routeFieldsFor } from "../lib/operation-ledger.js"

test("the operation ledger records metadata without any argument values", () => {
  const entry = describeOperation({
    tool: "yunti_fill",
    args: { uid: "yunti-abc-1", value: "hunter2-secret", browserSessionId: "yunti-page-9", userId: "local" },
    status: "completed",
    result: { ok: true, actionStatus: "succeeded", dataCompleteness: "complete" },
    durationMs: 42,
    transport: "owner",
    userId: "local",
    client: { name: "Codex", version: "1.2.3" },
    version: "0.2.9",
    requestId: 7,
  })

  const serialized = JSON.stringify(entry)
  assert.equal(serialized.includes("hunter2-secret"), false, "argument values must never be written")
  assert.equal(serialized.includes("yunti-abc-1"), false, "opaque ids must not be written either")

  assert.deepEqual(entry.argumentKeys, ["browserSessionId", "uid", "userId", "value"])
  assert.match(entry.argumentSha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(entry.routeFields, ["browserSessionId"])
  assert.equal(entry.tool, "yunti_fill")
  assert.equal(entry.durationMs, 42)
  assert.equal(entry.status, "completed")
  assert.equal(entry.actionStatus, "succeeded")
  assert.deepEqual(entry.client, { name: "Codex", version: "1.2.3" })
  assert.equal(entry.requestId, 7)
})

test("the same arguments fingerprint identically regardless of key order", () => {
  const a = argumentFingerprint({ uid: "u", value: "v", userId: "local" })
  const b = argumentFingerprint({ userId: "local", value: "v", uid: "u" })
  assert.deepEqual(a.keys, b.keys)
  assert.equal(a.sha256, b.sha256)

  const different = argumentFingerprint({ uid: "u", value: "other", userId: "local" })
  assert.notEqual(a.sha256, different.sha256)
})

test("route fields name the addressing style without carrying the ids", () => {
  assert.deepEqual(
    routeFieldsFor({ browserSessionId: "s", tabId: 5, allSessions: true, uid: "u" }),
    ["allSessions", "browserSessionId", "tabId"]
  )
  assert.deepEqual(routeFieldsFor(null), [])
})

test("a disabled ledger writes nothing", async () => {
  const written = []
  const ledger = createOperationLedger({ enabled: false, append: async (...args) => written.push(args) })
  await ledger.record({ tool: "yunti_click" })
  assert.equal(ledger.enabled, false)
  assert.equal(written.length, 0)
})

test("an enabled ledger appends one JSON line per operation", async () => {
  const written = []
  const ledger = createOperationLedger({
    enabled: true,
    now: () => new Date("2026-10-14T10:00:00Z"),
    append: async (file, line) => written.push({ file, line }),
  })

  await ledger.record({ tool: "yunti_click", at: "2026-10-14T10:00:00.000Z" })
  await ledger.record({ tool: "yunti_fill", at: "2026-10-14T10:00:01.000Z" })

  assert.equal(written.length, 2)
  assert.match(written[0].file.replace(/\\/g, "/"), /operations\/2026-10-14\.jsonl$/)
  assert.equal(written[0].line.endsWith("\n"), true)
  assert.equal(JSON.parse(written[0].line).tool, "yunti_click")
  assert.equal(JSON.parse(written[1].line).tool, "yunti_fill")
})

test("an unwritable ledger reports the failure instead of breaking the caller", async () => {
  const ledger = createOperationLedger({
    enabled: true,
    append: async () => {
      throw new Error("disk full")
    },
  })

  await ledger.record({ tool: "yunti_click" })
  assert.equal(ledger.failures, 1)
})
