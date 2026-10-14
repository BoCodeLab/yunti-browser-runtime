#!/usr/bin/env node
import readline from "node:readline"
import { classifyToolFailure, errorFromFailure } from "./failure-contract.js"
import { validateToolArguments, dispatchBridgeTool, effectiveToolTimeoutMs } from "./arguments.js"
import { pathToFileURL } from "node:url"
import packageJson from "../package.json" with { type: "json" }
import { normalizeRouteUserId, requireRouteUserId } from "./bridge-hub.js"
import {
  BRIDGE_TOKEN_HEADER,
  DEFAULT_HOST,
  startBridgeServer,
} from "./http-server.js"
import { jsonRpcErr, jsonRpcOk, toolError, toolOk } from "./json-rpc.js"
import { forgetLearningMemory, getLearningMemory, rememberLearning } from "./memory.js"
import { createOperationLedger, describeOperation } from "../lib/operation-ledger.js"
import {
  BRIDGE_LOCAL_TOOLS,
  BROWSER_SCOPED_TOOLS,
  MEMORY_LOCAL_TOOLS,
  META_LOCAL_TOOLS,
  TOOLS,
  toolUsageHints,
} from "./tools.js"

export { TOOLS } from "./tools.js"
export {
  BridgeHub,
  CURRENT_EXTENSION_PROTOCOL_VERSION,
  DEFAULT_SESSION_TTL_MS,
} from "./bridge-hub.js"
export {
  BRIDGE_TOKEN_HEADER,
  DEFAULT_HOST,
  DEFAULT_PORT,
  startBridgeServer,
} from "./http-server.js"

const RELAY_URL = normalizeBaseUrl(process.env.YUNTI_BROWSER_RELAY_URL || "")
const RELAY_TOKEN = process.env.YUNTI_BROWSER_RELAY_TOKEN || ""
const SERVER_NAME = process.env.YUNTI_BROWSER_SERVER_NAME || "Yunti Browser Runtime"
const _ROUTE_USER_ID = process.env.YUNTI_BROWSER_USER_ID || "local"
const _ROUTE_USER_NAME = process.env.YUNTI_BROWSER_USER_NAME || "local"
const PACKAGE_VERSION = packageJson.version || ""
const proxyCompatibilityCache = new Map()
// Optional local operation ledger; off unless YUNTI_BROWSER_LEDGER=1.
const operationLedger = createOperationLedger()
let ledgerClient = null
// Concurrency ceiling for in-flight JSON-RPC requests. An MCP client may issue
// several calls before earlier ones finish; answering them one at a time made a
// single slow browser call block every faster call behind it.
const MAX_INFLIGHT_REQUESTS = Math.max(
  1,
  Number(process.env.YUNTI_BROWSER_MCP_CONCURRENCY || 4)
)

// Not every answer describes the page as it is right now. A process-local
// definition, a local memory file, or an extension-side capture buffer can all
// look like live page state to an agent that has no way to tell the difference,
// and reasoning confidently about stale data is worse than a visible error.
// Non-live answers therefore carry an explicit marker; live reads stay unmarked
// to keep the payload small. docs/TOOL_GUIDE.md documents the convention.
const TOOL_DATA_FRESHNESS = new Map([
  // Describes the tool surface itself, not any browser state.
  ["yunti_get_tool_usage_hints", "static"],
  // Local files under ~/.yunti_agent; unrelated to what the browser shows now.
  ["yunti_get_learning_memory", "local"],
  // Extension-side buffers: entries can be filtered by platformMatches, evicted
  // by the retention window, or truncated before they reach the caller.
  ["yunti_list_console_messages", "buffered"],
  ["yunti_get_console_message", "buffered"],
  ["yunti_list_network_requests", "buffered"],
  ["yunti_get_network_request", "buffered"],
  ["yunti_get_network_log", "buffered"],
  ["yunti_get_cdp_events", "buffered"],
])

export function dataFreshnessFor(tool) {
  return TOOL_DATA_FRESHNESS.get(tool) || "live"
}

export function annotateDataFreshness(tool, result) {
  const freshness = TOOL_DATA_FRESHNESS.get(tool)
  if (!freshness) return result
  if (!result || typeof result !== "object" || Array.isArray(result)) return result
  if (result.dataFreshness) return result
  return { ...result, dataFreshness: freshness }
}

function normalizeBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
}

function normalizeBridgeToken(value) {
  return String(value || "").trim()
}

function withRouteUser(args = {}) {
  const next = args && typeof args === "object" && !Array.isArray(args) ? { ...args } : {}
  if (!next.userId) {
    const routeUserId = normalizeRouteUserId(_ROUTE_USER_ID)
    if (routeUserId) next.userId = routeUserId
  }
  if (!next.userName && _ROUTE_USER_NAME) next.userName = _ROUTE_USER_NAME
  return next
}

function preflightBrowserToolScope(tool, args = {}) {
  if (!BROWSER_SCOPED_TOOLS.has(tool)) return
  requireRouteUserId(args, tool)
}

function bridgeRequestHeaders(bridgeToken = "") {
  const headers = { "content-type": "application/json" }
  const token = normalizeBridgeToken(bridgeToken)
  if (token) headers[BRIDGE_TOKEN_HEADER] = token
  return headers
}

async function proxyToolRequest(port, tool, args, timeoutMs, bridgeToken = "") {
  const routedArgs = withRouteUser(args)
  await assertProxyBridgeCompatibility(port, routedArgs.userId, bridgeToken)
  const response = await fetch(`http://${DEFAULT_HOST}:${port}/mcp/request`, {
    method: "POST",
    headers: bridgeRequestHeaders(bridgeToken),
    body: JSON.stringify({ tool, arguments: routedArgs, timeoutMs }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw errorFromFailure(data, `bridge HTTP ${response.status}`)
  }
  return data?.result ?? null
}

async function assertProxyBridgeCompatibility(port, userId, bridgeToken = "") {
  const cacheKey = `${port}|${userId}|${bridgeToken ? "auth" : "no-auth"}`
  const cached = proxyCompatibilityCache.get(cacheKey)
  if (cached && Date.now() - cached.checkedAt < 1000) return cached.value
  const response = await fetch(
    `http://${DEFAULT_HOST}:${port}/console/state?userId=${encodeURIComponent(userId || "local")}`,
    { headers: bridgeRequestHeaders(bridgeToken) }
  )
  const state = await response.json().catch(() => null)
  if (!response.ok || !state?.runtime?.version) {
    throw new Error(
      `YUNTI_BRIDGE_RUNTIME_MISMATCH: running bridge version is unknown, but MCP package is ${PACKAGE_VERSION}. Restart the Yunti MCP/bridge process. retryable=false retryBudget=0`
    )
  }
  if (state.runtime.version !== PACKAGE_VERSION) {
    throw new Error(
      `YUNTI_BRIDGE_RUNTIME_MISMATCH: running bridge is ${state.runtime.version}, but MCP package is ${PACKAGE_VERSION}. Restart the Yunti MCP/bridge process. retryable=false retryBudget=0`
    )
  }
  if (state.compatibility?.ok === false) {
    throw new Error(
      `YUNTI_EXTENSION_PROTOCOL_MISMATCH: connected extension is not compatible with runtime ${PACKAGE_VERSION}. Reload the unpacked extension from the current package directory. retryable=false retryBudget=0`
    )
  }
  const value = { ok: true, runtimeVersion: state.runtime.version }
  proxyCompatibilityCache.set(cacheKey, { checkedAt: Date.now(), value })
  return value
}

async function proxyBridgeLocalToolRequest(port, tool, args, bridgeToken = "") {
  const routedArgs = withRouteUser(args)
  const response = await fetch(`http://${DEFAULT_HOST}:${port}/mcp/local-tool`, {
    method: "POST",
    headers: bridgeRequestHeaders(bridgeToken),
    body: JSON.stringify({ tool, arguments: routedArgs }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw errorFromFailure(data, `bridge HTTP ${response.status}`)
  }
  return data?.result ?? null
}

async function relayToolRequest(tool, args, timeoutMs) {
  const routedArgs = withRouteUser(args)
  const response = await fetch(`${RELAY_URL}/mcp/request`, {
    method: "POST",
    headers: relayHeaders(),
    body: JSON.stringify({ tool, arguments: routedArgs, timeoutMs }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw errorFromFailure(data, `relay HTTP ${response.status}`)
  }
  return data?.result ?? null
}

async function relayBridgeLocalToolRequest(tool, args) {
  const routedArgs = withRouteUser(args)
  const response = await fetch(`${RELAY_URL}/mcp/local-tool`, {
    method: "POST",
    headers: relayHeaders(),
    body: JSON.stringify({ tool, arguments: routedArgs }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw errorFromFailure(data, `relay HTTP ${response.status}`)
  }
  return data?.result ?? null
}

function relayHeaders() {
  const headers = { "content-type": "application/json" }
  if (RELAY_TOKEN) headers.authorization = `Bearer ${RELAY_TOKEN}`
  return headers
}

async function callTool(bridge, tool, args) {
  validateToolArguments(tool, args)
  args = withRouteUser(args)
  preflightBrowserToolScope(tool, args)
  if (META_LOCAL_TOOLS.has(tool)) {
    return toolUsageHints(args)
  }
  if (MEMORY_LOCAL_TOOLS.has(tool)) {
    if (bridge?.mode === "owner") return dispatchBridgeTool(bridge.hub, tool, args)
    if (bridge?.mode === "proxy") return proxyBridgeLocalToolRequest(bridge.port, tool, args, bridge.bridgeToken)
    return callMemoryLocalTool(tool, args)
  }
  if (RELAY_URL) {
    if (BRIDGE_LOCAL_TOOLS.has(tool)) return relayBridgeLocalToolRequest(tool, args)
    return relayToolRequest(tool, args, effectiveToolTimeoutMs(tool, args))
  }
  if (BRIDGE_LOCAL_TOOLS.has(tool)) {
    if (bridge.mode === "owner") return dispatchBridgeTool(bridge.hub, tool, args)
    return proxyBridgeLocalToolRequest(bridge.port, tool, args, bridge.bridgeToken)
  }
  if (bridge.mode === "owner") {
    return dispatchBridgeTool(bridge.hub, tool, args)
  }
  return proxyToolRequest(bridge.port, tool, args, effectiveToolTimeoutMs(tool, args), bridge.bridgeToken)
}

async function callMemoryLocalTool(tool, args = {}) {
  switch (tool) {
    case "yunti_get_tool_usage_hints":
      return toolUsageHints(args)
    case "yunti_remember_learning":
      return rememberLearning(args)
    case "yunti_get_learning_memory":
      return getLearningMemory(args)
    case "yunti_forget_learning_memory":
      return forgetLearningMemory(args)
    default:
      throw new Error(`unknown memory-local tool: ${tool}`)
  }
}

export async function handleJsonRpc(req, bridge) {
  if (!req || typeof req !== "object") return jsonRpcErr(null, -32600, "invalid request")
  if (req.id === undefined || req.id === null) return null

  if (req.method === "initialize") {
    const clientInfo = req.params?.clientInfo
    if (clientInfo && typeof clientInfo === "object" && clientInfo.name) {
      ledgerClient = {
        name: String(clientInfo.name).slice(0, 80),
        version: String(clientInfo.version || "").slice(0, 40),
      }
    }
    return jsonRpcOk(req.id, {
      protocolVersion: "2024-11-05",
      serverInfo: { name: SERVER_NAME, version: PACKAGE_VERSION },
      capabilities: { tools: {} },
    })
  }

  if (req.method === "tools/list") {
    return jsonRpcOk(req.id, { tools: TOOLS })
  }

  if (req.method === "tools/call") {
    const name = req.params?.name
    const args = req.params?.arguments ?? {}
    if (!TOOLS.some((tool) => tool.name === name)) {
      return jsonRpcErr(req.id, -32602, `unknown tool: ${name}`)
    }
    const startedAt = Date.now()
    // Recording is fire-and-forget and never awaited on the response path: a
    // slow or unwritable ledger must not add latency to, or fail, a tool call.
    const record = (status, result, failure) => {
      if (!operationLedger.enabled) return
      operationLedger.record(describeOperation({
        tool: name,
        args,
        status,
        result,
        failure,
        durationMs: Date.now() - startedAt,
        transport: bridge?.mode || "",
        userId: String(args.userId || _ROUTE_USER_ID || ""),
        client: ledgerClient,
        version: PACKAGE_VERSION,
        requestId: req.id ?? null,
      }))
    }
    try {
      const result = await callTool(bridge, name, args)
      record("completed", result, null)
      return jsonRpcOk(req.id, toolOk(annotateDataFreshness(name, result)))
    } catch (error) {
      const failure = classifyToolFailure(error, name)
      record("failed", null, failure)
      return jsonRpcOk(
        req.id,
        toolError(failure.message, failure)
      )
    }
  }

  return jsonRpcErr(req.id, -32601, `method not found: ${req.method}`)
}

export async function runStdio() {
  const bridge = RELAY_URL ? { mode: "relay", host: "", port: 0, hub: null } : await startBridgeServer()
  if (RELAY_URL) {
    console.error(`[yunti-browser-runtime] relay ${RELAY_URL}`)
  } else {
    console.error(
      `[yunti-browser-runtime] bridge ${bridge.mode} on http://${bridge.host}:${bridge.port}`
    )
    console.error(`[yunti-browser-runtime] console http://${bridge.host}:${bridge.port}/console`)
    if (bridge.mode === "owner") {
      if (bridge.authRequired) {
        console.error(
          `[yunti-browser-runtime] bridge token header ${BRIDGE_TOKEN_HEADER}: ${bridge.bridgeToken}`
        )
      } else {
        console.error("[yunti-browser-runtime] bridge auth disabled for local loopback")
        console.error("[yunti-browser-runtime] set YUNTI_BROWSER_BRIDGE_TOKEN to require a local token")
      }
    } else if (!bridge.bridgeToken) {
      console.error(
        `[yunti-browser-runtime] proxy mode will connect without a bridge token; set YUNTI_BROWSER_BRIDGE_TOKEN if the running bridge requires one`
      )
    }
  }
  console.error(`[yunti-browser-runtime] stdio concurrency ${MAX_INFLIGHT_REQUESTS}`)

  const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
  const inflight = new Set()

  const dispatch = (req) => {
    const task = handleJsonRpc(req, bridge)
      .then((response) => {
        if (response) write(response)
      })
      .catch((error) => {
        write(jsonRpcErr(req?.id ?? null, -32603, `internal error: ${error?.message || error}`))
      })
      .finally(() => {
        inflight.delete(task)
      })
    inflight.add(task)
    return task
  }

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const rawLine of rl) {
    const line = rawLine.trim()
    if (!line) continue
    let req
    try {
      req = JSON.parse(line)
    } catch (error) {
      write(jsonRpcErr(null, -32700, `parse error: ${error.message}`))
      continue
    }
    // Keep reading while requests are in flight so a slow browser call cannot
    // stall faster calls (responses are correlated by JSON-RPC id).
    while (inflight.size >= MAX_INFLIGHT_REQUESTS) {
      await Promise.race([...inflight])
    }
    dispatch(req)
  }
  // Drain outstanding work so in-flight responses are not lost on EOF.
  await Promise.allSettled([...inflight])
}

export async function runBridgeOnly() {
  const bridge = await startBridgeServer()
  console.error(
    `[yunti-browser-runtime] bridge ${bridge.mode} on http://${bridge.host}:${bridge.port}`
  )
  console.error(`[yunti-browser-runtime] console http://${bridge.host}:${bridge.port}/console`)
  if (bridge.mode === "owner") {
    if (bridge.authRequired) {
      console.error(
        `[yunti-browser-runtime] bridge token header ${BRIDGE_TOKEN_HEADER}: ${bridge.bridgeToken}`
      )
    } else {
      console.error("[yunti-browser-runtime] bridge auth disabled for local loopback")
      console.error("[yunti-browser-runtime] set YUNTI_BROWSER_BRIDGE_TOKEN to require a local token")
    }
  } else if (!bridge.bridgeToken) {
    console.error(
      `[yunti-browser-runtime] proxy mode will connect without a bridge token; set YUNTI_BROWSER_BRIDGE_TOKEN if the running bridge requires one`
    )
  }
  await new Promise(() => {})
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runner = process.env.YUNTI_BROWSER_BRIDGE_ONLY === "1" ? runBridgeOnly : runStdio
  runner().catch((error) => {
    console.error("[yunti-browser-runtime] fatal:", error)
    process.exit(1)
  })
}
