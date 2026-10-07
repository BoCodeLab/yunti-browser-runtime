// Regression coverage for the extension-side optimization round:
//   1. yunti_click bails out with a structured result when a native modal opens
//   2. yunti_handle_dialog treats "No dialog is showing" as a successful no-op
//   3. yunti_take_screenshot capture diagnostics (empty capture + total failure)
//   4. capture-filter metadata on empty console/network results
//   5. controller per-tool watchdog frees the lane
//   6. YUNTI_TAB_BUSY fast fail for a queued same-tab request
//   7. throttled /sessions/register heartbeat across poll cycles
//   8. CDP command timeout rejects and forces a re-attach
//
// Every test installs its own chrome/fetch mocks and restores them in a
// finally block, so the file can run next to the other extension tests.
import test from "node:test"
import assert from "node:assert/strict"
import { createCdpController } from "../extension/cdp.js"
import { createSessionManager as createRuntimeSessionManager } from "../extension/session-manager.js"
import { invalidateSettingsCache } from "../extension/settings.js"
import { createToolDispatcher } from "../extension/tool-handlers.js"

const PAGE_SESSION = {
  browserSessionId: "tab-1",
  userId: "local",
  url: "https://example.test/",
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs = 500, intervalMs = 5) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = predicate()
    if (value) return value
    if (Date.now() >= deadline) return null
    await sleep(intervalMs)
  }
}

// ---------------------------------------------------------------------------
// Dispatcher harness (cdp stub extended with the dialog-watch surface that
// tool-handlers.js now uses).
// ---------------------------------------------------------------------------
function createDispatcherHarness(options = {}) {
  const posted = []
  const sentMessages = []
  const cdpCommands = []
  const waitForDialogCalls = []
  const dialogStateReads = []
  const clearedDialogTabs = []
  const tabUpdatedListeners = new Set()
  const contentToolResponses = options.contentToolResponses || {}
  const previousChrome = globalThis.chrome

  globalThis.chrome = {
    tabs: {
      create: async () =>
        options.createdTab || {
          id: 999,
          windowId: 1,
          url: "https://example.test/created",
          title: "Created",
          status: "complete",
        },
      get: async (tabId) => options.tabsById?.[tabId] || null,
      query: async () => (options.activeTab ? [options.activeTab] : []),
      captureVisibleTab: async () => {
        if (typeof options.captureVisibleTab === "function") {
          return options.captureVisibleTab()
        }
        throw new Error(options.captureVisibleTabError || "activeTab permission unavailable")
      },
      sendMessage: async (tabId, message) => {
        sentMessages.push({ tabId, message })
        if (typeof options.sendMessage === "function") {
          return options.sendMessage(tabId, message)
        }
        if (Object.prototype.hasOwnProperty.call(contentToolResponses, message.tool)) {
          const response = contentToolResponses[message.tool]
          return typeof response === "function" ? response(message) : response
        }
        throw new Error(`unexpected content message: ${message.tool}`)
      },
      onUpdated: {
        addListener: (listener) => tabUpdatedListeners.add(listener),
        removeListener: (listener) => tabUpdatedListeners.delete(listener),
      },
    },
  }

  const dispatcher = createToolDispatcher({
    sessionsByTab: new Map(),
    postBridge: async (_path, body) => {
      posted.push(body)
    },
    ensureTabRegistered: async () => ({ ok: true, registered: true, session: null }),
    getPlatformMatches: options.getPlatformMatches || null,
    getCaptureDiagnostics: options.getCaptureDiagnostics || null,
    cdp: {
      chromeDebuggerSendCommand: async (target, method, params) => {
        cdpCommands.push({ target, method, params })
        if (typeof options.chromeDebuggerSendCommand === "function") {
          return options.chromeDebuggerSendCommand(target, method, params)
        }
        return {}
      },
      delayCdp: async () => {},
      detachCdpTab: async () => ({}),
      ensureCdpAttached: async () => {},
      getBrowserTarget: async () => ({}),
      listBrowserTargets: async () => ({}),
      sendCdpCommand: async () => ({}),
      startPerformanceTrace: async () => ({}),
      stopPerformanceTrace: async () => ({}),
      waitForDialogOpen: async (tabId, waitMs) => {
        waitForDialogCalls.push({ tabId, waitMs })
        if (typeof options.waitForDialogOpen === "function") {
          return options.waitForDialogOpen(tabId, waitMs)
        }
        return null
      },
      dialogState: (tabId) => {
        dialogStateReads.push(tabId)
        return typeof options.dialogState === "function" ? options.dialogState(tabId) : null
      },
      clearDialogState: (tabId) => {
        clearedDialogTabs.push(tabId)
      },
      ...(options.cdp || {}),
    },
  })

  return {
    cdpCommands,
    clearedDialogTabs,
    dialogStateReads,
    dispatcher,
    posted,
    sentMessages,
    waitForDialogCalls,
    restore() {
      tabUpdatedListeners.clear()
      globalThis.chrome = previousChrome
    },
  }
}

