import test from "node:test"
import assert from "node:assert/strict"
import { createSessionManager as createRuntimeSessionManager } from "../extension/session-manager.js"

const testManagers = new Set()

function createSessionManager(options) {
  const manager = createRuntimeSessionManager(options)
  testManagers.add(manager)
  return manager
}

function installChromeMock(options = {}) {
  const tabs = options.tabs || []
  const messages = []
  const scripts = []
  const styles = []
  const requests = []
  const stored = { ...(options.storage || {}) }
  const reachableTabs = new Set(options.reachableTabs || [])
  const hangingTabs = new Set(options.hangingTabs || [])
  const pollEvents = [...(options.pollEvents || [])]
  const hangingInjectionTabs = new Set(options.hangingInjectionTabs || [])
  const updatedTabs = []
  const previousChrome = globalThis.chrome
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    requests.push({
      url: String(url),
      method: init.method || "GET",
      body: init.body ? JSON.parse(init.body) : null,
    })
    if (String(url).includes("/extension/poll")) {
      if (pollEvents.length > 0) {
        const event = pollEvents.shift()
        return {
          ok: true,
          json: async () => event,
        }
      }
      return new Promise((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        })
      })
    }
    return {
      ok: true,
      json: async () => ({ ok: true }),
    }
  }
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: "0.2.4" }),
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
      sendMessage: async (tabId, message) => {
        messages.push({ tabId, message })
        if (hangingTabs.has(tabId)) return new Promise(() => {})
        if (!reachableTabs.has(tabId)) throw new Error("Could not establish connection")
        return { ok: true }
      },
      update: async (tabId, patch) => {
        updatedTabs.push({ tabId, patch })
        if (patch.active) {
          const target = tabs.find((tab) => tab.id === tabId)
          for (const tab of tabs) {
            if (target && tab.windowId === target.windowId) tab.active = tab.id === tabId
          }
        }
        return tabs.find((tab) => tab.id === tabId) || null
      },
    },
    scripting: {
      insertCSS: async (details) => {
        styles.push(details)
        if (hangingInjectionTabs.has(details.target.tabId)) {
          hangingInjectionTabs.delete(details.target.tabId)
          return new Promise(() => {})
        }
      },
      executeScript: async (details) => {
        scripts.push(details)
      },
    },
  }
  return {
    messages,
    requests,
    scripts,
    stored,
    styles,
    updatedTabs,
    restore() {
      for (const manager of testManagers) manager.stop()
      testManagers.clear()
      globalThis.chrome = previousChrome
      globalThis.fetch = previousFetch
    },
  }
}

test("ensureAllTabsRegistered injects content scripts into existing http pages", async () => {
  const mock = installChromeMock({
    tabs: [
      { id: 1, url: "https://example.test/", title: "Example", windowId: 1 },
      { id: 2, url: "chrome://extensions/", title: "Extensions", windowId: 1 },
    ],
  })
  try {
    const manager = createSessionManager()
    const result = await manager.ensureAllTabsRegistered({ reason: "test" })

    assert.equal(result.checked, 2)
    assert.equal(result.recovered, 1)
    assert.equal(result.skipped, 1)
    assert.deepEqual(mock.styles.map((item) => item.files), [["content.css"]])
    assert.deepEqual(mock.scripts.map((item) => item.files), [
      ["dom-observer.js"],
      ["content.js"],
    ])
    assert.equal(mock.messages.filter((item) => item.tabId === 1).length, 2)
  } finally {
    mock.restore()
  }
})

test("content script probe timeout recovers an Edge tab whose sendMessage never settles", async () => {
  const mock = installChromeMock({
    hangingTabs: [8],
    tabs: [{ id: 8, url: "https://example.test/edge", title: "Edge", windowId: 1 }],
  })
  try {
    const manager = createSessionManager({ contentScriptProbeTimeoutMs: 10 })
    const result = await manager.ensureTabRegistered(8, { reason: "edge_probe_timeout" })

    assert.equal(result.ok, true)
    assert.equal(result.injected, true)
    assert.deepEqual(mock.scripts.map((item) => item.files), [
      ["dom-observer.js"],
      ["content.js"],
    ])
  } finally {
    mock.restore()
  }
})

