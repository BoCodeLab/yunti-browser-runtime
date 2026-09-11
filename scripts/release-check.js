#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"

function portablePath(value) {
  return String(value || "").replace(/\\/g, "/")
}

function spawnNpm(args, options) {
  if (process.env.npm_execpath) {
    return spawnSync(process.execPath, [process.env.npm_execpath, ...args], options)
  }
  return spawnSync(npmCommand, args, { ...options, shell: process.platform === "win32" })
}
const residueTerms = ["/Users", "Codeg", "xyy", "ybm100"]
const residueRoots = ["README.md", "docs", "skills", "package.json"]
const requiredExtensionZipFiles = [
  "background.js",
  "cdp.js",
  "content.css",
  "dom-observer.js",
  "content.js",
  "network-monitor.js",
  "manifest.json",
  "popup.css",
  "popup.html",
  "popup.js",
  "session-manager.js",
  "settings.js",
  "tool-handlers.js",
]

function readJsonFile(path) {
  return JSON.parse(readFileSync(join(rootDir, path), "utf8"))
}

function listFiles(path) {
  const absolutePath = join(rootDir, path)
  const stats = statSync(absolutePath)
  if (stats.isFile()) return [absolutePath]
  if (!stats.isDirectory()) return []
  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const childPath = join(path, entry.name)
    if (entry.isDirectory()) return listFiles(childPath)
    if (entry.isFile()) return [join(rootDir, childPath)]
    return []
  })
}

function checkPublicDocResidue() {
  const matches = []
  for (const file of residueRoots.flatMap(listFiles)) {
    const text = readFileSync(file, "utf8")
    for (const term of residueTerms) {
      if (text.includes(term)) {
        matches.push({
          file: file.slice(rootDir.length + 1),
          term,
        })
      }
    }
  }
  if (matches.length) {
    console.error("Public documentation residue check failed:")
    for (const match of matches) console.error(`- ${match.file}: ${match.term}`)
    return false
  }
  console.error("Public documentation residue check passed.")
  return true
}

function stripMarkdownCodeFences(text) {
  return text.replace(/```[\s\S]*?```/g, "")
}

function checkMarkdownLinks() {
  const files = residueRoots
    .flatMap(listFiles)
    .filter((file) => file.endsWith(".md"))
  const broken = []
  const linkPattern = /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

  for (const file of files) {
    const text = stripMarkdownCodeFences(readFileSync(file, "utf8"))
    for (const match of text.matchAll(linkPattern)) {
      const rawTarget = String(match[1] || "").trim()
      if (
        !rawTarget ||
        rawTarget.startsWith("#") ||
        /^[a-z][a-z0-9+.-]*:/i.test(rawTarget) ||
        rawTarget.startsWith("mailto:")
      ) {
        continue
      }

      const [targetPath, anchor] = rawTarget.split("#")
      if (!targetPath) continue
      const absoluteTarget = resolve(dirname(file), decodeURIComponent(targetPath))
      if (!existsSync(absoluteTarget)) {
        broken.push({
          file: file.slice(rootDir.length + 1),
          target: rawTarget,
          reason: "target file missing",
        })
        continue
      }
      if (anchor && !statSync(absoluteTarget).isFile()) {
        broken.push({
          file: file.slice(rootDir.length + 1),
          target: rawTarget,
          reason: "anchor target is not a file",
        })
      }
    }
  }

  if (broken.length) {
    console.error("Public Markdown link check failed:")
    for (const item of broken) {
      console.error(`- ${item.file}: ${item.target} (${item.reason})`)
    }
    return false
  }

  console.error(`Public Markdown link check passed (${files.length} files).`)
  return true
}

function checkVersionConsistency() {
  const packageJson = readJsonFile("package.json")
  const manifestJson = readJsonFile("extension/manifest.json")
  const packageVersion = String(packageJson.version || "").trim()
  const manifestVersion = String(manifestJson.version || "").trim()

  if (!packageVersion || !manifestVersion || packageVersion !== manifestVersion) {
    console.error("Version consistency check failed:")
    console.error(`- package.json version: ${packageVersion || "(missing)"}`)
    console.error(`- extension/manifest.json version: ${manifestVersion || "(missing)"}`)
    return false
  }

  console.error(`Version consistency check passed (${packageVersion}).`)
  return true
}

