import http from "node:http"
import { dispatchBridgeTool } from "./arguments.js"
import { classifyToolFailure } from "./failure-contract.js"
import { annotateActionStatus } from "./json-rpc.js"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  BridgeHub,
  CURRENT_EXTENSION_PROTOCOL_VERSION,
  DEFAULT_SESSION_TTL_MS,
  normalizeRouteUserId,
} from "./bridge-hub.js"

export const DEFAULT_HOST =
  process.env.YUNTI_BROWSER_BRIDGE_HOST || "127.0.0.1"
export const DEFAULT_PORT = Number(process.env.YUNTI_BROWSER_BRIDGE_PORT || 48887)
export const BRIDGE_TOKEN_HEADER = "x-yunti-browser-token"
const DEFAULT_ALLOWED_ORIGINS = [
  "http://127.0.0.1",
  "http://localhost",
  "http://[::1]",
  "chrome-extension://*",
  "moz-extension://*",
]
const RELAY_URL = normalizeBaseUrl(process.env.YUNTI_BROWSER_RELAY_URL || "")
const RELAY_TOKEN = process.env.YUNTI_BROWSER_RELAY_TOKEN || ""
const SERVER_NAME = process.env.YUNTI_BROWSER_SERVER_NAME || "Yunti Browser Runtime"
const _ROUTE_USER_ID = process.env.YUNTI_BROWSER_USER_ID || "local"
const _ROUTE_USER_NAME = process.env.YUNTI_BROWSER_USER_NAME || "local"
const PACKAGE_VERSION = readJsonFile(resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json")).version || ""
const EXTENSION_VERSION =
  readJsonFile(resolve(dirname(fileURLToPath(import.meta.url)), "..", "extension", "manifest.json")).version || ""
const MAX_JSON_BYTES = 2 * 1024 * 1024
const SESSION_CLEANUP_INTERVAL_MS = Number(
  process.env.YUNTI_BROWSER_SESSION_CLEANUP_INTERVAL_MS || 15_000
)
const PROTECTED_BRIDGE_PATHS = new Set([
  "/sessions",
  "/sessions/register",
  "/sessions/activate",
  "/sessions/unregister",
  "/extension/poll",
  "/extension/result",
  "/extension/network-event",
  "/extension/cdp-event",
  "/extension/console-event",
  "/console/state",
  "/console/cancel-pending",
  "/mcp/request",
  "/mcp/local-tool",
])

function normalizeBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return {}
  }
}

function normalizeBridgeToken(value) {
  return String(value || "").trim()
}

function parseAllowedOrigins(value = process.env.YUNTI_BROWSER_BRIDGE_ALLOW_ORIGINS) {
  const raw = String(value || "").trim()
  if (!raw) return DEFAULT_ALLOWED_ORIGINS
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function isLocalHttpOrigin(origin) {
  try {
    const url = new URL(origin)
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)
    )
  } catch {
    return false
  }
}

function originMatchesPattern(origin, pattern) {
  if (!origin) return true
  const pat = String(pattern || "").trim()
  if (!pat) return false
  if (pat === "*") return true
  if (pat === "chrome-extension://*") return origin.startsWith("chrome-extension://")
  if (pat === "moz-extension://*") return origin.startsWith("moz-extension://")
  if (pat.endsWith("://*")) return origin.startsWith(pat.slice(0, -1))
  if (origin === pat) return true
  return isLocalHttpOrigin(origin) && isLocalHttpOrigin(pat)
}

function isAllowedOrigin(origin, allowOrigins) {
  if (!origin) return true
  return allowOrigins.some((pattern) => originMatchesPattern(origin, pattern))
}

function isLoopbackHost(host) {
  const value = String(host || "").trim().toLowerCase()
  return value === "127.0.0.1" || value === "localhost" || value === "::1" || value === "[::1]"
}

function bridgeCorsHeaders(req, allowOrigins) {
  const origin = String(req.headers.origin || "")
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": `content-type, ${BRIDGE_TOKEN_HEADER}`,
    vary: "Origin",
  }
  if (isAllowedOrigin(origin, allowOrigins)) {
    headers["access-control-allow-origin"] = origin || "null"
  }
  return headers
}

function sendJson(req, res, statusCode, value, { allowOrigins = DEFAULT_ALLOWED_ORIGINS } = {}) {
  const body = JSON.stringify(value)
  res.writeHead(statusCode, bridgeCorsHeaders(req, allowOrigins))
  res.end(body)
}