test("sleeping Edge tab is temporarily activated when background injection stalls", async () => {
  const mock = installChromeMock({
    hangingInjectionTabs: [8],
    tabs: [
      { id: 7, active: true, url: "https://example.test/active", windowId: 1 },
      { id: 8, active: false, url: "https://example.test/sleeping", windowId: 1 },
    ],
  })
  try {
    const manager = createSessionManager({ contentScriptInjectionTimeoutMs: 10 })
    const result = await manager.ensureTabRegistered(8, { reason: "edge_sleeping_tab" })

    assert.equal(result.ok, true)
    assert.equal(result.injected, true)
    assert.deepEqual(mock.updatedTabs, [
      { tabId: 8, patch: { active: true } },
      { tabId: 7, patch: { active: true } },
    ])
    assert.equal(mock.scripts.length, 2)
  } finally {
    mock.restore()
  }
})

test("registerBrowserController maintains a browser-level route without a tab", async () => {
  const mock = installChromeMock()
  try {
    const manager = createSessionManager()
    const result = await manager.registerBrowserController("test")

    assert.equal(result.ok, true)
    assert.equal(result.session.kind, "browser_controller")
    assert.equal(result.session.tabId, null)
    assert.equal(result.session.windowId, null)
    assert.ok(result.session.browserSessionId.startsWith("yunti-browser-"))
    assert.equal(mock.stored.browserControllerId, result.session.browserSessionId)
    await new Promise((resolve) => setImmediate(resolve))

    const registerRequests = mock.requests.filter((request) =>
      request.url.endsWith("/sessions/register")
    )
    assert.ok(registerRequests.length >= 1)
    assert.equal(registerRequests[0].body.kind, "browser_controller")
    assert.equal(registerRequests[0].body.tabId, null)
    assert.equal(registerRequests[0].body.capabilities.singleControllerTransport, true)
    assert.deepEqual(registerRequests[0].body.liveTabIds, [])
    assert.ok(
      mock.requests.some((request) =>
        request.url.includes("/extension/poll?browserSessionId=")
      )
    )
  } finally {
    mock.restore()
  }
})

test("concurrent controller recovery creates one controller id and one poll loop", async () => {
  const mock = installChromeMock()
  try {
    const manager = createSessionManager()
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => manager.registerBrowserController(`race_${index}`))
    )
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(new Set(results.map((result) => result.session.browserSessionId)).size, 1)
    assert.equal(
      new Set(
        mock.requests
          .filter((request) => request.url.includes("/extension/poll"))
          .map((request) => request.url)
      ).size,
      1
    )
    assert.equal(
      mock.requests.filter((request) => request.url.includes("/extension/poll")).length,
      1
    )
  } finally {
    mock.restore()
  }
})

test("controller polling continues while a browser tool is still executing", async () => {
  const mock = installChromeMock({
    pollEvents: [{ type: "tool_request", id: "edge-hang", tool: "yunti_observe_page" }],
  })
  try {
    const manager = createSessionManager({ controllerToolTimeoutMs: 10 })
    manager.setToolRequestHandler(() => new Promise(() => {}))
    await manager.registerBrowserController("edge_tool_hang")
    await new Promise((resolve) => setTimeout(resolve, 25))

    assert.ok(
      mock.requests.filter((request) => request.url.includes("/extension/poll")).length >= 2
    )
    const timeoutResult = mock.requests.find(
      (request) => request.url.endsWith("/extension/result") && request.body.requestId === "edge-hang"
    )
    assert.equal(timeoutResult?.body.ok, false)
    assert.match(timeoutResult?.body.error || "", /timed out inside the extension/)
  } finally {
    mock.restore()
  }
})

test("controller drops a browser request whose bridge deadline has expired", async () => {
  const mock = installChromeMock({
    pollEvents: [{
      type: "tool_request",
      id: "expired-controller-request",
      tool: "yunti_click",
      deadlineAt: Date.now() - 1,
    }],
  })
  try {
    const manager = createSessionManager()
    manager.setToolRequestHandler(async () => {
      throw new Error("handler should not run for an expired request")
    })
    await manager.registerBrowserController("expired_request")
    await new Promise((resolve) => setImmediate(resolve))
    const result = mock.requests.find((request) =>
      request.url.endsWith("/extension/result") && request.body.requestId === "expired-controller-request"
    )
    assert.equal(result?.body.ok, false)
    assert.match(result?.body.error || "", /timed out before execution/i)
  } finally {
    mock.restore()
  }
})

