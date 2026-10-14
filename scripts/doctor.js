#!/usr/bin/env node
import http from "node:http"
import { homedir } from "node:os"
import { inspectSkillCopies } from "../lib/skill-status.js"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const bridgeUrl = normalizeBaseUrl(
  process.env.YUNTI_BROWSER_BRIDGE_URL || "http://127.0.0.1:48887"
)
const routeUserId = process.env.YUNTI_BROWSER_USER_ID || "local"
const bridgeToken = String(process.env.YUNTI_BROWSER_BRIDGE_TOKEN || "").trim()
const bridgeTokenHeader = "x-yunti-browser-token"
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const mcpServerPath = join(rootDir, "mcp", "server.js")
const skillPath = join(rootDir, "skills", "yunti-browser-runtime", "SKILL.md")
const packageVersion = readJson(join(rootDir, "package.json")).version || ""
const expectedExtensionVersion = readJson(join(rootDir, "extension", "manifest.json")).version || packageVersion
const expectedProtocolVersion = 1

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return {}
  }
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "")
}

function nodeVersionStatus() {
  const major = Number(process.versions.node.split(".")[0])
  return {
    ok: Number.isFinite(major) && major >= 22,
    version: process.version,
    required: ">=22",
  }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, {
      headers: bridgeToken ? { [bridgeTokenHeader]: bridgeToken } : {},
    }, (res) => {
      let body = ""
      res.setEncoding("utf8")
      res.on("data", (chunk) => {
        body += chunk
      })
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(body || "{}") })
        } catch (error) {
          reject(error)
        }
      })
    })
    req.on("error", reject)
    req.setTimeout(3000, () => {
      req.destroy(new Error("bridge health check timed out"))
    })
  })
}

async function checkBridge() {
  try {
    const health = await getJson(
      `${bridgeUrl}/health?userId=${encodeURIComponent(routeUserId)}`
    )
    const consoleState = await getJson(
      `${bridgeUrl}/console/state?userId=${encodeURIComponent(routeUserId)}`
    ).catch(() => null)
    const authorized = health.json?.authorized !== false
    const authRequired = health.json?.auth?.required !== false && Boolean(health.json?.auth?.required)
    const sessions = Array.isArray(health.json?.sessions) ? health.json.sessions : []
    const controllerSessions = sessions.filter((session) => session?.kind === "browser_controller")
    const pageSessions = sessions.filter((session) => session?.kind !== "browser_controller")
    const activeSessionId = health.json?.activeSessionId || null
    const browserControllerSessionId = health.json?.browserControllerSessionId || controllerSessions[0]?.browserSessionId || null
    const extensionConnected = Boolean(health.json?.extensionConnected) || controllerSessions.length > 0 || pageSessions.length > 0
    const compatibilitySessions = controllerSessions.length ? controllerSessions : sessions
    const extensionVersions = [...new Set(compatibilitySessions
      .map((session) => String(session?.client?.extensionVersion || session?.extensionVersion || "").trim())
      .filter(Boolean))]
    const protocolVersions = [...new Set(compatibilitySessions
      .map((session) => Number(session?.protocolVersion ?? session?.client?.protocolVersion))
      .filter((value) => Number.isInteger(value) && value > 0))]
    const versionCompatible = !extensionConnected || (
      extensionVersions.length > 0 &&
      extensionVersions.every((version) => version === expectedExtensionVersion)
    )
    const protocolCompatible = !extensionConnected || (
      protocolVersions.length > 0 &&
      protocolVersions.every((version) => version === expectedProtocolVersion)
    )
    const runningRuntimeVersion = String(
      health.json?.runtime?.version || consoleState?.json?.runtime?.version || ""
    ).trim()
    const runtimeCompatible = runningRuntimeVersion === packageVersion
    const compatibility = {
      ok: runtimeCompatible && versionCompatible && protocolCompatible && health.json?.compatibility?.ok !== false,
      runtimeVersion: packageVersion,
      runningRuntimeVersion: runningRuntimeVersion || null,
      runtimeCompatible,
      expectedExtensionVersion,
      expectedProtocolVersion,
      extensionVersions,
      protocolVersions,
      bridge: health.json?.compatibility || null,
    }
    return {
      ok: health.status === 200 && authorized && compatibility.ok,
      reachable: health.status === 200,
      authorized,
      authRequired,
      status: health.status,
      url: bridgeUrl,
      consoleUrl: `${bridgeUrl}/console`,
      tokenConfigured: Boolean(bridgeToken),
      tokenHeader: bridgeTokenHeader,
      userId: routeUserId,
      sessionCount: Number(health.json?.sessionCount || sessions.length || 0),
      visibleSessionCount: sessions.length,
      pageSessionCount: Number(health.json?.pageSessionCount ?? pageSessions.length),
      controllerCount: Number(health.json?.controllerCount ?? controllerSessions.length),
      activeSessionId,
      browserControllerSessionId,
      activeSession: sessions.find((session) => session.browserSessionId === activeSessionId) || null,
      extensionConnected,
      pageConnected: pageSessions.length > 0,
      compatibility,
      raw: health.json,
    }
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      authorized: false,
      authRequired: Boolean(bridgeToken),
      url: bridgeUrl,
      consoleUrl: `${bridgeUrl}/console`,
      tokenConfigured: Boolean(bridgeToken),
      tokenHeader: bridgeTokenHeader,
      userId: routeUserId,
      error: error.message,
      sessionCount: 0,
      visibleSessionCount: 0,
      pageSessionCount: 0,
      controllerCount: 0,
      activeSessionId: null,
      browserControllerSessionId: null,
      activeSession: null,
      extensionConnected: false,
      pageConnected: false,
      compatibility: {
        ok: false,
        runtimeVersion: packageVersion,
        runningRuntimeVersion: null,
        runtimeCompatible: false,
        expectedExtensionVersion,
        expectedProtocolVersion,
        extensionVersions: [],
        protocolVersions: [],
        bridge: null,
      },
    }
  }
}

