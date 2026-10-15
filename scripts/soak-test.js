#!/usr/bin/env node
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { access, appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { handleJsonRpc, startBridgeServer } from "../mcp/server.js"
import { TOOLS } from "../mcp/tools.js"
import packageJson from "../package.json" with { type: "json" }
import { startSoakFixtureServer, soakFixtureRoot } from "./soak/fixture-server.js"
import {
  DEFAULT_SOAK_DURATION_MS,
  MIN_QUALIFYING_SOAK_DURATION_MS,
  summarizeSoakCoverage,
} from "./soak/plan.js"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const extensionDir = join(rootDir, "extension")
const options = parseOptions(process.argv.slice(2))
const SCREENSHOT_EVERY_CYCLES = 10
const MAX_P95_CALL_DURATION_MS = 500
const MAX_CALL_DURATION_MS = 10000

await main()

async function main() {
  if (options.help) {
    printHelp()
    return
  }
  if (options.durationMs < MIN_QUALIFYING_SOAK_DURATION_MS && !options.allowShort) {
    throw new Error(
      `A qualifying soak must run for at least 15 minutes. Use --allow-short only for runner development.`
    )
  }

  const playwright = await loadPlaywrightCore()
  const executablePath = await resolveBrowserExecutable(options, playwright)
  const artifactDir = await createArtifactDir(options.artifactRoot)
  const operationsPath = join(artifactDir, "operations.jsonl")
  const profileDir = await mkdtemp(join(tmpdir(), "yunti-soak-profile-"))
  const memoryHome = await mkdtemp(join(tmpdir(), "yunti-soak-memory-"))
  process.env.YUNTI_HOME = memoryHome

  const fixture = await startSoakFixtureServer()
  const bridge = await startBridgeServer({ host: "127.0.0.1", port: 0, sessionTtlMs: 120_000 })
  const bridgeUrl = `http://127.0.0.1:${bridge.server.address().port}`
  const runtime = createRuntimeState({ artifactDir, operationsPath, bridge, fixture, bridgeUrl })
  let context = null
  let page = null
  let failure = null

  try {
    const runtimeExtensionDir = join(profileDir, "fixture-extension")
    await cp(extensionDir, runtimeExtensionDir, { recursive: true })
    const settingsPath = join(runtimeExtensionDir, "settings.js")
    const settings = await readFile(settingsPath, "utf8")
    const isolatedSettings = settings.replace(/export const DEFAULT_BRIDGE_URL = "[^"]+"/, `export const DEFAULT_BRIDGE_URL = ${JSON.stringify(bridgeUrl)}`)
    assert.notEqual(isolatedSettings, settings, "The soak extension must connect only to its isolated Bridge")
    await writeFile(settingsPath, isolatedSettings)
    context = await playwright.chromium.launchPersistentContext(profileDir, {
      headless: false,
      executablePath,
      viewport: { width: 1280, height: 900 },
      args: [
        `--disable-extensions-except=${runtimeExtensionDir}`,
        `--load-extension=${runtimeExtensionDir}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    })
    page = context.pages()[0] || await context.newPage()
    installDialogPolicy(page)
    context.on("page", installDialogPolicy)

    const worker = await getExtensionWorker(context)
    await worker.evaluate(
      ({ runtimeBridgeUrl }) => chrome.storage.local.set({
        bridgeUrl: runtimeBridgeUrl,
        bridgeToken: "",
        platformMatches: ["*"],
        localUserId: "local",
        localUserName: "local",
      }),
      { runtimeBridgeUrl: bridgeUrl }
    )

    await page.goto(fixture.url("/complex-app.html?cycle=0"), { waitUntil: "domcontentloaded" })
    runtime.browserSessionId = await waitForPageSession(bridgeUrl, "/complex-app.html")
    runtime.startedAtMs = Date.now()
    runtime.deadlineMs = runtime.startedAtMs + options.durationMs

    await runFullToolCoverage(runtime)
    while (Date.now() < runtime.deadlineMs) {
      runtime.cycle += 1
      await runContinuousCycle(runtime)
      const elapsedSeconds = Math.round((Date.now() - runtime.startedAtMs) / 1000)
      process.stdout.write(
        `[soak] cycle=${runtime.cycle} elapsed=${elapsedSeconds}s calls=${runtime.operations.length} session=${runtime.browserSessionId}\n`
      )
    }

    runtime.finishedAtMs = Date.now()
    const summary = await buildSummary(runtime, executablePath)
    assert.equal(summary.toolCoverage.complete, true, `Missing tools: ${summary.toolCoverage.missing.join(", ")}`)
    assert.equal(summary.failedCalls, 0)
    assert.equal(summary.duplicateWriteAttempts, 0)
    assert.ok(summary.cycles >= 1)
    assert.ok(summary.elapsedMs >= options.durationMs)
    assert.ok(summary.p95CallDurationMs <= MAX_P95_CALL_DURATION_MS)
    assert.ok(summary.maxCallDurationMs <= MAX_CALL_DURATION_MS)
    summary.ok = true
    await persistSummary(artifactDir, summary)
    process.stdout.write(`${JSON.stringify({ ok: true, artifactDir, summary }, null, 2)}\n`)
  } catch (error) {
    failure = error
    runtime.finishedAtMs = Date.now()
    await persistFailure({ artifactDir, runtime, page, error, executablePath })
    throw error
  } finally {
    await context?.close().catch(() => {})
    await fixture.close().catch(() => {})
    await new Promise((resolvePromise) => bridge.server.close(resolvePromise))
    await rm(profileDir, { recursive: true, force: true }).catch(() => {})
    await rm(memoryHome, { recursive: true, force: true }).catch(() => {})
    if (failure) process.stderr.write(`[soak] failure artifacts: ${artifactDir}\n`)
  }
}

function createRuntimeState({ artifactDir, operationsPath, bridge, fixture, bridgeUrl }) {
  return {
    artifactDir,
    operationsPath,
    bridge,
    fixture,
    bridgeUrl,
    browserSessionId: "",
    startedAtMs: 0,
    finishedAtMs: 0,
    deadlineMs: 0,
    cycle: 0,
    operations: [],
    invokedTools: new Set(),
    staleRecoveries: 0,
    childTabsCreated: 0,
    detachCount: 0,
  }
}

async function runFullToolCoverage(runtime) {
  const session = () => runtime.browserSessionId
  await call(runtime, "yunti_get_tool_usage_hints", { topic: "all" })
  await call(runtime, "yunti_get_page_snapshot", { browserSessionId: session(), mode: "detailed" })
  const observation = await call(runtime, "yunti_observe_page", {
    browserSessionId: session(), mode: "fullPage", maxElements: 300, redaction: "balanced",
  })
  assert.ok(observation.elementCount > 10)
  const foundSave = await call(runtime, "yunti_find_elements", {
    browserSessionId: session(), query: "Save case once", role: "button",
  })
  assert.ok(foundSave.matches?.length >= 1)

  await call(runtime, "yunti_evaluate_script", {
    browserSessionId: session(),
    expression: `(() => { const node = document.querySelector('#selected-copy').firstChild; const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString(); })()`,
  })
  const selected = await call(runtime, "yunti_get_selected_context", { browserSessionId: session() })
  assert.match(selected.text, /Persistent selection context/)

  const targets = await call(runtime, "yunti_list_browser_targets", { browserSessionId: session() })
  const mainTarget = targets.pages.find((target) => String(target.url).includes("/complex-app.html"))
  assert.ok(mainTarget?.tabId)
  await call(runtime, "yunti_get_browser_target", {
    browserSessionId: session(), tabId: mainTarget.tabId,
  })
  await call(runtime, "yunti_list_pages", { browserSessionId: session() })
  await call(runtime, "yunti_select_page", { browserSessionId: session() })
  await call(runtime, "yunti_take_snapshot", { browserSessionId: session(), maxElements: 300 })

  await call(runtime, "yunti_fill", { browserSessionId: session(), selector: "#owner", value: "Coverage Owner" })
  await call(runtime, "yunti_type_text", {
    browserSessionId: session(), selector: "#email", text: "coverage@example.test", clear: true,
  })
  await call(runtime, "yunti_press_key", { browserSessionId: session(), selector: "#search", key: "A" })
  await call(runtime, "yunti_fill_form", {
    browserSessionId: session(),
    fields: [
      { selector: "#notes", value: "Full tool coverage notes" },
      { selector: "#search", value: "coverage" },
    ],
  })
  await call(runtime, "yunti_select", { browserSessionId: session(), selector: "#priority", value: "urgent" })
  await call(runtime, "yunti_hover", { browserSessionId: session(), selector: "#hover-target" })
  await call(runtime, "yunti_click", { browserSessionId: session(), selector: "#async-action" })
  const asyncWait = await call(runtime, "yunti_wait_for", {
    browserSessionId: session(), text: "Async complete 1", timeoutMs: 4000,
  })
  assert.equal(asyncWait.ok, true)

  const coordinateRect = await evaluateJson(runtime, `(() => { const r = document.querySelector('#coordinate-target').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`)
  await call(runtime, "yunti_click_at", { browserSessionId: session(), x: coordinateRect.x, y: coordinateRect.y })
  await call(runtime, "yunti_scroll", { browserSessionId: session(), x: 200, y: 650, deltaY: 420 })

  const dragRects = await evaluateJson(runtime, `(() => { const a = document.querySelector('#drag-card').getBoundingClientRect(); const b = document.querySelector('#drop-zone').getBoundingClientRect(); return { fromX: a.left + a.width / 2, fromY: a.top + a.height / 2, toX: b.left + b.width / 2, toY: b.top + b.height / 2 }; })()`)
  await call(runtime, "yunti_drag", { browserSessionId: session(), ...dragRects, steps: 12 })
  await call(runtime, "yunti_upload_file", {
    browserSessionId: session(), selector: "#upload", filePaths: [join(soakFixtureRoot, "upload.txt")],
  })

  const patch = await call(runtime, "yunti_apply_preview_patch", {
    browserSessionId: session(), patchId: "soak-coverage-patch",
    patches: [{ selector: "#preview-target", text: "Patched by soak coverage", style: { color: "rgb(178, 58, 72)" } }],
  })
  assert.equal(patch.applied, 1)
  await call(runtime, "yunti_rollback_preview_patch", {
    browserSessionId: session(), patchId: "soak-coverage-patch",
  })

  await call(runtime, "yunti_clear_network_log", { browserSessionId: session() })
  const fetched = await call(runtime, "yunti_fetch_with_cookie", {
    browserSessionId: session(), url: runtime.fixture.url("/api/queue?cycle=coverage"), method: "GET",
  })
  assert.equal(fetched.status, 200)
  await call(runtime, "yunti_click", { browserSessionId: session(), selector: "#refresh-data" })
  await waitForDiagnosticCount(runtime, "networkEvents", 1)
  const networkRequests = await call(runtime, "yunti_list_network_requests", {
    browserSessionId: session(), urlContains: "/api/queue", limit: 50,
  })
  await call(runtime, "yunti_get_network_request", {
    browserSessionId: session(), eventId: networkRequests.events.at(-1).id,
  })
  await call(runtime, "yunti_get_network_log", { browserSessionId: session(), limit: 50 })
  await call(runtime, "yunti_clear_network_requests", { browserSessionId: session() })

  await call(runtime, "yunti_cdp_send_command", {
    browserSessionId: session(), method: "Runtime.evaluate",
    params: { expression: `console.log('YUNTI_SOAK_CDP coverage'); document.title`, returnByValue: true },
  })
  await waitForDiagnosticCount(runtime, "consoleMessages", 1)
  const consoleMessages = await call(runtime, "yunti_list_console_messages", {
    browserSessionId: session(), limit: 100,
  })
  const consoleMessage = consoleMessages.events.find((event) => event.text.includes("YUNTI_SOAK_CDP"))
  await call(runtime, "yunti_get_console_message", { browserSessionId: session(), msgId: consoleMessage.id })
  await call(runtime, "yunti_get_cdp_events", { browserSessionId: session(), limit: 100 })
  await call(runtime, "yunti_clear_console_messages", { browserSessionId: session() })
  await call(runtime, "yunti_clear_cdp_events", { browserSessionId: session() })

  // An oversized evaluate hands the whole serialization to the bridge, which
  // returns a cursor in its place. Reading it back must reproduce the held text
  // exactly — that digest is the only proof the slices are the same result and
  // not a re-run of the expression.
  const oversized = await call(runtime, "yunti_evaluate_script", {
    browserSessionId: session(),
    expression: "({ rows: 'soak'.repeat(400), note: 'chunk-coverage' })",
    maxLength: 50,
  })
  assert.equal(oversized.truncated, true)
  assert.equal(oversized.value, null, "an oversized structured value must not be advertised as a prefix")
  assert.ok(oversized.resultId, "a truncated result must expose a resultId")
  const firstSlice = await call(runtime, "yunti_read_result_chunk", { resultId: oversized.resultId, length: 100 })
  const secondSlice = await call(runtime, "yunti_read_result_chunk", {
    resultId: oversized.resultId, offset: firstSlice.nextOffset, length: 100000,
  })
  assert.equal(firstSlice.complete, false)
  assert.equal(secondSlice.complete, true)
  const rebuilt = firstSlice.text + secondSlice.text
  assert.equal(
    createHash("sha256").update(rebuilt, "utf8").digest("hex"),
    oversized.resultSha256,
    "the concatenated slices must reproduce the held result"
  )

  // The isolated profile begins with no downloads. This asserts the call works
  // and reports honestly, not that a file exists — the download path itself is
  // covered by the real-browser interaction test.
  const downloads = await call(runtime, "yunti_list_downloads", { browserSessionId: session(), limit: 5 })
  assert.equal(Array.isArray(downloads.downloads), true)
  assert.equal(typeof downloads.matched, "number")

  await call(runtime, "yunti_capture_visible_tab", { browserSessionId: session() })
  await call(runtime, "yunti_take_screenshot", { browserSessionId: session(), format: "jpeg", quality: 45 })
  await call(runtime, "yunti_performance_start_trace", { browserSessionId: session() })
  await call(runtime, "yunti_evaluate_script", {
    browserSessionId: session(), expression: `new Promise(resolve => requestAnimationFrame(() => resolve(document.body.innerText.length)))`, awaitPromise: true,
  })
  await call(runtime, "yunti_performance_stop_trace", { browserSessionId: session() })

  await call(runtime, "yunti_resize_page", { browserSessionId: session(), width: 1024, height: 760, deviceScaleFactor: 1 })
  await call(runtime, "yunti_emulate", { browserSessionId: session(), deviceName: "iPhone SE" })
  await call(runtime, "yunti_emulate", { browserSessionId: session(), clear: true })
  await call(runtime, "yunti_resize_page", { browserSessionId: session(), width: 1280, height: 900, deviceScaleFactor: 1 })

  await call(runtime, "yunti_evaluate_script", {
    browserSessionId: session(), expression: `setTimeout(() => document.querySelector('#prompt-action').click(), 50); 'prompt-scheduled'`,
  })
  await delay(180)
  await call(runtime, "yunti_handle_dialog", {
    browserSessionId: session(), action: "accept", promptText: "handled-by-yunti",
  })
  const confirmation = await call(runtime, "yunti_request_user_confirmation", {
    browserSessionId: session(), message: "Confirm soak coverage", detail: "Automated acceptance dialog",
  })
  assert.equal(confirmation.approved, true)

  const memoryUserId = `soak-${process.pid}-${Date.now()}`
  const remembered = await call(runtime, "yunti_remember_learning", {
    userId: memoryUserId, kind: "soak", title: "Temporary soak memory",
    detail: "This record must be deleted in the same acceptance run.", tags: ["temporary", "soak"],
  })
  const memories = await call(runtime, "yunti_get_learning_memory", {
    userId: memoryUserId, query: "Temporary soak memory",
  })
  assert.ok(memories.memories.some((memory) => memory.id === remembered.memory.id))
  await call(runtime, "yunti_forget_learning_memory", { userId: memoryUserId, id: remembered.memory.id })

  const child = await call(runtime, "yunti_new_page", { url: runtime.fixture.url("/soak-child.html?tool=new_page"), active: false })
  assert.equal(child.ready, true)
  runtime.childTabsCreated += 1
  await waitForRegisteredSession(runtime.bridgeUrl, child.browserSessionId)
  await call(runtime, "yunti_select_page", { browserSessionId: child.browserSessionId })
  await call(runtime, "yunti_get_page_snapshot", { browserSessionId: child.browserSessionId, mode: "light" })
  await call(runtime, "yunti_select_page", { browserSessionId: session() })
  await call(runtime, "yunti_close_page", { browserSessionId: child.browserSessionId })

  await call(runtime, "yunti_navigate_page", {
    browserSessionId: session(), url: runtime.fixture.url("/soak-child.html?tool=navigate"), action: "url",
  })
  await call(runtime, "yunti_wait_for", { browserSessionId: session(), urlContains: "tool=navigate", timeoutMs: 5000 })
  await call(runtime, "yunti_navigate_page", { browserSessionId: session(), action: "back" })
  await call(runtime, "yunti_wait_for", { browserSessionId: session(), urlContains: "complex-app.html", timeoutMs: 5000 })

  await call(runtime, "yunti_cdp_detach", { browserSessionId: session() })
  runtime.detachCount += 1
  await call(runtime, "yunti_get_page_snapshot", { browserSessionId: session(), mode: "light" })
}

async function runContinuousCycle(runtime) {
  const cycle = runtime.cycle
  const session = runtime.browserSessionId
  await assertHealthy(runtime)
  await call(runtime, "yunti_navigate_page", {
    browserSessionId: session,
    url: runtime.fixture.url(`/complex-app.html?cycle=${cycle}`),
    action: "url",
  })
  const ready = await call(runtime, "yunti_wait_for", {
    browserSessionId: session, selector: "#case-form", timeoutMs: 5000,
  })
  assert.equal(ready.ok, true)

  const observation = await call(runtime, "yunti_observe_page", {
    browserSessionId: session, mode: "viewport", maxElements: 220, redaction: "balanced",
  })
  assert.ok(observation.elementCount > 8)
  await call(runtime, "yunti_find_elements", {
    browserSessionId: session, query: "Save case once", role: "button", maxResults: 5,
  })
  await call(runtime, "yunti_fill_form", {
    browserSessionId: session,
    fields: [
      { selector: "#owner", value: `Soak Owner ${cycle}` },
      { selector: "#email", value: `owner-${cycle}@example.test` },
      { selector: "#notes", value: `Continuous cycle ${cycle}` },
      { selector: "#search", value: `SOAK-${cycle}` },
    ],
  })
  await call(runtime, "yunti_select", {
    browserSessionId: session, selector: "#priority", value: cycle % 2 ? "high" : "urgent",
  })
  await call(runtime, "yunti_hover", { browserSessionId: session, selector: "#hover-target" })
  await call(runtime, "yunti_click", { browserSessionId: session, selector: "#async-action" })
  const asyncDone = await call(runtime, "yunti_wait_for", {
    browserSessionId: session, text: "Async complete 1", timeoutMs: 4000,
  })
  assert.equal(asyncDone.ok, true)

  await call(runtime, "yunti_click", { browserSessionId: session, selector: "#save" })
  const saved = await call(runtime, "yunti_wait_for", {
    browserSessionId: session, text: "Saved 1 / 1", timeoutMs: 5000,
  })
  assert.equal(saved.ok, true)
  const pageState = await evaluateJson(runtime, `window.__soakState`)
  assert.equal(pageState.saveCount, 1)
  assert.deepEqual(pageState.saveKeys, [`cycle-${cycle}`])

  await call(runtime, "yunti_click", { browserSessionId: session, selector: "#refresh-data" })
  await delay(100)
  const queueState = await evaluateJson(runtime, `({ loads: window.__soakState.networkLoads, rows: document.querySelectorAll('#queue-body tr').length })`)
  assert.ok(queueState.loads >= 2)
  assert.equal(queueState.rows, 12)

  const beforeRerender = await call(runtime, "yunti_observe_page", {
    browserSessionId: session, mode: "fullPage", maxElements: 220, redaction: "balanced",
  })
  const rerender = beforeRerender.elements.find((element) => element.name === "Rerender controls")
  assert.ok(rerender?.uid)
  await call(runtime, "yunti_click", { browserSessionId: session, uid: rerender.uid })
  const afterRerender = await call(runtime, "yunti_observe_page", {
    browserSessionId: session, mode: "fullPage", responseMode: "full", maxElements: 220, redaction: "balanced",
  })
  const dynamic = afterRerender.elements.find((element) => String(element.name).startsWith("Rerendered action"))
  assert.ok(dynamic?.uid)
  await call(runtime, "yunti_click", { browserSessionId: session, uid: dynamic.uid })
  const delta = await call(runtime, "yunti_observe_page", {
    browserSessionId: session, responseMode: "delta", maxElements: 220, redaction: "balanced",
  })
  assert.equal(delta.responseMode, "delta")

  const targets = await call(runtime, "yunti_list_browser_targets", { browserSessionId: session })
  const mainTarget = targets.pages.find((target) => String(target.url).includes(`cycle=${cycle}`))
  assert.ok(mainTarget?.tabId)
  const recovered = await call(runtime, "yunti_observe_page", {
    browserSessionId: `yunti-${mainTarget.tabId}-expired-soak-route`, redaction: "balanced", maxElements: 80,
  })
  assert.equal(recovered.browserSessionId, session)
  runtime.staleRecoveries += 1

  await call(runtime, "yunti_cdp_send_command", {
    browserSessionId: session, method: "Runtime.evaluate",
    params: { expression: `console.log('YUNTI_SOAK_CYCLE', ${cycle}); window.__soakState.saveCount`, returnByValue: true },
  })
  await call(runtime, "yunti_get_page_snapshot", { browserSessionId: session, mode: "light", maxTextLength: 3000 })
  await call(runtime, "yunti_list_network_requests", { browserSessionId: session, limit: 40 })
  await call(runtime, "yunti_get_cdp_events", { browserSessionId: session, limit: 40 })

  if (cycle % SCREENSHOT_EVERY_CYCLES === 0) {
    await call(runtime, "yunti_take_screenshot", { browserSessionId: session, format: "jpeg", quality: 35 })
  }
  if (cycle % 3 === 0) {
    const child = await call(runtime, "yunti_new_page", {
      url: runtime.fixture.url(`/soak-child.html?cycle=${cycle}`), active: false,
    })
    assert.equal(child.ready, true)
    runtime.childTabsCreated += 1
    await waitForRegisteredSession(runtime.bridgeUrl, child.browserSessionId)
    await call(runtime, "yunti_get_page_snapshot", { browserSessionId: child.browserSessionId, mode: "light" })
    await call(runtime, "yunti_close_page", { browserSessionId: child.browserSessionId })
  }
  if (cycle % 4 === 0) {
    await call(runtime, "yunti_cdp_detach", { browserSessionId: session })
    runtime.detachCount += 1
    await call(runtime, "yunti_get_page_snapshot", { browserSessionId: session, mode: "light" })
  }
  await assertHealthy(runtime)
}

async function call(runtime, name, args = {}) {
  const startedAt = Date.now()
  runtime.invokedTools.add(name)
  const operation = {
    sequence: runtime.operations.length + 1,
    cycle: runtime.cycle,
    tool: name,
    startedAt: new Date(startedAt).toISOString(),
    ok: false,
    durationMs: 0,
  }
  try {
    const response = await handleJsonRpc({
      jsonrpc: "2.0",
      id: operation.sequence,
      method: "tools/call",
      params: { name, arguments: args },
    }, runtime.bridge)
    const text = response?.result?.content?.[0]?.text || ""
    if (response?.result?.isError) {
      const details = response.result.structuredContent || safeJsonParse(text) || {}
      const error = new Error(details.message || details.error || text || `${name} failed`)
      error.tool = name
      error.details = details
      throw error
    }
    const result = response?.result?.structuredContent ?? safeJsonParse(text)
    operation.ok = true
    operation.durationMs = Date.now() - startedAt
    operation.result = summarizeResult(result)
    runtime.operations.push(operation)
    await appendFile(runtime.operationsPath, `${JSON.stringify(operation)}\n`)
    return result
  } catch (error) {
    operation.durationMs = Date.now() - startedAt
    operation.error = {
      message: String(error?.message || error),
      code: error?.details?.code || "",
      retryable: error?.details?.retryable,
      retryBudget: error?.details?.retryBudget,
      resultUncertain: error?.details?.resultUncertain,
    }
    runtime.operations.push(operation)
    await appendFile(runtime.operationsPath, `${JSON.stringify(operation)}\n`)
    throw error
  }
}

async function waitForDiagnosticCount(runtime, field, minimum, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await fetch(`${runtime.bridgeUrl}/console/state?userId=local`)
    const state = await response.json()
    if (Number(state?.diagnostics?.[field] || 0) >= minimum) return state
    await delay(100)
  }
  throw new Error(`${field} did not reach ${minimum} within ${timeoutMs} ms`)
}

async function evaluateJson(runtime, expression) {
  const evaluated = await call(runtime, "yunti_evaluate_script", {
    browserSessionId: runtime.browserSessionId,
    expression: `JSON.stringify(${expression})`,
  })
  return JSON.parse(evaluated.value)
}

async function assertHealthy(runtime) {
  const response = await fetch(`${runtime.bridgeUrl}/health?userId=local`)
  assert.equal(response.status, 200)
  const health = await response.json()
  assert.equal(health.ok, true)
  assert.ok(health.controllerCount >= 1)
  assert.ok(health.sessions.some((session) => session.browserSessionId === runtime.browserSessionId))
  const controller = health.sessions.find((session) => session.kind === "browser_controller")
  assert.ok(controller)
  assert.ok(Date.parse(controller.expiresAt) > Date.now())
  assert.ok(health.sessions.reduce((sum, item) => sum + Number(item.pollers || 0), 0) <= health.controllerCount)
}

async function buildSummary(runtime, executablePath) {
  const fixtureState = await runtime.fixture.state()
  const durations = runtime.operations.map((operation) => operation.durationMs).sort((a, b) => a - b)
  const availableTools = TOOLS.map((tool) => tool.name)
  const elapsedMs = runtime.startedAtMs > 0
    ? Math.max(0, runtime.finishedAtMs - runtime.startedAtMs)
    : 0
  const perTool = Object.values(runtime.operations.reduce((accumulator, operation) => {
    const item = accumulator[operation.tool] || { tool: operation.tool, calls: 0, failures: 0, durations: [] }
    item.calls += 1
    if (!operation.ok) item.failures += 1
    item.durations.push(operation.durationMs)
    accumulator[operation.tool] = item
    return accumulator
  }, {})).map((item) => {
    item.durations.sort((a, b) => a - b)
    return {
      tool: item.tool,
      calls: item.calls,
      failures: item.failures,
      p50DurationMs: percentile(item.durations, 0.5),
      p95DurationMs: percentile(item.durations, 0.95),
      maxDurationMs: item.durations.at(-1) || 0,
      overOneSecond: item.durations.filter((durationMs) => durationMs >= 1000).length,
    }
  }).sort((a, b) => b.maxDurationMs - a.maxDurationMs)
  const slowestCalls = [...runtime.operations]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 20)
    .map(({ sequence, cycle, tool, startedAt, ok, durationMs }) => ({
      sequence,
      cycle,
      tool,
      startedAt,
      ok,
      durationMs,
    }))
  return {
    ok: false,
    runtimeVersion: packageJson.version,
    browserExecutable: executablePath,
    startedAt: new Date(runtime.startedAtMs).toISOString(),
    finishedAt: new Date(runtime.finishedAtMs).toISOString(),
    configuredDurationMs: options.durationMs,
    elapsedMs,
    qualifyingDuration: elapsedMs >= MIN_QUALIFYING_SOAK_DURATION_MS,
    cycles: runtime.cycle,
    totalCalls: runtime.operations.length,
    successfulCalls: runtime.operations.filter((operation) => operation.ok).length,
    failedCalls: runtime.operations.filter((operation) => !operation.ok).length,
    p50CallDurationMs: percentile(durations, 0.5),
    p95CallDurationMs: percentile(durations, 0.95),
    p99CallDurationMs: percentile(durations, 0.99),
    maxCallDurationMs: durations.at(-1) || 0,
    callsOverOneSecond: durations.filter((durationMs) => durationMs >= 1000).length,
    latencyBudget: {
      maxP95CallDurationMs: MAX_P95_CALL_DURATION_MS,
      maxCallDurationMs: MAX_CALL_DURATION_MS,
    },
    screenshotEveryCycles: SCREENSHOT_EVERY_CYCLES,
    perTool,
    slowestCalls,
    staleRecoveries: runtime.staleRecoveries,
    childTabsCreated: runtime.childTabsCreated,
    detachCount: runtime.detachCount,
    acceptedWriteCount: fixtureState.acceptedWriteCount,
    duplicateWriteAttempts: fixtureState.duplicateWriteAttempts,
    toolCoverage: summarizeSoakCoverage(runtime.invokedTools, availableTools),
  }
}

async function persistSummary(artifactDir, summary) {
  await writeFile(join(artifactDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)
  await writeFile(join(artifactDir, "summary.md"), [
    "# Yunti Browser Runtime Soak Test",
    "",
    `- Result: ${summary.ok ? "PASS" : "FAIL"}`,
    `- Runtime: ${summary.runtimeVersion}`,
    `- Elapsed: ${formatDuration(summary.elapsedMs)}`,
    `- Qualifying 15-minute duration: ${summary.qualifyingDuration}`,
    `- Cycles: ${summary.cycles}`,
    `- Tool coverage: ${summary.toolCoverage.coveredCount}/${summary.toolCoverage.expectedCount}`,
    `- Calls: ${summary.successfulCalls}/${summary.totalCalls} successful`,
    `- Duplicate write attempts: ${summary.duplicateWriteAttempts}`,
    `- Stale-route recoveries: ${summary.staleRecoveries}`,
    `- Call latency p50/p95/p99/max: ${summary.p50CallDurationMs}/${summary.p95CallDurationMs}/${summary.p99CallDurationMs}/${summary.maxCallDurationMs} ms`,
    `- Calls over 1 second: ${summary.callsOverOneSecond}`,
    `- Latency budget p95/max: ${summary.latencyBudget.maxP95CallDurationMs}/${summary.latencyBudget.maxCallDurationMs} ms`,
    `- Screenshot cadence: every ${summary.screenshotEveryCycles} cycles`,
    "",
    summary.toolCoverage.missing.length ? `Missing tools: ${summary.toolCoverage.missing.join(", ")}` : "All published MCP tools were invoked.",
  ].join("\n") + "\n")
}

async function persistFailure({ artifactDir, runtime, page, error, executablePath }) {
  await mkdir(artifactDir, { recursive: true })
  await writeFile(join(artifactDir, "error.log"), `${error?.stack || String(error)}\n`).catch(() => {})
  await page?.screenshot({ path: join(artifactDir, "failure.png"), fullPage: true }).catch(() => {})
  await writeFile(join(artifactDir, "bridge-state.json"), JSON.stringify(
    runtime.bridge.hub?.consoleState({
      userId: "local",
      runtimeVersion: packageJson.version,
      expectedExtensionVersion: packageJson.version,
    }) || {}, null, 2
  )).catch(() => {})
  const summary = await buildSummary(runtime, executablePath).catch(() => ({
    ok: false,
    runtimeVersion: packageJson.version,
    elapsedMs: Math.max(0, runtime.finishedAtMs - runtime.startedAtMs),
    cycles: runtime.cycle,
    totalCalls: runtime.operations.length,
    failedCalls: runtime.operations.filter((operation) => !operation.ok).length,
    duplicateWriteAttempts: null,
    toolCoverage: summarizeSoakCoverage(runtime.invokedTools, TOOLS.map((tool) => tool.name)),
  }))
  summary.ok = false
  summary.failure = String(error?.message || error)
  await persistSummary(artifactDir, summary).catch(() => {})
}

async function createArtifactDir(artifactRoot) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const artifactDir = join(artifactRoot, timestamp)
  await mkdir(artifactDir, { recursive: true })
  return artifactDir
}

async function loadPlaywrightCore() {
  try {
    return await import("playwright-core")
  } catch {
    try {
      return await import("playwright")
    } catch {
      throw new Error("soak-test requires playwright-core. Reinstall yunti-browser-runtime so its runtime dependency is available.")
    }
  }
}

async function resolveBrowserExecutable({ executablePath, browser }, playwright) {
  if (executablePath) {
    await access(executablePath)
    return executablePath
  }
  if (browser !== "edge") {
    const testingChromium = playwright.chromium.executablePath()
    try {
      await access(testingChromium)
      return testingChromium
    } catch {
      throw new Error(
        "The extension endurance test needs Playwright Chromium because current branded Chrome ignores --load-extension. Run `npx playwright-core install chromium`, then rerun soak-test."
      )
    }
  }
  const home = process.env.HOME || ""
  const localAppData = process.env.LOCALAPPDATA || ""
  const candidates = browser === "edge"
    ? [
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
        "/usr/bin/microsoft-edge",
        "/usr/bin/microsoft-edge-stable",
      ]
    : [join(home, ".cache", "ms-playwright", "chromium", "chrome-linux", "chrome")]
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await access(candidate)
      return candidate
    } catch {}
  }
  throw new Error(`Could not find ${browser === "edge" ? "Microsoft Edge" : "Google Chrome"}. Pass --executable-path=/absolute/path.`)
}

async function getExtensionWorker(context) {
  const existing = context.serviceWorkers()[0]
  if (existing) return existing
  return context.waitForEvent("serviceworker", { timeout: 15_000 })
}

function installDialogPolicy(page) {
  page.on("dialog", async (dialog) => {
    if (dialog.message().includes("Confirm soak coverage")) {
      await dialog.accept().catch(() => {})
    }
  })
}

async function waitForPageSession(bridgeUrl, urlIncludes) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const response = await fetch(`${bridgeUrl}/health?userId=local`)
    const health = await response.json()
    const session = health.sessions?.find((item) =>
      item.kind !== "browser_controller" && String(item.url || "").includes(urlIncludes)
    )
    if (session?.browserSessionId) return session.browserSessionId
    await delay(200)
  }
  throw new Error(`Timed out waiting for page session containing ${urlIncludes}`)
}

async function waitForRegisteredSession(bridgeUrl, browserSessionId) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const response = await fetch(`${bridgeUrl}/health?userId=local`)
    const health = await response.json()
    if (health.sessions?.some((session) => session.browserSessionId === browserSessionId)) return
    await delay(150)
  }
  throw new Error(`Timed out waiting for registered session ${browserSessionId}`)
}

function summarizeResult(result) {
  if (result === null || result === undefined) return { type: String(result) }
  const serialized = JSON.stringify(result)
  const summary = {
    bytes: Buffer.byteLength(serialized, "utf8"),
    keys: typeof result === "object" && !Array.isArray(result) ? Object.keys(result).slice(0, 20) : [],
  }
  // waitedMs is the tool's own timer, and it is the only field that separates
  // "the wait itself took this long" from "the round trip took this long".
  // Without it a max-latency breach cannot be attributed: a 20 s wait_for looks
  // identical whether the extension waited 20 s or the request sat in transport
  // and then waited 200 ms.
  for (const key of ["ok", "code", "browserSessionId", "action", "method", "total", "returned", "elementCount", "waitedMs"]) {
    if (result?.[key] !== undefined) summary[key] = result[key]
  }
  return summary
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function percentile(values, ratio) {
  if (!values.length) return 0
  const index = Math.max(0, Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1))
  return values[index]
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000)
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`
}

function parseOptions(args) {
  const valueFor = (prefix) => args.find((arg) => arg.startsWith(`${prefix}=`))?.slice(prefix.length + 1)
  const minutes = Number(valueFor("--duration-minutes"))
  const seconds = Number(valueFor("--duration-seconds"))
  const durationMs = Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : Number.isFinite(minutes) && minutes > 0
      ? minutes * 60 * 1000
      : DEFAULT_SOAK_DURATION_MS
  return {
    help: args.includes("--help") || args.includes("-h"),
    allowShort: args.includes("--allow-short"),
    browser: valueFor("--browser") === "edge" ? "edge" : "chrome",
    executablePath: String(valueFor("--executable-path") || process.env.YUNTI_SOAK_EXECUTABLE_PATH || "").trim(),
    artifactRoot: resolve(
      String(valueFor("--artifact-dir") || process.env.YUNTI_SOAK_ARTIFACT_DIR || join(process.cwd(), ".artifacts", "soak")).trim()
    ),
    durationMs: Math.round(durationMs),
  }
}

function printHelp() {
  process.stdout.write(`Yunti Browser Runtime soak test\n\nUsage:\n  yunti-browser-runtime soak-test [options]\n\nOptions:\n  --browser=chrome|edge          Browser to launch (default: chrome)\n  --executable-path=/path        Explicit browser executable\n  --duration-minutes=15          Continuous run duration (default and minimum: 15)\n  --allow-short                  Permit a non-qualifying development run\n  --duration-seconds=30          Short development duration; requires --allow-short\n  --artifact-dir=/path           Artifact root (default: <current-dir>/.artifacts/soak)\n\nEach run writes a timestamped directory under the artifact root.\n`)
}
