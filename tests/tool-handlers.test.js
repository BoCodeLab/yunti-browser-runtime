import test from "node:test"
import assert from "node:assert/strict"
import { createToolDispatcher } from "../extension/tool-handlers.js"

function createDispatcherHarness(options = {}) {
const posted = []
const sentMessages = []
const cdpCommands = []
const cdpDispatches = []
const ensureRegistrationCalls = []
const cdpResponses = options.cdpResponses ? [...options.cdpResponses] : null
  const defaultContentToolResponses = {
    yunti_click: (message) => ({
      clicked: true,
      x: Number.isFinite(Number(message.arguments?.x)) ? Number(message.arguments.x) : undefined,
      y: Number.isFinite(Number(message.arguments?.y)) ? Number(message.arguments.y) : undefined,
    }),
    yunti_hover: (message) => ({
      hovered: true,
      ...(Number.isFinite(Number(message.arguments?.x)) ? { x: Math.round(Number(message.arguments.x)) } : {}),
      ...(Number.isFinite(Number(message.arguments?.y)) ? { y: Math.round(Number(message.arguments.y)) } : {}),
    }),
    yunti_fill: (message) => ({
      filled: true,
      valueLength: String(message.arguments?.value ?? "").length,
      valueApplied: true,
      method: "dom",
    }),
    yunti_select: (message) => ({
      selected: true,
      value: String(message.arguments?.value ?? message.arguments?.text ?? ""),
      text: String(message.arguments?.text ?? message.arguments?.value ?? ""),
      selectedIndex: 1,
    }),
    yunti_type_text: (message) => ({
      typed: true,
      textLength: String(message.arguments?.text ?? "").length,
      mode: message.arguments?.clear ? "replace" : "append",
      method: "dom",
    }),
    yunti_press_key: (message) => ({
      pressed: true,
      key: String(message.arguments?.key || ""),
      valueChanged: false,
    }),
  }
  const contentToolResponses = { ...defaultContentToolResponses, ...(options.contentToolResponses || {}) }
  const originalChrome = globalThis.chrome
  const observations = options.observations || [
    {
      observationId: "obs-1",
      browserSessionId: "tab-1",
      uidMapVersion: "observe-v1",
      elements: [
        {
          uid: "yunti-1",
          role: "button",
          name: "Submit",
          rect: { x: 10, y: 20, width: 100, height: 40 },
        },
      ],
      textTree: "[yunti-1]<button>Submit</button>",
    },
  ]
  let observeIndex = 0

  globalThis.chrome = {
    tabs: {
      create: async () => options.createdTab || {
        id: 999,
        windowId: 1,
        url: "https://example.test/created",
        title: "Created",
        status: "complete",
      },
      get: async (tabId) => options.tabsById?.[tabId] || null,
      query: async () => options.activeTab ? [options.activeTab] : [],
      sendMessage: async (tabId, message) => {
        sentMessages.push({ tabId, message })
        if (message.tool === "yunti_observe_page") {
          const observation = observations[Math.min(observeIndex, observations.length - 1)]
          observeIndex += 1
          return observation
        }
        if (Object.prototype.hasOwnProperty.call(contentToolResponses, message.tool)) {
          const response = contentToolResponses[message.tool]
          return typeof response === "function" ? response(message) : response
        }
        throw new Error(`unexpected content message: ${message.tool}`)
      },
    },
  }

  const sessionsByTab = new Map()
  const dispatcher = createToolDispatcher({
    sessionsByTab,
    postBridge: async (_path, body) => {
      posted.push(body)
    },
    ensureTabRegistered: async (tabId) => {
      ensureRegistrationCalls.push(tabId)
      return {
        ok: true,
        registered: sessionsByTab.has(tabId),
        session: sessionsByTab.get(tabId) || null,
      }
    },
    cdp: {
      chromeDebuggerSendCommand: async (_target, method, params) => {
        cdpCommands.push({ method, params })
        if (cdpResponses) {
          return cdpResponses.shift() || {}
        }
        return {}
      },
      delayCdp: async () => {},
      detachCdpTab: async () => ({}),
      ensureCdpAttached: async () => {},
      getBrowserTarget: async () => ({}),
      listBrowserTargets: async () => ({}),
      sendCdpCommand: async (tabId, session, args) => {
        cdpDispatches.push({ tabId, session, args })
        return { browserSessionId: session.browserSessionId, tabId, method: args.method }
      },
      startPerformanceTrace: async () => ({}),
      stopPerformanceTrace: async () => ({}),
    },
  })

  return {
    cdpCommands,
    cdpDispatches,
    dispatcher,
    ensureRegistrationCalls,
    posted,
    sessionsByTab,
    restore: () => {
      globalThis.chrome = originalChrome
    },
    sentMessages,
  }
}

test("AX snapshot uids resolve their live backend node before clicking", async () => {
  const harness = createDispatcherHarness({ cdpResponses: [
    { nodes: [{ nodeId: "1", backendDOMNodeId: 7, role: { value: "button" }, name: { value: "Submit" } }] },
    {},
    { model: { content: [10, 20, 110, 20, 110, 60, 10, 60] } },
  ] })
  try {
    const session = { browserSessionId: "tab-ax", tabId: 123, kind: "page" }
    await harness.dispatcher.executeToolRequest(123, session, { id: "snapshot", tool: "yunti_take_snapshot", arguments: {} })
    const uid = harness.posted.at(-1).result.elements[0].uid
    await harness.dispatcher.executeToolRequest(123, session, { id: "click", tool: "yunti_click", arguments: { uid } })
    assert.equal(harness.posted.at(-1).result.clicked, true)
    assert.deepEqual(harness.cdpCommands.at(-1), { method: "DOM.getBoxModel", params: { backendNodeId: 7 } })
    assert.equal(harness.sentMessages.at(-1).message.arguments.x, 60)
    assert.equal(harness.sentMessages.at(-1).message.arguments.y, 40)
  } finally {
    harness.restore()
  }
})

test("expired requests fail before resolving or acting on a page", async () => {
  const harness = createDispatcherHarness()
  try {
    await harness.dispatcher.executeToolRequest(123, { browserSessionId: "page", tabId: 123 }, {
      id: "expired", tool: "yunti_click", arguments: { selector: "#submit" }, deadlineAt: Date.now() - 1,
    })
    assert.equal(harness.posted.at(-1).ok, false)
    assert.match(harness.posted.at(-1).error, /timed out/i)
    assert.equal(harness.sentMessages.length, 0)
  } finally {
    harness.restore()
  }
})

test("controller transport resolves a concrete page before dispatching page tools", async () => {
  const harness = createDispatcherHarness({
    observations: [{
      observationId: "obs-controller",
      browserSessionId: null,
      uidMapVersion: "observe-v1",
      elements: [],
      textTree: "Controller recovered page",
    }],
  })
  try {
    const pageSession = {
      browserSessionId: "yunti-page-321-controller",
      kind: "page",
      tabId: 321,
      userId: "local",
    }
    harness.sessionsByTab.set(321, pageSession)
    await harness.dispatcher.executeToolRequest(null, {
      browserSessionId: "yunti-browser-controller",
      kind: "browser_controller",
      tabId: null,
      userId: "local",
    }, {
      id: "request-controller",
      tool: "yunti_observe_page",
      arguments: {},
      route: { tabId: 321, viaController: true },
    })

    assert.equal(harness.sentMessages.at(-1).tabId, 321)
    assert.equal(harness.posted.at(-1).browserSessionId, "yunti-browser-controller")
    assert.equal(harness.posted.at(-1).ok, true)
    assert.equal(harness.posted.at(-1).result.browserSessionId, "yunti-page-321-controller")
    assert.deepEqual(harness.ensureRegistrationCalls, [])
  } finally {
    harness.restore()
  }
})

test("controller transport revalidates registration after the tab URL changes", async () => {
  const harness = createDispatcherHarness({
    tabsById: { 322: { id: 322, url: "https://example.test/new" } },
  })
  try {
    harness.sessionsByTab.set(322, {
      browserSessionId: "yunti-page-322-controller",
      kind: "page",
      tabId: 322,
      userId: "local",
      url: "https://example.test/old",
    })
    await harness.dispatcher.executeToolRequest(null, {
      browserSessionId: "yunti-browser-controller",
      kind: "browser_controller",
      tabId: null,
      userId: "local",
    }, {
      id: "request-controller-navigation",
      tool: "yunti_observe_page",
      arguments: {},
      route: { tabId: 322, viaController: true },
    })

    assert.deepEqual(harness.ensureRegistrationCalls, [322])
    assert.equal(harness.posted.at(-1).ok, true)
  } finally {
    harness.restore()
  }
})

