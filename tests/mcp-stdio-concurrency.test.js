import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..")

// MCP stdio client used to observe request/response ordering.
function startStdioServer() {
  const child = spawn(process.execPath, [join(ROOT, "mcp", "server.js")], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const pending = new Map()
  const order = []
  const stderr = []
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)))
  createInterface({ input: child.stdout }).on("line", (line) => {
    const text = line.trim()
    if (!text) return
    let message
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    if (message.id === undefined || message.id === null) return
    order.push(message.id)
    const waiter = pending.get(message.id)
    if (waiter) {
      pending.delete(message.id)
      waiter(message)
    }
  })
  return {
    child,
    order,
    stderr,
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    },
    sendRaw(line) {
      child.stdin.write(`${line}\n`)
    },
    waitFor(id, timeoutMs = 30_000) {
      return new Promise((resolvePromise) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          resolvePromise({ id, timedOut: true })
        }, timeoutMs)
        pending.set(id, (message) => {
          clearTimeout(timer)
          resolvePromise(message)
        })
      })
    },
    stop() {
      try {
        child.stdin.end()
        child.kill()
      } catch {
        // ignore
      }
    },
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test("stdio answers a fast request while a slow tool call is still in flight", async () => {
  const server = startStdioServer()
  try {
    await sleep(1500) // allow the bridge child to reach proxy/owner mode
    server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    const init = await server.waitFor(1)
    assert.equal(init.result?.serverInfo?.name?.length > 0, true)

    // id 2 hits the browser and needs the controller poll, so it stays in
    // flight for seconds. id 3 is served in-process and must not wait for it.
    server.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "yunti_wait_for",
        arguments: { browserSessionId: "yunti-page-1-concurrency-probe", selector: "#never", timeoutMs: 3000 },
      },
    })
    await sleep(50)
    const sentFastAt = Date.now()
    server.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "yunti_get_tool_usage_hints", arguments: {} },
    })

    const hints = await server.waitFor(3, 5_000)
    const fastLatencyMs = Date.now() - sentFastAt
    assert.equal(hints.timedOut, undefined, "fast in-process tool must not be blocked by an in-flight browser call")
    assert.equal(fastLatencyMs < 1_000, true, `in-process tool answered in ${fastLatencyMs}ms while a browser call was pending`)
    await server.waitFor(2, 30_000).catch(() => null)
  } finally {
    server.stop()
  }
})

test("stdio keeps answering after a parse error and still correlates ids", async () => {
  const server = startStdioServer()
  try {
    await sleep(1500)
    server.sendRaw("{not json")
    server.send({ jsonrpc: "2.0", id: 42, method: "tools/list", params: {} })
    const listed = await server.waitFor(42, 10_000)
    assert.equal(listed.timedOut, undefined)
    const tools = listed.result?.tools || []
    assert.equal(tools.length, 52)
    // Responses must carry the request id, including the one that raced the
    // parse error, so an MCP client can still correlate out-of-order replies.
    assert.equal(listed.id, 42)
    server.send({ jsonrpc: "2.0", id: "abc", method: "tools/list", params: {} })
    const second = await server.waitFor("abc", 10_000)
    assert.equal(second.id, "abc")
  } finally {
    server.stop()
  }
})

test("initialization and tool listing are advertised with the package version", async () => {
  const server = startStdioServer()
  try {
    await sleep(1500)
    server.send({ jsonrpc: "2.0", id: 7, method: "initialize", params: {} })
    const init = await server.waitFor(7, 10_000)
    assert.equal(init.result.protocolVersion, "2024-11-05")
    assert.match(init.result.serverInfo.version, /^\d+\.\d+\.\d+/)
    assert.equal(typeof init.result.capabilities.tools, "object")
    // stderr must announce the stdio concurrency ceiling for operator debugging
    assert.match(server.stderr.join(""), /stdio concurrency \d+/)
  } finally {
    server.stop()
  }
})