// ---------------------------------------------------------------------------
// Session-manager harness (chrome + fetch mocks, records bridge requests).
// ---------------------------------------------------------------------------
const testManagers = new Set()

function createSessionManager(options) {
  const manager = createRuntimeSessionManager(options)
  testManagers.add(manager)
  return manager
}

function installSessionManagerChromeMock(options = {}) {
  const tabs = options.tabs || []
  const requests = []
  const stored = { ...(options.storage || {}) }
  const pollEvents = [...(options.pollEvents || [])]
  const reachableTabs = new Set(options.reachableTabs || [])
  let pollCount = 0
  const previousChrome = globalThis.chrome
  const previousFetch = globalThis.fetch
  // The settings snapshot is cached per service worker; drop it so each mocked
  // test starts from its own storage instead of a previous test's snapshot.
  invalidateSettingsCache()
  globalThis.fetch = async (url, init = {}) => {
    requests.push({
      url: String(url),
      method: init.method || "GET",
      body: init.body ? JSON.parse(init.body) : null,
    })
    if (String(url).includes("/extension/poll")) {
      pollCount += 1
      if (typeof options.onPoll === "function") {
        // Snapshot hook: fires synchronously while the Nth long poll is served,
        // before the poll loop can schedule any follow-up work.
        options.onPoll({ pollCount, requests })
      }
      if (pollEvents.length > 0) {
        const event = pollEvents.shift()
        return { ok: true, json: async () => event }
      }
      return new Promise((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        })
      })
    }
    return { ok: true, json: async () => ({ ok: true }) }
  }
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: "0.2.7" }),
    },
    storage: {
      local: {
        get: async () => ({
          bridgeUrl: "http://127.0.0.1:48887",
          bridgeToken: "",
          localUserName: "local",
          localUserId: "local",
          platformMatches: ["*"],
          ...stored,
        }),
        set: async (patch) => {
          Object.assign(stored, patch)
        },
      },
    },
    tabs: {
      query: async (query = {}) => {
        if (query.active) {
          return tabs.filter(
            (tab) => tab.active && (!query.windowId || tab.windowId === query.windowId)
          )
        }
        return tabs
      },
      get: async (tabId) => {
        const tab = tabs.find((item) => item.id === tabId)
        if (!tab) throw new Error(`No tab ${tabId}`)
        return tab
      },
      sendMessage: async (tabId) => {
        if (!reachableTabs.has(tabId)) throw new Error("Could not establish connection")
        return { ok: true }
      },
      update: async (tabId, patch) => tabs.find((tab) => tab.id === tabId) || patch,
    },
    scripting: {
      insertCSS: async () => {},
      executeScript: async () => {},
    },
  }
  return {
    requests,
    stored,
    countRequests(needle) {
      return requests.filter((request) => request.url.includes(needle)).length
    },
    restore() {
      for (const manager of testManagers) manager.stop()
      testManagers.clear()
      globalThis.chrome = previousChrome
      globalThis.fetch = previousFetch
      invalidateSettingsCache()
    },
  }
}

function bridgeResultFor(requests, requestId) {
  return requests.find(
    (request) =>
      request.url.endsWith("/extension/result") && request.body?.requestId === requestId
  )
}

