import { randomUUID } from "node:crypto"
import { forgetLearningMemory, getLearningMemory, rememberLearning } from "./memory.js"
import {
  clampNumber,
  normalizeCdpEvent,
  sanitizeNetworkEvent,
  sanitizeUrl,
  redactLikelySensitiveText,
  truncateText,
} from "./redaction.js"
import { toolUsageHints } from "./tools.js"

export const DEFAULT_TOOL_TIMEOUT_MS = 30_000
export const CURRENT_EXTENSION_PROTOCOL_VERSION = 1
const MAX_NETWORK_EVENTS = 1000
const MAX_CDP_EVENTS = 2000
const MAX_CONSOLE_MESSAGES = 1000
const MAX_ACTIVITY_EVENTS = 100
const MAX_MEMORY_ITEMS = 500
export const DEFAULT_SESSION_TTL_MS = Number(
  process.env.YUNTI_BROWSER_SESSION_TTL_MS || 90_000
)

function isoNow(ms = Date.now()) {
  return new Date(ms).toISOString()
}

export function sessionRecoveryHint() {
  return "Retry with a live tabId/targetId, or call yunti_list_browser_targets without the stale browserSessionId; Yunti 0.2.3+ recovers page routes through the browser controller."
}

export function staleSessionError(browserSessionId, reason = "stale or disconnected") {
  return new Error(
    `Yunti browser session is stale or disconnected: ${browserSessionId}. Reason: ${reason}. ${sessionRecoveryHint()}`
  )
}

function stripBrowserSessionId(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args ?? {}
  const next = { ...args }
  delete next.browserSessionId
  delete next.userId
  delete next.userName
  return next
}

function isBrowserControllerMeta(meta = {}) {
  return meta?.kind === "browser_controller"
}

function isBrowserControllerSession(session) {
  return isBrowserControllerMeta(session?.meta || {})
}

function supportsControllerPageRouting(session) {
  return Boolean(session?.meta?.capabilities?.singleControllerTransport)
}

function normalizeBrowserInstanceId(meta = {}) {
  return String(
    meta?.browserInstanceId ||
    meta?.client?.browserInstanceId ||
    meta?.browserControllerSessionId ||
    ""
  ).trim()
}

function normalizeProtocolVersion(meta = {}) {
  const value = Number(meta?.protocolVersion ?? meta?.client?.protocolVersion)
  return Number.isInteger(value) && value > 0 ? value : null
}

function normalizeTabId(value) {
  const tabId = Number(value)
  return Number.isFinite(tabId) && tabId > 0 ? tabId : null
}

function tabIdFromTargetId(value) {
  const targetId = String(value || "").trim()
  if (!targetId) return null
  if (targetId.startsWith("tab-")) return normalizeTabId(targetId.slice(4))
  return /^\d+$/.test(targetId) ? normalizeTabId(targetId) : null
}

function tabIdFromBrowserSessionId(value) {
  const browserSessionId = String(value || "").trim()
  const match = browserSessionId.match(/^yunti(?:-page)?-(\d+)(?:-|$)/)
  return match ? normalizeTabId(match[1]) : null
}

function controllerIdFromPageSessionId(value) {
  const browserSessionId = String(value || "").trim()
  const match = browserSessionId.match(/^yunti-page-\d+-(.+)$/)
  return match?.[1] ? `yunti-browser-${match[1]}` : ""
}

// --- Stable page handles (P8.2.4a) -------------------------------------
// A handle identifies one live tab inside one browser instance and survives
// navigation, reload, content-script reinjection, extension reconnect, and
// Bridge restart. It never embeds page data. The numeric suffix is the tab-id
// reuse generation, so a reused numeric tab id can never inherit an old handle.

const PAGE_HANDLE_RE = /^yunti-tab-(.+)-(\d+)-(\d+)$/

export function parsePageHandleId(value) {
  const raw = String(value || "").trim()
  const match = raw.match(PAGE_HANDLE_RE)
  if (!match) return null
  const tabId = normalizeTabId(match[2])
  const generation = Number(match[3])
  if (!tabId || !Number.isInteger(generation) || generation < 1) return null
  return { raw, browserInstanceSuffix: match[1], tabId, generation }
}

function browserInstanceSuffix(meta = {}) {
  const instanceId = normalizeBrowserInstanceId(meta)
  if (instanceId) return instanceId.replace(/^yunti-browser-/, "")
  return String(meta?.browserControllerSessionId || "").replace(/^yunti-browser-/, "")
}

function handleGenerationFor(controllerSession, tabId) {
  const handles = controllerSession?.meta?.tabHandles
  if (!handles || typeof handles !== "object") return null
  const handle = handles[String(tabId)]
  if (!handle) return null
  const parsed = parsePageHandleId(handle)
  return parsed ? parsed.generation : null
}

function controllerLiveTabIds(session) {
  return Array.isArray(session?.meta?.liveTabIds)
    ? new Set(session.meta.liveTabIds.map(normalizeTabId).filter(Boolean))
    : null
}

const BROWSER_CONTROLLER_TOOLS = new Set([
  "yunti_list_browser_targets",
  "yunti_list_pages",
  "yunti_get_browser_target",
  "yunti_cdp_send_command",
  "yunti_new_page",
])

// Browser-level and raw-CDP tools have no single page to bind, so a page handle
// is not meaningful for them.
const PAGE_HANDLE_UNSUPPORTED_TOOLS = new Set([
  ...BROWSER_CONTROLLER_TOOLS,
  "yunti_close_page",
  "yunti_get_tool_usage_hints",
  "yunti_remember_learning",
  "yunti_get_learning_memory",
  "yunti_forget_learning_memory",
  "yunti_get_network_log",
  "yunti_clear_network_log",
  "yunti_clear_network_requests",
  "yunti_list_network_requests",
  "yunti_get_network_request",
  "yunti_get_cdp_events",
  "yunti_clear_cdp_events",
  "yunti_list_console_messages",
  "yunti_get_console_message",
  "yunti_clear_console_messages",
  "yunti_select_page",
])

function handleRouteAllowsTool(tool) {
  if (!tool) return true
  return !PAGE_HANDLE_UNSUPPORTED_TOOLS.has(tool)
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

function normalizeStructuredFailure(failure) {
  if (!failure || typeof failure !== "object" || Array.isArray(failure)) return null
  const out = {}
  for (const key of STRUCTURED_FAILURE_KEYS) {
    const value = failure[key]
    if (value === undefined || value === null || value === "") continue
    out[key] = value
  }
  if (typeof out.code !== "string" || !out.code) return null
  return out
}

function withStructuredFailure(error, structured) {
  if (!structured) return error
  error.structuredFailure = structured
  if (!error.code) error.code = structured.code
  return error
}

function summarizeFailure(structured) {
  if (!structured) return null
  const summary = { type: "failure", ok: false }
  if (structured.code) summary.code = redactLikelySensitiveText(structured.code, 120)
  if (structured.action) summary.action = redactLikelySensitiveText(structured.action, 120)
  if (structured.nextStepHint) {
    summary.nextStepHint = redactLikelySensitiveText(structured.nextStepHint, 240)
  }
  return summary
}

function summarizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { type: typeof value }
  }
  const summary = {
    type: "object",
    keys: Object.keys(value).slice(0, 12),
  }
  if (typeof value.ok === "boolean") summary.ok = value.ok
  if (typeof value.code === "string") summary.code = redactLikelySensitiveText(value.code, 120)
  if (typeof value.action === "string") summary.action = redactLikelySensitiveText(value.action, 120)
  if (typeof value.nextStepHint === "string") {
    summary.nextStepHint = redactLikelySensitiveText(value.nextStepHint, 240)
  }
  return summary
}

function summarizeSession(session, activeSessionId) {
  const meta = session.meta || {}
  const client = meta.client && typeof meta.client === "object" ? meta.client : {}
  return {
    browserSessionId: session.browserSessionId,
    pageHandleId: redactLikelySensitiveText(meta.pageHandleId || "", 200),
    active: session.browserSessionId === activeSessionId,
    userId: redactLikelySensitiveText(meta.userId || "", 120),
    userName: redactLikelySensitiveText(meta.userName || "", 120),
    displayName: redactLikelySensitiveText(meta.displayName || "", 160),
    kind: redactLikelySensitiveText(meta.kind || (isBrowserControllerMeta(meta) ? "browser_controller" : "page"), 80),
    title: redactLikelySensitiveText(meta.title || "", 240),
    url: meta.url ? sanitizeUrl(meta.url) : "",
    tabId: meta.tabId ?? null,
    windowId: meta.windowId ?? null,
    clientFamily: redactLikelySensitiveText(client.family || "", 80),
    extensionVersion: redactLikelySensitiveText(client.extensionVersion || meta.extensionVersion || "", 80),
    protocolVersion: normalizeProtocolVersion(meta),
    browserInstanceId: redactLikelySensitiveText(normalizeBrowserInstanceId(meta), 160),
    browserControllerSessionId: redactLikelySensitiveText(meta.browserControllerSessionId || "", 160),
    queuedRequests: session.queue.length,
    pollers: session.pollers.length,
    updatedAt: meta.updatedAt || "",
    lastSeenAt: meta.lastSeenAt || "",
    expiresAt: meta.expiresAt || "",
    staleReason: redactLikelySensitiveText(meta.staleReason || session.staleReason || "", 240),
  }
}

