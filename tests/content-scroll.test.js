import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import vm from "node:vm"

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

class FakeElement {
  constructor(tagName, attrs = {}, options = {}) {
    this.tagName = tagName.toUpperCase()
    this.nodeType = 1
    this.id = attrs.id || ""
    this.className = attrs.className || ""
    this.attrs = { ...attrs }
    this.innerText = options.innerText || ""
    this.textContent = options.textContent || this.innerText || ""
    this.parentElement = options.parentElement || null
    this.children = options.children || []
    this.contentDocument = options.contentDocument || null
    this.contentWindow = options.contentWindow || (this.contentDocument ? { document: this.contentDocument } : null)
    this.shadowRoot = options.shadowRoot || null
    this.style = options.style || { display: "block", visibility: "visible", opacity: "1" }
    this.scrollLeft = options.scrollLeft || 0
    this.scrollTop = options.scrollTop || 0
    this.scrollWidth = options.scrollWidth || 100
    this.scrollHeight = options.scrollHeight || 100
    this.clientWidth = options.clientWidth || 100
    this.clientHeight = options.clientHeight || 100
    this.rect = options.rect || { x: 0, y: 0, width: 100, height: 100 }
    this.events = []
    for (const child of this.children) child.parentElement = this
  }

  getAttribute(name) {
    return this.attrs[name] ?? null
  }

  getBoundingClientRect() {
    return {
      ...this.rect,
      left: this.rect.x,
      top: this.rect.y,
      right: this.rect.x + this.rect.width,
      bottom: this.rect.y + this.rect.height,
    }
  }

  scrollBy({ left = 0, top = 0 }) {
    this.scrollLeft += Number(left || 0)
    this.scrollTop += Number(top || 0)
  }

  scrollIntoView() {}

  click() {
    this.clicked = true
  }

  dispatchEvent(event) {
    if (event?.type) this.events.push(event.type)
    return true
  }

  focus() {}
}

function createContentHarness({ elementFromPoint, documentScrollTop = 0 } = {}) {
  const body = new FakeElement("body")
  const documentElement = new FakeElement("html", {}, {
    scrollTop: documentScrollTop,
    scrollHeight: 2000,
    clientHeight: 600,
  })
  const scrollingElement = new FakeElement("html", {}, {
    scrollTop: documentScrollTop,
    scrollHeight: 2000,
    clientHeight: 600,
  })
  const createEventTarget = () => {
    const listeners = new Map()
    return {
      listeners,
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type).add(listener)
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener)
      },
    }
  }
  const documentEvents = createEventTarget()
  const windowEvents = createEventTarget()
  const observers = []
  const messageListeners = []
  const document = {
    title: "Scroll Test",
    body,
    documentElement,
    scrollingElement,
    forms: [],
    querySelector: () => null,
    querySelectorAll: () => [],
    elementFromPoint: elementFromPoint || (() => null),
    addEventListener: documentEvents.addEventListener,
    removeEventListener: documentEvents.removeEventListener,
    createTreeWalker: () => ({ currentNode: null, nextNode: () => false }),
  }
  const context = {
    document,
    location: new URL("https://example.test/scroll"),
    navigator: { userAgent: "Chrome/123", platform: "macOS", language: "en-US" },
    window: {
      innerWidth: 800,
      innerHeight: 600,
      confirm: () => true,
      addEventListener: windowEvents.addEventListener,
      removeEventListener: windowEvents.removeEventListener,
    },
    history: { pushState() {}, replaceState() {} },
    MutationObserver: class FakeMutationObserver {
      constructor(callback) {
        this.callback = callback
        this.connected = false
        observers.push(this)
      }

      observe() {
        this.connected = true
      }

      disconnect() {
        this.connected = false
      }
    },
    Node: { ELEMENT_NODE: 1 },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    Event: class FakeEvent {
      constructor(type, options = {}) {
        this.type = type
        this.bubbles = Boolean(options.bubbles)
      }
    },
    MouseEvent: class FakeMouseEvent {
      constructor(type, options = {}) {
        this.type = type
        Object.assign(this, options)
      }
    },
    HTMLSelectElement: FakeElement,
    HTMLTextAreaElement: FakeElement,
    CSS: { escape: (value) => String(value) },
    Map,
    URL,
    Date,
    setTimeout,
    clearTimeout,
    getComputedStyle: (element) => element.style || {},
    chrome: {
      runtime: {
        onMessage: {
          addListener: (listener) => {
            messageListeners.push(listener)
          },
          removeListener: (listener) => {
            const index = messageListeners.indexOf(listener)
            if (index >= 0) messageListeners.splice(index, 1)
          },
        },
        sendMessage: async (message) => {
          if (message?.type === "yunti_is_supported_page") return { supported: true }
          if (message?.type === "yunti_content_ready") {
            return { ok: true, session: { browserSessionId: "tab-1", auth: { loggedIn: false } } }
          }
          return { ok: true }
        },
      },
    },
  }
  context.window.window = context.window
  context.window.document = document
  context.window.getComputedStyle = context.getComputedStyle
  vm.createContext(context)
  const source = readFileSync(resolve("extension/content.js"), "utf8")
  vm.runInContext(source, context, { filename: "extension/content.js" })
  const runtime = context.__YUNTI_BROWSER_RUNTIME_CONTENT__
  Object.assign(context, runtime?._private || {})
  context.__yuntiTest = {
    messageListeners,
    windowListeners: windowEvents.listeners,
    documentListeners: documentEvents.listeners,
    connectedObserverCount: () => observers.filter((observer) => observer.connected).length,
  }
  return context
}