// ---------------------------------------------------------------------------
// 1. Dialog bail-out during yunti_click
// ---------------------------------------------------------------------------
// tool-handlers.js races the tool dispatch against the CDP dialog signal
// (dispatchWithDialogWatch): the dialog signal wins as soon as the renderer is
// frozen, while a tool that answers normally keeps its own result.
test("a frozen renderer answers yunti_click with a structured dialog result", async () => {
  const dialog = { type: "alert", message: "x", openedAt: "2026-09-27T00:00:00.000Z" }
  const harness = createDispatcherHarness({
    // The modal froze the renderer's JS thread, so the content-script
    // completion message never arrives.
    sendMessage: () => new Promise(() => {}),
    waitForDialogOpen: async () => {
      // The CDP Page.javascriptDialogOpening signal lands ~40ms later.
      await sleep(40)
      return dialog
    },
  })
  try {
    const started = Date.now()
    await harness.dispatcher.executeToolRequest(123, PAGE_SESSION, {
      id: "req-dialog-frozen",
      tool: "yunti_click",
      arguments: { x: 5, y: 6 },
    })
    const elapsedMs = Date.now() - started
    const call = harness.posted.at(-1)

    assert.equal(call.ok, true)
    assert.equal(call.requestId, "req-dialog-frozen")
    assert.equal(call.result.dialogOpened, true)
    assert.equal(call.result.dialog.type, "alert")
    assert.equal(call.result.dialog.hasMessage, true)
    assert.equal(call.result.dialog.openedAt, dialog.openedAt)
    assert.equal(call.result.resultUncertain, true)
    assert.equal(call.result.recoverable, true)
    assert.equal(call.result.recoveryHint.nextAction, "handle-then-observe")
    assert.equal(call.result.recoveryHint.reason, "native-dialog-open")
    assert.ok(call.result.recoveryHint.recommendedTools.includes("yunti_handle_dialog"))
    assert.match(call.result.nextStepHint, /yunti_handle_dialog/)
    // The click really was dispatched before the renderer froze.
    assert.deepEqual(
      harness.sentMessages.map((item) => item.message.tool),
      ["yunti_click"]
    )
    assert.deepEqual(harness.waitForDialogCalls, [{ tabId: 123, waitMs: 3_000 }])
    // The whole point of the optimization: answer far below the 12s watchdog /
    // 25s tool budget instead of waiting for a frozen renderer.
    assert.ok(
      elapsedMs < 1_500,
      `dialog result must return well before the 12s watchdog, got ${elapsedMs}ms`
    )
  } finally {
    harness.restore()
  }
})

test("a slow click without a dialog keeps its own result", async () => {
  const harness = createDispatcherHarness({
    sendMessage: async () => {
      // Just past DIALOG_SLOW_AFTER_MS (500ms) but still bounded.
      await sleep(560)
      return { clicked: true, x: 7, y: 8 }
    },
    // A background tab never reports a dialog for this interaction.
    waitForDialogOpen: async () => {
      await sleep(40)
      return null
    },
  })
  try {
    const started = Date.now()
    await harness.dispatcher.executeToolRequest(123, PAGE_SESSION, {
      id: "req-slow-click",
      tool: "yunti_click",
      arguments: { x: 7, y: 8 },
    })
    const elapsedMs = Date.now() - started
    const call = harness.posted.at(-1)

    assert.equal(call.ok, true)
    assert.equal(call.result.clicked, true)
    assert.equal(call.result.dialogOpened, undefined)
    // The dialog watch must not add its own 3s budget on top of a slow call.
    assert.ok(
      elapsedMs < 1_500,
      `slow click must still return its own result, got ${elapsedMs}ms`
    )
  } finally {
    harness.restore()
  }
})

