#!/usr/bin/env node
import readline from "node:readline"
import { pathToFileURL } from "node:url"
import packageJson from "../package.json" with { type: "json" }
import { DEFAULT_TOOL_TIMEOUT_MS, normalizeRouteUserId, requireRouteUserId } from "./bridge-hub.js"
import {
  BRIDGE_TOKEN_HEADER,
  DEFAULT_HOST,
  startBridgeServer,
} from "./http-server.js"
import { jsonRpcErr, jsonRpcOk, toolError, toolOk } from "./json-rpc.js"
import { forgetLearningMemory, getLearningMemory, rememberLearning } from "./memory.js"
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
// Concurrency ceiling for in-flight JSON-RPC requests. An MCP client may issue
// several calls before earlier ones finish; answering them one at a time made a
// single slow browser call block every faster call behind it.
const MAX_INFLIGHT_REQUESTS = Math.max(
  1,
  Number(process.env.YUNTI_BROWSER_MCP_CONCURRENCY || 4)
)

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

function classifyToolFailure(error, tool = "") {
  const message = error instanceof Error ? error.message : String(error)
  const structured = normalizeBridgeFailure(error)
  // A failure that already carries its own contract outranks the message-shape
  // heuristics below: the extension knows more about its own failure than a
  // regex over the error text does.
  if (structured) {
    return {
      message,
      code: structured.code,
      retryable: Boolean(structured.retryable),
      retryBudget: Number(structured.retryBudget || 0),
      recoveryAction: structured.recoveryAction || inferRecoveryAction(structured.code),
      resultUncertain: Boolean(structured.resultUncertain),
      recoverable: structured.recoverable,
      action: structured.action,
      target: structured.target,
      recoveryHint: structured.recoveryHint,
      nextStepHint: structured.nextStepHint,
      detail: buildFailureDetail(structured, message),
    }
  }
  if (/YUNTI_EXTENSION_PROTOCOL_MISMATCH/.test(message)) {
    return {
      message,
      code: "YUNTI_EXTENSION_PROTOCOL_MISMATCH",
      retryable: false,
      retryBudget: 0,
      recoveryAction: "reload_extension_then_run_doctor",
      resultUncertain: false,
      detail: "Do not retry browser tools until yunti-browser-runtime doctor reports matching runtime, extension, and protocol versions.",
    }
  }
  if (/YUNTI_BRIDGE_RUNTIME_MISMATCH/.test(message)) {
    return {
      message,
      code: "YUNTI_BRIDGE_RUNTIME_MISMATCH",
      retryable: false,
      retryBudget: 0,
      recoveryAction: "restart_mcp_bridge_then_run_doctor",
      resultUncertain: false,
      detail: "Do not retry browser tools until the running bridge version matches this MCP package.",
    }
  }
  if (/YUNTI_BROWSER_INSTANCE_AMBIGUOUS/.test(message)) {
    return {
      message,
      code: "YUNTI_BROWSER_INSTANCE_AMBIGUOUS",
      retryable: false,
      retryBudget: 0,
      recoveryAction: "select_browser_instance",
      resultUncertain: false,
      detail: "List targets through the intended routeBrowserSessionId, then pass that page browserSessionId or browserInstanceId.",
    }
  }
  if (/YUNTI_TAB_BUSY|YUNTI_CDP_TIMEOUT/.test(message)) {
    return {
      message,
      code: /YUNTI_TAB_BUSY/.test(message) ? "YUNTI_TAB_BUSY" : "YUNTI_CDP_TIMEOUT",
      retryable: true,
      retryBudget: 1,
      recoveryAction: "verify_page_state_then_retry",
      resultUncertain: false,
      detail: "A previous operation on this tab has not finished. Verify the current page state, then retry once instead of stacking more work on the same tab.",
    }
  }
  if (/YUNTI_PARAMETER_INVALID|is required|must be (a )?number/.test(message)) {
    return {
      message,
      code: "YUNTI_PARAMETER_INVALID",
      retryable: false,
      retryBudget: 0,
      recoveryAction: "fix_arguments_and_retry",
      resultUncertain: false,
      detail: "The tool arguments were rejected before the browser was touched. Correct the arguments from yunti_get_tool_usage_hints and retry.",
    }
  }
  if (/stale or disconnected|heartbeat expired|no longer exists|showing error page/i.test(message)) {
    return {
      message,
      code: "YUNTI_SESSION_STALE",
      retryable: true,
      retryBudget: 1,
      recoveryAction: "list_targets_then_retry_once",
      resultUncertain: false,
      detail: "Discard the stale browserSessionId, list live targets once, and retry only with the selected live page route.",
    }
  }
  if (/timed out/i.test(message)) {
    return {
      message,
      code: "YUNTI_TOOL_TIMEOUT",
      retryable: false,
      retryBudget: 0,
      recoveryAction: "verify_state_before_retry",
      resultUncertain: true,
      detail: `The ${tool || "browser"} result is uncertain. Inspect current page state before deciding whether another call is safe.`,
    }
  }
  return {
    message,
    code: "YUNTI_TOOL_ERROR",
    retryable: false,
    retryBudget: 0,
    recoveryAction: "inspect_error",
    resultUncertain: false,
    detail: "Inspect the error and current browser targets before making another call.",
  }
}

