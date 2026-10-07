import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import vm from "node:vm"

class FakeElement {
  constructor(tagName, attrs = {}, options = {}) {
    this.tagName = tagName.toUpperCase()
    this.attrs = { ...attrs }
    this.id = attrs.id || ""
    this.value = options.value || ""
    this.innerText = options.innerText || ""
    this.textContent = options.textContent || this.innerText || ""
    this.disabled = Boolean(options.disabled)
    this.readOnly = Boolean(options.readOnly)
    this.checked = Boolean(options.checked)
    this.selected = Boolean(options.selected)
    this.selectedIndex = Number.isFinite(Number(options.selectedIndex)) ? Number(options.selectedIndex) : -1
    this.options = options.options || []
    this.isContentEditable = attrs.contenteditable === "true" || attrs.contenteditable === ""
    this.rect = options.rect || { x: 0, y: 0, width: 100, height: 24 }
    this.style = options.style || { display: "block", visibility: "visible", opacity: "1" }
    this.scrollTop = options.scrollTop || 0
    this.scrollLeft = options.scrollLeft || 0
    this.scrollHeight = options.scrollHeight || this.rect.height
    this.scrollWidth = options.scrollWidth || this.rect.width
    this.clientHeight = options.clientHeight || this.rect.height
    this.clientWidth = options.clientWidth || this.rect.width
    this.parentElement = options.parentElement || null
    this.parentNode = options.parentNode || this.parentElement || null
    this.shadowRoot = options.shadowRoot || null
    this.contentDocument = options.contentDocument || null
    this.contentWindow = options.contentWindow || (this.contentDocument ? { document: this.contentDocument } : null)
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

  closest() {
    let current = this.parentElement
    while (current) {
      if (matchesSelector(current, arguments[0])) return current
      current = current.parentElement || null
    }
    return null
  }

  getRootNode() {
    if (this.parentNode?.host) return this.parentNode
    return this.parentNode || null
  }
}

function matchesSelector(element, selector) {
  if (!element || !selector) return false
  if (selector === "label") return element.tagName?.toLowerCase?.() === "label"
  if (selector.startsWith("#")) return element.id === selector.slice(1)
  return false
}

class FakeAnchorElement extends FakeElement {
  constructor(attrs = {}, options = {}) {
    super("a", attrs, options)
    this.href = attrs.href || ""
  }
}

function createDocument(elements, options = {}) {
  const documentElement = {
    scrollWidth: options.pageWidth || 1024,
    scrollHeight: options.pageHeight || 768,
    clientWidth: options.viewportWidth || 800,
    clientHeight: options.viewportHeight || 600,
  }
  const labels = new Map(Object.entries(options.labels || {}))
  return {
    title: options.title || "Yunti Test",
    readyState: options.readyState || "complete",
    documentElement,
    scrollingElement: {
      ...documentElement,
      scrollLeft: options.scrollX || 0,
      scrollTop: options.scrollY || 0,
    },
    body: options.bodyText
      ? { innerText: options.bodyText, textContent: options.bodyText }
      : {},
    querySelector(selector) {
      const labelFor = selector.match(/^label\[for="(.+)"\]$/)?.[1]
      if (labelFor && labels.has(labelFor)) {
        return { innerText: labels.get(labelFor), textContent: labels.get(labelFor) }
      }
      const id = selector.match(/^#([\w-]+)$/)?.[1]
      if (id) return elements.find((element) => element?.id === id) || null
      return null
    },
    querySelectorAll(selector) {
      if (selector === "body *") return elements
      return elements.filter(isInteractiveFakeElement)
    },
  }
}

function createShadowRoot(elements, options = {}) {
  const root = {
    host: options.host || null,
    querySelector(selector) {
      const labelFor = selector.match(/^label\[for="(.+)"\]$/)?.[1]
      if (labelFor) {
        return elements.find((element) => {
          if (element.tagName?.toLowerCase?.() !== "label") return false
          return element.getAttribute("for") === labelFor
        }) || null
      }
      const id = selector.match(/^#([\w-]+)$/)?.[1]
      if (id) return flattenElements(elements).find((element) => element?.id === id) || null
      return null
    },
    querySelectorAll(selector) {
      if (selector === "body *") return flattenElements(elements)
      return flattenElements(elements).filter(isInteractiveFakeElement)
    },
  }
  for (const element of elements) {
    if (element.parentNode == null) element.parentNode = root
    if (element.parentElement == null && !root.host) element.parentElement = null
  }
  return root
}

function flattenElements(elements) {
  const out = []
  const queue = [...elements]
  while (queue.length) {
    const element = queue.shift()
    if (!element) continue
    out.push(element)
    if (element.shadowRoot?.querySelectorAll) {
      for (const child of element.shadowRoot.querySelectorAll("body *")) queue.push(child)
    }
  }
  return out
}

function isInteractiveFakeElement(element) {
  const tag = element.tagName.toLowerCase()
  return (
    ["a", "button", "input", "select", "textarea"].includes(tag) ||
    element.getAttribute("role") ||
    element.getAttribute("onclick") ||
    element.getAttribute("contenteditable") !== null
  )
}

function loadObserver({ document, location, viewport = {}, sessionId = "tab-1", onContext } = {}) {
  const source = readFileSync(resolve("extension/dom-observer.js"), "utf8")
  const observers = []
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      observers.push(this)
    }

    observe(target, options) {
      this.target = target
      this.options = options
    }

    disconnect() {
      this.disconnected = true
    }

    trigger() {
      if (!this.disconnected) this.callback([])
    }
  }
  const context = {
    document,
    location,
    URL,
    HTMLAnchorElement: FakeAnchorElement,
    globalThis: null,
    innerWidth: viewport.width || 800,
    innerHeight: viewport.height || 600,
    scrollX: viewport.scrollX || 0,
    scrollY: viewport.scrollY || 0,
    devicePixelRatio: 1,
    __YUNTI_BROWSER_SESSION_ID__: sessionId,
    CSS: { escape: (value) => String(value) },
    getComputedStyle: (element) => element.style || {},
    MutationObserver: FakeMutationObserver,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(source, context, { filename: "extension/dom-observer.js" })
  context.__testObservers = observers
  onContext?.(context)
  return context.YuntiBrowserRuntimeObserver
}

function elementNames(observation) {
  return Array.from(observation.elements, (element) => element.name)
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test("DOM observer returns fresh uids, text tree, and balanced redaction", () => {
  const elements = [
    new FakeElement("input", { id: "keyword", name: "keyword", placeholder: "Search" }, {
      value: "blue widgets",
      rect: { x: 20, y: 20, width: 180, height: 32 },
    }),
    new FakeElement("input", { id: "password", name: "password", type: "password" }, {
      value: "demo-password-value",
      rect: { x: 20, y: 70, width: 180, height: 32 },
    }),
    new FakeElement("input", { id: "apiKey", name: "api_key", type: "hidden" }, {
      value: "exampleApiKeyValue",
      rect: { x: 0, y: 0, width: 0, height: 0 },
      style: { display: "none", visibility: "hidden", opacity: "1" },
    }),
    new FakeElement("button", {}, {
      innerText: "查询",
      rect: { x: 220, y: 20, width: 80, height: 32 },
    }),
    new FakeAnchorElement(
      { href: "https://example.test/detail?token=example-token-value&id=42" },
      { innerText: "详情", rect: { x: 20, y: 120, width: 80, height: 24 } }
    ),
  ]
  const document = createDocument(elements, {
    labels: { keyword: "关键词" },
    pageHeight: 1200,
    viewportHeight: 600,
  })
  const observer = loadObserver({
    document,
    location: new URL("https://example.test/search?session=example-session-value&q=ok"),
    viewport: { width: 800, height: 600 },
  })

  const observation = observer.observePage({ includeHidden: true, redaction: "balanced" })

  assert.equal(observation.browserSessionId, "tab-1")
  assert.equal(observation.uidMapVersion, "observe-v1")
  assert.match(observation.elements[0].uid, /^yunti-.+-1$/)
  assert.equal(observation.elements[0].name, "关键词")
  assert.equal(observation.elements[0].editable, true)
  assert.equal(observation.elements[0].fillable, true)
  assert.equal(observation.elements[1].valuePreview, "[REDACTED]")
  assert.equal(observation.elements[1].valueRedacted, true)
  assert.equal(observation.elements[2].valuePreview, "[REDACTED]")
  assert.equal(observation.elements[2].visible, false)
  assert.equal(observation.elements[2].fillBlockReason, "hidden-or-not-visible")
  assert.match(observation.textTree, /\[yunti-[^\]]+-1\]<input/)
  assert.match(observation.textTree, /\[yunti-[^\]]+-4\]<button/)
  assert.equal(observation.redactions.mode, "balanced")
  assert.ok(observation.redactions.categories.includes("password"))
  assert.ok(observation.redactions.categories.includes("token"))
  assert.equal(observation.redactions.screenshotRedacted, false)
  assert.equal(JSON.stringify(observation).includes("demo-password-value"), false)
  assert.equal(JSON.stringify(observation).includes("exampleApiKeyValue"), false)
  assert.equal(JSON.stringify(observation).includes("example-session-value"), false)
})

test("DOM observer returns document and container scroll metadata", () => {
  const scrollContainer = new FakeElement("div", { id: "results" }, {
    rect: { x: 10, y: 90, width: 360, height: 280 },
    style: { display: "block", visibility: "visible", opacity: "1", overflowY: "auto", overflowX: "hidden" },
    scrollTop: 120,
    scrollHeight: 920,
    clientHeight: 280,
  })
  const elements = [
    new FakeElement("button", {}, {
      innerText: "Load more",
      rect: { x: 20, y: 20, width: 100, height: 32 },
    }),
    scrollContainer,
  ]
  const document = createDocument(elements, {
    pageWidth: 900,
    pageHeight: 1800,
    viewportWidth: 800,
    viewportHeight: 600,
    scrollY: 300,
  })
  const observer = loadObserver({
    document,
    location: new URL("https://example.test/list"),
    viewport: { width: 800, height: 600, scrollY: 300 },
  })

  const observation = observer.observePage({ maxElements: 10 })

  assert.equal(observation.scroll.y, 300)
  assert.equal(observation.scroll.pixelsBelow, 900)
  assert.equal(observation.scroll.pagesBelow, 1.5)
  assert.equal(observation.scrollableContainers.length, 1)
  assert.match(observation.scrollableContainers[0].uid, /^scroll-.+-1$/)
  assert.equal(observation.scrollableContainers[0].pixelsBelow, 520)
  assert.ok(observation.hints.some((hint) => /content below/.test(hint)))
  assert.ok(observation.hints.some((hint) => /Scrollable containers/.test(hint)))
})

test("DOM observer generates fresh uids for every full observation", () => {
  const button = new FakeElement("button", { id: "save" }, {
    innerText: "Save",
    rect: { x: 20, y: 20, width: 100, height: 32 },
  })
  const observer = loadObserver({
    document: createDocument([button]),
    location: new URL("https://example.test/fresh-uids"),
  })

  const first = observer.observePage()
  const second = observer.observePage()

  assert.notEqual(first.elements[0].uid, second.elements[0].uid)
  assert.notEqual(first.observationId, second.observationId)
})

test("DOM observer excludes hidden and offscreen elements by default", () => {
  const elements = [
    new FakeElement("button", {}, {
      innerText: "Visible action",
      rect: { x: 20, y: 20, width: 120, height: 32 },
    }),
    new FakeElement("button", {}, {
      innerText: "Hidden action",
      rect: { x: 20, y: 70, width: 120, height: 32 },
      style: { display: "none", visibility: "hidden", opacity: "1" },
    }),
    new FakeElement("button", {}, {
      innerText: "Below fold",
      rect: { x: 20, y: 900, width: 120, height: 32 },
    }),
  ]
  const observer = loadObserver({
    document: createDocument(elements, { pageHeight: 1200, viewportHeight: 600 }),
    location: new URL("https://example.test/actions"),
    viewport: { width: 800, height: 600 },
  })

  const viewportObservation = observer.observePage()
  assert.deepEqual(elementNames(viewportObservation), ["Visible action"])
  assert.equal(viewportObservation.limits.mode, "viewport")
  assert.ok(viewportObservation.hints.some((hint) => /content below/.test(hint)))

  const fullPageObservation = observer.observePage({ mode: "fullPage" })
  assert.deepEqual(elementNames(fullPageObservation), ["Visible action", "Below fold"])
  assert.equal(fullPageObservation.limits.mode, "fullPage")

  const hiddenObservation = observer.observePage({ mode: "fullPage", includeHidden: true })
  assert.deepEqual(elementNames(hiddenObservation), [
    "Visible action",
    "Hidden action",
    "Below fold",
  ])
  assert.equal(hiddenObservation.elements.find((element) => element.name === "Hidden action").visible, false)
})

test("DOM observer handles redaction edge modes conservatively", () => {
  const tokenValue = "Bearer abcdefghijklmnopqrstuvwxyz1234567890"
  const longRandom = "fixture_1234567890abcdefghijklmnopqrstuvwxyzABCDEF"
  const elements = [
    new FakeElement("input", { id: "auth", name: "authorization" }, {
      value: tokenValue,
      rect: { x: 20, y: 20, width: 260, height: 32 },
    }),
    new FakeElement("input", { id: "ordinary", name: "query" }, {
      value: "ordinary business text",
      rect: { x: 20, y: 70, width: 260, height: 32 },
    }),
    new FakeElement("input", { id: "strict", name: "reference" }, {
      value: "sixteen-char-ref",
      rect: { x: 20, y: 120, width: 260, height: 32 },
    }),
    new FakeElement("input", { id: "random", name: "note" }, {
      value: longRandom,
      rect: { x: 20, y: 170, width: 260, height: 32 },
    }),
  ]
  const document = createDocument(elements)
  const location = new URL("https://example.test/settings?api_key=secret-api-key-value&safe=1")
  const observer = loadObserver({ document, location })

  const balanced = observer.observePage({ redaction: "balanced" })
  const balancedText = JSON.stringify(balanced)
  assert.equal(balanced.elements[0].valuePreview, "[REDACTED]")
  assert.equal(balanced.elements[1].valuePreview, "ordinary business text")
  assert.equal(balanced.elements[3].valuePreview, "[REDACTED]")
  assert.equal(balancedText.includes(tokenValue), false)
  assert.equal(balancedText.includes(longRandom), false)
  assert.equal(balancedText.includes("secret-api-key-value"), false)
  assert.ok(balanced.redactions.categories.includes("token"))

  const strict = observer.observePage({ redaction: "strict" })
  assert.equal(strict.elements[1].valuePreview, "[REDACTED]")
  assert.equal(strict.elements[2].valuePreview, "[REDACTED]")

  const off = observer.observePage({ redaction: "off" })
  assert.equal(off.elements[0].valuePreview, tokenValue.slice(0, 120))
  assert.equal(off.redactions.count, 0)
  assert.ok(off.warnings.some((warning) => /redaction is off/i.test(warning)))
})

test("DOM observer strict redaction covers PII-like text surfaces", () => {
  const email = "jane.doe@example.com"
  const phone = "+1 (415) 555-1234"
  const card = "4111 1111 1111 1111"
  const address = "123 Market Street"
  const elements = [
    new FakeElement("input", { id: "contact", name: "contact" }, {
      value: email,
      rect: { x: 20, y: 20, width: 260, height: 32 },
    }),
    new FakeElement("button", {}, {
      innerText: `Call ${phone}`,
      rect: { x: 20, y: 70, width: 260, height: 32 },
    }),
    new FakeElement("textarea", { id: "shipTo", name: "shipTo", "aria-label": `Ship to ${address}` }, {
      value: address,
      rect: { x: 20, y: 120, width: 260, height: 80 },
    }),
    new FakeElement("select", { id: "billing", name: "billing" }, {
      value: card,
      selectedIndex: 0,
      rect: { x: 20, y: 220, width: 260, height: 32 },
      options: [
        { value: card, text: `Visa ${card}`, selected: true },
        { value: "standard", text: "Standard" },
      ],
    }),
    new FakeElement("input", { id: "ordinary", name: "query" }, {
      value: "ordinary business text",
      rect: { x: 20, y: 270, width: 260, height: 32 },
    }),
  ]
  const document = createDocument(elements, { title: `Profile ${email}` })
  const observer = loadObserver({
    document,
    location: new URL("https://example.test/profile"),
  })

  const balanced = observer.observePage({ redaction: "balanced" })
  assert.equal(balanced.elements[4].valuePreview, "ordinary business text")

  const strict = observer.observePage({ redaction: "strict" })
  const strictJson = JSON.stringify(strict)
  assert.equal(strict.page.title, "[REDACTED]")
  assert.equal(strict.elements[0].valuePreview, "[REDACTED]")
  assert.equal(strict.elements[1].name, "[REDACTED]")
  assert.equal(strict.elements[2].name, "[REDACTED]")
  assert.equal(strict.elements[2].valuePreview, "[REDACTED]")
  const select = strict.elements[3]
  assert.equal(select.selectedValue, "[REDACTED]")
  assert.equal(select.selectedText, "[REDACTED]")
  assert.equal(select.options[0].value, "[REDACTED]")
  assert.equal(select.options[0].text, "[REDACTED]")
  assert.equal(strictJson.includes(email), false)
  assert.equal(strictJson.includes(phone), false)
  assert.equal(strictJson.includes(card), false)
  assert.equal(strictJson.includes(address), false)
  assert.ok(strict.redactions.categories.includes("email"))
  assert.ok(strict.redactions.categories.includes("phone"))
  assert.ok(strict.redactions.categories.includes("payment_card"))
  assert.ok(strict.redactions.categories.includes("address"))
})

test("DOM observer reports field fillability and select option summaries", () => {
  const elements = [
    new FakeElement("input", { id: "enabled", name: "enabled" }, {
      value: "ready",
      rect: { x: 20, y: 20, width: 220, height: 32 },
    }),
    new FakeElement("input", { id: "locked", name: "locked" }, {
      value: "locked",
      readOnly: true,
      rect: { x: 20, y: 70, width: 220, height: 32 },
    }),
    new FakeElement("button", { type: "submit" }, {
      innerText: "Submit",
      rect: { x: 20, y: 120, width: 100, height: 32 },
    }),
    new FakeElement("select", { id: "plan", name: "plan" }, {
      value: "basic",
      selectedIndex: 0,
      rect: { x: 20, y: 170, width: 220, height: 32 },
      options: [
        { value: "basic", text: "Basic", selected: true },
        { value: "enterprise", text: "Enterprise" },
      ],
    }),
  ]
  const observer = loadObserver({
    document: createDocument(elements),
    location: new URL("https://example.test/form"),
  })

  const observation = observer.observePage()
  const enabled = observation.elements.find((element) => element.name === "enabled")
  const locked = observation.elements.find((element) => element.name === "locked")
  const button = observation.elements.find((element) => element.name === "Submit")
  const plan = observation.elements.find((element) => element.name === "plan")

  assert.equal(enabled.editable, true)
  assert.equal(enabled.fillable, true)
  assert.equal(locked.readOnly, true)
  assert.equal(locked.fillable, false)
  assert.equal(locked.fillBlockReason, "readonly")
  assert.equal(button.editable, false)
  assert.equal(button.fillable, false)
  assert.equal(button.fillBlockReason, "not-editable")
  assert.equal(plan.editable, true)
  assert.equal(plan.fillable, true)
  assert.equal(plan.selectedIndex, 0)
  assert.equal(plan.selectedValue, "basic")
  assert.equal(plan.selectedValueRedacted, false)
  assert.equal(plan.selectedText, "Basic")
  assert.deepEqual(JSON.parse(JSON.stringify(plan.options)), [
    { value: "basic", text: "Basic", selected: true, disabled: false, valueRedacted: false },
    { value: "enterprise", text: "Enterprise", selected: false, disabled: false, valueRedacted: false },
  ])
})

test("DOM observer can find bounded interactive matches without full observation", () => {
  const elements = [
    new FakeElement("button", {}, {
      innerText: "Save draft",
      rect: { x: 20, y: 20, width: 120, height: 32 },
    }),
    new FakeElement("button", {}, {
      innerText: "Submit order",
      rect: { x: 20, y: 70, width: 120, height: 32 },
    }),
    new FakeElement("input", { placeholder: "Search orders" }, {
      rect: { x: 20, y: 120, width: 180, height: 32 },
    }),
  ]
  const observer = loadObserver({
    document: createDocument(elements, { pageHeight: 900, viewportHeight: 600 }),
    location: new URL("https://example.test/find"),
    viewport: { width: 800, height: 600 },
  })

  const saveMatches = observer.findElements({ query: "save", role: "button" })
  assert.equal(saveMatches.matchCount, 1)
  assert.equal(saveMatches.matches[0].name, "Save draft")
  assert.match(saveMatches.matches[0].uid, /^yunti-.+-1$/)

  const placeholderMatches = observer.findElements({ placeholder: "search", tag: "input" })
  assert.equal(placeholderMatches.matchCount, 1)
  assert.equal(placeholderMatches.matches[0].placeholder, "Search orders")

  const none = observer.findElements({ query: "archive", maxResults: 2 })
  assert.equal(none.matchCount, 0)
  assert.match(none.hints[0], /No matching interactive elements/)
})

test("DOM observer includes open shadow-root interactive targets in observe and find", () => {
  const shadowHost = new FakeElement("div", { id: "shadow-host" }, {
    rect: { x: 10, y: 10, width: 300, height: 120 },
  })
  const shadowLabel = new FakeElement("label", { for: "shadow-input" }, {
    innerText: "Shadow input",
    textContent: "Shadow input",
    parentElement: null,
  })
  const shadowInput = new FakeElement("input", { id: "shadow-input", placeholder: "Shadow search" }, {
    rect: { x: 20, y: 20, width: 180, height: 32 },
    parentElement: shadowLabel,
  })
  const shadowButton = new FakeElement("button", { id: "shadow-save" }, {
    innerText: "Shadow save",
    rect: { x: 20, y: 70, width: 120, height: 32 },
  })
  const shadowScrollable = new FakeElement("div", { id: "shadow-results", "aria-label": "Shadow results" }, {
    rect: { x: 20, y: 110, width: 220, height: 120 },
    style: { display: "block", visibility: "visible", opacity: "1", overflowY: "auto", overflowX: "hidden" },
    scrollTop: 40,
    scrollHeight: 420,
    clientHeight: 120,
  })
  const shadowRoot = createShadowRoot([shadowLabel, shadowInput, shadowButton, shadowScrollable], { host: shadowHost })
  shadowHost.shadowRoot = shadowRoot

  const widgetHost = new FakeElement("div", { id: "yunti-browser-runtime-widget" }, {
    rect: { x: 700, y: 500, width: 44, height: 44 },
  })
  const widgetButton = new FakeElement("button", {}, {
    innerText: "Refresh connection",
    rect: { x: 700, y: 500, width: 120, height: 32 },
  })
  const widgetRoot = createShadowRoot([widgetButton], { host: widgetHost })
  widgetHost.shadowRoot = widgetRoot

  const observer = loadObserver({
    document: createDocument([shadowHost, widgetHost], { pageHeight: 1200, viewportHeight: 600 }),
    location: new URL("https://example.test/shadow"),
    viewport: { width: 800, height: 600 },
  })

  const observation = observer.observePage({ mode: "fullPage" })
  assert.deepEqual(elementNames(observation), ["Shadow input", "Shadow save"])
  assert.equal(observation.scrollableContainers.length, 1)
  assert.equal(observation.scrollableContainers[0].name, "Shadow results")
  assert.match(observation.textTree, /Shadow save/)
  assert.equal(JSON.stringify(observation).includes("Refresh connection"), false)

  const foundButton = observer.findElements({ query: "shadow save", role: "button" })
  assert.equal(foundButton.matchCount, 1)
  assert.equal(foundButton.matches[0].name, "Shadow save")

  const foundInput = observer.findElements({ placeholder: "shadow", tag: "input" })
  assert.equal(foundInput.matchCount, 1)
  assert.equal(foundInput.matches[0].name, "Shadow input")
})

test("DOM observer includes same-origin iframe interactive targets in observe and find", () => {
  const childButton = new FakeElement("button", { id: "child-action" }, {
    innerText: "Child action",
    rect: { x: 12, y: 18, width: 110, height: 32 },
  })
  const childInput = new FakeElement("input", { id: "child-input", placeholder: "Child search" }, {
    rect: { x: 12, y: 60, width: 180, height: 32 },
  })
  const childScrollable = new FakeElement("div", { id: "child-results", "aria-label": "Child results" }, {
    rect: { x: 12, y: 110, width: 220, height: 120 },
    style: { display: "block", visibility: "visible", opacity: "1", overflowY: "auto", overflowX: "hidden" },
    scrollTop: 50,
    scrollHeight: 480,
    clientHeight: 120,
  })
  const childDocument = createDocument([childButton, childInput, childScrollable], {
    title: "Child frame",
    pageHeight: 700,
    viewportHeight: 280,
  })
  const frame = new FakeElement("iframe", { id: "child-frame", title: "child frame" }, {
    rect: { x: 120, y: 200, width: 320, height: 260 },
    contentDocument: childDocument,
  })

  const observer = loadObserver({
    document: createDocument([frame], { pageHeight: 1400, viewportHeight: 600 }),
    location: new URL("https://example.test/iframe-host"),
    viewport: { width: 800, height: 600 },
  })

  const observation = observer.observePage({ mode: "fullPage" })
  assert.deepEqual(elementNames(observation), ["Child action", "Child search"])
  const childAction = observation.elements.find((element) => element.name === "Child action")
  const childInputMatch = observation.elements.find((element) => element.name === "Child search")
  assert.deepEqual(plain(childAction.rect), { x: 132, y: 218, width: 110, height: 32 })
  assert.deepEqual(plain(childInputMatch.rect), { x: 132, y: 260, width: 180, height: 32 })
  assert.equal(observation.scrollableContainers.length, 1)
  assert.equal(observation.scrollableContainers[0].name, "Child results")
  assert.deepEqual(plain(observation.scrollableContainers[0].rect), { x: 132, y: 310, width: 220, height: 120 })

  const buttonMatches = observer.findElements({ query: "child action", role: "button" })
  assert.equal(buttonMatches.matchCount, 1)
  assert.equal(buttonMatches.matches[0].name, "Child action")
  assert.deepEqual(plain(buttonMatches.matches[0].rect), { x: 132, y: 218, width: 110, height: 32 })

  const inputMatches = observer.findElements({ placeholder: "child", tag: "input" })
  assert.equal(inputMatches.matchCount, 1)
  assert.equal(inputMatches.matches[0].name, "Child search")
})

test("DOM observer wait resolves an already-satisfied selector without touching the background", async () => {
  const ready = new FakeElement("button", { id: "ready" }, {
    innerText: "Ready",
    rect: { x: 10, y: 10, width: 90, height: 32 },
  })
  const observer = loadObserver({
    document: createDocument([ready], { pageHeight: 600, viewportHeight: 600 }),
    location: new URL("https://example.test/wait-immediate"),
  })

  const match = await observer.waitForCondition({ selector: "#ready", timeoutMs: 1000 })

  assert.equal(match.found, "selector")
  assert.equal(match.selector, "#ready")
  assert.equal(match.waitedMs, 0)
})

test("DOM observer wait resolves from a mutation before the deadline", async () => {
  const elements = []
  const document = createDocument(elements, { pageHeight: 600, viewportHeight: 600 })
  let context = null
  const observer = loadObserver({
    document,
    location: new URL("https://example.test/wait-mutation"),
    onContext: (value) => {
      context = value
    },
  })

  const pending = observer.waitForCondition({ selector: "#late-target", timeoutMs: 5000 })
  elements.push(new FakeElement("div", { id: "late-target" }, {
    rect: { x: 0, y: 0, width: 120, height: 40 },
  }))
  context.__testObservers.at(-1).trigger()

  const match = await pending
  assert.equal(match.found, "selector")
  assert.equal(match.selector, "#late-target")
  assert.ok(match.waitedMs < 5000, `expected a mutation-driven match, got waitedMs=${match.waitedMs}`)
  assert.equal(context.__testObservers.at(-1).disconnected, true)
})

test("DOM observer wait traverses open shadow roots and same-origin iframes", async () => {
  const shadowHost = new FakeElement("div", { id: "shadow-host" }, {
    rect: { x: 0, y: 0, width: 300, height: 120 },
  })
  shadowHost.shadowRoot = createShadowRoot([
    new FakeElement("button", { id: "shadow-ready" }, {
      innerText: "Shadow ready",
      rect: { x: 10, y: 10, width: 110, height: 32 },
    }),
  ], { host: shadowHost })
  const childDocument = createDocument([], { bodyText: "Frame ready", pageHeight: 400, viewportHeight: 300 })
  const frame = new FakeElement("iframe", { id: "child-frame" }, {
    rect: { x: 120, y: 200, width: 320, height: 260 },
    contentDocument: childDocument,
  })
  const observer = loadObserver({
    document: createDocument([shadowHost, frame], { pageHeight: 900, viewportHeight: 600 }),
    location: new URL("https://example.test/wait-deep"),
  })

  const shadowMatch = await observer.waitForCondition({ selector: "#shadow-ready", timeoutMs: 1000 })
  assert.equal(shadowMatch.found, "selector")
  assert.equal(shadowMatch.selector, "#shadow-ready")

  const iframeMatch = await observer.waitForCondition({ text: "Frame ready", timeoutMs: 1000 })
  assert.equal(iframeMatch.found, "text")
  assert.equal(iframeMatch.text, "Frame ready")
})

test("DOM observer wait resolves null once the deadline passes", async () => {
  let context = null
  const observer = loadObserver({
    document: createDocument([], { pageHeight: 600, viewportHeight: 600 }),
    location: new URL("https://example.test/wait-timeout"),
    onContext: (value) => {
      context = value
    },
  })

  const match = await observer.waitForCondition({ text: "never appears", timeoutMs: 100 })

  assert.equal(match, null)
  assert.equal(context.__testObservers.at(-1).disconnected, true)
})

test("DOM observer wait matches a client-side URL change", async () => {
  const location = new URL("https://example.test/start")
  const observer = loadObserver({
    document: createDocument([], { pageHeight: 600, viewportHeight: 600 }),
    location,
  })

  const pending = observer.waitForCondition({ urlContains: "/dashboard", timeoutMs: 5000 })
  location.href = "https://example.test/dashboard"

  const match = await pending
  assert.equal(match.found, true)
  assert.equal(match.condition, "urlContains")
  assert.equal(match.value, "/dashboard")
})

test("DOM observer cancels pending waits when the page runtime is torn down", async () => {
  const elements = []
  const document = createDocument(elements, { pageHeight: 600, viewportHeight: 600 })
  const observer = loadObserver({
    document,
    location: new URL("https://example.test/wait-cancel"),
  })

  const pending = observer.waitForCondition({ selector: "#late", timeoutMs: 5000 })
  assert.equal(observer.cancelPendingWaits(), 1)

  const match = await pending
  assert.equal(match, null)

  // A later DOM change must not resurrect the cancelled subscription.
  elements.push(new FakeElement("div", { id: "late" }, {
    rect: { x: 0, y: 0, width: 10, height: 10 },
  }))
  assert.equal(observer.cancelPendingWaits(), 0)
})

test("DOM observer delta response returns a lighter change summary without full elements payload", () => {
  const saveButton = new FakeElement("button", {}, {
    innerText: "Save draft",
    rect: { x: 20, y: 20, width: 120, height: 32 },
  })
  const observer = loadObserver({
    document: createDocument([saveButton], { pageHeight: 900, viewportHeight: 600 }),
    location: new URL("https://example.test/delta"),
    viewport: { width: 800, height: 600 },
  })

  const first = observer.observePage({ responseMode: "full" })
  assert.equal(first.responseMode, "full")
  assert.equal(first.elements.length, 1)

  saveButton.innerText = "Save changes"
  saveButton.textContent = "Save changes"

  const delta = observer.observePage({ responseMode: "delta" })
  assert.equal(delta.responseMode, "delta")
  assert.equal(delta.elements, undefined)
  assert.equal(delta.textTree, undefined)
  assert.equal(delta.delta.firstObservation, false)
  assert.equal(delta.delta.textTreeChanged, true)
  assert.ok(delta.delta.changedElementCount >= 1)
  assert.ok(
    delta.delta.changedElements.updated.length +
      delta.delta.changedElements.added.length +
      delta.delta.changedElements.removed.length >= 1
  )
  assert.equal(delta.baselineObservationId, first.observationId)
  assert.match(delta.fullObservationHint, /responseMode=full/)
  assert.match(delta.hints[0], /Run full yunti_observe_page/)
})
