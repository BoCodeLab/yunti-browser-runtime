const BROWSER_CONTROLLER_TOOLS = new Set([
  "yunti_list_browser_targets",
  "yunti_list_pages",
  "yunti_get_browser_target",
  "yunti_cdp_send_command",
  "yunti_new_page",
])

export function createToolDispatcher({
  sessionsByTab,
  postBridge,
  ensureTabRegistered,
  cdp,
}) {
  const {
    chromeDebuggerSendCommand,
    delayCdp,
    detachCdpTab,
    ensureCdpAttached,
    getBrowserTarget,
    listBrowserTargets,
    sendCdpCommand,
    startPerformanceTrace,
    stopPerformanceTrace,
  } = cdp

  async function executeToolRequest(tabId, session, event) {
    const transportSession = session
    let result
    let ok = true
    let error = null
    try {
      if (Number.isFinite(Number(event?.deadlineAt)) && Number(event.deadlineAt) <= Date.now()) {
        throw new Error(`Browser tool request timed out before execution: ${event.tool || "unknown"}`)
      }
      const route = await resolveToolPageRoute(tabId, session, event)
      tabId = route.tabId
      session = route.session
      assertConcretePageRoute(tabId, session, event)
      if (event.tool === "yunti_capture_visible_tab") {
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab(session.windowId, {
            format: "png",
          })
          result = {
            dataUrl,
            mimeType: "image/png",
            method: "tabs.captureVisibleTab",
            browserSessionId: session.browserSessionId,
            url: session.url,
            title: session.title || "",
            capturedAt: new Date().toISOString(),
          }
        } catch (permError) {
          // Fall back to CDP Page.captureScreenshot when activeTab
          // permission is not available (e.g. tool call via relay without
          // direct user interaction on the extension)
          await ensureCdpAttached(tabId, "1.3")
          const shot = await chromeDebuggerSendCommand(
            { tabId },
            "Page.captureScreenshot",
            { format: "png" }
          )
          const dataUrl = `data:image/png;base64,${shot?.data || ""}`
          result = {
            dataUrl,
            mimeType: "image/png",
            method: "cdp.Page.captureScreenshot",
            browserSessionId: session.browserSessionId,
            url: session.url,
            title: session.title || "",
            capturedAt: new Date().toISOString(),
          }
        }
      } else if (event.tool === "yunti_cdp_send_command") {
        result = await sendCdpCommand(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_list_browser_targets" || event.tool === "yunti_list_pages") {
        result = await listBrowserTargets(session)
      } else if (event.tool === "yunti_get_browser_target") {
        result = await getBrowserTarget(session, event.arguments || {})
      } else if (event.tool === "yunti_cdp_detach") {
        result = await detachCdpTab(tabId, session, "tool_request")
      } else if (event.tool === "yunti_navigate_page") {
        result = await navigatePage(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_take_screenshot") {
        result = await takeScreenshot(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_evaluate_script") {
        result = await evaluateScript(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_take_snapshot") {
        result = await takeSnapshot(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_observe_page") {
        result = await observePage(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_find_elements") {
        result = await findElements(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_click") {
        result = await clickByUid(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_hover") {
        result = await hoverByUid(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_fill") {
        result = await fillByUid(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_select") {
        result = await selectElement(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_fill_form") {
        result = await fillForm(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_wait_for") {
        result = await waitForCondition(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_handle_dialog") {
        result = await handleDialog(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_resize_page") {
        result = await resizePage(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_emulate") {
        result = await emulateDevice(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_performance_start_trace") {
        result = await startPerformanceTrace(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_performance_stop_trace") {
        result = await stopPerformanceTrace(tabId, session)
      } else if (event.tool === "yunti_new_page") {
        result = await newPage(session, event.arguments || {})
      } else if (event.tool === "yunti_close_page") {
        result = await closePage(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_drag") {
        result = await performDrag(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_upload_file") {
        result = await uploadFile(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_type_text") {
        result = await typeTextByUid(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_press_key") {
        result = await pressKeyByUid(tabId, session, event.arguments || {})
      } else if (event.tool === "yunti_scroll") {
        result = await scrollPage(tabId, session, event.arguments || {})
      } else {
        result = await chrome.tabs.sendMessage(tabId, {
          type: "yunti_execute_tool",
          tool: event.tool,
          arguments: event.arguments || {},
        })
      }
    } catch (err) {
      ok = false
      error = err instanceof Error ? err.message : String(err)
    }
  
    await postBridge("/extension/result", {
      browserSessionId: transportSession.browserSessionId,
      requestId: event.id,
      ok,
      result,
      error,
    }).catch(() => {})
  }

  function assertConcretePageRoute(tabId, session, event) {
    if (!isBrowserControllerSession(session)) return
    if (BROWSER_CONTROLLER_TOOLS.has(event.tool)) return
    if (Number.isFinite(Number(tabId)) && Number(tabId) > 0) return
    throw new Error(
      `${event.tool} needs a concrete page session. The browser controller route is online for whole-browser inventory and explicit CDP target routing; call yunti_list_browser_targets, select/register the intended page, then retry the page operation.`
    )
  }

  function isBrowserControllerSession(session) {
    return session?.kind === "browser_controller" || session?.tabId === null
  }

  async function resolveToolPageRoute(tabId, session, event) {
    if (!isBrowserControllerSession(session)) {
      return { tabId, session }
    }
    if (BROWSER_CONTROLLER_TOOLS.has(event.tool)) {
      if (event.tool !== "yunti_cdp_send_command") return { tabId, session }
      const routeTabId =
        normalizeTabId(event.route?.tabId) ||
        normalizeTabId(event.arguments?.tabId) ||
        tabIdFromTargetId(event.route?.targetId) ||
        tabIdFromTargetId(event.arguments?.targetId) ||
        tabIdFromTargetId(event.arguments?.params?.targetId)
      return {
        tabId: routeTabId,
        session: event.route?.browserSessionId
          ? { ...session, browserSessionId: event.route.browserSessionId }
          : session,
      }
    }
    const targetTabId =
      normalizeTabId(event.route?.tabId) ||
      normalizeTabId(event.arguments?.tabId) ||
      tabIdFromTargetId(event.route?.targetId) ||
      tabIdFromTargetId(event.arguments?.targetId) ||
      tabIdFromTargetId(event.arguments?.params?.targetId) ||
      (await activeTabId())
    if (!targetTabId) {
      throw new Error(`${event.tool} could not resolve an active http/https browser tab.`)
    }
    const knownPageSession = sessionsByTab.get(targetTabId) || null
    if (knownPageSession) {
      const currentTab = knownPageSession.url
        ? await chrome.tabs.get(targetTabId).catch(() => null)
        : null
      if (!knownPageSession.url || !currentTab?.url || currentTab.url === knownPageSession.url) {
        return { tabId: targetTabId, session: knownPageSession }
      }
    }
    const recovery = await ensureTabRegistered(targetTabId, {
      reason: `tool_request_${event.tool}`,
    })
    const pageSession = recovery?.session || sessionsByTab.get(targetTabId) || null
    if (!pageSession) {
      throw new Error(
        `${event.tool} could not establish a page session for tabId ${targetTabId}: ${recovery?.error || recovery?.reason || "registration failed"}`
      )
    }
    return { tabId: targetTabId, session: pageSession }
  }

  async function activeTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return normalizeTabId(tab?.id)
  }

  function normalizeTabId(value) {
    const normalized = Number(value)
    return Number.isFinite(normalized) && normalized > 0 ? normalized : null
  }

  function tabIdFromTargetId(value) {
    const targetId = String(value || "").trim()
    if (targetId.startsWith("tab-")) return normalizeTabId(targetId.slice(4))
    return /^\d+$/.test(targetId) ? normalizeTabId(targetId) : null
  }
  
  async function navigatePage(tabId, session, args = {}) {
    const action = String(args.action || "url").trim()
    const url = String(args.url || "").trim()
  
    if (action === "reload") {
      await chrome.tabs.reload(tabId)
      return { navigated: true, action: "reload", tabId, browserSessionId: session.browserSessionId }
    }
  
    if (action === "back" || action === "forward") {
      await ensureCdpAttached(tabId, "1.3")
      let history
      try {
        history = await chromeDebuggerSendCommand(
          { tabId },
          "Page.getNavigationHistory",
          {}
        )
      } catch (error) {
        return navigateHistoryViaRuntime(
          tabId,
          session,
          action,
          `Page.getNavigationHistory failed: ${error?.message || String(error)}`
        )
      }
      const entries = history?.entries || []
      const currentIndex = history?.currentIndex ?? -1
      const targetIndex = action === "back" ? currentIndex - 1 : currentIndex + 1
      if (targetIndex < 0 || targetIndex >= entries.length) {
        return navigateHistoryViaRuntime(
          tabId,
          session,
          action,
          `no CDP history entry at index ${targetIndex}`
        )
      }
      try {
        await chromeDebuggerSendCommand(
          { tabId },
          "Page.navigateToHistoryEntry",
          { entryId: entries[targetIndex].id }
        )
        return {
          navigated: true,
          action,
          tabId,
          url: entries[targetIndex].url,
          browserSessionId: session.browserSessionId,
          method: "Page.navigateToHistoryEntry",
        }
      } catch (error) {
        return navigateHistoryViaRuntime(
          tabId,
          session,
          action,
          `Page.navigateToHistoryEntry failed: ${error?.message || String(error)}`
        )
      }
    }
  
    // action === "url" (default)
    if (!url) throw new Error("url is required for navigate action 'url'")
    await chrome.tabs.update(tabId, { url })
    return { navigated: true, action: "url", url, tabId, browserSessionId: session.browserSessionId }
  }
  
  async function navigateHistoryViaRuntime(tabId, session, action, reason) {
    const method = action === "back" ? "back" : "forward"
    try {
      await chromeDebuggerSendCommand(
        { tabId },
        "Runtime.evaluate",
        {
          expression: `window.history.${method}(); true`,
          returnByValue: true,
        }
      )
    } catch (error) {
      throw new Error(
        `Cannot navigate ${action}: ${reason}; Runtime.evaluate window.history.${method}() failed: ${error?.message || String(error)}`
      )
    }
    return {
      navigated: true,
      action,
      tabId,
      browserSessionId: session.browserSessionId,
      method: `Runtime.evaluate(window.history.${method})`,
      fallback: true,
      fallbackReason: reason,
    }
  }
  
  async function takeScreenshot(tabId, session, args = {}) {
    const format = String(args.format || "png").trim() === "jpeg" ? "jpeg" : "png"
    const quality = format === "jpeg" ? clampQuality(args.quality) : undefined
    const fullPage = Boolean(args.fullPage)
    const clip = normalizeClip(args.clip)
  
    await ensureCdpAttached(tabId, "1.3")
  
    if (fullPage) {
      // Get full page dimensions
      const metrics = await chromeDebuggerSendCommand(
        { tabId },
        "Page.getLayoutMetrics",
        {}
      )
      const cssContentSize = metrics?.cssContentSize || metrics?.contentSize || {}
      const width = cssContentSize.width || 1280
      const height = cssContentSize.height || 720
  
      await chromeDebuggerSendCommand(
        { tabId },
        "Emulation.setDeviceMetricsOverride",
        { width: Math.ceil(width), height: Math.ceil(height), deviceScaleFactor: 1, mobile: false }
      )
    }
  
    const params = { format }
    if (quality !== undefined) params.quality = quality
    if (clip) {
      params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: clip.scale ?? 1 }
    }
    if (fullPage) {
      params.captureBeyondViewport = true
    }
  
    let shot
    try {
      shot = await chromeDebuggerSendCommand({ tabId }, "Page.captureScreenshot", params)
    } finally {
      if (fullPage) {
        await chromeDebuggerSendCommand(
          { tabId },
          "Emulation.clearDeviceMetricsOverride",
          {}
        ).catch(() => {})
      }
    }
  
    const mimeType = `image/${format}`
    const dataUrl = `data:${mimeType};base64,${shot?.data || ""}`
    return {
      dataUrl,
      mimeType,
      browserSessionId: session.browserSessionId,
      format,
      fullPage,
      capturedAt: new Date().toISOString(),
    }
  }
  
  function clampQuality(value) {
    const num = Number(value)
    return Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : 80
  }
  
  function normalizeClip(value) {
    if (!value || typeof value !== "object") return null
    const x = Number(value.x)
    const y = Number(value.y)
    const width = Number(value.width)
    const height = Number(value.height)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null
    const scale = Number.isFinite(Number(value.scale)) && Number(value.scale) > 0 ? Number(value.scale) : 1
    return { x, y, width, height, scale }
  }
  
  async function evaluateScript(tabId, session, args = {}) {
    const expression = String(args.expression || "").trim()
    if (!expression) throw new Error("expression is required")
    const awaitPromise = Boolean(args.awaitPromise)
    const maxLength = Number.isFinite(Number(args.maxLength)) && Number(args.maxLength) > 0
      ? Math.min(Number(args.maxLength), 100000)
      : 10000
  
    await ensureCdpAttached(tabId, "1.3")
  
    const result = await chromeDebuggerSendCommand(
      { tabId },
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise }
    )
  
    if (result?.exceptionDetails) {
      const text = result.exceptionDetails.text || result.exceptionDetails.exception?.description || "Script error"
      throw new Error(text)
    }
  
    const value = result?.result?.value
    const type = result?.result?.type || typeof value
    const serialized = serializeResult(value, maxLength)
  
    return {
      value: serialized,
      type,
      truncated: typeof value === "string" && value.length > maxLength,
      browserSessionId: session.browserSessionId,
    }
  }
  
  function serializeResult(value, maxLength) {
    if (value === undefined || value === null) return value
    if (typeof value === "string") {
      return value.length > maxLength ? value.slice(0, maxLength) + "..." : value
    }
    if (typeof value === "number" || typeof value === "boolean") return value
    try {
      const json = JSON.stringify(value)
      return json.length > maxLength ? json.slice(0, maxLength) + "..." : json
    } catch {
      return String(value).slice(0, maxLength)
    }
  }
  
  // Latest page uid state from yunti_observe_page or yunti_take_snapshot.
  const pageUidStore = new Map()
  
  async function takeSnapshot(tabId, session, args = {}) {
    const maxElements = Number.isFinite(Number(args.maxElements))
      ? Math.max(1, Math.min(500, Number(args.maxElements)))
      : 200
    const includeHidden = Boolean(args.includeHidden)
  
    await ensureCdpAttached(tabId, "1.3")
  
    let elements = []
    try {
      const axTree = await chromeDebuggerSendCommand(
        { tabId },
        "Accessibility.getFullAXTree",
        {}
      )
      elements = flattenAXTree(axTree?.nodes || [], maxElements, includeHidden)
    } catch {
      // Accessibility tree unavailable, fall back to DOM
      elements = await domFallbackSnapshot(tabId, maxElements)
    }
  
    storePageUidMap(session, "snapshot", elements)
  
    return {
      browserSessionId: session.browserSessionId,
      url: session.url || "",
      title: session.title || "",
      elements,
      elementCount: elements.length,
      snapshotId: `snap-${Date.now()}`,
    }
  }

  async function observePage(tabId, session, args = {}) {
    const observation = await chrome.tabs.sendMessage(tabId, {
      type: "yunti_execute_tool",
      tool: "yunti_observe_page",
      arguments: args,
    })
    if (observation?.responseMode !== "delta" && Array.isArray(observation?.elements)) {
      storePageUidMap(session, "observe", [
        ...observation.elements,
        ...(Array.isArray(observation.scrollableContainers) ? observation.scrollableContainers : []),
      ], {
        observationId: observation.observationId,
        uidMapVersion: observation.uidMapVersion,
      })
    }
    return {
      ...observation,
      browserSessionId: session.browserSessionId,
      url: observation?.url || session.url || "",
      title: observation?.title || session.title || "",
    }
  }

  async function findElements(tabId, session, args = {}) {
    const result = await chrome.tabs.sendMessage(tabId, {
      type: "yunti_execute_tool",
      tool: "yunti_find_elements",
      arguments: args,
    })
    if (Array.isArray(result?.matches)) {
      storePageUidMap(session, "find", result.matches, {
        observationId: result.observationId,
        uidMapVersion: result.uidMapVersion,
      })
    }
    return result
  }

  function storePageUidMap(session, source, elements, meta = {}) {
    const uidMap = {}
    for (const el of elements || []) {
      if (!el?.uid) continue
      uidMap[el.uid] = { ...el, source }
    }
    pageUidStore.set(session.browserSessionId, {
      source,
      uidMap,
      storedAt: Date.now(),
      ...meta,
    })
  }
  
  function flattenAXTree(nodes, maxElements, includeHidden) {
    const elements = []
    let uidCounter = 0
  
    function walk(nodeList) {
      for (const node of nodeList) {
        if (elements.length >= maxElements) return
        const el = axNodeToElement(node, ++uidCounter, includeHidden)
        if (el) elements.push(el)
        if (node.children) walk(node.children)
        if (node.childIds) {
          // childIds reference other nodes in the tree by backendDOMNodeId
        }
      }
    }
  
    walk(Array.isArray(nodes) ? nodes : [])
    return elements
  }
  
  function axNodeToElement(node, uid, includeHidden) {
    const role = String(node.role?.value || "").toLowerCase()
    if (!role) return null
  
    const name = String(node.name?.value || "").trim()
    const description = String(node.description?.value || "").trim()
  
    // Skip non-interactive and hidden elements
    const isInteractive = /button|link|textbox|combobox|listbox|checkbox|radio|menuitem|tab|switch|slider|spinbutton|option|treeitem|gridcell|rowheader|columnheader/i.test(role)
    const isStructural = /heading|list|listitem|table|row|cell|group|region|banner|main|navigation|article|section|status|alert/i.test(role)
    const hasName = name.length > 0
  
    if (!isInteractive && !isStructural && !hasName) return null
    if (!includeHidden) {
      const hidden = node.properties?.find(p => p.name === "hidden")?.value?.value
      if (hidden === true) return null
    }
  
    return {
      uid: `yunti-${uid}`,
      role,
      name,
      description: description || undefined,
      backendNodeId: node.backendDOMNodeId,
      nodeId: node.nodeId,
      childCount: (node.children?.length || 0),
      properties: summarizeAXProperties(node.properties),
    }
  }
  
  function summarizeAXProperties(properties) {
    if (!Array.isArray(properties)) return undefined
    const out = {}
    for (const prop of properties) {
      if (prop.name === "hidden" || prop.name === "focusable" || prop.name === "focused" ||
          prop.name === "disabled" || prop.name === "checked" || prop.name === "selected" ||
          prop.name === "expanded" || prop.name === "haspopup" || prop.name === "required" ||
          prop.name === "invalid" || prop.name === "level" || prop.name === "valuemin" ||
          prop.name === "valuemax" || prop.name === "valuenow" || prop.name === "valuetext" ||
          prop.name === "multiselectable" || prop.name === "readonly") {
        out[prop.name] = prop.value?.value ?? prop.value ?? true
      }
    }
    return Object.keys(out).length ? out : undefined
  }
  
  async function domFallbackSnapshot(tabId, maxElements) {
    const result = await chromeDebuggerSendCommand(
      { tabId },
      "Runtime.evaluate",
      {
        expression: `(() => {
          const elements = [];
          const interactive = 'a,button,input,select,textarea,[role="button"],[role="link"],[role="textbox"],[role="combobox"],[role="checkbox"],[role="radio"],[onclick]';
          const all = document.querySelectorAll(interactive);
          for (let i = 0; i < Math.min(all.length, ${maxElements}); i++) {
            const el = all[i];
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
            elements.push({
              tag: el.tagName.toLowerCase(),
              id: el.id || undefined,
              name: (el.getAttribute('name') || '').slice(0, 100) || undefined,
              text: (el.textContent || '').trim().slice(0, 200) || undefined,
              type: el.type || undefined,
              placeholder: (el.placeholder || '').slice(0, 100) || undefined,
              href: el.href || undefined,
              role: el.getAttribute('role') || undefined,
              ariaLabel: (el.getAttribute('aria-label') || '').slice(0, 200) || undefined,
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
              disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
            });
          }
          return elements;
        })()`,
        returnByValue: true,
      }
    )
    const rawElements = result?.result?.value || []
    return rawElements.map((el, i) => ({
      uid: `yunti-${i + 1}`,
      role: el.role || el.tag || "element",
      name: el.ariaLabel || el.text || el.name || el.placeholder || el.id || "",
      tag: el.tag,
      id: el.id,
      type: el.type,
      placeholder: el.placeholder,
      href: el.href,
      rect: el.rect,
      disabled: el.disabled,
    }))
  }
  
  async function clickByUid(tabId, session, args = {}) {
    const uid = String(args.uid || "").trim()
    if (uid) {
      let point
      try {
        point = await resolveUidCenter(tabId, session, uid)
      } catch (error) {
        return buildUidPointFailureResult(session, uid, "click", error?.message || String(error))
      }
      const result = await chrome.tabs.sendMessage(tabId, {
        type: "yunti_execute_tool",
        tool: "yunti_click",
        arguments: { ...args, x: point.x, y: point.y },
      })
      if (!result || typeof result !== "object" || result.clicked !== true) {
        return buildUidPointFailureResult(session, uid, "click", result?.error || "Uid click failed")
      }
      const roundedX = Math.round(point.x)
      const roundedY = Math.round(point.y)
      return {
        ...result,
        uid,
        x: roundedX,
        y: roundedY,
        browserSessionId: session.browserSessionId,
        action: "click",
        target: { uid, x: roundedX, y: roundedY },
        ok: true,
        recoverable: false,
        nextStepHint: "Click dispatched without attaching Chrome debugger. Observe again or read page state to verify the intended change.",
      }
    }
    const x = Number(args.x)
    const y = Number(args.y)
    if (Number.isFinite(x) || Number.isFinite(y)) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("yunti_click coordinate mode requires both x and y. Use yunti_click_at with x/y, or call yunti_take_snapshot and pass uid.")
      }
      const result = await chrome.tabs.sendMessage(tabId, {
        type: "yunti_execute_tool",
        tool: "yunti_click",
        arguments: { ...args, x, y },
      })
      if (!result || typeof result !== "object" || result.clicked !== true) return result
      const roundedX = Math.round(x)
      const roundedY = Math.round(y)
      return {
        ...result,
        x: roundedX,
        y: roundedY,
        browserSessionId: session.browserSessionId,
        method: "coordinate",
        action: "click",
        target: { method: "coordinate", x: roundedX, y: roundedY },
        ok: true,
        recoverable: false,
        nextStepHint: "Coordinate click dispatched without attaching Chrome debugger. Observe again, read page state, or use a fresh uid when possible to verify the intended change.",
      }
    }
    const selector = String(args.selector || "").trim()
    if (!selector) {
      throw new Error("yunti_click requires uid, selector, or both x and y. Call yunti_take_snapshot to get uid, pass a CSS selector, or use yunti_click_at for coordinate-only clicks.")
    }
    const contentResult = await chrome.tabs.sendMessage(tabId, {
      type: "yunti_execute_tool",
      tool: "yunti_click",
      arguments: args,
    })
    if (contentResult && typeof contentResult === "object" && contentResult.clicked === true) {
      return {
        ...contentResult,
        selector,
        browserSessionId: session.browserSessionId,
        method: "selector",
        action: "click",
        target: { selector, method: "selector" },
        ok: true,
        recoverable: false,
        nextStepHint: "Selector click dispatched. Observe again, read page state, or use a fresh uid when possible to verify the intended change.",
      }
    }
    return buildSelectorActionFailureResult(session, "click", selector, contentResult, {
      recommendedTools: ["yunti_observe_page", "yunti_wait_for", "yunti_click"],
      nextAction: "observe-or-wait-before-retrying-click",
      decision: "inspect-readiness-before-selector-click-retry",
      message: "The selector click could not be completed yet. Wait for the target to appear, become enabled, or stop being covered before retrying the same click.",
    })
  }
  
  async function hoverByUid(tabId, session, args = {}) {
    const uid = String(args.uid || "").trim()
    if (uid) {
      let point
      try {
        point = await resolveUidCenter(tabId, session, uid)
      } catch (error) {
        return buildUidPointFailureResult(session, uid, "hover", error?.message || String(error))
      }
      const result = await chrome.tabs.sendMessage(tabId, {
        type: "yunti_execute_tool",
        tool: "yunti_hover",
        arguments: { ...args, x: point.x, y: point.y },
      })
      if (!result || typeof result !== "object" || result.hovered !== true) {
        return buildUidPointFailureResult(session, uid, "hover", result?.error || "Uid hover failed")
      }
      const roundedX = Math.round(point.x)
      const roundedY = Math.round(point.y)
      return {
        ...result,
        uid,
        x: roundedX,
        y: roundedY,
        browserSessionId: session.browserSessionId,
        action: "hover",
        target: { uid, x: roundedX, y: roundedY },
        ok: true,
        recoverable: false,
        nextStepHint: "Hover dispatched without attaching Chrome debugger. Observe again or read page state to verify menus, tooltips, or hover-only controls.",
      }
    }
    const x = Number(args.x)
    const y = Number(args.y)
    if (Number.isFinite(x) || Number.isFinite(y)) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("yunti_hover coordinate mode requires both x and y. Call yunti_take_snapshot to get uid, pass selector, or provide both coordinates.")
      }
      const result = await chrome.tabs.sendMessage(tabId, {
        type: "yunti_execute_tool",
        tool: "yunti_hover",
        arguments: { ...args, x, y },
      })
      if (!result || typeof result !== "object" || result.hovered !== true) return result
      const roundedX = Math.round(x)
      const roundedY = Math.round(y)
      return {
        ...result,
        hovered: true,
        x: roundedX,
        y: roundedY,
        browserSessionId: session.browserSessionId,
        method: "coordinate",
        action: "hover",
        target: { method: "coordinate", x: roundedX, y: roundedY },
        ok: true,
        recoverable: false,
        nextStepHint: "Coordinate hover dispatched without attaching Chrome debugger. Observe again, read page state, or use a fresh uid when possible to verify menus, tooltips, or hover-only controls.",
      }
    }
    const selector = String(args.selector || "").trim()
    if (!selector) {
      throw new Error("yunti_hover requires uid, selector, or both x and y. Call yunti_take_snapshot to get uid or pass a CSS selector.")
    }
    const result = await chrome.tabs.sendMessage(tabId, {
      type: "yunti_execute_tool",
      tool: "yunti_hover",
      arguments: args,
    })
    if (!result || typeof result !== "object" || result.hovered !== true) {
      return buildSelectorActionFailureResult(session, "hover", selector, result, {
        recommendedTools: ["yunti_observe_page", "yunti_wait_for", "yunti_hover"],
        nextAction: "observe-or-wait-before-retrying-hover",
        decision: "inspect-readiness-before-selector-hover-retry",
        message: "The selector hover could not be completed yet. Wait for the target to appear, become visible, or stop being covered before retrying.",
      })
    }
    return {
      ...result,
      hovered: true,
      selector,
      browserSessionId: session.browserSessionId,
      method: "selector",
      action: "hover",
      target: { selector, method: "selector" },
      ok: true,
      recoverable: false,
      nextStepHint: "Selector hover dispatched without attaching Chrome debugger. Observe again, read page state, or use a fresh uid when possible to verify menus, tooltips, or hover-only controls.",
    }
  }
  
  async function fillByUid(tabId, session, args = {}) {
    validateFillArgs(args)
    const uid = String(args.uid || "").trim()
    const value = String(args.value)
    if (uid) {
      try {
        let point
        try {
          point = await resolveUidCenter(tabId, session, uid)
        } catch (error) {
          return buildUidFillFailureResult(session, uid, {
            code: "UID_COORDINATES_UNAVAILABLE",
            error: error?.message || String(error),
          })
        }
        const result = await chrome.tabs.sendMessage(tabId, {
          type: "yunti_execute_tool",
          tool: "yunti_fill",
          arguments: { ...args, x: point.x, y: point.y },
        })
        if (!result || typeof result !== "object" || result.filled !== true) {
          return buildUidFillFailureResult(session, uid, result)
        }
        const method = result.method || "dom"
        if (result.valueApplied === false) {
          return buildUidFillFailureResult(session, uid, {
            ...result,
            code: "VALUE_NOT_APPLIED",
            error: `Filled value did not remain on uid ${uid}`,
            method,
            expectedValueLength: value.length,
          })
        }
        return {
          ...result,
          filled: true,
          uid,
          method,
          value,
          browserSessionId: session.browserSessionId,
          action: "fill",
          target: { uid, method },
          ok: true,
          recoverable: false,
          nextStepHint: method === "contenteditable"
            ? "Contenteditable fill dispatched. Observe again, read page text, or evaluate textContent to verify the intended change."
            : "Fill dispatched without attaching Chrome debugger. Observe again, read page state, or evaluate the field value to verify the intended change.",
        }
    } catch (error) {
      return buildUidFillFailureResult(session, uid, {
        error: error?.message || "Uid fill failed",
      })
    }
    }
  
    const selector = String(args.selector || "").trim()
    let result
    try {
      result = await chrome.tabs.sendMessage(tabId, {
        type: "yunti_execute_tool",
        tool: "yunti_fill",
        arguments: args,
      })
    } catch (error) {
      return buildSelectorFillFailureResult(session, selector, {
        error: error?.message || "Selector fill failed",
      })
    }

    if (!result || typeof result !== "object" || result.filled !== true) {
      return buildSelectorFillFailureResult(session, selector, result)
    }

    return {
      ...result,
      selector,
      method: result.method || "selector",
      browserSessionId: session.browserSessionId,
      action: "fill",
      target: { selector, method: "selector" },
      ok: true,
      recoverable: false,
      nextStepHint: "Selector fill dispatched. Observe again, read page state, or evaluate the field value to verify the intended change.",
    }
  }

  function buildSelectorFillFailureResult(session, selector, fillResult = {}) {
    const error = fillResult?.error || "Selector fill failed"
    const code = fillResult?.code || inferFillFailureCode(error, "SELECTOR_FILL_FAILED")
    const recoveryHint = {
      reason: "selector-fill-failed",
      recommendedTools: ["yunti_observe_page", "yunti_take_snapshot", "yunti_evaluate_script", "yunti_wait_for", "yunti_fill"],
      nextAction: code === "ELEMENT_NOT_FOUND" ? "observe-again" : "inspect-target-element",
      decision: code === "ELEMENT_NOT_FOUND" ? "refresh-observation-or-selector-before-retry" : "inspect-editability-before-retry",
      selector,
      message: "The selector fill could not be completed. Inspect whether the selector still matches an editable element, observe again for a fresh uid, or evaluate the field before retrying.",
    }

    if (["TARGET_HIDDEN", "TARGET_DISABLED", "TARGET_READONLY", "TARGET_OBSCURED"].includes(code)) {
      recoveryHint.nextAction = "wait-for-actionability"
      recoveryHint.decision = "wait-before-selector-fill-retry"
      recoveryHint.message = "The selector fill target exists but is not ready yet. Wait for it to appear, enable, unlock, or stop being covered before retrying the same fill."
    }

    return {
      ...(fillResult && typeof fillResult === "object" ? fillResult : {}),
      filled: false,
      selector,
      browserSessionId: session.browserSessionId,
      action: "fill",
      target: { selector, method: "selector" },
      ok: false,
      recoverable: true,
      code,
      error,
      recoveryHint,
      nextStepHint: "Selector fill failed. Observe again for a fresh uid, inspect whether the target is editable, or retry with a stable selector before repeating the same fill.",
    }
  }

  function buildUidFillFailureResult(session, uid, fillResult = {}) {
    const availableValues = Array.isArray(fillResult?.availableValues) ? fillResult.availableValues : undefined
    const availableTexts = Array.isArray(fillResult?.availableTexts) ? fillResult.availableTexts : undefined
    const error = fillResult?.error || `Cannot fill uid ${uid}`
    const code = fillResult?.code || inferFillFailureCode(error, "UID_FILL_FAILED")
    const recoveryHint = {
      reason: "uid-fill-failed",
      recommendedTools: ["yunti_observe_page", "yunti_take_snapshot", "yunti_evaluate_script", "yunti_fill"],
      nextAction: "inspect-target-element",
      decision: "inspect-editability-before-retry",
      uid,
      ...(availableValues ? { availableValues } : {}),
      ...(availableTexts ? { availableTexts } : {}),
      message: "The uid fill could not be completed. Refresh observation if the uid may be stale, inspect whether the target is editable, or retry with selector fallback.",
    }

    if (code === "ELEMENT_NOT_FOUND") {
      recoveryHint.nextAction = "observe-again"
      recoveryHint.decision = "refresh-observation-before-retry"
    } else if (code === "OPTION_NOT_FOUND") {
      recoveryHint.nextAction = "inspect-available-options"
      recoveryHint.decision = "inspect-options-before-retry"
    } else if (code === "VALUE_NOT_APPLIED") {
      recoveryHint.nextAction = "verify-field-state"
      recoveryHint.decision = "inspect-controlled-or-masked-field-before-retry"
      recoveryHint.message = "The fill dispatched, but the field value did not remain afterward. Inspect whether the target is framework-controlled, masked, or requires typing/press_key semantics before retrying."
    }

    return {
      ...(fillResult && typeof fillResult === "object" ? fillResult : {}),
      filled: false,
      uid,
      browserSessionId: session.browserSessionId,
      action: "fill",
      target: { uid, method: "uid" },
      ok: false,
      recoverable: true,
      code,
      error,
      ...(availableValues ? { availableValues } : {}),
      ...(availableTexts ? { availableTexts } : {}),
      recoveryHint,
      nextStepHint: "Uid fill failed. Observe again for a fresh uid, inspect whether the target is editable or a select with available options, or retry with selector fallback before repeating the same fill.",
    }
  }

  function inferFillFailureCode(error, fallbackCode) {
    const message = String(error || "").toLowerCase()
    if (message.includes("not found") || message.includes("cannot resolve coordinates")) return "ELEMENT_NOT_FOUND"
    if (message.includes("did not remain") || message.includes("did not stick") || message.includes("not applied")) return "VALUE_NOT_APPLIED"
    if (
      message.includes("not editable") ||
      message.includes("no editable target") ||
      message.includes("cannot accept text") ||
      message.includes("disabled") ||
      message.includes("read only") ||
      message.includes("readonly") ||
      message.includes("hidden") ||
      message.includes("no size")
    ) return "TARGET_NOT_EDITABLE"
    return fallbackCode
  }

  function buildFillEditabilityError(uid, elInfo = {}) {
    const tag = elInfo?.tag || "unknown"
    const type = elInfo?.type ? ` type=${elInfo.type}` : ""
    const reasons = []
    if (elInfo?.hidden) reasons.push("hidden or has no size")
    if (elInfo?.disabled) reasons.push("disabled")
    if (elInfo?.readOnly) reasons.push("readonly")
    if (elInfo?.editable === false) reasons.push("not editable")
    const reason = reasons.length ? reasons.join(", ") : "not editable"
    return `Target at uid ${uid} is not editable (${tag}${type}: ${reason})`
  }

  function summarizeFillTarget(elInfo = {}) {
    return {
      tag: elInfo?.tag,
      ...(elInfo?.type ? { type: elInfo.type } : {}),
      ...(elInfo?.contentEditable !== undefined ? { contentEditable: Boolean(elInfo.contentEditable) } : {}),
      ...(elInfo?.disabled !== undefined ? { disabled: Boolean(elInfo.disabled) } : {}),
      ...(elInfo?.readOnly !== undefined ? { readOnly: Boolean(elInfo.readOnly) } : {}),
      ...(elInfo?.hidden !== undefined ? { hidden: Boolean(elInfo.hidden) } : {}),
      ...(elInfo?.editable !== undefined ? { editable: Boolean(elInfo.editable) } : {}),
    }
  }

  async function scrollPage(tabId, session, args = {}) {
    const uid = String(args.uid || "").trim()
    let scrollArgs = args
    if (uid) {
      let point
      try {
        point = await resolveUidCenter(tabId, session, uid)
      } catch (error) {
        return buildUidScrollFailureResult(session, uid, {
          error: error?.message || "Uid scroll failed",
        })
      }
      const { x, y } = point
      scrollArgs = { ...args, x, y }
    }
    const result = await chrome.tabs.sendMessage(tabId, {
      type: "yunti_execute_tool",
      tool: "yunti_scroll",
      arguments: scrollArgs,
    })

    if (!result || typeof result !== "object" || result.scrolled !== true) {
      return result
    }

    const hasComparableScrollPosition =
      Number.isFinite(Number(result.before?.left)) &&
      Number.isFinite(Number(result.before?.top)) &&
      Number.isFinite(Number(result.after?.left)) &&
      Number.isFinite(Number(result.after?.top))
    const moved = hasComparableScrollPosition
      ? Number(result.before.left) !== Number(result.after.left) ||
        Number(result.before.top) !== Number(result.after.top)
      : undefined
    const noMovement = moved === false
    const edgeHint = noMovement ? inferScrollEdgeHint(result.deltaX, result.deltaY) : undefined
    const recoveryHint = noMovement ? buildScrollRecoveryHint(session, uid, edgeHint, result) : undefined
    const partialMovement = moved === true ? buildScrollPartialMovementHint(result, scrollArgs) : undefined
    const coordinateFallbackHint = !uid ? buildCoordinateScrollFallbackHint(result) : undefined

    return {
      ...result,
      browserSessionId: session.browserSessionId,
      action: "scroll",
      ...(uid ? { uid, method: "uid" } : {}),
      ...(uid ? { scrollTarget: { uid, method: "uid" } } : {}),
      ...(moved !== undefined ? { moved } : {}),
      ...(noMovement ? { code: "NO_SCROLL_MOVEMENT" } : {}),
      ...(edgeHint ? { edgeHint } : {}),
      ...(recoveryHint ? { recoveryHint } : {}),
      ...(partialMovement ? { partialMovement } : {}),
      ...(coordinateFallbackHint ? { coordinateFallbackHint } : {}),
      ok: !noMovement,
      recoverable: noMovement,
      nextStepHint: noMovement
        ? `Scroll dispatched but before/after positions did not change${edgeHint ? ` (${edgeHint})` : ""}. Observe again, inspect scroll boundaries, try the nearest scrollable container uid, or stop repeating the same scroll.`
        : partialMovement
          ? `Scroll moved partially${partialMovement.edgeHint ? ` (${partialMovement.edgeHint})` : ""}. Observe again and compare scroll positions before repeating the same scroll.`
        : coordinateFallbackHint
          ? "Coordinate scroll fell back to document scrolling. Observe again, inspect scrollableContainers[], and prefer a fresh scrollable container uid if a nested panel was intended."
        : uid
          ? "Uid-targeted scroll dispatched. Observe again or read page state to verify the intended container position."
          : "Scroll dispatched. Observe again or read page state to verify the intended viewport or container position.",
    }
  }

  function buildCoordinateScrollFallbackHint(result = {}) {
    if (result.coordinateScrollFallback !== "document") return undefined
    return {
      reason: "coordinate-scroll-document-fallback",
      nextAction: "observe-for-scrollable-container",
      decision: "prefer-fresh-scrollable-container-uid",
      recommendedTools: ["yunti_observe_page", "yunti_scroll"],
      ...(result.coordinateTarget ? { coordinateTarget: result.coordinateTarget } : {}),
      message: "The coordinate scroll did not find a nested scrollable container and fell back to document scrolling. Observe again and choose a fresh scrollableContainers[] uid when a panel or sidebar was intended.",
    }
  }

  function buildUidScrollFailureResult(session, uid, scrollResult = {}) {
    const error = scrollResult?.error || `Cannot scroll uid ${uid}`
    const code = scrollResult?.code || inferScrollFailureCode(error)
    const recoveryHint = {
      reason: "uid-scroll-failed",
      recommendedTools: ["yunti_observe_page", "yunti_take_snapshot", "yunti_scroll"],
      nextAction: "observe-again",
      decision: "refresh-scrollable-container-uid-before-retry",
      uid,
      message: "The uid scroll could not resolve a current target. Refresh observation, choose a fresh scrollable container uid from scrollableContainers[], or use document/coordinate scroll fallback before retrying.",
    }

    return {
      ...(scrollResult && typeof scrollResult === "object" ? scrollResult : {}),
      scrolled: false,
      uid,
      browserSessionId: session.browserSessionId,
      action: "scroll",
      target: { uid, method: "uid" },
      ok: false,
      recoverable: true,
      code,
      error,
      recoveryHint,
      nextStepHint: "Uid scroll failed. Observe again for a fresh scrollable container uid, inspect scrollableContainers[], or retry with document/coordinate fallback before repeating the same uid scroll.",
    }
  }

  function inferScrollFailureCode(error) {
    const message = String(error || "").toLowerCase()
    if (message.includes("not found") || message.includes("uid") && message.includes("latest page uid map")) {
      return "UID_NOT_FOUND"
    }
    if (message.includes("cannot resolve coordinates") || message.includes("off-screen") || message.includes("hidden") || message.includes("stale")) {
      return "UID_COORDINATES_UNAVAILABLE"
    }
    return "UID_SCROLL_FAILED"
  }

  function inferScrollEdgeHint(deltaX, deltaY) {
    const x = Number(deltaX)
    const y = Number(deltaY)
    if (Number.isFinite(y) && y > 0) return "possible-bottom-edge"
    if (Number.isFinite(y) && y < 0) return "possible-top-edge"
    if (Number.isFinite(x) && x > 0) return "possible-right-edge"
    if (Number.isFinite(x) && x < 0) return "possible-left-edge"
    return "no-delta"
  }

  function buildScrollPartialMovementHint(result = {}, args = {}) {
    const beforeLeft = Number(result.before?.left)
    const beforeTop = Number(result.before?.top)
    const afterLeft = Number(result.after?.left)
    const afterTop = Number(result.after?.top)
    if (
      !Number.isFinite(beforeLeft) ||
      !Number.isFinite(beforeTop) ||
      !Number.isFinite(afterLeft) ||
      !Number.isFinite(afterTop)
    ) return undefined

    const requestedDeltaX = Number(result.deltaX ?? args.deltaX ?? 0)
    const requestedDeltaY = Number(result.deltaY ?? args.deltaY ?? 0)
    const actualDeltaX = afterLeft - beforeLeft
    const actualDeltaY = afterTop - beforeTop
    const axes = []
    if (isPartialScrollMovement(requestedDeltaX, actualDeltaX)) axes.push("horizontal")
    if (isPartialScrollMovement(requestedDeltaY, actualDeltaY)) axes.push("vertical")
    if (!axes.length) return undefined

    return {
      reason: "partial-scroll-movement",
      axes,
      requestedDeltaX,
      requestedDeltaY,
      actualDeltaX,
      actualDeltaY,
      edgeHint: inferScrollEdgeHint(requestedDeltaX, requestedDeltaY),
      nextAction: "observe-again",
      decision: "observe-before-continuing-scroll",
      message: "The scroll position changed, but less than the requested delta. Observe again before repeating the same scroll to verify whether the target container hit an edge or a different container should be used.",
    }
  }

  function isPartialScrollMovement(requestedDelta, actualDelta) {
    if (!Number.isFinite(requestedDelta) || !Number.isFinite(actualDelta)) return false
    if (requestedDelta === 0 || actualDelta === 0) return false
    if (Math.sign(requestedDelta) !== Math.sign(actualDelta)) return false
    return Math.abs(actualDelta) < Math.abs(requestedDelta)
  }

  function buildScrollRecoveryHint(session, uid, edgeHint, result = {}) {
    const hint = {
      reason: "no-scroll-movement",
      recommendedTools: ["yunti_observe_page", "yunti_scroll"],
      nextAction: "observe-again",
    }
    if (edgeHint) hint.edgeHint = edgeHint
    if (uid) {
      hint.uid = uid
      hint.currentTarget = "scrollable-container"
      const target = pageUidStore.get(session.browserSessionId)?.uidMap?.[uid]
      if (target) {
        hint.lastObservedContainer = {
          uid,
          canScrollVertical: Boolean(target.canScrollVertical),
          canScrollHorizontal: Boolean(target.canScrollHorizontal),
          ...(Number.isFinite(Number(target.pixelsAbove)) ? { pixelsAbove: Number(target.pixelsAbove) } : {}),
          ...(Number.isFinite(Number(target.pixelsBelow)) ? { pixelsBelow: Number(target.pixelsBelow) } : {}),
          ...(Number.isFinite(Number(target.pixelsLeft)) ? { pixelsLeft: Number(target.pixelsLeft) } : {}),
          ...(Number.isFinite(Number(target.pixelsRight)) ? { pixelsRight: Number(target.pixelsRight) } : {}),
        }
      }
    } else {
      hint.currentTarget = "document-or-coordinate-container"
    }
    if (edgeHint === "possible-bottom-edge" || edgeHint === "possible-top-edge") {
      hint.nextAction = uid ? "try-opposite-direction-or-nearest-container" : "observe-for-scrollable-container"
    } else if (edgeHint === "possible-right-edge" || edgeHint === "possible-left-edge") {
      hint.nextAction = uid ? "try-opposite-horizontal-direction-or-nearest-container" : "observe-for-horizontal-container"
    } else if (edgeHint === "no-delta") {
      hint.nextAction = "provide-nonzero-scroll-delta"
    }
    const decision = buildScrollRecoveryDecision(uid, edgeHint)
    if (decision) hint.decision = decision
    const suggestedRetry = buildScrollSuggestedRetry(uid, edgeHint, result)
    if (suggestedRetry) hint.suggestedRetry = suggestedRetry
    hint.message = "The scroll command dispatched, but the scroll position did not change. Refresh observation before retrying, inspect scroll boundaries, or target a different scrollable container uid."
    return hint
  }

  function buildScrollRecoveryDecision(uid, edgeHint) {
    if (edgeHint === "no-delta") return "provide-nonzero-delta"
    if (edgeHint === "possible-bottom-edge" || edgeHint === "possible-top-edge") {
      return uid ? "retry-opposite-vertical-on-same-container-once" : "observe-for-scrollable-container"
    }
    if (edgeHint === "possible-right-edge" || edgeHint === "possible-left-edge") {
      return uid ? "retry-opposite-horizontal-on-same-container-once" : "observe-for-horizontal-scrollable-container"
    }
    return undefined
  }

  function buildScrollSuggestedRetry(uid, edgeHint, result = {}) {
    const retry = {}
    const deltaX = Number(result.deltaX)
    const deltaY = Number(result.deltaY)
    if (edgeHint === "possible-bottom-edge" || edgeHint === "possible-top-edge") {
      if (!Number.isFinite(deltaY) || deltaY === 0) return undefined
      retry.deltaY = -deltaY
    } else if (edgeHint === "possible-right-edge" || edgeHint === "possible-left-edge") {
      if (!Number.isFinite(deltaX) || deltaX === 0) return undefined
      retry.deltaX = -deltaX
    } else {
      return undefined
    }
    if (uid) retry.uid = uid
    retry.note = uid
      ? "Try the opposite direction once on the same observed container, then observe again or switch to a nearer scrollable container if it still does not move."
      : "Observe first for a scrollable container uid; only use this opposite delta if document scrolling is still the intended target."
    return retry
  }

  async function selectElement(tabId, session, args = {}) {
    const uid = String(args.uid || "").trim()
    const value = String(args.value ?? "")
    const text = String(args.text ?? "")
    if (uid) {
      const matchMode = text ? "text" : "value"
      const targetOption = text || value
      let point
      try {
        point = await resolveUidCenter(tabId, session, uid)
      } catch (error) {
        return buildUidSelectFailureResult(session, uid, matchMode, targetOption, {
          code: "UID_COORDINATES_UNAVAILABLE",
          error: error?.message || String(error),
        })
      }
      const selectResult = await chrome.tabs.sendMessage(tabId, {
        type: "yunti_execute_tool",
        tool: "yunti_select",
        arguments: { ...args, x: point.x, y: point.y },
      })
      if (!selectResult?.selected) {
        return buildUidSelectFailureResult(session, uid, matchMode, targetOption, selectResult)
      }
      return {
        ...selectResult,
        selected: true,
        uid,
        value: selectResult.value,
        text: selectResult.text,
        selectedIndex: selectResult.selectedIndex,
        browserSessionId: session.browserSessionId,
        action: "select",
        target: { uid, method: matchMode === "text" ? "uid.text" : "uid.value" },
        ok: true,
        recoverable: false,
        nextStepHint: matchMode === "text"
          ? "Uid select dispatched by visible option text without attaching Chrome debugger. Observe again, read page state, or evaluate the select value to verify the intended change."
          : "Uid select dispatched by option value without attaching Chrome debugger. Observe again, read page state, or evaluate the select value to verify the intended change.",
      }
    }

    const selector = String(args.selector || "").trim()
    let result
    try {
      result = await chrome.tabs.sendMessage(tabId, {
        type: "yunti_execute_tool",
        tool: "yunti_select",
        arguments: args,
      })
    } catch (error) {
      return buildSelectorSelectFailureResult(session, selector, args.value, {
        code: "SELECTOR_SELECT_FAILED",
        error: error?.message || "Selector select failed",
      })
    }

    if (!result || typeof result !== "object" || result.selected !== true) {
      return buildSelectorSelectFailureResult(session, selector, args.value, result)
    }

    const requestedValue = String(args.value ?? "")
    const disabledOption = Array.isArray(result.options)
      ? result.options.find((option) => String(option?.value ?? "") === requestedValue && option.disabled === true)
      : undefined
    if (requestedValue && disabledOption) {
      return buildSelectorSelectFailureResult(session, selector, requestedValue, {
        ...result,
        selected: false,
        code: "OPTION_DISABLED",
        error: "Option value is disabled",
        disabledValue: String(disabledOption.value ?? ""),
        disabledText: String(disabledOption.text ?? ""),
      })
    }
    if (requestedValue && String(result.value ?? "") !== requestedValue) {
      return buildSelectorSelectFailureResult(session, selector, requestedValue, {
        ...result,
        code: "OPTION_NOT_FOUND",
        error: "Option value not found",
        actualValue: result.value,
      })
    }

    return {
      ...result,
      selector,
      browserSessionId: session.browserSessionId,
      action: "select",
      target: { selector, method: "selector" },
      ok: true,
      recoverable: false,
      nextStepHint: "Select dispatched. Observe again, read page state, or evaluate the select value to verify the intended change.",
    }
  }

  function buildSelectorSelectFailureResult(session, selector, targetOption, selectResult = {}) {
    const availableValues = Array.isArray(selectResult?.availableValues) ? selectResult.availableValues : undefined
    const availableTexts = Array.isArray(selectResult?.availableTexts) ? selectResult.availableTexts : undefined
    const disabledValue = selectResult?.disabledValue !== undefined ? String(selectResult.disabledValue) : undefined
    const disabledText = selectResult?.disabledText !== undefined ? String(selectResult.disabledText) : undefined
    const code = selectResult?.code || (selectResult?.selected === false ? "SELECTOR_SELECT_FAILED" : "SELECTOR_SELECT_FAILED")
    const error = selectResult?.error || "Selector select failed"
    const recoveryHint = {
      reason: "selector-select-failed",
      recommendedTools: ["yunti_observe_page", "yunti_take_snapshot", "yunti_evaluate_script", "yunti_wait_for", "yunti_select"],
      nextAction: code === "OPTION_NOT_FOUND" || code === "OPTION_DISABLED" ? "inspect-available-options" : "inspect-target-element",
      decision: code === "OPTION_DISABLED" ? "choose-enabled-option-or-unlock-field" : code === "OPTION_NOT_FOUND" ? "inspect-options-before-retry" : "use-select-element-or-uid-fallback",
      selector,
      matchMode: "value",
      targetOption: String(targetOption ?? ""),
      ...(availableValues ? { availableValues } : {}),
      ...(availableTexts ? { availableTexts } : {}),
      ...(disabledValue ? { disabledValue } : {}),
      ...(disabledText ? { disabledText } : {}),
      message: "The selector select could not be completed. Inspect the target select element and available options before retrying, or use a fresh uid/value fallback.",
    }

    if (["TARGET_HIDDEN", "TARGET_DISABLED", "TARGET_OBSCURED"].includes(code)) {
      recoveryHint.nextAction = "wait-for-actionability"
      recoveryHint.decision = "wait-before-selector-select-retry"
      recoveryHint.message = "The selector select target exists but is not ready yet. Wait for it to appear, enable, or stop being covered before retrying."
    }

    return {
      ...(selectResult && typeof selectResult === "object" ? selectResult : {}),
      selected: false,
      selector,
      browserSessionId: session.browserSessionId,
      action: "select",
      target: { selector, method: "selector" },
      ok: false,
      recoverable: true,
      code,
      error,
      matchMode: "value",
      targetOption: String(targetOption ?? ""),
      ...(availableValues ? { availableValues } : {}),
      ...(availableTexts ? { availableTexts } : {}),
      recoveryHint,
      nextStepHint: "Selector select failed. Inspect available options, observe again for a fresh uid, or retry with uid/value fallback before repeating the same selector select.",
    }
  }

  function buildUidSelectFailureResult(session, uid, matchMode, targetOption, selectResult = {}) {
    const availableValues = Array.isArray(selectResult.availableValues) ? selectResult.availableValues : undefined
    const availableTexts = Array.isArray(selectResult.availableTexts) ? selectResult.availableTexts : undefined
    const disabledValue = selectResult?.disabledValue !== undefined ? String(selectResult.disabledValue) : undefined
    const disabledText = selectResult?.disabledText !== undefined ? String(selectResult.disabledText) : undefined
    const recoveryHint = {
      reason: "uid-select-failed",
      recommendedTools: ["yunti_observe_page", "yunti_take_snapshot", "yunti_evaluate_script", "yunti_select"],
      nextAction: "inspect-available-options",
      decision: selectResult.code === "OPTION_DISABLED" ? "choose-enabled-option-or-unlock-field" : "inspect-options-before-retry",
      uid,
      matchMode,
      targetOption,
      ...(availableValues ? { availableValues } : {}),
      ...(availableTexts ? { availableTexts } : {}),
      ...(disabledValue ? { disabledValue } : {}),
      ...(disabledText ? { disabledText } : {}),
      message: "The select option could not be matched. Inspect available options before retrying, refresh observation if the uid may be stale, or use selector/value fallback.",
    }

    if (selectResult.code === "ELEMENT_NOT_FOUND") {
      recoveryHint.nextAction = "observe-again"
      recoveryHint.decision = "refresh-observation-before-retry"
    } else if (selectResult.code === "NOT_SELECT") {
      recoveryHint.nextAction = "inspect-target-element"
      recoveryHint.decision = "use-select-element-or-selector-fallback"
    }

    return {
      selected: false,
      uid,
      browserSessionId: session.browserSessionId,
      action: "select",
      target: { uid, method: matchMode === "text" ? "uid.text" : "uid.value" },
      ok: false,
      recoverable: true,
      code: selectResult.code || "UID_SELECT_FAILED",
      error: selectResult.error || `Cannot select option at uid ${uid}`,
      matchMode,
      targetOption,
      ...(availableValues ? { availableValues } : {}),
      ...(availableTexts ? { availableTexts } : {}),
      ...(disabledValue ? { disabledValue } : {}),
      ...(disabledText ? { disabledText } : {}),
      recoveryHint,
      nextStepHint: "Uid select failed. Inspect available options, observe again for a fresh uid, or retry with selector/value fallback before repeating the same select.",
    }
  }

  function buildSelectorActionFailureResult(session, action, selector, contentResult = {}, recovery = {}) {
    const resultFieldByAction = {
      click: "clicked",
      hover: "hovered",
      fill: "filled",
      select: "selected",
      type_text: "typed",
      press_key: "pressed",
    }
    const resultField = resultFieldByAction[action] || action
    const code = String(contentResult?.code || `SELECTOR_${String(action).toUpperCase()}_FAILED`)
    const error = String(contentResult?.error || `Selector ${action} failed`)
    return {
      ...(contentResult && typeof contentResult === "object" ? contentResult : {}),
      [resultField]: false,
      selector,
      browserSessionId: session.browserSessionId,
      action,
      target: { selector, method: "selector" },
      ok: false,
      recoverable: true,
      code,
      error,
      recoveryHint: {
        reason: `selector-${action}-failed`,
        recommendedTools: recovery.recommendedTools || ["yunti_observe_page", "yunti_wait_for"],
        nextAction: recovery.nextAction || "observe-before-retry",
        decision: recovery.decision || "refresh-readiness-before-retry",
        selector,
        message: recovery.message || `The selector ${action} could not be completed.`,
      },
      nextStepHint: action === "hover"
        ? "Selector hover failed. Wait for the target to become visible and unobstructed, or observe again before retrying."
        : `Selector ${action} failed. Wait for the target to become ready, or observe again before retrying.`,
    }
  }

  function validateFillArgs(args = {}) {
    if (!Object.prototype.hasOwnProperty.call(args, "value") || args.value === undefined || args.value === null) {
      throw new Error("yunti_fill requires value. Pass { value: \"...\", uid: \"yunti-...\" } after yunti_take_snapshot, or pass value with a CSS selector.")
    }
    const uid = String(args.uid || "").trim()
    const selector = String(args.selector || "").trim()
    const hasX = Number.isFinite(Number(args.x))
    const hasY = Number.isFinite(Number(args.y))
    if (hasX || hasY) {
      throw new Error("yunti_fill does not support coordinate-only targeting. Call yunti_take_snapshot and pass uid, or pass selector with value.")
    }
    if (!uid && !selector) {
      throw new Error("yunti_fill requires uid or selector with value. Call yunti_take_snapshot to get uid, or pass a CSS selector.")
    }
  }
  
  async function clickViaSnapshotUid(tabId, session, uid) {
    const { x, y } = await resolveUidCenter(tabId, session, uid)
    await mouseClick(tabId, x, y, 1)
    const roundedX = Math.round(x)
    const roundedY = Math.round(y)
    return {
      clicked: true,
      uid,
      x: roundedX,
      y: roundedY,
      browserSessionId: session.browserSessionId,
      action: "click",
      target: { uid, x: roundedX, y: roundedY },
      ok: true,
      recoverable: false,
      nextStepHint: "Click dispatched. Observe again or read page state to verify the intended change.",
    }
  }
  
  async function hoverViaSnapshotUid(tabId, session, uid) {
    const { x, y } = await resolveUidCenter(tabId, session, uid)
    await mouseMove(tabId, x, y)
    const roundedX = Math.round(x)
    const roundedY = Math.round(y)
    return {
      hovered: true,
      uid,
      x: roundedX,
      y: roundedY,
      browserSessionId: session.browserSessionId,
      action: "hover",
      target: { uid, x: roundedX, y: roundedY },
      ok: true,
      recoverable: false,
      nextStepHint: "Hover dispatched. Observe again or read page state to verify menus, tooltips, or hover-only controls.",
    }
  }
  
  async function clickAtCoordinate(tabId, session, x, y) {
    await mouseClick(tabId, x, y, 1)
    const roundedX = Math.round(x)
    const roundedY = Math.round(y)
    return {
      clicked: true,
      x: roundedX,
      y: roundedY,
      browserSessionId: session.browserSessionId,
      method: "coordinate",
      action: "click",
      target: { method: "coordinate", x: roundedX, y: roundedY },
      ok: true,
      recoverable: false,
      nextStepHint: "Coordinate click dispatched. Observe again, read page state, or use a fresh uid when possible to verify the intended change.",
    }
  }
  
  async function resolveSelectorCenter(tabId, selector) {
    await ensureCdpAttached(tabId, "1.3")
    const escapedSelector = JSON.stringify(selector)
    const result = await chromeDebuggerSendCommand(
      { tabId },
      "Runtime.evaluate",
      {
        expression: `(() => {
          const element = document.querySelector(${escapedSelector});
          if (!element) return { ok: false, error: "Element not found: " + ${escapedSelector} };
          const rect = element.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) {
            return { ok: false, error: "Element is hidden or has no size: " + ${escapedSelector} };
          }
          element.scrollIntoView({ block: "center", inline: "center" });
          const next = element.getBoundingClientRect();
          return {
            ok: true,
            x: next.left + next.width / 2,
            y: next.top + next.height / 2,
          };
        })()`,
        returnByValue: true,
      }
    )
    const value = result?.result?.value
    if (!value?.ok) {
      throw new Error(value?.error || `Element not found: ${selector}`)
    }
    return { x: Number(value.x), y: Number(value.y) }
  }
  
  async function resolveUidCenter(tabId, session, uid) {
    const point = resolveObservedUidCenter(session, uid)
    if (!point.ok) throw new Error(point.error)
    if (point.x !== undefined && point.y !== undefined) return { x: point.x, y: point.y }

    const node = point.element
    if (!node?.backendNodeId && !node?.nodeId) {
      throw new Error(
        `Cannot resolve coordinates for uid ${uid}. Run yunti_observe_page with includeRects enabled or use an explicit selector fallback.`
      )
    }
    await ensureCdpAttached(tabId, "1.3")
    const nodeRef = node.backendNodeId
      ? { backendNodeId: node.backendNodeId }
      : { nodeId: node.nodeId }
    await chromeDebuggerSendCommand({ tabId }, "DOM.scrollIntoViewIfNeeded", nodeRef).catch(() => {})
    const box = await chromeDebuggerSendCommand({ tabId }, "DOM.getBoxModel", nodeRef)
    const quad = box?.model?.border || box?.model?.content || box?.model?.padding
    if (!Array.isArray(quad) || quad.length < 8) {
      throw new Error(`CDP did not return a usable box model for uid ${uid}`)
    }
    const xs = quad.filter((_value, index) => index % 2 === 0).map(Number)
    const ys = quad.filter((_value, index) => index % 2 === 1).map(Number)
    if (!xs.every(Number.isFinite) || !ys.every(Number.isFinite)) {
      throw new Error(`CDP returned invalid coordinates for uid ${uid}`)
    }
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    }
  }

  function resolveObservedUidCenter(session, uid) {
    const uidState = pageUidStore.get(session.browserSessionId)
    const uidMap = uidState?.uidMap
    if (!uidMap || !uidMap[uid]) {
      return {
        ok: false,
        error: `uid ${uid} not found in the latest page uid map. Run yunti_observe_page again before retrying.`,
      }
    }
    const el = uidMap[uid]
    if (el.backendNodeId || el.nodeId) return { ok: true, element: el }
    if (el.rect && el.rect.width > 0 && el.rect.height > 0) {
      return {
        ok: true,
        x: el.rect.x + el.rect.width / 2,
        y: el.rect.y + el.rect.height / 2,
      }
    }
    return {
      ok: false,
      error: `Cannot resolve coordinates for uid ${uid}. Run yunti_observe_page with includeRects enabled, scroll the element into view, or use an explicit selector fallback.`,
    }
  }

  function buildUidPointFailureResult(session, uid, action, error) {
    const code = /not found|latest page uid map/i.test(String(error || "")) ? "UID_NOT_FOUND" : "UID_COORDINATES_UNAVAILABLE"
    const resultFieldByAction = {
      click: "clicked",
      hover: "hovered",
      type: "typed",
      press: "pressed",
    }
    const resultField = resultFieldByAction[action] || `${action}ed`
    const recommendedToolByAction = {
      click: "yunti_click",
      hover: "yunti_hover",
      type: "yunti_type_text",
      press: "yunti_press_key",
    }
    const recommendedTool = recommendedToolByAction[action] || "yunti_observe_page"
    return {
      [resultField]: false,
      uid,
      browserSessionId: session.browserSessionId,
      action,
      target: { uid, method: "uid" },
      ok: false,
      recoverable: true,
      code,
      error: error || `Cannot ${action} uid ${uid}`,
      recoveryHint: {
        reason: `uid-${action}-failed`,
        recommendedTools: ["yunti_observe_page", recommendedTool],
        nextAction: "observe-again",
        decision: "refresh-observation-before-retry",
        uid,
        message: "The uid could not be resolved without attaching Chrome debugger. Observe again with rects enabled, scroll the target into view, or retry with selector fallback.",
      },
      nextStepHint: `Uid ${action} failed without attaching Chrome debugger. Observe again for a fresh visible uid before retrying.`,
    }
  }
  
  async function mouseClick(tabId, x, y, clickCount = 1) {
    await ensureCdpAttached(tabId, "1.3")
    const button = "left"
    await chromeDebuggerSendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mousePressed", x, y, button, clickCount,
    })
    await chromeDebuggerSendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseReleased", x, y, button, clickCount,
    })
  }
  
  async function mouseMove(tabId, x, y) {
    await ensureCdpAttached(tabId, "1.3")
    await chromeDebuggerSendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseMoved", x, y,
    })
  }
  
  async function fillForm(tabId, session, args = {}) {
    const fields = Array.isArray(args.fields) ? args.fields : []
    if (!fields.length) throw new Error("fields array is required")
  
    let filled = 0
    let failed = 0
    const results = []
  
    for (const field of fields) {
      try {
        const uid = String(field.uid || "").trim()
        let fieldResult
        if (uid) {
          fieldResult = await fillByUid(tabId, session, { uid, value: String(field.value || "") })
        } else {
          fieldResult = await fillByUid(tabId, session, { selector: field.selector, value: field.value })
        }
        const normalized = buildFillFormFieldResult(field, fieldResult)
        if (normalized.ok) filled++
        else failed++
        results.push(normalized)
      } catch (err) {
        failed++
        results.push({ uid: field.uid, selector: field.selector, ok: false, error: err?.message || String(err) })
      }
    }
  
    return {
      filled,
      failed,
      results,
      browserSessionId: session.browserSessionId,
      action: "fill_form",
      target: {
        fieldCount: fields.length,
        filled,
        failed,
      },
      ok: failed === 0,
      recoverable: failed > 0,
      nextStepHint: failed === 0
        ? "Form fill dispatched. Observe again, read page state, or evaluate field values to verify the intended changes."
        : "Form fill partially failed. Inspect per-field results, observe again for fresh uids, or retry failed fields with selector fallback.",
    }
  }

  function buildFillFormFieldResult(field, fieldResult = {}) {
    const ok = Boolean(fieldResult?.filled || fieldResult?.ok === true)
    if (ok) return { uid: field.uid, selector: field.selector, ok: true }

    const diagnostics = fieldResult && typeof fieldResult === "object" ? fieldResult : {}
    const preservedKeys = [
      "code",
      "error",
      "recoveryHint",
      "availableValues",
      "availableTexts",
      "nextStepHint",
    ]
    const result = { uid: field.uid, selector: field.selector, ok: false }
    for (const key of preservedKeys) {
      if (diagnostics[key] !== undefined) result[key] = diagnostics[key]
    }
    if (!result.error) result.error = "fill failed"
    return result
  }
  
  async function waitForCondition(tabId, session, args = {}) {
    const timeoutMs = Number.isFinite(Number(args.timeoutMs))
      ? Math.max(100, Math.min(30000, Number(args.timeoutMs)))
      : 5000
    const text = String(args.text || "").trim()
    const selector = String(args.selector || "").trim()
    const urlContains = String(args.urlContains || "").trim()
  
    if (!text && !selector && !urlContains) {
      throw new Error("At least one of text, selector, or urlContains is required")
    }
  
    await ensureCdpAttached(tabId, "1.3")
    const startTime = Date.now()
  
    while (Date.now() - startTime < timeoutMs) {
      if (urlContains) {
        const tab = await chrome.tabs.get(tabId)
        if (tab.url && tab.url.includes(urlContains)) {
          return buildWaitForSuccess(
            session,
            { text, selector, urlContains, timeoutMs },
            { found: true, condition: "urlContains", value: urlContains },
            Date.now() - startTime
          )
        }
      }
  
      if (text || selector) {
        const expression = `(() => {
          const roots = [document];
          const seen = new Set();
          for (let index = 0; index < roots.length; index += 1) {
            const root = roots[index];
            if (!root || seen.has(root)) continue;
            seen.add(root);
            ${selector ? `const el = root.querySelector?.(${JSON.stringify(selector)}); if (el) { const rect = el.getBoundingClientRect(); if (rect.width > 0 && rect.height > 0) return { found: 'selector', selector: ${JSON.stringify(selector)} }; }` : ""}
            ${text ? `const textSurface = root.body || root; const rootText = textSurface.innerText || root.textContent || ''; if (rootText.includes(${JSON.stringify(text)})) return { found: 'text', text: ${JSON.stringify(text)} };` : ""}
            for (const node of root.querySelectorAll?.('*') || []) {
              if (node.shadowRoot) roots.push(node.shadowRoot);
              if (node.tagName === 'IFRAME') {
                try {
                  if (node.contentDocument) roots.push(node.contentDocument);
                } catch {}
              }
            }
          }
          return null;
        })()`
  
        const result = await chromeDebuggerSendCommand(
          { tabId },
          "Runtime.evaluate",
          { expression, returnByValue: true }
        )

        if (result?.result?.value) {
          return buildWaitForSuccess(
            session,
            { text, selector, urlContains, timeoutMs },
            result.result.value,
            Date.now() - startTime
          )
        }
      }
  
      await delayCdp(200)
    }
  
    return buildWaitForTimeout(session, { text, selector, urlContains, timeoutMs }, timeoutMs)
  }

  function buildWaitForTarget({ text, selector, urlContains, timeoutMs } = {}) {
    const target = {}
    if (text) target.text = text
    if (selector) target.selector = selector
    if (urlContains) target.urlContains = urlContains
    if (timeoutMs !== undefined) target.timeoutMs = timeoutMs
    return target
  }

  function buildWaitForSuccess(session, args, match = {}, waitedMs = 0) {
    const condition = typeof match.condition === "string"
      ? match.condition
      : match.found === "selector" || match.found === "text"
        ? match.found
        : undefined
    const result = {
      found: true,
      ...match,
      waitedMs,
      browserSessionId: session.browserSessionId,
      action: "wait_for",
      target: buildWaitForTarget(args),
      ok: true,
      recoverable: false,
      nextStepHint: "Wait condition matched. Call yunti_observe_page and continue with a fresh uid before acting on newly rendered content.",
    }
    if (condition && result.condition === undefined) result.condition = condition
    return result
  }

  function buildWaitForTimeout(session, args, waitedMs) {
    return {
      found: false,
      waitedMs,
      browserSessionId: session.browserSessionId,
      action: "wait_for",
      target: buildWaitForTarget(args),
      ok: false,
      recoverable: true,
      code: "WAIT_TIMEOUT",
      recoveryHint: {
        reason: "condition-not-met-before-timeout",
        recommendedTools: ["yunti_observe_page", "yunti_get_page_snapshot", "yunti_take_screenshot"],
        nextAction: "observe-or-adjust-condition",
        decision: "observe-before-retry",
        message: "The expected text, selector, or URL state did not appear before the timeout. Observe the page or adjust the wait condition before repeating the same wait.",
      },
      nextStepHint: "Wait timed out. Observe the current page, inspect whether the condition changed, or adjust the wait target before retrying.",
    }
  }
  
  async function handleDialog(tabId, session, args = {}) {
    const action = String(args.action || "accept").trim()
    if (action !== "accept" && action !== "dismiss") throw new Error("action must be 'accept' or 'dismiss'")
    const promptText = action === "accept" ? String(args.promptText || "") : undefined
  
    await ensureCdpAttached(tabId, "1.3")
    await chromeDebuggerSendCommand(
      { tabId },
      "Page.handleJavaScriptDialog",
      { accept: action === "accept", promptText }
    )
    return { handled: true, action, browserSessionId: session.browserSessionId }
  }
  
  async function resizePage(tabId, session, args = {}) {
    const width = Number.isFinite(Number(args.width)) ? Math.round(Number(args.width)) : null
    const height = Number.isFinite(Number(args.height)) ? Math.round(Number(args.height)) : null
    const deviceScaleFactor = Number.isFinite(Number(args.deviceScaleFactor)) && Number(args.deviceScaleFactor) > 0
      ? Number(args.deviceScaleFactor) : 1
  
    if (!width && !height) throw new Error("width and/or height is required")
  
    await ensureCdpAttached(tabId, "1.3")
    const params = { deviceScaleFactor, mobile: false }
    if (width) params.width = width
    if (height) params.height = height
    await chromeDebuggerSendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", params)
    return { resized: true, width, height, deviceScaleFactor, browserSessionId: session.browserSessionId }
  }
  
  async function emulateDevice(tabId, session, args = {}) {
    await ensureCdpAttached(tabId, "1.3")
  
    if (args.clear) {
      await chromeDebuggerSendCommand({ tabId }, "Emulation.clearDeviceMetricsOverride", {})
      // Use userAgent: "" to clear UA override — Chrome requires explicit param
      await chromeDebuggerSendCommand({ tabId }, "Emulation.setUserAgentOverride", { userAgent: "" })
      // Use -1 for unlimited throughput (0 = zero bandwidth)
      await chromeDebuggerSendCommand({ tabId }, "Network.emulateNetworkConditions", {
        offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: "none",
      })
      // Also clear CPU throttling
      await chromeDebuggerSendCommand({ tabId }, "Emulation.setCPUThrottlingRate", { rate: 1 })
      return { emulated: false, cleared: true, browserSessionId: session.browserSessionId }
    }
  
    const deviceOverrides = resolveDeviceOverrides(args.deviceName)
  
    // Viewport
    if (args.viewport || deviceOverrides) {
      const vp = args.viewport || deviceOverrides || {}
      const w = Number.isFinite(Number(vp.width)) ? Math.round(Number(vp.width)) : 375
      const h = Number.isFinite(Number(vp.height)) ? Math.round(Number(vp.height)) : 812
      const dsf = Number.isFinite(Number(vp.deviceScaleFactor)) && Number(vp.deviceScaleFactor) > 0
        ? Number(vp.deviceScaleFactor) : 2
      await chromeDebuggerSendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
        width: w, height: h, deviceScaleFactor: dsf, mobile: true,
      })
    }
  
    // User agent
    if (args.userAgent || deviceOverrides?.userAgent) {
      await chromeDebuggerSendCommand({ tabId }, "Emulation.setUserAgentOverride", {
        userAgent: args.userAgent || deviceOverrides.userAgent,
      })
    }
  
    // CPU throttle
    if (Number.isFinite(Number(args.cpuThrottleRate)) && Number(args.cpuThrottleRate) > 1) {
      await chromeDebuggerSendCommand({ tabId }, "Emulation.setCPUThrottlingRate", {
        rate: Number(args.cpuThrottleRate),
      })
    }
  
    // Network conditions
    if (args.networkConditions && args.networkConditions !== "none") {
      const conditions = NETWORK_CONDITIONS[args.networkConditions] || NETWORK_CONDITIONS.slow3g
      await chromeDebuggerSendCommand({ tabId }, "Network.emulateNetworkConditions", {
        offline: false, ...conditions,
      })
    }
  
    return { emulated: true, deviceName: args.deviceName || null, browserSessionId: session.browserSessionId }
  }
  
  const DEVICE_PRESETS = {
    "iPhone 12": { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15" },
    "iPhone SE": { width: 375, height: 667, deviceScaleFactor: 2, mobile: true },
    "Pixel 5": { width: 393, height: 851, deviceScaleFactor: 2.75, mobile: true, userAgent: "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36" },
    "iPad": { width: 810, height: 1080, deviceScaleFactor: 2, mobile: true },
    "iPad Pro": { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: true },
  }
  
  const NETWORK_CONDITIONS = {
    offline: { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: "none" },
    slow3g: { offline: false, latency: 2000, downloadThroughput: 50000, uploadThroughput: 20000, connectionType: "cellular3g" },
    fast3g: { offline: false, latency: 563, downloadThroughput: 180000, uploadThroughput: 45000, connectionType: "cellular3g" },
    slow4g: { offline: false, latency: 100, downloadThroughput: 1750000, uploadThroughput: 500000, connectionType: "cellular4g" },
  }
  
  function resolveDeviceOverrides(deviceName) {
    if (!deviceName) return null
    const key = String(deviceName).trim()
    return DEVICE_PRESETS[key] || DEVICE_PRESETS[Object.keys(DEVICE_PRESETS).find(k => k.toLowerCase() === key.toLowerCase())] || null
  }
  
  async function newPage(parentSession = null, args = {}) {
    const url = String(args.url || "").trim()
    const active = args.active !== false
    const tab = await chrome.tabs.create({ url: url || undefined, active })
    const browserSessionId = stableChildPageSessionId(tab.id, parentSession)
    const session = {
      browserSessionId,
      kind: "page",
      userId: parentSession?.userId || "",
      displayName: parentSession?.displayName || "",
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url || url,
      title: tab.title || "",
      active,
      registeredAt: new Date().toISOString(),
    }
    sessionsByTab.set(tab.id, session)
    await postBridge("/sessions/register", session).catch(() => null)
    const registration = await waitForNewPageRegistration(tab.id, url)
    const readySession = registration?.session || sessionsByTab.get(tab.id) || null
    return {
      created: true,
      ready: Boolean(registration?.ok && readySession),
      browserSessionId: readySession?.browserSessionId || browserSessionId,
      tabId: tab.id,
      windowId: tab.windowId,
      url: readySession?.url || tab.url || url,
      title: readySession?.title || tab.title || "",
      ...(registration?.ok
        ? {}
        : {
            recoveryHint: registration?.error || registration?.reason || "page registration is still pending",
            nextStepHint: "The tab was created, but its page runtime is not ready yet. Verify this tab through yunti_list_browser_targets before acting; do not create another tab blindly.",
          }),
    }
  }

  async function waitForNewPageRegistration(tabId, requestedUrl) {
    if (!/^https?:\/\//iu.test(String(requestedUrl || ""))) {
      return { ok: true, session: sessionsByTab.get(tabId) || null, reason: "non_http_page" }
    }
    const deadline = Date.now() + 10_000
    let tab = null
    while (Date.now() < deadline) {
      tab = await chrome.tabs.get(tabId).catch(() => null)
      if (tab?.status === "complete") break
      await delayCdp(50)
    }
    if (!tab || tab.status !== "complete") {
      return { ok: false, reason: "tab_load_timeout", error: "The new tab did not finish loading within 10 seconds." }
    }
    return ensureTabRegistered(tabId, {
      tab,
      reason: "new_page_ready",
    })
  }

  function stableChildPageSessionId(tabId, parentSession) {
    const parentId = String(parentSession?.browserSessionId || "")
    const suffix =
      parentId.match(/^yunti-browser-(.+)$/)?.[1] ||
      parentId.match(/^yunti-page-\d+-(.+)$/)?.[1] ||
      (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))
    return `yunti-page-${tabId}-${suffix}`
  }
  
  async function closePage(tabId, session, args = {}) {
    if (args.tabId !== undefined || args.targetId !== undefined) {
      throw new Error("yunti_close_page only closes the registered page identified by browserSessionId. To close by tabId or targetId, call yunti_cdp_send_command with method Target.closeTarget and top-level tabId or targetId.")
    }
    const connectedTabs = [...sessionsByTab.keys()]
    if (connectedTabs.length <= 1) {
      throw new Error("Cannot close the last connected tab")
    }
    await detachCdpTab(tabId, session, "page_closed").catch(() => {})
    await chrome.tabs.remove(tabId)
    return { closed: true, browserSessionId: session.browserSessionId, tabId }
  }
  
  async function performDrag(tabId, session, args = {}) {
    const fromX = Number(args.fromX)
    const fromY = Number(args.fromY)
    const toX = Number(args.toX)
    const toY = Number(args.toY)
    if (!Number.isFinite(fromX) || !Number.isFinite(fromY) || !Number.isFinite(toX) || !Number.isFinite(toY)) {
      throw new Error("fromX, fromY, toX, toY are required and must be numbers")
    }
    const steps = Number.isFinite(Number(args.steps)) ? Math.max(1, Math.min(50, Math.round(Number(args.steps)))) : 10
  
    await ensureCdpAttached(tabId, "1.3")
    const button = "left"
  
    // Mouse press at start
    await chromeDebuggerSendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mousePressed", x: fromX, y: fromY, button, clickCount: 1,
    })
  
    // Move through intermediate points
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1)
      const x = fromX + (toX - fromX) * t
      const y = fromY + (toY - fromY) * t
      await chromeDebuggerSendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mouseMoved", x, y, button, buttons: 1,
      })
      await delayCdp(16) // ~60fps
    }
  
    // Mouse release at end
    await chromeDebuggerSendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseReleased", x: toX, y: toY, button, clickCount: 1,
    })
  
    const from = { x: Math.round(fromX), y: Math.round(fromY) }
    const to = { x: Math.round(toX), y: Math.round(toY) }
    return {
      dragged: true,
      from,
      to,
      steps,
      browserSessionId: session.browserSessionId,
      action: "drag",
      target: { method: "coordinate", from, to },
      ok: true,
      recoverable: false,
      nextStepHint: "Drag dispatched. Observe again or read page state to verify the intended movement or drop result.",
    }
  }
  
  async function uploadFile(tabId, session, args = {}) {
    const filePaths = Array.isArray(args.filePaths) ? args.filePaths.filter(p => typeof p === "string") : []
    if (!filePaths.length) throw new Error("filePaths array is required")
  
    const uid = String(args.uid || "").trim()
    const selector = String(args.selector || "").trim()
  
    await ensureCdpAttached(tabId, "1.3")
  
    let backendNodeId = null
    if (uid) {
      const { x, y } = await resolveUidCenter(tabId, session, uid)
      const nodeResult = await chromeDebuggerSendCommand({ tabId }, "DOM.getNodeForLocation", { x: Math.round(x), y: Math.round(y) })
      backendNodeId = nodeResult?.backendNodeId
    } else if (selector) {
      const docResult = await chromeDebuggerSendCommand({ tabId }, "DOM.getDocument", {})
      const rootNodeId = docResult?.root?.nodeId
      if (rootNodeId) {
        const queryResult = await chromeDebuggerSendCommand({ tabId }, "DOM.querySelector", { nodeId: rootNodeId, selector })
        if (queryResult?.nodeId) {
          const nodeResult = await chromeDebuggerSendCommand({ tabId }, "DOM.describeNode", { nodeId: queryResult.nodeId })
          backendNodeId = nodeResult?.node?.backendNodeId
        }
      }
    }
  
    if (!backendNodeId) throw new Error("Cannot resolve file input element. Provide a valid uid from yunti_take_snapshot or a CSS selector.")
  
    await chromeDebuggerSendCommand({ tabId }, "DOM.setFileInputFiles", {
      files: filePaths,
      backendNodeId,
    })
  
    return {
      uploaded: true,
      fileCount: filePaths.length,
      filePaths,
      browserSessionId: session.browserSessionId,
      action: "upload_file",
      target: uid ? { uid, method: "uid" } : { selector, method: "selector" },
      ok: true,
      recoverable: false,
      nextStepHint: "File upload dispatched. Observe again, read page state, or verify the selected file input before submitting any form.",
    }
  }
  
  async function typeTextByUid(tabId, session, args = {}) {
    const uid = String(args.uid || "").trim()
    if (!uid) {
      // Fall back to content script for selector/coordinate-based typing
      const selector = String(args.selector || "").trim()
      const hasX = Number.isFinite(Number(args.x))
      const hasY = Number.isFinite(Number(args.y))
      const result = await chrome.tabs.sendMessage(tabId, {
        type: "yunti_execute_tool",
        tool: "yunti_type_text",
        arguments: args,
      })

      if (!result || typeof result !== "object" || result.typed !== true) {
        return result
      }

      const target =
        selector
          ? { selector, method: "selector" }
          : hasX && hasY
            ? { method: "coordinate", x: Math.round(Number(args.x)), y: Math.round(Number(args.y)) }
            : { method: "focused" }

      return {
        ...result,
        browserSessionId: session.browserSessionId,
        action: "type_text",
        target,
        ok: true,
        recoverable: false,
        nextStepHint: "Type text dispatched. Observe again, read page state, or evaluate the active field value to verify the intended change.",
      }
    }
  
    const text = String(args.text || "")
    if (!text) throw new Error("text is required")
  
    let point
    try {
      point = await resolveUidCenter(tabId, session, uid)
    } catch (error) {
      return buildUidPointFailureResult(session, uid, "type", error?.message || String(error))
    }
    const result = await chrome.tabs.sendMessage(tabId, {
      type: "yunti_execute_tool",
      tool: "yunti_type_text",
      arguments: { ...args, x: point.x, y: point.y },
    })
    if (!result || typeof result !== "object" || result.typed !== true) return result
  
    return {
      ...result,
      typed: true,
      uid,
      text,
      method: result.method || "dom",
      browserSessionId: session.browserSessionId,
      action: "type_text",
      target: { uid, method: result.method || "dom" },
      ok: true,
      recoverable: false,
      nextStepHint: "Type text dispatched without attaching Chrome debugger. Observe again, read page state, or evaluate the field value to verify the intended change.",
    }
  }
  
  async function pressKeyByUid(tabId, session, args = {}) {
    const uid = String(args.uid || "").trim()
    if (!uid) {
      const selector = String(args.selector || "").trim()
      const hasX = Number.isFinite(Number(args.x))
      const hasY = Number.isFinite(Number(args.y))
      const result = await chrome.tabs.sendMessage(tabId, {
        type: "yunti_execute_tool",
        tool: "yunti_press_key",
        arguments: args,
      })

      if (!result || typeof result !== "object" || result.pressed !== true) {
        return result
      }

      const target =
        selector
          ? { selector, method: "selector" }
          : hasX && hasY
            ? { method: "coordinate", x: Math.round(Number(args.x)), y: Math.round(Number(args.y)) }
            : { method: "focused" }

      return {
        ...result,
        browserSessionId: session.browserSessionId,
        action: "press_key",
        target,
        ok: true,
        recoverable: false,
        nextStepHint: "Key press dispatched. Observe again, read page state, or evaluate the active field value to verify the intended effect.",
      }
    }
  
    const key = String(args.key || "").trim()
    if (!key) throw new Error("key is required")
  
    let point
    try {
      point = await resolveUidCenter(tabId, session, uid)
    } catch (error) {
      return buildUidPointFailureResult(session, uid, "press", error?.message || String(error))
    }
    const result = await chrome.tabs.sendMessage(tabId, {
      type: "yunti_execute_tool",
      tool: "yunti_press_key",
      arguments: { ...args, x: point.x, y: point.y },
    })
    if (!result || typeof result !== "object" || result.pressed !== true) return result
  
    return {
      ...result,
      pressed: true,
      uid,
      key,
      browserSessionId: session.browserSessionId,
      action: "press_key",
      target: { uid, method: "dom" },
      ok: true,
      recoverable: false,
      nextStepHint: "Key press dispatched without attaching Chrome debugger. Observe again, read page state, or evaluate the field value to verify the intended effect.",
    }
  }
  
  const KEY_MAP = {
    Enter: { key: "Enter", code: "Enter", keyCode: 13 },
    Escape: { key: "Escape", code: "Escape", keyCode: 27 },
    Tab: { key: "Tab", code: "Tab", keyCode: 9 },
    Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
    Delete: { key: "Delete", code: "Delete", keyCode: 46 },
    ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
    ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
    ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
    Home: { key: "Home", code: "Home", keyCode: 36 },
    End: { key: "End", code: "End", keyCode: 35 },
    PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
    PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
    Space: { key: " ", code: "Space", keyCode: 32 },
    F1: { key: "F1", code: "F1", keyCode: 112 },
    F2: { key: "F2", code: "F2", keyCode: 113 },
    F3: { key: "F3", code: "F3", keyCode: 114 },
    F4: { key: "F4", code: "F4", keyCode: 115 },
    F5: { key: "F5", code: "F5", keyCode: 116 },
    F6: { key: "F6", code: "F6", keyCode: 117 },
    F7: { key: "F7", code: "F7", keyCode: 118 },
    F8: { key: "F8", code: "F8", keyCode: 119 },
    F9: { key: "F9", code: "F9", keyCode: 120 },
    F10: { key: "F10", code: "F10", keyCode: 121 },
    F11: { key: "F11", code: "F11", keyCode: 122 },
    F12: { key: "F12", code: "F12", keyCode: 123 },
    Control: { key: "Control", code: "ControlLeft", keyCode: 17 },
    Shift: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
    Alt: { key: "Alt", code: "AltLeft", keyCode: 18 },
    Meta: { key: "Meta", code: "MetaLeft", keyCode: 91 },
  }
  
  function normalizeKey(key) {
    const upper = key.slice(0, 1).toUpperCase() + key.slice(1).toLowerCase()
    if (KEY_MAP[upper]) return KEY_MAP[upper]
    if (KEY_MAP[key]) return KEY_MAP[key]
    // Fallback for single characters
    if (key.length === 1) {
      const code = key.toUpperCase().charCodeAt(0)
      return { key, code: `Key${key.toUpperCase()}`, keyCode: code }
    }
    return { key, code: key, keyCode: 0 }
  }

  return { executeToolRequest }
}
