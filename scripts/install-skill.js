#!/usr/bin/env node
// Install the packaged SKILL.md into a supported agent harness, so the agent
// discovers Yunti's browser workflow without the user copying directories by
// hand. Mirrors what print-config prints, but performs the copy instead of
// asking the user to run it.
import { access, cp, mkdir, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const skillSource = join(rootDir, "skills", "yunti-browser-runtime")
const skillName = "yunti-browser-runtime"

// Each harness reads skills from a directory under the user's home. Only the
// path convention is assumed; --dest overrides it for anything else.
const harnessDirs = {
  codex: [".codex", "skills"],
  "claude-code": [".claude", "skills"],
  cursor: [".cursor", "skills"],
  cline: [".cline", "skills"],
  dsh: [".dsh", "skills"],
}

function parseArgs(argv) {
  const result = { harness: "", dest: "", dryRun: false, json: false, force: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const takeNext = () => {
      i += 1
      return argv[i] || ""
    }
    if (arg === "--harness") result.harness = takeNext()
    else if (arg.startsWith("--harness=")) result.harness = arg.slice("--harness=".length)
    else if (arg === "--dest") result.dest = takeNext()
    else if (arg.startsWith("--dest=")) result.dest = arg.slice("--dest=".length)
    else if (arg === "--dry-run") result.dryRun = true
    else if (arg === "--json") result.json = true
    else if (arg === "--force") result.force = true
    else if (arg === "--help" || arg === "-h") result.help = true
  }
  result.harness = String(result.harness || "").trim().toLowerCase()
  return result
}

function helpText() {
  return [
    "Yunti skill installer",
    "",
    "Usage:",
    "  npm run install-skill -- --harness <name>",
    "  node scripts/install-skill.js --harness codex",
    "",
    "Options:",
    "  --harness <name>  target agent harness: " + Object.keys(harnessDirs).join(", "),
    "  --dest <dir>      install into an explicit directory (overrides --harness)",
    "  --dry-run         report what would happen without writing anything",
    "  --force           replace an existing installation",
    "  --json            machine-readable output",
    "",
    "Examples:",
    "  npm run install-skill -- --harness codex",
    "  npm run install-skill -- --harness dsh --json",
    "  npm run install-skill -- --dest ~/my-agent/skills",
  ].join("\n")
}

function expandHome(value) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  if (raw === "~") return homedir()
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return join(homedir(), raw.slice(2))
  return resolve(raw)
}

function targetDirFor(args) {
  if (args.dest) return join(expandHome(args.dest), skillName)
  const segments = harnessDirs[args.harness]
  if (!segments) return ""
  return join(homedir(), ...segments, skillName)
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(helpText())
    return 0
  }
  if (!args.harness && !args.dest) {
    console.error("Missing --harness (or --dest). Supported harnesses: " + Object.keys(harnessDirs).join(", "))
    console.error("")
    console.error(helpText())
    return 1
  }
  if (args.harness && !args.dest && !harnessDirs[args.harness]) {
    console.error(`Unsupported harness "${args.harness}". Supported: ${Object.keys(harnessDirs).join(", ")}`)
    return 1
  }

  const sourceReady = await exists(join(skillSource, "SKILL.md"))
  if (!sourceReady) {
    console.error(`Packaged skill not found at ${skillSource}`)
    return 1
  }

  const destDir = targetDirFor(args)
  const alreadyInstalled = await exists(destDir)
  const report = {
    ok: true,
    harness: args.harness || "(custom --dest)",
    sourcePath: skillSource,
    destPath: destDir,
    dryRun: args.dryRun,
    replaced: alreadyInstalled && (args.force || args.dryRun),
    action: "installed",
  }

  if (alreadyInstalled && !args.force && !args.dryRun) {
    report.ok = false
    report.action = "already-installed"
    report.nextSteps = [
      `${destDir} already exists. Re-run with --force to replace it.`,
    ]
    if (args.json) console.log(JSON.stringify(report, null, 2))
    else {
      console.error(`Already installed: ${destDir}`)
      console.error("Re-run with --force to replace it.")
    }
    return 1
  }

  if (args.dryRun) {
    report.nextSteps = ["Re-run without --dry-run to perform the copy."]
  } else {
    await mkdir(dirname(destDir), { recursive: true })
    if (alreadyInstalled) await rm(destDir, { recursive: true, force: true })
    await cp(skillSource, destDir, { recursive: true })
    report.nextSteps = [
      "Start a new agent session so the harness discovers the skill.",
    ]
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
    return 0
  }

  console.log(`Yunti skill ${args.dryRun ? "would be installed" : "installed"} for ${report.harness}`)
  console.log(`  source: ${report.sourcePath}`)
  console.log(`  target: ${report.destPath}`)
  if (report.replaced) console.log("  note:   replaced an existing installation")
  console.log("")
  for (const step of report.nextSteps) console.log(`Next: ${step}`)
  return 0
}

process.exitCode = await main()
