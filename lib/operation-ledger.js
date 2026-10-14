import { appendFile, mkdir } from "node:fs/promises"
import { createHash } from "node:crypto"
import { dirname } from "node:path"
import { yuntiOperationLedgerFile } from "./runtime-paths.js"

// An optional local record of which tool ran, for which agent, against which
// route, and how it ended. It exists so a usage question — "how often does this
// tool fail for that agent, and on which route?" — can be answered from the
// runtime itself instead of by reconstructing compressed sessions, SQLite
// projections and OTEL spans after the fact.
//
// Metadata only. Argument values, page content, response bodies and credentials
// are never written: arguments appear as a sorted key list plus a one-way hash,
// which is enough to spot a repeated call without keeping its payload. Off
// unless YUNTI_BROWSER_LEDGER=1, so a default install writes nothing.

// Argument names that select a route. Recorded by name so a reader can tell
// which addressing style a caller used without storing the opaque ids.
const ROUTE_ARGUMENT_KEYS = new Set([
  "browserSessionId",
  "pageHandleId",
  "tabId",
  "targetId",
  "browserInstanceId",
  "allSessions",
])

export function ledgerEnabled() {
  return String(process.env.YUNTI_BROWSER_LEDGER || "").trim() === "1"
}

export function argumentFingerprint(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return { keys: [], sha256: "" }
  const keys = Object.keys(args).sort()
  const material = keys.map((key) => `${key}=${JSON.stringify(args[key])}`).join("\u0000")
  return { keys, sha256: createHash("sha256").update(material, "utf8").digest("hex") }
}

export function routeFieldsFor(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return []
  return Object.keys(args).filter((key) => ROUTE_ARGUMENT_KEYS.has(key)).sort()
}

export function createOperationLedger({
  enabled = ledgerEnabled(),
  now = () => new Date(),
  append = appendFile,
} = {}) {
  let chain = Promise.resolve()
  let failures = 0

  // Writes are chained so lines cannot interleave, and every failure is
  // swallowed: an unwritable ledger must never turn a working tool call into a
  // failed one. The count is exposed so doctor can surface it instead.
  function record(entry) {
    if (!enabled) return chain
    const line = `${JSON.stringify(entry)}\n`
    chain = chain
      .then(async () => {
        const file = yuntiOperationLedgerFile(now())
        await mkdir(dirname(file), { recursive: true })
        await append(file, line, "utf8")
      })
      .catch(() => {
        failures += 1
      })
    return chain
  }

  return {
    record,
    get enabled() {
      return enabled
    },
    get failures() {
      return failures
    },
  }
}

// Build the ledger row for one tools/call. Kept pure so the shape can be
// asserted without touching the filesystem.
export function describeOperation({
  tool,
  args = {},
  status = "completed",
  result = null,
  failure = null,
  durationMs = 0,
  transport = "",
  userId = "",
  client = null,
  version = "",
  requestId = null,
  at = new Date().toISOString(),
} = {}) {
  const { keys, sha256 } = argumentFingerprint(args)
  return {
    at,
    requestId: requestId === null || requestId === undefined ? null : requestId,
    tool: String(tool || ""),
    version: String(version || ""),
    transport: String(transport || ""),
    client: client && client.name ? { name: client.name, version: client.version || "" } : null,
    userId: String(userId || ""),
    routeFields: routeFieldsFor(args),
    argumentKeys: keys,
    argumentSha256: sha256,
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
    status,
    code: String(failure?.code || result?.code || ""),
    actionStatus: String(result?.actionStatus || (status === "failed" ? "failed" : "")),
    dataCompleteness: String(result?.dataCompleteness || ""),
    truncated: result?.truncated === true,
  }
}