function checkFile(path) {
  return {
    ok: existsSync(path),
    path,
  }
}

function buildNextSteps(checks) {
  const steps = []
  if (!checks.node.ok) {
    steps.push("Install Node.js 22 or newer, then rerun npm run doctor.")
  }
  if (!checks.bridge.reachable) {
    steps.push("Start the local bridge with npm run bridge.")
  }
  if (checks.bridge.reachable && checks.bridge.authRequired && !checks.bridge.authorized) {
    steps.push("Set YUNTI_BROWSER_BRIDGE_TOKEN to the token used by the running bridge.")
    steps.push("Save the same token in the extension popup.")
  }
  if (
    checks.bridge.reachable &&
    checks.bridge.authorized &&
    checks.bridge.extensionConnected &&
    !checks.bridge.compatibility?.ok
  ) {
    if (!checks.bridge.compatibility.runtimeCompatible) {
      steps.push(
        `Restart the Yunti MCP/bridge process: running bridge is ${checks.bridge.compatibility.runningRuntimeVersion || "unknown"}, but this package is ${checks.bridge.compatibility.runtimeVersion}.`
      )
    }
    const actualVersions = checks.bridge.compatibility.extensionVersions.join(", ") || "unknown"
    if (
      actualVersions !== checks.bridge.compatibility.expectedExtensionVersion ||
      !checks.bridge.compatibility.protocolVersions.includes(
        checks.bridge.compatibility.expectedProtocolVersion
      )
    ) {
      steps.push(
        `Reload the unpacked Yunti extension: browser is running ${actualVersions}, but this runtime requires ${checks.bridge.compatibility.expectedExtensionVersion} with protocol ${checks.bridge.compatibility.expectedProtocolVersion}.`
      )
    }
    steps.push("Do not retry browser tools until doctor reports matching bridge, extension, and protocol versions.")
  }
  if (checks.bridge.ok && !checks.bridge.extensionConnected) {
    steps.push("Load or reload the extension; the background controller should connect before any page session appears.")
    steps.push(`Open the optional local console for live status: ${checks.bridge.consoleUrl}.`)
  }
  if (checks.bridge.ok && checks.bridge.extensionConnected && !checks.bridge.pageConnected) {
    steps.push("Extension controller is online. Call yunti_list_browser_targets, then pass the intended tabId/targetId to the page tool for automatic page registration.")
    steps.push("Refresh the page only if Chrome explicitly blocks content-script injection.")
  }
  if (!checks.mcpServer.ok) {
    steps.push(`Restore the MCP server file at ${checks.mcpServer.path}.`)
  }
  if (!checks.skill.ok) {
    steps.push(`Restore the agent skill at ${checks.skill.path}.`)
  }
  if (checks.skill.mismatches) {
    steps.push("Installed agent skills differ from this package. Compare checks.skill.installations and run install-skill for each intended harness after updating the runtime and extension together.")
  }
  return steps
}