test("a fast click is not delayed by the dialog watch", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_click: { clicked: true, x: 5, y: 6 },
    },
    waitForDialogOpen: async () => {
      await sleep(40)
      return { type: "alert", message: "x", openedAt: "2026-09-27T00:00:00.000Z" }
    },
  })
  try {
    const started = Date.now()
    await harness.dispatcher.executeToolRequest(123, PAGE_SESSION, {
      id: "req-fast-click",
      tool: "yunti_click",
      arguments: { x: 5, y: 6 },
    })
    const elapsedMs = Date.now() - started
    const call = harness.posted.at(-1)

    // The click completed before the dialog signal, so the normal result wins:
    // the optimization must never charge fast tools the dialog wait.
    assert.equal(call.ok, true)
    assert.equal(call.result.clicked, true)
    assert.equal(call.result.dialogOpened, undefined)
    assert.equal(call.result.resultUncertain, undefined)
    assert.ok(
      elapsedMs < 500,
      `fast clicks must not pay for the dialog watch, got ${elapsedMs}ms`
    )
  } finally {
    harness.restore()
  }
})

// ---------------------------------------------------------------------------
// 2. yunti_handle_dialog NO_DIALOG no-op
// ---------------------------------------------------------------------------
test("yunti_handle_dialog reports NO_DIALOG as a successful no-op", async () => {
  const harness = createDispatcherHarness({
    chromeDebuggerSendCommand: async (_target, method) => {
      if (method === "Page.handleJavaScriptDialog") {
        // Mirrors chrome.runtime.lastError surfacing through the CDP callback.
        throw new Error("No dialog is showing")
      }
      return {}
    },
    dialogState: () => null,
  })
  try {
    await harness.dispatcher.executeToolRequest(123, PAGE_SESSION, {
      id: "req-no-dialog",
      tool: "yunti_handle_dialog",
      arguments: { action: "accept" },
    })
    const call = harness.posted.at(-1)

    // The tool call itself succeeded: agents must not see an isError for
    // "nothing to handle".
    assert.equal(call.ok, true)
    assert.equal(call.error, null)
    assert.equal(call.result.handled, false)
    assert.equal(call.result.code, "NO_DIALOG")
    assert.equal(call.result.reason, "no_dialog_open")
    assert.equal(call.result.ok, true)
    assert.equal(call.result.recoverable, false)
    assert.equal(call.result.action, "accept")
    assert.deepEqual(harness.dialogStateReads, [123])
    assert.deepEqual(harness.clearedDialogTabs, [123])
    assert.deepEqual(
      harness.cdpCommands.map((command) => command.method),
      ["Page.handleJavaScriptDialog"]
    )
    assert.deepEqual(harness.cdpCommands[0].params, { accept: true, promptText: "" })
  } finally {
    harness.restore()
  }
})

test("yunti_handle_dialog keeps a real handler failure recoverable", async () => {
  const harness = createDispatcherHarness({
    chromeDebuggerSendCommand: async (_target, method) => {
      if (method === "Page.handleJavaScriptDialog") {
        throw new Error("Debugger is not attached to the tab")
      }
      return {}
    },
    dialogState: (tabId) => ({ type: "confirm", message: "sure?", openedAt: "x", tabId }),
  })
  try {
    await harness.dispatcher.executeToolRequest(123, PAGE_SESSION, {
      id: "req-dialog-not-handled",
      tool: "yunti_handle_dialog",
      arguments: { action: "dismiss" },
    })
    const call = harness.posted.at(-1)

    assert.equal(call.result.handled, false)
    assert.equal(call.result.code, "DIALOG_NOT_HANDLED")
    assert.equal(call.result.ok, false)
    assert.equal(call.result.recoverable, true)
    assert.equal(call.result.failedStage, "Page.handleJavaScriptDialog")
    assert.equal(call.result.recoveryHint.nextAction, "verify_page_state_then_retry")
    // A failed handle must not drop the known dialog state.
    assert.deepEqual(harness.clearedDialogTabs, [])
  } finally {
    harness.restore()
  }
})