test("controller transport forwards the logical page tab to CDP without a duplicate tab argument", async () => {
  const harness = createDispatcherHarness()
  try {
    await harness.dispatcher.executeToolRequest(null, {
      browserSessionId: "yunti-browser-controller",
      kind: "browser_controller",
      tabId: null,
      userId: "local",
    }, {
      id: "request-cdp-controller",
      tool: "yunti_cdp_send_command",
      arguments: { method: "Runtime.evaluate", params: { expression: "document.title" } },
      route: {
        browserSessionId: "yunti-page-654-controller",
        tabId: 654,
        viaController: true,
      },
    })

    assert.equal(harness.cdpDispatches.length, 1)
    assert.equal(harness.cdpDispatches[0].tabId, 654)
    assert.equal(harness.cdpDispatches[0].session.browserSessionId, "yunti-page-654-controller")
    assert.equal(harness.posted.at(-1).browserSessionId, "yunti-browser-controller")
    assert.equal(harness.posted.at(-1).result.browserSessionId, "yunti-page-654-controller")
  } finally {
    harness.restore()
  }
})

test("new page waits for real page registration before reporting ready", async () => {
  const createdTab = {
    id: 999,
    windowId: 1,
    url: "https://example.test/created",
    title: "Created",
    status: "complete",
  }
  const harness = createDispatcherHarness({
    createdTab,
    tabsById: { 999: createdTab },
  })
  try {
    await harness.dispatcher.executeToolRequest(null, {
      browserSessionId: "yunti-browser-controller",
      kind: "browser_controller",
      tabId: null,
      userId: "local",
    }, {
      id: "request-new-page",
      tool: "yunti_new_page",
      arguments: { url: createdTab.url, active: false },
      route: { viaController: true },
    })

    assert.deepEqual(harness.ensureRegistrationCalls, [999])
    assert.equal(harness.posted.at(-1).ok, true)
    assert.equal(harness.posted.at(-1).result.created, true)
    assert.equal(harness.posted.at(-1).result.ready, true)
    assert.equal(harness.posted.at(-1).result.browserSessionId, harness.sessionsByTab.get(999).browserSessionId)
  } finally {
    harness.restore()
  }
})

test("observe uid map feeds existing uid-based click path", async () => {
  const harness = createDispatcherHarness()
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })
    assert.equal(harness.posted.at(-1).ok, true)
    assert.equal(harness.posted.at(-1).result.elements[0].uid, "yunti-1")

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-click",
      tool: "yunti_click",
      arguments: { uid: "yunti-1" },
    })

    const clickResult = harness.posted.at(-1)
    assert.equal(clickResult.ok, true)
    assert.deepEqual(clickResult.result, {
      clicked: true,
      uid: "yunti-1",
      x: 60,
      y: 40,
      browserSessionId: "tab-1",
      action: "click",
      target: { uid: "yunti-1", x: 60, y: 40 },
      ok: true,
      recoverable: false,
      nextStepHint: "Click dispatched without attaching Chrome debugger. Observe again or read page state to verify the intended change.",
    })
    assert.deepEqual(
      harness.sentMessages.map((item) => item.message.tool),
      ["yunti_observe_page", "yunti_click"]
    )
    assert.deepEqual(harness.sentMessages.at(-1).message.arguments, { uid: "yunti-1", x: 60, y: 40 })
    assert.deepEqual(harness.cdpCommands, [])
    assert.equal(
      harness.sentMessages.filter((item) => item.message.tool === "yunti_observe_page").length,
      1
    )
  } finally {
    harness.restore()
  }
})

test("find results feed the latest uid map for follow-up actions", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_find_elements: {
        observationId: "find-1",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        matchCount: 1,
        matches: [
          {
            uid: "yunti-9",
            role: "button",
            tag: "button",
            name: "Save form",
            rect: { x: 50, y: 90, width: 120, height: 32 },
          },
        ],
        hints: ["Use the returned fresh uid for click/fill/select, then verify with yunti_observe_page or evaluate."],
      },
      yunti_click: (message) => ({
        clicked: true,
        x: Number(message.arguments?.x),
        y: Number(message.arguments?.y),
      }),
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-find",
      tool: "yunti_find_elements",
      arguments: { query: "save", role: "button" },
    })
    assert.equal(harness.posted.at(-1).ok, true)
    assert.equal(harness.posted.at(-1).result.matches[0].uid, "yunti-9")

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-click-found",
      tool: "yunti_click",
      arguments: { uid: "yunti-9" },
    })
    assert.equal(harness.posted.at(-1).ok, true)
    assert.equal(harness.posted.at(-1).result.uid, "yunti-9")
    assert.equal(harness.sentMessages.map((item) => item.message.tool).join(","), "yunti_find_elements,yunti_click")
  } finally {
    harness.restore()
  }
})

test("delta observe does not replace the last actionable uid map", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-full-1",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        responseMode: "full",
        elements: [
          {
            uid: "yunti-1",
            role: "button",
            name: "Submit",
            rect: { x: 10, y: 20, width: 100, height: 40 },
          },
        ],
        textTree: "[yunti-1]<button>Submit</button>",
      },
      {
        observationId: "obs-delta-2",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        responseMode: "delta",
        delta: {
          firstObservation: false,
          changedElementCount: 1,
          changedScrollableContainerCount: 0,
          changedElements: { added: [], removed: [], updated: ["button|button|Submit||||10|20|100|40"] },
          changedScrollableContainers: { added: [], removed: [], updated: [] },
        },
        hints: ["Delta observation detected page changes. Run full yunti_observe_page before choosing a fresh uid for the next action."],
      },
    ],
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe-full",
      tool: "yunti_observe_page",
      arguments: { responseMode: "full" },
    })
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe-delta",
      tool: "yunti_observe_page",
      arguments: { responseMode: "delta" },
    })
    assert.equal(harness.posted.at(-1).result.responseMode, "delta")

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-click-after-delta",
      tool: "yunti_click",
      arguments: { uid: "yunti-1" },
    })
    assert.equal(harness.posted.at(-1).ok, true)
    assert.equal(harness.posted.at(-1).result.uid, "yunti-1")
    assert.deepEqual(harness.sentMessages.map((item) => item.message.tool), [
      "yunti_observe_page",
      "yunti_observe_page",
      "yunti_click",
    ])
  } finally {
    harness.restore()
  }
})

test("coordinate click preserves compatibility fields with structured result", async () => {
  const harness = createDispatcherHarness()
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-click-coordinate",
      tool: "yunti_click",
      arguments: { x: 12.4, y: 34.6 },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      clicked: true,
      x: 12,
      y: 35,
      browserSessionId: "tab-1",
      method: "coordinate",
      action: "click",
      target: { method: "coordinate", x: 12, y: 35 },
      ok: true,
      recoverable: false,
      nextStepHint: "Coordinate click dispatched without attaching Chrome debugger. Observe again, read page state, or use a fresh uid when possible to verify the intended change.",
    })
    assert.deepEqual(harness.sentMessages.map((item) => item.message.tool), ["yunti_click"])
    assert.deepEqual(harness.cdpCommands, [])
  } finally {
    harness.restore()
  }
})

test("selector click preserves content result with structured result", async () => {
  const element = {
    tag: "button",
    text: "Open menu",
    selector: "#menu",
  }
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_click: {
        clicked: true,
        element,
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-click-selector",
      tool: "yunti_click",
      arguments: { selector: "#menu" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      clicked: true,
      element,
      selector: "#menu",
      browserSessionId: "tab-1",
      method: "selector",
      action: "click",
      target: { selector: "#menu", method: "selector" },
      ok: true,
      recoverable: false,
      nextStepHint: "Selector click dispatched. Observe again, read page state, or use a fresh uid when possible to verify the intended change.",
    })
    assert.deepEqual(harness.sentMessages.at(-1), {
      tabId: 123,
      message: {
        type: "yunti_execute_tool",
        tool: "yunti_click",
        arguments: { selector: "#menu" },
      },
    })
  } finally {
    harness.restore()
  }
})