function checkEdgeRecoveryGuidance() {
  const requirements = [
    {
      path: "README.md",
      snippets: [
        "Edge 睡眠标签页",
        "不应默认要求用户刷新",
        "不要遗漏 packaged skill 的安装或接入",
      ],
    },
    {
      path: "skills/yunti-browser-runtime/SKILL.md",
      snippets: ["Edge sleeping tabs", "Do not ask the user to switch"],
    },
    {
      path: "docs/INSTALL.md",
      snippets: ["Edge sleeping tabs", "A timed-out page operation does not disconnect"],
    },
    {
      path: "docs/TOOL_GUIDE.md",
      snippets: ["Microsoft Edge sleeping tabs", "One page timeout does not imply"],
    },
    {
      path: "docs/AGENT_WORKFLOW_CONTRACT.md",
      snippets: ["Edge sleeping tab", "Extension-side timeout"],
    },
    {
      path: "mcp/tools.js",
      snippets: ["Edge sleeping tabs use bounded automatic recovery", "A page-operation timeout does not imply"],
    },
  ]
  const missing = []
  for (const requirement of requirements) {
    const text = readFileSync(join(rootDir, requirement.path), "utf8")
    for (const snippet of requirement.snippets) {
      if (!text.includes(snippet)) missing.push(`${requirement.path}: ${snippet}`)
    }
  }
  if (missing.length) {
    console.error("Edge recovery guidance check failed:")
    for (const item of missing) console.error(`- missing ${item}`)
    return false
  }
  console.error(`Edge recovery guidance check passed (${requirements.length} files).`)
  return true
}

function checkCliSmoke() {
  const packageJson = readJsonFile("package.json")
  const binPath = packageJson.bin?.["yunti-browser-runtime"]
  if (binPath !== "bin/yunti-browser-runtime.js") {
    console.error("CLI smoke check failed:")
    console.error(`- package.json bin yunti-browser-runtime: ${binPath || "(missing)"}`)
    return false
  }

  const help = spawnSync(process.execPath, ["bin/yunti-browser-runtime.js", "--help"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  })
  if (
    help.status !== 0 ||
    !help.stdout.includes("Yunti Browser Runtime") ||
    !help.stdout.includes("package-extension")
  ) {
    console.error("CLI smoke check failed:")
    console.error(`- --help exit code: ${help.status}`)
    console.error(`- --help stdout: ${help.stdout.trim() || "(empty)"}`)
    console.error(`- --help stderr: ${help.stderr.trim() || "(empty)"}`)
    return false
  }

  const version = spawnSync(process.execPath, ["bin/yunti-browser-runtime.js", "--version"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  })
  const expectedVersion = String(packageJson.version || "").trim()
  const actualVersion = version.stdout.trim()
  if (version.status !== 0 || actualVersion !== expectedVersion) {
    console.error("CLI smoke check failed:")
    console.error(`- --version exit code: ${version.status}`)
    console.error(`- expected version: ${expectedVersion || "(missing)"}`)
    console.error(`- actual version: ${actualVersion || "(empty)"}`)
    console.error(`- --version stderr: ${version.stderr.trim() || "(empty)"}`)
    return false
  }

  console.error(`CLI smoke check passed (${actualVersion}).`)
  return true
}

