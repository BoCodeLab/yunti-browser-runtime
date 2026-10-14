import test from "node:test"
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { createToolDispatcher } from "../extension/tool-handlers.js"

const runBrowser = process.env.YUNTI_E2E === "1"

test("observed uid actions keep node identity through layout changes and reject replacements", { skip: !runBrowser }, async () => {
  const { chromium } = await import("playwright-core")
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.YUNTI_E2E_EXECUTABLE_PATH || chromium.executablePath(),
  })
  const priorChrome = globalThis.chrome
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 650 } })
    await page.setContent(`<button id="a" style="position:absolute;top:40px;left:40px;width:100px;height:40px">A</button>
      <button id="b" style="position:absolute;top:140px;left:40px;width:100px;height:40px">B</button>
      <input id="field" style="position:absolute;top:240px;left:40px" />
      <input id="upload-a" aria-label="Upload A" type="file" style="position:absolute;top:340px;left:40px;width:220px" />
      <input id="upload-b" aria-label="Upload B" type="file" style="position:absolute;top:440px;left:40px;width:220px" />`)
    await page.evaluate(() => {
      globalThis.clicks = []
      document.addEventListener("click", event => globalThis.clicks.push(event.target.id))
      globalThis.chrome = { runtime: {
        onMessage: { addListener(fn) { globalThis.listener = fn }, removeListener() {} },
        sendMessage: async () => ({ supported: false }),
      } }
    })
    await page.addScriptTag({ path: resolve("extension/dom-observer.js") })
    await page.addScriptTag({ path: resolve("extension/content.js") })
    const session = { browserSessionId: "fixture", tabId: 1, kind: "page" }, posted = []
    globalThis.chrome = { tabs: {
      get: async () => ({ id: 1, url: "about:blank" }), query: async () => [],
      sendMessage: async (_tab, message) => page.evaluate(message => new Promise(resolve => globalThis.listener(message, {}, resolve)), message),
    } }
    const cdpSession = await page.context().newCDPSession(page)
    const dispatcher = createToolDispatcher({
      sessionsByTab: new Map([[1, session]]), postBridge: async (_path, result) => posted.push(result),
      ensureTabRegistered: async () => ({ ok: true, session }), cdp: {
        ensureCdpAttached: async () => {},
        chromeDebuggerSendCommand: async (_target, method, params) => cdpSession.send(method, params),
      },
    })
    let id = 0
    const call = async (tool, args = {}) => {
      await dispatcher.executeToolRequest(1, session, { id: String(++id), tool, arguments: args })
      return posted.at(-1).result ?? posted.at(-1).failure
    }
    const observe = () => call("yunti_observe_page")
    let observation = await observe()
    const a = observation.elements.find(e => e.name === "A")
    await page.evaluate(() => { document.querySelector("#a").style.top = "140px"; document.querySelector("#b").style.top = "40px" })
    assert.equal((await call("yunti_click", { uid: a.uid })).ok, true)
    assert.deepEqual(await page.evaluate(() => globalThis.clicks), ["a"])

    observation = await observe()
    const currentA = observation.elements.find(e => e.name === "A")
    await call("yunti_click", { uid: currentA.uid, selector: "#b" })
    assert.equal(await page.evaluate(() => globalThis.clicks.at(-1)), "a")
    await page.evaluate(() => { document.querySelector("#a").outerHTML = document.querySelector("#a").outerHTML })
    assert.equal((await call("yunti_click", { uid: currentA.uid })).ok, false)
    assert.equal(await page.evaluate(() => globalThis.clicks.length), 2)

    observation = await observe()
    const freshA = observation.elements.find(e => e.name === "A")
    await page.evaluate(() => { document.querySelector("#a").disabled = true })
    assert.equal((await call("yunti_click", { uid: freshA.uid, timeoutMs: 0 })).ok, false)
    const field = observation.elements.find(e => e.tag === "input")
    await page.evaluate(() => { document.querySelector("#field").outerHTML = document.querySelector("#field").outerHTML })
    assert.equal((await call("yunti_fill", { uid: field.uid, value: "wrong target" })).ok, false)
    assert.equal(await page.locator("#field").inputValue(), "")
    observation = await observe()
    const upload = observation.elements.find(element => element.name === "Upload A")
    assert.ok(upload)
    await page.evaluate(() => { document.querySelector("#upload-a").style.top = "440px"; document.querySelector("#upload-b").style.top = "340px" })
    assert.equal((await call("yunti_upload_file", { uid: upload.uid, filePaths: [resolve("scripts/soak/fixtures/upload.txt")] })).ok, true)
    assert.equal(await page.locator("#upload-a").evaluate(element => element.files.length), 1)
    assert.equal(await page.locator("#upload-b").evaluate(element => element.files.length), 0)
    await page.evaluate(() => { document.querySelector("#upload-a").outerHTML = document.querySelector("#upload-a").outerHTML })
    assert.equal((await call("yunti_upload_file", { uid: upload.uid, filePaths: [resolve("scripts/soak/fixtures/upload.txt")] })).ok, false)
    assert.equal(await page.locator("#upload-a").evaluate(element => element.files.length), 0)
    await page.evaluate(() => {
      for (const [name, top] of [["panel-a", 440], ["panel-b", 540]]) {
        const panel = document.createElement("div")
        panel.id = name
        panel.style.cssText = `position:absolute;left:300px;top:${top}px;width:200px;height:80px;overflow:auto`
        panel.innerHTML = '<div style="height:600px">scroll fixture</div>'
        document.body.append(panel)
      }
    })
    observation = await observe()
    const panel = observation.scrollableContainers.find(element => element.name === "panel-a")
    assert.ok(panel)
    await page.evaluate(() => { document.querySelector("#panel-a").style.top = "540px"; document.querySelector("#panel-b").style.top = "440px" })
    assert.equal((await call("yunti_scroll", { uid: panel.uid, deltaY: 120 })).ok, true)
    assert.equal(await page.locator("#panel-a").evaluate(element => element.scrollTop), 120)
    assert.equal(await page.locator("#panel-b").evaluate(element => element.scrollTop), 0)
    await page.evaluate(() => {
      const table = document.createElement("table")
      table.innerHTML = Array.from({ length: 12 }, (_, r) => `<tr>${Array.from({ length: 12 }, (_, c) => `<td>${r}:${c}</td>`).join("")}</tr>`).join("")
      document.body.append(table)
    })
    const snapshot = await call("yunti_get_page_snapshot", { mode: "detailed" })
    assert.equal(snapshot.tables[0].totalRows, 12)
    assert.equal(snapshot.tables[0].returnedRows, 5)
    assert.equal(snapshot.tables[0].totalCols, 12)
    assert.equal(snapshot.tables[0].returnedCols, 10)
    assert.equal(snapshot.tables[0].truncated, true)
    await page.evaluate(() => { document.querySelector("#a").disabled = false })
    const ax = await call("yunti_take_snapshot")
    const axA = ax.elements.find(element => element.name === "A" && element.role === "button")
    await page.evaluate(() => { document.querySelector("#a").style.top = "40px"; document.querySelector("#b").style.top = "140px" })
    assert.equal((await call("yunti_click", { uid: axA.uid })).ok, true)
    assert.equal(await page.evaluate(() => globalThis.clicks.at(-1)), "a")
    await page.evaluate(() => {
      const cover = document.createElement("div")
      cover.style.cssText = "position:fixed;inset:0;z-index:1000;background:white"
      document.body.append(cover)
    })
    const clicksBefore = await page.evaluate(() => globalThis.clicks.length)
    assert.equal((await call("yunti_click", { uid: axA.uid })).ok, false)
    assert.equal(await page.evaluate(() => globalThis.clicks.length), clicksBefore)
  } finally {
    globalThis.chrome = priorChrome
    await browser.close()
  }
})
