// The manifest content script and the chrome.scripting recovery injection share
// one isolated world, so this file must stay safe to (re)install at any time.
;(function installYuntiContentRuntime(globalScope) {
  const RUNTIME_MARKER = "__YUNTI_BROWSER_RUNTIME_CONTENT__"
  const RUNTIME_REVISION = 1

  const previousRuntime = globalScope[RUNTIME_MARKER]
  if (previousRuntime && typeof previousRuntime.teardown === "function") {
    try {
      previousRuntime.teardown()
    } catch {}
  }

const PATCH_ATTR = "data-yunti-browser-runtime-patch"
const DANGEROUS_RE = /提交|保存|删除|作废|关闭|下架|审核|确认|同意|拒绝|submit|save|delete|remove|approve|reject/i
const AUTH_CACHE_TTL_MS = 5000
const DEFAULT_ACTIONABILITY_TIMEOUT_MS = 1200
const ACTIONABILITY_POLL_INTERVAL_MS = 100

const patchStore = new Map()
let browserSessionId = null
let registerTimer = null
let authStateCache = null
let extensionContextInvalidated = false
let pageWatchersInstalled = false
let pageWatcherTeardown = null

function handleRuntimeMessage(message, _sender, sendResponse) {
  if (message?.type === "yunti_execute_tool") {
    void executeTool(message.tool, message.arguments || {})
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }))
    return true
  }
  if (message?.type === "yunti_refresh_registration") {
    void register({ forceAuth: true }).then(sendResponse, (error) =>
      sendResponse({ ok: false, error: error?.message || String(error) })
    )
    return true
  }
  return false
}

function teardown() {
  try {
    chrome.runtime.onMessage.removeListener(handleRuntimeMessage)
  } catch {}
  try {
    window.YuntiBrowserRuntimeObserver?.cancelPendingWaits?.()
  } catch {}
  clearTimeout(registerTimer)
  registerTimer = null
  if (pageWatcherTeardown) {
    try {
      pageWatcherTeardown()
    } catch {}
    pageWatcherTeardown = null
  }
}

chrome.runtime.onMessage.addListener(handleRuntimeMessage)
globalScope[RUNTIME_MARKER] = {
  revision: RUNTIME_REVISION,
  teardown,
  _private: { clickAt, clickElement, fillElement, scrollPage },
}

void bootstrapContent()

async function bootstrapContent() {
  await register().catch(() => null)
}

async function register(options = {}) {
  if (extensionContextInvalidated) return contextInvalidatedResponse()
  const support = await sendRuntimeMessage({
    type: "yunti_is_supported_page",
    page: { url: location.href, title: document.title },
  })
  if (!support?.supported) {
    return { ok: false, error: support?.error || "not a browser page" }
  }

  const page = await getPageState({ forceAuth: Boolean(options.forceAuth) })
  const response = await sendRuntimeMessage({
    type: "yunti_content_ready",
    page,
  })
  if (response?.ok) {
    browserSessionId = response.session.browserSessionId
    installPageWatchers()
  }
  return response
}

async function getPageState(options = {}) {
  return {
    url: location.href,
    title: document.title,
    client: getClientInfo(),
    auth: await getAuthState(options),
  }
}

function getClientInfo() {
  const userAgent = String(navigator.userAgent || "")
  return {
    userAgent,
    family: detectBrowserFamily(userAgent),
    platform: String(navigator.userAgentData?.platform || navigator.platform || ""),
    language: String(navigator.language || ""),
  }
}