export function normalizeRouteUserId(value) {
  const userId = String(value || "").trim()
  return userId && userId !== "anonymous" ? userId : ""
}

export function requireRouteUserId(args = {}, operation = "Yunti browser tool") {
  const userId = normalizeRouteUserId(args?.userId)
  if (!userId) {
    throw new Error(`${operation}: userId is required for Yunti browser isolation`)
  }
  return userId
}
export class BridgeHub {
  constructor({
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
    runtimeVersion = "",
    expectedExtensionVersion = "",
    expectedProtocolVersion = null,
  } = {}) {
    this.sessions = new Map()
    this.pendingRequests = new Map()
    this.networkEvents = []
    this.cdpEvents = []
    this.consoleMessages = []
    this.activityEvents = []
    this.nextNetworkEventId = 1
    this.nextCdpEventId = 1
    this.nextConsoleMsgId = 1
    this.nextActivityEventId = 1
    this.activeSessionId = null
    this.activeSessionByUser = new Map()
    this.browserControllerByUser = new Map()
    this.browserControllersByUser = new Map()
    this.sessionTtlMs = Math.max(5_000, Number(sessionTtlMs) || DEFAULT_SESSION_TTL_MS)
    this.runtimeVersion = String(runtimeVersion || "").trim()
    this.expectedExtensionVersion = String(expectedExtensionVersion || "").trim()
    this.expectedProtocolVersion = Number.isInteger(Number(expectedProtocolVersion))
      ? Number(expectedProtocolVersion)
      : null
  }

  controllerSessionIdsForUser(userId) {
    const routeUserId = normalizeRouteUserId(userId)
    if (!routeUserId) return []
    const ids = this.browserControllersByUser.get(routeUserId) || new Set()
    const live = []
    for (const browserSessionId of ids) {
      const session = this.getLiveSession(browserSessionId)
      if (session && isBrowserControllerSession(session)) live.push(browserSessionId)
    }
    return live
  }

  controllerSessionsForUser(userId, { compatibleOnly = false } = {}) {
    const sessions = this.controllerSessionIdsForUser(userId)
      .map((browserSessionId) => this.sessions.get(browserSessionId))
      .filter(Boolean)
    return compatibleOnly
      ? sessions.filter((session) => this.sessionCompatibility(session).ok)
      : sessions
  }

  trackBrowserController(userId, browserSessionId) {
    if (!userId || !browserSessionId) return
    const ids = this.browserControllersByUser.get(userId) || new Set()
    ids.add(browserSessionId)
    this.browserControllersByUser.set(userId, ids)
    this.browserControllerByUser.set(userId, browserSessionId)
  }

  untrackBrowserController(browserSessionId) {
    for (const [userId, ids] of this.browserControllersByUser.entries()) {
      ids.delete(browserSessionId)
      if (ids.size === 0) {
        this.browserControllersByUser.delete(userId)
        this.browserControllerByUser.delete(userId)
        continue
      }
      if (this.browserControllerByUser.get(userId) === browserSessionId) {
        this.browserControllerByUser.set(userId, [...ids].at(-1))
      }
    }
  }

  sessionCompatibility(session) {
    const meta = session?.meta || {}
    const extensionVersion = String(meta?.client?.extensionVersion || meta?.extensionVersion || "").trim()
    const protocolVersion = normalizeProtocolVersion(meta)
    const issues = []
    if (this.expectedExtensionVersion && extensionVersion !== this.expectedExtensionVersion) {
      issues.push({
        code: extensionVersion ? "EXTENSION_VERSION_MISMATCH" : "EXTENSION_VERSION_UNKNOWN",
        expected: this.expectedExtensionVersion,
        actual: extensionVersion || null,
      })
    }
    if (this.expectedProtocolVersion && protocolVersion !== this.expectedProtocolVersion) {
      issues.push({
        code: protocolVersion ? "EXTENSION_PROTOCOL_MISMATCH" : "EXTENSION_PROTOCOL_UNKNOWN",
        expected: this.expectedProtocolVersion,
        actual: protocolVersion,
      })
    }
    return {
      ok: issues.length === 0,
      extensionVersion: extensionVersion || null,
      protocolVersion,
      issues,
    }
  }

  compatibilitySummary(sessions = []) {
    const connected = sessions.filter(Boolean)
    const details = connected.map((session) => ({
      browserSessionId: session.browserSessionId,
      kind: isBrowserControllerSession(session) ? "browser_controller" : "page",
      browserInstanceId: normalizeBrowserInstanceId(session.meta),
      ...this.sessionCompatibility(session),
    }))
    return {
      ok: details.every((detail) => detail.ok),
      expectedExtensionVersion: this.expectedExtensionVersion || null,
      expectedProtocolVersion: this.expectedProtocolVersion,
      incompatibleSessionCount: details.filter((detail) => !detail.ok).length,
      sessions: details,
    }
  }

  incompatibleExtensionError(compatibility) {
    const actualVersions = [...new Set(
      compatibility.sessions.map((session) => session.extensionVersion || "unknown")
    )].join(", ")
    return new Error(
      `YUNTI_EXTENSION_PROTOCOL_MISMATCH: connected extension (${actualVersions}) is not compatible with runtime ${this.expectedExtensionVersion || "current"}. Reload the unpacked extension from the current package directory. retryable=false retryBudget=0`
    )
  }

  assertUserExtensionCompatibility(userId) {
    const controllers = this.controllerSessionsForUser(userId)
    const sessions = controllers.length
      ? controllers
      : [...this.sessions.values()].filter(
          (session) => normalizeRouteUserId(session.meta?.userId) === userId
        )
    const compatibility = this.compatibilitySummary(sessions)
    if (!compatibility.ok) throw this.incompatibleExtensionError(compatibility)
    return compatibility
  }

  recordActivity(input = {}) {
    const event = {
      id: this.nextActivityEventId++,
      timestamp: new Date().toISOString(),
      type: redactLikelySensitiveText(input.type || "event", 80),
      tool: input.tool ? redactLikelySensitiveText(input.tool, 120) : "",
      browserSessionId: input.browserSessionId ? redactLikelySensitiveText(input.browserSessionId, 160) : "",
      status: input.status ? redactLikelySensitiveText(input.status, 80) : "",
      message: input.message ? redactLikelySensitiveText(input.message, 300) : "",
      summary: input.summary && typeof input.summary === "object" ? input.summary : undefined,
    }
    this.activityEvents.push(event)
    if (this.activityEvents.length > MAX_ACTIVITY_EVENTS) {
      this.activityEvents.splice(0, this.activityEvents.length - MAX_ACTIVITY_EVENTS)
    }
    return event
  }

  sessionExpiresAt(now = Date.now()) {
    return now + this.sessionTtlMs
  }

  refreshSession(session, now = Date.now(), patch = {}) {
    const meta = session.meta || {}
    session.updatedAt = now
    session.expiresAt = this.sessionExpiresAt(now)
    session.staleReason = ""
    session.meta = {
      ...meta,
      ...patch,
      lastSeenAt: isoNow(now),
      expiresAt: isoNow(session.expiresAt),
      staleReason: "",
      updatedAt: isoNow(now),
    }
    return session
  }

  refreshPageSessionsForUser(userId, now = Date.now(), liveTabIds = null) {
    const normalizedUserId = normalizeRouteUserId(userId)
    if (!normalizedUserId) return 0
    const liveTabs = Array.isArray(liveTabIds)
      ? new Set(liveTabIds.map(normalizeTabId).filter(Boolean))
      : null
    let refreshed = 0
    const staleSessionIds = []
    for (const session of this.sessions.values()) {
      if (isBrowserControllerSession(session)) continue
      if (normalizeRouteUserId(session.meta?.userId) !== normalizedUserId) continue
      const tabId = normalizeTabId(session.meta?.tabId)
      if (liveTabs && tabId && !liveTabs.has(tabId)) {
        staleSessionIds.push(session.browserSessionId)
        continue
      }
      this.refreshSession(session, now, { heartbeatSource: "browser_controller" })
      refreshed += 1
    }
    for (const browserSessionId of staleSessionIds) {
      this.markSessionStale(browserSessionId, "browser tab no longer exists")
    }
    return refreshed
  }

