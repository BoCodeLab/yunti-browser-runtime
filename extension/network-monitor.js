import { DEFAULT_PLATFORM_MATCHES, isPlatformUrl } from "./settings.js"

const NETWORK_FILTER = { urls: ["http://*/*", "https://*/*"] }
const SENSITIVE_FIELD_RE =
  /cookie|authorization|token|secret|password|passwd|pwd|sid|session|ticket|tgc|captcha|验证码|密码/i
const BRIDGE_POST_ATTEMPTS = 3
const BRIDGE_POST_RETRY_DELAY_MS = 250

// The bridge long-poll has a small window between cycles where no request is in
// flight. A single failed POST used to drop the observation silently; retry a
// couple of times and count permanent losses so they surface in diagnostics.
function createBridgeReporter(postBridge) {
  const telemetry = { posted: 0, retried: 0, dropped: 0, lastError: "" }
  async function send(path, body) {
    for (let attempt = 1; attempt <= BRIDGE_POST_ATTEMPTS; attempt++) {
      try {
        await postBridge(path, body)
        telemetry.posted += 1
        if (attempt > 1) telemetry.retried += 1
        return true
      } catch (error) {
        telemetry.lastError = error?.message || String(error)
        if (attempt < BRIDGE_POST_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, BRIDGE_POST_RETRY_DELAY_MS))
        }
      }
    }
    telemetry.dropped += 1
    return false
  }
  return { send, telemetry }
}

export function installNetworkMonitor({ sessionsByTab, postBridge, getPlatformMatches }) {
  const networkRequests = new Map()
  const reporter = createBridgeReporter(postBridge)
  let filteredByUrl = 0

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!beginNetworkEvent({ details, sessionsByTab, networkRequests, getPlatformMatches })) {
        filteredByUrl += 1
      }
    },
    NETWORK_FILTER,
    ["requestBody"]
  )

  chrome.webRequest.onCompleted.addListener((details) => {
    finishNetworkEvent({
      details,
      outcome: { completed: true },
      sessionsByTab,
      networkRequests,
      getPlatformMatches,
      reporter,
    })
  }, NETWORK_FILTER)

  chrome.webRequest.onErrorOccurred.addListener((details) => {
    finishNetworkEvent({
      details,
      outcome: { error: details.error || "request failed" },
      sessionsByTab,
      networkRequests,
      getPlatformMatches,
      reporter,
    })
  }, NETWORK_FILTER)

  return {
    networkRequests,
    getCaptureDiagnostics: () => ({
      ...reporter.telemetry,
      filteredByPlatformMatch: filteredByUrl,
      platformMatches: getPlatformMatches?.() || null,
    }),
  }
}

function beginNetworkEvent({ details, sessionsByTab, networkRequests, getPlatformMatches }) {
  if (details.tabId < 0) return false
  const session = sessionsByTab.get(details.tabId)
  if (!session) return false
  if (!isSupportedNetworkUrl(details.url, getPlatformMatches)) return false
  networkRequests.set(details.requestId, {
    browserSessionId: session.browserSessionId,
    tabId: details.tabId,
    requestId: details.requestId,
    url: details.url,
    method: details.method,
    type: details.type,
    initiator: details.initiator || "",
    documentUrl: details.documentUrl || "",
    startedAt: new Date(details.timeStamp || Date.now()).toISOString(),
    startTime: details.timeStamp || Date.now(),
    requestBody: summarizeRequestBody(details.requestBody),
  })
  return true
}

function finishNetworkEvent({
  details,
  outcome,
  sessionsByTab,
  networkRequests,
  getPlatformMatches,
  reporter,
}) {
  if (!isSupportedNetworkUrl(details.url, getPlatformMatches)) return
  const event = networkRequests.get(details.requestId) || {
    tabId: details.tabId,
    requestId: details.requestId,
    url: details.url,
    method: details.method,
    type: details.type,
    initiator: details.initiator || "",
    documentUrl: details.documentUrl || "",
    startedAt: new Date(details.timeStamp || Date.now()).toISOString(),
    startTime: details.timeStamp || Date.now(),
    requestBody: null,
  }
  networkRequests.delete(details.requestId)
  if (!event.browserSessionId && details.tabId >= 0) {
    event.browserSessionId =
      sessionsByTab.get(details.tabId)?.browserSessionId || ""
  }
  if (!event.browserSessionId) return
  const completedAt = new Date(details.timeStamp || Date.now()).toISOString()
  void reporter.send("/extension/network-event", {
    ...event,
    completedAt,
    durationMs: Math.max(
      0,
      Math.round((details.timeStamp || Date.now()) - event.startTime)
    ),
    statusCode: details.statusCode ?? null,
    ok: outcome.completed
      ? details.statusCode >= 200 && details.statusCode < 400
      : false,
    fromCache: Boolean(details.fromCache),
    error: outcome.error || "",
  })
}

function isSupportedNetworkUrl(url, getPlatformMatches) {
  return isPlatformUrl(url, {
    platformMatches: getPlatformMatches?.() || DEFAULT_PLATFORM_MATCHES,
  })
}

function summarizeRequestBody(requestBody) {
  if (!requestBody) return null
  const fieldNames = []
  const formData = {}
  if (requestBody.formData && typeof requestBody.formData === "object") {
    for (const [key, values] of Object.entries(requestBody.formData)) {
      fieldNames.push(key)
      formData[key] = safeFormPreview(key, values)
    }
    return { kind: "formData", fieldNames, formData }
  }
  if (Array.isArray(requestBody.raw)) {
    const rawBytes = requestBody.raw.reduce(
      (total, item) => total + (item.bytes?.byteLength || 0),
      0
    )
    return { kind: "raw", rawBytes }
  }
  return null
}

function safeFormPreview(key, values) {
  if (SENSITIVE_FIELD_RE.test(String(key || ""))) return "[REDACTED]"
  const joined = Array.isArray(values)
    ? values.map((value) => String(value)).join(",")
    : String(values)
  return joined.length > 160 ? `${joined.slice(0, 160)}...` : joined
}
