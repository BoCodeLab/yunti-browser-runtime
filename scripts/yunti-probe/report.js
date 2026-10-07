#!/usr/bin/env node
// Render the probe JSON report into a Markdown delivery report.
// Usage: node scripts/yunti-probe/report.js [--in=.probe-out-full/probe-report.json] [--out=docs/PROBE_REPORT.md]
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..")

const args = { in: join(ROOT, ".probe-out-full", "probe-report.json"), out: join(ROOT, ".probe-out-full", "PROBE_REPORT.md") }
for (const raw of process.argv.slice(2)) {
  const [key, value = ""] = raw.replace(/^--/, "").split("=")
  if (key === "in") args.in = resolve(ROOT, value)
  else if (key === "out") args.out = resolve(ROOT, value)
}

const report = JSON.parse(await readFile(args.in, "utf8"))
const lines = []
const p = (text = "") => lines.push(text)
const fmt = (value) => (value == null ? "-" : String(value))

function latencyRow(name, stats) {
  if (!stats || !stats.count) return `| \`${name}\` | - | - | - | - | - |`
  return `| \`${name}\` | ${stats.count} | ${stats.min} | ${stats.p50} | ${stats.p95} | ${stats.max} |`
}

p("# 云梯 Browser Runtime 实测报告（MCP 工具并发与响应时间）")
p()
p(`- 生成时间：${new Date().toISOString()}`)
p(`- 被测运行时：yunti-browser-runtime ${report.init?.serverInfo?.version ?? "?"}（MCP stdio → 本地 Bridge → 扩展 controller → Content Script/CDP）`)
p(`- MCP 客户端：真实 stdio JSON-RPC（\`initialize\` / \`tools/list\` / \`tools/call\`），非模拟`)
p(`- Bridge：${report.bridge?.health ? `v${report.bridge.health.version}，extensionConnected=${report.bridge.health.extensionConnected}，controllerCount=${report.bridge.health.controllerCount}，pageSessionCount=${report.bridge.health.pageSessionCount}` : "不可达"}`)
p(`- Bridge 进程模式：${report.client?.bridgeMode || "unknown"}（proxy = 复用已存在的 Bridge 进程）`)
p(`- 被测浏览器：用户本机 Chrome（扩展 v0.2.7）；不修改用户数据，测试页为本仓库 fixture 静态页`)
p(`- 探针：\`scripts/yunti-probe/probe.js\`；原始数据：\`${args.in.replace(ROOT, ".")}\``)
p()

p("## 1. 工具覆盖（52/52）")
p()
const inv = report.toolInventory || {}
p(`声明工具数：**${fmt(inv.declared)}**；本轮实际调用：**${fmt(inv.invoked)}**；未调用：${(inv.missing || []).length ? inv.missing.map((n) => `\`${n}\``).join(", ") : "无"}`)
p()
const checks = report.smoke_checks || []
p("功能断言：")
p()
for (const check of checks) p(`- ${check.passed ? "✅" : "❌"} ${check.name}`)
p()

p("### 1.1 逐工具功能结果")
p()
p("| 工具 | 传输成功 | 语义成功 | 耗时(ms) | 诊断 code |")
p("| --- | --- | --- | --- | --- |")
for (const row of report.smoke || []) {
  p(`| \`${row.tool}\` | ${row.transportOk ? "✅" : "❌"} | ${row.ok ? "✅" : "❌"} | ${fmt(row.latencyMs)} | ${row.code ? `\`${row.code}\`` : "-"} |`)
}
p()
p("> 说明：`语义成功` 表示结果未被结构化诊断字段（如 `UID_NOT_FOUND`、`WAIT_TIMEOUT`）标记为失败。")
p()

p("### 1.2 关键结构校验")
p()
const shape = report.elementShape
if (shape) {
  p(`- \`yunti_observe_page\` 返回 observationId：\`${fmt(shape.observationId)}\`，元素数 ${shape.elementCount}，scrollableContainers ${shape.scrollableContainerCount}`)
  p(`- 元素字段：${(shape.keys || []).map((k) => `\`${k}\``).join(", ")}`)
  p(`- uid 形态示例：\`${shape.sample?.[0]?.uid || "-"}\`（含 observation 作用域前缀）`)
}
const dialog = report.dialogProbe
if (dialog && !dialog.skipped) {
  p(`- 模态对话框探针：click 结果 = ${dialog.clickOutcome?.settled ?? "-"}（${fmt(dialog.clickOutcome?.elapsedMs)}ms）`)
  for (const step of dialog.steps || []) {
    p(`  - ${step.step}: ${JSON.stringify(step).slice(0, 240)}`)
  }
}
const confirm2 = report.confirmationProbe
if (confirm2 && !confirm2.skipped) {
  p(`- \`yunti_request_user_confirmation\`：settled=${confirm2.settled}，approved=${confirm2.value?.approved}，耗时 ${fmt(confirm2.elapsedMs)}ms`)
}
const visible = report.visibleTabProbe
if (visible) {
  p(`- \`yunti_capture_visible_tab\`：captured=${visible.captured}，payload 字段 ${(visible.payloadKeys || []).join("/")}，返回图像数据长度 ${fmt(visible.bytes)}，耗时 ${fmt(visible.latencyMs)}ms`)
}
p()