test("selector click returns structured actionability recovery when target is not ready", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_click: {
        clicked: false,
        selector: "#menu",
        code: "TARGET_DISABLED",
        error: "Target element is disabled: #menu",
        actionability: {
          waitedMs: 300,
          retryable: true,
        },
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-click-selector-disabled",
      tool: "yunti_click",
      arguments: { selector: "#menu", timeoutMs: 300 },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      clicked: false,
      selector: "#menu",
      code: "TARGET_DISABLED",
      error: "Target element is disabled: #menu",
      actionability: {
        waitedMs: 300,
        retryable: true,
      },
      browserSessionId: "tab-1",
      action: "click",
      target: { selector: "#menu", method: "selector" },
      ok: false,
      recoverable: true,
      recoveryHint: {
        reason: "selector-click-failed",
        recommendedTools: ["yunti_observe_page", "yunti_wait_for", "yunti_click"],
        nextAction: "observe-or-wait-before-retrying-click",
        decision: "inspect-readiness-before-selector-click-retry",
        selector: "#menu",
        message: "The selector click could not be completed yet. Wait for the target to appear, become enabled, or stop being covered before retrying the same click.",
      },
      nextStepHint: "Selector click failed. Wait for the target to become ready, or observe again before retrying.",
    })
  } finally {
    harness.restore()
  }
})

test("coordinate hover preserves compatibility fields with structured result", async () => {
  const harness = createDispatcherHarness()
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-hover-coordinate",
      tool: "yunti_hover",
      arguments: { x: 44.4, y: 88.8 },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      hovered: true,
      x: 44,
      y: 89,
      browserSessionId: "tab-1",
      method: "coordinate",
      action: "hover",
      target: { method: "coordinate", x: 44, y: 89 },
      ok: true,
      recoverable: false,
      nextStepHint: "Coordinate hover dispatched without attaching Chrome debugger. Observe again, read page state, or use a fresh uid when possible to verify menus, tooltips, or hover-only controls.",
    })
    assert.deepEqual(harness.sentMessages.map((item) => item.message.tool), ["yunti_hover"])
    assert.deepEqual(harness.cdpCommands, [])
  } finally {
    harness.restore()
  }
})

test("selector hover preserves compatibility fields with structured result", async () => {
  const harness = createDispatcherHarness({
    cdpResponses: [
      {
        result: {
          value: {
            ok: true,
            x: 101.2,
            y: 202.6,
          },
        },
      },
      {},
    ],
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-hover-selector",
      tool: "yunti_hover",
      arguments: { selector: "#menu" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      hovered: true,
      selector: "#menu",
      browserSessionId: "tab-1",
      method: "selector",
      action: "hover",
      target: { selector: "#menu", method: "selector" },
      ok: true,
      recoverable: false,
      nextStepHint: "Selector hover dispatched without attaching Chrome debugger. Observe again, read page state, or use a fresh uid when possible to verify menus, tooltips, or hover-only controls.",
    })
    assert.deepEqual(harness.sentMessages.map((item) => item.message.tool), ["yunti_hover"])
    assert.deepEqual(harness.cdpCommands, [])
  } finally {
    harness.restore()
  }
})

test("selector fill actionability timeout suggests waiting before retry", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_fill: {
        filled: false,
        selector: "#name",
        code: "TARGET_DISABLED",
        error: "Target element is disabled: #name",
        actionability: {
          waitedMs: 250,
          retryable: true,
        },
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-fill-selector-disabled",
      tool: "yunti_fill",
      arguments: { selector: "#name", value: "Yunti", timeoutMs: 250 },
    })

    const result = harness.posted.at(-1).result
    assert.equal(result.filled, false)
    assert.equal(result.code, "TARGET_DISABLED")
    assert.equal(result.recoveryHint.nextAction, "wait-for-actionability")
    assert.equal(result.recoveryHint.decision, "wait-before-selector-fill-retry")
    assert.match(result.recoveryHint.message, /not ready yet/)
  } finally {
    harness.restore()
  }
})

test("dispatcher preserves current action result shapes", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-actions",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-click",
            role: "button",
            name: "Submit",
            rect: { x: 10, y: 20, width: 100, height: 40 },
          },
          {
            uid: "yunti-input",
            role: "textbox",
            name: "Search",
            rect: { x: 30, y: 90, width: 160, height: 30 },
          },
        ],
      },
    ],
    contentToolResponses: {
      yunti_scroll: {
        scrolled: true,
        deltaX: 0,
        deltaY: 600,
        target: "document",
        before: { left: 0, top: 0 },
        after: { left: 0, top: 600 },
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-click",
      tool: "yunti_click",
      arguments: { uid: "yunti-click" },
    })
    assert.deepEqual(harness.posted.at(-1).result, {
      clicked: true,
      uid: "yunti-click",
      x: 60,
      y: 40,
      browserSessionId: "tab-1",
      action: "click",
      target: { uid: "yunti-click", x: 60, y: 40 },
      ok: true,
      recoverable: false,
      nextStepHint: "Click dispatched without attaching Chrome debugger. Observe again or read page state to verify the intended change.",
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-hover",
      tool: "yunti_hover",
      arguments: { uid: "yunti-click" },
    })
    assert.deepEqual(harness.posted.at(-1).result, {
      hovered: true,
      uid: "yunti-click",
      x: 60,
      y: 40,
      browserSessionId: "tab-1",
      action: "hover",
      target: { uid: "yunti-click", x: 60, y: 40 },
      ok: true,
      recoverable: false,
      nextStepHint: "Hover dispatched without attaching Chrome debugger. Observe again or read page state to verify menus, tooltips, or hover-only controls.",
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-fill",
      tool: "yunti_fill",
      arguments: { uid: "yunti-input", value: "hi" },
    })
    assert.deepEqual(harness.posted.at(-1).result, {
      filled: true,
      uid: "yunti-input",
      valueLength: 2,
      valueApplied: true,
      method: "dom",
      value: "hi",
      browserSessionId: "tab-1",
      action: "fill",
      target: { uid: "yunti-input", method: "dom" },
      ok: true,
      recoverable: false,
      nextStepHint: "Fill dispatched without attaching Chrome debugger. Observe again, read page state, or evaluate the field value to verify the intended change.",
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-scroll",
      tool: "yunti_scroll",
      arguments: { deltaY: 600 },
    })
    assert.deepEqual(harness.posted.at(-1).result, {
      scrolled: true,
      deltaX: 0,
      deltaY: 600,
      target: "document",
      before: { left: 0, top: 0 },
      after: { left: 0, top: 600 },
      browserSessionId: "tab-1",
      action: "scroll",
      moved: true,
      ok: true,
      recoverable: false,
      nextStepHint: "Scroll dispatched. Observe again or read page state to verify the intended viewport or container position.",
    })
  } finally {
    harness.restore()
  }
})

test("uid scroll uses observed scrollable container center and preserves result fields", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-scroll",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [],
        scrollableContainers: [
          {
            uid: "scroll-1",
            tag: "div",
            name: "Results",
            rect: { x: 10, y: 90, width: 360, height: 280 },
            scrollTop: 120,
            scrollHeight: 920,
            clientHeight: 280,
            canScrollVertical: true,
          },
        ],
      },
    ],
    contentToolResponses: {
      yunti_scroll: (message) => {
        assert.equal(Math.round(message.arguments.x), 190)
        assert.equal(Math.round(message.arguments.y), 230)
        assert.equal(message.arguments.uid, "scroll-1")
        return {
          scrolled: true,
          deltaX: 0,
          deltaY: 240,
          target: "div#results",
          before: { left: 0, top: 120 },
          after: { left: 0, top: 360 },
        }
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-scroll-container",
      tool: "yunti_scroll",
      arguments: { uid: "scroll-1", deltaY: 240 },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      scrolled: true,
      deltaX: 0,
      deltaY: 240,
      target: "div#results",
      before: { left: 0, top: 120 },
      after: { left: 0, top: 360 },
      browserSessionId: "tab-1",
      action: "scroll",
      uid: "scroll-1",
      method: "uid",
      scrollTarget: { uid: "scroll-1", method: "uid" },
      moved: true,
      ok: true,
      recoverable: false,
      nextStepHint: "Uid-targeted scroll dispatched. Observe again or read page state to verify the intended container position.",
    })
  } finally {
    harness.restore()
  }
})

test("scroll no movement reports recoverable boundary diagnostic", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_scroll: {
        scrolled: true,
        deltaX: 0,
        deltaY: 600,
        target: "document",
        before: { left: 0, top: 1200 },
        after: { left: 0, top: 1200 },
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-scroll-boundary",
      tool: "yunti_scroll",
      arguments: { deltaY: 600 },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      scrolled: true,
      deltaX: 0,
      deltaY: 600,
      target: "document",
      before: { left: 0, top: 1200 },
      after: { left: 0, top: 1200 },
      browserSessionId: "tab-1",
      action: "scroll",
      moved: false,
      code: "NO_SCROLL_MOVEMENT",
      edgeHint: "possible-bottom-edge",
      recoveryHint: {
        reason: "no-scroll-movement",
        recommendedTools: ["yunti_observe_page", "yunti_scroll"],
        nextAction: "observe-for-scrollable-container",
        edgeHint: "possible-bottom-edge",
        currentTarget: "document-or-coordinate-container",
        decision: "observe-for-scrollable-container",
        suggestedRetry: {
          deltaY: -600,
          note: "Observe first for a scrollable container uid; only use this opposite delta if document scrolling is still the intended target.",
        },
        message: "The scroll command dispatched, but the scroll position did not change. Refresh observation before retrying, inspect scroll boundaries, or target a different scrollable container uid.",
      },
      ok: false,
      recoverable: true,
      nextStepHint: "Scroll dispatched but before/after positions did not change (possible-bottom-edge). Observe again, inspect scroll boundaries, try the nearest scrollable container uid, or stop repeating the same scroll.",
    })
  } finally {
    harness.restore()
  }
})

