#!/usr/bin/env node
// Yunti Browser Runtime probe harness.
//
// Drives the real production path (MCP stdio server -> local bridge ->
// extension controller -> content script/CDP) against a local fixture page and
// measures functional correctness, response time and concurrency behaviour.
//
// Usage:
//   node scripts/yunti-probe/probe.js --phase=all
//   node scripts/yunti-probe/probe.js --phase=smoke|latency|concurrency|tools
// Options:
//   --keep-tab         do not close the probe tab at the end
//   --tab=<tabId>      reuse an existing fixture tab instead of opening one
//   --iterations=N     latency iterations per tool (default 5)
//   --levels=1,2,4,8   concurrency levels (default 1,2,4,8,16)
//   --out=<dir>        report directory (default ./.probe-out)
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..")
const BRIDGE_URL = process.env.YUNTI_PROBE_BRIDGE_URL || "http://127.0.0.1:48887"
const FIXTURE_PORT = Number(process.env.YUNTI_PROBE_FIXTURE_PORT || 49771)
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}/`

function parseArgs(argv) {
  const out = { phase: "all", keepTab: false, tabId: 0, iterations: 5, levels: [1, 2, 4, 8, 16], out: join(ROOT, ".probe-out") }
  for (const raw of argv.slice(2)) {
    const [key, value = ""] = raw.replace(/^--/, "").split("=")
    if (key === "phase") out.phase = value
    else if (key === "keep-tab") out.keepTab = true
    else if (key === "tab") out.tabId = Number(value) || 0
    else if (key === "iterations") out.iterations = Math.max(1, Number(value) || 5)
    else if (key === "levels") out.levels = value.split(",").map((n) => Number(n)).filter((n) => n > 0)
    else if (key === "out") out.out = resolve(ROOT, value)
  }
  return out
}

const args = parseArgs(process.argv)
const log = (...parts) => console.error(`[probe] ${parts.join(" ")}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ *
 * MCP client over stdio (the exact path an MCP agent uses)
 * ------------------------------------------------------------------ */
class McpClient {
  constructor() {
    this.child = spawn(process.execPath, [join(ROOT, "mcp", "server.js")], {
      cwd: ROOT,
      env: { ...process.env, YUNTI_BROWSER_BRIDGE_ONLY: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.pending = new Map()
    this.nextId = 1
    this.stderr = []
    this.notices = []
    this.child.stderr.on("data", (chunk) => this.stderr.push(String(chunk)))
    const rl = createInterface({ input: this.child.stdout })
    rl.on("line", (line) => {
      const text = line.trim()
      if (!text) return
      let msg
      try {
        msg = JSON.parse(text)
      } catch {
        this.notices.push({ kind: "bad-json", text })
        return
      }
      if (msg.id === undefined || msg.id === null) {
        this.notices.push({ kind: "server-notification", msg })
        return
      }
      const waiter = this.pending.get(msg.id)
      if (waiter) {
        this.pending.delete(msg.id)
        waiter(msg)
      }
    })
  }

  request(method, params = {}, timeoutMs = 120_000) {
    const id = this.nextId++
    const payload = { jsonrpc: "2.0", id, method, params }
    return new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolvePromise({ id, method, timedOut: true, error: { code: "CLIENT_TIMEOUT", message: `no response in ${timeoutMs}ms` } })
      }, timeoutMs)
      this.pending.set(id, (msg) => {
        clearTimeout(timer)
        resolvePromise(msg)
      })
      this.child.stdin.write(`${JSON.stringify(payload)}\n`)
    })
  }

  async callTool(name, toolArgs = {}, timeoutMs = 120_000) {
    const startedAt = Date.now()
    const message = await this.request("tools/call", { name, arguments: toolArgs }, timeoutMs)
    const clientLatencyMs = Date.now() - startedAt
    const isError = Boolean(message.timedOut || message.error) || message.result?.isError === true
    let payload = message.result
    if (message.result?.content?.[0]?.text) {
      try {
        payload = JSON.parse(message.result.content[0].text)
      } catch {
        payload = message.result.content[0].text
      }
    }
    return {
      tool: name,
      ok: !isError,
      clientLatencyMs,
      timedOut: Boolean(message.timedOut),
      rpcError: message.error || null,
      payload,
    }
  }

  async initialize() {
    const res = await this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "yunti-probe", version: "1" } })
    return res.result
  }

  async listTools() {
    const res = await this.request("tools/list", {})
    return res.result?.tools || []
  }

  stop() {
    try {
      this.child.stdin.end()
      this.child.kill()
    } catch {
      // ignore
    }
  }
}

/* ------------------------------------------------------------------ *
 * Raw bridge HTTP client (same transport the MCP server proxies to)
 * ------------------------------------------------------------------ */