function sendHtml(req, res, statusCode, html) {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  })
  res.end(req.method === "HEAD" ? "" : html)
}

function bridgeRequestToken(req) {
  const headerValue = req.headers[BRIDGE_TOKEN_HEADER]
  if (Array.isArray(headerValue)) return normalizeBridgeToken(headerValue[0])
  if (headerValue) return normalizeBridgeToken(headerValue)
  const authorization = String(req.headers.authorization || "")
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match ? normalizeBridgeToken(match[1]) : ""
}

function isAuthorizedBridgeRequest(req, bridgeToken, authRequired = true) {
  if (!authRequired) return true
  const token = normalizeBridgeToken(bridgeToken)
  return Boolean(token && bridgeRequestToken(req) === token)
}

function authInfo(authRequired) {
  return {
    required: Boolean(authRequired),
    header: BRIDGE_TOKEN_HEADER,
  }
}

function healthWithAuth(value, authRequired) {
  return {
    ...value,
    authorized: true,
    auth: authInfo(authRequired),
  }
}

function limitedHealth(authRequired) {
  return {
    ok: true,
    name: "yunti-browser-runtime-bridge",
    authorized: false,
    auth: authInfo(authRequired),
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let total = 0
    const chunks = []
    req.on("data", (chunk) => {
      total += chunk.length
      if (total > MAX_JSON_BYTES) {
        reject(new Error("request body too large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      if (!raw.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    req.on("error", reject)
  })
}

export async function startBridgeServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  bridgeToken = null,
  allowOrigins = parseAllowedOrigins(),
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
} = {}) {
  const configuredBridgeToken = normalizeBridgeToken(
    bridgeToken ?? process.env.YUNTI_BROWSER_BRIDGE_TOKEN
  )
  const authRequired = Boolean(configuredBridgeToken)
  if (!authRequired && !isLoopbackHost(host)) {
    throw new Error(
      "YUNTI_BROWSER_BRIDGE_TOKEN is required when binding the bridge to a non-loopback host"
    )
  }
  const activeBridgeToken = configuredBridgeToken
  const hub = new BridgeHub({
    sessionTtlMs,
    runtimeVersion: PACKAGE_VERSION,
    expectedExtensionVersion: EXTENSION_VERSION || PACKAGE_VERSION,
    expectedProtocolVersion: CURRENT_EXTENSION_PROTOCOL_VERSION,
  })
  const cleanupTimer = setInterval(() => {
    hub.cleanupExpiredSessions()
  }, Math.max(5_000, SESSION_CLEANUP_INTERVAL_MS))
  cleanupTimer.unref?.()
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}:${port}`)
      const authorized = isAuthorizedBridgeRequest(req, activeBridgeToken, authRequired)

      if (req.method === "OPTIONS") {
        const origin = String(req.headers.origin || "")
        sendJson(req, res, isAllowedOrigin(origin, allowOrigins) ? 200 : 403, { ok: true }, { allowOrigins })
        return
      }

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(
          req,
          res,
          200,
          authorized
            ? healthWithAuth(hub.health({ userId: url.searchParams.get("userId") }), authRequired)
            : limitedHealth(authRequired),
          { allowOrigins }
        )
        return
      }

      if ((req.method === "GET" || req.method === "HEAD") && (url.pathname === "/console" || url.pathname === "/console/")) {
        sendHtml(req, res, 200, localConsoleHtml({ authRequired, tokenHeader: BRIDGE_TOKEN_HEADER }))
        return
      }

      if (PROTECTED_BRIDGE_PATHS.has(url.pathname) && !authorized) {
        sendJson(
          req,
          res,
          401,
          {
            ok: false,
            error: `missing or invalid ${BRIDGE_TOKEN_HEADER}`,
            auth: authInfo(authRequired),
          },
          { allowOrigins }
        )
        return
      }

      if (req.method === "GET" && url.pathname === "/console/state") {
        const userId = url.searchParams.get("userId") || _ROUTE_USER_ID
        sendJson(
          req,
          res,
          200,
          hub.consoleState({
            userId,
            runtimeVersion: PACKAGE_VERSION,
            expectedExtensionVersion: EXTENSION_VERSION || PACKAGE_VERSION,
          }),
          { allowOrigins }
        )
        return
      }

      if (req.method === "POST" && url.pathname === "/console/cancel-pending") {
        const body = await readJson(req)
        const result = hub.cancelPendingRequests({
          ...body,
          userId: body.userId || _ROUTE_USER_ID,
        })
        sendJson(req, res, 200, result, { allowOrigins })
        return
      }

      if (req.method === "GET" && url.pathname === "/sessions") {
        const userId = url.searchParams.get("userId")
        const health = hub.health({ userId })
        sendJson(
          req,
          res,
          200,
          {
            sessions: health.sessions,
            activeSessionId: health.activeSessionId,
            browserControllerSessionId: health.browserControllerSessionId,
            browserControllerSessionIds: health.browserControllerSessionIds,
            sessionCount: health.sessionCount,
            visibleSessionCount: health.visibleSessionCount,
            pageSessionCount: health.pageSessionCount,
            controllerCount: health.controllerCount,
            compatibility: health.compatibility,
          },
          { allowOrigins }
        )
        return
      }

      if (req.method === "POST" && url.pathname === "/sessions/register") {
        const body = await readJson(req)
        const session = hub.registerSession(body)
        sendJson(req, res, 200, { ok: true, session }, { allowOrigins })
        return
      }

      if (req.method === "POST" && url.pathname === "/sessions/activate") {
        const body = await readJson(req)
        const session = hub.activateSession(String(body.browserSessionId || ""), body)
        sendJson(req, res, 200, { ok: true, session }, { allowOrigins })
        return
      }

      if (req.method === "POST" && url.pathname === "/sessions/unregister") {
        const body = await readJson(req)
        const outcome = hub.unregisterSession(String(body.browserSessionId || ""), body)
        sendJson(req, res, 200, outcome, { allowOrigins })
        return
      }

      if (req.method === "GET" && url.pathname === "/extension/poll") {
        const browserSessionId = String(url.searchParams.get("browserSessionId") || "").trim()
        const timeoutMs = Number(url.searchParams.get("timeoutMs") || 25_000)
        if (!browserSessionId) {
          sendJson(req, res, 400, { error: "browserSessionId is required" }, { allowOrigins })
          return
        }
        const pollController = new AbortController()
        const abortDisconnectedPoll = () => {
          if (!res.writableEnded) pollController.abort()
        }
        req.once("aborted", abortDisconnectedPoll)
        res.once("close", abortDisconnectedPoll)
        const event = await hub.poll(browserSessionId, timeoutMs, pollController.signal)
        if (res.destroyed) return
        sendJson(req, res, 200, event, { allowOrigins })
        return
      }

      if (req.method === "POST" && url.pathname === "/extension/result") {
        const body = await readJson(req)
        const outcome = hub.submitResult(body)
        sendJson(req, res, outcome.accepted ? 200 : 404, outcome, { allowOrigins })
        return
      }

      if (req.method === "POST" && url.pathname === "/extension/network-event") {
        const body = await readJson(req)
        const outcome = hub.recordNetworkEvent(body)
        sendJson(req, res, outcome.accepted ? 200 : 400, outcome, { allowOrigins })
        return
      }

      if (req.method === "POST" && url.pathname === "/extension/cdp-event") {
        const body = await readJson(req)
        const outcome = hub.recordCdpEvent(body)
        sendJson(req, res, outcome.accepted ? 200 : 400, outcome, { allowOrigins })
        return
      }

      if (req.method === "POST" && url.pathname === "/extension/console-event") {
        const body = await readJson(req)
        const outcome = hub.recordConsoleEvent(body)
        sendJson(req, res, outcome.accepted ? 200 : 400, outcome, { allowOrigins })
        return
      }

      if (req.method === "POST" && ["/mcp/request", "/mcp/local-tool"].includes(url.pathname)) {
        const body = await readJson(req)
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["tool", "arguments", "timeoutMs"].includes(key))) {
          throw new Error("YUNTI_PARAMETER_INVALID: tool request body accepts only tool, arguments and timeoutMs")
        }
        const args = body.arguments ?? {}
        const result = await dispatchBridgeTool(
          hub,
          String(body.tool || ""),
          args && typeof args === "object" && !Array.isArray(args)
            ? { ...args, userId: args.userId || _ROUTE_USER_ID, userName: args.userName || _ROUTE_USER_NAME }
            : args,
          body.timeoutMs === undefined ? undefined : Number(body.timeoutMs)
        )
        sendJson(req, res, 200, { ok: true, result: annotateActionStatus(result) }, { allowOrigins })
        return
      }

      sendJson(req, res, 404, { error: "not found" }, { allowOrigins })
    } catch (error) {
      const failure = classifyToolFailure(error)
      sendJson(req, res, failure.code === "YUNTI_PARAMETER_INVALID" ? 400 : 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        failure,
      }, { allowOrigins })
    }
  })

  const mode = await new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        resolve("proxy")
      } else {
        reject(error)
      }
    })
    server.listen(port, host, () => resolve("owner"))
  })

  if (mode === "proxy") {
    clearInterval(cleanupTimer)
    server.close()
    return { mode: "proxy", host, port, bridgeToken: configuredBridgeToken, authRequired, allowOrigins, hub: null, server: null }
  }
  return { mode: "owner", host, port, bridgeToken: activeBridgeToken, authRequired, allowOrigins, hub, server }
}

function localConsoleHtml({ authRequired, tokenHeader }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Yunti Browser Runtime Console</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; background: Canvas; color: CanvasText; }
      main { max-width: 1120px; margin: 0 auto; padding: 24px; }
      header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
      h1 { margin: 0; font-size: 24px; line-height: 1.2; }
      h2 { margin: 0 0 10px; font-size: 16px; }
      button { border: 1px solid ButtonBorder; background: ButtonFace; color: ButtonText; border-radius: 6px; padding: 8px 10px; cursor: pointer; }
      button:disabled { opacity: .55; cursor: not-allowed; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
      .panel { border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 8px; padding: 14px; }
      .metric { font-size: 28px; font-weight: 700; }
      .muted { color: color-mix(in srgb, CanvasText 62%, transparent); }
      .sessions, .activity { display: grid; gap: 10px; }
      .row { border-top: 1px solid color-mix(in srgb, CanvasText 14%, transparent); padding-top: 10px; }
      .row:first-child { border-top: 0; padding-top: 0; }
      code { overflow-wrap: anywhere; }
      .status { display: inline-flex; border-radius: 999px; padding: 2px 8px; font-size: 12px; background: color-mix(in srgb, LinkText 16%, transparent); }
      .warn { color: #9f4e00; }
      .error { color: #b3261e; }
      .warning-list { display: grid; gap: 8px; margin: 0 0 12px; }
      .warning-item { border: 1px solid color-mix(in srgb, #9f4e00 50%, transparent); border-radius: 8px; padding: 10px; }
      .toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      @media (max-width: 640px) { main { padding: 16px; } header { align-items: flex-start; flex-direction: column; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>Yunti Browser Runtime</h1>
          <div class="muted">Local console for bridge status, connected pages, diagnostics, and pending tasks.</div>
        </div>
        <div class="toolbar">
          <button id="refresh" type="button">Refresh</button>
          <button id="cancel" type="button">Cancel Pending</button>
        </div>
      </header>
      <section id="auth" class="panel" hidden></section>
      <section id="warnings" class="warning-list" aria-live="polite"></section>
      <section class="grid" aria-live="polite">
        <div class="panel"><h2>Sessions</h2><div id="sessionCount" class="metric">-</div><div class="muted">connected browser pages</div></div>
        <div class="panel"><h2>Pending</h2><div id="pendingCount" class="metric">-</div><div class="muted">runtime requests waiting for results</div></div>
        <div class="panel"><h2>Diagnostics</h2><div id="diagCount" class="metric">-</div><div class="muted">sanitized network, console, and CDP summaries</div></div>
        <div class="panel"><h2>Runtime</h2><div id="runtimeVersion" class="metric">-</div><div class="muted">expected extension <span id="extensionVersion">-</span></div></div>
      </section>
      <section class="panel" style="margin-top: 12px;">
        <h2>Connected Pages</h2>
        <div id="sessions" class="sessions muted">Loading...</div>
      </section>
      <section class="panel" style="margin-top: 12px;">
        <h2>Recent Activity</h2>
        <div id="activity" class="activity muted">Loading...</div>
      </section>
    </main>
    <script>
      const stateUrl = "/console/state";
      const authRequired = ${JSON.stringify(Boolean(authRequired))};
      const tokenHeader = ${JSON.stringify(tokenHeader)};
      const refreshButton = document.querySelector("#refresh");
      const cancelButton = document.querySelector("#cancel");
      const authPanel = document.querySelector("#auth");
      const text = (value) => value == null || value === "" ? "-" : String(value);

      if (authRequired) {
        authPanel.hidden = false;
        authPanel.innerHTML = '<strong>Bridge auth is enabled.</strong> This page shell is visible, but state requests require the <code>' + tokenHeader + '</code> header. Use <code>yunti-browser-runtime doctor</code> or curl with the header for protected diagnostics.';
      }

      async function loadState() {
        refreshButton.disabled = true;
        try {
          const response = await fetch(stateUrl, { cache: "no-store" });
          if (!response.ok) throw new Error("HTTP " + response.status);
          const state = await response.json();
          render(state);
        } catch (error) {
          document.querySelector("#sessions").innerHTML = '<span class="error">' + escapeHtml(error.message || String(error)) + '</span>';
          document.querySelector("#activity").textContent = authRequired ? "State is protected by bridge auth." : "Unable to read console state.";
        } finally {
          refreshButton.disabled = false;
        }
      }

      async function cancelPending() {
        cancelButton.disabled = true;
        try {
          await fetch("/console/cancel-pending", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reason: "cancelled from local runtime console" })
          });
          await loadState();
        } finally {
          cancelButton.disabled = false;
        }
      }

      function render(state) {
        const diagnostics = state.diagnostics || {};
        const pending = (state.pendingRequests || []).length + (state.queuedRequests || []).length;
        document.querySelector("#sessionCount").textContent = state.sessionCount || 0;
        document.querySelector("#pendingCount").textContent = pending;
        document.querySelector("#diagCount").textContent = (diagnostics.networkEvents || 0) + (diagnostics.consoleMessages || 0) + (diagnostics.cdpEvents || 0);
        document.querySelector("#runtimeVersion").textContent = state.runtime?.version || "-";
        document.querySelector("#extensionVersion").textContent = state.runtime?.expectedExtensionVersion || "-";
        document.querySelector("#warnings").innerHTML = renderWarnings(state);
        document.querySelector("#sessions").innerHTML = renderSessions(state);
        document.querySelector("#activity").innerHTML = renderActivity(state);
      }

      function renderWarnings(state) {
        if (!state.warnings || state.warnings.length === 0) return "";
        return state.warnings.map((warning) => '<div class="warning-item"><strong>' + escapeHtml(text(warning.code)) + '</strong><div>' + escapeHtml(text(warning.message)) + '</div></div>').join("");
      }

      function renderSessions(state) {
        if (!state.sessions || state.sessions.length === 0) {
          return '<div>No connected pages. ' + escapeHtml(state.guidance?.noSessions || "") + '</div>';
        }
        return state.sessions.map((session) => '<div class="row"><div><span class="status">' + (session.active ? "active" : "connected") + '</span> <strong>' + escapeHtml(text(session.title || session.displayName)) + '</strong></div><div><code>' + escapeHtml(text(session.url)) + '</code></div><div class="muted">tab ' + escapeHtml(text(session.tabId)) + ' · extension ' + escapeHtml(text(session.extensionVersion)) + ' · queued ' + escapeHtml(text(session.queuedRequests)) + ' · last seen ' + escapeHtml(text(session.lastSeenAt)) + '</div></div>').join("");
      }

      function renderActivity(state) {
        if (!state.recentActivity || state.recentActivity.length === 0) return '<div>No recent activity yet.</div>';
        return state.recentActivity.map((event) => '<div class="row"><div><span class="status">' + escapeHtml(text(event.status || event.type)) + '</span> <strong>' + escapeHtml(text(event.tool || event.type)) + '</strong></div><div class="muted">' + escapeHtml(text(event.timestamp)) + ' · ' + escapeHtml(text(event.browserSessionId)) + '</div><div>' + escapeHtml(text(event.message || summarize(event.summary))) + '</div></div>').join("");
      }

      function summarize(summary) {
        if (!summary) return "";
        const parts = [];
        if (summary.ok != null) parts.push("ok=" + summary.ok);
        if (summary.code) parts.push("code=" + summary.code);
        if (summary.action) parts.push("action=" + summary.action);
        if (summary.keys) parts.push("keys=" + summary.keys.join(","));
        return parts.join(" · ");
      }

      function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
      }

      refreshButton.addEventListener("click", loadState);
      cancelButton.addEventListener("click", cancelPending);
      loadState();
      setInterval(loadState, 5000);
    </script>
  </body>
</html>`
}