function detectBrowserFamily(userAgent) {
  if (/Edg\//i.test(userAgent)) return "edge"
  if (/OPR\//i.test(userAgent)) return "opera"
  if (/Brave\//i.test(userAgent)) return "brave"
  if (/Chrome\//i.test(userAgent) || /Chromium\//i.test(userAgent)) return "chrome"
  if (/Firefox\//i.test(userAgent)) return "firefox"
  if (/Safari\//i.test(userAgent)) return "safari"
  return "unknown"
}

async function getAuthState(options = {}) {
  if (!options.forceAuth) {
    const cached = getCachedAuthState()
    if (cached) return cached
  }

  const state = getDomAuthState()
  cacheAuthState(state)
  return state
}

function getCachedAuthState() {
  if (!authStateCache) return null
  if (authStateCache.href !== location.href) return null
  if (Date.now() - authStateCache.at > AUTH_CACHE_TTL_MS) return null
  return authStateCache.value
}

function cacheAuthState(value) {
  authStateCache = {
    href: location.href,
    at: Date.now(),
    value,
  }
}

function getDomAuthState() {
  const visibleText = collectVisibleText(5000)
  const hashPath = location.hash.replace(/^#/, "")
  const urlLooksLogin = /(^|[/?#])(?:login|signin|auth)(?:$|[/?#&=])/i.test(location.href)
  const businessRoute = /^\/(?!login|signin|auth)(?:[a-z0-9_-]+\/?)+/i.test(hashPath)
  const passwordInputs = [...document.querySelectorAll("input[type='password']")].filter(isVisible)
  const loginText = /登录|登陆|用户名|账号|密码|验证码|sign in|login/i.test(visibleText)
  const appShell = document.querySelector(
    ".ant-layout,.ant-menu,.el-menu,.el-container,[class*='layout'],[class*='sidebar'],[class*='menu'],nav,aside"
  )
  const userMenu = getUserMenuState()
  const businessText =
    /工作台|仪表盘|首页|菜单|系统|管理|查询|搜索|筛选|新增|编辑|导入|导出|返回|列表|详情|设置|帮助中心/i.test(
      visibleText
    )

  if (userMenu.loggedIn) {
    return {
      state: "authenticated",
      loggedIn: true,
      reason: userMenu.userName
        ? `Detected user menu: ${userMenu.userName}`
        : "Detected user menu and logout entry",
      userName: userMenu.userName,
      checkedAt: new Date().toISOString(),
    }
  }

  if (!urlLooksLogin && businessRoute && (appShell || businessText)) {
    return {
      state: "authenticated",
      loggedIn: true,
      reason: "Detected application route and page shell",
      checkedAt: new Date().toISOString(),
    }
  }

  if (!urlLooksLogin && appShell && businessText) {
    return {
      state: "authenticated",
      loggedIn: true,
      reason: "Detected application navigation or content",
      checkedAt: new Date().toISOString(),
    }
  }

  if (urlLooksLogin || (passwordInputs.length > 0 && loginText) || (loginText && !appShell && !businessText)) {
    return {
      state: "unauthenticated",
      loggedIn: false,
      reason: "检测到登录页或登录表单",
      checkedAt: new Date().toISOString(),
    }
  }

  if (document.readyState === "loading") {
    return {
      state: "checking",
      loggedIn: false,
      reason: "页面仍在加载",
      checkedAt: new Date().toISOString(),
    }
  }

  return {
    state: "unknown",
    loggedIn: false,
    reason: "Current page is connected; the agent should infer auth state from page context when needed",
    checkedAt: new Date().toISOString(),
  }
}

function getUserMenuState() {
  const logoutByXPath = textFromXPath("//*[starts-with(@id, 'dropdown-menu-')]/li[2]/span")
  const userByXPath = textFromXPath("//*[starts-with(@id, 'dropdown-menu-')]/li[1]")
  const menuItems = [
    ...document.querySelectorAll("[id^='dropdown-menu-'] li, [id^='dropdown-menu-'] span"),
  ].filter(isVisible)
  const logoutByCss = menuItems.some((item) => /退出登录|退出|注销|登出/i.test(item.innerText || ""))
  const userByCss =
    menuItems.map((item) => compactText(item.innerText || "")).find((text) => text && !/退出|注销|登出/i.test(text)) ||
    ""

  return {
    loggedIn: /退出登录|退出|注销|登出/i.test(logoutByXPath || "") || logoutByCss,
    userName: compactText(userByXPath || userByCss || "") || "",
  }
}

function textFromXPath(xpath) {
  try {
    const node = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      .singleNodeValue
    return node && isVisible(node.parentElement || node) ? node.textContent || "" : ""
  } catch {
    return ""
  }
}

function installPageWatchers() {
  if (pageWatchersInstalled) return
  pageWatchersInstalled = true
  const watcherTeardowns = []
  window.addEventListener("popstate", scheduleRegister)
  watcherTeardowns.push(() => window.removeEventListener("popstate", scheduleRegister))
  window.addEventListener("hashchange", scheduleRegister)
  watcherTeardowns.push(() => window.removeEventListener("hashchange", scheduleRegister))
  const handleVisibilityChange = () => {
    if (!document.hidden) scheduleRegister()
  }
  document.addEventListener("visibilitychange", handleVisibilityChange)
  watcherTeardowns.push(() => document.removeEventListener("visibilitychange", handleVisibilityChange))

  for (const name of ["pushState", "replaceState"]) {
    const original = history[name]
    const patched = function patchedHistoryState(...args) {
      const result = original.apply(this, args)
      scheduleRegister()
      return result
    }
    history[name] = patched
    watcherTeardowns.push(() => {
      if (history[name] === patched) history[name] = original
    })
  }

  const observer = new MutationObserver(scheduleRegister)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
  watcherTeardowns.push(() => observer.disconnect())

  pageWatcherTeardown = () => {
    for (const watcherTeardown of watcherTeardowns.splice(0)) {
      try {
        watcherTeardown()
      } catch {}
    }
  }
}

function scheduleRegister() {
  if (extensionContextInvalidated) return
  clearTimeout(registerTimer)
  registerTimer = setTimeout(() => {
    void register().catch(() => null)
  }, 500)
}

async function sendRuntimeMessage(message) {
  if (extensionContextInvalidated) return contextInvalidatedResponse()
  try {
    return await chrome.runtime.sendMessage(message)
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      return markExtensionContextInvalidated()
    }
    return { ok: false, error: error?.message || String(error) }
  }
}

function isExtensionContextInvalidated(error) {
  return /extension context invalidated/i.test(error?.message || String(error || ""))
}

function contextInvalidatedResponse() {
  return { ok: false, error: "插件已重新加载，正在等待扩展自动恢复连接；必要时再刷新页面。" }
}

function markExtensionContextInvalidated() {
  extensionContextInvalidated = true
  clearTimeout(registerTimer)
  return contextInvalidatedResponse()
}

async function executeTool(tool, args) {
  switch (tool) {
    case "yunti_observe_page":
      return observePage(args)
    case "yunti_find_elements":
      return findElements(args)
    case "yunti_get_page_snapshot":
      return getPageSnapshot(args)
    case "yunti_get_selected_context":
      return getSelectedContext()
    case "yunti_fetch_with_cookie":
      return fetchWithCookie(args)
    case "yunti_apply_preview_patch":
      return applyPreviewPatch(args)
    case "yunti_rollback_preview_patch":
      return rollbackPreviewPatch(args.patchId)
    case "yunti_click":
      return clickElement(args)
    case "yunti_click_at":
      return clickAt(args)
    case "yunti_hover":
      return hoverElement(args)
    case "yunti_fill":
      return fillElement(args)
    case "yunti_type_text":
      return typeText(args)
    case "yunti_press_key":
      return pressKey(args)
    case "yunti_select":
      return selectElement(args)
    case "yunti_scroll":
      return scrollPage(args)
    case "yunti_wait_for":
      return waitForPageCondition(args)
    case "yunti_request_user_confirmation":
      return requestUserConfirmation(args)
    default:
      throw new Error(`Unknown Yunti browser tool: ${tool}`)
  }
}

function observePage(args = {}) {
  if (!window.YuntiBrowserRuntimeObserver?.observePage) {
    throw new Error("yunti_observe_page is unavailable because the DOM observer module was not loaded. Refresh the page and try again.")
  }
  window.__YUNTI_BROWSER_SESSION_ID__ = browserSessionId
  return window.YuntiBrowserRuntimeObserver.observePage(args)
}

function findElements(args = {}) {
  if (!window.YuntiBrowserRuntimeObserver?.findElements) {
    throw new Error("yunti_find_elements is unavailable because the DOM observer module was not loaded. Refresh the page and try again.")
  }
  window.__YUNTI_BROWSER_SESSION_ID__ = browserSessionId
  return window.YuntiBrowserRuntimeObserver.findElements(args)
}

// In-page wait subscription. The DOM observer owns the MutationObserver and the
// shadow/iframe traversal, so the background never has to poll the page over CDP.
function waitForPageCondition(args = {}) {
  if (!window.YuntiBrowserRuntimeObserver?.waitForCondition) {
    throw new Error("yunti_wait_for is unavailable because the DOM observer module was not loaded. Refresh the page and try again.")
  }
  window.__YUNTI_BROWSER_SESSION_ID__ = browserSessionId
  return window.YuntiBrowserRuntimeObserver.waitForCondition(args)
}

async function getPageSnapshot(args = {}) {
  const mode = args.mode === "detailed" ? "detailed" : "light"
  const includeElements = args.includeElements === undefined ? mode === "detailed" : Boolean(args.includeElements)
  const defaultTextLength = includeElements ? 12000 : 4000
  const maxTextLength = clamp(Number(args.maxTextLength ?? defaultTextLength), 0, 60000)
  const snapshot = {
    browserSessionId,
    url: location.href,
    origin: location.origin,
    title: document.title,
    auth: await getAuthState(),
    mode,
    selection: String(getSelection()?.toString() || "").trim().slice(0, 4000),
    visibleText: collectVisibleText(maxTextLength),
    overview: getPageOverview(),
    capturedAt: new Date().toISOString(),
  }
  if (includeElements) {
    snapshot.forms = [...document.forms].slice(0, 20).map(describeForm)
    snapshot.buttons = [...document.querySelectorAll("button,input[type=button],input[type=submit],a")]
      .filter(isVisible)
      .slice(0, 100)
      .map(describeClickable)
    snapshot.inputs = [...document.querySelectorAll("input,textarea,select,[contenteditable=true]")]
      .filter(isVisible)
      .slice(0, 120)
      .map(describeInput)
    snapshot.links = [...document.querySelectorAll("a[href]")]
      .filter(isVisible)
      .slice(0, 80)
      .map(describeClickable)
    snapshot.tables = [...document.querySelectorAll("table")]
      .filter(isVisible)
      .slice(0, 20)
      .map(describeTable)
  }
  return snapshot
}

function getSelectedContext() {
  const selection = getSelection()
  const text = String(selection?.toString() || "").trim()
  let element = null
  if (selection && selection.rangeCount > 0) {
    const node = selection.getRangeAt(0).commonAncestorContainer
    element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  }
  return {
    browserSessionId,
    url: location.href,
    title: document.title,
    text,
    element: element ? describeElement(element) : null,
  }
}

async function fetchWithCookie(args) {
  const url = new URL(args.url, location.href)
  if (url.origin !== location.origin) {
    throw new Error("yunti_fetch_with_cookie only allows current platform origin")
  }

  const method = String(args.method || "GET").toUpperCase()
  const response = await fetch(url.toString(), {
    method,
    headers: args.headers || {},
    body: args.body ?? undefined,
    credentials: "include",
  })
  const maxBytes = clamp(Number(args.maxBytes || 200000), 1024, 1000000)
  const text = await response.text()
  return {
    url: url.toString(),
    status: response.status,
    ok: response.ok,
    redirected: response.redirected,
    contentType: response.headers.get("content-type"),
    body: text.slice(0, maxBytes),
    truncated: text.length > maxBytes,
  }
}

function applyPreviewPatch(args) {
  const patchId = String(args.patchId || crypto.randomUUID())
  const applied = []

  for (const patch of args.patches || []) {
    const target = mustFind(patch.selector)
    const record = snapshotElement(target)
    record.inserted = []

    target.setAttribute(PATCH_ATTR, patchId)
    target.classList.add("yunti-browser-runtime-highlight")

    if (patch.text !== undefined) target.textContent = String(patch.text)
    if (patch.html !== undefined) target.innerHTML = String(patch.html)
    if (patch.value !== undefined && "value" in target) {
      target.value = String(patch.value)
      target.dispatchEvent(new Event("input", { bubbles: true }))
      target.dispatchEvent(new Event("change", { bubbles: true }))
    }
    if (patch.style && typeof patch.style === "object") {
      for (const [key, value] of Object.entries(patch.style)) target.style[key] = String(value)
    }
    if (patch.attributes && typeof patch.attributes === "object") {
      for (const [key, value] of Object.entries(patch.attributes)) {
        target.setAttribute(key, String(value))
      }
    }
    if (patch.className) target.classList.add(...String(patch.className).split(/\s+/).filter(Boolean))
    for (const [position, html] of [
      ["beforeend", patch.appendHtml],
      ["beforebegin", patch.beforeHtml],
      ["afterend", patch.afterHtml],
    ]) {
      if (!html) continue
      record.inserted.push(...insertTemporaryHtml(target, position, String(html), patchId))
    }

    applied.push({ selector: patch.selector, element: describeElement(target), record })
  }

  patchStore.set(patchId, applied)
  return { patchId, applied: applied.length }
}

function rollbackPreviewPatch(patchId) {
  const ids = patchId ? [patchId] : [...patchStore.keys()]
  let restored = 0
  for (const id of ids) {
    const records = patchStore.get(id) || []
    for (const item of records.reverse()) {
      restoreElement(item.record)
      restored += 1
    }
    patchStore.delete(id)
  }
  return { restored, remainingPatchIds: [...patchStore.keys()] }
}

async function clickElement(args) {
  if (args.selector) {
    const resolved = await resolveActionableSelector(args.selector, {
      timeoutMs: args.timeoutMs,
      action: "click",
      requireEnabled: true,
      requireReceivesEvents: true,
    })
    if (!resolved.ok) return buildActionabilityFailureResult(args.selector, "click", resolved)
    const element = resolved.element
    element.scrollIntoView({ block: "center", inline: "center" })
    element.click()
    return {
      clicked: true,
      element: describeElement(element),
      actionability: buildActionabilitySummary(resolved),
    }
  }
  return clickAt(args)
}

function clickAt(args) {
  const x = clamp(Number(args.x), 0, Math.max(0, window.innerWidth - 1))
  const y = clamp(Number(args.y), 0, Math.max(0, window.innerHeight - 1))
  const element = resolveElementFromViewportPoint(x, y)
  if (!element) throw new Error(`No element found at viewport coordinate ${x},${y}`)
  focusElement(element)
  dispatchPointerMouseSequence(element, x, y)
  return {
    clicked: true,
    x,
    y,
    element: describeElement(element),
  }
}

async function hoverElement(args) {
  const selector = String(args.selector || "").trim()
  let actionability = undefined
  let element
  if (selector) {
    const resolved = await resolveActionableSelector(selector, {
      timeoutMs: args.timeoutMs,
      action: "hover",
      requireEnabled: false,
      requireReceivesEvents: true,
    })
    if (!resolved.ok) return buildActionabilityFailureResult(selector, "hover", resolved)
    element = resolved.element
    actionability = buildActionabilitySummary(resolved)
  } else {
    element = resolveTargetElement(args)
  }
  if (!element) throw new Error("yunti_hover requires selector or x/y coordinates")
  element.scrollIntoView({ block: "center", inline: "center" })
  const rect = element.getBoundingClientRect()
  const x = Number.isFinite(Number(args.x)) ? Number(args.x) : rect.left + rect.width / 2
  const y = Number.isFinite(Number(args.y)) ? Number(args.y) : rect.top + rect.height / 2
  focusElement(element)
  dispatchHoverSequence(element, x, y)
  return {
    hovered: true,
    x: Math.round(x),
    y: Math.round(y),
    element: describeElement(element),
    ...(actionability ? { actionability } : {}),
  }
}

async function fillElement(args) {
  const selector = String(args.selector || "").trim()
  let actionability = undefined
  let element
  if (selector) {
    const resolved = await resolveActionableSelector(selector, {
      timeoutMs: args.timeoutMs,
      action: "fill",
      requireEditable: true,
      requireEnabled: true,
      requireReceivesEvents: true,
    })
    if (!resolved.ok) return buildActionabilityFailureResult(selector, "fill", resolved)
    element = resolved.element
    actionability = buildActionabilitySummary(resolved)
  } else {
    element = resolveTargetElement(args)
  }
  if (!element) throw new Error("yunti_fill requires selector or x/y coordinates")
  const value = String(args.value ?? "")
  element.scrollIntoView({ block: "center", inline: "center" })
  setEditableText(element, value, { replace: true })
  return {
    filled: true,
    element: describeElement(element),
    valueLength: value.length,
    valueApplied: getEditableText(element) === value,
    method: element.isContentEditable ? "contenteditable" : element instanceof HTMLSelectElement ? "select" : "dom",
    ...(actionability ? { actionability } : {}),
  }
}

async function typeText(args) {
  const text = String(args.text ?? "")
  let element
  if (args.selector) {
    const resolved = await resolveActionableSelector(String(args.selector), {
      timeoutMs: args.timeoutMs,
      action: "type_text",
      requireEditable: true,
      requireEnabled: true,
      requireReceivesEvents: true,
    })
    if (!resolved.ok) return buildActionabilityFailureResult(String(args.selector), "type_text", resolved)
    element = resolved.element
  } else {
    element = resolveTargetElement(args) || document.activeElement
  }
  if (!element || element === document.body || element === document.documentElement) {
    throw new Error("No editable target is focused; pass selector or x/y")
  }
  focusElement(element)
  setEditableText(element, text, { replace: Boolean(args.clear) })
  return {
    typed: true,
    element: describeElement(element),
    textLength: text.length,
    mode: args.clear ? "replace" : "append",
  }
}

async function pressKey(args) {
  const key = String(args.key || "")
  if (!key) throw new Error("key is required")
  let element
  if (args.selector) {
    const resolved = await resolveActionableSelector(String(args.selector), {
      timeoutMs: args.timeoutMs,
      action: "press_key",
      requireEnabled: true,
      requireReceivesEvents: true,
    })
    if (!resolved.ok) return buildActionabilityFailureResult(String(args.selector), "press_key", resolved)
    element = resolved.element
  } else {
    element = resolveTargetElement(args) || document.activeElement || document.body
  }
  focusElement(element)
  const beforeValue = getEditableText(element)
  dispatchKeyboardEvent(element, "keydown", key)
  applySimpleKeyEdit(element, key)
  dispatchKeyboardEvent(element, "keyup", key)
  const afterValue = getEditableText(element)
  return {
    pressed: true,
    key,
    element: describeElement(element),
    valueChanged: beforeValue !== afterValue,
  }
}

async function selectElement(args) {
  const selector = String(args.selector || "").trim()
  let actionability = undefined
  let element
  if (selector) {
    const resolved = await resolveActionableSelector(selector, {
      timeoutMs: args.timeoutMs,
      action: "select",
      requireEnabled: true,
      requireReceivesEvents: true,
      requireTag: "select",
    })
    if (!resolved.ok) return buildActionabilityFailureResult(selector, "select", resolved)
    element = resolved.element
    actionability = buildActionabilitySummary(resolved)
  } else {
    element = resolveTargetElement(args)
  }
  if (!element) throw new Error("yunti_select requires selector or x/y coordinates")
  if (!(element instanceof HTMLSelectElement)) throw new Error("Target is not a select element")
  const value = String(args.value ?? "")
  const text = String(args.text ?? "")
  const matchMode = text ? "text" : "value"
  const targetOption = text || value
  const options = Array.from(element.options)
  const option = options.find((item) => matchMode === "text" ? item.text.trim() === targetOption : item.value === targetOption)
  if (!option) {
    return {
      selected: false,
      element: describeElement(element),
      value: element.value,
      code: "OPTION_NOT_FOUND",
      error: matchMode === "text" ? "Option text not found" : "Option value not found",
      matchMode,
      targetOption,
      availableValues: options.map((item) => item.value).slice(0, 50),
      availableTexts: options.map((item) => item.text.trim()).slice(0, 50),
      options: summarizeSelectOptions(options),
      ...(actionability ? { actionability } : {}),
    }
  }
  if (option?.disabled) {
    return {
      selected: false,
      element: describeElement(element),
      value: element.value,
      code: "OPTION_DISABLED",
      error: matchMode === "text" ? "Option text is disabled" : "Option value is disabled",
      matchMode,
      targetOption,
      disabledValue: option.value,
      disabledText: option.text.trim(),
      availableValues: options.map((item) => item.value).slice(0, 50),
      availableTexts: options.map((item) => item.text.trim()).slice(0, 50),
      options: summarizeSelectOptions(options),
      ...(actionability ? { actionability } : {}),
    }
  }
  element.value = option.value
  element.dispatchEvent(new Event("input", { bubbles: true }))
  element.dispatchEvent(new Event("change", { bubbles: true }))
  return {
    selected: true,
    element: describeElement(element),
    value: element.value,
    text: option.text.trim(),
    selectedIndex: element.selectedIndex,
    ...(actionability ? { actionability } : {}),
  }
}

function scrollPage(args) {
  const deltaX = Number.isFinite(Number(args.deltaX)) ? Number(args.deltaX) : 0
  const deltaY = Number.isFinite(Number(args.deltaY)) ? Number(args.deltaY) : 600
  const hasCoordinateTarget = Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))
  const coordinateX = hasCoordinateTarget ? clamp(Number(args.x), 0, Math.max(0, window.innerWidth - 1)) : undefined
  const coordinateY = hasCoordinateTarget ? clamp(Number(args.y), 0, Math.max(0, window.innerHeight - 1)) : undefined
  const coordinateTarget =
    hasCoordinateTarget
      ? resolveElementFromViewportPoint(coordinateX, coordinateY)
      : null
  const scrollableAncestor = findScrollableAncestor(coordinateTarget)
  const target = scrollableAncestor || document.scrollingElement || document.documentElement
  const before = getScrollPosition(target)
  target.scrollBy({ left: deltaX, top: deltaY, behavior: "auto" })
  const after = getScrollPosition(target)
  return {
    scrolled: true,
    deltaX,
    deltaY,
    target: target === document.scrollingElement ? "document" : describeElement(target),
    ...(hasCoordinateTarget
      ? {
          coordinateTarget: {
            x: Math.round(coordinateX),
            y: Math.round(coordinateY),
            found: Boolean(coordinateTarget),
            ...(coordinateTarget ? { element: describeElement(coordinateTarget) } : {}),
          },
          scrollContainerFound: Boolean(scrollableAncestor),
          ...(scrollableAncestor ? {} : { coordinateScrollFallback: "document" }),
        }
      : {}),
    before,
    after,
  }
}

function requestUserConfirmation(args) {
  const approved = window.confirm(`${args.message || "Confirm agent action"}\n\n${args.detail || ""}`)
  return { approved }
}

async function resolveActionableSelector(selector, requirements = {}) {
  const timeoutMs = Number.isFinite(Number(requirements.timeoutMs))
    ? Math.max(0, Math.min(5000, Number(requirements.timeoutMs)))
    : DEFAULT_ACTIONABILITY_TIMEOUT_MS
  const startTime = Date.now()
  let lastFailure = {
    ok: false,
    code: "ELEMENT_NOT_FOUND",
    error: `Element not found: ${selector}`,
  }

  while (Date.now() - startTime <= timeoutMs) {
    const element = document.querySelector(selector)
    const evaluation = evaluateActionability(element, selector, requirements)
    if (evaluation.ok) {
      evaluation.waitedMs = Date.now() - startTime
      return evaluation
    }
    lastFailure = evaluation
    if (!evaluation.retryable) break
    await delay(ACTIONABILITY_POLL_INTERVAL_MS)
  }

  return {
    ...lastFailure,
    waitedMs: Math.min(timeoutMs, Date.now() - startTime),
  }
}

function evaluateActionability(element, selector, requirements = {}) {
  if (!element) {
    return {
      ok: false,
      code: "ELEMENT_NOT_FOUND",
      error: `Element not found: ${selector}`,
      retryable: true,
    }
  }

  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  const hidden = Boolean(
    element.hidden ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0 ||
      rect.width <= 0 ||
      rect.height <= 0
  )
  if (hidden) {
    return {
      ok: false,
      code: "TARGET_HIDDEN",
      error: `Target element is hidden or has no size: ${selector}`,
      retryable: true,
    }
  }

  if (requirements.requireTag) {
    const actualTag = String(element.tagName || "").toLowerCase()
    if (actualTag !== String(requirements.requireTag).toLowerCase()) {
      return {
        ok: false,
        code: "TARGET_WRONG_TAG",
        error: `Target element is not a ${requirements.requireTag}: ${selector}`,
        retryable: false,
      }
    }
  }

  const disabled = Boolean(element.disabled || element.getAttribute("aria-disabled") === "true")
  if (requirements.requireEnabled && disabled) {
    return {
      ok: false,
      code: "TARGET_DISABLED",
      error: `Target element is disabled: ${selector}`,
      retryable: true,
    }
  }

  const readOnly = Boolean(element.readOnly || element.getAttribute("aria-readonly") === "true")
  if (requirements.requireEditable) {
    const editability = evaluateEditability(element)
    if (!editability.ok) {
      return {
        ok: false,
        code: editability.code,
        error: editability.error,
        retryable: editability.retryable,
      }
    }
    if (readOnly) {
      return {
        ok: false,
        code: "TARGET_READONLY",
        error: `Target element is readonly: ${selector}`,
        retryable: true,
      }
    }
  }

  if (requirements.requireReceivesEvents) {
    const centerX = clamp(rect.left + rect.width / 2, 0, Math.max(0, window.innerWidth - 1))
    const centerY = clamp(rect.top + rect.height / 2, 0, Math.max(0, window.innerHeight - 1))
    const hit = resolveElementFromViewportPoint(centerX, centerY)
    if (hit && hit !== element && !element.contains?.(hit)) {
      return {
        ok: false,
        code: "TARGET_OBSCURED",
        error: `Target element is not receiving pointer events at its center: ${selector}`,
        retryable: true,
      }
    }
  }

  return {
    ok: true,
    element,
  }
}

function evaluateEditability(element) {
  if (!element) {
    return {
      ok: false,
      code: "TARGET_NOT_EDITABLE",
      error: "No editable target is focused",
      retryable: true,
    }
  }
  const tag = element.tagName.toLowerCase()
  const type = String(element.type || "").toLowerCase()
  if (element.isContentEditable) return { ok: true }
  if ("value" in element) {
    if (tag === "input" && ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type)) {
      return {
        ok: false,
        code: "TARGET_NOT_EDITABLE",
        error: `Target input type ${type} is not editable`,
        retryable: false,
      }
    }
    return { ok: true }
  }
  return {
    ok: false,
    code: "TARGET_NOT_EDITABLE",
    error: "Target element is not editable",
    retryable: false,
  }
}

function buildActionabilitySummary(result = {}) {
  return {
    waitedMs: Math.max(0, Number(result.waitedMs || 0)),
    checks: ["visible", "enabled", "receives-events"],
  }
}

function buildActionabilityFailureResult(selector, action, result = {}) {
  const reason = String(result.code || "ACTIONABILITY_FAILED")
  const retryable = result.retryable !== false
  const field = action === "click" ? "clicked"
    : action === "hover" ? "hovered"
    : action === "fill" ? "filled"
    : action === "select" ? "selected"
    : action === "type_text" ? "typed"
    : action === "press_key" ? "pressed"
    : action
  return {
    [field]: false,
    selector,
    code: reason,
    error: result.error || `Selector ${action} failed`,
    actionability: {
      waitedMs: Math.max(0, Number(result.waitedMs || 0)),
      retryable,
    },
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveTargetElement(args = {}) {
  if (args.selector) return mustFind(args.selector)
  if (Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))) {
    return resolveElementFromViewportPoint(
      clamp(Number(args.x), 0, Math.max(0, window.innerWidth - 1)),
      clamp(Number(args.y), 0, Math.max(0, window.innerHeight - 1))
    )
  }
  return null
}

function resolveElementFromViewportPoint(x, y, rootDocument = document) {
  const root = rootDocument || document
  const hit = typeof root.elementFromPoint === "function" ? root.elementFromPoint(x, y) : null
  if (!hit) return null
  if (hit.shadowRoot && typeof hit.shadowRoot.elementFromPoint === "function") {
    const shadowHit = resolveElementFromViewportPoint(x, y, hit.shadowRoot)
    if (shadowHit && shadowHit !== hit) return shadowHit
  }
  const frameDocument = getSameOriginFrameDocument(hit)
  if (!frameDocument) return hit
  const frameRect = hit.getBoundingClientRect()
  const childX = clamp(x - frameRect.left, 0, Math.max(0, frameRect.width - 1))
  const childY = clamp(y - frameRect.top, 0, Math.max(0, frameRect.height - 1))
  return resolveElementFromViewportPoint(childX, childY, frameDocument) || hit
}

function getSameOriginFrameDocument(element) {
  if (!element || element.tagName?.toLowerCase?.() !== "iframe") return null
  try {
    const frameDocument = element.contentDocument || element.contentWindow?.document || null
    return typeof frameDocument?.elementFromPoint === "function" ? frameDocument : null
  } catch {
    return null
  }
}

function summarizeSelectOptions(options) {
  return options.slice(0, 50).map((item) => ({
    value: item.value,
    text: item.text.trim(),
    disabled: Boolean(item.disabled),
    selected: Boolean(item.selected),
  }))
}

function focusElement(element) {
  if (element && typeof element.focus === "function") {
    element.focus({ preventScroll: true })
  }
}

function dispatchPointerMouseSequence(element, x, y) {
  const common = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    view: window,
  }
  for (const type of ["pointerover", "pointermove", "pointerdown", "pointerup"]) {
    try {
      element.dispatchEvent(new PointerEvent(type, { ...common, pointerType: "mouse", isPrimary: true }))
    } catch {
      break
    }
  }
  for (const type of ["mouseover", "mousemove", "mousedown", "mouseup", "click"]) {
    element.dispatchEvent(new MouseEvent(type, common))
  }
}

function dispatchHoverSequence(element, x, y) {
  const common = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    view: window,
  }
  for (const type of ["pointerover", "pointerenter", "pointermove"]) {
    try {
      element.dispatchEvent(new PointerEvent(type, { ...common, pointerType: "mouse", isPrimary: true }))
    } catch {
      break
    }
  }
  for (const type of ["mouseover", "mouseenter", "mousemove"]) {
    element.dispatchEvent(new MouseEvent(type, common))
  }
}

function setEditableText(element, text, options = {}) {
  assertEditableTarget(element)
  if (element.isContentEditable) {
    const next = options.replace ? text : `${element.textContent || ""}${text}`
    element.textContent = next
  } else if ("value" in element) {
    const previous = String(element.value || "")
    const next = options.replace ? text : `${previous}${text}`
    setNativeValue(element, next)
  } else {
    throw new Error("Target element cannot accept text")
  }
  element.dispatchEvent(new Event("input", { bubbles: true }))
  element.dispatchEvent(new Event("change", { bubbles: true }))
}

function assertEditableTarget(element) {
  if (!element) throw new Error("No editable target is focused")
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  const tag = element.tagName.toLowerCase()
  const type = String(element.type || "").toLowerCase()
  if (element.hidden || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || rect.width <= 0 || rect.height <= 0) {
    throw new Error("Target element is hidden or has no size")
  }
  if (element.disabled || element.getAttribute("aria-disabled") === "true") {
    throw new Error("Target element is disabled")
  }
  if (element.readOnly || element.getAttribute("aria-readonly") === "true") {
    throw new Error("Target element is readonly")
  }
  if (element.isContentEditable) return
  if ("value" in element) {
    if (tag === "input" && ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type)) {
      throw new Error(`Target input type ${type} is not editable`)
    }
    return
  }
  throw new Error("Target element is not editable")
}

function setNativeValue(element, value) {
  const prototype = Object.getPrototypeOf(element)
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value")
  if (descriptor?.set) descriptor.set.call(element, value)
  else element.value = value
}

function getEditableText(element) {
  if (!element) return ""
  if (element.isContentEditable) return element.textContent || ""
  if ("value" in element) return String(element.value || "")
  return ""
}

function dispatchKeyboardEvent(element, type, key) {
  element.dispatchEvent(
    new KeyboardEvent(type, {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  )
}

function applySimpleKeyEdit(element, key) {
  if (key === "Backspace") {
    const current = getEditableText(element)
    if (current) setEditableText(element, current.slice(0, -1), { replace: true })
  }
  if (key === "Enter" && element instanceof HTMLTextAreaElement) {
    setEditableText(element, "\n")
  }
}

function findScrollableAncestor(element) {
  let node = element
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node)
    const scrollableY = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight
    const scrollableX = /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth
    if (scrollableY || scrollableX) return node
    node = node.parentElement
  }
  return null
}

function getScrollPosition(element) {
  return {
    left: Math.round(element.scrollLeft || 0),
    top: Math.round(element.scrollTop || 0),
  }
}

function insertTemporaryHtml(target, position, html, patchId) {
  const template = document.createElement("template")
  template.innerHTML = html
  const nodes = [...template.content.childNodes].map((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      node.setAttribute(PATCH_ATTR, patchId)
      node.classList.add("yunti-browser-runtime-highlight")
      return node
    }
    const span = document.createElement("span")
    span.setAttribute(PATCH_ATTR, patchId)
    span.className = "yunti-browser-runtime-highlight"
    span.textContent = node.textContent || ""
    return span
  })

  if (position === "beforeend") target.append(...nodes)
  else if (position === "beforebegin") target.before(...nodes)
  else if (position === "afterend") target.after(...nodes)
  else throw new Error(`Unsupported insert position: ${position}`)

  return nodes
}

function collectVisibleText(maxTextLength) {
  if (maxTextLength <= 0) return ""
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue?.replace(/\s+/g, " ").trim()
      if (!text) return NodeFilter.FILTER_REJECT
      return isVisible(node.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  let out = ""
  while (walker.nextNode() && out.length < maxTextLength) {
    out += `${walker.currentNode.nodeValue.replace(/\s+/g, " ").trim()}\n`
  }
  return out.slice(0, maxTextLength)
}

function getPageOverview() {
  const visibleButtons = [...document.querySelectorAll("button,input[type=button],input[type=submit]")]
    .filter(isVisible)
    .slice(0, 20)
    .map((element) => compactText(element.innerText || element.value || element.getAttribute("aria-label") || ""))
    .filter(Boolean)
  const visibleInputs = [...document.querySelectorAll("input,textarea,select,[contenteditable=true]")]
    .filter(isVisible)
    .slice(0, 20)
    .map((element) => ({
      type: element.type || element.tagName.toLowerCase(),
      name: element.getAttribute("name"),
      placeholder: element.getAttribute("placeholder"),
      label: findLabel(element),
    }))
  return {
    heading: compactText(document.querySelector("h1,h2,h3,[role=heading]")?.innerText || ""),
    path: location.hash || location.pathname,
    counts: {
      forms: document.forms.length,
      buttons: [...document.querySelectorAll("button,input[type=button],input[type=submit]")].filter(isVisible)
        .length,
      links: [...document.querySelectorAll("a[href]")].filter(isVisible).length,
      inputs: [...document.querySelectorAll("input,textarea,select,[contenteditable=true]")].filter(isVisible)
        .length,
      tables: [...document.querySelectorAll("table")].filter(isVisible).length,
    },
    sampleButtons: visibleButtons,
    sampleInputs: visibleInputs,
  }
}

function describeForm(form) {
  return {
    selector: cssPath(form),
    id: form.id || null,
    name: form.getAttribute("name"),
    action: form.action || null,
    method: form.method || null,
    fields: [...form.querySelectorAll("input,textarea,select")]
      .filter(isVisible)
      .slice(0, 80)
      .map(describeInput),
  }
}

function describeClickable(element) {
  return {
    ...describeElement(element),
    text: compactText(element.innerText || element.value || element.getAttribute("title") || ""),
    href: element.href || null,
  }
}

function describeInput(element) {
  return {
    ...describeElement(element),
    type: element.type || element.tagName.toLowerCase(),
    name: element.getAttribute("name"),
    placeholder: element.getAttribute("placeholder"),
    label: findLabel(element),
    valuePreview: "value" in element ? String(element.value || "").slice(0, 80) : null,
  }
}

function describeTable(table) {
  const headers = [...table.querySelectorAll("th")].slice(0, 30).map((th) => compactText(th.innerText))
  const rows = [...table.querySelectorAll("tr")]
    .slice(0, 5)
    .map((tr) => [...tr.children].slice(0, 10).map((td) => compactText(td.innerText)))
  return { selector: cssPath(table), headers, rows }
}

function describeElement(element) {
  return {
    selector: cssPath(element),
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    className: element.className || null,
    text: compactText(element.innerText || element.textContent || ""),
  }
}

function findLabel(element) {
  if (element.id) {
    const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
    if (label) return compactText(label.innerText)
  }
  return compactText(element.closest("label")?.innerText || "")
}

function compactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 160) || null
}

