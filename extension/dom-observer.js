;(function installYuntiDomObserver(globalScope) {
  const DEFAULT_MAX_ELEMENTS = 200
  const DEFAULT_MAX_TEXT_LENGTH = 12000
  const MAX_ELEMENTS = 500
  const MAX_TEXT_LENGTH = 60000
  const WAIT_DEBOUNCE_MS = 120
  const WAIT_POLL_INTERVAL_MS = 250
  const INTERACTIVE_SELECTOR = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "[contenteditable='true']",
    "[contenteditable='']",
    "[role='button']",
    "[role='link']",
    "[role='textbox']",
    "[role='combobox']",
    "[role='checkbox']",
    "[role='radio']",
    "[role='switch']",
    "[role='menuitem']",
    "[role='tab']",
    "[onclick]",
  ].join(",")

  const SENSITIVE_KEY_RE =
    /password|passwd|pwd|token|secret|auth|cookie|session|api[-_]?key|credential|jwt|bearer|private[-_]?key|otp|验证码|密码|令牌/i
  const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/
  const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i
  const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  const LONG_RANDOM_RE = /\b[A-Za-z0-9_-]{32,}\b/
  const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/
  const PAYMENT_CARD_RE = /(?:^|[^\d])(?:\d[ -]?){13,19}(?:$|[^\d])/
  const ADDRESS_RE =
    /\b\d{1,6}\s+[\p{L}0-9 .'-]{2,}\s+(street|st|road|rd|avenue|ave|lane|ln|boulevard|blvd|drive|dr|way|court|ct)\b|[\p{Script=Han}]{1,20}(省|市|区|县|路|街|号楼|单元|室)/iu
  let lastObservationState = null
  let uidGeneration = 0
  const activeWaits = new Set()

  function observePage(args = {}) {
    const mode = args.mode === "fullPage" ? "fullPage" : "viewport"
    const responseMode = args.responseMode === "delta" ? "delta" : "full"
    const maxElements = clampInteger(args.maxElements, 1, MAX_ELEMENTS, DEFAULT_MAX_ELEMENTS)
    const maxTextLength = clampInteger(args.maxTextLength, 0, MAX_TEXT_LENGTH, DEFAULT_MAX_TEXT_LENGTH)
    const includeHidden = Boolean(args.includeHidden)
    const includeTextTree = args.includeTextTree !== false
    const includeRects = args.includeRects !== false
    const redaction = normalizeRedaction(args.redaction)
    const redactions = {
      mode: redaction,
      count: 0,
      categories: [],
      screenshotRedacted: false,
    }
    const uidScope = nextUidScope()
    const observationId = `obs-${uidScope}`

    const scope = mode === "fullPage" ? "fullPage" : "viewport"
    const candidates = collectInteractiveCandidates()
    const elements = []
    const textLines = []
    let uidCounter = 0

    for (const element of candidates) {
      if (elements.length >= maxElements) break
      if (isYuntiWidgetElement(element)) continue
      const visible = isVisible(element)
      if (!includeHidden && !visible) continue
      if (scope === "viewport" && visible && !isInViewport(element)) continue
      if (scope === "viewport" && !visible && !includeHidden) continue

      uidCounter += 1
      const uid = `yunti-${uidScope}-${uidCounter}`
      const item = describeElement(element, uid, {
        includeRects,
        redaction,
        redactions,
        visible,
      })
      elements.push(item)
      if (includeTextTree) textLines.push(formatTextTreeLine(item))
    }

    const textTree = includeTextTree ? truncateText(textLines.filter(Boolean).join("\n"), maxTextLength) : undefined
    const scrollableContainers = collectScrollableContainers({
      includeRects,
      maxElements: Math.min(50, maxElements),
      redaction,
      redactions,
      uidScope,
    })
    const hints = buildHints(elements, scrollableContainers)
    const warnings = []
    if (redaction === "off") warnings.push("DOM observation redaction is off; use only for explicit local debugging.")
    if (document.readyState === "loading") hints.push("Page is still loading; wait and observe again before acting.")
    const capturedAt = new Date().toISOString()
    const baseObservation = {
      observationId,
      browserSessionId: globalScope.__YUNTI_BROWSER_SESSION_ID__ || null,
      capturedAt,
      uidMapVersion: "observe-v1",
      responseMode,
      page: {
        url: redactUrl(location.href, redaction, redactions),
        title: redactTextPreview("page title", document.title || "", 300, { redaction, redactions }),
        origin: location.origin,
        readyState: document.readyState,
      },
      viewport: {
        width: Math.round(globalScope.innerWidth || 0),
        height: Math.round(globalScope.innerHeight || 0),
        devicePixelRatio: Number(globalScope.devicePixelRatio || 1),
      },
      scroll: getDocumentScroll(),
      elements,
      elementCount: elements.length,
      textTree,
      scrollableContainers,
      limits: {
        mode,
        maxElements,
        maxTextLength,
        includeHidden,
        truncatedElements: candidates.length > elements.length,
        truncatedText: Boolean(includeTextTree && textLines.join("\n").length > maxTextLength),
      },
      redactions: finalizeRedactions(redactions),
      hints,
      warnings,
    }

    if (responseMode !== "delta") {
      lastObservationState = captureObservationState(baseObservation)
      return baseObservation
    }

    const deltaObservation = buildDeltaObservation(baseObservation, lastObservationState)
    lastObservationState = captureObservationState(baseObservation)
    return deltaObservation
  }

  function findElements(args = {}) {
    const query = String(args.query || "").trim().toLowerCase()
    const roleFilter = String(args.role || "").trim().toLowerCase()
    const tagFilter = String(args.tag || "").trim().toLowerCase()
    const placeholderFilter = String(args.placeholder || "").trim().toLowerCase()
    const includeHidden = Boolean(args.includeHidden)
    const includeRects = args.includeRects !== false
    const redaction = normalizeRedaction(args.redaction)
    const maxResults = clampInteger(args.maxResults, 1, 50, 10)
    const redactions = {
      mode: redaction,
      count: 0,
      categories: [],
      screenshotRedacted: false,
    }
    const uidScope = nextUidScope()

    const candidates = collectInteractiveCandidates()
    const matches = []
    let uidCounter = 0

    for (const element of candidates) {
      if (matches.length >= maxResults) break
      if (isYuntiWidgetElement(element)) continue
      const visible = isVisible(element)
      if (!includeHidden && !visible) continue

      uidCounter += 1
      const item = describeElement(element, `yunti-${uidScope}-${uidCounter}`, {
        includeRects,
        redaction,
        redactions,
        visible,
      })
      if (!matchesElement(item, {
        query,
        roleFilter,
        tagFilter,
        placeholderFilter,
      })) continue
      matches.push(item)
    }

    return {
      observationId: `find-${uidScope}`,
      browserSessionId: globalScope.__YUNTI_BROWSER_SESSION_ID__ || null,
      capturedAt: new Date().toISOString(),
      uidMapVersion: "observe-v1",
      query: cleanObject({
        query: query || undefined,
        role: roleFilter || undefined,
        tag: tagFilter || undefined,
        placeholder: placeholderFilter || undefined,
        maxResults,
        includeHidden,
      }),
      matchCount: matches.length,
      matches,
      redactions: finalizeRedactions(redactions),
      hints: matches.length
        ? ["Use the returned fresh uid for click/fill/select, then verify with yunti_observe_page or evaluate."]
        : ["No matching interactive elements found. Broaden the query, scroll, or fall back to yunti_observe_page."],
    }
  }

  // In-page wait primitive. It replaces the previous background-side CDP polling
  // loop: no debugger attach, no repeated Runtime.evaluate round trips, and DOM
  // changes are detected by MutationObserver instead of by fixed-interval scans.
  // Resolves with a match object, or null when the deadline passes.
  function waitForCondition(args = {}) {
    const text = String(args.text || "").trim()
    const selector = String(args.selector || "").trim()
    const urlContains = String(args.urlContains || "").trim()
    const timeoutMs = clampInteger(args.timeoutMs, 100, 30000, 5000)
    if (!text && !selector && !urlContains) {
      return Promise.reject(new Error("waitForCondition requires text, selector, or urlContains"))
    }
    const startedAt = Date.now()
    const immediate = matchWaitTarget({ text, selector, urlContains })
    if (immediate) return Promise.resolve({ ...immediate, waitedMs: 0 })

    return new Promise((resolve) => {
      let settled = false
      let debounceTimer = null
      let intervalTimer = null
      let deadlineTimer = null
      const observer =
        typeof globalScope.MutationObserver === "function"
          ? new globalScope.MutationObserver(schedule)
          : null

      activeWaits.add(cancel)

      function finish(match) {
        if (settled) return
        settled = true
        activeWaits.delete(cancel)
        observer?.disconnect?.()
        if (intervalTimer !== null) clearInterval(intervalTimer)
        if (deadlineTimer !== null) clearTimeout(deadlineTimer)
        if (debounceTimer !== null) clearTimeout(debounceTimer)
        resolve(match ? { ...match, waitedMs: Date.now() - startedAt } : null)
      }

      function schedule() {
        if (settled || debounceTimer !== null) return
        debounceTimer = setTimeout(() => {
          debounceTimer = null
          check()
        }, WAIT_DEBOUNCE_MS)
      }

      function check() {
        if (settled) return
        const match = matchWaitTarget({ text, selector, urlContains })
        if (match) finish(match)
      }

      // Called when the page runtime is torn down or re-injected so the
      // subscription cannot outlive the listener that owns it.
      function cancel() {
        finish(null)
      }

      intervalTimer = setInterval(schedule, WAIT_POLL_INTERVAL_MS)
      deadlineTimer = setTimeout(() => finish(null), timeoutMs)
      if (observer && document.documentElement) {
        try {
          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          })
        } catch {}
      }
      schedule()
    })
  }

  function matchWaitTarget({ text, selector, urlContains }) {
    // Client-side routing (history.pushState / replaceState) does not fire a tab
    // update, so the page must also watch its own URL for SPA navigations.
    if (urlContains && String(globalScope.location?.href || "").includes(urlContains)) {
      return { found: true, condition: "urlContains", value: urlContains }
    }
    // Fast path: the top-level document covers the common case without walking
    // shadow roots and iframe documents on every check.
    if (selector) {
      try {
        if (hasNonZeroRect(document.querySelector(selector))) {
          return { found: "selector", selector }
        }
      } catch {}
    }
    if (text) {
      const body = document.body
      const bodyText = body?.innerText || body?.textContent || ""
      if (bodyText.includes(text)) return { found: "text", text }
    } else if (!selector) {
      return null
    }

    // Deep path: open shadow roots and same-origin iframe documents.
    let matched = null
    walkRoots((root) => {
      if (matched) return
      if (selector && typeof root.querySelector === "function") {
        try {
          if (hasNonZeroRect(root.querySelector(selector))) {
            matched = { found: "selector", selector }
            return
          }
        } catch {}
      }
      if (!text) return
      const surface = root.body || root
      const rootText = surface.innerText || surface.textContent || ""
      if (rootText.includes(text)) matched = { found: "text", text }
    }, { trackOffsets: false })
    return matched
  }

  function hasNonZeroRect(element) {
    if (!element || typeof element.getBoundingClientRect !== "function") return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  // Cancel every in-flight subscription. Content-runtime teardown calls this so a
  // re-injected page runtime never leaves the previous instance's waits running.
  function cancelPendingWaits() {
    if (!activeWaits.size) return 0
    const cancelled = activeWaits.size
    for (const cancel of [...activeWaits]) cancel()
    activeWaits.clear()
    return cancelled
  }

  function collectInteractiveCandidates() {
    return collectFromRoots((root) => queryAll(root, INTERACTIVE_SELECTOR))
  }

  function collectScrollableCandidates() {
    return collectFromRoots((root) => queryAll(root, "body *"))
  }

  function collectFromRoots(selectElements) {
    const visitedElements = new Set()
    const results = []
    walkRoots((root, offsetX, offsetY) => {
      for (const element of selectElements(root)) {
        if (!element || visitedElements.has(element)) continue
        visitedElements.add(element)
        if (isInsideYuntiWidget(element)) continue
        setObservationOffset(element, offsetX, offsetY)
        results.push(element)
      }
    })
    return results
  }

  // Single root-walking primitive shared by observation and in-page waits: the
  // top document, then open shadow roots and same-origin iframe documents.
  // Observation needs iframe offsets for rect math; waits do not, and skipping
  // them avoids a forced layout read on every wait check.
  function walkRoots(visitRoot, options = {}) {
    const trackOffsets = options.trackOffsets !== false
    const visitedRoots = new Set()
    const roots = [{ root: document, offsetX: 0, offsetY: 0 }]

    while (roots.length) {
      const entry = roots.shift()
      const root = entry?.root
      const offsetX = Number(entry?.offsetX || 0)
      const offsetY = Number(entry?.offsetY || 0)
      if (!root || visitedRoots.has(root)) continue
      visitedRoots.add(root)

      visitRoot(root, offsetX, offsetY)

      for (const element of queryAll(root, "body *")) {
        const shadowRoot = element?.shadowRoot
        if (shadowRoot && !isYuntiWidgetHost(element)) {
          roots.push({ root: shadowRoot, offsetX, offsetY })
        }
        const iframeDocument = getSameOriginIframeDocument(element)
        if (iframeDocument) {
          if (trackOffsets) {
            const iframeRect = rectInfo(element, { offsetX, offsetY })
            roots.push({
              root: iframeDocument,
              offsetX: iframeRect.x,
              offsetY: iframeRect.y,
            })
          } else {
            roots.push({ root: iframeDocument, offsetX: 0, offsetY: 0 })
          }
        }
      }
    }

    return visitedRoots
  }

  function queryAll(root, selector) {
    if (!root || typeof root.querySelectorAll !== "function") return []
    try {
      return Array.from(root.querySelectorAll(selector))
    } catch {
      return []
    }
  }

  function nextUidScope() {
    uidGeneration += 1
    return `${Date.now().toString(36)}-${uidGeneration.toString(36)}`
  }

  function getSameOriginIframeDocument(element) {
    if (!element || element.tagName?.toLowerCase?.() !== "iframe") return null
    try {
      const frameDocument = element.contentDocument || element.contentWindow?.document || null
      return frameDocument?.documentElement ? frameDocument : null
    } catch {
      return null
    }
  }

  function captureObservationState(observation) {
    const elements = Array.isArray(observation?.elements) ? observation.elements : []
    const scrollableContainers = Array.isArray(observation?.scrollableContainers) ? observation.scrollableContainers : []
    return {
      observationId: observation.observationId,
      capturedAt: observation.capturedAt,
      pageSignature: JSON.stringify({
        url: observation?.page?.url || "",
        title: observation?.page?.title || "",
        readyState: observation?.page?.readyState || "",
      }),
      scrollSignature: JSON.stringify(observation?.scroll || {}),
      textTree: observation?.textTree || "",
      elementCount: Number(observation?.elementCount || elements.length || 0),
      scrollableContainerCount: scrollableContainers.length,
      elementsByIdentity: buildElementIdentityMap(elements),
      scrollablesByIdentity: buildElementIdentityMap(scrollableContainers),
    }
  }

  function buildDeltaObservation(observation, previousState) {
    const currentElements = Array.isArray(observation?.elements) ? observation.elements : []
    const currentScrollables = Array.isArray(observation?.scrollableContainers) ? observation.scrollableContainers : []
    const currentElementMap = buildElementIdentityMap(currentElements)
    const currentScrollableMap = buildElementIdentityMap(currentScrollables)
    const changedElements = summarizeChangedEntries(currentElementMap, previousState?.elementsByIdentity)
    const changedScrollables = summarizeChangedEntries(currentScrollableMap, previousState?.scrollablesByIdentity)
    const samePage = previousState?.pageSignature === JSON.stringify({
      url: observation?.page?.url || "",
      title: observation?.page?.title || "",
      readyState: observation?.page?.readyState || "",
    })
    const sameScroll = previousState?.scrollSignature === JSON.stringify(observation?.scroll || {})
    const sameTextTree = previousState?.textTree === (observation?.textTree || "")
    const firstDelta = !previousState
    const changedElementCount = changedElements.added.length + changedElements.removed.length + changedElements.updated.length
    const changedScrollableCount = changedScrollables.added.length + changedScrollables.removed.length + changedScrollables.updated.length
    const deltaHints = [
      changedElementCount || changedScrollableCount || !samePage || !sameScroll || !sameTextTree
        ? "Delta observation detected page changes. Run full yunti_observe_page before choosing a fresh uid for the next action."
        : "Delta observation found no meaningful page changes. Use yunti_wait_for, scroll, or switch tabs before repeating the same action.",
    ]

    return cleanObject({
      observationId: observation.observationId,
      browserSessionId: observation.browserSessionId,
      capturedAt: observation.capturedAt,
      uidMapVersion: observation.uidMapVersion,
      responseMode: "delta",
      baselineObservationId: previousState?.observationId,
      page: observation.page,
      viewport: observation.viewport,
      scroll: observation.scroll,
      elementCount: observation.elementCount,
      scrollableContainerCount: currentScrollables.length,
      redactions: observation.redactions,
      warnings: observation.warnings,
      limits: observation.limits,
      delta: {
        firstObservation: firstDelta,
        pageChanged: !samePage,
        scrollChanged: !sameScroll,
        textTreeChanged: !sameTextTree,
        textTreeLength: observation?.textTree ? observation.textTree.length : 0,
        previousTextTreeLength: previousState?.textTree ? previousState.textTree.length : 0,
        changedElementCount,
        changedScrollableContainerCount: changedScrollableCount,
        previousElementCount: previousState?.elementCount,
        previousScrollableContainerCount: previousState?.scrollableContainerCount,
        changedElements: trimChangedEntries(changedElements),
        changedScrollableContainers: trimChangedEntries(changedScrollables),
      },
      hints: deltaHints,
      fullObservationHint: "Use responseMode=full when you need a fresh full uid map, textTree, or complete scrollableContainers for the next action.",
    })
  }

  function buildElementIdentityMap(elements) {
    const map = new Map()
    for (const element of elements || []) {
      const key = elementIdentityKey(element)
      if (!key) continue
      map.set(key, JSON.stringify(summarizeComparableElement(element)))
    }
    return map
  }

  function summarizeChangedEntries(currentMap, previousMap) {
    const added = []
    const removed = []
    const updated = []
    const previous = previousMap instanceof Map ? previousMap : new Map()

    for (const [key, value] of currentMap.entries()) {
      if (!previous.has(key)) {
        added.push(key)
      } else if (previous.get(key) !== value) {
        updated.push(key)
      }
    }

    for (const key of previous.keys()) {
      if (!currentMap.has(key)) removed.push(key)
    }

    return { added, removed, updated }
  }

  function trimChangedEntries(changes) {
    return {
      added: (changes?.added || []).slice(0, 10),
      removed: (changes?.removed || []).slice(0, 10),
      updated: (changes?.updated || []).slice(0, 10),
    }
  }

  function summarizeComparableElement(element) {
    return cleanObject({
      role: element?.role,
      tag: element?.tag,
      name: element?.name,
      text: element?.text,
      label: element?.label,
      placeholder: element?.placeholder,
      valuePreview: element?.valuePreview,
      selectedText: element?.selectedText,
      hrefPreview: element?.hrefPreview,
      rect: element?.rect,
      visible: element?.visible,
      disabled: element?.disabled,
      editable: element?.editable,
      fillable: element?.fillable,
      checked: element?.checked,
      selected: element?.selected,
      scrollTop: element?.scrollTop,
      scrollLeft: element?.scrollLeft,
      pixelsBelow: element?.pixelsBelow,
      pixelsRight: element?.pixelsRight,
    })
  }

  function elementIdentityKey(element) {
    if (!element) return ""
    return [
      element.tag || "",
      element.role || "",
      element.name || "",
      element.label || "",
      element.placeholder || "",
      element.hrefPreview || "",
      element.rect?.x ?? "",
      element.rect?.y ?? "",
      element.rect?.width ?? "",
      element.rect?.height ?? "",
    ].join("|")
  }

  function matchesElement(item, filters) {
    if (filters.roleFilter && String(item.role || "").toLowerCase() !== filters.roleFilter) return false
    if (filters.tagFilter && String(item.tag || "").toLowerCase() !== filters.tagFilter) return false
    if (filters.placeholderFilter && !String(item.placeholder || "").toLowerCase().includes(filters.placeholderFilter)) return false
    if (!filters.query) return true
    const haystacks = [
      item.name,
      item.label,
      item.text,
      item.placeholder,
      item.selectedText,
      item.hrefPreview,
    ].filter(Boolean).map((value) => String(value).toLowerCase())
    return haystacks.some((value) => value.includes(filters.query))
  }

  function describeElement(element, uid, options) {
    const tag = element.tagName.toLowerCase()
    const role = element.getAttribute("role") || inferRole(element)
    const rawLabel = findLabel(element)
    const rawText = compactText(element.innerText || element.textContent || "", 240)
    const rawName = compactText(
      element.getAttribute("aria-label") ||
        rawLabel ||
        element.getAttribute("title") ||
        element.getAttribute("name") ||
        element.getAttribute("placeholder") ||
        rawText,
      240
    )
    const label = redactTextPreview("label", rawLabel, 160, options)
    const text = redactTextPreview("text", rawText, 240, options)
    const name = redactTextPreview("name", rawName, 240, options)
    const type = element.getAttribute("type") || (element.isContentEditable ? "contenteditable" : undefined)
    const valueInfo = getValuePreview(element, options.redaction, options.redactions)
    const rect = options.includeRects ? rectInfo(element) : undefined
    const scrollable = isScrollable(element)
    const fieldState = getFieldState(element, options)

    return cleanObject({
      uid,
      role,
      tag,
      name,
      text,
      label,
      placeholder: safeAttribute(element, "placeholder", options),
      valuePreview: valueInfo.valuePreview,
      valueRedacted: valueInfo.valueRedacted,
      type,
      hrefPreview: element instanceof HTMLAnchorElement ? redactUrl(element.href, options.redaction, options.redactions) : undefined,
      rect,
      visible: options.visible,
      disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
      editable: isEditable(element),
      readOnly: fieldState.readOnly,
      fillable: fieldState.fillable,
      fillBlockReason: fieldState.fillBlockReason,
      selectedIndex: fieldState.selectedIndex,
      selectedValue: fieldState.selectedValue,
      selectedValueRedacted: fieldState.selectedValueRedacted,
      selectedText: fieldState.selectedText,
      options: fieldState.options,
      checked: "checked" in element ? Boolean(element.checked) : undefined,
      selected: "selected" in element ? Boolean(element.selected) : undefined,
      scrollable,
      containerUid: undefined,
    })
  }

  function collectScrollableContainers(options) {
    const containers = []
    let uidCounter = 0
    for (const element of collectScrollableCandidates()) {
      if (containers.length >= options.maxElements) break
      if (isYuntiWidgetElement(element) || !isVisible(element) || !isScrollable(element)) continue
      uidCounter += 1
      containers.push(cleanObject({
        uid: `scroll-${options.uidScope}-${uidCounter}`,
        tag: element.tagName.toLowerCase(),
        name: redactTextPreview(
          "scrollable container name",
          compactText(element.getAttribute("aria-label") || element.getAttribute("title") || element.id || "", 160),
          160,
          options
        ),
        rect: options.includeRects ? rectInfo(element) : undefined,
        scrollTop: Math.round(element.scrollTop || 0),
        scrollLeft: Math.round(element.scrollLeft || 0),
        scrollHeight: Math.round(element.scrollHeight || 0),
        scrollWidth: Math.round(element.scrollWidth || 0),
        clientHeight: Math.round(element.clientHeight || 0),
        clientWidth: Math.round(element.clientWidth || 0),
        canScrollVertical: element.scrollHeight > element.clientHeight,
        canScrollHorizontal: element.scrollWidth > element.clientWidth,
        pixelsAbove: Math.round(element.scrollTop || 0),
        pixelsBelow: Math.max(0, Math.round((element.scrollHeight || 0) - (element.clientHeight || 0) - (element.scrollTop || 0))),
        pixelsLeft: Math.round(element.scrollLeft || 0),
        pixelsRight: Math.max(0, Math.round((element.scrollWidth || 0) - (element.clientWidth || 0) - (element.scrollLeft || 0))),
      }))
    }
    return containers
  }

  function getDocumentScroll() {
    const scrollingElement = document.scrollingElement || document.documentElement
    const x = Math.round(globalScope.scrollX || scrollingElement.scrollLeft || 0)
    const y = Math.round(globalScope.scrollY || scrollingElement.scrollTop || 0)
    const viewportWidth = Math.round(globalScope.innerWidth || scrollingElement.clientWidth || 0)
    const viewportHeight = Math.round(globalScope.innerHeight || scrollingElement.clientHeight || 0)
    const pageWidth = Math.round(Math.max(scrollingElement.scrollWidth || 0, document.documentElement.scrollWidth || 0))
    const pageHeight = Math.round(Math.max(scrollingElement.scrollHeight || 0, document.documentElement.scrollHeight || 0))
    const pixelsBelow = Math.max(0, pageHeight - viewportHeight - y)
    const pixelsRight = Math.max(0, pageWidth - viewportWidth - x)
    return {
      x,
      y,
      pageWidth,
      pageHeight,
      pixelsAbove: y,
      pixelsBelow,
      pixelsLeft: x,
      pixelsRight,
      pagesAbove: viewportHeight ? Number((y / viewportHeight).toFixed(2)) : 0,
      pagesBelow: viewportHeight ? Number((pixelsBelow / viewportHeight).toFixed(2)) : 0,
    }
  }

  function getValuePreview(element, redaction, redactions) {
    if (!("value" in element)) return {}
    const key = [
      element.getAttribute("type"),
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("autocomplete"),
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
    ].filter(Boolean).join(" ")
    const rawValue = String(element.value || "")
    if (!rawValue) return { valuePreview: "", valueRedacted: false }
    if (shouldRedact(key, rawValue, redaction)) {
      recordRedaction(redactions, categoryFor(key, rawValue))
      return { valuePreview: "[REDACTED]", valueRedacted: true }
    }
    return { valuePreview: truncateText(rawValue, 120), valueRedacted: false }
  }

  function safeAttribute(element, attr, options) {
    const value = element.getAttribute(attr)
    if (!value) return undefined
    const key = `${attr} ${element.getAttribute("name") || ""} ${element.getAttribute("id") || ""}`
    if (shouldRedact(key, value, options.redaction)) {
      recordRedaction(options.redactions, categoryFor(key, value))
      return "[REDACTED]"
    }
    return truncateText(value, 160)
  }

  function redactTextPreview(key, value, max, options) {
    if (!value) return value
    if (shouldRedact(key, value, options.redaction)) {
      recordRedaction(options.redactions, categoryFor(key, value))
      return "[REDACTED]"
    }
    return truncateText(value, max)
  }

  function shouldRedact(key, value, redaction) {
    if (redaction === "off") return false
    const haystack = `${key || ""} ${value || ""}`
    if (SENSITIVE_KEY_RE.test(haystack)) return true
    if (JWT_RE.test(haystack) || BEARER_RE.test(haystack) || PRIVATE_KEY_RE.test(haystack)) return true
    if (LONG_RANDOM_RE.test(String(value || ""))) return true
    if (redaction === "strict" && hasStrictPii(value)) return true
    return redaction === "strict" && String(value || "").length >= 16
  }

  function hasStrictPii(value) {
    const text = String(value || "")
    return EMAIL_RE.test(text) || isPaymentCardLike(text) || PHONE_RE.test(text) || ADDRESS_RE.test(text)
  }

  function isPaymentCardLike(value) {
    const digits = String(value || "").replace(/\D/g, "")
    return digits.length >= 13 && digits.length <= 19 && PAYMENT_CARD_RE.test(String(value || "")) && passesLuhn(digits)
  }

  function passesLuhn(digits) {
    let sum = 0
    let shouldDouble = false
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index])
      if (shouldDouble) {
        digit *= 2
        if (digit > 9) digit -= 9
      }
      sum += digit
      shouldDouble = !shouldDouble
    }
    return sum % 10 === 0
  }

  function categoryFor(key, value) {
    const haystack = `${key || ""} ${value || ""}`
    if (/password|passwd|pwd|密码/i.test(haystack)) return "password"
    if (/cookie|session/i.test(haystack)) return "session"
    if (/api[-_]?key|token|secret|auth|jwt|bearer|private[-_]?key|令牌/i.test(haystack)) return "token"
    if (/otp|验证码/i.test(haystack)) return "otp"
    if (EMAIL_RE.test(haystack)) return "email"
    if (isPaymentCardLike(haystack)) return "payment_card"
    if (PHONE_RE.test(haystack)) return "phone"
    if (ADDRESS_RE.test(haystack)) return "address"
    return "credential_like"
  }

  function recordRedaction(redactions, category) {
    redactions.count += 1
    if (!redactions.categories.includes(category)) redactions.categories.push(category)
  }

  function finalizeRedactions(redactions) {
    return {
      mode: redactions.mode,
      count: redactions.count,
      categories: redactions.categories.sort(),
      valuesRedacted: redactions.count > 0,
      screenshotRedacted: false,
    }
  }

  function redactUrl(url, redaction, redactions) {
    if (redaction === "off") return truncateText(url, 2000)
    try {
      const parsed = new URL(url)
      for (const key of Array.from(parsed.searchParams.keys())) {
        const values = parsed.searchParams.getAll(key)
        parsed.searchParams.delete(key)
        for (const value of values) {
          if (shouldRedact(key, value, redaction)) {
            recordRedaction(redactions, categoryFor(key, value))
            parsed.searchParams.append(key, "[REDACTED]")
          } else {
            parsed.searchParams.append(key, truncateText(value, 120))
          }
        }
      }
      return truncateText(parsed.toString(), 2000)
    } catch {
      return truncateText(String(url || ""), 2000)
    }
  }

  function inferRole(element) {
    const tag = element.tagName.toLowerCase()
    if (tag === "a") return "link"
    if (tag === "button") return "button"
    if (tag === "textarea") return "textbox"
    if (tag === "select") return "combobox"
    if (tag === "input") {
      const type = String(element.getAttribute("type") || "text").toLowerCase()
      if (type === "checkbox") return "checkbox"
      if (type === "radio") return "radio"
      if (type === "range") return "slider"
      if (type === "button" || type === "submit" || type === "reset") return "button"
      return "textbox"
    }
    if (element.isContentEditable) return "textbox"
    return tag
  }

  function isEditable(element) {
    const tag = element.tagName.toLowerCase()
    if (element.isContentEditable) return true
    if (tag === "select" || tag === "textarea") return true
    if (tag !== "input") return false
    return !isBlockedInputType(element)
  }

  function getFieldState(element, options) {
    const tag = element.tagName.toLowerCase()
    const disabled = Boolean(element.disabled || element.getAttribute("aria-disabled") === "true")
    const readOnly = Boolean(element.readOnly || element.getAttribute("aria-readonly") === "true")
    const editable = isEditable(element)
    const visible = options.visible !== false
    const fillable = Boolean(visible && editable && !disabled && !readOnly)
    const optionsSummary = tag === "select" ? getSelectOptions(element, options) : undefined
    const selectedSummary = tag === "select" ? getSelectedOptionSummary(element, options) : {}
    return cleanObject({
      readOnly,
      fillable,
      fillBlockReason: fillable ? undefined : getFillBlockReason({ element, visible, editable, disabled, readOnly }),
      ...selectedSummary,
      options: optionsSummary,
    })
  }

  function getFillBlockReason({ element, visible, editable, disabled, readOnly }) {
    if (!visible) return "hidden-or-not-visible"
    if (disabled) return "disabled"
    if (readOnly) return "readonly"
    if (!editable && isBlockedInputType(element)) return "not-editable-input-type"
    if (!editable) return "not-editable"
    return undefined
  }

  function isBlockedInputType(element) {
    if (element.tagName.toLowerCase() !== "input") return false
    const type = String(element.getAttribute("type") || "text").toLowerCase()
    return ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type)
  }

  function getSelectOptions(element, options) {
    const optionElements = Array.from(element.options || [])
    if (!optionElements.length) return undefined
    return optionElements.slice(0, 50).map((option) => {
      const rawValue = String(option.value || "")
      const rawText = compactText(option.text || option.textContent || "", 120)
      const key = `select option ${element.getAttribute("name") || ""} ${element.getAttribute("id") || ""}`
      let value = truncateText(rawValue, 120)
      let valueRedacted = false
      let text = rawText
      let textRedacted = false
      if (shouldRedact(key, rawValue, options.redaction)) {
        recordRedaction(options.redactions, categoryFor(key, rawValue))
        value = "[REDACTED]"
        valueRedacted = true
      }
      if (rawText && shouldRedact(`${key} text`, rawText, options.redaction)) {
        recordRedaction(options.redactions, categoryFor(`${key} text`, rawText))
        text = "[REDACTED]"
        textRedacted = true
      }
      return cleanObject({
        value,
        text,
        selected: Boolean(option.selected),
        disabled: Boolean(option.disabled),
        valueRedacted,
        textRedacted: textRedacted || undefined,
      })
    })
  }

  function getSelectedOptionSummary(element, options) {
    const optionElements = Array.from(element.options || [])
    const explicitSelectedIndex = Number.isFinite(Number(element.selectedIndex)) ? Number(element.selectedIndex) : -1
    const inferredSelectedIndex = optionElements.findIndex((option) => option.selected)
    const selectedIndex = explicitSelectedIndex >= 0 ? explicitSelectedIndex : inferredSelectedIndex
    const selectedOption = optionElements[selectedIndex] || optionElements.find((option) => option.selected)
    const rawValue = String(element.value || selectedOption?.value || "")
    const rawSelectedText = compactText(selectedOption?.text || selectedOption?.textContent || "", 120)
    const key = `select selected ${element.getAttribute("name") || ""} ${element.getAttribute("id") || ""}`
    let selectedValue = rawValue ? truncateText(rawValue, 120) : ""
    let selectedValueRedacted = false
    let selectedText = rawSelectedText
    let selectedTextRedacted = false
    if (rawValue && shouldRedact(key, rawValue, options.redaction)) {
      recordRedaction(options.redactions, categoryFor(key, rawValue))
      selectedValue = "[REDACTED]"
      selectedValueRedacted = true
    }
    if (rawSelectedText && shouldRedact(`${key} text`, rawSelectedText, options.redaction)) {
      recordRedaction(options.redactions, categoryFor(`${key} text`, rawSelectedText))
      selectedText = "[REDACTED]"
      selectedTextRedacted = true
    }
    return cleanObject({
      selectedIndex,
      selectedValue,
      selectedValueRedacted,
      selectedText,
      selectedTextRedacted: selectedTextRedacted || undefined,
    })
  }

  function findLabel(element) {
    if (element.id && globalScope.CSS?.escape) {
      const rootNode = element.getRootNode?.() || document
      const lookupRoot = typeof rootNode?.querySelector === "function" ? rootNode : document
      const label = lookupRoot.querySelector(`label[for="${CSS.escape(element.id)}"]`)
      if (label) return compactText(label.innerText || label.textContent || "", 160)
    }
    return compactText(element.closest?.("label")?.innerText || element.closest?.("label")?.textContent || "", 160)
  }

  function formatTextTreeLine(item) {
    const attrs = [
      item.role ? `role=${item.role}` : "",
      item.name ? `name="${item.name}"` : "",
      item.valueRedacted ? "value=[REDACTED]" : item.valuePreview ? `value="${item.valuePreview}"` : "",
      item.disabled ? "disabled" : "",
    ].filter(Boolean).join(" ")
    const tag = item.tag || "element"
    return `[${item.uid}]<${tag}${attrs ? ` ${attrs}` : ""}>${item.text || item.name || ""}</${tag}>`
  }

  function buildHints(elements, scrollableContainers) {
    const hints = []
    if (!elements.length) hints.push("No visible interactive elements found; wait, scroll, switch tabs, or use screenshot/CDP for recovery.")
    const scroll = getDocumentScroll()
    if (scroll.pixelsBelow > 0) hints.push("Page has content below the viewport; scroll before assuming an element is missing.")
    if (scrollableContainers.length) hints.push("Scrollable containers detected; a later action may need container-aware scrolling.")
    return hints
  }

  function isYuntiWidgetElement(element) {
    return Boolean(element.closest?.("#yunti-browser-runtime-widget")) || isInsideYuntiWidget(element)
  }

  function isInsideYuntiWidget(element) {
    let current = element
    while (current) {
      if (isYuntiWidgetHost(current)) return true
      const rootNode = current.getRootNode?.()
      const host = rootNode?.host
      if (!host || host === current) break
      current = host
    }
    return false
  }

  function isYuntiWidgetHost(element) {
    return Boolean(element?.id === "yunti-browser-runtime-widget")
  }

  function isVisible(element) {
    if (!element || typeof element.getBoundingClientRect !== "function") return false
    const style = globalScope.getComputedStyle ? globalScope.getComputedStyle(element) : null
    if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)) return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  function isInViewport(element) {
    const rect = element.getBoundingClientRect()
    const width = globalScope.innerWidth || document.documentElement.clientWidth || 0
    const height = globalScope.innerHeight || document.documentElement.clientHeight || 0
    return rect.bottom >= 0 && rect.right >= 0 && rect.top <= height && rect.left <= width
  }

  function isScrollable(element) {
    if (!element) return false
    const style = globalScope.getComputedStyle ? globalScope.getComputedStyle(element) : null
    const overflowY = style?.overflowY || ""
    const overflowX = style?.overflowX || ""
    return (
      (/(auto|scroll)/.test(overflowY) && element.scrollHeight > element.clientHeight) ||
      (/(auto|scroll)/.test(overflowX) && element.scrollWidth > element.clientWidth)
    )
  }

  function rectInfo(element, offset = getObservationOffset(element)) {
    const rect = element.getBoundingClientRect()
    return {
      x: Math.round(rect.x + Number(offset?.x || 0)),
      y: Math.round(rect.y + Number(offset?.y || 0)),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }

  function setObservationOffset(element, offsetX, offsetY) {
    if (!element || typeof element !== "object") return
    try {
      element.__yuntiObservationOffset = {
        x: Number(offsetX || 0),
        y: Number(offsetY || 0),
      }
    } catch {}
  }

  function getObservationOffset(element) {
    return element?.__yuntiObservationOffset || { x: 0, y: 0 }
  }

  function compactText(text, maxLength) {
    return truncateText(String(text || "").replace(/\s+/g, " ").trim(), maxLength) || undefined
  }

  function truncateText(text, maxLength) {
    const value = String(text || "")
    return value.length > maxLength ? value.slice(0, maxLength) : value
  }

  function clampInteger(value, min, max, fallback) {
    const number = Number(value)
    if (!Number.isFinite(number)) return fallback
    return Math.max(min, Math.min(max, Math.floor(number)))
  }

  function normalizeRedaction(value) {
    const mode = String(value || "balanced")
    return mode === "strict" || mode === "off" ? mode : "balanced"
  }

  function cleanObject(value) {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined && item !== null && item !== "") out[key] = item
    }
    return out
  }

  globalScope.YuntiBrowserRuntimeObserver = {
    observePage,
    findElements,
    waitForCondition,
    cancelPendingWaits,
    _private: {
      matchesElement,
      shouldRedact,
      redactUrl,
      matchWaitTarget,
    },
  }
})(globalThis)
