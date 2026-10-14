// A single CDP round trip (attach, domain enable, mouse dispatch, screenshot)
// must never be able to hold a tab's execution lane forever. On timeout the
// attach bookkeeping is dropped so the next call re-attaches instead of talking
// to a dead debugger session.
const DEFAULT_CDP_COMMAND_TIMEOUT_MS = 10_000

export function createCdpController({
  sessionsByTab,
  postBridge,
  forwardConsoleEvent,
  commandTimeoutMs = DEFAULT_CDP_COMMAND_TIMEOUT_MS,
  onDialogEvent = null,
}) {
  const cdpAttachedTabs = new Set()
  // Non-tab targets — a page's worker, a shared worker, a service worker — have
  // no tab id but are valid chrome.debugger debuggees. They are tracked
  // separately because every tab-keyed code path below would key them to the
  // wrong thing.
  const cdpAttachedTargets = new Set()
  // Non-tab attaches are held until the target disappears or the caller detaches
  // it, so a caller walking many workers would accumulate debuggee sessions
  // without bound. Oldest-first eviction keeps that flat.
  const MAX_ATTACHED_TARGETS = 16
  const cdpEnabledDomains = new Map()
  const traceBuffers = new Map()
  // tabId -> { message, type, openedAt }. A native modal freezes the renderer's
  // JS thread, so while this entry exists the tab cannot answer page tools.
  const openDialogsByTab = new Map()
  // tabId -> { openedAtMs, closedAtMs, type }. Lets a tool that already returned
  // still report "a dialog opened while I was running" even when the browser
  // auto-dismissed it in a few milliseconds (headless/background tabs do this).
  const dialogActivityByTab = new Map()

  function dialogState(tabId) {
    const dialog = openDialogsByTab.get(Number(tabId))
    if (!dialog) return null
    return { ...dialog }
  }

  function clearDialogState(tabId) {
    openDialogsByTab.delete(Number(tabId))
  }

  function lastDialogActivity(tabId) {
    const activity = dialogActivityByTab.get(Number(tabId))
    return activity ? { ...activity } : null
  }

  // tabId -> Set<listener> for dialog-open notifications.
  const dialogOpenListeners = new Map()

  function notifyDialogOpen(tabId) {
    const listeners = dialogOpenListeners.get(Number(tabId))
    if (!listeners) return
    dialogOpenListeners.delete(Number(tabId))
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // never let a listener break the event forwarder
      }
    }
  }

  // Resolves as soon as a native modal opens on the tab, or after waitMs with
  // null. Lets page tools bail out of a modal deadlock instead of blocking
  // until the operation timeout.
  function waitForDialogOpen(tabId, waitMs = 3_000) {
    const id = Number(tabId)
    if (!Number.isFinite(id) || id <= 0) return Promise.resolve(null)
    if (openDialogsByTab.has(id)) return Promise.resolve(dialogState(id))
    return new Promise((resolve) => {
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const listeners = dialogOpenListeners.get(id)
        if (listeners) {
          listeners.delete(finish)
          if (!listeners.size) dialogOpenListeners.delete(id)
        }
        resolve(value)
      }
      const timer = setTimeout(() => finish(null), Math.max(100, Number(waitMs) || 0))
      if (!dialogOpenListeners.has(id)) dialogOpenListeners.set(id, new Set())
      dialogOpenListeners.get(id).add(finish)
    })
  }

  function installCdpEventForwarder() {
    if (!chrome.debugger?.onEvent || !chrome.debugger?.onDetach) return
    chrome.debugger.onEvent.addListener((source, method, params) => {
      const tabId = source?.tabId
      if (!tabId) return
      const session = sessionsByTab.get(tabId)

      if (method === "Page.javascriptDialogOpening") {
        const openedAtMs = Date.now()
        openDialogsByTab.set(Number(tabId), {
          message: String(params?.message || ""),
          type: String(params?.type || "alert"),
          openedAt: new Date(openedAtMs).toISOString(),
        })
        dialogActivityByTab.set(Number(tabId), {
          openedAtMs,
          closedAtMs: 0,
          type: String(params?.type || "alert"),
        })
        void postBridge("/extension/cdp-event", {
          browserSessionId: session?.browserSessionId || "",
          tabId,
          method,
          params: { type: params?.type || "alert", hasMessage: Boolean(params?.message) },
          receivedAt: new Date().toISOString(),
        }).catch(() => {})
        if (typeof onDialogEvent === "function") onDialogEvent("opened", tabId, session || null, params || {})
        notifyDialogOpen(tabId)
        return
      }
      if (method === "Page.javascriptDialogClosed") {
        openDialogsByTab.delete(Number(tabId))
        const previous = dialogActivityByTab.get(Number(tabId))
        dialogActivityByTab.set(Number(tabId), {
          openedAtMs: previous?.openedAtMs || 0,
          closedAtMs: Date.now(),
          type: previous?.type || "alert",
        })
        void postBridge("/extension/cdp-event", {
          browserSessionId: session?.browserSessionId || "",
          tabId,
          method,
          params: { result: params?.result ?? null, userInput: undefined },
          receivedAt: new Date().toISOString(),
        }).catch(() => {})
        if (typeof onDialogEvent === "function") onDialogEvent("closed", tabId, session || null, params || {})
        return
      }
      if (!session) return

      recordTraceEvent(tabId, method, params)
      void postBridge("/extension/cdp-event", {
        browserSessionId: session.browserSessionId,
        tabId,
        method,
        params: params || {},
        receivedAt: new Date().toISOString(),
      }).catch(() => {})

      if (method === "Runtime.consoleAPICalled" || method === "Log.entryAdded") {
        void forwardConsoleEvent(session, tabId, method, params).catch(() => {})
      }
    })
    chrome.debugger.onDetach.addListener((source, reason) => {
      // A non-tab debuggee reports only a targetId. Drop the bookkeeping so a
      // stale attach is not reused after Chrome detached it on its own.
      if (source?.targetId && !source?.tabId) cdpAttachedTargets.delete(source.targetId)
      const tabId = source?.tabId
      if (!tabId) return
      cdpAttachedTabs.delete(tabId)
      cdpEnabledDomains.delete(tabId)
      traceBuffers.delete(tabId)
      openDialogsByTab.delete(Number(tabId))
      const session = sessionsByTab.get(tabId)
      if (!session) return
      void postBridge("/extension/cdp-event", {
        browserSessionId: session.browserSessionId,
        tabId,
        method: "Debugger.detached",
        params: { reason: reason || "unknown" },
        receivedAt: new Date().toISOString(),
      }).catch(() => {})
    })
  }

  async function sendCdpCommand(tabId, session, args = {}) {
    const method = String(args.method || "").trim()
    if (!method) {
      throw new Error("yunti_cdp_send_command requires method, for example { method: \"Runtime.evaluate\", params: { expression: \"document.title\", returnByValue: true } }. Do not run CDP method names in a shell.")
    }
    if (args.params !== undefined && (typeof args.params !== "object" || args.params === null || Array.isArray(args.params))) {
      throw new Error("yunti_cdp_send_command params must be an object when provided. Example: { method: \"Runtime.evaluate\", params: { expression: \"document.title\" } }.")
    }
    const params = args.params || {}
    const protocolVersion = String(args.protocolVersion || "1.3")
    const requestedTargetId = String(args.targetId || params.targetId || "").trim()
    const explicitTabId = Number(args.tabId ?? params.tabId)
    const targetTabId = Number.isFinite(explicitTabId) && explicitTabId > 0
      ? explicitTabId
      : requestedTargetId
        ? await resolveTabIdFromTarget(requestedTargetId)
        : tabId
    const explicitTargetId = explicitCdpTargetId(args, params)
    const targetParams =
      method.startsWith("Target.") && !params.targetId && explicitTargetId
        ? { ...params, targetId: explicitTargetId }
        : params

    if (method === "Target.getTargets") {
      return interceptTargetGetTargets(session)
    }
    if (method === "Target.closeTarget") {
      return interceptTargetCloseTarget(targetParams, session)
    }
    if (method === "Target.createTarget") {
      return interceptTargetCreateTarget(targetParams, session)
    }
    if (method === "Target.attachToTarget") {
      return interceptTargetAttachToTarget(targetParams, protocolVersion)
    }
    if (method === "Target.detachFromTarget") {
      return interceptTargetDetachFromTarget(targetParams)
    }
    if (method === "Target.activateTarget") {
      return interceptTargetActivateTarget(targetParams)
    }
    if (method === "Target.getTargetInfo") {
      return interceptTargetGetTargetInfo(targetParams)
    }
    // A targetId that maps to no tab is a non-tab target — a page's worker, a
    // shared worker, a service worker. chrome.debugger accepts a {targetId}
    // debuggee for exactly these, and the extension is the only layer that can
    // attach to them, so the runtime must send there itself instead of handing
    // the caller an instruction to call chrome.debugger.
    if (!targetTabId && requestedTargetId) {
      return sendNonTabCdpCommand(session, requestedTargetId, method, params, protocolVersion)
    }
    if (!Number.isFinite(Number(targetTabId)) || Number(targetTabId) <= 0) {
      throw new Error(
        "CDP command requires a concrete tabId or targetId when routed through the browser controller. Call yunti_list_browser_targets first, then pass the returned tabId or targetId."
      )
    }

    let attach = { attached: false, reused: cdpAttachedTabs.has(targetTabId) }
    if (args.attach !== false) {
      attach = await ensureCdpAttached(targetTabId, protocolVersion)
    }
    const result = await chromeDebuggerSendCommand({ tabId: targetTabId }, method, params)
    return {
      browserSessionId: session.browserSessionId,
      tabId: targetTabId,
      routeTabId: tabId,
      method,
      params,
      result: result || {},
      attach,
      sentAt: new Date().toISOString(),
    }
  }

  async function interceptTargetGetTargets(session) {
    const targetInfos = []
    if (chrome.debugger?.getTargets) {
      try {
        const targets = await chromeDebuggerGetTargets()
        for (const target of targets) {
          const tabId =
            Number.isFinite(Number(target.tabId)) && Number(target.tabId) > 0
              ? Number(target.tabId)
              : null
          const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null
          targetInfos.push({
            targetId: target.id || (tabId ? `tab-${tabId}` : ""),
            type: target.type || "other",
            title: target.title || tab?.title || "",
            url: target.url || tab?.url || "",
            tabId,
            windowId: tab?.windowId ?? null,
            active: Boolean(tab?.active),
            index: Number.isFinite(Number(tab?.index)) ? Number(tab.index) : null,
            attached: tabId ? cdpAttachedTabs.has(tabId) : Boolean(target.attached),
            canAccessOpener: false,
          })
        }
      } catch {
        // Fall through to chrome.tabs fallback.
      }
    }
    if (!targetInfos.length) {
      const tabs = await chrome.tabs.query({})
      for (const tab of tabs) {
        if (!tab.id) continue
        targetInfos.push({
          targetId: `tab-${tab.id}`,
          type: "page",
          title: tab.title || "",
          url: tab.url || "",
          tabId: tab.id,
          windowId: tab.windowId ?? null,
          active: Boolean(tab.active),
          index: Number.isFinite(Number(tab.index)) ? Number(tab.index) : null,
          attached: cdpAttachedTabs.has(tab.id),
          canAccessOpener: false,
        })
      }
    }
    return {
      browserSessionId: session.browserSessionId,
      method: "Target.getTargets",
      result: { targetInfos },
      intercepted: true,
      sentAt: new Date().toISOString(),
    }
  }

  // What an agent can rely on for a tab before spending a call on it. Only
  // DOM observation depends on the content script being injectable; closing and
  // CDP do not, so a restricted page must still report those as available
  // instead of reading as a dead tab the agent should give up on.
  function capabilitiesFor(url) {
    const value = String(url || "")
    const scheme = value.split(":")[0].toLowerCase()
    const webScheme = scheme === "http" || scheme === "https"
    return {
      canObserve: webScheme,
      canCDP: true,
      canClose: true,
      canDetach: true,
      // A true canObserve means "not excluded by scheme": Chrome also refuses
      // the Web Store and enterprise-policy hosts, which only shows up when the
      // injection is attempted.
      capabilityReason: webScheme
        ? "web scheme; a policy-blocked page can still refuse injection"
        : `${scheme || "unknown"} scheme cannot host the content script; use CDP, close or detach instead`,
    }
  }

  // What a caller can do with a non-tab target before spending an attach on it.
  // Chrome refuses two whole classes, both confirmed against a live browser:
  // privileged chrome:// targets ("Cannot access a chrome:// URL") and another
  // extension's service worker ("Cannot access a chrome-extension:// URL of
  // different extension"). Yunti's own service worker is attachable.
  function nonTabCapability(target) {
    const url = String(target.url || "")
    if (/^chrome:\/\//i.test(url)) {
      return {
        canAttach: false,
        capabilityReason: "chrome:// targets cannot be attached through chrome.debugger",
      }
    }
    if (/^chrome-extension:\/\//i.test(url)) {
      const ownId = globalThis.chrome?.runtime?.id || ""
      if (ownId && url.startsWith(`chrome-extension://${ownId}/`)) {
        return {
          canAttach: true,
          capabilityReason: "This extension's own service worker; reachable by targetId.",
        }
      }
      return {
        canAttach: false,
        capabilityReason: "Another extension's service worker: Chrome refuses cross-extension debugging.",
      }
    }
    if (!url) {
      // Observed on a live browser: these accept the attach and then never
      // answer Runtime.evaluate, which costs the caller the full command
      // timeout. Say so rather than let it look like a healthy worker.
      return {
        canAttach: true,
        capabilityReason: "This target reports no URL or title, so its kind is unknown. Attaching may succeed while Runtime.evaluate never answers if the target has no JavaScript context.",
      }
    }
    return {
      canAttach: true,
      capabilityReason: "Reachable by targetId through yunti_cdp_send_command; it has no tab, so do not pass a tabId for it.",
    }
  }

  async function listBrowserTargets(session) {
    const cdpResult = await interceptTargetGetTargets(session)
    const targetInfos = Array.isArray(cdpResult?.result?.targetInfos)
      ? cdpResult.result.targetInfos
      : []
    const pages = targetInfos
      .filter((target) => target.type === "page")
      .map((target) => {
        const pageSession = sessionsByTab.get(Number(target.tabId)) || null
        const controllerHandles = session.tabHandles || {}
        const pageHandleId =
          pageSession?.pageHandleId ||
          controllerHandles[String(target.tabId)] ||
          ""
        return {
          browserSessionId: pageSession?.browserSessionId || null,
          pageSessionId: pageSession?.browserSessionId || null,
          pageHandleId,
          routeBrowserSessionId: session.browserSessionId,
          browserInstanceId: session.browserInstanceId || session.client?.browserInstanceId || "",
          browserFamily: session.client?.family || "unknown",
          registered: Boolean(pageSession),
          targetId: target.targetId || "",
          tabId: target.tabId ?? null,
          type: target.type || "",
          url: target.url || "",
          title: target.title || "",
          active: Boolean(target.active),
          ...capabilitiesFor(target.url),
          source: "Target.getTargets",
        }
      })
    // Workers and other non-tab targets are valid CDP debuggees with no tab.
    // They are listed separately instead of being mixed into `pages`, whose rows
    // carry a tabId, a page handle and a page-session route that none of these
    // have — but they must be listed, or the first call an agent makes cannot
    // reveal a target it is able to reach.
    const nonTabTargets = targetInfos
      .filter((target) => target.type !== "page")
      .map((target) => ({
        targetId: target.targetId || "",
        // Chrome types a dedicated worker "other", not "worker"; the value is
        // reported verbatim rather than normalised into a guess.
        type: target.type || "other",
        kind: "non-tab",
        url: target.url || "",
        title: target.title || "",
        tabId: null,
        attached: Boolean(target.attached),
        browserSessionId: session.browserSessionId,
        routeBrowserSessionId: session.browserSessionId,
        ...nonTabCapability(target),
      }))
    return {
      browserSessionId: session.browserSessionId,
      routeBrowserSessionId: session.browserSessionId,
      browserInstanceId: session.browserInstanceId || session.client?.browserInstanceId || "",
      browserFamily: session.client?.family || "unknown",
      pages,
      nonTabTargets,
      targets: targetInfos,
      targetInfos,
      pageCount: pages.length,
      nonTabTargetCount: nonTabTargets.length,
      total: targetInfos.length,
      method: "Target.getTargets",
      source: cdpResult.intercepted ? "extension.chrome.debugger" : "extension",
      listedAt: new Date().toISOString(),
      ...(nonTabTargets.length ? {
        nextStepHint: "nonTabTargets have no tabId. Pass their targetId straight to yunti_cdp_send_command; the runtime attaches to the target itself.",
      } : {}),
    }
  }

  async function getBrowserTarget(session, args = {}) {
    const targetId = String(args.targetId || "").trim()
    const tabId = Number(args.tabId)
    if (!targetId && !Number.isFinite(tabId)) {
      throw new Error("targetId or tabId is required")
    }
    const inventory = await listBrowserTargets(session)
    const target = inventory.targets.find((item) => {
      if (targetId && item.targetId === targetId) return true
      if (Number.isFinite(tabId) && Number(item.tabId) === tabId) return true
      return false
    })
    if (!target) {
      throw new Error(
        targetId
          ? `browser target not found: ${targetId}`
          : `browser target not found for tabId: ${tabId}`
      )
    }
    return {
      browserSessionId: session.browserSessionId,
      target,
      pageSessionId: sessionsByTab.get(Number(target.tabId))?.browserSessionId || null,
      registered: sessionsByTab.has(Number(target.tabId)),
      method: "Target.getTargets",
      source: inventory.source,
      listedAt: inventory.listedAt,
    }
  }

  async function interceptTargetCloseTarget(params = {}, session = null) {
    const targetId = String(params.targetId || "")
    if (!targetId) {
      throw new Error("Target.closeTarget requires targetId. Pass top-level tabId or targetId to yunti_cdp_send_command after calling yunti_list_browser_targets.")
    }
    const tabId = await resolveTabIdFromTarget(targetId)
    if (!tabId || !Number.isFinite(tabId)) {
      throw new Error(`Cannot resolve tabId from targetId: ${targetId}. Call yunti_list_browser_targets and pass a returned top-level tabId or targetId to yunti_cdp_send_command.`)
    }
    const connected = [...sessionsByTab.keys()]
    if (connected.length <= 1 && connected.includes(tabId)) {
      throw new Error("Cannot close the last connected tab")
    }
    await detachCdpTab(tabId, null, "target_closed").catch(() => {})
    await chrome.tabs.remove(tabId)
    return {
      browserSessionId: session?.browserSessionId || "",
      method: "Target.closeTarget",
      result: { success: true },
      intercepted: true,
      tabId,
      sentAt: new Date().toISOString(),
    }
  }

  async function interceptTargetCreateTarget(params = {}, parentSession = null) {
    const url = String(params.url || "about:blank")
    const tab = await chrome.tabs.create({ url, active: true })
    const browserSessionId = stableChildPageSessionId(tab.id, parentSession)
    const sessionData = {
      browserSessionId,
      kind: "page",
      userId: parentSession?.userId || "",
      displayName: parentSession?.displayName || "",
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url || url,
      title: tab.title || "",
      active: true,
      registeredAt: new Date().toISOString(),
    }
    sessionsByTab.set(tab.id, sessionData)
    await postBridge("/sessions/register", sessionData).catch(() => null)
    return {
      browserSessionId,
      method: "Target.createTarget",
      result: { targetId: `tab-${tab.id}` },
      intercepted: true,
      tabId: tab.id,
      sentAt: new Date().toISOString(),
    }
  }

  function stableChildPageSessionId(tabId, parentSession) {
    const parentId = String(parentSession?.browserSessionId || "")
    const suffix =
      parentId.match(/^yunti-browser-(.+)$/)?.[1] ||
      parentId.match(/^yunti-page-\d+-(.+)$/)?.[1] ||
      (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))
    return `yunti-page-${tabId}-${suffix}`
  }

  // Non-tab targets are reached with a {targetId} debuggee, kept apart from tab
  // attaches so a worker never looks like a tab.
  async function ensureNonTabTargetAttached(targetId, protocolVersion) {
    if (cdpAttachedTargets.has(targetId)) return { attached: false, evicted: null }
    let evicted = null
    while (cdpAttachedTargets.size >= MAX_ATTACHED_TARGETS) {
      // Set iteration is insertion-ordered, so the first entry is the oldest.
      evicted = cdpAttachedTargets.values().next().value
      cdpAttachedTargets.delete(evicted)
      await chromeDebuggerDetach({ targetId: evicted }).catch(() => {})
    }
    await chromeDebuggerAttach({ targetId }, protocolVersion)
    cdpAttachedTargets.add(targetId)
    return { attached: true, evicted }
  }

  async function sendNonTabCdpCommand(session, targetId, method, params, protocolVersion) {
    const { attached, evicted } = await ensureNonTabTargetAttached(targetId, protocolVersion)
    const result = await chromeDebuggerSendCommand({ targetId }, method, params)
    return {
      browserSessionId: session?.browserSessionId || "",
      method,
      result,
      targetId,
      targetKind: "non-tab",
      attached,
      // Eviction is reported, not silent: a caller whose earlier attach was
      // dropped has to know before assuming that target is still attached.
      ...(evicted ? {
        evictedTargetId: evicted,
        nextStepHint: `Attaching here released the oldest non-tab attach (${evicted}) to keep at most ${MAX_ATTACHED_TARGETS} live. Re-attach it if you still need it.`,
      } : {}),
      sentAt: new Date().toISOString(),
    }
  }

  async function interceptTargetAttachToTarget(params = {}, protocolVersion = "1.3") {
    const targetId = String(params.targetId || "")
    const tabId = await resolveTabIdFromTarget(targetId)
    if (!tabId) {
      // A worker, shared worker or service worker has no tab to attach to, but
      // it is a valid chrome.debugger debuggee in its own right. Only the
      // extension can attach to it, so this has to happen here.
      if (!targetId) throw new Error("Target.attachToTarget requires a targetId")
      const { attached, evicted } = await ensureNonTabTargetAttached(targetId, protocolVersion)
      return {
        method: "Target.attachToTarget",
        result: { sessionId: `yunti-target-${targetId}` },
        intercepted: true,
        targetId,
        targetKind: "non-tab",
        attached,
        reused: !attached,
        ...(evicted ? { evictedTargetId: evicted } : {}),
        sentAt: new Date().toISOString(),
      }
    }
    if (cdpAttachedTabs.has(tabId)) {
      return {
        method: "Target.attachToTarget",
        result: { sessionId: `yunti-session-${tabId}` },
        intercepted: true,
        tabId,
        reused: true,
        sentAt: new Date().toISOString(),
      }
    }
    await chromeDebuggerAttach({ tabId }, protocolVersion)
    cdpAttachedTabs.add(tabId)
    return {
      method: "Target.attachToTarget",
      result: { sessionId: `yunti-session-${tabId}` },
      intercepted: true,
      tabId,
      attached: true,
      sentAt: new Date().toISOString(),
    }
  }

  async function interceptTargetDetachFromTarget(params = {}) {
    const targetId = String(params.targetId || "")
    if (targetId && cdpAttachedTargets.has(targetId)) {
      await chromeDebuggerDetach({ targetId })
      cdpAttachedTargets.delete(targetId)
      return {
        method: "Target.detachFromTarget",
        result: {},
        intercepted: true,
        targetId,
        targetKind: "non-tab",
        detached: true,
        sentAt: new Date().toISOString(),
      }
    }
    let tabId = await resolveTabIdFromTarget(targetId)
    if (!tabId) {
      const sessionMatch = targetId.match(/^yunti-session-(\d+)$/)
      if (sessionMatch) tabId = Number(sessionMatch[1])
    }
    if (!tabId || !cdpAttachedTabs.has(tabId)) {
      return {
        method: "Target.detachFromTarget",
        result: {},
        intercepted: true,
        detached: false,
        reason: tabId ? "not_attached" : "unknown_target",
        sentAt: new Date().toISOString(),
      }
    }
    await chromeDebuggerDetach({ tabId })
    cdpAttachedTabs.delete(tabId)
    return {
      method: "Target.detachFromTarget",
      result: {},
      intercepted: true,
      tabId,
      detached: true,
      sentAt: new Date().toISOString(),
    }
  }

  async function interceptTargetActivateTarget(params = {}) {
    const targetId = String(params.targetId || "")
    const tabId = await resolveTabIdFromTarget(targetId)
    if (!tabId) throw new Error(`Cannot resolve targetId to tab: ${targetId}`)
    await chrome.tabs.update(tabId, { active: true })
    return {
      method: "Target.activateTarget",
      result: {},
      intercepted: true,
      tabId,
      sentAt: new Date().toISOString(),
    }
  }

  async function interceptTargetGetTargetInfo(params = {}) {
    const targetId = String(params.targetId || "")
    const tabId = await resolveTabIdFromTarget(targetId)
    let info = { targetId, type: "page", title: "", url: "", attached: false, canAccessOpener: false }
    if (tabId) {
      const tab = await chrome.tabs.get(tabId).catch(() => null)
      info = {
        targetId,
        type: "page",
        title: tab?.title || "",
        url: tab?.url || "",
        attached: cdpAttachedTabs.has(tabId),
        canAccessOpener: false,
      }
    }
    return {
      method: "Target.getTargetInfo",
      result: { targetInfo: info },
      intercepted: true,
      sentAt: new Date().toISOString(),
    }
  }

  async function resolveCdpTargetTabId(defaultTabId, args = {}, params = {}) {
    const directTabId = Number(args.tabId ?? params.tabId)
    if (Number.isFinite(directTabId) && directTabId > 0) return directTabId
    const targetId = String(args.targetId || params.targetId || "").trim()
    if (!targetId) return defaultTabId
    const tabId = await resolveTabIdFromTarget(targetId)
    if (!tabId) throw new Error(`Cannot resolve targetId to tab: ${targetId}`)
    return tabId
  }

  function explicitCdpTargetId(args = {}, params = {}) {
    const targetId = String(args.targetId || params.targetId || "").trim()
    if (targetId) return targetId
    const tabId = Number(args.tabId ?? params.tabId)
    if (Number.isFinite(tabId) && tabId > 0) return `tab-${tabId}`
    return ""
  }

  function resolveTabIdFromTargetSync(targetId) {
    if (!targetId) return null
    if (targetId.startsWith("tab-")) {
      const id = Number(targetId.slice(4))
      return Number.isFinite(id) && id > 0 ? id : null
    }
    const numericId = Number(targetId)
    if (/^\d+$/.test(targetId) && Number.isFinite(numericId) && numericId > 0) {
      return numericId
    }
    for (const [tabId, session] of sessionsByTab) {
      if (session.browserSessionId === targetId) return tabId
    }
    return null
  }

  async function resolveTabIdFromTarget(targetId) {
    const syncTabId = resolveTabIdFromTargetSync(targetId)
    if (syncTabId) return syncTabId
    if (chrome.debugger?.getTargets) {
      try {
        const targets = await chromeDebuggerGetTargets()
        const found = targets.find((target) => target.id === targetId)
        const tabId = Number(found?.tabId)
        if (Number.isFinite(tabId) && tabId > 0) return tabId
      } catch {}
    }
    return null
  }

  function chromeDebuggerGetTargets() {
    return new Promise((resolve, reject) => {
      chrome.debugger.getTargets((targets) => {
        const error = chrome.runtime.lastError
        if (error) reject(new Error(error.message))
        else resolve(targets || [])
      })
    })
  }

  async function ensureCdpAttached(tabId, protocolVersion = "1.3") {
    if (!chrome.debugger?.attach) {
      throw new Error("chrome.debugger API is unavailable")
    }
    if (cdpAttachedTabs.has(tabId)) {
      await ensureCdpDomains(tabId, ["Page", "Runtime", "Log"])
      return { attached: false, reused: true, protocolVersion }
    }
    try {
      await chromeDebuggerAttach({ tabId }, protocolVersion)
    } catch (error) {
      // The in-memory bookkeeping can fall out of sync with the browser while the
      // tab stays attached to this extension. Two paths lead there: an MV3
      // service worker is evicted after ~30s idle and loses cdpAttachedTabs, and
      // a timed-out CDP command drops its entry without actually detaching.
      // Re-attaching then fails with the browser's own "Another debugger is
      // already attached", which is not a real failure for this extension:
      // recognize it and keep using the attachment instead of failing every
      // later CDP call on that tab.
      if (!/another debugger is already attached/i.test(String(error?.message || ""))) {
        throw error
      }
    }
    cdpAttachedTabs.add(tabId)
    await ensureCdpDomains(tabId, ["Page", "Runtime", "Log"])
    return { attached: true, reused: false, protocolVersion }
  }

  async function ensureCdpDomains(tabId, domains = []) {
    if (!cdpEnabledDomains.has(tabId)) cdpEnabledDomains.set(tabId, new Set())
    const enabled = cdpEnabledDomains.get(tabId)
    for (const domain of domains) {
      if (enabled.has(domain)) continue
      await chromeDebuggerSendCommand({ tabId }, `${domain}.enable`, {})
      enabled.add(domain)
    }
  }

  async function detachCdpTab(tabId, session = null, reason = "manual") {
    if (!tabId || !cdpAttachedTabs.has(tabId)) {
      return {
        browserSessionId: session?.browserSessionId || "",
        tabId,
        detached: false,
        reason: "not_attached",
      }
    }
    await chromeDebuggerDetach({ tabId })
    cdpAttachedTabs.delete(tabId)
    cdpEnabledDomains.delete(tabId)
    traceBuffers.delete(tabId)
    return {
      browserSessionId: session?.browserSessionId || "",
      tabId,
      detached: true,
      reason,
      detachedAt: new Date().toISOString(),
    }
  }

  function chromeDebuggerAttach(target, protocolVersion) {
    return new Promise((resolve, reject) => {
      chrome.debugger.attach(target, protocolVersion, () => {
        const error = chrome.runtime.lastError
        if (error) reject(new Error(error.message))
        else resolve(null)
      })
    })
  }

  function chromeDebuggerDetach(target) {
    return new Promise((resolve, reject) => {
      chrome.debugger.detach(target, () => {
        const error = chrome.runtime.lastError
        if (error) reject(new Error(error.message))
        else resolve(null)
      })
    })
  }

  function chromeDebuggerSendCommand(target, method, params, options = {}) {
    return withCommandTimeout(
      new Promise((resolve, reject) => {
        chrome.debugger.sendCommand(target, method, params, (result) => {
          const error = chrome.runtime.lastError
          if (error) reject(new Error(error.message))
          else resolve(result)
        })
      }),
      target,
      method,
      options
    )
  }

  function withCommandTimeout(promise, target, method, options = {}) {
    // Floor kept low so tests and heavily throttled environments can use short
    // budgets; the production default is 10s.
    const timeoutMs = Math.max(250, Number(options.timeoutMs) || Number(commandTimeoutMs) || DEFAULT_CDP_COMMAND_TIMEOUT_MS)
    let timer = null
    return Promise.race([
      promise.then((value) => {
        if (timer) clearTimeout(timer)
        return value
      }),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          const tabId = Number(target?.tabId)
          if (Number.isFinite(tabId) && tabId > 0) {
            // The debugger session is no longer trustworthy: drop the attach
            // bookkeeping so the next call re-attaches instead of reusing a
            // session whose command never came back.
            cdpAttachedTabs.delete(tabId)
            cdpEnabledDomains.delete(tabId)
          }
          const error = new Error(
            `YUNTI_CDP_TIMEOUT ${method} did not answer within ${timeoutMs}ms on tab ${tabId || "unknown"}. ` +
              `retryable=false retryBudget=0 recoveryAction=verify_state_before_retry`
          )
          error.code = "YUNTI_CDP_TIMEOUT"
          error.structuredFailure = {
            code: error.code, retryable: false, retryBudget: 0, resultUncertain: true,
            recoveryAction: "verify_state_before_retry",
            diagnostics: { phase: "cdp", method, tabId, effectiveTimeoutMs: timeoutMs },
          }
          reject(error)
        }, timeoutMs)
      }),
    ])
  }

  async function startPerformanceTrace(tabId, session, args = {}) {
    const categoriesStr = String(args.categories || "blink,loading,rendering,page").trim()
    const includedCategories = categoriesStr
      .split(",")
      .map((category) => category.trim())
      .filter(Boolean)
    await ensureCdpAttached(tabId, "1.3")
    traceBuffers.set(tabId, {
      events: [],
      startedAt: Date.now(),
      completed: false,
    })
    await chromeDebuggerSendCommand({ tabId }, "Tracing.start", {
      traceConfig: {
        includedCategories,
        memoryDumpConfig: {},
      },
    })
    return { tracing: true, categories: categoriesStr, browserSessionId: session.browserSessionId }
  }

  async function stopPerformanceTrace(tabId, session) {
    await ensureCdpAttached(tabId, "1.3")
    const buffer = traceBuffers.get(tabId) || {
      events: [],
      startedAt: Date.now(),
      completed: false,
    }
    traceBuffers.set(tabId, buffer)
    await chromeDebuggerSendCommand({ tabId }, "Tracing.end", {})
    await waitForTraceComplete(tabId, 5000)
    const events = buffer.events || []
    const durationMs = Date.now() - (buffer.startedAt || Date.now())
    traceBuffers.delete(tabId)
    return {
      events: events.slice(0, 1000),
      eventsTruncated: events.length > 1000,
      durationMs,
      browserSessionId: session.browserSessionId,
    }
  }

  function recordTraceEvent(tabId, method, params = {}) {
    const buffer = traceBuffers.get(tabId)
    if (!buffer) return
    if (method === "Tracing.dataCollected") {
      const value = Array.isArray(params.value) ? params.value : []
      buffer.events.push(...value)
    } else if (method === "Tracing.tracingComplete") {
      buffer.completed = true
      buffer.stream = params.stream || ""
    }
  }

  async function waitForTraceComplete(tabId, timeoutMs = 5000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const buffer = traceBuffers.get(tabId)
      if (!buffer || buffer.completed) return
      await delayCdp(100)
    }
  }

  function delayCdp(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  return {
    chromeDebuggerSendCommand,
    clearDialogState,
    delayCdp,
    detachCdpTab,
    dialogState,
    ensureCdpAttached,
    getBrowserTarget,
    installCdpEventForwarder,
    lastDialogActivity,
    listBrowserTargets,
    sendCdpCommand,
    startPerformanceTrace,
    stopPerformanceTrace,
    waitForDialogOpen,
  }
}