  refreshPageSessionsForController(controllerSession, now = Date.now()) {
    const userId = normalizeRouteUserId(controllerSession?.meta?.userId)
    if (!userId) return 0
    const browserInstanceId = normalizeBrowserInstanceId(controllerSession?.meta)
    const controllers = this.controllerSessionsForUser(userId)
    const liveTabs = Array.isArray(controllerSession?.meta?.liveTabIds)
      ? new Set(controllerSession.meta.liveTabIds.map(normalizeTabId).filter(Boolean))
      : null
    const staleSessionIds = []
    let refreshed = 0
    for (const session of this.sessions.values()) {
      if (isBrowserControllerSession(session)) continue
      if (normalizeRouteUserId(session.meta?.userId) !== userId) continue
      const pageInstanceId = normalizeBrowserInstanceId(session.meta)
      const belongsToController = browserInstanceId
        ? pageInstanceId === browserInstanceId
        : controllers.length === 1 && !pageInstanceId
      if (!belongsToController) continue
      const tabId = normalizeTabId(session.meta?.tabId)
      if (liveTabs && tabId && !liveTabs.has(tabId)) {
        staleSessionIds.push(session.browserSessionId)
        continue
      }
      this.refreshSession(session, now, {
        heartbeatSource: "browser_controller",
        browserControllerSessionId: controllerSession.browserSessionId,
      })
      refreshed += 1
    }
    for (const browserSessionId of staleSessionIds) {
      this.markSessionStale(browserSessionId, "browser tab no longer exists")
    }
    return refreshed
  }

  markSessionStale(browserSessionId, reason = "disconnected") {
    const session = this.sessions.get(browserSessionId)
    if (!session) return null
    session.staleReason = reason
    session.meta = {
      ...session.meta,
      staleReason: reason,
      staleAt: isoNow(),
    }
    this.sessions.delete(browserSessionId)
    if (this.activeSessionId === browserSessionId) this.activeSessionId = null
    for (const [userId, activeSessionId] of this.activeSessionByUser.entries()) {
      if (activeSessionId === browserSessionId) this.activeSessionByUser.delete(userId)
    }
    this.untrackBrowserController(browserSessionId)
    for (const poller of session.pollers.splice(0)) {
      poller({ type: "noop", id: randomUUID(), stale: true, reason })
    }
    this.recordActivity({
      type: "stale-session",
      browserSessionId,
      status: "stale",
      message: reason,
    })
    return session.meta
  }

  cleanupExpiredSessions(now = Date.now()) {
    const expired = []
    for (const [browserSessionId, session] of this.sessions.entries()) {
      if (session.expiresAt && session.expiresAt <= now) {
        expired.push({
          browserSessionId,
          reason: "session heartbeat expired",
          meta: this.markSessionStale(browserSessionId, "session heartbeat expired"),
        })
      }
    }
    return expired
  }

  getLiveSession(browserSessionId) {
    const session = this.sessions.get(browserSessionId)
    if (!session) return null
    if (session.expiresAt && session.expiresAt <= Date.now()) {
      this.markSessionStale(browserSessionId, "session heartbeat expired")
      return null
    }
    return session
  }

  registerSession(meta) {
    this.cleanupExpiredSessions()
    const browserSessionId = String(meta.browserSessionId || "").trim()
    if (!browserSessionId) throw new Error("browserSessionId is required")
    const routeUserId = requireRouteUserId(meta, "browser session registration")
    const incomingTabId = normalizeTabId(meta.tabId)
    const incomingBrowserInstanceId = normalizeBrowserInstanceId(meta)
    if (isBrowserControllerMeta(meta)) {
      for (const [existingSessionId, candidate] of this.sessions.entries()) {
        if (existingSessionId === browserSessionId || !isBrowserControllerSession(candidate)) continue
        if (normalizeRouteUserId(candidate.meta?.userId) !== routeUserId) continue
        const existingBrowserInstanceId = normalizeBrowserInstanceId(candidate.meta)
        if (
          incomingBrowserInstanceId &&
          existingBrowserInstanceId &&
          incomingBrowserInstanceId === existingBrowserInstanceId
        ) {
          this.markSessionStale(existingSessionId, "replaced by a fresh controller for the same browser instance")
        }
      }
    } else if (incomingTabId) {
      for (const [existingSessionId, candidate] of this.sessions.entries()) {
        if (existingSessionId === browserSessionId || isBrowserControllerSession(candidate)) continue
        if (normalizeRouteUserId(candidate.meta?.userId) !== routeUserId) continue
        if (normalizeTabId(candidate.meta?.tabId) !== incomingTabId) continue
        const existingBrowserInstanceId = normalizeBrowserInstanceId(candidate.meta)
        if (
          incomingBrowserInstanceId &&
          existingBrowserInstanceId &&
          incomingBrowserInstanceId !== existingBrowserInstanceId
        ) continue
        this.markSessionStale(existingSessionId, "replaced by a fresh page session for the same tab")
      }
    }
    const existing = this.sessions.get(browserSessionId) || {
      browserSessionId,
      queue: [],
      pollers: [],
      meta: {},
      updatedAt: 0,
      expiresAt: 0,
      staleReason: "",
    }
    const now = Date.now()
    this.refreshSession(existing, now, {
      ...meta,
      browserSessionId,
      userId: routeUserId,
      registeredAt: meta.registeredAt || existing.meta.registeredAt || isoNow(now),
    })
    this.sessions.set(browserSessionId, existing)
    const userId = normalizeRouteUserId(existing.meta.userId)
    if (isBrowserControllerSession(existing)) {
      this.trackBrowserController(userId, browserSessionId)
      this.refreshPageSessionsForController(existing, now)
    } else {
      const currentActiveId = userId ? this.activeSessionByUser.get(userId) : this.activeSessionId
      const currentActive = currentActiveId ? this.getLiveSession(currentActiveId) : null
      if (existing.meta.active === true || !currentActive) {
        this.activeSessionId = browserSessionId
        if (userId) this.activeSessionByUser.set(userId, browserSessionId)
      }
    }
    return existing.meta
  }

  unregisterSession(browserSessionId, args = {}) {
    const session = this.sessions.get(browserSessionId)
    if (!session) return { ok: true, removed: false, browserSessionId }
    const userId = requireRouteUserId(args, "browser session unregister")
    if (normalizeRouteUserId(session.meta?.userId) !== userId) {
      throw new Error(`browser session is not owned by userId: ${userId}`)
    }
    const meta = this.markSessionStale(browserSessionId, args.reason || "unregistered")
    return { ok: true, removed: true, browserSessionId, meta }
  }

  activateSession(browserSessionId, args = {}) {
    this.cleanupExpiredSessions()
    const session = this.getLiveSession(browserSessionId)
    if (!session) {
      throw staleSessionError(browserSessionId, "not registered or heartbeat expired")
    }
    const meta = session.meta
    const routeUserId = requireRouteUserId(args, "browser session activation")
    if (normalizeRouteUserId(meta.userId) !== routeUserId) {
      throw new Error(`browser session is not owned by userId: ${routeUserId}`)
    }
    this.refreshSession(session, Date.now(), {
      lastActivatedAt: isoNow(),
    })
    this.activeSessionId = browserSessionId
    const userId = normalizeRouteUserId(meta.userId)
    if (userId) this.activeSessionByUser.set(userId, browserSessionId)
    return session.meta
  }

  listSessions(args = {}) {
    this.cleanupExpiredSessions()
    const userId = normalizeRouteUserId(args.userId)
    const sessions = [...this.sessions.values()].filter((session) => {
      if (!userId) return false
      return normalizeRouteUserId(session.meta?.userId) === userId
    })
    return sessions.map((session) => ({
      ...session.meta,
      queuedRequests: session.queue.length,
      pollers: session.pollers.length,
      networkEvents: this.networkEvents.filter(
        (event) => event.browserSessionId === session.browserSessionId
      ).length,
      cdpEvents: this.cdpEvents.filter(
        (event) => event.browserSessionId === session.browserSessionId
      ).length,
      active: session.browserSessionId === this.activeSessionId,
    }))
  }

  health(args = {}) {
    this.cleanupExpiredSessions()
    const userId = normalizeRouteUserId(args.userId)
    const sessions = this.listSessions({ userId })
    const activeSessionId = userId
      ? this.activeSessionByUser.get(userId) || null
      : null
    const browserControllerSessionId = userId
      ? this.browserControllerByUser.get(userId) || null
      : null
    const controllerCount = sessions.filter((session) => isBrowserControllerMeta(session)).length
    const pageSessionCount = sessions.length - controllerCount
    const rawSessions = [...this.sessions.values()].filter(
      (session) => !userId || normalizeRouteUserId(session.meta?.userId) === userId
    )
    const compatibilitySessions = rawSessions.filter(isBrowserControllerSession)
    return {
      ok: true,
      name: "yunti-browser-runtime-bridge",
      runtime: {
        version: this.runtimeVersion || null,
        expectedExtensionVersion: this.expectedExtensionVersion || null,
        expectedProtocolVersion: this.expectedProtocolVersion,
      },
      activeSessionId,
      browserControllerSessionId,
      browserControllerSessionIds: userId ? this.controllerSessionIdsForUser(userId) : [],
      extensionConnected: controllerCount > 0 || pageSessionCount > 0,
      pageSessionCount,
      controllerCount,
      sessions,
      sessionCount: this.sessions.size,
      visibleSessionCount: sessions.length,
      compatibility: this.compatibilitySummary(
        compatibilitySessions.length ? compatibilitySessions : rawSessions
      ),
    }
  }