// ---------------------------------------------------------------------------
// 3. yunti_take_screenshot capture diagnostics
// ---------------------------------------------------------------------------
test("yunti_take_screenshot flags an empty CDP capture with byte diagnostics", async () => {
  const harness = createDispatcherHarness({
    chromeDebuggerSendCommand: async (_target, method) => {
      if (method === "Page.captureScreenshot") return { data: "" }
      return {}
    },
  })
  try {
    await harness.dispatcher.executeToolRequest(123, PAGE_SESSION, {
      id: "req-empty-shot",
      tool: "yunti_take_screenshot",
      arguments: { format: "png" },
    })
    const call = harness.posted.at(-1)
    const result = call.result

    assert.equal(call.ok, true)
    assert.equal(result.captureEmpty, true)
    assert.equal(typeof result.imageBytes, "number")
    assert.equal(result.imageBytes, 0)
    assert.equal(result.method, "cdp.Page.captureScreenshot")
    assert.equal(result.mimeType, "image/png")
    assert.equal(result.dataUrl, "data:image/png;base64,")
    assert.match(result.captureWarning, /empty or implausibly small/)
    assert.deepEqual(
      harness.cdpCommands.map((command) => command.method),
      ["Page.captureScreenshot"]
    )
  } finally {
    harness.restore()
  }
})

test("yunti_take_screenshot surfaces SCREENSHOT_FAILED when both capture paths fail", async () => {
  const harness = createDispatcherHarness({
    chromeDebuggerSendCommand: async (_target, method) => {
      if (method === "Page.captureScreenshot") {
        throw new Error("Page.captureScreenshot stalled on a throttled renderer")
      }
      return {}
    },
    captureVisibleTab: () => {
      throw new Error("activeTab permission denied")
    },
  })
  try {
    await harness.dispatcher.executeToolRequest(123, PAGE_SESSION, {
      id: "req-failed-shot",
      tool: "yunti_take_screenshot",
      arguments: { format: "png" },
    })
    const call = harness.posted.at(-1)
    const result = call.result

    assert.equal(result.code, "SCREENSHOT_FAILED")
    assert.equal(result.failedStage, "cdp.Page.captureScreenshot")
    assert.equal(result.recoverable, true)
    assert.equal(result.recoveryHint.nextAction, "activate-tab-then-retry")
    assert.equal(
      result.recoveryHint.reason,
      "screenshot-capture-failed"
    )
    assert.match(result.recoveryHint.message, /stalled on a throttled renderer/)
    assert.match(result.nextStepHint, /background or throttled tab/)
    // A failed capture must never be shaped like a delivered screenshot.
    assert.equal(result.dataUrl, undefined)
    assert.notEqual(result.ok, true)
    assert.equal(result.captureEmpty, undefined)
  } finally {
    harness.restore()
  }
})

// ---------------------------------------------------------------------------
// 4. Capture-filter metadata on empty console/network results
// ---------------------------------------------------------------------------
test("empty console capture explains an active platformMatches filter", async () => {
  const harness = createDispatcherHarness({
    getPlatformMatches: () => ["example.com"],
    getCaptureDiagnostics: () => ({ delivered: 0, dropped: 2, pending: 0 }),
    contentToolResponses: {
      yunti_list_console_messages: (message) =>
        message.arguments?.scenario === "empty"
          ? { messages: [], returned: 0, total: 0 }
          : { messages: [{ level: "error", text: "boom" }], returned: 1, total: 1 },
    },
  })
  try {
    await harness.dispatcher.executeToolRequest(123, PAGE_SESSION, {
      id: "req-console-empty",
      tool: "yunti_list_console_messages",
      arguments: { scenario: "empty" },
    })
    const empty = harness.posted.at(-1).result

    assert.equal(empty.captureFilters.filterActive, true)
    assert.deepEqual(empty.captureFilters.platformMatches, ["example.com"])
    assert.match(empty.captureFilters.hint, /platformMatches/)
    assert.deepEqual(empty.captureFilters.bridgeDelivery, {
      delivered: 0,
      dropped: 2,
      pending: 0,
    })
    assert.equal(empty.code, "NO_CAPTURED_EVENTS")
    assert.equal(empty.recoverable, true)
    assert.equal(empty.recoveryHint.reason, "capture-filtered-by-platform-matches")
    assert.equal(empty.recoveryHint.nextAction, "adjust-platform-matches-or-pick-listed-host")
    assert.match(empty.recoveryHint.message, /example\.com/)
    assert.match(empty.nextStepHint, /capture filter is active/)

    // A non-empty result keeps the metadata but must not be reported as a
    // filter miss.
    await harness.dispatcher.executeToolRequest(123, PAGE_SESSION, {
      id: "req-console-filled",
      tool: "yunti_list_console_messages",
      arguments: { scenario: "filled" },
    })
    const filled = harness.posted.at(-1).result
    assert.equal(filled.captureFilters.filterActive, true)
    assert.equal(filled.code, undefined)
    assert.equal(filled.recoveryHint, undefined)
    assert.equal(filled.returned, 1)
  } finally {
    harness.restore()
  }
})