test("scroll no movement infers horizontal and upward edge hints", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_scroll: (message) => ({
        scrolled: true,
        deltaX: Number(message.arguments.deltaX || 0),
        deltaY: Number(message.arguments.deltaY || 0),
        target: "document",
        before: { left: 20, top: 80 },
        after: { left: 20, top: 80 },
      }),
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-scroll-top-edge",
      tool: "yunti_scroll",
      arguments: { deltaY: -240 },
    })
    assert.equal(harness.posted.at(-1).result.edgeHint, "possible-top-edge")
    assert.equal(harness.posted.at(-1).result.recoveryHint.decision, "observe-for-scrollable-container")
    assert.deepEqual(harness.posted.at(-1).result.recoveryHint.suggestedRetry, {
      deltaY: 240,
      note: "Observe first for a scrollable container uid; only use this opposite delta if document scrolling is still the intended target.",
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-scroll-right-edge",
      tool: "yunti_scroll",
      arguments: { deltaX: 180, deltaY: 0 },
    })
    assert.equal(harness.posted.at(-1).result.edgeHint, "possible-right-edge")
    assert.equal(harness.posted.at(-1).result.recoveryHint.decision, "observe-for-horizontal-scrollable-container")
    assert.deepEqual(harness.posted.at(-1).result.recoveryHint.suggestedRetry, {
      deltaX: -180,
      note: "Observe first for a scrollable container uid; only use this opposite delta if document scrolling is still the intended target.",
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-scroll-left-edge",
      tool: "yunti_scroll",
      arguments: { deltaX: -180, deltaY: 0 },
    })
    assert.equal(harness.posted.at(-1).result.edgeHint, "possible-left-edge")
    assert.equal(harness.posted.at(-1).result.recoveryHint.decision, "observe-for-horizontal-scrollable-container")
    assert.deepEqual(harness.posted.at(-1).result.recoveryHint.suggestedRetry, {
      deltaX: 180,
      note: "Observe first for a scrollable container uid; only use this opposite delta if document scrolling is still the intended target.",
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-scroll-no-delta",
      tool: "yunti_scroll",
      arguments: { deltaX: 0, deltaY: 0 },
    })
    assert.equal(harness.posted.at(-1).result.edgeHint, "no-delta")
    assert.equal(harness.posted.at(-1).result.recoveryHint.decision, "provide-nonzero-delta")
    assert.equal(harness.posted.at(-1).result.recoveryHint.suggestedRetry, undefined)
  } finally {
    harness.restore()
  }
})

test("uid scroll no movement includes observed container recovery metadata", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-scroll-recovery",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [],
        scrollableContainers: [
          {
            uid: "scroll-2",
            tag: "div",
            name: "Results",
            rect: { x: 20, y: 100, width: 320, height: 240 },
            canScrollVertical: true,
            canScrollHorizontal: false,
            pixelsAbove: 0,
            pixelsBelow: 480,
            pixelsLeft: 0,
            pixelsRight: 0,
          },
        ],
      },
    ],
    contentToolResponses: {
      yunti_scroll: {
        scrolled: true,
        deltaX: 0,
        deltaY: 300,
        target: "div#results",
        before: { left: 0, top: 0 },
        after: { left: 0, top: 0 },
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-scroll-container-no-move",
      tool: "yunti_scroll",
      arguments: { uid: "scroll-2", deltaY: 300 },
    })

    assert.deepEqual(harness.posted.at(-1).result.recoveryHint, {
      reason: "no-scroll-movement",
      recommendedTools: ["yunti_observe_page", "yunti_scroll"],
      nextAction: "try-opposite-direction-or-nearest-container",
      edgeHint: "possible-bottom-edge",
      uid: "scroll-2",
      currentTarget: "scrollable-container",
      decision: "retry-opposite-vertical-on-same-container-once",
      lastObservedContainer: {
        uid: "scroll-2",
        canScrollVertical: true,
        canScrollHorizontal: false,
        pixelsAbove: 0,
        pixelsBelow: 480,
        pixelsLeft: 0,
        pixelsRight: 0,
      },
      suggestedRetry: {
        uid: "scroll-2",
        deltaY: -300,
        note: "Try the opposite direction once on the same observed container, then observe again or switch to a nearer scrollable container if it still does not move.",
      },
      message: "The scroll command dispatched, but the scroll position did not change. Refresh observation before retrying, inspect scroll boundaries, or target a different scrollable container uid.",
    })
  } finally {
    harness.restore()
  }
})

test("scroll partial movement reports observe-before-continuing hint", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_scroll: {
        scrolled: true,
        deltaX: 0,
        deltaY: 600,
        target: "document",
        before: { left: 0, top: 900 },
        after: { left: 0, top: 1200 },
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-scroll-partial",
      tool: "yunti_scroll",
      arguments: { deltaY: 600 },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      scrolled: true,
      deltaX: 0,
      deltaY: 600,
      target: "document",
      before: { left: 0, top: 900 },
      after: { left: 0, top: 1200 },
      browserSessionId: "tab-1",
      action: "scroll",
      moved: true,
      partialMovement: {
        reason: "partial-scroll-movement",
        axes: ["vertical"],
        requestedDeltaX: 0,
        requestedDeltaY: 600,
        actualDeltaX: 0,
        actualDeltaY: 300,
        edgeHint: "possible-bottom-edge",
        nextAction: "observe-again",
        decision: "observe-before-continuing-scroll",
        message: "The scroll position changed, but less than the requested delta. Observe again before repeating the same scroll to verify whether the target container hit an edge or a different container should be used.",
      },
      ok: true,
      recoverable: false,
      nextStepHint: "Scroll moved partially (possible-bottom-edge). Observe again and compare scroll positions before repeating the same scroll.",
    })
  } finally {
    harness.restore()
  }
})

test("coordinate scroll document fallback reports recovery hint while remaining successful", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_scroll: {
        scrolled: true,
        deltaX: 0,
        deltaY: 240,
        target: "document",
        coordinateTarget: {
          x: 320,
          y: 180,
          found: false,
        },
        scrollContainerFound: false,
        coordinateScrollFallback: "document",
        before: { left: 0, top: 100 },
        after: { left: 0, top: 340 },
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-coordinate-scroll-fallback",
      tool: "yunti_scroll",
      arguments: { x: 320, y: 180, deltaY: 240 },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      scrolled: true,
      deltaX: 0,
      deltaY: 240,
      target: "document",
      coordinateTarget: {
        x: 320,
        y: 180,
        found: false,
      },
      scrollContainerFound: false,
      coordinateScrollFallback: "document",
      before: { left: 0, top: 100 },
      after: { left: 0, top: 340 },
      browserSessionId: "tab-1",
      action: "scroll",
      moved: true,
      coordinateFallbackHint: {
        reason: "coordinate-scroll-document-fallback",
        nextAction: "observe-for-scrollable-container",
        decision: "prefer-fresh-scrollable-container-uid",
        recommendedTools: ["yunti_observe_page", "yunti_scroll"],
        coordinateTarget: {
          x: 320,
          y: 180,
          found: false,
        },
        message: "The coordinate scroll did not find a nested scrollable container and fell back to document scrolling. Observe again and choose a fresh scrollableContainers[] uid when a panel or sidebar was intended.",
      },
      ok: true,
      recoverable: false,
      nextStepHint: "Coordinate scroll fell back to document scrolling. Observe again, inspect scrollableContainers[], and prefer a fresh scrollable container uid if a nested panel was intended.",
    })
  } finally {
    harness.restore()
  }
})