  sessionIdsForUser(userId) {
    this.cleanupExpiredSessions()
    const routeUserId = normalizeRouteUserId(userId)
    if (!routeUserId) return new Set()
    return new Set(
      [...this.sessions.values()]
        .filter((session) => normalizeRouteUserId(session.meta?.userId) === routeUserId)
        .map((session) => session.browserSessionId)
    )
  }

  listPages(args = {}) {
    this.cleanupExpiredSessions()
    const userId = requireRouteUserId(args, "yunti_list_pages")
    const activeSessionId = this.activeSessionByUser.get(userId) || null
    const sessions = [...this.sessions.values()].filter((session) => {
      return normalizeRouteUserId(session.meta?.userId) === userId
    })
    const pages = sessions.filter((session) => !isBrowserControllerSession(session)).map((session) => {
      const meta = session.meta || {}
      return {
        browserSessionId: session.browserSessionId,
        pageHandleId: meta.pageHandleId || "",
        url: meta.url || "",
        title: meta.title || "",
        tabId: meta.tabId ?? null,
        windowId: meta.windowId ?? null,
        active: session.browserSessionId === activeSessionId,
        userId: meta.userId || "",
        displayName: meta.displayName || "",
        browserInstanceId: normalizeBrowserInstanceId(meta),
        browserControllerSessionId: meta.browserControllerSessionId || "",
        clientFamily: meta.client?.family || "",
        registeredAt: meta.registeredAt || meta.updatedAt || "",
      }
    })
    return { pages, activeSessionId }
  }

  selectPage(browserSessionId, args = {}) {
    this.cleanupExpiredSessions()
    const session = this.getLiveSession(browserSessionId)
    if (!browserSessionId || !session) {
      throw staleSessionError(browserSessionId, "not registered or heartbeat expired")
    }
    const meta = session.meta
    if (isBrowserControllerSession(session)) {
      throw new Error("yunti_select_page requires a concrete page session, not the browser controller route.")
    }
    const routeUserId = requireRouteUserId(args, "yunti_select_page")
    if (normalizeRouteUserId(meta.userId) !== routeUserId) {
      throw new Error(`browser session is not owned by userId: ${routeUserId}`)
    }
    this.refreshSession(session, Date.now(), {
      lastActivatedAt: isoNow(),
    })
    this.activeSessionId = browserSessionId
    const userId = normalizeRouteUserId(meta.userId)
    if (userId) this.activeSessionByUser.set(userId, browserSessionId)
    return {
      browserSessionId,
      url: meta.url || "",
      title: meta.title || "",
      tabId: meta.tabId ?? null,
      active: true,
      userId: meta.userId || "",
    }
  }

  resolveSessionId(args) {
    this.cleanupExpiredSessions()
    const userId = requireRouteUserId(args, "Yunti browser session routing")
    const explicit = String(args?.browserSessionId || "").trim()
    const browserSessionId = explicit || this.activeSessionByUser.get(userId) || ""
    const session = browserSessionId ? this.getLiveSession(browserSessionId) : null
    if (!session) {
      throw staleSessionError(browserSessionId || "none", "no live page session is selected")
    }
    if (isBrowserControllerSession(session)) {
      throw new Error("This operation requires a concrete page session, not the browser controller route.")
    }
    if (normalizeRouteUserId(session.meta?.userId) !== userId) {
      throw new Error(`browser session is not owned by userId: ${userId}`)
    }
    return browserSessionId
  }

  selectControllerSession(userId, {
    pageSession = null,
    explicitControllerId = "",
    requestedTabId = null,
    requestedBrowserInstanceId = "",
  } = {}) {
    const allControllers = this.controllerSessionsForUser(userId)
    if (!allControllers.length) return null
    const compatibleControllers = allControllers.filter(
      (session) => this.sessionCompatibility(session).ok
    )
    if (!compatibleControllers.length) {
      throw this.incompatibleExtensionError(this.compatibilitySummary(allControllers))
    }
    if (explicitControllerId) {
      const explicit = allControllers.find(
        (session) => session.browserSessionId === explicitControllerId
      )
      if (explicit && !this.sessionCompatibility(explicit).ok) {
        throw this.incompatibleExtensionError(this.compatibilitySummary([explicit]))
      }
      if (explicit) return explicit
    }
    const pageControllerId = String(pageSession?.meta?.browserControllerSessionId || "").trim()
    if (pageControllerId) {
      const exact = compatibleControllers.find(
        (session) => session.browserSessionId === pageControllerId
      )
      if (exact) return exact
    }
    const browserInstanceId = String(
      requestedBrowserInstanceId || normalizeBrowserInstanceId(pageSession?.meta)
    ).trim()
    if (browserInstanceId) {
      const instanceMatches = compatibleControllers.filter(
        (session) => normalizeBrowserInstanceId(session.meta) === browserInstanceId
      )
      if (instanceMatches.length === 1) return instanceMatches[0]
    }
    if (requestedTabId) {
      const tabMatches = compatibleControllers.filter((session) =>
        Array.isArray(session.meta?.liveTabIds) &&
        session.meta.liveTabIds.map(normalizeTabId).includes(requestedTabId)
      )
      if (tabMatches.length === 1) return tabMatches[0]
      if (tabMatches.length > 1) {
        throw new Error(
          `YUNTI_BROWSER_INSTANCE_AMBIGUOUS: tabId ${requestedTabId} exists in more than one connected browser. Pass a page browserSessionId or browserInstanceId from yunti_list_browser_targets. retryable=false retryBudget=0`
        )
      }
    }
    const preferredId = this.browserControllerByUser.get(userId) || ""
    return compatibleControllers.find((session) => session.browserSessionId === preferredId) ||
      compatibleControllers.at(-1)
  }

  // Resolves a stable page handle to its owning live controller and tab. This is
  // the bounded resolver from STABLE_PAGE_HANDLE_PLAN.md: it never activates a
  // tab, never mints a handle, and fails terminally when the tab or its browser
  // instance is gone.
  resolveHandleRoute(userId, parsedHandle) {
    const controllers = this.controllerSessionsForUser(userId, { compatibleOnly: true })
    const matchingInstance = controllers.filter(
      (session) =>
        browserInstanceSuffix(session.meta) === parsedHandle.browserInstanceSuffix
    )
    if (matchingInstance.length === 0) {
      return {
        ok: false,
        code: "PAGE_HANDLE_CLOSED",
        message: `YUNTI_PAGE_HANDLE_CLOSED: the browser instance that owns ${parsedHandle.raw} is not connected. The handle is terminal for this request. retryable=false retryBudget=0`,
      }
    }
    if (matchingInstance.length > 1) {
      return {
        ok: false,
        code: "PAGE_HANDLE_AMBIGUOUS",
        message: `YUNTI_PAGE_HANDLE_AMBIGUOUS: more than one connected browser instance matches ${parsedHandle.raw}. Retry after the stale browser instance disconnects. retryable=false retryBudget=0`,
      }
    }
    const controller = matchingInstance[0]
    const liveTabIds = controllerLiveTabIds(controller)
    if (liveTabIds && !liveTabIds.has(parsedHandle.tabId)) {
      return {
        ok: false,
        code: "PAGE_HANDLE_CLOSED",
        message: `YUNTI_PAGE_HANDLE_CLOSED: tab ${parsedHandle.tabId} no longer exists in the owning browser instance, so ${parsedHandle.raw} is closed. retryable=false retryBudget=0`,
      }
    }
    const expectedGeneration = handleGenerationFor(controller, parsedHandle.tabId)
    if (expectedGeneration !== null && expectedGeneration !== parsedHandle.generation) {
      return {
        ok: false,
        code: "PAGE_HANDLE_STALE",
        message: `YUNTI_PAGE_HANDLE_STALE: ${parsedHandle.raw} refers to generation ${parsedHandle.generation}, but tab ${parsedHandle.tabId} is generation ${expectedGeneration}. The numeric tab id was reused; list targets again for the current handle. retryable=false retryBudget=0`,
      }
    }
    return { ok: true, controller, liveTabIds }
  }