test("wildcard platformMatches never reports NO_CAPTURED_EVENTS", async () => {
  const harness = createDispatcherHarness({
    getPlatformMatches: () => ["*"],
    contentToolResponses: {
      yunti_list_network_requests: { requests: [], returned: 0 },
    },
  })
  try {
    await harness.dispatcher.executeToolRequest(123, PAGE_SESSION, {
      id: "req-network-empty",
      tool: "yunti_list_network_requests",
      arguments: {},
    })
    const result = harness.posted.at(-1).result

    assert.equal(result.captureFilters.filterActive, false)
    assert.deepEqual(result.captureFilters.platformMatches, ["*"])
    assert.equal(result.captureFilters.hint, undefined)
    assert.equal(result.captureFilters.bridgeDelivery, undefined)
    assert.equal(result.code, undefined)
    assert.equal(result.recoveryHint, undefined)
    assert.equal(result.nextStepHint, undefined)
  } finally {
    harness.restore()
  }
})

// ---------------------------------------------------------------------------
// 5. Controller per-tool watchdog
// ---------------------------------------------------------------------------
test("controller watchdog answers a never-settling tool and frees the lane", async () => {
  const started = []
  const mock = installSessionManagerChromeMock({
    pollEvents: [
      {
        type: "tool_request",
        id: "hung-observe",
        tool: "yunti_observe_page",
        route: { tabId: 1 },
        deadlineAt: Date.now() + 60_000,
      },
      {
        type: "tool_request",
        id: "next-observe",
        tool: "yunti_observe_page",
        route: { tabId: 1 },
        deadlineAt: Date.now() + 60_000,
      },
    ],
  })
  try {
    const manager = createSessionManager({
      controllerToolTimeoutMs: 60_000,
      controllerToolWatchdogMs: 60,
    })
    manager.setToolRequestHandler((_tabId, _session, event) => {
      started.push(event.id)
      if (event.id === "hung-observe") return new Promise(() => {})
      return { observed: true }
    })

    const beganAt = Date.now()
    await manager.registerBrowserController("watchdog")
    const timeoutResult = await waitFor(
      () => bridgeResultFor(mock.requests, "hung-observe"),
      500
    )
    const elapsedMs = Date.now() - beganAt

    assert.ok(timeoutResult, "the watchdog must publish a bridge result for the stuck request")
    assert.equal(timeoutResult.body.ok, false)
    assert.match(
      String(timeoutResult.body.error || ""),
      /timed out inside the extension/
    )
    assert.match(String(timeoutResult.body.error || ""), /yunti_observe_page/)
    assert.ok(
      elapsedMs < 400,
      `the 60ms watchdog must answer long before the tool budget, got ${elapsedMs}ms`
    )

    // The lane must drain: the next same-tab request still gets executed.
    const nextStarted = await waitFor(() => started.includes("next-observe"), 400)
    assert.ok(nextStarted, `next request must be processed, started=${started.join(",")}`)
    assert.deepEqual(started, ["hung-observe", "next-observe"])
    assert.equal(bridgeResultFor(mock.requests, "next-observe"), undefined)
  } finally {
    mock.restore()
  }
})