function checkPrintConfigSmoke() {
  const agents = ["codex", "claude-code", "cursor", "cline"]
  for (const agent of agents) {
    const result = spawnSync(
      process.execPath,
      ["scripts/print-config.js", "--agent", agent, "--json"],
      {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      }
    )
    if (result.status !== 0) {
      console.error("print-config smoke check failed:")
      console.error(`- agent: ${agent}`)
      console.error(`- exit code: ${result.status}`)
      console.error(`- stderr: ${result.stderr.trim() || "(empty)"}`)
      return false
    }

    let payload
    try {
      payload = JSON.parse(result.stdout || "{}")
    } catch (error) {
      console.error("print-config smoke check failed:")
      console.error(`- agent: ${agent}`)
      console.error(`- JSON parse error: ${error.message}`)
      return false
    }

    const server =
      payload?.config?.mcpServers?.["yunti-browser-runtime"]
    const env = server?.env || {}
    if (
      payload?.ok !== true ||
      payload?.agent !== agent ||
      server?.command !== "node" ||
      !Array.isArray(server?.args) ||
      !portablePath(server.args[0]).endsWith("mcp/server.js") ||
      env.YUNTI_BROWSER_BRIDGE_PORT !== "48887" ||
      payload?.bridge?.tokenEnv !== "YUNTI_BROWSER_BRIDGE_TOKEN" ||
      !portablePath(payload?.skill?.sourcePath).endsWith("skills/yunti-browser-runtime") ||
      (agent === "codex" &&
        (!String(payload?.skill?.installCommand || "").includes("~/.codex/skills") ||
          !String(payload?.skill?.installCommand || "").includes(payload.skill.sourcePath)))
    ) {
      console.error("print-config smoke check failed:")
      console.error(`- agent: ${agent}`)
      console.error(`- unexpected payload: ${JSON.stringify(payload, null, 2)}`)
      return false
    }
  }

  const human = spawnSync(
    process.execPath,
    ["scripts/print-config.js", "--agent", "codex", "--human"],
    {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    }
  )
  if (
    human.status !== 0 ||
    !human.stdout.includes("Yunti Browser Runtime MCP config for codex") ||
    !human.stdout.includes("YUNTI_BROWSER_BRIDGE_TOKEN") ||
    !human.stdout.includes("Skill source:") ||
    !human.stdout.includes("Skill install:") ||
    !human.stdout.includes("~/.codex/skills") ||
    !portablePath(human.stdout).includes("skills/yunti-browser-runtime")
  ) {
    console.error("print-config smoke check failed:")
    console.error(`- human exit code: ${human.status}`)
    console.error(`- human stdout: ${human.stdout.trim() || "(empty)"}`)
    console.error(`- human stderr: ${human.stderr.trim() || "(empty)"}`)
    return false
  }

  console.error(`print-config smoke check passed (${agents.length} agents).`)
  return true
}

function checkDoctorSmoke() {
  const result = spawnSync(process.execPath, ["scripts/doctor.js"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  })

  let payload
  try {
    payload = JSON.parse(result.stdout || "{}")
  } catch (error) {
    console.error("doctor smoke check failed:")
    console.error(`- JSON parse error: ${error.message}`)
    console.error(`- stdout: ${result.stdout.trim() || "(empty)"}`)
    console.error(`- stderr: ${result.stderr.trim() || "(empty)"}`)
    return false
  }

  const checks = payload?.checks || {}
  if (
    !payload?.checkedAt ||
    checks.node?.ok !== true ||
    checks.node?.required !== ">=22" ||
    checks.mcpServer?.ok !== true ||
    !portablePath(checks.mcpServer?.path).endsWith("mcp/server.js") ||
    checks.skill?.ok !== true ||
    !portablePath(checks.skill?.path).endsWith("skills/yunti-browser-runtime/SKILL.md") ||
    typeof checks.bridge?.reachable !== "boolean" ||
    checks.bridge?.tokenHeader !== "x-yunti-browser-token" ||
    !Array.isArray(payload?.nextSteps)
  ) {
    console.error("doctor smoke check failed:")
    console.error(`- unexpected payload: ${JSON.stringify(payload, null, 2)}`)
    return false
  }

  console.error(
    `doctor smoke check passed (bridge ${checks.bridge.reachable ? "reachable" : "not reachable"}).`
  )
  return true
}

function run(command, args) {
  console.error(`\n$ ${[command, ...args].join(" ")}`)
  const options = {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  }
  const result = command === "npm" ? spawnNpm(args, options) : spawnSync(command, args, options)
  if (result.error) console.error(result.error.message)
  return result.status === 0
}