test("uid scroll missing target returns structured recovery diagnostic", async () => {
  const harness = createDispatcherHarness()
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-scroll-missing-uid",
      tool: "yunti_scroll",
      arguments: { uid: "missing-scroll", deltaY: 320 },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      scrolled: false,
      uid: "missing-scroll",
      browserSessionId: "tab-1",
      action: "scroll",
      target: { uid: "missing-scroll", method: "uid" },
      ok: false,
      recoverable: true,
      code: "UID_NOT_FOUND",
      error: "uid missing-scroll not found in the latest page uid map. Run yunti_observe_page again before retrying.",
      recoveryHint: {
        reason: "uid-scroll-failed",
        recommendedTools: ["yunti_observe_page", "yunti_take_snapshot", "yunti_scroll"],
        nextAction: "observe-again",
        decision: "refresh-scrollable-container-uid-before-retry",
        uid: "missing-scroll",
        message: "The uid scroll could not resolve a current target. Refresh observation, choose a fresh scrollable container uid from scrollableContainers[], or use document/coordinate scroll fallback before retrying.",
      },
      nextStepHint: "Uid scroll failed. Observe again for a fresh scrollable container uid, inspect scrollableContainers[], or retry with document/coordinate fallback before repeating the same uid scroll.",
    })
  } finally {
    harness.restore()
  }
})

test("uid fill select path preserves compatibility fields with structured result", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-select",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-select",
            role: "combobox",
            name: "Plan",
            rect: { x: 30, y: 90, width: 160, height: 30 },
          },
        ],
      },
    ],
    contentToolResponses: {
      yunti_fill: {
        filled: true,
        method: "select",
        value: "pro",
        valueLength: 3,
        valueApplied: true,
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-fill-select",
      tool: "yunti_fill",
      arguments: { uid: "yunti-select", value: "Pro" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      filled: true,
      uid: "yunti-select",
      method: "select",
      value: "Pro",
      valueLength: 3,
      valueApplied: true,
      browserSessionId: "tab-1",
      action: "fill",
      target: { uid: "yunti-select", method: "select" },
      ok: true,
      recoverable: false,
      nextStepHint: "Fill dispatched without attaching Chrome debugger. Observe again, read page state, or evaluate the field value to verify the intended change.",
    })
    assert.deepEqual(harness.cdpCommands, [])
  } finally {
    harness.restore()
  }
})

test("uid fill contenteditable path reports semantic method and text summary", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-editor",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-editor",
            role: "textbox",
            name: "Notes",
            rect: { x: 40, y: 110, width: 240, height: 80 },
          },
        ],
      },
    ],
    contentToolResponses: {
      yunti_fill: {
        filled: true,
        method: "contenteditable",
        valueLength: 5,
        valueApplied: true,
        before: { textLength: 8 },
        after: { textLength: 5 },
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-fill-editor",
      tool: "yunti_fill",
      arguments: { uid: "yunti-editor", value: "draft" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      filled: true,
      uid: "yunti-editor",
      method: "contenteditable",
      value: "draft",
      before: { textLength: 8 },
      after: { textLength: 5 },
      valueLength: 5,
      valueApplied: true,
      browserSessionId: "tab-1",
      action: "fill",
      target: { uid: "yunti-editor", method: "contenteditable" },
      ok: true,
      recoverable: false,
      nextStepHint: "Contenteditable fill dispatched. Observe again, read page text, or evaluate textContent to verify the intended change.",
    })
    assert.deepEqual(harness.cdpCommands, [])
  } finally {
    harness.restore()
  }
})

test("selector fill preserves content result with structured result", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_fill: {
        filled: true,
        element: "input#search",
        valueLength: 5,
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-fill-selector",
      tool: "yunti_fill",
      arguments: { selector: "#search", value: "hello" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      filled: true,
      element: "input#search",
      valueLength: 5,
      selector: "#search",
      method: "selector",
      browserSessionId: "tab-1",
      action: "fill",
      target: { selector: "#search", method: "selector" },
      ok: true,
      recoverable: false,
      nextStepHint: "Selector fill dispatched. Observe again, read page state, or evaluate the field value to verify the intended change.",
    })
  } finally {
    harness.restore()
  }
})

test("selector fill thrown failure returns structured recovery diagnostic", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_fill: () => {
        throw new Error("Element not found: #missing")
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-fill-selector-missing",
      tool: "yunti_fill",
      arguments: { selector: "#missing", value: "hello" },
    })

    const result = harness.posted.at(-1).result
    assert.equal(result.filled, false)
    assert.equal(result.code, "ELEMENT_NOT_FOUND")
    assert.equal(result.recoveryHint.nextAction, "observe-again")
    assert.equal(result.recoveryHint.decision, "refresh-observation-or-selector-before-retry")
    assert.ok(result.recoveryHint.recommendedTools.includes("yunti_wait_for"))
  } finally {
    harness.restore()
  }
})

test("selector fill non-editable failure returns structured recovery diagnostic", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_fill: () => {
        throw new Error("Target element is disabled")
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-fill-selector-disabled",
      tool: "yunti_fill",
      arguments: { selector: "#locked", value: "hello" },
    })

    const result = harness.posted.at(-1).result
    assert.equal(result.filled, false)
    assert.equal(result.code, "TARGET_NOT_EDITABLE")
    assert.equal(result.recoveryHint.nextAction, "inspect-target-element")
    assert.equal(result.recoveryHint.decision, "inspect-editability-before-retry")
    assert.ok(result.recoveryHint.recommendedTools.includes("yunti_wait_for"))
  } finally {
    harness.restore()
  }
})

test("uid fill non-editable target returns structured recovery diagnostic", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-non-editable",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-submit",
            role: "button",
            name: "Submit",
            rect: { x: 30, y: 90, width: 120, height: 32 },
          },
        ],
      },
    ],
    contentToolResponses: {
      yunti_fill: {
        filled: false,
        code: "TARGET_NOT_EDITABLE",
        error: "Target at uid yunti-submit is not editable (button type=submit: disabled, not editable)",
        element: {
          tag: "button",
          type: "submit",
          contentEditable: false,
          disabled: true,
          readOnly: false,
          hidden: false,
          editable: false,
        },
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-fill-button",
      tool: "yunti_fill",
      arguments: { uid: "yunti-submit", value: "hello" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      filled: false,
      uid: "yunti-submit",
      browserSessionId: "tab-1",
      action: "fill",
      target: { uid: "yunti-submit", method: "uid" },
      ok: false,
      recoverable: true,
      code: "TARGET_NOT_EDITABLE",
      error: "Target at uid yunti-submit is not editable (button type=submit: disabled, not editable)",
      element: {
        tag: "button",
        type: "submit",
        contentEditable: false,
        disabled: true,
        readOnly: false,
        hidden: false,
        editable: false,
      },
      recoveryHint: {
        reason: "uid-fill-failed",
        recommendedTools: ["yunti_observe_page", "yunti_take_snapshot", "yunti_evaluate_script", "yunti_fill"],
        nextAction: "inspect-target-element",
        decision: "inspect-editability-before-retry",
        uid: "yunti-submit",
        message: "The uid fill could not be completed. Refresh observation if the uid may be stale, inspect whether the target is editable, or retry with selector fallback.",
      },
      nextStepHint: "Uid fill failed. Observe again for a fresh uid, inspect whether the target is editable or a select with available options, or retry with selector fallback before repeating the same fill.",
    })
    assert.equal(
      harness.cdpCommands.some((command) => command.method === "Input.dispatchKeyEvent"),
      false
    )
  } finally {
    harness.restore()
  }
})

test("uid fill select option miss returns structured recovery diagnostic", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-select",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-select",
            role: "combobox",
            name: "Plan",
            rect: { x: 30, y: 90, width: 160, height: 30 },
          },
        ],
      },
    ],
    contentToolResponses: {
      yunti_fill: {
        filled: false,
        code: "OPTION_NOT_FOUND",
        error: "Option 'Enterprise' not found in select at uid yunti-select",
        availableValues: ["basic", "pro"],
        availableTexts: ["Basic", "Pro"],
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-fill-select-miss",
      tool: "yunti_fill",
      arguments: { uid: "yunti-select", value: "Enterprise" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      filled: false,
      uid: "yunti-select",
      browserSessionId: "tab-1",
      action: "fill",
      target: { uid: "yunti-select", method: "uid" },
      ok: false,
      recoverable: true,
      code: "OPTION_NOT_FOUND",
      error: "Option 'Enterprise' not found in select at uid yunti-select",
      availableValues: ["basic", "pro"],
      availableTexts: ["Basic", "Pro"],
      recoveryHint: {
        reason: "uid-fill-failed",
        recommendedTools: ["yunti_observe_page", "yunti_take_snapshot", "yunti_evaluate_script", "yunti_fill"],
        nextAction: "inspect-available-options",
        decision: "inspect-options-before-retry",
        uid: "yunti-select",
        availableValues: ["basic", "pro"],
        availableTexts: ["Basic", "Pro"],
        message: "The uid fill could not be completed. Refresh observation if the uid may be stale, inspect whether the target is editable, or retry with selector fallback.",
      },
      nextStepHint: "Uid fill failed. Observe again for a fresh uid, inspect whether the target is editable or a select with available options, or retry with selector fallback before repeating the same fill.",
    })
  } finally {
    harness.restore()
  }
})

