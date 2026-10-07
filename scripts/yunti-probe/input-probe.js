#!/usr/bin/env node
// Bounded confirmation probe:
//  - CDP Input.dispatchMouseEvent paths (yunti_drag, yunti_click_at) vs the
//    Runtime.evaluate/mouseClick path used by uid/selector clicks
//  - empty dataUrl from yunti_capture_visible_tab
// Usage: node scripts/yunti-probe/input-probe.js
import { spawn } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..")
const FIXTURE_PORT = Number(process.env.YUNTI_PROBE_FIXTURE_PORT || 49771)
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}/`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...p) => console.error("[input-probe]", ...p)

class Mcp {
  constructor() {
    this.child = spawn(process.execPath, [join(ROOT, "mcp", "server.js")], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] })
    this.pending = new Map()
    this.nextId = 1
    this.child.stderr.on("data", () => {})
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      const text = line.trim()
      if (!text) return
      let msg
      try { msg = JSON.parse(text) } catch { return }
      const waiter = this.pending.get(msg.id)
      if (waiter) { this.pending.delete(msg.id); waiter(msg) }
    })
  }
  request(method, params, timeoutMs) {
    const id = this.nextId++
    return new Promise((resolvePromise) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolvePromise({ id, timedOut: true }) }, timeoutMs)
      this.pending.set(id, (msg) => { clearTimeout(timer); resolvePromise(msg) })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    })
  }
  async callTool(name, toolArgs, timeoutMs = 30_000) {
    const startedAt = Date.now()
    const msg = await this.request("tools/call", { name, arguments: toolArgs }, timeoutMs)
    const elapsedMs = Date.now() - startedAt
    const blocks = msg.result?.content || []
    const image = blocks.find((b) => b.type === "image")
    let payload = msg.result?.structuredContent
    if (!payload && blocks[0]?.text) { try { payload = JSON.parse(blocks[0].text) } catch { payload = blocks[0].text } }
    return {
      tool: name,
      elapsedMs,
      noResponse: Boolean(msg.timedOut),
      isError: msg.result?.isError === true,
      code: payload?.code || null,
      imageBytes: image?.data?.length ?? 0,
      payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : null,
      payload,
    }
  }
  stop() { try { this.child.stdin.end(); this.child.kill() } catch {} }
}

function line(label, result) {
  const state = result.noResponse ? "NO-RESPONSE" : result.isError ? "FAILED" : "OK"
  log(`${label.padEnd(34)} ${state.padEnd(12)} ${String(result.elapsedMs).padStart(6)}ms` +
    (result.code ? ` code=${result.code}` : "") + (result.imageBytes ? ` image=${result.imageBytes}B` : ""))
}

const results = {}
async function ensureFixture() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${FIXTURE_URL}api/ping?from=input-probe`)
      if (response.ok) return null
    } catch {
      // start it below
    }
    if (attempt === 0) {
      const child = spawn(process.execPath, [join(HERE, "fixture-server.js")], {
        cwd: ROOT,
        env: { ...process.env, YUNTI_PROBE_FIXTURE_PORT: String(FIXTURE_PORT) },
        stdio: "ignore",
      })
      child.unref()
    }
    await sleep(500)
  }
  throw new Error("fixture server unavailable")
}