p("## 2. 响应时间（并发=1，逐次串行）")
p()
p("| 工具 | 样本 | min | p50 | p95 | max |")
p("| --- | --- | --- | --- | --- | --- |")
const latency = report.latency || {}
const ordered = Object.entries(latency).sort((a, b) => (b[1].p95 || 0) - (a[1].p95 || 0))
for (const [name, stats] of ordered) p(latencyRow(name, stats))
p()
const allP95 = ordered.map(([, s]) => s.p95).filter((n) => typeof n === "number")
if (allP95.length) {
  p(`- 本机 p95 最高：\`${ordered[0][0]}\` = ${ordered[0][1].p95}ms`)
  p(`- 所有被测工具 p95 中最慢项见上表；对比项目自带门禁（soak：p95 ≤ 500ms，max ≤ 10s）`)
}
const slowestFailures = ordered.filter(([, s]) => (s.failures || []).length)
if (slowestFailures.length) {
  p()
  p("失败样本：")
  for (const [name, stats] of slowestFailures) p(`- \`${name}\`：${stats.failures.length}/${stats.count} 次失败 ${JSON.stringify(stats.failures.slice(0, 3))}`)
}
p()

p("## 3. 并发行为")
p()
const conc = report.concurrency || {}
for (const [scenario, data] of Object.entries(conc)) {
  p(`### ${scenario}`)
  p()
  p(`${data.describe || ""}`)
  p()
  if (data.levels) {
    p("| 并发 | 调用数 | 总墙钟(ms) | 吞吐(次/秒) | p50(ms) | p95(ms) | max(ms) | 墙钟/p50 | 失败 |")
    p("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for (const [level, row] of Object.entries(data.levels)) {
      p(`| ${level} | ${row.calls} | ${row.wallMs} | ${row.throughputPerSec} | ${row.latency?.p50 ?? "-"} | ${row.latency?.p95 ?? "-"} | ${row.latency?.max ?? "-"} | ${row.serializationRatio ?? row.observedOverIdealParallel ?? "-"}× | ${row.failureCount} |`)
    }
    p()
    if (Object.values(data.levels).some((row) => row.failureCount)) {
      for (const [level, row] of Object.entries(data.levels)) {
        if (row.failureCount) p(`- 并发 ${level} 失败样本：${JSON.stringify(row.failures)}`)
      }
      p()
    }
    const notes = Object.entries(data.levels).filter(([, row]) => row.expectedSerialWallMs)
    for (const [level, row] of notes) {
      p(`- \`${level}\`：完全并行的理想墙钟 ${row.latency ? row.latency.p50 : "-"}ms 量级，完全串行的墙钟约 ${row.expectedSerialWallMs}ms；实测 ${row.wallMs}ms`)
    }
    if (notes.length) p()
  } else {
    p(`| 指标 | 值 |`)
    p(`| --- | --- |`)
    for (const key of ["calls", "wallMs", "throughputPerSec", "failureCount"]) {
      if (data[key] != null) p(`| ${key} | ${data[key]} |`)
    }
    if (data.latency) p(`| latency | min ${data.latency.min} / p50 ${data.latency.p50} / p95 ${data.latency.p95} / max ${data.latency.max} |`)
    if (data.firstFive) p(`| 前 5 次(ms) | ${data.firstFive.join(", ")} |`)
    if (data.lastFive) p(`| 后 5 次(ms) | ${data.lastFive.join(", ")} |`)
    p()
  }
}
const raw = report.rawBridge || {}
if (raw.sequentialSnapshot) {
  p("### Bridge 直连对照（绕过 MCP stdio）")
  p()
  p(`- 串行 10 次 \`yunti_get_page_snapshot\`：p50 ${raw.sequentialSnapshot.p50}ms / p95 ${raw.sequentialSnapshot.p95}ms / max ${raw.sequentialSnapshot.max}ms`)
  if (raw.parallel8Snapshot) {
    p(`- 并发 8 次：总墙钟 ${raw.parallel8Snapshot.wallMs}ms，p50 ${raw.parallel8Snapshot.latency?.p50}ms / max ${raw.parallel8Snapshot.latency?.max}ms，失败 ${raw.parallel8Snapshot.failureCount}`)
  }
  p()
}