// ---------------------------------------------------------------------------
// 6. YUNTI_TAB_BUSY fast fail for queued same-tab requests
// ---------------------------------------------------------------------------
test("controller answers a queued same-tab request with YUNTI_TAB_BUSY", async () => {
  const started = []
  const mock = installSessionManagerChromeMock({
    pollEvents: [
      {
        type: "tool_request",
        id: "slow-first",
        tool: "yunti_click",
        route: { tabId: 5 },
        deadlineAt: Date.now() + 5_000,
      },
      {
        type: "tool_request",
        id: "queued-second",
        tool: "yunti_click",
        route: { tabId: 5 },
        deadlineAt: Date.now() + 5_000,
      },
    ],
  })
  try {
    const manager = createSessionManager({
      controllerToolTimeoutMs: 5_000,
      controllerToolWatchdogMs: 2_000,
      controllerToolQueueWaitTimeoutMs: 100,
    })
    manager.setToolRequestHandler(async (_tabId, _session, event) => {
      started.push(event.id)
      if (event.id === "slow-first") await sleep(400)
      return { clicked: true }
    })

    const beganAt = Date.now()
    await manager.registerBrowserController("tab_busy")
    const busy = await waitFor(
      () => bridgeResultFor(mock.requests, "queued-second"),
      800
    )
    const elapsedMs = Date.now() - beganAt

    assert.ok(busy, "the queued request must fail fast instead of burning its whole budget")
    assert.equal(busy.body.ok, false)
    assert.match(String(busy.body.error || ""), /YUNTI_TAB_BUSY/)
    assert.match(String(busy.body.error || ""), /retryable=true/)
    assert.match(String(busy.body.error || ""), /yunti_click/)
    // It waits for the in-flight lane to release (the 400ms handler) but must
    // never reach the 5s request budget.
    assert.ok(
      elapsedMs >= 100 && elapsedMs <= 800,
      `fast fail must land between the 100ms queue budget and the 5s tool budget, got ${elapsedMs}ms`
    )
    // The busy request never reaches the handler.
    assert.deepEqual(started, ["slow-first"])
    assert.equal(bridgeResultFor(mock.requests, "slow-first"), undefined)
  } finally {
    mock.restore()
  }
})

test("controller publishes YUNTI_TAB_BUSY as soon as a wedged lane releases", async () => {
  const started = []
  const mock = installSessionManagerChromeMock({
    pollEvents: [
      {
        type: "tool_request",
        id: "wedged-first",
        tool: "yunti_fill",
        route: { tabId: 9 },
        deadlineAt: Date.now() + 5_000,
      },
      {
        type: "tool_request",
        id: "queued-behind-wedge",
        tool: "yunti_fill",
        route: { tabId: 9 },
        deadlineAt: Date.now() + 5_000,
      },
    ],
  })
  try {
    const manager = createSessionManager({
      controllerToolTimeoutMs: 5_000,
      // The wedged operation is abandoned after 120ms; the queued request must
      // then fail fast instead of waiting out its own 5s budget.
      controllerToolWatchdogMs: 120,
      controllerToolQueueWaitTimeoutMs: 100,
    })
    manager.setToolRequestHandler((_tabId, _session, event) => {
      started.push(event.id)
      if (event.id === "wedged-first") return new Promise(() => {})
      return { filled: true }
    })

    const beganAt = Date.now()
    await manager.registerBrowserController("tab_busy_wedged")
    const busy = await waitFor(
      () => bridgeResultFor(mock.requests, "queued-behind-wedge"),
      600
    )
    const elapsedMs = Date.now() - beganAt

    assert.ok(busy, "the queued request must fail fast")
    assert.match(String(busy.body.error || ""), /YUNTI_TAB_BUSY/)
    assert.match(String(busy.body.error || ""), /retryable=true/)
    assert.ok(
      elapsedMs >= 100 && elapsedMs <= 500,
      `busy answer must follow the 100ms queue budget closely, got ${elapsedMs}ms`
    )
    const wedgedResult = bridgeResultFor(mock.requests, "wedged-first")
    assert.equal(wedgedResult?.body.ok, false)
    assert.match(String(wedgedResult?.body.error || ""), /timed out inside the extension/)
    assert.deepEqual(started, ["wedged-first"])
  } finally {
    mock.restore()
  }
})