function checkPackageContents() {
  const requiredFiles = [
    "README.md",
    "LICENSE",
    "package.json",
    "bin/yunti-browser-runtime.js",
    "mcp/server.js",
    "mcp/http-server.js",
    "mcp/bridge-hub.js",
    "mcp/tools.js",
    "extension/manifest.json",
    "extension/background.js",
    "extension/content.js",
    "extension/dom-observer.js",
    "extension/cdp.js",
    "extension/session-manager.js",
    "extension/tool-handlers.js",
    "skills/yunti-browser-runtime/SKILL.md",
    "docs/INSTALL.md",
    "docs/RELEASE.md",
    "docs/PUBLISHING_BLOCKERS.md",
    "scripts/check-package-metadata.js",
    "scripts/check-published-package.js",
    "scripts/release-check.js",
  ]

  console.error("\n$ npm pack --json --dry-run")
  const result = spawnNpm(["pack", "--json", "--dry-run"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: process.env,
  })
  if (result.status !== 0) return false

  let payload
  try {
    payload = JSON.parse(result.stdout || "[]")
  } catch (error) {
    console.error(`npm pack JSON parse failed: ${error.message}`)
    return false
  }

  const pack = Array.isArray(payload) ? payload[0] : payload?.[readJsonFile("package.json").name]
  const packedFiles = new Set(
    Array.isArray(pack?.files) ? pack.files.map((file) => file.path) : []
  )
  const missing = requiredFiles.filter((file) => !packedFiles.has(file))
  if (missing.length) {
    console.error("Required npm package contents check failed:")
    for (const file of missing) console.error(`- missing ${file}`)
    return false
  }

  console.error(
    `Required npm package contents check passed (${packedFiles.size} files).`
  )
  return true
}

function listZipEntries(zipPath) {
  const data = readFileSync(zipPath)
  let eocdOffset = -1
  for (let i = data.length - 22; i >= 0; i -= 1) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset < 0) {
    throw new Error(`ZIP end of central directory not found: ${zipPath}`)
  }

  const entryCount = data.readUInt16LE(eocdOffset + 10)
  const centralDirectoryOffset = data.readUInt32LE(eocdOffset + 16)
  const entries = []
  let offset = centralDirectoryOffset

  for (let i = 0; i < entryCount; i += 1) {
    if (data.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central directory entry at offset ${offset}`)
    }
    const nameLength = data.readUInt16LE(offset + 28)
    const extraLength = data.readUInt16LE(offset + 30)
    const commentLength = data.readUInt16LE(offset + 32)
    const name = data
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8")
    if (name && !name.endsWith("/")) entries.push(name)
    offset += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

function checkExtensionZipContents() {
  console.error("\n$ node scripts/package-extension.js")
  const result = spawnSync("node", ["scripts/package-extension.js"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: process.env,
  })
  if (result.status !== 0) return false

  let payload
  try {
    payload = JSON.parse(result.stdout || "{}")
  } catch (error) {
    console.error(`extension package JSON parse failed: ${error.message}`)
    return false
  }

  const zipPath = payload?.zipPath
  if (!zipPath || !statSync(zipPath, { throwIfNoEntry: false })?.isFile()) {
    console.error(`extension zip was not created: ${zipPath || "(missing zipPath)"}`)
    return false
  }

  let entries
  try {
    entries = listZipEntries(zipPath)
  } catch (error) {
    console.error(error.message)
    return false
  }

  const expected = new Set(requiredExtensionZipFiles)
  const actual = new Set(entries)
  const missing = requiredExtensionZipFiles.filter((file) => !actual.has(file))
  const unexpected = entries.filter((file) => !expected.has(file))

  if (missing.length || unexpected.length) {
    console.error("Extension zip contents check failed:")
    for (const file of missing) console.error(`- missing ${file}`)
    for (const file of unexpected) console.error(`- unexpected ${file}`)
    return false
  }

  console.error(
    `Extension zip contents check passed (${entries.length} files).`
  )
  return true
}

let ok = checkPublicDocResidue()
ok = checkMarkdownLinks() && ok
ok = checkVersionConsistency() && ok
ok = checkEdgeRecoveryGuidance() && ok
ok = checkCliSmoke() && ok
ok = checkPrintConfigSmoke() && ok
ok = checkDoctorSmoke() && ok
ok = run("npm", ["run", "check:action-results"]) && ok
ok = run("npm", ["run", "check"]) && ok
ok = run("npm", ["test"]) && ok
ok = checkPackageContents() && ok
ok = checkExtensionZipContents() && ok

if (!ok) process.exitCode = 1