test("controller recovery replaces a poller that stopped making progress", async () => {
  const mock = installChromeMock()
  try {
    const manager = createSessionManager({ controllerPollStallTimeoutMs: 10 })
    await manager.registerBrowserController("initial")
    await new Promise((resolve) => setTimeout(resolve, 15))
    await manager.registerBrowserController("watchdog")
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(
      mock.requests.filter((request) => request.url.includes("/extension/poll")).length,
      2
    )
  } finally {
    mock.restore()
  }
})

test("page sessions use stable ids and do not create per-tab long polls", async () => {
  const tabs = Array.from({ length: 30 }, (_, index) => ({
    id: index + 1,
    active: index === 0,
    url: `https://example.test/page-${index + 1}`,
    title: `Page ${index + 1}`,
    windowId: 1,
  }))
  const mock = installChromeMock({
    tabs,
    storage: { browserControllerId: "yunti-browser-stable-controller" },
  })
  try {
    const manager = createSessionManager()
    const firstRegistrations = []
    for (const tab of tabs) {
      firstRegistrations.push(await manager.handleMessage({
        type: "yunti_content_ready",
        page: { url: tab.url, title: tab.title },
      }, { tab }))
    }

    assert.equal(firstRegistrations.length, 30)
    assert.equal(firstRegistrations[0].session.browserSessionId, "yunti-page-1-stable-controller")
    assert.equal(firstRegistrations[29].session.browserSessionId, "yunti-page-30-stable-controller")
    assert.equal(
      mock.requests.filter((request) => request.url.includes("/extension/poll")).length,
      1
    )

    const restartedManager = createSessionManager()
    const restarted = await restartedManager.handleMessage({
      type: "yunti_content_ready",
      page: { url: tabs[0].url, title: tabs[0].title },
    }, { tab: tabs[0] })
    assert.equal(restarted.session.browserSessionId, firstRegistrations[0].session.browserSessionId)
  } finally {
    mock.restore()
  }
})

test("registerBrowserController restarts polling when bridge URL changes", async () => {
  const mock = installChromeMock()
  try {
    const manager = createSessionManager()
    await manager.registerBrowserController("initial")
    await new Promise((resolve) => setImmediate(resolve))

    await globalThis.chrome.storage.local.set({ bridgeUrl: "http://127.0.0.1:49999" })
    await manager.registerBrowserController("bridge_changed")
    await new Promise((resolve) => setImmediate(resolve))

    assert.ok(
      mock.requests.some((request) =>
        request.url.startsWith("http://127.0.0.1:48887/extension/poll?")
      )
    )
    assert.ok(
      mock.requests.some((request) =>
        request.url.startsWith("http://127.0.0.1:49999/extension/poll?")
      )
    )
  } finally {
    mock.restore()
  }
})

test("ensureAllTabsRegistered does not inject when content script answers", async () => {
  const mock = installChromeMock({
    reachableTabs: [1],
    tabs: [{ id: 1, url: "https://example.test/", title: "Example", windowId: 1 }],
  })
  try {
    const manager = createSessionManager()
    const result = await manager.ensureAllTabsRegistered({ reason: "test" })

    assert.equal(result.checked, 1)
    assert.equal(result.recovered, 1)
    assert.equal(mock.styles.length, 0)
    assert.equal(mock.scripts.length, 0)
    assert.equal(mock.messages.length, 1)
  } finally {
    mock.restore()
  }
})

test("refreshActiveTab falls back to injection when active tab is not registered", async () => {
  const mock = installChromeMock({
    tabs: [{ id: 7, active: true, url: "https://example.test/", title: "Example", windowId: 1 }],
  })
  try {
    const manager = createSessionManager()
    const state = await manager.handleMessage({ type: "yunti_panel_refresh_active" }, {})

    assert.equal(state.ok, true)
    assert.equal(state.activeTab.id, 7)
    assert.deepEqual(mock.scripts.map((item) => item.files), [
      ["dom-observer.js"],
      ["content.js"],
    ])
  } finally {
    mock.restore()
  }
})