const STRUCTURED_FAILURE_KEYS = [
  "code",
  "retryable",
  "retryBudget",
  "recoveryAction",
  "resultUncertain",
  "recoverable",
  "action",
  "target",
  "recoveryHint",
  "nextStepHint",
  "diagnostics",
]

function normalizeBridgeFailure(error) {
  const raw = error?.structuredFailure
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const out = {}
  for (const key of STRUCTURED_FAILURE_KEYS) {
    const value = raw[key]
    if (value === undefined || value === null || value === "") continue
    out[key] = value
  }
  if (typeof out.code !== "string" || !out.code) return null
  return out
}

function inferRecoveryAction(code) {
  switch (code) {
    case "CONTROLLER_PAGE_ROUTE_REQUIRED":
      return "list_targets_then_retry_with_tab_id_or_page_session"
    case "CONTENT_SCRIPT_UNAVAILABLE":
      return "list_targets_then_retry_same_page_once"
    case "EXTENSION_TOOL_TIMEOUT":
      return "verify_state_before_retry"
    case "LAST_TAB_CLOSE_BLOCKED":
      return "inspect_error"
    default:
      return "inspect_error"
  }
}

function buildFailureDetail(structured, message) {
  const hint = structured.recoveryHint
  const nextAction = hint?.nextAction || structured.recoveryAction || ""
  const tools = Array.isArray(hint?.recommendedTools)
    ? ` Recommended tools: ${hint.recommendedTools.join(", ")}.`
    : ""
  const uncertain = structured.resultUncertain
    ? " The browser-side result is uncertain; verify page state before repeating a write."
    : ""
  const next = structured.nextStepHint ? ` ${structured.nextStepHint}` : ""
  return `${message}${next}${nextAction ? ` Next action: ${nextAction}.` : ""}${tools}${uncertain}`.trim()
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
    throw new Error(data?.error || `bridge HTTP ${response.status}`)
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
    throw new Error(data?.error || `bridge HTTP ${response.status}`)
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
    throw new Error(data?.error || `relay HTTP ${response.status}`)
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
    throw new Error(data?.error || `relay HTTP ${response.status}`)
  }
  return data?.result ?? null
}

function relayHeaders() {
  const headers = { "content-type": "application/json" }
  if (RELAY_TOKEN) headers.authorization = `Bearer ${RELAY_TOKEN}`
  return headers
}

async function callTool(bridge, tool, args) {
  args = withRouteUser(args)
  preflightBrowserToolScope(tool, args)
  if (META_LOCAL_TOOLS.has(tool)) {
    return toolUsageHints(args)
  }
  if (MEMORY_LOCAL_TOOLS.has(tool)) {
    if (bridge?.mode === "owner") return bridge.hub.callBridgeLocalTool(tool, args)
    if (bridge?.mode === "proxy") return proxyBridgeLocalToolRequest(bridge.port, tool, args, bridge.bridgeToken)
    return callMemoryLocalTool(tool, args)
  }
  if (RELAY_URL) {
    if (BRIDGE_LOCAL_TOOLS.has(tool)) return relayBridgeLocalToolRequest(tool, args)
    return relayToolRequest(tool, args, DEFAULT_TOOL_TIMEOUT_MS)
  }
  if (BRIDGE_LOCAL_TOOLS.has(tool)) {
    if (bridge.mode === "owner") return bridge.hub.callBridgeLocalTool(tool, args)
    return proxyBridgeLocalToolRequest(bridge.port, tool, args, bridge.bridgeToken)
  }
  if (bridge.mode === "owner") {
    return bridge.hub.callTool(tool, args)
  }
  return proxyToolRequest(bridge.port, tool, args, DEFAULT_TOOL_TIMEOUT_MS, bridge.bridgeToken)
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
    try {
      const result = await callTool(bridge, name, args)
      return jsonRpcOk(req.id, toolOk(result))
    } catch (error) {
      const failure = classifyToolFailure(error, name)
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