function createDocumentStub({ elementFromPoint } = {}) {
  return {
    title: "Nested Document",
    body: new FakeElement("body"),
    documentElement: new FakeElement("html", {}, {
      scrollTop: 0,
      scrollHeight: 800,
      clientHeight: 300,
    }),
    scrollingElement: new FakeElement("html", {}, {
      scrollTop: 0,
      scrollHeight: 800,
      clientHeight: 300,
    }),
    forms: [],
    querySelector: () => null,
    querySelectorAll: () => [],
    elementFromPoint: elementFromPoint || (() => null),
  }
}

test("content script does not inject a visible Yunti page widget", () => {
  const source = readFileSync(resolve("extension/content.js"), "utf8")

  assert.doesNotMatch(source, /yunti-browser-runtime-widget/)
  assert.doesNotMatch(source, /installWidget|updateWidgetStatus|data-toggle|data-refresh/)
  assert.doesNotMatch(source, /当前页面临时增强|刷新连接/)
})

function loadContentRuntime(context) {
  const source = readFileSync(resolve("extension/content.js"), "utf8")
  vm.runInContext(source, context, { filename: "extension/content.js" })
  return context
}

async function dispatchContentMessage(context, message) {
  const responses = []
  await Promise.all(
    [...context.__yuntiTest.messageListeners].map((listener) =>
      new Promise((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          resolve()
        }
        const handled = listener(message, {}, (response) => {
          responses.push(response)
          finish()
        })
        if (handled !== true) finish()
        setTimeout(finish, 200)
      })
    )
  )
  return responses
}

test("content runtime replaces its previous instance when reinjected", async () => {
  const context = createContentHarness()

  const initialResponses = await dispatchContentMessage(context, { type: "yunti_refresh_registration" })
  assert.equal(initialResponses.length, 1)
  assert.equal(initialResponses[0]?.ok, true, JSON.stringify(initialResponses[0]))
  assert.equal(typeof context.__YUNTI_BROWSER_RUNTIME_CONTENT__?.teardown, "function")
  assert.equal(context.__yuntiTest.windowListeners.get("popstate")?.size, 1)
  const firstListener = context.__yuntiTest.messageListeners[0]

  assert.doesNotThrow(() => loadContentRuntime(context))

  assert.equal(context.__yuntiTest.messageListeners.length, 1)
  assert.notEqual(context.__yuntiTest.messageListeners[0], firstListener)
  assert.equal(context.__YUNTI_BROWSER_RUNTIME_CONTENT__.revision, 1)
  assert.equal(context.__yuntiTest.windowListeners.get("popstate")?.size ?? 0, 0)

  const reinstalledResponses = await dispatchContentMessage(context, { type: "yunti_refresh_registration" })
  assert.equal(reinstalledResponses.length, 1)
  assert.equal(reinstalledResponses[0]?.ok, true, JSON.stringify(reinstalledResponses[0]))
  assert.equal(context.__yuntiTest.windowListeners.get("popstate")?.size, 1)
  assert.equal(context.__yuntiTest.windowListeners.get("hashchange")?.size, 1)
  assert.equal(context.__yuntiTest.documentListeners.get("visibilitychange")?.size, 1)
  assert.equal(context.__yuntiTest.connectedObserverCount(), 1)

  const toolResponses = await dispatchContentMessage(context, {
    type: "yunti_execute_tool",
    tool: "yunti_observe_page",
    arguments: {},
  })
  assert.equal(toolResponses.length, 1)
  assert.equal(typeof toolResponses[0], "object")
})

test("content scroll reports coordinate container hit metadata", () => {
  const item = new FakeElement("button", {}, { innerText: "Load more" })
  const panel = new FakeElement("div", { id: "results" }, {
    children: [item],
    style: { display: "block", visibility: "visible", opacity: "1", overflowY: "auto", overflowX: "hidden" },
    scrollTop: 120,
    scrollHeight: 900,
    clientHeight: 300,
  })
  const context = createContentHarness({ elementFromPoint: () => item })

  const result = context.scrollPage({ x: 50, y: 120, deltaY: 200 })

  assert.equal(result.scrolled, true)
  assert.equal(result.target.selector, "#results")
  assert.deepEqual(plain(result.before), { left: 0, top: 120 })
  assert.deepEqual(plain(result.after), { left: 0, top: 320 })
  assert.deepEqual(plain(result.coordinateTarget), {
    x: 50,
    y: 120,
    found: true,
    element: {
      selector: "div > button",
      tag: "button",
      id: null,
      className: null,
      text: "Load more",
    },
  })
  assert.equal(result.scrollContainerFound, true)
  assert.equal(result.coordinateScrollFallback, undefined)
})