p("## 4. 探针自动判定")
p()
const findings = report.findings || []
if (!findings.length) p("（本轮探针未触发自动判定项）")
for (const item of findings) {
  p(`- **[${item.severity}] ${item.area}** — ${item.detail}`)
  if (item.evidence) p(`  - 证据：\`${String(item.evidence).slice(0, 500)}\``)
}
p()

const focused = report.focused
if (focused && !focused.error) {
  p("### 4.1 定点复现（每例独立标签页 + 有界超时）")
  p()
  for (const key of ["dialogDeadlock", "screenshotAfterTrace", "drag", "consoleCapture"]) {
    const probe = focused[key]
    if (!probe?.steps) continue
    p(`**${key}**（tab ${probe.tab?.tabId ?? "-"}）`)
    p()
    p("| 步骤 | 结果 | 耗时(ms) | code |")
    p("| --- | --- | --- | --- |")
    for (const step of probe.steps) {
      p(`| ${step.step} | ${step.outcome ?? (step.count != null ? `count=${step.count}` : "-")} | ${step.elapsedMs ?? "-"} | ${step.code ? `\`${step.code}\`` : "-"} |`)
    }
    p()
  }
}

const lane = (report.concurrency || {})["lane-experiment"]
if (lane) {
  p("### 4.2 确定性慢工具下的并发（判断是否真正并行）")
  p()
  p(lane.describe || "")
  p()
  p("| 场景 | 4 次调用墙钟(ms) | p50(ms) | 相对理想并行 |")
  p("| --- | --- | --- | --- |")
  for (const [name, row] of Object.entries(lane.levels || {})) {
    p(`| ${name} | ${row.wallMs} | ${row.latency?.p50 ?? "-"} | ${row.observedOverIdealParallel}× |`)
  }
  p()
}
const queueProbe = report.queueProbe
if (queueProbe) {
  p(`- 并发 6 个慢调用期间 Bridge 队列深度采样：maxPending=${queueProbe.maxPending}，maxQueued=${queueProbe.maxQueued}`)
  p()
}

await mkdir(dirname(args.out), { recursive: true })
await writeFile(args.out, lines.join("\n"), "utf8")
console.log(args.out)