async function bridgeTool(tool, toolArgs = {}, timeoutMs = 60_000, userId = "local") {
  const startedAt = Date.now()
  try {
    const response = await fetch(`${BRIDGE_URL}/mcp/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool, arguments: { userId, ...toolArgs }, timeoutMs }),
    })
    const data = await response.json().catch(() => null)
    return {
      tool,
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      payload: data?.result ?? data,
      error: response.ok ? null : data?.error || `HTTP ${response.status}`,
    }
  } catch (error) {
    return { tool, ok: false, latencyMs: Date.now() - startedAt, payload: null, error: error.message }
  }
}

async function bridgeJson(path) {
  const response = await fetch(`${BRIDGE_URL}${path}`)
  return response.json()
}

/* ------------------------------------------------------------------ *
 * Metrics helpers
 * ------------------------------------------------------------------ */
function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function stats(values) {
  if (!values.length) return { count: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  return {
    count: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
    mean: Math.round(sum / sorted.length),
  }
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const startedAt = Date.now()
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return { results, wallMs: Date.now() - startedAt }
}

/* ------------------------------------------------------------------ *
 * Fixture server management
 * ------------------------------------------------------------------ */
async function ensureFixtureServer() {
  try {
    const response = await fetch(`${FIXTURE_URL}api/ping?from=health`)
    if (response.ok) return { child: null, reused: true }
  } catch {
    // start it
  }
  const child = spawn(process.execPath, [join(HERE, "fixture-server.js")], {
    cwd: ROOT,
    env: { ...process.env, YUNTI_PROBE_FIXTURE_PORT: String(FIXTURE_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout.on("data", (chunk) => log(`fixture: ${String(chunk).trim()}`))
  child.stderr.on("data", (chunk) => log(`fixture-err: ${String(chunk).trim()}`))
  for (let attempt = 0; attempt < 50; attempt++) {
    await sleep(100)
    try {
      const response = await fetch(`${FIXTURE_URL}api/ping?from=health`)
      if (response.ok) return { child, reused: false }
    } catch {
      // retry
    }
  }
  throw new Error("fixture server did not start")
}

/* ------------------------------------------------------------------ *
 * Tool inventory: which tools are carried by which phase
 * ------------------------------------------------------------------ */
const BROWSER_LOCAL_TOOLS = [
  "yunti_get_tool_usage_hints",
  "yunti_remember_learning",
  "yunti_get_learning_memory",
  "yunti_forget_learning_memory",
]

const CONCURRENCY_SAFE_TOOLS = [
  "yunti_get_page_snapshot",
  "yunti_observe_page",
  "yunti_find_elements",
  "yunti_evaluate_script",
  "yunti_list_network_requests",
  "yunti_list_console_messages",
  "yunti_list_browser_targets",
]

const REPORT = {
  startedAt: new Date().toISOString(),
  bridge: {},
  client: {},
  init: null,
  toolInventory: { declared: 0, invoked: 0, missing: [] },
  rawFailures: {},
  smoke: [],
  latency: {},
  concurrency: {},
  rawBridge: {},
  findings: [],
}

function finding(severity, area, detail, evidence = "") {
  REPORT.findings.push({ severity, area, detail, evidence })
}

/* ------------------------------------------------------------------ *
 * Phase 1: smoke / functional coverage of every tool
 * ------------------------------------------------------------------ */
async function resolveTargetTab(client, preferredTabId) {
  const listed = await client.callTool("yunti_list_browser_targets", {})
  const payload = listed.payload || {}
  const targets = payload.targets || payload.targetInfos || []
  const probeTarget = targets.find((t) => String(t.url || "").startsWith(FIXTURE_URL.slice(0, 26)))
  const chosen = preferredTabId
    ? targets.find((t) => Number(t.tabId) === Number(preferredTabId))
    : probeTarget
  return { listedMs: listed.clientLatencyMs, targetCount: targets.length, target: chosen || null, payload, targets }
}

// Verify the tab really landed on the fixture page before running page tools.
// A background tab that silently stays blank otherwise turns every later
// selector/uid assertion into a false negative.
async function ensureLanded(client, session, expectPath, attempts = 6) {
  const trace = []
  for (let i = 0; i < attempts; i++) {
    const snapshot = await client.callTool("yunti_get_page_snapshot", { browserSessionId: session.browserSessionId })
    const url = String(snapshot.payload?.url || "")
    const title = String(snapshot.payload?.title || "")
    trace.push({ attempt: i, latencyMs: snapshot.clientLatencyMs, url, title })
    if (url.startsWith(FIXTURE_URL) && (!expectPath || url.includes(expectPath))) {
      return { landed: true, url, title, trace, attempts: i + 1 }
    }
    if (i === 1) {
      // one explicit navigation retry through the documented recovery path
      await client.callTool("yunti_navigate_page", { browserSessionId: session.browserSessionId, url: `${FIXTURE_URL}${expectPath || ""}`, action: "url" })
    }
    await sleep(700)
  }
  return { landed: false, url: trace.at(-1)?.url || "", title: trace.at(-1)?.title || "", trace, attempts }
}

async function runSmoke(client, session) {
  const { browserSessionId, tabId } = session
  const results = []
  const record = (name, result, extra = {}) => {
    const ok = Boolean(result?.ok) && !result?.payload?.code
    results.push({
      tool: name,
      transportOk: Boolean(result?.ok),
      ok,
      latencyMs: result?.clientLatencyMs ?? result?.latencyMs ?? null,
      code: result?.payload?.code || result?.payload?.error?.code || result?.rpcError?.code || null,
      message: result?.payload?.message || result?.error || result?.rpcError?.message || null,
      ...extra,
    })
    if (!ok) REPORT.rawFailures[name] = summarizePayload(result?.payload ?? result)
    return result
  }

  const pageArgs = { browserSessionId }
  let observation = await client.callTool("yunti_observe_page", pageArgs)
  record("yunti_observe_page", observation)
  let elements = observation.payload?.elements || []
  REPORT.elementShape = {
    observationId: observation.payload?.observationId || null,
    elementCount: elements.length,
    keys: Object.keys(elements[0] || {}),
    sample: elements.slice(0, 6).map((el) => ({ uid: el.uid, role: el.role, name: el.name, text: el.text, tag: el.tag })),
    scrollableContainerCount: (observation.payload?.scrollableContainers || []).length,
  }

  const uidOf = (predicate) => elements.find(predicate)?.uid || null

  // ---- inventory / meta -------------------------------------------------
  record("yunti_get_tool_usage_hints", await client.callTool("yunti_get_tool_usage_hints", {}))
  record("yunti_list_pages", await client.callTool("yunti_list_pages", {}))
  record("yunti_list_browser_targets", await client.callTool("yunti_list_browser_targets", {}))
  record("yunti_get_browser_target", await client.callTool("yunti_get_browser_target", { tabId }))

  // ---- observation family ----------------------------------------------
  record("yunti_get_page_snapshot", await client.callTool("yunti_get_page_snapshot", pageArgs))
  record("yunti_take_snapshot", await client.callTool("yunti_take_snapshot", pageArgs))
  record("yunti_find_elements", await client.callTool("yunti_find_elements", { ...pageArgs, query: "probe" }))
  record("yunti_get_selected_context", await client.callTool("yunti_get_selected_context", pageArgs))

  // ---- actions (controls fixture: inputs, select, contenteditable) ------
  await client.callTool("yunti_navigate_page", { ...pageArgs, url: `${FIXTURE_URL}controls.html`, action: "url" })
  await sleep(700)
  await ensureLanded(client, session, "controls.html")
  const controlsObservation = await client.callTool("yunti_observe_page", pageArgs)
  record("yunti_observe_page#2", controlsObservation)
  elements = controlsObservation.payload?.elements || []
  REPORT.elementShape.second = {
    elementCount: elements.length,
    keys: Object.keys(elements[0] || {}),
    sample: elements.slice(0, 10).map((el) => ({ uid: el.uid, role: el.role, name: el.name, text: el.text, tag: el.tag })),
  }
  const buttonUid = uidOf((el) => el.tag === "button" || /button/i.test(String(el.role || "")))
  const click = await client.callTool("yunti_click", { ...pageArgs, uid: buttonUid })
  record("yunti_click", click, { usedUid: Boolean(buttonUid) })
  const afterClick = await client.callTool("yunti_get_page_snapshot", pageArgs)
  const afterClickText = JSON.stringify(afterClick.payload || "")
  reportCheck(
    "click produces a verifiable page change",
    /clicks:\s*1/.test(afterClickText) || /submitted/.test(afterClickText),
    afterClickText.slice(0, 220)
  )

  record("yunti_hover", await client.callTool("yunti_hover", { ...pageArgs, uid: buttonUid }))
  record("yunti_click_at", await client.callTool("yunti_click_at", { ...pageArgs, x: 60, y: 40 }))
  record("yunti_type_text", await client.callTool("yunti_type_text", { ...pageArgs, selector: "#name", text: " probe-typed", clear: false }))
  record("yunti_press_key", await client.callTool("yunti_press_key", { ...pageArgs, selector: "#note", key: "Tab" }))
  record("yunti_select", await client.callTool("yunti_select", { ...pageArgs, selector: "#pick", value: "beta" }))
  record("yunti_fill", await client.callTool("yunti_fill", { ...pageArgs, selector: "#name", value: "probe-fill" }))
  record("yunti_fill_form", await client.callTool("yunti_fill_form", { ...pageArgs, fields: [{ selector: "#name", value: "form-a" }, { selector: "#note", value: "form-b" }] }))
  record("yunti_evaluate_script", await client.callTool("yunti_evaluate_script", { ...pageArgs, expression: "document.querySelectorAll('.row, .box').length" }))

  // ---- scroll + wait on the tall scroll fixture -------------------------
  await client.callTool("yunti_navigate_page", { ...pageArgs, url: `${FIXTURE_URL}scroll.html`, action: "url" })
  await sleep(700)
  await ensureLanded(client, session, "scroll.html")
  record("yunti_scroll", await client.callTool("yunti_scroll", { ...pageArgs, deltaY: 200 }))
  record("yunti_wait_for", await client.callTool("yunti_wait_for", { ...pageArgs, text: "bottom marker", timeoutMs: 4000 }))
  const scrollObservation = await client.callTool("yunti_observe_page", pageArgs)
  REPORT.scrollShape = {
    scrollableContainerCount: (scrollObservation.payload?.scrollableContainers || []).length,
    scrollableUid: (scrollObservation.payload?.scrollableContainers || [])[0]?.uid || null,
  }
  if (REPORT.scrollShape.scrollableUid) {
    record("yunti_scroll#nested", await client.callTool("yunti_scroll", { ...pageArgs, uid: REPORT.scrollShape.scrollableUid, deltaY: 120 }))
  }
  record("yunti_drag", await client.callTool("yunti_drag", { ...pageArgs, fromX: 40, fromY: 80, toX: 260, toY: 160, steps: 5 }))

  // ---- console fixture (emit a console line, then read it back) ---------
  await client.callTool("yunti_navigate_page", { ...pageArgs, url: `${FIXTURE_URL}console.html`, action: "url" })
  await sleep(700)
  await ensureLanded(client, session, "console.html")
  const consoleObs = await client.callTool("yunti_observe_page", pageArgs)
  const logUid = (consoleObs.payload?.elements || []).find((el) => el.tag === "button")?.uid || null
  await client.callTool("yunti_click", { ...pageArgs, uid: logUid })
  await sleep(900)

  // ---- diagnostics ------------------------------------------------------
  record("yunti_take_screenshot", await client.callTool("yunti_take_screenshot", { ...pageArgs, format: "png" }))
  record("yunti_capture_visible_tab", await client.callTool("yunti_capture_visible_tab", { ...pageArgs }))
  record("yunti_list_console_messages", await client.callTool("yunti_list_console_messages", { ...pageArgs, limit: 20 }))
  const consoleList = await client.callTool("yunti_list_console_messages", { ...pageArgs, limit: 20 })
  const firstConsole = consoleList.payload?.messages?.[0]?.id
  record("yunti_get_console_message", await client.callTool("yunti_get_console_message", { ...pageArgs, msgId: firstConsole }))
  record("yunti_list_network_requests", await client.callTool("yunti_list_network_requests", { ...pageArgs, limit: 20 }))
  const networkList = await client.callTool("yunti_list_network_requests", { ...pageArgs, limit: 20 })
  const firstRequest = networkList.payload?.requests?.[0]?.id || networkList.payload?.events?.[0]?.id
  record("yunti_get_network_request", await client.callTool("yunti_get_network_request", { ...pageArgs, eventId: firstRequest }))
  record("yunti_get_network_log", await client.callTool("yunti_get_network_log", { ...pageArgs, limit: 20 }))
  record("yunti_get_cdp_events", await client.callTool("yunti_get_cdp_events", { ...pageArgs, limit: 10 }))
  record("yunti_emulate", await client.callTool("yunti_emulate", { ...pageArgs, viewport: { width: 1024, height: 768, deviceScaleFactor: 1 } }))
  record("yunti_resize_page", await client.callTool("yunti_resize_page", { ...pageArgs, width: 1024, height: 768 }))
  record("yunti_handle_dialog", await client.callTool("yunti_handle_dialog", { ...pageArgs, action: "accept" }))
  record("yunti_fetch_with_cookie", await client.callTool("yunti_fetch_with_cookie", { ...pageArgs, url: `${FIXTURE_URL}api/ping?from=probe-fetch`, method: "GET" }))

  // ---- drag on a coordinate-sane fixture -------------------------------
  record("yunti_drag", await client.callTool("yunti_drag", { ...pageArgs, fromX: 40, fromY: 120, toX: 240, toY: 160, steps: 5 }))

  // ---- CDP --------------------------------------------------------------
  record("yunti_cdp_send_command", await client.callTool("yunti_cdp_send_command", { ...pageArgs, method: "Runtime.evaluate", params: { expression: "document.title", returnByValue: true } }))
  record("yunti_performance_start_trace", await client.callTool("yunti_performance_start_trace", { ...pageArgs, categories: ["devtools.timeline"] }))
  await sleep(300)
  record("yunti_performance_stop_trace", await client.callTool("yunti_performance_stop_trace", { ...pageArgs }))
  record("yunti_cdp_detach", await client.callTool("yunti_cdp_detach", { ...pageArgs }))

  // ---- upload (dedicated file-input fixture) ----------------------------
  await client.callTool("yunti_navigate_page", { ...pageArgs, url: `${FIXTURE_URL}upload.html`, action: "url" })
  await sleep(600)
  await ensureLanded(client, session, "upload.html")
  record("yunti_upload_file", await client.callTool("yunti_upload_file", { ...pageArgs, selector: "#upload", filePaths: [join(ROOT, "scripts", "soak", "fixtures", "upload.txt")] }))

  // ---- preview patch ----------------------------------------------------
  record("yunti_apply_preview_patch", await client.callTool("yunti_apply_preview_patch", { ...pageArgs, patchId: "probe-patch", patches: [{ selector: "#hello", style: { color: "rgb(200, 0, 0)" } }] }))
  record("yunti_rollback_preview_patch", await client.callTool("yunti_rollback_preview_patch", { ...pageArgs, patchId: "probe-patch" }))

  // ---- memory -----------------------------------------------------------
  const remembered = await client.callTool("yunti_remember_learning", { title: `probe learning ${Date.now()}`, detail: "probe harness memory entry, safe to delete", kind: "probe", tags: ["probe"] })
  record("yunti_remember_learning", remembered)
  record("yunti_get_learning_memory", await client.callTool("yunti_get_learning_memory", {}))
  const memoryId = remembered.payload?.memory?.id || remembered.payload?.id
  record("yunti_forget_learning_memory", await client.callTool("yunti_forget_learning_memory", { id: memoryId }))

  // ---- clearing tools ---------------------------------------------------
  record("yunti_clear_network_requests", await client.callTool("yunti_clear_network_requests", { ...pageArgs }))
  record("yunti_clear_network_log", await client.callTool("yunti_clear_network_log", { ...pageArgs }))
  record("yunti_clear_console_messages", await client.callTool("yunti_clear_console_messages", { ...pageArgs }))
  record("yunti_clear_cdp_events", await client.callTool("yunti_clear_cdp_events", { ...pageArgs }))

  // ---- real modal dialog on the dedicated dialog fixture ----------------
  const dialogSetup = []
  await client.callTool("yunti_navigate_page", { ...pageArgs, url: `${FIXTURE_URL}dialog.html`, action: "url" })
  await sleep(600)
  await ensureLanded(client, session, "dialog.html")
  const dialogObservation = await client.callTool("yunti_observe_page", pageArgs)
  const alertUid = (dialogObservation.payload?.elements || []).find((el) => /alert/i.test(String(el.name || el.text || "")))?.uid || null
  dialogSetup.push({ step: "observe-dialog-page", elementCount: (dialogObservation.payload?.elements || []).length, alertUid })
  const trigger = await client.callTool("yunti_click", { ...pageArgs, uid: alertUid })
  dialogSetup.push({ step: "click-alert", transportOk: trigger.ok, code: trigger.payload?.code || null, latencyMs: trigger.clientLatencyMs })
  await sleep(1200)
  const blocked = await Promise.race([
    client.callTool("yunti_get_page_snapshot", pageArgs, 3000).then((res) => (res.timedOut ? "blocked-or-timeout" : `returned:${res.ok}`)),
    sleep(4000).then(() => "blocked-or-timeout"),
  ])
  dialogSetup.push({ step: "state-with-modal-open", sameTabCall: blocked })
  const handled = await client.callTool("yunti_handle_dialog", { ...pageArgs, action: "accept" }, 8000)
  dialogSetup.push({ step: "handle-dialog", transportOk: handled.ok, latencyMs: handled.clientLatencyMs, payload: summarizePayload(handled.payload) })
  await sleep(500)
  const recovered = await client.callTool("yunti_evaluate_script", { ...pageArgs, expression: "document.getElementById('dialog-result').textContent" }, 8000)
  dialogSetup.push({ step: "post-dialog-eval", transportOk: recovered.ok, value: recovered.payload?.result ?? summarizePayload(recovered.payload) })
  REPORT.dialogSequence = dialogSetup
  if (blocked === "blocked-or-timeout") {
    finding("high", "dialog", "an open modal dialog blocks the tab's JavaScript thread: page tools on that tab cannot resolve until the dialog is dismissed through another route", JSON.stringify(dialogSetup))
  }

  // ---- lifecycle (new/close page) ---------------------------------------
  const throwaway = await client.callTool("yunti_new_page", { url: `${FIXTURE_URL}async.html`, active: false })
  record("yunti_new_page", throwaway, { tabId: throwaway.payload?.tabId || null })
  await sleep(600)
  const throwawaySession = throwaway.payload?.browserSessionId
  record("yunti_close_page", await client.callTool("yunti_close_page", { browserSessionId: throwawaySession }))

  // ---- navigation family (last: they change the page) -------------------
  record("yunti_navigate_page", await client.callTool("yunti_navigate_page", { ...pageArgs, url: `${FIXTURE_URL}controls.html` }))
  await sleep(700)
  record("yunti_select_page", await client.callTool("yunti_select_page", pageArgs))

  return results
}

const CHECKS = []
function reportCheck(name, passed, evidence = "") {
  CHECKS.push({ name, passed, evidence })
  REPORT.smoke_checks = CHECKS
}

/* ------------------------------------------------------------------ *
 * Blocking-dialog probe
 *
 * yunti_request_user_confirmation is implemented in content.js as
 * window.confirm(...). A native modal dialog blocks the renderer's JS
 * thread, so the awaiting tool call cannot resolve until *something else*
 * dismisses the dialog. This probe measures that with a dedicated tab so a
 * stuck dialog can never affect the main probe tab.
 * ------------------------------------------------------------------ */
async function runConfirmationProbe(client, session) {
  const outcome = { tool: "yunti_request_user_confirmation", steps: [] }
  const created = await client.callTool("yunti_new_page", { url: `${FIXTURE_URL}`, active: false })
  await sleep(600)
  const listed = await client.callTool("yunti_list_browser_targets", {})
  const target = (listed.payload?.targets || []).find((t) => Number(t.tabId) === Number(created.payload?.tabId))
  const confirmSession = target?.browserSessionId || created.payload?.browserSessionId || null
  outcome.tabId = target?.tabId || created.payload?.tabId || null
  outcome.browserSessionId = confirmSession
  if (!confirmSession) {
    outcome.skipped = "could not create confirmation tab"
    return outcome
  }

  const startedAt = Date.now()
  const callPromise = client.callTool("yunti_request_user_confirmation", {
    browserSessionId: confirmSession,
    message: "probe confirmation dialog",
    detail: "automated probe",
  }, 20_000).then(
    (value) => ({ settled: "returned", elapsedMs: Date.now() - startedAt, value }),
    (error) => ({ settled: "rejected", elapsedMs: Date.now() - startedAt, error: error.message })
  )

  await sleep(2500)
  outcome.steps.push({
    step: "state-while-dialog-open",
    sameTabToolCall: await Promise.race([
      client.callTool("yunti_get_page_snapshot", { browserSessionId: confirmSession }, 3000).then((r) => (r.timedOut ? "timeout" : `returned:${r.ok}`)),
      sleep(4000).then(() => "timeout"),
    ]),
    crossTabToolCall: await Promise.race([
      client.callTool("yunti_get_page_snapshot", { browserSessionId: session.browserSessionId }, 3000).then((r) => (r.timedOut ? "timeout" : `returned:${r.ok}`)),
      sleep(4000).then(() => "timeout"),
    ]),
  })

  // Dismiss the modal from the other tab (CDP Page.handleJavaScriptDialog is a
  // browser-level command and does not need the blocked renderer).
  const dismissed = await client.callTool("yunti_handle_dialog", {
    browserSessionId: session.browserSessionId,
  }, 5000)
  outcome.steps.push({ step: "dismiss-from-other-tab", ok: dismissed.ok, payload: summarizePayload(dismissed.payload) })

  const settled = await Promise.race([callPromise, sleep(6000).then(() => ({ settled: "still-blocked-after-dismiss", elapsedMs: Date.now() - startedAt }))])
  outcome.settled = settled.settled
  outcome.elapsedMs = settled.elapsedMs
  outcome.value = settled.value ? summarizePayload(settled.value.payload) : undefined
  outcome.error = settled.error

  const closeResult = await client.callTool("yunti_cdp_send_command", {
    browserSessionId: session.browserSessionId,
    tabId: outcome.tabId,
    method: "Target.closeTarget",
    params: { targetId: String(outcome.tabId) },
  }, 8000)
  outcome.closed = closeResult.ok
  outcome.closeError = closeResult.payload?.error || closeResult.rpcError?.message || null

  if (outcome.settled !== "returned") {
    finding("high", "deadlock", "yunti_request_user_confirmation blocks the tab: window.confirm() freezes the renderer's JS thread, so the tool call cannot resolve until another client (CDP Page.handleJavaScriptDialog) dismisses the dialog", JSON.stringify(outcome.steps))
  }
  return outcome
}

function summarizePayload(payload) {
  if (payload == null) return payload
  const text = JSON.stringify(payload)
  return text.length > 300 ? `${text.slice(0, 300)}…` : payload
}

/* ------------------------------------------------------------------ *
 * Modal dialog probe on its own tab.
 *
 * A native modal (alert/confirm/prompt) blocks the tab's renderer JS thread.
 * Any page tool routed to that tab therefore cannot resolve, and a click that
 * opens the dialog never returns. This probe measures that failure mode on a
 * disposable tab and, crucially, records whether the runtime can recover.
 * ------------------------------------------------------------------ */
async function runDialogProbe(client, session) {
  const outcome = { tool: "yunti_handle_dialog", steps: [] }
  const listedBefore = await client.callTool("yunti_list_browser_targets", {})
  outcome.previouslyActiveTabId = (listedBefore.payload?.targets || []).find((t) => t.active)?.tabId ?? null
  // Native modals only render for the foreground tab, so this probe must
  // activate its own tab; the previous active tab is restored on the way out.
  const created = await client.callTool("yunti_new_page", { url: `${FIXTURE_URL}dialog.html`, active: true }, 20_000)
  await sleep(1200)
  const listed = await client.callTool("yunti_list_browser_targets", {})
  const target = (listed.payload?.targets || []).find((t) => Number(t.tabId) === Number(created.payload?.tabId))
  const dialogSessionId = target?.browserSessionId || created.payload?.browserSessionId || null
  outcome.tabId = target?.tabId || created.payload?.tabId || null
  outcome.browserSessionId = dialogSessionId
  outcome.targetActive = Boolean(target?.active)
  if (!dialogSessionId) {
    outcome.skipped = "could not create dialog tab"
    return outcome
  }
  const dialogArgs = { browserSessionId: dialogSessionId }
  const controlTabId = session.tabId
  let clickedUid = null

  try {
    await ensureLanded(client, { tabId: outcome.tabId, browserSessionId: dialogSessionId }, "dialog.html", 4)
    const observation = await client.callTool("yunti_observe_page", dialogArgs)
    clickedUid = (observation.payload?.elements || []).find((el) => /alert/i.test(String(el.name || el.text || "")))?.uid || null
    outcome.steps.push({ step: "observe", elementCount: (observation.payload?.elements || []).length, alertUid: clickedUid })

    // The click opens alert(); the in-page handler cannot return until it closes.
    const clickStartedAt = Date.now()
    const clickPromise = client.callTool("yunti_click", { ...dialogArgs, uid: clickedUid }, 20_000).then(
      (value) => ({ settled: "returned", elapsedMs: Date.now() - clickStartedAt, ok: value.ok, code: value.payload?.code || null }),
      (error) => ({ settled: "rejected", elapsedMs: Date.now() - clickStartedAt, error: error.message })
    )
    await sleep(2500)

    const sameTab = await Promise.race([
      client.callTool("yunti_get_page_snapshot", dialogArgs, 3000).then((r) => (r.timedOut ? "no-response" : `returned:${r.ok}`)),
      sleep(4000).then(() => "no-response"),
    ])
    const otherTab = await Promise.race([
      client.callTool("yunti_get_page_snapshot", { browserSessionId: session.browserSessionId }, 3000).then((r) => (r.timedOut ? "no-response" : `returned:${r.ok}`)),
      sleep(4000).then(() => "no-response"),
    ])
    outcome.steps.push({ step: "while-dialog-open", sameTab, otherTab })

    // Recovery attempt through the dialog page itself: CDP Page.handleJavaScriptDialog.
    const handled = await client.callTool("yunti_handle_dialog", { ...dialogArgs, action: "accept" }, 8000)
    outcome.steps.push({ step: "handle-dialog-on-dialog-tab", transportOk: handled.ok, latencyMs: handled.clientLatencyMs, payload: summarizePayload(handled.payload), rpcError: handled.rpcError?.message || null })

    // Recovery attempt through a different tab (documents the SKILL.md advice).
    if (!handled.ok) {
      const handledFromOtherTab = await client.callTool("yunti_handle_dialog", { browserSessionId: session.browserSessionId, tabId: outcome.tabId, action: "accept" }, 8000)
      outcome.steps.push({ step: "handle-dialog-from-other-tab", transportOk: handledFromOtherTab.ok, payload: summarizePayload(handledFromOtherTab.payload), rpcError: handledFromOtherTab.rpcError?.message || null })
    }

    const settled = await Promise.race([clickPromise, sleep(8000).then(() => ({ settled: "still-pending", elapsedMs: Date.now() - clickStartedAt }))])
    outcome.clickOutcome = settled
    outcome.steps.push({ step: "click-outcome", ...settled })

    const evaluated = await client.callTool("yunti_evaluate_script", { ...dialogArgs, expression: "document.getElementById('dialog-result').textContent" }, 8000)
    outcome.steps.push({ step: "post-recovery-eval", transportOk: evaluated.ok, value: evaluated.payload?.result ?? summarizePayload(evaluated.payload), latencyMs: evaluated.clientLatencyMs })
  } finally {
    const closed = await client.callTool("yunti_cdp_send_command", {
      browserSessionId: session.browserSessionId,
      tabId: outcome.tabId,
      method: "Target.closeTarget",
      params: { targetId: String(outcome.tabId) },
    }, 10_000)
    outcome.closed = closed.ok
    outcome.closeError = closed.payload?.error || closed.rpcError?.message || null
    if (outcome.previouslyActiveTabId && Number(outcome.previouslyActiveTabId) !== Number(outcome.tabId)) {
      const restore = await client.callTool("yunti_cdp_send_command", {
        browserSessionId: session.browserSessionId,
        tabId: outcome.previouslyActiveTabId,
        method: "Target.activateTarget",
        params: { targetId: String(outcome.previouslyActiveTabId) },
      }, 8000)
      outcome.restoredPreviousTab = restore.ok
    }
  }

  if (outcome.clickOutcome?.settled !== "returned") {
    finding("critical", "deadlock", "clicking an element that opens a native modal never returns through yunti_click: the modal blocks the tab's JS thread, the click's completion message cannot be posted back, so the request hangs until the shared timeout (measured 25s+) and the tab answers no further tools", JSON.stringify(outcome.steps))
  }
  if (!outcome.steps.find((s) => s.step === "handle-dialog-on-dialog-tab")?.transportOk) {
    finding("medium", "dialog", "yunti_handle_dialog could not recover a modal dialog opened on the routed tab", JSON.stringify(outcome.steps))
  }
  void controlTabId
  return outcome
}

/* ------------------------------------------------------------------ *
 * Focused repro probes.
 *
 * Each case runs on its own disposable tab so a hung tab can be discarded
 * without contaminating the rest of the run. A bounded race keeps the harness
 * moving even when a tool never answers.
 * ------------------------------------------------------------------ */
async function newProbeTab(client, url, active = false) {
  const created = await client.callTool("yunti_new_page", { url, active }, 20_000)
  await sleep(900)
  const listed = await client.callTool("yunti_list_browser_targets", {})
  const target = (listed.payload?.targets || []).find((t) => Number(t.tabId) === Number(created.payload?.tabId))
  const browserSessionId = target?.browserSessionId || created.payload?.browserSessionId || null
  const tabId = target?.tabId || created.payload?.tabId || null
  if (browserSessionId) await ensureLanded(client, { tabId, browserSessionId }, "", 4)
  return { tabId, browserSessionId, createdOk: created.ok }
}

async function boundedCall(client, name, toolArgs, timeoutMs, clientTimeoutMs = timeoutMs + 2500) {
  const startedAt = Date.now()
  const raced = await Promise.race([
    client.callTool(name, toolArgs, clientTimeoutMs).then((r) => ({
      outcome: r.timedOut ? "no-response" : (r.ok ? "ok" : "failed"),
      code: r.payload?.code || r.rpcError?.message || null,
      message: typeof r.payload === "string" ? r.payload.slice(0, 160) : (r.payload?.message || null),
    })),
    sleep(timeoutMs + 4000).then(() => ({ outcome: "no-response", code: "HARNESS_RACE" })),
  ])
  return { tool: name, elapsedMs: Date.now() - startedAt, ...raced }
}

async function runFocusedProbes(client, session) {
  const results = {}

  // A) dialog on an active tab: is the deadlock real, and is it recoverable?
  const dialogTab = await newProbeTab(client, `${FIXTURE_URL}dialog.html`, true)
  const dialogArgs = { browserSessionId: dialogTab.browserSessionId }
  const dialogSteps = []
  const before = await client.callTool("yunti_observe_page", dialogArgs)
  const alertUid = (before.payload?.elements || []).find((el) => /alert/i.test(String(el.name || el.text || "")))?.uid || null
  dialogSteps.push({ step: "observe", count: (before.payload?.elements || []).length, alertUid })
  if (alertUid) {
    dialogSteps.push({ step: "click-that-opens-alert", ...(await boundedCall(client, "yunti_click", { ...dialogArgs, uid: alertUid }, 12_000)) })
    dialogSteps.push({ step: "observe-while-open", ...(await boundedCall(client, "yunti_get_page_snapshot", dialogArgs, 5_000)) })
    dialogSteps.push({ step: "handle-dialog-same-tab", ...(await boundedCall(client, "yunti_handle_dialog", { ...dialogArgs, action: "accept" }, 6_000)) })
    dialogSteps.push({ step: "handle-dialog-other-route", ...(await boundedCall(client, "yunti_handle_dialog", { browserSessionId: session.browserSessionId, tabId: dialogTab.tabId, action: "accept" }, 6_000)) })
    dialogSteps.push({ step: "cdp-handle-dialog", ...(await boundedCall(client, "yunti_cdp_send_command", { browserSessionId: session.browserSessionId, tabId: dialogTab.tabId, method: "Page.handleJavaScriptDialog", params: { accept: true } }, 6_000)) })
    dialogSteps.push({ step: "evaluate-after-recovery", ...(await boundedCall(client, "yunti_evaluate_script", { ...dialogArgs, expression: "1+1" }, 6_000)) })
  }
  results.dialogDeadlock = { tab: dialogTab, steps: dialogSteps }
  const stillStuck = dialogSteps.find((s) => s.step === "evaluate-after-recovery")?.outcome !== "ok"
  if (stillStuck) {
    finding("critical", "deadlock", "native alert() opened by a click deadlocks the routed tab: yunti_click never returns, every page tool on that tab stops answering, and neither yunti_handle_dialog nor a raw CDP Page.handleJavaScriptDialog call can close it. The tab stays wedged and even Target.closeTarget gets no response", JSON.stringify(dialogSteps))
  }
  results.dialogTabCleanup = await boundedCall(client, "yunti_cdp_send_command", {
    browserSessionId: session.browserSessionId,
    tabId: dialogTab.tabId,
    method: "Target.closeTarget",
    params: { targetId: String(dialogTab.tabId) },
  }, 8_000)

  // B) performance trace + detach, then screenshot timing on a fresh tab.
  const shotTab = await newProbeTab(client, `${FIXTURE_URL}controls.html`, false)
  const shotArgs = { browserSessionId: shotTab.browserSessionId }
  const shotSteps = []
  shotSteps.push({ step: "screenshot-baseline", ...(await boundedCall(client, "yunti_take_screenshot", { ...shotArgs, format: "png" }, 8_000)) })
  shotSteps.push({ step: "trace-start", ...(await boundedCall(client, "yunti_performance_start_trace", { ...shotArgs }, 8_000)) })
  await sleep(400)
  shotSteps.push({ step: "trace-stop", ...(await boundedCall(client, "yunti_performance_stop_trace", { ...shotArgs }, 15_000)) })
  shotSteps.push({ step: "screenshot-after-trace", ...(await boundedCall(client, "yunti_take_screenshot", { ...shotArgs, format: "png" }, 8_000)) })
  shotSteps.push({ step: "cdp-detach", ...(await boundedCall(client, "yunti_cdp_detach", { ...shotArgs }, 8_000)) })
  shotSteps.push({ step: "screenshot-after-detach", ...(await boundedCall(client, "yunti_take_screenshot", { ...shotArgs, format: "png" }, 8_000)) })
  shotSteps.push({ step: "evaluate-after-detach", ...(await boundedCall(client, "yunti_evaluate_script", { ...shotArgs, expression: "1+1" }, 8_000)) })
  // Is the stall permanent, and does a raw CDP screenshot still work?
  await sleep(5000)
  shotSteps.push({ step: "screenshot-5s-later", ...(await boundedCall(client, "yunti_take_screenshot", { ...shotArgs, format: "png" }, 8_000)) })
  shotSteps.push({ step: "raw-cdp-capture-screenshot", ...(await boundedCall(client, "yunti_cdp_send_command", { ...shotArgs, method: "Page.captureScreenshot", params: { format: "png" } }, 8_000)) })
  shotSteps.push({ step: "observe-after-detach", ...(await boundedCall(client, "yunti_observe_page", { ...shotArgs }, 8_000)) })
  shotSteps.push({ step: "snapshot-after-detach", ...(await boundedCall(client, "yunti_get_page_snapshot", { ...shotArgs }, 8_000)) })
  results.screenshotAfterTrace = { tab: shotTab, steps: shotSteps }
  const stalled = shotSteps.filter((s) => s.outcome === "no-response")
  if (stalled.length) {
    finding("high", "screenshot", `yunti_take_screenshot/diagnostics stopped answering after a CDP detach sequence (${stalled.map((s) => s.step).join(", ")})`, JSON.stringify(shotSteps))
  }
  results.screenshotTabCleanup = await boundedCall(client, "yunti_cdp_send_command", {
    browserSessionId: session.browserSessionId,
    tabId: shotTab.tabId,
    method: "Target.closeTarget",
    params: { targetId: String(shotTab.tabId) },
  }, 8_000)

  // C) drag variants: background tab (as used by the smoke phase) vs an
  // explicitly activated tab, to tell a routing problem from a dispatch bug.
  const dragTab = await newProbeTab(client, `${FIXTURE_URL}`, false)
  const dragSteps = []
  dragSteps.push({ step: "drag-background-tab", ...(await boundedCall(client, "yunti_drag", { browserSessionId: dragTab.browserSessionId, fromX: 40, fromY: 80, toX: 260, toY: 160, steps: 5 }, 8_000)) })
  dragSteps.push({ step: "activate-tab", ...(await boundedCall(client, "yunti_cdp_send_command", { browserSessionId: session.browserSessionId, tabId: dragTab.tabId, method: "Target.activateTarget", params: { targetId: String(dragTab.tabId) } }, 8_000)) })
  dragSteps.push({ step: "drag-active-tab", ...(await boundedCall(client, "yunti_drag", { browserSessionId: dragTab.browserSessionId, fromX: 40, fromY: 80, toX: 260, toY: 160, steps: 5 }, 8_000)) })
  dragSteps.push({ step: "drag-explicit-tabId", ...(await boundedCall(client, "yunti_drag", { browserSessionId: dragTab.browserSessionId, tabId: dragTab.tabId, fromX: 40, fromY: 80, toX: 260, toY: 160, steps: 5 }, 8_000)) })
  dragSteps.push({ step: "click-at-background", ...(await boundedCall(client, "yunti_click_at", { browserSessionId: dragTab.browserSessionId, x: 40, y: 80 }, 8_000)) })
  results.drag = { tab: dragTab, steps: dragSteps }
  results.dragTabCleanup = await boundedCall(client, "yunti_cdp_send_command", {
    browserSessionId: session.browserSessionId,
    tabId: dragTab.tabId,
    method: "Target.closeTarget",
    params: { targetId: String(dragTab.tabId) },
  }, 8_000)

  // D) console capture on a fresh tab, then read the message back.
  const consoleTab = await newProbeTab(client, `${FIXTURE_URL}console.html`, false)
  const consoleArgs = { browserSessionId: consoleTab.browserSessionId }
  const consoleSteps = []
  await sleep(600)
  const listed = await client.callTool("yunti_list_console_messages", { ...consoleArgs, limit: 20 })
  const messages = listed.payload?.messages || []
  consoleSteps.push({ step: "list-after-load", count: messages.length, firstId: messages[0]?.id ?? null, level: messages[0]?.level ?? null })
  if (!messages.length) {
    const obs = await client.callTool("yunti_observe_page", consoleArgs)
    const logUid = (obs.payload?.elements || []).find((el) => el.tag === "button")?.uid || null
    await boundedCall(client, "yunti_click", { ...consoleArgs, uid: logUid }, 8_000)
    await sleep(900)
    const relisted = await client.callTool("yunti_list_console_messages", { ...consoleArgs, limit: 20 })
    const messagesAfter = relisted.payload?.messages || []
    consoleSteps.push({ step: "list-after-click", count: messagesAfter.length, firstId: messagesAfter[0]?.id ?? null })
    if (messagesAfter.length) {
      consoleSteps.push({ step: "get-console-message", ...(await boundedCall(client, "yunti_get_console_message", { ...consoleArgs, msgId: messagesAfter[0].id }, 8_000)) })
    }
  }
  results.consoleCapture = { tab: consoleTab, steps: consoleSteps }
  if (!consoleSteps.some((s) => s.count > 0)) {
    finding("medium", "console", "no console messages were captured for a page that logs on load and on click; yunti_get_console_message therefore cannot be exercised", JSON.stringify(consoleSteps))
  }
  results.consoleTabCleanup = await boundedCall(client, "yunti_cdp_send_command", {
    browserSessionId: session.browserSessionId,
    tabId: consoleTab.tabId,
    method: "Target.closeTarget",
    params: { targetId: String(consoleTab.tabId) },
  }, 8_000)

  return results
}

/* ------------------------------------------------------------------ *
 * Visible-tab capture probe.
 *
 * yunti_capture_visible_tab is documented as capturing "the visible area of
 * the active Yunti tab". This probe checks whether that means the *target*
 * tab or whatever tab the user actually has in front, by activating the probe
 * tab, capturing, then restoring the previously active tab.
 * ------------------------------------------------------------------ */
async function runVisibleTabProbe(client, session) {
  const outcome = { tool: "yunti_capture_visible_tab" }
  const listed = await client.callTool("yunti_list_browser_targets", {})
  const targets = listed.payload?.targets || []
  const previousActive = targets.find((t) => t.active) || null
  outcome.previouslyActiveTabId = previousActive?.tabId ?? null

  const activate = await client.callTool("yunti_cdp_send_command", {
    browserSessionId: session.browserSessionId,
    tabId: session.tabId,
    method: "Target.activateTarget",
    params: { targetId: String(session.tabId) },
  })
  outcome.activated = activate.ok
  await sleep(700)

  const captured = await client.callTool("yunti_capture_visible_tab", { browserSessionId: session.browserSessionId })
  const dataUrl = captured.payload?.dataUrl || captured.payload?.image || ""
  outcome.captured = captured.ok
  outcome.bytes = typeof dataUrl === "string" ? dataUrl.length : 0
  outcome.latencyMs = captured.clientLatencyMs
  outcome.payloadKeys = captured.payload && typeof captured.payload === "object" ? Object.keys(captured.payload).slice(0, 12) : []

  if (previousActive && Number(previousActive.tabId) !== Number(session.tabId)) {
    const restore = await client.callTool("yunti_cdp_send_command", {
      browserSessionId: session.browserSessionId,
      tabId: previousActive.tabId,
      method: "Target.activateTarget",
      params: { targetId: String(previousActive.tabId) },
    })
    outcome.restoredPreviousTab = restore.ok
  }
  return outcome
}

/* ------------------------------------------------------------------ *
 * Phase 2: per-tool latency at concurrency 1
 * ------------------------------------------------------------------ */
async function runLatency(client, session) {
  const { browserSessionId, tabId } = session
  const cases = [
    { tool: "yunti_list_browser_targets", args: {} },
    { tool: "yunti_get_page_snapshot", args: { browserSessionId } },
    { tool: "yunti_observe_page", args: { browserSessionId } },
    { tool: "yunti_take_snapshot", args: { browserSessionId } },
    { tool: "yunti_find_elements", args: { browserSessionId, query: "probe" } },
    { tool: "yunti_evaluate_script", args: { browserSessionId, expression: "1+1", returnByValue: true } },
    { tool: "yunti_cdp_send_command", args: { browserSessionId, method: "Runtime.evaluate", params: { expression: "1+1", returnByValue: true } } },
    { tool: "yunti_wait_for", args: { browserSessionId, selector: "#probe-title", timeoutMs: 3000 } },
    { tool: "yunti_take_screenshot", args: { browserSessionId, format: "png" } },
    { tool: "yunti_capture_visible_tab", args: { browserSessionId } },
    { tool: "yunti_list_network_requests", args: { browserSessionId, limit: 50 } },
    { tool: "yunti_list_console_messages", args: { browserSessionId, limit: 50 } },
    { tool: "yunti_get_network_log", args: { browserSessionId, limit: 50 } },
    { tool: "yunti_get_cdp_events", args: { browserSessionId, limit: 50 } },
    { tool: "yunti_scroll", args: { browserSessionId, deltaY: 100 } },
    { tool: "yunti_get_tool_usage_hints", args: {} },
    { tool: "yunti_get_browser_target", args: { tabId } },
    { tool: "yunti_select_page", args: { browserSessionId } },
  ]
  const output = {}
  for (const testCase of cases) {
    const samples = []
    const failures = []
    for (let i = 0; i < args.iterations; i++) {
      const result = await client.callTool(testCase.tool, testCase.args)
      samples.push(result.clientLatencyMs)
      if (!result.ok) failures.push({ iteration: i, code: result.payload?.code || result.rpcError?.message || null })
      await sleep(30)
    }
    output[testCase.tool] = { ...stats(samples), samples, failures }
    log(`latency ${testCase.tool}: p50=${output[testCase.tool].p50}ms p95=${output[testCase.tool].p95}ms max=${output[testCase.tool].max}ms failures=${failures.length}`)
    if (failures.length) {
      finding("medium", "latency", `${testCase.tool} failed ${failures.length}/${args.iterations} iterations`, JSON.stringify(failures.slice(0, 3)))
    }
  }
  return output
}

/* ------------------------------------------------------------------ *
 * Phase 3: concurrency behaviour
 * ------------------------------------------------------------------ */
async function runConcurrency(client, session, secondTabId) {
  const { browserSessionId, tabId } = session
  const output = {}

  const scenarios = [
    {
      name: "same-tab-parallel-read",
      build: (level) => Array.from({ length: level }, () => ({ tool: "yunti_get_page_snapshot", args: { browserSessionId } })),
      describe: "N parallel lightweight reads on one tab through MCP stdio",
    },
    {
      name: "same-tab-parallel-observe",
      build: (level) => Array.from({ length: level }, () => ({ tool: "yunti_observe_page", args: { browserSessionId } })),
      describe: "N parallel full DOM observations on one tab through MCP stdio",
    },
    {
      name: "mixed-read-write",
      build: (level) => Array.from({ length: level }, (_, i) => (i % 3 === 0
        ? { tool: "yunti_evaluate_script", args: { browserSessionId, expression: `window.__probe=${i}`, returnByValue: true } }
        : i % 3 === 1
          ? { tool: "yunti_get_page_snapshot", args: { browserSessionId } }
          : { tool: "yunti_scroll", args: { browserSessionId, deltaY: 50 } })),
      describe: "N parallel calls mixing writes and reads on one tab",
    },
    {
      name: "cross-tab-parallel",
      build: (level) => {
        if (!secondTabId) return []
        return Array.from({ length: level }, (_, i) => (i % 2 === 0
          ? { tool: "yunti_get_page_snapshot", args: { browserSessionId } }
          : { tool: "yunti_get_page_snapshot", args: { tabId: secondTabId } }))
      },
      describe: "N parallel reads spread over two tabs",
    },
    {
      name: "mcp-http-mixed",
      build: (level) => Array.from({ length: level }, (_, i) => (i % 2 === 0
        ? { tool: "yunti_observe_page", args: { browserSessionId } }
        : { tool: "yunti_list_browser_targets", args: {} })),
      describe: "N parallel calls issued straight to the bridge HTTP endpoint (bypasses MCP stdio)",
    },
  ]

  for (const scenario of scenarios) {
    output[scenario.name] = { describe: scenario.describe, levels: {} }
    for (const level of args.levels) {
      const calls = scenario.build(level)
      if (!calls.length) continue
      const useHttp = scenario.name === "mcp-http-mixed"
      const runner = useHttp ? bridgeTool : ((call) => client.callTool(call.tool, call.args))
      const { results, wallMs } = await runPool(calls, level, runner)
      const latencies = results.map((r) => (useHttp ? r.latencyMs : r.clientLatencyMs))
      const failures = results.filter((r) => !r.ok || r.timedOut).map((r) => ({
        tool: r.tool,
        timedOut: Boolean(r.timedOut),
        code: r.payload?.code || r.rpcError?.message || r.error || null,
        message: r.payload?.message || null,
      }))
      const perCall = results.map((r, index) => ({
        tool: r.tool,
        latencyMs: useHttp ? r.latencyMs : r.clientLatencyMs,
        sequenceIndex: index,
      }))
      output[scenario.name].levels[level] = {
        calls: calls.length,
        wallMs,
        throughputPerSec: Number((calls.length / (wallMs / 1000)).toFixed(2)),
        latency: stats(latencies),
        serializationRatio: Number((wallMs / Math.max(1, stats(latencies).p50)).toFixed(2)),
        failureCount: failures.length,
        failures: failures.slice(0, 5),
        perCall: perCall.slice(0, 24),
      }
      log(`concurrency ${scenario.name} level=${level}: wall=${wallMs}ms p50=${stats(latencies).p50}ms p95=${stats(latencies).p95}ms failures=${failures.length}`)
      if (failures.length) {
        finding("high", "concurrency", `${scenario.name} at level ${level} produced ${failures.length}/${calls.length} failures`, JSON.stringify(failures.slice(0, 3)))
      }
    }
  }

  // ---- controlled lane experiment --------------------------------------
  // yunti_wait_for on a selector that never appears is a deterministic slow
  // tool (one fixed timeoutMs). It lets us tell "parallel" from "serialized"
  // without depending on page render speed.
  const SLOW_MS = 2500
  const slowCase = (extra = {}) => ({ tool: "yunti_wait_for", args: { browserSessionId, selector: "#definitely-not-here", timeoutMs: SLOW_MS, ...extra } })
  const laneScenarios = [
    { name: "slow-same-tab-through-stdio", build: (level) => Array.from({ length: level }, () => slowCase()), runner: (call) => client.callTool(call.tool, call.args) },
    { name: "slow-same-tab-through-bridge-http", build: (level) => Array.from({ length: level }, () => slowCase()), runner: (call) => bridgeTool(call.tool, call.args, 30_000) },
    { name: "slow-same-tab-explicit-tabId", build: (level) => Array.from({ length: level }, () => slowCase({ tabId })), runner: (call) => bridgeTool(call.tool, call.args, 30_000) },
    {
      name: "slow-cross-tab-through-bridge-http",
      build: (level) => {
        if (!secondTabId) return []
        return Array.from({ length: level }, (_, i) => (i % 2 === 0
          ? slowCase()
          : { tool: "yunti_wait_for", args: { tabId: secondTabId, selector: "#definitely-not-here", timeoutMs: SLOW_MS } }))
      },
      runner: (call) => bridgeTool(call.tool, call.args, 30_000),
    },
  ]
  output["lane-experiment"] = { describe: `deterministic slow tool (yunti_wait_for timeoutMs=${SLOW_MS}) at concurrency 4; ideal parallel wall ≈ ${SLOW_MS}ms, full serialization ≈ ${SLOW_MS * 4}ms`, levels: {} }
  for (const scenario of laneScenarios) {
    const calls = scenario.build(4)
    if (!calls.length) continue
    const { results, wallMs } = await runPool(calls, 4, scenario.runner)
    const latencies = results.map((r) => (r.clientLatencyMs ?? r.latencyMs))
    output["lane-experiment"].levels[scenario.name] = {
      calls: calls.length,
      wallMs,
      latency: stats(latencies),
      failureCount: results.filter((r) => !r.ok && !r.timedOut).length,
      expectedSerialWallMs: SLOW_MS * 4,
      observedOverIdealParallel: Number((wallMs / SLOW_MS).toFixed(2)),
    }
    log(`lane ${scenario.name}: wall=${wallMs}ms (ideal parallel ${SLOW_MS}ms, serial ${SLOW_MS * 4}ms) p50=${stats(latencies).p50}ms`)
  }

  // Bridge queue depth while a slow batch is in flight.
  const queueProbe = { samples: [] }
  const inFlight = Array.from({ length: 6 }, () => bridgeTool("yunti_wait_for", { browserSessionId, selector: "#nope", timeoutMs: SLOW_MS }, 30_000))
  const sampler = (async () => {
    for (let i = 0; i < 6; i++) {
      await sleep(400)
      const state = await bridgeJson("/console/state?userId=local").catch(() => null)
      if (state) queueProbe.samples.push({
        at: i,
        pending: (state.pendingRequests || []).length,
        queued: (state.queuedRequests || []).length,
        pollers: (state.sessions || []).reduce((sum, s) => sum + Number(s.pollers || 0), 0),
      })
    }
  })()
  await Promise.all([...inFlight, sampler])
  queueProbe.maxPending = Math.max(0, ...queueProbe.samples.map((s) => s.pending))
  queueProbe.maxQueued = Math.max(0, ...queueProbe.samples.map((s) => s.queued))
  REPORT.queueProbe = queueProbe
  log(`queue probe: maxPending=${queueProbe.maxPending} maxQueued=${queueProbe.maxQueued}`)

  // Sustained sequential load: 40 observations, no think time.
  const burst = Array.from({ length: 40 }, () => ({ tool: "yunti_get_page_snapshot", args: { browserSessionId } }))
  const burstRun = await runPool(burst, 1, (call) => client.callTool(call.tool, call.args))
  output["sequential-burst"] = {
    describe: "40 back-to-back sequential reads, measuring steady-state latency",
    calls: burst.length,
    wallMs: burstRun.wallMs,
    throughputPerSec: Number((burst.length / (burstRun.wallMs / 1000)).toFixed(2)),
    latency: stats(burstRun.results.map((r) => r.clientLatencyMs)),
    failureCount: burstRun.results.filter((r) => !r.ok).length,
    firstFive: burstRun.results.slice(0, 5).map((r) => r.clientLatencyMs),
    lastFive: burstRun.results.slice(-5).map((r) => r.clientLatencyMs),
  }
  log(`sequential burst: wall=${burstRun.wallMs}ms p50=${output["sequential-burst"].latency.p50}ms max=${output["sequential-burst"].latency.max}ms`)

  // Raw bridge comparison (no MCP stdio in the path).
  const rawSequential = []
  for (let i = 0; i < 10; i++) {
    const result = await bridgeTool("yunti_get_page_snapshot", { browserSessionId })
    rawSequential.push(result.latencyMs)
  }
  REPORT.rawBridge.sequentialSnapshot = stats(rawSequential)
  REPORT.rawBridge.sequentialSnapshotSamples = rawSequential

  const rawParallel = await runPool(
    Array.from({ length: 8 }, () => ({ tool: "yunti_get_page_snapshot", args: { browserSessionId } })),
    8,
    (call) => bridgeTool(call.tool, call.args)
  )
  REPORT.rawBridge.parallel8Snapshot = {
    wallMs: rawParallel.wallMs,
    latency: stats(rawParallel.results.map((r) => r.latencyMs)),
    failureCount: rawParallel.results.filter((r) => !r.ok).length,
  }
  REPORT.rawBridge.bridgeHealth = await bridgeJson("/health").catch((error) => ({ error: error.message }))
  REPORT.rawBridge.consoleState = await bridgeJson("/console/state?userId=local").catch((error) => ({ error: error.message }))

  return output
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
async function main() {
  const fixture = await ensureFixtureServer()
  log(`fixture server ${fixture.reused ? "reused" : "started"} at ${FIXTURE_URL}`)

  let bridgeHealth
  try {
    bridgeHealth = await bridgeJson("/health")
    REPORT.bridge.health = {
      version: bridgeHealth.runtime?.version,
      extensionConnected: bridgeHealth.extensionConnected,
      controllerCount: bridgeHealth.controllerCount,
      pageSessionCount: bridgeHealth.pageSessionCount,
      sessionCount: bridgeHealth.sessionCount,
      compatible: bridgeHealth.compatibility?.ok,
    }
  } catch (error) {
    finding("critical", "bridge", "local bridge is not reachable", error.message)
    throw error
  }

  const client = new McpClient()
  await sleep(1200)
  REPORT.client.stderrStartup = (client.stderr.join("") || "").split("\n").filter(Boolean)
  const init = await client.initialize()
  REPORT.init = init
  REPORT.client.serverInfo = init?.serverInfo
  REPORT.client.bridgeMode = (REPORT.client.stderrStartup.find((line) => line.includes("bridge ")) || "").trim()
  REPORT.client.stderr = client.stderr.join("").split("\n").filter(Boolean).slice(0, 20)
  const tools = await client.listTools()
  REPORT.toolInventory.declaredNames = tools.map((t) => t.name)
  REPORT.toolInventory.declared = tools.length
  REPORT.toolInventory.descriptions = tools.map((t) => ({ name: t.name, description: t.description }))
  log(`MCP tools declared: ${tools.length}`)

  // ---- prepare the probe tab -------------------------------------------
  let session = null
  let openedTab = false
  if (args.tabId) {
    const listed = await client.callTool("yunti_list_browser_targets", {})
    const target = (listed.payload?.targets || []).find((t) => Number(t.tabId) === args.tabId)
    session = { tabId: args.tabId, browserSessionId: target?.browserSessionId || null }
  } else {
    const created = await client.callTool("yunti_new_page", { url: `${FIXTURE_URL}`, active: false })
    openedTab = true
    const createdId = created.payload?.browserSessionId || created.payload?.tabId
    log(`new probe page: ${JSON.stringify({ ok: created.ok, tabId: created.payload?.tabId, session: created.payload?.browserSessionId }).slice(0, 200)}`)
    await sleep(800)
    const resolved = await resolveTargetTab(client, created.payload?.tabId)
    session = { tabId: resolved.target?.tabId || created.payload?.tabId, browserSessionId: resolved.target?.browserSessionId || created.payload?.browserSessionId }
  }
  log(`probe session: ${JSON.stringify(session)}`)
  if (!session?.tabId) throw new Error("could not resolve probe tab")

  const landing = await ensureLanded(client, session, "")
  REPORT.landing = landing
  log(`probe tab landed=${landing.landed} url=${landing.url} attempts=${landing.attempts}`)
  if (!landing.landed) {
    finding("high", "new-page", "yunti_new_page(url, active:false) did not leave the new tab on the requested URL; page tools then fail with UID_NOT_FOUND/ELEMENT_NOT_FOUND on a blank tab", JSON.stringify(landing.trace))
  }
  REPORT.session = session

  // A second tab on the same fixture host, used for cross-tab concurrency.
  let secondTabId = null
  if (args.phase === "all" || args.phase === "concurrency") {
    const second = await client.callTool("yunti_new_page", { url: `${FIXTURE_URL}scroll.html`, active: false })
    await sleep(800)
    secondTabId = second.payload?.tabId || null
    REPORT.secondTab = { tabId: secondTabId, browserSessionId: second.payload?.browserSessionId || null }
  }

  // Smoke starts on the controls page: it carries every action fixture.
  if (args.phase === "all" || args.phase === "smoke" || args.phase === "tools") {
    const controls = await client.callTool("yunti_navigate_page", { browserSessionId: session.browserSessionId, url: `${FIXTURE_URL}controls.html`, action: "url" })
    await sleep(600)
    const controlsLanding = await ensureLanded(client, session, "controls.html")
    REPORT.controlsLanding = { ok: controls.ok, ...controlsLanding }
    if (!controlsLanding.landed) finding("medium", "navigation", "could not land on controls fixture page", JSON.stringify(controlsLanding.trace))
  }

  // ---- phases -----------------------------------------------------------
  if (args.phase === "all" || args.phase === "smoke" || args.phase === "tools") {
    log("phase: smoke")
    REPORT.smoke = await runSmoke(client, session)
    log("phase: visible-tab capture")
    REPORT.visibleTabProbe = await runVisibleTabProbe(client, session).catch((error) => ({ error: error.message }))
  }

  if (args.phase === "all" || args.phase === "latency") {
    log("phase: latency")
    REPORT.latency = await runLatency(client, session)
  }

  if (args.phase === "all" || args.phase === "concurrency") {
    log("phase: concurrency")
    REPORT.concurrency = await runConcurrency(client, session, secondTabId)
  }

  if (args.phase === "all" || args.phase === "smoke" || args.phase === "confirm") {
    log("phase: blocking confirmation probe")
    REPORT.confirmationProbe = await runConfirmationProbe(client, session).catch((error) => ({ error: error.message }))
  }

  if (args.phase === "all" || args.phase === "smoke" || args.phase === "dialog") {
    log("phase: modal dialog probe")
    REPORT.dialogProbe = await runDialogProbe(client, session).catch((error) => ({ error: error.message }))
  }

  if (args.phase === "all" || args.phase === "focused") {
    log("phase: focused repro probes")
    REPORT.focused = await runFocusedProbes(client, session).catch((error) => ({ error: error.message }))
  }

  // tool coverage bookkeeping
  const invoked = new Set(REPORT.smoke.map((entry) => entry.tool))
  if (REPORT.confirmationProbe?.browserSessionId) invoked.add("yunti_request_user_confirmation")
  if (REPORT.dialogProbe?.browserSessionId) {
    invoked.add("yunti_handle_dialog")
    invoked.add("yunti_new_page")
  }
  REPORT.toolInventory.invoked = invoked.size
  REPORT.toolInventory.missing = tools.map((t) => t.name).filter((name) => !invoked.has(name) && !(REPORT.latency[name]))
  const failedSmoke = REPORT.smoke.filter((entry) => !entry.ok)
  REPORT.toolInventory.failed = failedSmoke.map((entry) => ({ tool: entry.tool, code: entry.code, message: entry.message }))

  // ---- cleanup ----------------------------------------------------------
  for (const tabId of [secondTabId, openedTab ? session.tabId : null]) {
    if (!tabId || args.keepTab) continue
    const closed = await client.callTool("yunti_cdp_send_command", { tabId, method: "Target.closeTarget", params: { targetId: String(tabId) } })
    log(`close tab ${tabId}: ok=${closed.ok} ${closed.payload?.error || closed.rpcError?.message || ""}`)
  }
  REPORT.client.stderrTail = client.stderr.join("").split("\n").filter(Boolean).slice(-10)
  REPORT.client.notices = client.notices
  REPORT.finishedAt = new Date().toISOString()
  client.stop()
  if (fixture.child) fixture.child.kill()

  await mkdir(args.out, { recursive: true })
  const jsonPath = join(args.out, "probe-report.json")
  await writeFile(jsonPath, JSON.stringify(REPORT, null, 2), "utf8")
  log(`report written: ${jsonPath}`)
  console.log(jsonPath)
}

main().catch(async (error) => {
  finding("critical", "harness", "probe harness failed", error.stack || error.message)
  try {
    await mkdir(args.out, { recursive: true })
    await writeFile(join(args.out, "probe-report.json"), JSON.stringify(REPORT, null, 2), "utf8")
  } catch {
    // ignore
  }
  console.error(`[probe] fatal: ${error.stack || error.message}`)
  process.exitCode = 1
})