test("selector select preserves content result with structured result", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_select: {
        selected: true,
        element: "select#plan",
        value: "pro",
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-select-selector",
      tool: "yunti_select",
      arguments: { selector: "#plan", value: "pro" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      selected: true,
      element: "select#plan",
      value: "pro",
      selector: "#plan",
      browserSessionId: "tab-1",
      action: "select",
      target: { selector: "#plan", method: "selector" },
      ok: true,
      recoverable: false,
      nextStepHint: "Select dispatched. Observe again, read page state, or evaluate the select value to verify the intended change.",
    })
  } finally {
    harness.restore()
  }
})

test("selector select value miss returns structured recovery diagnostic", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_select: {
        selected: true,
        element: "select#plan",
        value: "",
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-select-selector-miss",
      tool: "yunti_select",
      arguments: { selector: "#plan", value: "enterprise" },
    })

    const result = harness.posted.at(-1).result
    assert.equal(result.selected, false)
    assert.equal(result.code, "OPTION_NOT_FOUND")
    assert.equal(result.recoveryHint.nextAction, "inspect-available-options")
    assert.equal(result.recoveryHint.decision, "inspect-options-before-retry")
    assert.ok(result.recoveryHint.recommendedTools.includes("yunti_wait_for"))
  } finally {
    harness.restore()
  }
})

test("selector select disabled option returns structured recovery diagnostic", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_select: {
        selected: false,
        element: "select#plan",
        value: "basic",
        code: "OPTION_DISABLED",
        error: "Option value is disabled",
        disabledValue: "enterprise",
        disabledText: "Enterprise",
        options: [
          { value: "basic", text: "Basic", disabled: false, selected: true },
          { value: "enterprise", text: "Enterprise", disabled: true, selected: false },
        ],
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-select-selector-disabled",
      tool: "yunti_select",
      arguments: { selector: "#plan", value: "enterprise" },
    })

    const result = harness.posted.at(-1).result
    assert.equal(result.selected, false)
    assert.equal(result.code, "OPTION_DISABLED")
    assert.equal(result.recoveryHint.nextAction, "inspect-available-options")
    assert.equal(result.recoveryHint.decision, "choose-enabled-option-or-unlock-field")
    assert.ok(result.recoveryHint.recommendedTools.includes("yunti_wait_for"))
  } finally {
    harness.restore()
  }
})

test("selector select thrown failure returns structured recovery diagnostic", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_select: () => {
        throw new Error("Target is not a select element")
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-select-selector-not-select",
      tool: "yunti_select",
      arguments: { selector: ".plan-label", value: "pro" },
    })

    const result = harness.posted.at(-1).result
    assert.equal(result.selected, false)
    assert.equal(result.code, "SELECTOR_SELECT_FAILED")
    assert.equal(result.recoveryHint.nextAction, "inspect-target-element")
    assert.equal(result.recoveryHint.decision, "use-select-element-or-uid-fallback")
    assert.ok(result.recoveryHint.recommendedTools.includes("yunti_wait_for"))
  } finally {
    harness.restore()
  }
})

test("uid select value path preserves compatibility fields with structured result", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-select-uid",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-plan",
            role: "combobox",
            name: "Plan",
            rect: { x: 20, y: 30, width: 120, height: 24 },
          },
        ],
      },
    ],
    contentToolResponses: {
      yunti_select: {
        selected: true,
        value: "pro",
        text: "Pro",
        selectedIndex: 1,
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-select-uid",
      tool: "yunti_select",
      arguments: { uid: "yunti-plan", value: "pro" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      selected: true,
      uid: "yunti-plan",
      value: "pro",
      text: "Pro",
      selectedIndex: 1,
      browserSessionId: "tab-1",
      action: "select",
      target: { uid: "yunti-plan", method: "uid.value" },
      ok: true,
      recoverable: false,
      nextStepHint: "Uid select dispatched by option value without attaching Chrome debugger. Observe again, read page state, or evaluate the select value to verify the intended change.",
    })
    assert.deepEqual(
      harness.sentMessages.map((item) => item.message.tool),
      ["yunti_observe_page", "yunti_select"]
    )
    assert.deepEqual(harness.sentMessages.at(-1).message.arguments, {
      uid: "yunti-plan",
      value: "pro",
      x: 80,
      y: 42,
    })
    assert.deepEqual(harness.cdpCommands, [])
  } finally {
    harness.restore()
  }
})

test("uid select visible text path preserves compatibility fields with structured result", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-select-text",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-plan",
            role: "combobox",
            name: "Plan",
            rect: { x: 20, y: 30, width: 120, height: 24 },
          },
        ],
      },
    ],
    contentToolResponses: {
      yunti_select: {
        selected: true,
        value: "enterprise",
        text: "Enterprise",
        selectedIndex: 2,
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-select-uid-text",
      tool: "yunti_select",
      arguments: { uid: "yunti-plan", text: "Enterprise" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      selected: true,
      uid: "yunti-plan",
      value: "enterprise",
      text: "Enterprise",
      selectedIndex: 2,
      browserSessionId: "tab-1",
      action: "select",
      target: { uid: "yunti-plan", method: "uid.text" },
      ok: true,
      recoverable: false,
      nextStepHint: "Uid select dispatched by visible option text without attaching Chrome debugger. Observe again, read page state, or evaluate the select value to verify the intended change.",
    })
    assert.deepEqual(
      harness.sentMessages.map((item) => item.message.tool),
      ["yunti_observe_page", "yunti_select"]
    )
    assert.deepEqual(harness.sentMessages.at(-1).message.arguments, {
      uid: "yunti-plan",
      text: "Enterprise",
      x: 80,
      y: 42,
    })
    assert.deepEqual(harness.cdpCommands, [])
  } finally {
    harness.restore()
  }
})

test("uid select option miss returns structured recovery diagnostic", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-select-miss",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-plan",
            role: "combobox",
            name: "Plan",
            rect: { x: 20, y: 30, width: 120, height: 24 },
          },
        ],
      },
    ],
    contentToolResponses: {
      yunti_select: {
        selected: false,
        code: "OPTION_NOT_FOUND",
        error: "Option text not found",
        availableValues: ["free", "pro"],
        availableTexts: ["Free", "Pro"],
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-select-uid-miss",
      tool: "yunti_select",
      arguments: { uid: "yunti-plan", text: "Enterprise" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      selected: false,
      uid: "yunti-plan",
      browserSessionId: "tab-1",
      action: "select",
      target: { uid: "yunti-plan", method: "uid.text" },
      ok: false,
      recoverable: true,
      code: "OPTION_NOT_FOUND",
      error: "Option text not found",
      matchMode: "text",
      targetOption: "Enterprise",
      availableValues: ["free", "pro"],
      availableTexts: ["Free", "Pro"],
      recoveryHint: {
        reason: "uid-select-failed",
        recommendedTools: ["yunti_observe_page", "yunti_take_snapshot", "yunti_evaluate_script", "yunti_select"],
        nextAction: "inspect-available-options",
        decision: "inspect-options-before-retry",
        uid: "yunti-plan",
        matchMode: "text",
        targetOption: "Enterprise",
        availableValues: ["free", "pro"],
        availableTexts: ["Free", "Pro"],
        message: "The select option could not be matched. Inspect available options before retrying, refresh observation if the uid may be stale, or use selector/value fallback.",
      },
      nextStepHint: "Uid select failed. Inspect available options, observe again for a fresh uid, or retry with selector/value fallback before repeating the same select.",
    })
  } finally {
    harness.restore()
  }
})