  resolveToolRoute(args, tool = "") {
    this.cleanupExpiredSessions()
    const userId =
      args && typeof args === "object" && !Array.isArray(args)
        ? requireRouteUserId(args, "Yunti browser session routing")
        : requireRouteUserId({}, "Yunti browser session routing")
    const explicit =
      args && typeof args === "object" && !Array.isArray(args)
        ? String(args.browserSessionId || "").trim()
        : ""
    const requestedTabId =
      normalizeTabId(args?.tabId) ||
      tabIdFromTargetId(args?.targetId) ||
      tabIdFromTargetId(args?.params?.targetId)
    const requestedBrowserInstanceId = String(args?.browserInstanceId || "").trim()
    const rawHandle = String(args?.pageHandleId || "").trim()
    const parsedHandle = rawHandle ? parsePageHandleId(rawHandle) : null
    if (rawHandle && !parsedHandle) {
      throw new Error(
        `YUNTI_PAGE_HANDLE_INVALID: ${rawHandle} is not a page handle. pageHandleId is opaque; pass a value returned by yunti_list_browser_targets without editing it. retryable=false retryBudget=0`
      )
    }
    const handleRoute = parsedHandle ? this.resolveHandleRoute(userId, parsedHandle) : null
    if (handleRoute && !handleRoute.ok) {
      throw new Error(handleRoute.message)
    }
    if (handleRoute && requestedTabId && requestedTabId !== parsedHandle.tabId) {
      throw new Error(
        `YUNTI_PAGE_HANDLE_ROUTE_MISMATCH: pageHandleId ${rawHandle} resolves to tab ${parsedHandle.tabId}, but tabId ${requestedTabId} was also supplied. Pass only one route. retryable=false retryBudget=0`
      )
    }
    if (
      handleRoute &&
      requestedBrowserInstanceId &&
      browserInstanceSuffix(handleRoute.controller.meta) !==
        requestedBrowserInstanceId.replace(/^yunti-browser-/, "")
    ) {
      throw new Error(
        `YUNTI_PAGE_HANDLE_ROUTE_MISMATCH: pageHandleId ${rawHandle} belongs to browser instance ${browserInstanceSuffix(handleRoute.controller.meta)}, not ${requestedBrowserInstanceId}. retryable=false retryBudget=0`
      )
    }
    const explicitSession = explicit ? this.getLiveSession(explicit) : null
    if (
      handleRoute &&
      explicitSession &&
      !isBrowserControllerSession(explicitSession) &&
      normalizeTabId(explicitSession.meta?.tabId) !== parsedHandle.tabId
    ) {
      throw new Error(
        `YUNTI_PAGE_HANDLE_ROUTE_MISMATCH: pageHandleId ${rawHandle} resolves to tab ${parsedHandle.tabId}, but browserSessionId ${explicit} is registered for tab ${normalizeTabId(explicitSession.meta?.tabId) ?? "unknown"}. retryable=false retryBudget=0`
      )
    }
    // A stale session id is recoverable on its own, but it must not silently
    // denote a different tab than the handle the caller selected.
    if (handleRoute && explicit && !explicitSession) {
      const staleTabId = tabIdFromBrowserSessionId(explicit)
      if (staleTabId && staleTabId !== parsedHandle.tabId) {
        throw new Error(
          `YUNTI_PAGE_HANDLE_ROUTE_MISMATCH: pageHandleId ${rawHandle} resolves to tab ${parsedHandle.tabId}, but the stale browserSessionId ${explicit} denotes tab ${staleTabId}. retryable=false retryBudget=0`
        )
      }
    }
    if (handleRoute && !handleRouteAllowsTool(tool)) {
      throw new Error(
        `YUNTI_PAGE_HANDLE_UNSUPPORTED_TOOL: ${tool || "this tool"} is a browser-level operation and does not accept pageHandleId. Use the documented browserSessionId or tabId/targetId contract for it. retryable=false retryBudget=0`
      )
    }
    if (handleRoute) {
      const pageSession = [...this.sessions.values()].find(
        (session) =>
          !isBrowserControllerSession(session) &&
          normalizeRouteUserId(session.meta?.userId) === userId &&
          normalizeTabId(session.meta?.tabId) === parsedHandle.tabId &&
          normalizeBrowserInstanceId(session.meta) ===
            normalizeBrowserInstanceId(handleRoute.controller.meta)
      )
      return {
        userId,
        logicalSessionId: pageSession?.browserSessionId || parsedHandle.raw,
        transportSessionId: handleRoute.controller.browserSessionId,
        targetTabId: parsedHandle.tabId,
        requestedSessionId: pageSession?.browserSessionId || "",
        pageHandleId: parsedHandle.raw,
        viaController: true,
      }
    }
    if (explicitSession && normalizeRouteUserId(explicitSession.meta?.userId) !== userId) {
      throw new Error(`browser session is not owned by userId: ${userId}`)
    }
    const inferredControllerId = explicitSession && isBrowserControllerSession(explicitSession)
      ? explicit
      : controllerIdFromPageSessionId(explicit)
    const controllerSession = this.selectControllerSession(userId, {
      pageSession: explicitSession && !isBrowserControllerSession(explicitSession)
        ? explicitSession
        : null,
      explicitControllerId: inferredControllerId,
      requestedTabId,
      requestedBrowserInstanceId,
    })
    const controllerSessionId = controllerSession?.browserSessionId || ""
    const controllerCanRoutePages = supportsControllerPageRouting(controllerSession)

    if (explicit) {
      const session = explicitSession
      if (!session) {
        if (controllerSession && BROWSER_CONTROLLER_TOOLS.has(tool)) {
          return {
            userId,
            logicalSessionId: controllerSessionId,
            transportSessionId: controllerSessionId,
            targetTabId: requestedTabId,
            requestedSessionId: explicit,
            viaController: true,
            recoveredStaleRoute: true,
          }
        }
        const recoveredTabId = requestedTabId || tabIdFromBrowserSessionId(explicit)
        if (controllerCanRoutePages && recoveredTabId) {
          return {
            userId,
            logicalSessionId: explicit,
            transportSessionId: controllerSessionId,
            targetTabId: recoveredTabId,
            requestedSessionId: explicit,
            viaController: true,
            recoveredStaleRoute: true,
          }
        }
        throw staleSessionError(explicit, "not registered or heartbeat expired")
      }
      if (isBrowserControllerSession(session)) {
        if (!BROWSER_CONTROLLER_TOOLS.has(tool) && !supportsControllerPageRouting(session)) {
          throw new Error(`${tool || "This tool"} requires a concrete page session. Reload the Yunti 0.2.3+ extension to enable automatic page recovery through the browser controller.`)
        }
        return {
          userId,
          logicalSessionId: explicit,
          transportSessionId: explicit,
          targetTabId: requestedTabId,
          requestedSessionId: explicit,
          viaController: true,
        }
      }
      if (controllerCanRoutePages) {
        return {
          userId,
          logicalSessionId: explicit,
          transportSessionId: controllerSessionId,
          targetTabId: requestedTabId || normalizeTabId(session.meta?.tabId),
          requestedSessionId: explicit,
          viaController: true,
        }
      }
      if (!this.sessionCompatibility(session).ok) {
        throw this.incompatibleExtensionError(this.compatibilitySummary([session]))
      }
      return {
        userId,
        logicalSessionId: explicit,
        transportSessionId: explicit,
        targetTabId: requestedTabId || normalizeTabId(session.meta?.tabId),
        requestedSessionId: explicit,
        viaController: false,
      }
    }
    if (BROWSER_CONTROLLER_TOOLS.has(tool) && controllerSessionId) {
      if (controllerSession && normalizeRouteUserId(controllerSession.meta?.userId) === userId) {
        return {
          userId,
          logicalSessionId: controllerSessionId,
          transportSessionId: controllerSessionId,
          targetTabId: requestedTabId,
          requestedSessionId: "",
          viaController: true,
        }
      }
    }
    const userSessionId = this.activeSessionByUser.get(userId)
    if (!userSessionId) {
      if (controllerCanRoutePages) {
        return {
          userId,
          logicalSessionId: controllerSessionId,
          transportSessionId: controllerSessionId,
          targetTabId: requestedTabId,
          requestedSessionId: "",
          viaController: true,
        }
      }
      if (controllerSession) {
        throw new Error(`Yunti extension is connected for userId: ${userId}, but the loaded extension cannot auto-recover page sessions. Reload the Yunti 0.2.3+ extension.`)
      }
      throw new Error(`No Yunti browser route is connected for userId: ${userId}. ${sessionRecoveryHint()}`)
    }
    const staleCandidate = this.sessions.get(userSessionId)
    const staleCandidateTabId = normalizeTabId(staleCandidate?.meta?.tabId)
    const session = this.getLiveSession(userSessionId)
    if (!session) {
      if (controllerCanRoutePages && (requestedTabId || staleCandidateTabId)) {
        return {
          userId,
          logicalSessionId: userSessionId,
          transportSessionId: controllerSessionId,
          targetTabId: requestedTabId || staleCandidateTabId,
          requestedSessionId: userSessionId,
          viaController: true,
          recoveredStaleRoute: true,
        }
      }
      throw staleSessionError(userSessionId, "active route heartbeat expired")
    }
    if (normalizeRouteUserId(session.meta?.userId) !== userId) {
      throw new Error(`browser session is not owned by userId: ${userId}`)
    }
    const activeController = this.selectControllerSession(userId, {
      pageSession: session,
      requestedTabId: requestedTabId || normalizeTabId(session.meta?.tabId),
      requestedBrowserInstanceId,
    })
    if (supportsControllerPageRouting(activeController)) {
      return {
        userId,
        logicalSessionId: userSessionId,
        transportSessionId: activeController.browserSessionId,
        targetTabId: requestedTabId || normalizeTabId(session.meta?.tabId),
        requestedSessionId: userSessionId,
        viaController: true,
      }
    }
    if (!this.sessionCompatibility(session).ok) {
      throw this.incompatibleExtensionError(this.compatibilitySummary([session]))
    }
    return {
      userId,
      logicalSessionId: userSessionId,
      transportSessionId: userSessionId,
      targetTabId: requestedTabId || normalizeTabId(session.meta?.tabId),
      requestedSessionId: userSessionId,
      viaController: false,
    }
  }

