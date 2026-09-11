import {
  DEFAULT_BRIDGE_URL,
  bridgeHeaders,
  getSettings,
  isPlatformUrl,
  normalizeBaseUrl,
  normalizeBridgeToken,
  normalizePlatformMatches,
  platformLabelForUrl,
} from "./settings.js"

const DEFAULT_CONTENT_SCRIPT_PROBE_TIMEOUT_MS = 1500
const DEFAULT_CONTENT_SCRIPT_INJECTION_TIMEOUT_MS = 3000
const DEFAULT_CONTROLLER_TOOL_TIMEOUT_MS = 25_000
const DEFAULT_CONTROLLER_POLL_STALL_TIMEOUT_MS = 45_000
export const EXTENSION_PROTOCOL_VERSION = 1

export function createSessionManager(options = {}) {
  const contentScriptProbeTimeoutMs = normalizeTimeout(
    options.contentScriptProbeTimeoutMs,
    DEFAULT_CONTENT_SCRIPT_PROBE_TIMEOUT_MS
  )
  const contentScriptInjectionTimeoutMs = normalizeTimeout(
    options.contentScriptInjectionTimeoutMs,
    DEFAULT_CONTENT_SCRIPT_INJECTION_TIMEOUT_MS
  )
  const controllerToolTimeoutMs = normalizeTimeout(
    options.controllerToolTimeoutMs,
    DEFAULT_CONTROLLER_TOOL_TIMEOUT_MS
  )
  const controllerPollStallTimeoutMs = normalizeTimeout(
    options.controllerPollStallTimeoutMs,
    DEFAULT_CONTROLLER_POLL_STALL_TIMEOUT_MS
  )
  const sessionsByTab = new Map()
  const pendingTabRecovery = new Map()
  const lastInjectionAtByTab = new Map()
  let controllerPoller = null
  let controllerPollerRoute = ""
  let controllerPollerLastProgressAt = 0
  let controllerToolQueue = Promise.resolve()
  let controllerSession = null
  let browserControllerIdPromise = null
  let cachedPlatformMatches = null
  let toolRequestHandler = null
  let stopped = false

  function getPlatformMatches() {
    return cachedPlatformMatches
  }

  function setToolRequestHandler(handler) {
    toolRequestHandler = typeof handler === "function" ? handler : null
  }

  async function forgetTab(tabId, reason = "tab_removed") {
    const session = sessionsByTab.get(tabId)
    sessionsByTab.delete(tabId)
    if (!session) return { ok: true, removed: false, tabId }
    await postBridge("/sessions/unregister", {
      browserSessionId: session.browserSessionId,
      userId: session.userId || "",
      reason,
    }).catch(() => null)
    return { ok: true, removed: true, tabId, browserSessionId: session.browserSessionId }
  }

  async function registerBrowserController(reason = "heartbeat") {
    if (stopped) return { ok: false, reason: "stopped" }
    const settings = await getSettings()
    cachedPlatformMatches = settings.platformMatches
    const browserSessionId = await getBrowserControllerId()
    const browserInstanceId = browserSessionId
    const liveTabIds = await currentLiveTabIds()
    if (stopped) return { ok: false, reason: "stopped" }
    const session = {
      browserSessionId,
      kind: "browser_controller",
      userId: settings.localUserId || "",
      displayName: settings.localUserName || "",
      tabId: null,
      windowId: null,
      url: "browser://yunti-runtime",
      title: "Yunti Browser Runtime",
      browserInstanceId,
      liveTabIds,
      client: normalizeClientInfo(getBackgroundClientInfo(browserInstanceId)),
      protocolVersion: EXTENSION_PROTOCOL_VERSION,
      capabilities: {
        singleControllerTransport: true,
        onDemandPageRecovery: true,
        stablePageSessionIds: true,
        multiBrowserController: true,
      },
      auth: {
        state: "browser_controller",
        loggedIn: true,
        reason,
        checkedAt: new Date().toISOString(),
        checkedBy: "background_controller",
      },
      registeredAt: controllerSession?.registeredAt || new Date().toISOString(),
    }
    controllerSession = session
    await postBridge("/sessions/register", session).catch(() => null)
    startControllerPolling(session, await getSettings())
    return { ok: true, session }
  }

  async function getBrowserControllerId() {
    if (!browserControllerIdPromise) {
      browserControllerIdPromise = (async () => {
        const stored = await chrome.storage.local.get(["browserControllerId"])
        const existing = String(stored.browserControllerId || "").trim()
        if (existing) return existing
        const id = `yunti-browser-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`
        await chrome.storage.local.set({ browserControllerId: id }).catch(() => {})
        return id
      })()
    }
    return browserControllerIdPromise
  }

  async function currentLiveTabIds() {
    try {
      const tabs = await chrome.tabs.query({})
      return tabs
        .map((tab) => Number(tab.id))
        .filter((tabId) => Number.isFinite(tabId) && tabId > 0)
    } catch {
      return null
    }
  }

  function startControllerPolling(session, settings) {
    if (stopped) return
    const routeKey = `${settings.bridgeUrl}|${session.browserSessionId}`
    const pollerIsResponsive =
      controllerPoller &&
      controllerPollerRoute === routeKey &&
      Date.now() - controllerPollerLastProgressAt < controllerPollStallTimeoutMs
    if (pollerIsResponsive) return
    if (controllerPoller) {
      controllerPoller.abort()
      controllerPoller = null
    }
    const controller = new AbortController()
    controllerPoller = controller
    controllerPollerRoute = routeKey
    controllerPollerLastProgressAt = Date.now()
    const loop = async () => {
      while (!controller.signal.aborted) {
        try {
          const liveTabIds = await currentLiveTabIds()
          if (controller.signal.aborted) break
          if (controllerSession) controllerSession.liveTabIds = liveTabIds
          await postBridge("/sessions/register", controllerSession || session).catch(() => null)
          const settings = await getSettings()
          if (controller.signal.aborted) break
          cachedPlatformMatches = settings.platformMatches
          const currentRouteKey = `${settings.bridgeUrl}|${session.browserSessionId}`
          if (currentRouteKey !== controllerPollerRoute) {
            controller.abort()
            void registerBrowserController("controller_route_changed").catch(() => {})
            break
          }
          const url = `${settings.bridgeUrl}/extension/poll?browserSessionId=${encodeURIComponent(
            session.browserSessionId
          )}&timeoutMs=25000`
          const response = await fetch(url, {
            signal: controller.signal,
            headers: bridgeHeaders(settings),
          })
          const event = await response.json()
          controllerPollerLastProgressAt = Date.now()
          if (event?.type === "tool_request" && toolRequestHandler) {
            queueControllerToolRequest(controllerSession || session, event)
          }
        } catch {
          if (!controller.signal.aborted) {
            controllerPollerLastProgressAt = Date.now()
            await delay(1500)
          }
        }
      }
      if (controllerPoller === controller) {
        controllerPoller = null
        controllerPollerRoute = ""
      }
    }
    void loop()
  }

  function queueControllerToolRequest(session, event) {
    controllerToolQueue = controllerToolQueue
      .catch(() => {})
      .then(async () => {
        if (stopped) return
        try {
          if (Number.isFinite(Number(event.deadlineAt)) && Number(event.deadlineAt) <= Date.now()) {
            throw new Error(`Browser tool request timed out before execution: ${event.tool || "unknown"}`)
          }
          const deadlineAt = Number(event.deadlineAt)
          const remainingMs = Number.isFinite(deadlineAt)
            ? deadlineAt - Date.now()
            : controllerToolTimeoutMs
          await withTimeout(
            toolRequestHandler(null, session, event),
            Math.min(controllerToolTimeoutMs, remainingMs),
            `Browser tool execution timed out inside the extension: ${event.tool || "unknown"}`
          )
        } catch (error) {
          await postBridge("/extension/result", {
            browserSessionId: session.browserSessionId,
            requestId: event.id,
            ok: false,
            error: error?.message || String(error),
          }).catch(() => {})
        }
      })
    void controllerToolQueue
  }

  async function activateTab(tabId) {
    const session = sessionsByTab.get(tabId)
    if (!session) return
    await postBridge("/sessions/activate", {
      browserSessionId: session.browserSessionId,
      userId: session.userId || "",
    }).catch(() => {})
  }

  async function ensureAllTabsRegistered(options = {}) {
    const settings = await getSettings()
    cachedPlatformMatches = settings.platformMatches
    const tabs = await chrome.tabs.query({})
    const results = await Promise.allSettled(
      tabs.map((tab) => ensureTabRegistered(tab.id, { ...options, tab, settings }))
    )
    return {
      ok: true,
      reason: options.reason || "manual",
      checked: tabs.length,
      recovered: results.filter((result) => result.value?.registered || result.value?.injected)
        .length,
      skipped: results.filter((result) => result.value?.skipped).length,
      failed: results.filter((result) => result.status === "rejected" || result.value?.ok === false)
        .length,
    }
  }

  async function ensureTabRegistered(tabId, options = {}) {
    if (!Number.isFinite(Number(tabId))) {
      return { ok: false, skipped: true, reason: "missing_tab_id" }
    }
    const key = Number(tabId)
    if (pendingTabRecovery.has(key)) return pendingTabRecovery.get(key)
    const promise = recoverTabRegistration(key, options).finally(() => {
      pendingTabRecovery.delete(key)
    })
    pendingTabRecovery.set(key, promise)
    return promise
  }

  async function recoverTabRegistration(tabId, options = {}) {
    const settings = options.settings || (await getSettings())
    cachedPlatformMatches = settings.platformMatches
    const tab = options.tab || (await chrome.tabs.get(tabId).catch(() => null))
    if (!isInjectableTab(tab, settings)) {
      return { ok: true, skipped: true, reason: "unsupported_tab" }
    }
    if (sessionsByTab.has(tabId)) {
      const refreshed = await refreshTabRegistration(tabId).catch(() => null)
      if (refreshed?.ok) {
        return {
          ok: true,
          registered: true,
          reason: "already_registered",
          session: refreshed.session || sessionsByTab.get(tabId) || null,
        }
      }
      sessionsByTab.delete(tabId)
    }
    const ping = await refreshTabRegistration(tabId).catch((error) => ({
      ok: false,
      error: error?.message || String(error),
    }))
    if (ping?.ok) {
      return {
        ok: true,
        registered: true,
        reason: "content_script_present",
        session: ping.session || sessionsByTab.get(tabId) || null,
      }
    }
    const lastInjectionAt = lastInjectionAtByTab.get(tabId) || 0
    if (Date.now() - lastInjectionAt < 5000) {
      for (let attempt = 0; attempt < 10 && !sessionsByTab.has(tabId); attempt += 1) {
        await delay(25)
      }
      const refreshed = sessionsByTab.has(tabId)
        ? null
        : await refreshTabRegistration(tabId).catch(() => null)
      const session = refreshed?.session || sessionsByTab.get(tabId) || null
      return session
        ? { ok: true, registered: true, reason: "recent_injection_completed", session }
        : {
            ok: false,
            reason: "registration_pending",
            error: "The content script was injected but has not registered the page yet.",
          }
    }
    const injected = await injectContentScripts(tabId).catch((error) => ({
      ok: false,
      error: error?.message || String(error),
    }))
    if (!injected?.ok) {
      return { ok: false, reason: "inject_failed", error: injected?.error || "inject failed" }
    }
    lastInjectionAtByTab.set(tabId, Date.now())
    for (let attempt = 0; attempt < 10 && !sessionsByTab.has(tabId); attempt += 1) {
      await delay(25)
    }
    if (!sessionsByTab.has(tabId)) {
      const refreshed = await refreshTabRegistration(tabId).catch(() => null)
      if (refreshed?.session) sessionsByTab.set(tabId, refreshed.session)
    }
    return {
      ok: true,
      injected: true,
      reason: options.reason || "auto_recovery",
      session: sessionsByTab.get(tabId) || null,
    }
  }

  function isInjectableTab(tab, settings) {
    if (!tab?.id) return false
    if (tab.discarded) return false
    return isPlatformUrl(tab.url, settings)
  }

  async function refreshTabRegistration(tabId) {
    return withTimeout(
      chrome.tabs.sendMessage(tabId, { type: "yunti_refresh_registration" }),
      contentScriptProbeTimeoutMs,
      `Timed out probing content script for tabId ${tabId}`
    )
  }

  async function injectContentScripts(tabId) {
    if (!chrome.scripting?.executeScript) {
      return { ok: false, error: "chrome.scripting permission is unavailable" }
    }
    try {
      await performContentScriptInjection(tabId)
      return { ok: true }
    } catch (error) {
      if (!isTimeoutError(error)) throw error
      return injectAfterTemporaryActivation(tabId, error)
    }
  }

  async function performContentScriptInjection(tabId) {
    if (chrome.scripting.insertCSS) {
      await withTimeout(
        chrome.scripting.insertCSS({
          target: { tabId },
          files: ["content.css"],
        }),
        contentScriptInjectionTimeoutMs,
        `Timed out inserting content CSS into tabId ${tabId}`
      )
    }
    await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["dom-observer.js"],
      }),
      contentScriptInjectionTimeoutMs,
      `Timed out injecting DOM observer into tabId ${tabId}`
    )
    await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      }),
      contentScriptInjectionTimeoutMs,
      `Timed out injecting content runtime into tabId ${tabId}`
    )
  }

  async function injectAfterTemporaryActivation(tabId, originalError) {
    if (!chrome.tabs?.update) throw originalError
    const targetTab = await chrome.tabs.get(tabId).catch(() => null)
    if (!targetTab?.windowId) throw originalError
    const activeTabs = await chrome.tabs.query({ active: true, windowId: targetTab.windowId })
    const previousActiveTabId = Number(activeTabs[0]?.id) || null
    if (previousActiveTabId === tabId) throw originalError

    await chrome.tabs.update(tabId, { active: true })
    try {
      await delay(150)
      await performContentScriptInjection(tabId)
      return { ok: true, temporarilyActivated: true }
    } finally {
      if (previousActiveTabId) {
        await chrome.tabs.update(previousActiveTabId, { active: true }).catch(() => {})
      }
    }
  }

  async function handleMessage(message, sender) {
    switch (message?.type) {
      case "yunti_content_ready":
        return registerContentSession(sender.tab, message.page)
      case "yunti_is_supported_page":
        return checkSupportedPage(message.page)
      case "yunti_panel_get_state":
        return getPanelState()
      case "yunti_panel_save_settings":
        await chrome.storage.local.set({
          localUserName: "local",
          localUserId: "local",
          bridgeUrl: normalizeBaseUrl(
            message.settings?.bridgeUrl || DEFAULT_BRIDGE_URL
          ),
          bridgeToken: normalizeBridgeToken(message.settings?.bridgeToken || ""),
          agentType: "browser_agent",
          platformMatches: normalizePlatformMatches(
            message.settings?.platformMatches
          ),
        })
        return getPanelState()
      case "yunti_panel_refresh_active":
        return refreshActiveTab()
      default:
        return { ok: false, error: `unknown message: ${message?.type}` }
    }
  }

  async function registerContentSession(tab, page) {
    const settings = await getSettings()
    cachedPlatformMatches = settings.platformMatches
    if (!tab?.id || !isPlatformUrl(page?.url, settings)) {
      return { ok: false, error: "not an Yunti tab" }
    }
    const browserControllerId = await getBrowserControllerId()
    const controllerRouteKey = `${settings.bridgeUrl}|${browserControllerId}`
    if (!controllerPoller || controllerPollerRoute !== controllerRouteKey) {
      await registerBrowserController("page_registration")
    }
    const browserSessionId =
      sessionsByTab.get(tab.id)?.browserSessionId ||
      stablePageSessionId(tab.id, browserControllerId)
    const session = {
      browserSessionId,
      kind: "page",
      userId: settings.localUserId || "",
      displayName: settings.localUserName || "",
      tabId: tab.id,
      windowId: tab.windowId,
      url: page.url,
      title: page.title || tab.title || platformLabelForUrl(page.url),
      active: Boolean(tab.active),
      browserInstanceId: browserControllerId,
      browserControllerSessionId: browserControllerId,
      client: normalizeClientInfo({
        ...getBackgroundClientInfo(browserControllerId),
        ...(page.client || {}),
      }),
      protocolVersion: EXTENSION_PROTOCOL_VERSION,
      auth: normalizePageAuth(page.auth, "content_script_register"),
      registeredAt: new Date().toISOString(),
    }
    sessionsByTab.set(tab.id, session)
    await postBridge("/sessions/register", session).catch(() => null)
    return { ok: true, session, settings }
  }

  async function checkSupportedPage(page) {
    const settings = await getSettings()
    cachedPlatformMatches = settings.platformMatches
    return {
      ok: true,
      supported: isPlatformUrl(page?.url, settings),
      settings,
    }
  }

  async function forwardConsoleEvent(session, tabId, method, params = {}) {
    let level = "log"
    let text = ""
    let source = "console-api"
    let stackTrace = ""
    let args = []
    let url = ""
    let lineNumber = null
    let columnNumber = null

    if (method === "Runtime.consoleAPICalled") {
      source = "console-api"
      level = String(params.type || "log").toLowerCase()
      args = (params.args || []).map((arg) => {
        if (arg.type === "string") return String(arg.value || "")
        if (arg.type === "number" || arg.type === "boolean") {
          return String(arg.value)
        }
        if (arg.type === "undefined") return "undefined"
        if (arg.type === "null") return "null"
        if (arg.type === "object" && arg.description) return arg.description
        return arg.type || "unknown"
      })
      text = args.filter((arg) => typeof arg === "string").join(" ") || args.join(" ")
      stackTrace = formatConsoleStackTrace(params.stackTrace)
    } else if (method === "Log.entryAdded") {
      source = "other"
      const entry = params.entry || {}
      level = String(entry.level || "verbose").toLowerCase()
      text = String(entry.text || "").slice(0, 2000)
      url = entry.url || ""
      lineNumber = entry.lineNumber ?? null
      columnNumber = entry.columnNumber ?? null
      if (entry.stackTrace) stackTrace = formatConsoleStackTrace(entry.stackTrace)
    }

    await postBridge("/extension/console-event", {
      browserSessionId: session.browserSessionId,
      tabId,
      level,
      text: text.slice(0, 2000),
      source,
      stackTrace,
      args,
      url,
      lineNumber,
      columnNumber,
      timestamp: new Date().toISOString(),
    }).catch(() => {})
  }

  async function postBridge(path, body) {
    const settings = await getSettings()
    cachedPlatformMatches = settings.platformMatches
    const response = await fetch(`${settings.bridgeUrl}${path}`, {
      method: "POST",
      headers: bridgeHeaders(settings),
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`bridge HTTP ${response.status}`)
    return response.json()
  }

  async function getPanelState() {
    const settings = await getSettings()
    cachedPlatformMatches = settings.platformMatches
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })
    const activeSession = activeTab?.id
      ? sessionsByTab.get(activeTab.id) || null
      : null
    let bridge = null
    try {
      const userId = encodeURIComponent(settings.localUserId || "")
      const healthUrl = userId
        ? `${settings.bridgeUrl}/health?userId=${userId}`
        : `${settings.bridgeUrl}/health`
      const response = await fetch(healthUrl, {
        headers: bridgeHeaders(settings),
      })
      bridge = await response.json()
    } catch {
      bridge = { ok: false }
    }
    return {
      ok: true,
      settings,
      activeTab: activeTab
        ? {
            id: activeTab.id,
            url: activeTab.url,
            title: activeTab.title,
            windowId: activeTab.windowId,
          }
        : null,
      activeSession,
      bridge,
    }
  }

  async function refreshActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return { ok: false, error: "no active tab" }
    await ensureTabRegistered(tab.id, { tab, reason: "popup_refresh" }).catch(() => null)
    return getPanelState()
  }

  function stop() {
    stopped = true
    controllerPoller?.abort()
    controllerPoller = null
    controllerPollerRoute = ""
    controllerSession = null
  }

  return {
    sessionsByTab,
    activateTab,
    ensureAllTabsRegistered,
    ensureTabRegistered,
    forgetTab,
    forwardConsoleEvent,
    getPlatformMatches,
    handleMessage,
    postBridge,
    registerBrowserController,
    setToolRequestHandler,
    stop,
  }
}