function humanSummary(report) {
  const lines = [
    `Yunti Browser Runtime doctor: ${report.ok ? "OK" : "needs attention"}`,
    `- Node: ${report.checks.node.version} (${report.checks.node.ok ? "ok" : "requires >=22"})`,
    `- Bridge: ${report.checks.bridge.reachable ? report.checks.bridge.url : "not reachable"}`,
    `- Console: ${report.checks.bridge.reachable ? report.checks.bridge.consoleUrl : "not available until bridge starts"}`,
    `- Token: ${report.checks.bridge.authRequired ? report.checks.bridge.authorized ? "valid" : "missing or invalid" : "not required for local loopback"}`,
    `- Sessions: ${report.checks.bridge.visibleSessionCount} visible (${report.checks.bridge.pageSessionCount} page, ${report.checks.bridge.controllerCount} controller), active page ${report.checks.bridge.activeSessionId || "none"}`,
    `- Extension: ${report.checks.bridge.extensionConnected ? "connected" : "not detected"}${report.checks.bridge.browserControllerSessionId ? `, controller ${report.checks.bridge.browserControllerSessionId}` : ""}`,
    `- Compatibility: ${report.checks.bridge.compatibility?.ok ? "ok" : "mismatch"} (runtime ${packageVersion}, expected extension ${expectedExtensionVersion}, protocol ${expectedProtocolVersion})`,
    `- MCP server: ${report.checks.mcpServer.ok ? "found" : "missing"}`,
    `- Skill: ${report.checks.skill.ok ? "found" : "missing"}, sha256=${report.checks.skill.sha256 || "unavailable"}, differing copies=${report.checks.skill.mismatches}`,
  ]
  if (report.nextSteps.length) {
    lines.push("Next steps:")
    for (const step of report.nextSteps) lines.push(`- ${step}`)
  }
  return lines.join("\n")
}

const checks = {
  node: nodeVersionStatus(),
  bridge: await checkBridge(),
  mcpServer: checkFile(mcpServerPath),
  skill: {
    ...checkFile(skillPath), runtimeVersion: packageVersion,
    ...inspectSkillCopies(skillPath, [
      ...[".agents", ".codex", ".claude", ".cursor", ".cline", ".dsh"].map(harness => join(homedir(), harness, "skills", "yunti-browser-runtime", "SKILL.md")),
      join(process.env.HERMES_HOME || join(homedir(), ".hermes"), "skills", "yunti-browser-runtime", "SKILL.md"),
    ]),
  },
}
const nextSteps = buildNextSteps(checks)
const report = {
  ok: checks.node.ok && checks.bridge.ok && checks.mcpServer.ok && checks.skill.ok,
  checkedAt: new Date().toISOString(),
  checks,
  nextSteps,
}

console.log(JSON.stringify(report, null, 2))
console.error(humanSummary(report))
if (!report.ok) process.exitCode = 1