test("content scroll reports coordinate document fallback metadata", () => {
  const context = createContentHarness({ elementFromPoint: () => null, documentScrollTop: 40 })

  const result = context.scrollPage({ x: 999, y: -10, deltaY: 160 })

  assert.equal(result.scrolled, true)
  assert.equal(result.target, "document")
  assert.deepEqual(plain(result.before), { left: 0, top: 40 })
  assert.deepEqual(plain(result.after), { left: 0, top: 200 })
  assert.deepEqual(plain(result.coordinateTarget), {
    x: 799,
    y: 0,
    found: false,
  })
  assert.equal(result.scrollContainerFound, false)
  assert.equal(result.coordinateScrollFallback, "document")
})

test("content scroll resolves same-origin iframe coordinate targets", () => {
  const childButton = new FakeElement("button", { id: "child-action" }, {
    innerText: "Child action",
    rect: { x: 10, y: 15, width: 100, height: 30 },
  })
  const childDocument = createDocumentStub({
    elementFromPoint: (x, y) => (x === 30 && y === 45 ? childButton : null),
  })
  const frame = new FakeElement("iframe", { id: "child-frame" }, {
    rect: { x: 100, y: 200, width: 300, height: 200 },
    contentDocument: childDocument,
  })
  const context = createContentHarness({
    elementFromPoint: (x, y) => (x === 130 && y === 245 ? frame : null),
  })

  const result = context.scrollPage({ x: 130, y: 245, deltaY: 160 })

  assert.equal(result.scrolled, true)
  assert.deepEqual(plain(result.coordinateTarget), {
    x: 130,
    y: 245,
    found: true,
    element: {
      selector: "#child-action",
      tag: "button",
      id: "child-action",
      className: null,
      text: "Child action",
    },
  })
  assert.equal(result.scrollContainerFound, false)
  assert.equal(result.coordinateScrollFallback, "document")
})

test("content coordinate actions pierce open shadow roots", () => {
  const shadowButton = new FakeElement("button", { id: "shadow-action" }, {
    innerText: "Shadow action",
  })
  const shadowRoot = {
    elementFromPoint: (x, y) => (x === 160 && y === 90 ? shadowButton : null),
  }
  const host = new FakeElement("div", { id: "shadow-host" }, { shadowRoot })
  const context = createContentHarness({
    elementFromPoint: (x, y) => (x === 160 && y === 90 ? host : null),
  })

  const result = context.clickAt({ x: 160, y: 90 })

  assert.equal(result.clicked, true)
  assert.ok(shadowButton.events.includes("click"))
  assert.equal(result.element.selector, "#shadow-action")
})

test("content click selector auto-waits for element appearance", async () => {
  const button = new FakeElement("button", { id: "menu" }, { innerText: "Open menu" })
  let ready = false
  const context = createContentHarness()
  context.document.querySelector = (selector) => selector === "#menu" && ready ? button : null
  setTimeout(() => { ready = true }, 50)

  const result = await context.clickElement({ selector: "#menu", timeoutMs: 250 })

  assert.equal(result.clicked, true)
  assert.equal(result.element.selector, "#menu")
  assert.ok(result.actionability.waitedMs >= 0)
})

test("content fill selector auto-waits for disabled target to become enabled", async () => {
  const input = new FakeElement("input", { id: "name" }, {
    rect: { x: 20, y: 20, width: 180, height: 32 },
  })
  input.value = ""
  input.disabled = true
  const context = createContentHarness()
  context.document.querySelector = (selector) => selector === "#name" ? input : null
  setTimeout(() => { input.disabled = false }, 50)

  const result = await context.fillElement({ selector: "#name", value: "Yunti", timeoutMs: 250 })

  assert.equal(result.filled, true)
  assert.equal(result.valueApplied, true)
  assert.equal(input.value, "Yunti")
  assert.ok(result.actionability.waitedMs >= 0)
})

test("content click selector returns structured actionability timeout", async () => {
  const context = createContentHarness()
  context.document.querySelector = () => null

  const result = await context.clickElement({ selector: "#missing", timeoutMs: 0 })

  assert.deepEqual(plain(result), {
    clicked: false,
    selector: "#missing",
    code: "ELEMENT_NOT_FOUND",
    error: "Element not found: #missing",
    actionability: {
      waitedMs: 0,
      retryable: true,
    },
  })
})