  async callTool(tool, args = {}, timeoutMs = DEFAULT_TOOL_TIMEOUT_MS) {
    const routeUserId = requireRouteUserId(args, tool || "Yunti browser tool")
    this.assertUserExtensionCompatibility(routeUserId)
    const hasExplicitRoute = Boolean(String(args?.browserSessionId || "").trim())
    if (
      !hasExplicitRoute &&
      (tool === "yunti_list_browser_targets" || tool === "yunti_list_pages")
    ) {
      const userId = routeUserId
      const controllers = this.controllerSessionsForUser(userId, { compatibleOnly: true })
      if (controllers.length > 1) {
        const outcomes = await Promise.allSettled(
          controllers.map((controller) => this.callTool(tool, {
            ...args,
            browserSessionId: controller.browserSessionId,
          }, timeoutMs))
        )
        const successful = outcomes
          .map((outcome, index) => ({ outcome, controller: controllers[index] }))
          .filter(({ outcome }) => outcome.status === "fulfilled")
        if (!successful.length) {
          throw new Error(
            `Yunti could not list targets from any connected browser controller: ${outcomes
              .map((outcome) => outcome.reason?.message || "unknown failure")
              .join("; ")}`
          )
        }
        const browsers = successful.map(({ outcome, controller }) => ({
          browserInstanceId: normalizeBrowserInstanceId(controller.meta),
          browserFamily: controller.meta?.client?.family || "unknown",
          routeBrowserSessionId: controller.browserSessionId,
          result: outcome.value,
        }))
        const pages = browsers.flatMap((browser) =>
          (Array.isArray(browser.result?.pages) ? browser.result.pages : []).map((page) => ({
            ...page,
            browserInstanceId: page.browserInstanceId || browser.browserInstanceId,
            browserFamily: page.browserFamily || browser.browserFamily,
            routeBrowserSessionId: page.routeBrowserSessionId || browser.routeBrowserSessionId,
          }))
        )
        const targets = browsers.flatMap((browser) =>
          (Array.isArray(browser.result?.targets) ? browser.result.targets : []).map((target) => ({
            ...target,
            browserInstanceId: target.browserInstanceId || browser.browserInstanceId,
            browserFamily: target.browserFamily || browser.browserFamily,
            routeBrowserSessionId: target.routeBrowserSessionId || browser.routeBrowserSessionId,
          }))
        )
        return {
          browserSessionId: null,
          routeBrowserSessionIds: browsers.map((browser) => browser.routeBrowserSessionId),
          multiBrowser: true,
          browserCount: browsers.length,
          browsers,
          pages,
          targets,
          targetInfos: targets,
          pageCount: pages.length,
          total: targets.length,
          partial: successful.length !== outcomes.length,
          browserErrors: outcomes.flatMap((outcome, index) => outcome.status === "rejected"
            ? [{
                routeBrowserSessionId: controllers[index].browserSessionId,
                error: outcome.reason?.message || String(outcome.reason || "unknown failure"),
              }]
            : []),
          method: "Target.getTargets",
          source: "bridge.multi-browser",
          listedAt: new Date().toISOString(),
        }
      }
    }
    const route = this.resolveToolRoute(args, tool)
    const browserSessionId = route.logicalSessionId
    const transportSessionId = route.transportSessionId
    const session = this.sessions.get(transportSessionId)
    const requestId = randomUUID()
    const payload = {
      type: "tool_request",
      id: requestId,
      tool,
      arguments: stripBrowserSessionId(args),
      route: {
        browserSessionId,
        requestedBrowserSessionId: route.requestedSessionId,
        tabId: route.targetTabId,
        targetId: String(args?.targetId || args?.params?.targetId || ""),
        pageHandleId: route.pageHandleId || "",
        viaController: route.viaController,
        recoveredStaleRoute: Boolean(route.recoveredStaleRoute),
      },
      createdAt: new Date().toISOString(),
      deadlineAt: Date.now() + timeoutMs,
    }

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        session.queue = session.queue.filter((request) => request.id !== requestId)
        this.recordActivity({
          type: "tool-result",
          tool,
          browserSessionId,
          status: "timeout",
          message: `Timed out waiting for browser tool result: ${tool}`,
        })
        reject(new Error(`Timed out waiting for browser tool result: ${tool}`))
      }, timeoutMs)
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timer,
        browserSessionId,
        transportSessionId,
        tool,
      })
    })

    const poller = session.pollers.shift()
    if (poller) {
      poller(payload)
    } else {
      session.queue.push(payload)
    }
    this.recordActivity({
      type: "tool-request",
      tool,
      browserSessionId,
      status: poller ? "sent" : "queued",
      summary: { transportSessionId, targetTabId: route.targetTabId },
    })
    return promise
  }

  recordNetworkEvent(input) {
    this.cleanupExpiredSessions()
    const event = sanitizeNetworkEvent(input || {}, this.nextNetworkEventId++)
    if (!event.browserSessionId) return { accepted: false, error: "browserSessionId is required" }
    if (!this.getLiveSession(event.browserSessionId)) {
      return { accepted: false, error: staleSessionError(event.browserSessionId).message }
    }
    this.networkEvents.push(event)
    if (this.networkEvents.length > MAX_NETWORK_EVENTS) {
      this.networkEvents.splice(0, this.networkEvents.length - MAX_NETWORK_EVENTS)
    }
    return { accepted: true, event }
  }

  recordCdpEvent(input) {
    this.cleanupExpiredSessions()
    const event = normalizeCdpEvent(input || {}, this.nextCdpEventId++)
    if (!event.browserSessionId) return { accepted: false, error: "browserSessionId is required" }
    if (!event.method) return { accepted: false, error: "method is required" }
    if (!this.getLiveSession(event.browserSessionId)) {
      return { accepted: false, error: staleSessionError(event.browserSessionId).message }
    }
    this.cdpEvents.push(event)
    if (this.cdpEvents.length > MAX_CDP_EVENTS) {
      this.cdpEvents.splice(0, this.cdpEvents.length - MAX_CDP_EVENTS)
    }
    return { accepted: true, event }
  }

  listNetworkEvents(args = {}) {
    const limit = clampNumber(args.limit || 100, 1, 500, 100)
    const sinceId = Number(args.sinceId || 0)
    const method = String(args.method || "").trim().toUpperCase()
    const urlContains = String(args.urlContains || "").trim().toLowerCase()
    const browserSessionIds = args.allSessions
      ? this.sessionIdsForUser(requireRouteUserId(args, "yunti_get_network_log"))
      : new Set([this.resolveSessionId(args)])
    let events = this.networkEvents
    events = events.filter((event) => browserSessionIds.has(event.browserSessionId))
    if (Number.isFinite(sinceId) && sinceId > 0) {
      events = events.filter((event) => event.id > sinceId)
    }
    if (method) events = events.filter((event) => event.method === method)
    if (urlContains) {
      events = events.filter((event) => String(event.url || "").toLowerCase().includes(urlContains))
    }
    const total = events.length
    events = events.slice(-limit)
    return { events, total, returned: events.length }
  }

  clearNetworkEvents(args = {}) {
    if (args.allSessions) {
      const browserSessionIds = this.sessionIdsForUser(requireRouteUserId(args, "yunti_clear_network_log"))
      const before = this.networkEvents.length
      this.networkEvents = this.networkEvents.filter(
        (event) => !browserSessionIds.has(event.browserSessionId)
      )
      return { deleted: before - this.networkEvents.length }
    }
    const browserSessionId = this.resolveSessionId(args)
    const before = this.networkEvents.length
    this.networkEvents = this.networkEvents.filter((event) => event.browserSessionId !== browserSessionId)
    return { deleted: before - this.networkEvents.length }
  }

  getNetworkRequest(args = {}) {
    const id = Number(args.eventId)
    if (!Number.isFinite(id)) throw new Error("eventId is required")
    const browserSessionId = this.resolveSessionId(args)
    const event = this.networkEvents.find(e => e.id === id)
    if (!event) throw new Error(`network request not found: ${id}`)
    if (event.browserSessionId !== browserSessionId) {
      throw new Error(`network request not found for browserSessionId: ${browserSessionId}`)
    }
    return event
  }

  listCdpEvents(args = {}) {
    const limit = clampNumber(args.limit || 100, 1, 500, 100)
    const sinceId = Number(args.sinceId || 0)
    const method = String(args.method || "").trim()
    const browserSessionIds = args.allSessions
      ? this.sessionIdsForUser(requireRouteUserId(args, "yunti_get_cdp_events"))
      : new Set([this.resolveSessionId(args)])
    let events = this.cdpEvents
    events = events.filter((event) => browserSessionIds.has(event.browserSessionId))
    if (Number.isFinite(sinceId) && sinceId > 0) {
      events = events.filter((event) => event.id > sinceId)
    }
    if (method) events = events.filter((event) => event.method === method)
    const total = events.length
    events = events.slice(-limit)
    return { events, total, returned: events.length }
  }

  clearCdpEvents(args = {}) {
    if (args.allSessions) {
      const browserSessionIds = this.sessionIdsForUser(requireRouteUserId(args, "yunti_clear_cdp_events"))
      const before = this.cdpEvents.length
      this.cdpEvents = this.cdpEvents.filter(
        (event) => !browserSessionIds.has(event.browserSessionId)
      )
      return { deleted: before - this.cdpEvents.length }
    }
    const browserSessionId = this.resolveSessionId(args)
    const before = this.cdpEvents.length
    this.cdpEvents = this.cdpEvents.filter((event) => event.browserSessionId !== browserSessionId)
    return { deleted: before - this.cdpEvents.length }
  }

  recordConsoleEvent(input) {
    this.cleanupExpiredSessions()
    const event = {
      id: this.nextConsoleMsgId++,
      browserSessionId: truncateText(input.browserSessionId || "", 160),
      tabId: Number.isFinite(Number(input.tabId)) ? Number(input.tabId) : null,
      level: ["error", "warning", "info", "debug", "log", "verbose"].includes(input.level) ? input.level : "log",
      text: redactLikelySensitiveText(input.text || "", 2000),
      source: ["console-api", "javascript", "network", "other"].includes(input.source) ? input.source : "other",
      url: input.url ? sanitizeUrl(input.url) : "",
      lineNumber: Number.isFinite(Number(input.lineNumber)) ? Number(input.lineNumber) : null,
      columnNumber: Number.isFinite(Number(input.columnNumber)) ? Number(input.columnNumber) : null,
      stackTrace: input.stackTrace ? redactLikelySensitiveText(input.stackTrace, 4000) : "",
      args: Array.isArray(input.args) ? input.args.slice(0, 20).map(a => redactLikelySensitiveText(a, 500)) : [],
      timestamp: input.timestamp || new Date().toISOString(),
    }
    if (!event.browserSessionId) return { accepted: false, error: "browserSessionId is required" }
    if (!this.getLiveSession(event.browserSessionId)) {
      return { accepted: false, error: staleSessionError(event.browserSessionId).message }
    }
    this.consoleMessages.push(event)
    if (this.consoleMessages.length > MAX_CONSOLE_MESSAGES) {
      this.consoleMessages.splice(0, this.consoleMessages.length - MAX_CONSOLE_MESSAGES)
    }
    return { accepted: true, event }
  }

  listConsoleMessages(args = {}) {
    const limit = clampNumber(args.limit || 100, 1, 500, 100)
    const sinceId = Number(args.sinceId || 0)
    const level = String(args.level || "").trim().toLowerCase()
    const source = String(args.source || "").trim().toLowerCase()
    const browserSessionIds = args.allSessions
      ? this.sessionIdsForUser(requireRouteUserId(args, "yunti_list_console_messages"))
      : new Set([this.resolveSessionId(args)])

    let events = this.consoleMessages
    events = events.filter(e => browserSessionIds.has(e.browserSessionId))
    if (Number.isFinite(sinceId) && sinceId > 0) {
      events = events.filter(e => e.id > sinceId)
    }
    if (level) events = events.filter(e => e.level === level)
    if (source) events = events.filter(e => e.source === source)
    const total = events.length
    events = events.slice(-limit).reverse()
    return { events, total, returned: events.length }
  }

  getConsoleMessage(args = {}) {
    const id = Number(args.msgId)
    if (!Number.isFinite(id)) throw new Error("msgId is required")
    const browserSessionId = this.resolveSessionId(args)
    const msg = this.consoleMessages.find(e => e.id === id)
    if (!msg) throw new Error(`console message not found: ${id}`)
    if (msg.browserSessionId !== browserSessionId) {
      throw new Error(`console message not found for browserSessionId: ${browserSessionId}`)
    }
    return msg
  }

  clearConsoleMessages(args = {}) {
    if (args.allSessions) {
      const browserSessionIds = this.sessionIdsForUser(requireRouteUserId(args, "yunti_clear_console_messages"))
      const before = this.consoleMessages.length
      this.consoleMessages = this.consoleMessages.filter(
        e => !browserSessionIds.has(e.browserSessionId)
      )
      return { deleted: before - this.consoleMessages.length }
    }
    const browserSessionId = this.resolveSessionId(args)
    const before = this.consoleMessages.length
    this.consoleMessages = this.consoleMessages.filter(e => e.browserSessionId !== browserSessionId)
    return { deleted: before - this.consoleMessages.length }
  }

  async callBridgeLocalTool(tool, args = {}) {
    switch (tool) {
      case "yunti_select_page":
        return this.selectPage(String(args.browserSessionId || ""), args)
      case "yunti_get_network_log":
        return this.listNetworkEvents(args)
      case "yunti_list_network_requests":
        return this.listNetworkEvents(args)
      case "yunti_get_network_request":
        return this.getNetworkRequest(args)
      case "yunti_clear_network_log":
      case "yunti_clear_network_requests":
        return this.clearNetworkEvents(args)
      case "yunti_get_cdp_events":
        return this.listCdpEvents(args)
      case "yunti_clear_cdp_events":
        return this.clearCdpEvents(args)
      case "yunti_list_console_messages":
        return this.listConsoleMessages(args)
      case "yunti_get_console_message":
        return this.getConsoleMessage(args)
      case "yunti_clear_console_messages":
        return this.clearConsoleMessages(args)
      case "yunti_remember_learning":
        return rememberLearning(args)
      case "yunti_get_learning_memory":
        return getLearningMemory(args)
      case "yunti_forget_learning_memory":
        return forgetLearningMemory(args)
      case "yunti_get_tool_usage_hints":
        return toolUsageHints(args)
      default:
        throw new Error(`unknown bridge-local tool: ${tool}`)
    }
  }

  async poll(browserSessionId, timeoutMs = 25_000, signal = null) {
    this.cleanupExpiredSessions()
    const session = this.getLiveSession(browserSessionId)
    if (!session) {
      throw staleSessionError(browserSessionId, "not registered or heartbeat expired")
    }
    this.refreshSession(session)
    if (isBrowserControllerSession(session)) {
      this.refreshPageSessionsForController(session)
    }
    if (signal?.aborted) return { type: "noop", id: randomUUID(), aborted: true }
    while (session.queue.length > 0) {
      const request = session.queue.shift()
      if (this.pendingRequests.has(request.id) && request.deadlineAt > Date.now()) return request
    }

    return new Promise((resolve) => {
      let settled = false
      const removePoller = () => {
        session.pollers = session.pollers.filter((poller) => poller !== finish)
      }
      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener?.("abort", onAbort)
      }
      const onAbort = () => finish({ type: "noop", id: randomUUID(), aborted: true })
      const timer = setTimeout(() => {
        finish({ type: "noop", id: randomUUID() })
      }, Math.max(1000, Math.min(timeoutMs, 30_000)))
      const finish = (value) => {
        if (settled) return
        settled = true
        removePoller()
        cleanup()
        resolve(value)
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener?.("abort", onAbort, { once: true })
      session.pollers.push(finish)
    })
  }

  submitResult({ browserSessionId, requestId, ok, result, error, failure = null }) {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) return { accepted: false }
    if (browserSessionId && pending.transportSessionId !== browserSessionId) {
      return { accepted: false, error: "browserSessionId mismatch" }
    }
    clearTimeout(pending.timer)
    this.pendingRequests.delete(requestId)
    if (ok) {
      this.recordActivity({
        type: "tool-result",
        tool: pending.tool,
        browserSessionId: pending.browserSessionId,
        status: "ok",
        summary: summarizeObject(result),
      })
      pending.resolve(result ?? null)
    } else {
      const message = error || "Browser tool failed"
      const structured = normalizeStructuredFailure(failure)
      this.recordActivity({
        type: "tool-result",
        tool: pending.tool,
        browserSessionId: pending.browserSessionId,
        status: "error",
        message,
        summary: summarizeFailure(structured) || undefined,
      })
      // Propagate the extension's structured failure so the MCP layer can keep
      // code / retryable / retryBudget / recoveryAction / resultUncertain instead
      // of degrading every browser-side error to a generic YUNTI_TOOL_ERROR.
      pending.reject(withStructuredFailure(new Error(message), structured))
    }
    return { accepted: true }
  }

  cancelPendingRequests(args = {}) {
    this.cleanupExpiredSessions()
    const userId = normalizeRouteUserId(args.userId)
    const explicitSessionId = String(args.browserSessionId || "").trim()
    const browserSessionIds = explicitSessionId
      ? new Set([explicitSessionId])
      : userId
        ? this.sessionIdsForUser(userId)
        : new Set([...this.sessions.keys()])
    const reason = redactLikelySensitiveText(
      args.reason || "cancelled from local runtime console",
      240
    )
    let queuedCancelled = 0
    const queuedRequestIds = new Set()
    for (const session of this.sessions.values()) {
      if (!browserSessionIds.has(session.browserSessionId)) continue
      queuedCancelled += session.queue.length
      for (const item of session.queue) {
        queuedRequestIds.add(item.id)
        const pending = this.pendingRequests.get(item.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pendingRequests.delete(item.id)
          pending.reject(new Error(reason))
        }
        this.recordActivity({
          type: "tool-result",
          tool: item.tool,
          browserSessionId: session.browserSessionId,
          status: "cancelled",
          message: reason,
        })
      }
      session.queue = []
    }
    let pendingCancelled = 0
    for (const [requestId, pending] of [...this.pendingRequests.entries()]) {
      if (queuedRequestIds.has(requestId)) continue
      if (!browserSessionIds.has(pending.browserSessionId)) continue
      clearTimeout(pending.timer)
      this.pendingRequests.delete(requestId)
      pending.reject(new Error(reason))
      pendingCancelled += 1
      this.recordActivity({
        type: "tool-result",
        tool: pending.tool,
        browserSessionId: pending.browserSessionId,
        status: "cancelled",
        message: reason,
      })
    }
    return {
      ok: true,
      pendingCancelled,
      queuedCancelled,
      note: "Only runtime pending or queued requests are cancelled; already completed browser-side effects cannot be undone.",
    }
  }

  consoleState(args = {}) {
    this.cleanupExpiredSessions()
    const userId = normalizeRouteUserId(args.userId)
    const sessions = [...this.sessions.values()]
      .filter((session) => !userId || normalizeRouteUserId(session.meta?.userId) === userId)
      .map((session) => summarizeSession(session, this.activeSessionId))
    const controllerCount = sessions.filter((session) => isBrowserControllerMeta(session)).length
    const pageSessionCount = sessions.length - controllerCount
    const rawSessions = [...this.sessions.values()].filter(
      (session) => !userId || normalizeRouteUserId(session.meta?.userId) === userId
    )
    const rawControllerSessions = rawSessions.filter(isBrowserControllerSession)
    const compatibility = this.compatibilitySummary(
      rawControllerSessions.length ? rawControllerSessions : rawSessions
    )
    const browserSessionIds = new Set(sessions.map((session) => session.browserSessionId))
    const pendingRequests = [...this.pendingRequests.entries()]
      .filter(([, pending]) => browserSessionIds.has(pending.browserSessionId))
      .map(([requestId, pending]) => ({
        requestId,
        browserSessionId: pending.browserSessionId,
        tool: pending.tool,
      }))
    const queuedRequests = [...this.sessions.values()]
      .filter((session) => browserSessionIds.has(session.browserSessionId))
      .flatMap((session) =>
        session.queue.map((item) => ({
          requestId: item.id,
          browserSessionId: session.browserSessionId,
          tool: item.tool,
          createdAt: item.createdAt || "",
        }))
      )
    return {
      ok: compatibility.ok,
      name: "yunti-browser-runtime-console",
      generatedAt: new Date().toISOString(),
      runtime: {
        version: redactLikelySensitiveText(args.runtimeVersion || "", 80),
        expectedExtensionVersion: redactLikelySensitiveText(args.expectedExtensionVersion || "", 80),
        expectedProtocolVersion: this.expectedProtocolVersion,
      },
      sessionCount: sessions.length,
      pageSessionCount,
      controllerCount,
      extensionConnected: controllerCount > 0 || pageSessionCount > 0,
      browserControllerSessionId: userId ? this.browserControllerByUser.get(userId) || null : null,
      browserControllerSessionIds: userId ? this.controllerSessionIdsForUser(userId) : [],
      activeSessionId: userId ? this.activeSessionByUser.get(userId) || null : this.activeSessionId,
      sessions,
      pendingRequests,
      queuedRequests,
      compatibility,
      diagnostics: {
        networkEvents: this.networkEvents.filter((event) => browserSessionIds.has(event.browserSessionId)).length,
        consoleMessages: this.consoleMessages.filter((event) => browserSessionIds.has(event.browserSessionId)).length,
        cdpEvents: this.cdpEvents.filter((event) => browserSessionIds.has(event.browserSessionId)).length,
        activityEvents: this.activityEvents.length,
      },
      recentActivity: this.activityEvents
        .filter((event) => !event.browserSessionId || browserSessionIds.has(event.browserSessionId))
        .slice(-30)
        .reverse(),
      warnings: consoleWarnings(sessions, {
        expectedExtensionVersion: args.expectedExtensionVersion,
        expectedProtocolVersion: this.expectedProtocolVersion,
      }),
      guidance: {
        noSessions:
          "Keep this bridge running and load or reload the extension. The background controller connects first and establishes page sessions automatically when page tools target a tab.",
        staleSession:
          "Retry through the controller with a live tabId/targetId, or list browser targets without the stale id. Refresh the page only when Chrome explicitly blocks content-script injection.",
        versionMismatch:
          "Reload the unpacked extension from the current package directory. The browser controller should reconnect automatically; page routes register on activation/update or page-tool use.",
        cancellation:
          "Cancel only clears runtime pending/queued requests; it does not undo browser-side effects that already happened.",
      },
    }
  }
}

