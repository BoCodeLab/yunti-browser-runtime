#!/usr/bin/env node
// A/B probe: is yunti_take_screenshot tied to the tab being the foreground tab?
// Runs three identical screenshots/captures: background tab -> activated tab,
// then activates another tab again and retries.
import { spawn } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..")
const FIXTURE_PORT = Number(process.env.YUNTI_PROBE_FIXTURE_PORT || 49771)
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...p) => console.error("[ab-probe]", ...p)

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
    const blocks = msg.result?.content || []
    const image = blocks.find((b) => b.type === "image")
    const payload = msg.result?.structuredContent
    return {
      tool: name,
      elapsedMs: Date.now() - startedAt,
      noResponse: Boolean(msg.timedOut),
      isError: msg.result?.isError === true,
      imageBytes: image?.data?.length ?? 0,
      message: typeof payload?.message === "string" ? payload.message.slice(0, 120) : null,
    }
  }
  stop() { try { this.child.stdin.end(); this.child.kill() } catch {} }
}

async function ensureFixture() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${FIXTURE_URL}api/ping?from=ab-probe`)
      if (response.ok) return
    } catch { /* start below */ }
    if (attempt === 0) {
      spawn(process.execPath, [join(HERE, "fixture-server.js")], {
        cwd: ROOT,
        env: { ...process.env, YUNTI_PROBE_FIXTURE_PORT: String(FIXTURE_PORT) },
        stdio: "ignore",
      }).unref()
    }
    await sleep(500)
  }
  throw new Error("fixture server unavailable")
}

async function main() {
  await ensureFixture()
  const mcp = new Mcp()
  await sleep(1200)
  const created = await mcp.callTool("yunti_new_page", { url: `${FIXTURE_URL}controls.html`, active: false }, 25_000)
  await sleep(1200)
  const listed = await mcp.callTool("yunti_list_browser_targets", {})
  const targets = listed.payload?.targets || []
  const target = targets.find((t) => Number(t.tabId) === Number(created.payload?.tabId))
  const session = { tabId: target?.tabId || created.payload?.tabId, browserSessionId: target?.browserSessionId || created.payload?.browserSessionId || null }
  const otherTab = targets.find((t) => t.active && Number(t.tabId) !== Number(session.tabId)) || null
  log(`probe tab=${session.tabId} active=${target?.active} otherActiveTab=${otherTab?.tabId ?? "none"}`)

  const rows = []
  const attempt = async (label) => {
    const shot = await mcp.callTool("yunti_take_screenshot", { browserSessionId: session.browserSessionId, format: "png" }, 28_000)
    const capture = await mcp.callTool("yunti_capture_visible_tab", { browserSessionId: session.browserSessionId }, 28_000)
    rows.push({ label, screenshot: `${shot.noResponse ? "NO-RESPONSE" : shot.isError ? "FAILED" : "OK"} ${shot.elapsedMs}ms ${shot.imageBytes}B`, capture: `${capture.noResponse ? "NO-RESPONSE" : capture.isError ? "FAILED" : "OK"} ${capture.elapsedMs}ms ${capture.imageBytes}B` })
    log(`${label.padEnd(24)} screenshot=${rows.at(-1).screenshot} capture=${rows.at(-1).capture}`)
  }

  await attempt("1-background-tab")
  await mcp.callTool("yunti_cdp_send_command", { browserSessionId: session.browserSessionId, tabId: session.tabId, method: "Target.activateTarget", params: { targetId: String(session.tabId) } }, 10_000)
  await sleep(1200)
  await attempt("2-foreground-tab")
  if (otherTab) {
    await mcp.callTool("yunti_cdp_send_command", { browserSessionId: session.browserSessionId, tabId: otherTab.tabId, method: "Target.activateTarget", params: { targetId: String(otherTab.tabId) } }, 10_000)
    await sleep(1200)
    await attempt("3-background-again")
  }
  await mcp.callTool("yunti_cdp_send_command", { browserSessionId: session.browserSessionId, tabId: session.tabId, method: "Target.closeTarget", params: { targetId: String(session.tabId) } }, 10_000)
  if (otherTab) {
    await mcp.callTool("yunti_cdp_send_command", { browserSessionId: session.browserSessionId, tabId: otherTab.tabId, method: "Target.activateTarget", params: { targetId: String(otherTab.tabId) } }, 10_000)
  }
  mcp.stop()
  console.log(JSON.stringify({ session, rows }, null, 2))
}

main().catch((error) => { console.error("fatal", error); process.exitCode = 1 })