test("uid select disabled option returns structured recovery diagnostic", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-select-disabled",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-plan",
            role: "combobox",
            name: "Plan",
            rect: { x: 20, y: 30, width: 120, height: 24 },
          },
        ],
      },
    ],
    contentToolResponses: {
      yunti_select: {
        selected: false,
        code: "OPTION_DISABLED",
        error: "Option text is disabled",
        disabledValue: "enterprise",
        disabledText: "Enterprise",
        availableValues: ["free", "enterprise"],
        availableTexts: ["Free", "Enterprise"],
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-select-uid-disabled",
      tool: "yunti_select",
      arguments: { uid: "yunti-plan", text: "Enterprise" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      selected: false,
      uid: "yunti-plan",
      browserSessionId: "tab-1",
      action: "select",
      target: { uid: "yunti-plan", method: "uid.text" },
      ok: false,
      recoverable: true,
      code: "OPTION_DISABLED",
      error: "Option text is disabled",
      matchMode: "text",
      targetOption: "Enterprise",
      disabledValue: "enterprise",
      disabledText: "Enterprise",
      availableValues: ["free", "enterprise"],
      availableTexts: ["Free", "Enterprise"],
      recoveryHint: {
        reason: "uid-select-failed",
        recommendedTools: ["yunti_observe_page", "yunti_take_snapshot", "yunti_evaluate_script", "yunti_select"],
        nextAction: "inspect-available-options",
        decision: "choose-enabled-option-or-unlock-field",
        uid: "yunti-plan",
        matchMode: "text",
        targetOption: "Enterprise",
        availableValues: ["free", "enterprise"],
        availableTexts: ["Free", "Enterprise"],
        disabledValue: "enterprise",
        disabledText: "Enterprise",
        message: "The select option could not be matched. Inspect available options before retrying, refresh observation if the uid may be stale, or use selector/value fallback.",
      },
      nextStepHint: "Uid select failed. Inspect available options, observe again for a fresh uid, or retry with selector/value fallback before repeating the same select.",
    })
  } finally {
    harness.restore()
  }
})

test("uid select non-select target returns structured recovery diagnostic", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-select-not-select",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-label",
            role: "text",
            name: "Plan",
            rect: { x: 20, y: 30, width: 120, height: 24 },
          },
        ],
      },
    ],
    contentToolResponses: {
      yunti_select: {
        selected: false,
        code: "NOT_SELECT",
        error: "Element at uid is not a select element",
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-select-uid-not-select",
      tool: "yunti_select",
      arguments: { uid: "yunti-label", value: "pro" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      selected: false,
      uid: "yunti-label",
      browserSessionId: "tab-1",
      action: "select",
      target: { uid: "yunti-label", method: "uid.value" },
      ok: false,
      recoverable: true,
      code: "NOT_SELECT",
      error: "Element at uid is not a select element",
      matchMode: "value",
      targetOption: "pro",
      recoveryHint: {
        reason: "uid-select-failed",
        recommendedTools: ["yunti_observe_page", "yunti_take_snapshot", "yunti_evaluate_script", "yunti_select"],
        nextAction: "inspect-target-element",
        decision: "use-select-element-or-selector-fallback",
        uid: "yunti-label",
        matchMode: "value",
        targetOption: "pro",
        message: "The select option could not be matched. Inspect available options before retrying, refresh observation if the uid may be stale, or use selector/value fallback.",
      },
      nextStepHint: "Uid select failed. Inspect available options, observe again for a fresh uid, or retry with selector/value fallback before repeating the same select.",
    })
  } finally {
    harness.restore()
  }
})

test("fill form preserves aggregate fields with structured result", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-fill-form",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-name",
            role: "textbox",
            name: "Name",
            rect: { x: 20, y: 30, width: 120, height: 24 },
          },
          {
            uid: "yunti-plan",
            role: "combobox",
            name: "Plan",
            rect: { x: 40, y: 70, width: 140, height: 28 },
          },
        ],
      },
    ],
    contentToolResponses: {
      yunti_fill: (message) => {
        if (message.arguments.selector === "#missing") {
          throw new Error("selector not found")
        }
        if (message.arguments.uid === "yunti-plan") {
          return {
            filled: false,
            code: "OPTION_NOT_FOUND",
            error: "Option 'Enterprise' not found in select at uid yunti-plan",
            availableValues: ["basic", "pro"],
            availableTexts: ["Basic", "Pro"],
          }
        }
        return { filled: true, element: "input#email", valueLength: 13 }
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-fill-form",
      tool: "yunti_fill_form",
      arguments: {
        fields: [
          { uid: "yunti-name", value: "Ada" },
          { uid: "yunti-plan", value: "Enterprise" },
          { selector: "#email", value: "ada@test.dev" },
          { selector: "#missing", value: "nope" },
        ],
      },
    })

    const result = harness.posted.at(-1).result
    assert.equal(result.filled, 2)
    assert.equal(result.failed, 2)
    assert.equal(result.results[3].recoveryHint.nextAction, "observe-again")
    assert.ok(result.results[3].recoveryHint.recommendedTools.includes("yunti_wait_for"))
  } finally {
    harness.restore()
  }
})

test("wait_for selector success returns structured result fields", async () => {
  const harness = createDispatcherHarness({
    cdpResponses: [
      {
        result: {
          value: {
            found: "selector",
            selector: "#ready",
          },
        },
      },
    ],
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-wait-selector",
      tool: "yunti_wait_for",
      arguments: { selector: "#ready", timeoutMs: 1000 },
    })

    const result = harness.posted.at(-1).result
    assert.equal(result.found, "selector")
    assert.equal(result.selector, "#ready")
    assert.equal(result.condition, "selector")
    assert.equal(result.browserSessionId, "tab-1")
    assert.equal(result.action, "wait_for")
    assert.deepEqual(result.target, { selector: "#ready", timeoutMs: 1000 })
    assert.equal(result.ok, true)
    assert.equal(result.recoverable, false)
    assert.match(result.nextStepHint, /yunti_observe_page/)
    assert.equal(harness.cdpCommands.at(-1).method, "Runtime.evaluate")
  } finally {
    harness.restore()
  }
})

test("wait_for traverses open shadow roots and same-origin iframe documents", async () => {
  const harness = createDispatcherHarness({
    cdpResponses: [
      {
        result: {
          value: {
            found: "text",
            text: "Deep ready",
          },
        },
      },
    ],
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-wait-deep-tree",
      tool: "yunti_wait_for",
      arguments: { text: "Deep ready", timeoutMs: 1000 },
    })

    const command = harness.cdpCommands.at(-1)
    assert.equal(command.method, "Runtime.evaluate")
    assert.match(command.params.expression, /node\.shadowRoot/)
    assert.match(command.params.expression, /node\.contentDocument/)
    assert.match(command.params.expression, /root\.textContent/)
    assert.equal(harness.posted.at(-1).result.ok, true)
    assert.equal(harness.posted.at(-1).result.condition, "text")
  } finally {
    harness.restore()
  }
})

test("wait_for timeout returns structured recovery diagnostics", async () => {
  const harness = createDispatcherHarness()
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }
  const originalNow = Date.now
  let now = 1000
  Date.now = () => {
    now += 250
    return now
  }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-wait-timeout",
      tool: "yunti_wait_for",
      arguments: { text: "Loaded", timeoutMs: 100 },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      found: false,
      waitedMs: 100,
      browserSessionId: "tab-1",
      action: "wait_for",
      target: { text: "Loaded", timeoutMs: 100 },
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
    })
  } finally {
    Date.now = originalNow
    harness.restore()
  }
})

test("uid fill reports value-not-applied when field value does not remain", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-controlled-input",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-controlled",
            role: "textbox",
            name: "Controlled",
            rect: { x: 30, y: 90, width: 180, height: 28 },
          },
        ],
      },
    ],
    contentToolResponses: {
      yunti_fill: {
        filled: true,
        valueLength: 5,
        valueApplied: false,
        method: "dom",
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-fill-controlled",
      tool: "yunti_fill",
      arguments: { uid: "yunti-controlled", value: "hello" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      filled: false,
      uid: "yunti-controlled",
      browserSessionId: "tab-1",
      action: "fill",
      target: { uid: "yunti-controlled", method: "uid" },
      ok: false,
      recoverable: true,
      code: "VALUE_NOT_APPLIED",
      error: "Filled value did not remain on uid yunti-controlled",
      valueLength: 5,
      valueApplied: false,
      method: "dom",
      expectedValueLength: 5,
      recoveryHint: {
        reason: "uid-fill-failed",
        recommendedTools: ["yunti_observe_page", "yunti_take_snapshot", "yunti_evaluate_script", "yunti_fill"],
        nextAction: "verify-field-state",
        decision: "inspect-controlled-or-masked-field-before-retry",
        uid: "yunti-controlled",
        message: "The fill dispatched, but the field value did not remain afterward. Inspect whether the target is framework-controlled, masked, or requires typing/press_key semantics before retrying.",
      },
      nextStepHint: "Uid fill failed. Observe again for a fresh uid, inspect whether the target is editable or a select with available options, or retry with selector fallback before repeating the same fill.",
    })
    assert.deepEqual(harness.cdpCommands, [])
  } finally {
    harness.restore()
  }
})