function consoleWarnings(sessions, {
  expectedExtensionVersion = "",
  expectedProtocolVersion = null,
} = {}) {
  const warnings = []
  const controllerCount = sessions.filter((session) => isBrowserControllerMeta(session)).length
  const pageSessionCount = sessions.length - controllerCount
  if (sessions.length === 0) {
    warnings.push({
      code: "NO_EXTENSION_CONTROLLER",
      severity: "warning",
      message:
        "No browser controller is connected. Keep the bridge running and reload the Yunti extension; page refresh is not the first recovery step.",
    })
    return warnings
  }
  if (controllerCount > 0 && pageSessionCount === 0) {
    warnings.push({
      code: "NO_PAGE_SESSIONS",
      severity: "info",
      message:
        "The Yunti extension controller is online, but no concrete page session is registered yet. Pass a tabId/targetId from yunti_list_browser_targets to a page tool; the controller will register it automatically.",
    })
  }
  const expected = String(expectedExtensionVersion || "").trim()
  if (!expected) return warnings
  const compatibilitySessions = controllerCount > 0
    ? sessions.filter((session) => isBrowserControllerMeta(session))
    : sessions
  const versions = new Set(
    compatibilitySessions.map((session) => session.extensionVersion).filter(Boolean)
  )
  if (versions.size === 0) {
    warnings.push({
      code: "EXTENSION_VERSION_UNKNOWN",
      severity: "info",
      message:
        "Connected extension did not report a version. Reload the extension if you recently upgraded the runtime.",
    })
    return warnings
  }
  for (const version of versions) {
    if (version !== expected) {
      warnings.push({
        code: "EXTENSION_VERSION_MISMATCH",
        severity: "warning",
        message: `Connected extension version ${version} does not match runtime package version ${expected}. Reload the unpacked extension from the current package directory.`,
      })
    }
  }
  const expectedProtocol = Number(expectedProtocolVersion)
  if (Number.isInteger(expectedProtocol) && expectedProtocol > 0) {
    const protocols = new Set(
      compatibilitySessions.map((session) => Number(session.protocolVersion)).filter(Boolean)
    )
    if (protocols.size === 0) {
      warnings.push({
        code: "EXTENSION_PROTOCOL_UNKNOWN",
        severity: "error",
        message: `Connected extension does not report protocol ${expectedProtocol}. Reload the unpacked extension from the current package directory.`,
      })
    } else {
      for (const protocol of protocols) {
        if (protocol !== expectedProtocol) {
          warnings.push({
            code: "EXTENSION_PROTOCOL_MISMATCH",
            severity: "error",
            message: `Connected extension protocol ${protocol} does not match runtime protocol ${expectedProtocol}. Reload the unpacked extension from the current package directory.`,
          })
        }
      }
    }
  }
  return warnings
}