function stablePageSessionId(tabId, browserControllerId) {
  const controllerSuffix = String(browserControllerId || "")
    .replace(/^yunti-browser-/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
  return `yunti-page-${tabId}-${controllerSuffix || "local"}`
}

function formatConsoleStackTrace(stackTrace) {
  if (!stackTrace?.callFrames) return ""
  return stackTrace.callFrames
    .map(
      (frame) =>
        `${frame.functionName || "(anonymous)"} (${frame.url || ""}:${frame.lineNumber}:${frame.columnNumber})`
    )
    .join("\n")
}

function normalizePageAuth(auth, source = "unknown") {
  if (!auth || typeof auth !== "object") {
    return {
      state: "missing_from_content_script",
      loggedIn: false,
      reason: "Content script did not report page state; Yunti will try automatic registration recovery before asking for a page refresh",
      checkedAt: new Date().toISOString(),
      checkedBy: source,
    }
  }
  return {
    state: String(auth.state || "unknown"),
    loggedIn: Boolean(auth.loggedIn),
    reason: String(auth.reason || ""),
    checkedAt: auth.checkedAt || new Date().toISOString(),
    checkedBy: String(auth.checkedBy || source),
    status: auth.status ?? null,
    apiAuthError: auth.apiAuthError || "",
    userName: auth.userName ? String(auth.userName).slice(0, 120) : "",
  }
}

function normalizeClientInfo(client) {
  const value = client && typeof client === "object" ? client : {}
  return {
    family: normalizeBrowserFamily(value.family || value.userAgent),
    extensionVersion: String(value.extensionVersion || "").slice(0, 80),
    protocolVersion: Number(value.protocolVersion) || null,
    browserInstanceId: String(value.browserInstanceId || "").slice(0, 160),
    userAgent: String(value.userAgent || "").slice(0, 500),
    platform: String(value.platform || "").slice(0, 120),
    language: String(value.language || "").slice(0, 80),
  }
}

function getBackgroundClientInfo(browserInstanceId = "") {
  return {
    extensionVersion: chrome.runtime?.getManifest?.().version || "",
    protocolVersion: EXTENSION_PROTOCOL_VERSION,
    browserInstanceId,
    userAgent: String(globalThis.navigator?.userAgent || ""),
    platform: String(globalThis.navigator?.platform || ""),
    language: String(globalThis.navigator?.language || ""),
  }
}

function normalizeBrowserFamily(value) {
  const text = String(value || "").toLowerCase()
  if (text === "edge" || /edg\//i.test(text)) return "edge"
  if (text === "chrome" || /chrome\//i.test(text) || /chromium\//i.test(text)) {
    return "chrome"
  }
  if (text === "brave" || /brave\//i.test(text)) return "brave"
  if (text === "opera" || /opr\//i.test(text)) return "opera"
  if (text === "firefox" || /firefox\//i.test(text)) return "firefox"
  if (text === "safari" || /safari\//i.test(text)) return "safari"
  return "unknown"
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeTimeout(value, fallback) {
  const timeoutMs = Number(value)
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : fallback
}

function isTimeoutError(error) {
  return /timed out/i.test(error?.message || String(error || ""))
}

async function withTimeout(promise, timeoutMs, message) {
  let timer = null
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