test("uid type text preserves compatibility fields with structured result", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-type",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-input",
            role: "textbox",
            name: "Search",
            rect: { x: 30, y: 90, width: 160, height: 30 },
          },
        ],
      },
    ],
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-type-uid",
      tool: "yunti_type_text",
      arguments: { uid: "yunti-input", text: "hi" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      typed: true,
      uid: "yunti-input",
      text: "hi",
      textLength: 2,
      mode: "append",
      method: "dom",
      browserSessionId: "tab-1",
      action: "type_text",
      target: { uid: "yunti-input", method: "dom" },
      ok: true,
      recoverable: false,
      nextStepHint: "Type text dispatched without attaching Chrome debugger. Observe again, read page state, or evaluate the field value to verify the intended change.",
    })
    assert.deepEqual(harness.sentMessages.map((item) => item.message.tool), ["yunti_observe_page", "yunti_type_text"])
    assert.deepEqual(harness.cdpCommands, [])
  } finally {
    harness.restore()
  }
})

test("selector type text preserves content result with structured result", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_type_text: {
        typed: true,
        element: "input#search",
        textLength: 5,
        mode: "append",
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-type-selector",
      tool: "yunti_type_text",
      arguments: { selector: "#search", text: "hello" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      typed: true,
      element: "input#search",
      textLength: 5,
      mode: "append",
      browserSessionId: "tab-1",
      action: "type_text",
      target: { selector: "#search", method: "selector" },
      ok: true,
      recoverable: false,
      nextStepHint: "Type text dispatched. Observe again, read page state, or evaluate the active field value to verify the intended change.",
    })
  } finally {
    harness.restore()
  }
})

test("uid press key preserves compatibility fields with structured result", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-press",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-input",
            role: "textbox",
            name: "Search",
            rect: { x: 30, y: 90, width: 160, height: 30 },
          },
        ],
      },
    ],
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-press-uid",
      tool: "yunti_press_key",
      arguments: { uid: "yunti-input", key: "Enter" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      pressed: true,
      uid: "yunti-input",
      key: "Enter",
      valueChanged: false,
      browserSessionId: "tab-1",
      action: "press_key",
      target: { uid: "yunti-input", method: "dom" },
      ok: true,
      recoverable: false,
      nextStepHint: "Key press dispatched without attaching Chrome debugger. Observe again, read page state, or evaluate the field value to verify the intended effect.",
    })
    assert.deepEqual(harness.sentMessages.map((item) => item.message.tool), ["yunti_observe_page", "yunti_press_key"])
    assert.deepEqual(harness.cdpCommands, [])
  } finally {
    harness.restore()
  }
})

test("selector press key preserves content result with structured result", async () => {
  const harness = createDispatcherHarness({
    contentToolResponses: {
      yunti_press_key: {
        pressed: true,
        key: "Backspace",
        element: "input#search",
        valueChanged: true,
      },
    },
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-press-selector",
      tool: "yunti_press_key",
      arguments: { selector: "#search", key: "Backspace" },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      pressed: true,
      key: "Backspace",
      element: "input#search",
      valueChanged: true,
      browserSessionId: "tab-1",
      action: "press_key",
      target: { selector: "#search", method: "selector" },
      ok: true,
      recoverable: false,
      nextStepHint: "Key press dispatched. Observe again, read page state, or evaluate the active field value to verify the intended effect.",
    })
  } finally {
    harness.restore()
  }
})

test("uid upload file preserves compatibility fields with structured result", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-upload",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-file",
            role: "textbox",
            name: "Upload",
            rect: { x: 30, y: 90, width: 160, height: 30 },
          },
        ],
      },
    ],
    cdpResponses: [
      { backendNodeId: 1234 },
      {},
    ],
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-upload-uid",
      tool: "yunti_upload_file",
      arguments: { uid: "yunti-file", filePaths: ["/tmp/example.txt"] },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      uploaded: true,
      fileCount: 1,
      filePaths: ["/tmp/example.txt"],
      browserSessionId: "tab-1",
      action: "upload_file",
      target: { uid: "yunti-file", method: "uid" },
      ok: true,
      recoverable: false,
      nextStepHint: "File upload dispatched. Observe again, read page state, or verify the selected file input before submitting any form.",
    })
    assert.deepEqual(
      harness.cdpCommands.map((command) => command.method),
      ["DOM.getNodeForLocation", "DOM.setFileInputFiles"]
    )
  } finally {
    harness.restore()
  }
})

test("selector upload file preserves compatibility fields with structured result", async () => {
  const harness = createDispatcherHarness({
    cdpResponses: [
      { root: { nodeId: 1 } },
      { nodeId: 2 },
      { node: { backendNodeId: 5678 } },
      {},
    ],
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-upload-selector",
      tool: "yunti_upload_file",
      arguments: { selector: "#file", filePaths: ["/tmp/a.txt", "/tmp/b.txt"] },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      uploaded: true,
      fileCount: 2,
      filePaths: ["/tmp/a.txt", "/tmp/b.txt"],
      browserSessionId: "tab-1",
      action: "upload_file",
      target: { selector: "#file", method: "selector" },
      ok: true,
      recoverable: false,
      nextStepHint: "File upload dispatched. Observe again, read page state, or verify the selected file input before submitting any form.",
    })
    assert.deepEqual(
      harness.cdpCommands.map((command) => command.method),
      ["DOM.getDocument", "DOM.querySelector", "DOM.describeNode", "DOM.setFileInputFiles"]
    )
  } finally {
    harness.restore()
  }
})

test("coordinate drag preserves compatibility fields with structured result", async () => {
  const harness = createDispatcherHarness()
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-drag",
      tool: "yunti_drag",
      arguments: { fromX: 10.2, fromY: 20.7, toX: 80.4, toY: 120.8, steps: 2 },
    })

    assert.deepEqual(harness.posted.at(-1).result, {
      dragged: true,
      from: { x: 10, y: 21 },
      to: { x: 80, y: 121 },
      steps: 2,
      browserSessionId: "tab-1",
      action: "drag",
      target: {
        method: "coordinate",
        from: { x: 10, y: 21 },
        to: { x: 80, y: 121 },
      },
      ok: true,
      recoverable: false,
      nextStepHint: "Drag dispatched. Observe again or read page state to verify the intended movement or drop result.",
    })
    assert.deepEqual(
      harness.cdpCommands
        .filter((command) => command.method === "Input.dispatchMouseEvent")
        .map((command) => command.params.type),
      ["mousePressed", "mouseMoved", "mouseMoved", "mouseReleased"]
    )
  } finally {
    harness.restore()
  }
})

test("missing uid now points agents back to observe or snapshot", async () => {
  const harness = createDispatcherHarness()
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-click",
      tool: "yunti_click",
      arguments: { uid: "missing" },
    })

    const result = harness.posted.at(-1)
    assert.equal(result.ok, true)
    assert.equal(result.result.ok, false)
    assert.match(result.result.error, /yunti_observe_page again/)
    assert.deepEqual(harness.cdpCommands, [])
  } finally {
    harness.restore()
  }
})

test("latest observation replaces stale uid map", async () => {
  const harness = createDispatcherHarness({
    observations: [
      {
        observationId: "obs-1",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-1",
            role: "button",
            name: "Old button",
            rect: { x: 10, y: 20, width: 100, height: 40 },
          },
        ],
      },
      {
        observationId: "obs-2",
        browserSessionId: "tab-1",
        uidMapVersion: "observe-v1",
        elements: [
          {
            uid: "yunti-2",
            role: "button",
            name: "New button",
            rect: { x: 200, y: 80, width: 60, height: 30 },
          },
        ],
      },
    ],
  })
  const session = { browserSessionId: "tab-1", userId: "local", url: "https://example.test/" }

  try {
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe-1",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })
    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-observe-2",
      tool: "yunti_observe_page",
      arguments: { redaction: "balanced" },
    })

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-old-click",
      tool: "yunti_click",
      arguments: { uid: "yunti-1" },
    })
    const staleResult = harness.posted.at(-1)
    assert.equal(staleResult.ok, true)
    assert.equal(staleResult.result.ok, false)
    assert.match(staleResult.result.error, /yunti_observe_page again/)

    await harness.dispatcher.executeToolRequest(123, session, {
      id: "req-new-click",
      tool: "yunti_click",
      arguments: { uid: "yunti-2" },
    })
    const clickResult = harness.posted.at(-1)
    assert.equal(clickResult.ok, true)
    assert.deepEqual(clickResult.result, {
      clicked: true,
      uid: "yunti-2",
      x: 230,
      y: 95,
      browserSessionId: "tab-1",
      action: "click",
      target: { uid: "yunti-2", x: 230, y: 95 },
      ok: true,
      recoverable: false,
      nextStepHint: "Click dispatched without attaching Chrome debugger. Observe again or read page state to verify the intended change.",
    })
    assert.deepEqual(harness.cdpCommands, [])
  } finally {
    harness.restore()
  }
})