function mustFind(selector) {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`Element not found: ${selector}`)
  return element
}

function snapshotElement(element) {
  return {
    element,
    html: element.innerHTML,
    text: element.textContent,
    value: "value" in element ? element.value : undefined,
    className: element.className,
    style: element.getAttribute("style"),
    attrs: [...element.attributes].map((attr) => [attr.name, attr.value]),
  }
}

function restoreElement(record) {
  for (const node of record.inserted || []) node.remove()
  const element = record.element
  if (!element?.isConnected) return
  while (element.attributes.length) element.removeAttribute(element.attributes[0].name)
  for (const [name, value] of record.attrs) element.setAttribute(name, value)
  element.innerHTML = record.html
  if (record.value !== undefined && "value" in element) element.value = record.value
  if (record.style === null) element.removeAttribute("style")
  else element.setAttribute("style", record.style)
  element.className = record.className
}

function isVisible(element) {
  if (!element) return false
  const style = getComputedStyle(element)
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return false
  }
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function cssPath(element) {
  if (element.id) return `#${CSS.escape(element.id)}`
  const parts = []
  let node = element
  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
    let part = node.tagName.toLowerCase()
    const parent = node.parentElement
    if (parent) {
      const same = [...parent.children].filter((child) => child.tagName === node.tagName)
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`
    }
    parts.unshift(part)
    node = parent
  }
  return parts.length ? parts.join(" > ") : "body"
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

})(globalThis)