async function main() {
  await ensureFixture()
  const mcp = new Mcp()
  await sleep(1200)
  const created = await mcp.callTool("yunti_new_page", { url: `${FIXTURE_URL}controls.html`, active: true }, 25_000)
  await sleep(1200)
  const listed = await mcp.callTool("yunti_list_browser_targets", {})
  const target = (listed.payload?.targets || []).find((t) => Number(t.tabId) === Number(created.payload?.tabId))
  let browserSessionId = target?.browserSessionId || created.payload?.browserSessionId || null
  if (!browserSessionId) {
    const pages = await mcp.callTool("yunti_list_pages", {})
    browserSessionId = (pages.payload?.pages || []).find((p) => Number(p.tabId) === Number(created.payload?.tabId))?.browserSessionId || null
  }
  if (!browserSessionId) {
    // route recovery: page tools accept tabId directly and register the session
    const snapshot = await mcp.callTool("yunti_get_page_snapshot", { tabId: created.payload?.tabId }, 15_000)
    browserSessionId = snapshot.payload?.browserSessionId || null
    log(`session recovered through tabId routing: ${browserSessionId}`)
  }
  const session = { tabId: target?.tabId || created.payload?.tabId, browserSessionId }
  log(`tab=${session.tabId} session=${session.browserSessionId} active=${target?.active}`)
  results.session = session

  // 1) CDP raw mouse press/release, bounded
  results.cdpMousePressed = await mcp.callTool("yunti_cdp_send_command", {
    browserSessionId: session.browserSessionId,
    method: "Input.dispatchMouseEvent",
    params: { type: "mousePressed", x: 60, y: 60, button: "left", clickCount: 1 },
  }, 10_000)
  line("CDP Input mousePressed", results.cdpMousePressed)

  results.cdpMouseReleased = await mcp.callTool("yunti_cdp_send_command", {
    browserSessionId: session.browserSessionId,
    method: "Input.dispatchMouseEvent",
    params: { type: "mouseReleased", x: 60, y: 60, button: "left", clickCount: 1 },
  }, 10_000)
  line("CDP Input mouseReleased", results.cdpMouseReleased)

  results.touchEvent = await mcp.callTool("yunti_cdp_send_command", {
    browserSessionId: session.browserSessionId,
    method: "Input.dispatchMouseEvent",
    params: { type: "mouseMoved", x: 80, y: 80, button: "left", buttons: 1 },
  }, 10_000)
  line("CDP Input mouseMoved", results.touchEvent)

  // 2) runtime evaluate (known-good path), for contrast
  results.evaluate = await mcp.callTool("yunti_evaluate_script", { browserSessionId: session.browserSessionId, expression: "1+1" }, 10_000)
  line("evaluate (control)", results.evaluate)

  // 3) tool-level coordinate paths
  results.clickAt = await mcp.callTool("yunti_click_at", { browserSessionId: session.browserSessionId, x: 60, y: 200 }, 12_000)
  line("yunti_click_at", results.clickAt)
  results.drag = await mcp.callTool("yunti_drag", { browserSessionId: session.browserSessionId, fromX: 40, fromY: 300, toX: 200, toY: 340, steps: 3 }, 12_000)
  line("yunti_drag", results.drag)

  // 4) uid click path (content script) for contrast
  const obs = await mcp.callTool("yunti_observe_page", { browserSessionId: session.browserSessionId }, 10_000)
  const uid = (obs.payload?.elements || []).find((el) => el.tag === "button")?.uid || null
  results.uidClick = await mcp.callTool("yunti_click", { browserSessionId: session.browserSessionId, uid }, 12_000)
  line("yunti_click (uid path)", results.uidClick)

  // 5) captureVisibleTab payload shape on an activated tab
  results.captureVisible = await mcp.callTool("yunti_capture_visible_tab", { browserSessionId: session.browserSessionId }, 20_000)
  line("yunti_capture_visible_tab", results.captureVisible)
  log(`capture payload keys: ${JSON.stringify(results.captureVisible.payloadKeys)}`)
  if (typeof results.captureVisible.payload?.dataUrl === "string") {
    log(`capture dataUrl length=${results.captureVisible.payload.dataUrl.length}`)
  }

  results.screenshot = await mcp.callTool("yunti_take_screenshot", { browserSessionId: session.browserSessionId, format: "png" }, 20_000)
  line("yunti_take_screenshot", results.screenshot)
  results.screenshotFull = await mcp.callTool("yunti_take_screenshot", { browserSessionId: session.browserSessionId, format: "png", fullPage: true }, 20_000)
  line("yunti_take_screenshot fullPage", results.screenshotFull)

  await mcp.callTool("yunti_cdp_send_command", { browserSessionId: session.browserSessionId, tabId: session.tabId, method: "Target.closeTarget", params: { targetId: String(session.tabId) } }, 10_000)
  mcp.stop()
  console.log(JSON.stringify(results, null, 2))
}

main().catch((error) => { console.error("fatal", error); process.exitCode = 1 })