// ---------------------------------------------------------------------------
// 7. Throttled /sessions/register heartbeat
// ---------------------------------------------------------------------------
test("controller registration is throttled across poll cycles", async () => {
  const snapshots = []
  const mock = installSessionManagerChromeMock({
    pollEvents: Array.from({ length: 5 }, (_, index) => ({
      type: "poll_heartbeat",
      seq: index + 1,
    })),
    onPoll: ({ pollCount, requests }) => {
      snapshots.push({
        pollCount,
        registers: requests.filter((request) => request.url.endsWith("/sessions/register"))
          .length,
      })
    },
  })
  try {
    const manager = createSessionManager({ controllerRegisterInterval: 5 })
    await manager.registerBrowserController("register_throttle")

    // 5 poll events are consumed; the 6th (idle) long poll is already open.
    const served = await waitFor(() => mock.countRequests("/extension/poll") >= 6, 500)
    assert.ok(served, "expected at least 6 poll requests")

    // The lead's contract: with >=5 polls served the heartbeat must not have
    // re-registered more than once beyond the initial registration.
    const atFivePolls = snapshots.find((snapshot) => snapshot.pollCount === 5)
    assert.ok(atFivePolls, "poll #5 must have been served")
    assert.ok(
      atFivePolls.registers <= 2,
      `registration must be throttled: ${atFivePolls.registers} registers for 5 polls`
    )

    const polls = mock.countRequests("/extension/poll")
    const registers = mock.countRequests("/sessions/register")
    assert.ok(polls >= 5, `expected >=5 polls, got ${polls}`)
    // Poll #6 crosses the 5-cycle boundary, so exactly one refresh is due.
    assert.equal(polls, 6)
    assert.equal(registers, 3)
    // Every registration still carries the controller capabilities payload.
    const registerRequests = mock.requests.filter((request) =>
      request.url.endsWith("/sessions/register")
    )
    assert.equal(registerRequests.length, 3)
    assert.ok(
      registerRequests.every(
        (request) => request.body?.capabilities?.singleControllerTransport === true
      ),
      "every registration must carry the controller capabilities payload"
    )
  } finally {
    mock.restore()
  }
})

// ---------------------------------------------------------------------------
// 8. CDP command timeout + forced re-attach
// ---------------------------------------------------------------------------
test("CDP command timeout rejects with YUNTI_CDP_TIMEOUT and forces a re-attach", async () => {
  const attachCalls = []
  const previousChrome = globalThis.chrome
  globalThis.chrome = {
    runtime: { lastError: undefined },
    debugger: {
      attach: (target, protocolVersion, callback) => {
        attachCalls.push({ tabId: target.tabId, protocolVersion })
        callback()
      },
      detach: (_target, callback) => callback(),
      sendCommand: (_target, method, _params, callback) => {
        // Domain.enable answers immediately; the screenshot command simulates a
        // renderer that never calls back.
        if (/\.enable$/.test(method)) callback({})
      },
    },
  }
  try {
    const cdp = createCdpController({
      sessionsByTab: new Map(),
      postBridge: async () => {},
      forwardConsoleEvent: () => {},
      commandTimeoutMs: 250,
    })
    const first = await cdp.ensureCdpAttached(1, "1.3")
    assert.equal(first.attached, true)
    assert.equal(first.reused, false)

    const started = Date.now()
    await assert.rejects(
      cdp.chromeDebuggerSendCommand({ tabId: 1 }, "Page.captureScreenshot", { format: "png" }),
      (error) => {
        assert.match(error.message, /YUNTI_CDP_TIMEOUT/)
        assert.match(error.message, /Page\.captureScreenshot/)
        assert.match(error.message, /retryable=true/)
        assert.match(error.message, /did not answer within 250ms/)
        return true
      }
    )
    const elapsedMs = Date.now() - started
    // cdp.js floors the configured budget at 250ms, so the rejection must land
    // on that order of magnitude instead of the 10s default.
    assert.ok(
      elapsedMs >= 200 && elapsedMs <= 900,
      `CDP timeout must fire on the configured 250ms budget, got ${elapsedMs}ms`
    )

    // The timed-out debugger session is no longer trusted: the next call must
    // re-attach instead of reusing dead bookkeeping.
    const second = await cdp.ensureCdpAttached(1, "1.3")
    assert.equal(second.attached, true)
    assert.equal(second.reused, false)
    assert.deepEqual(
      attachCalls.map((call) => call.tabId),
      [1, 1]
    )
    assert.deepEqual(
      attachCalls.map((call) => call.protocolVersion),
      ["1.3", "1.3"]
    )
  } finally {
    globalThis.chrome = previousChrome
  }
})
