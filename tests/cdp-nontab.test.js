import test from "node:test"
import assert from "node:assert/strict"
import { createCdpController } from "../extension/cdp.js"

// extension/cdp.js had no unit test at all before this file. The non-tab path
// is the reason it now has one: it was first declared impossible on the strength
// of a probe whose own filter dropped the target it was looking for, so the
// behaviour is pinned here rather than only in a real-browser test that `npm
// test` skips by default.

const WORKER_TARGET_ID = "B1A2C3D4E5F60718293A4B5C6D7E8F90"

function installFakeChrome({ targets = [], failAttachFor = () => "" } = {}) {
  const attached = []
  const detached = []
  const commands = []
  globalThis.chrome = {
    runtime: { lastError: null, id: "own-extension-id" },
    tabs: {
      get: async (tabId) => ({ id: tabId, windowId: 1, active: false, title: `tab ${tabId}`, url: `https://tab${tabId}.test/` }),
    },
    debugger: {
      // chrome.debugger.getTargets is callback-style, not promise-style.
      getTargets: (callback) => callback(targets),
      attach: (target, _version, callback) => {
        const failure = failAttachFor(target)
        if (failure) {
          chrome.runtime.lastError = { message: failure }
          callback?.()
          chrome.runtime.lastError = null
          return
        }
        attached.push(target)
        callback?.()
      },
      detach: (target, callback) => {
        detached.push(target)
        callback?.()
      },
      sendCommand: (target, method, params, callback) => {
        commands.push({ target, method, params })
        callback({ echoed: method, on: target.targetId ? "target" : "tab" })
      },
      onEvent: { addListener: () => {}, removeListener: () => {} },
      onDetach: { addListener: () => {} },
    },
  }
  return { attached, detached, commands }
}

function createController() {
  return createCdpController({
    sessionsByTab: new Map(),
    postBridge: async () => {},
    forwardConsoleEvent: () => {},
  })
}

const session = { browserSessionId: "yunti-page-1", tabId: 7 }

test("a targetId with no tab is sent to that target instead of being rejected", async () => {
  const fake = installFakeChrome({
    targets: [{ id: WORKER_TARGET_ID, type: "other", url: "blob:https://example.test/abc", tabId: undefined }],
  })
  const cdp = createController()

  const result = await cdp.sendCdpCommand(7, session, {
    targetId: WORKER_TARGET_ID,
    method: "Runtime.evaluate",
    params: { expression: "1 + 1", returnByValue: true },
  })

  assert.equal(result.targetKind, "non-tab")
  assert.equal(result.targetId, WORKER_TARGET_ID)
  assert.equal(result.attached, true)
  assert.deepEqual(fake.attached, [{ targetId: WORKER_TARGET_ID }], "the debuggee must be a bare targetId")
  assert.equal(fake.commands.at(-1).target.targetId, WORKER_TARGET_ID)
  assert.equal(fake.commands.at(-1).method, "Runtime.evaluate")
})

test("a tab targetId still resolves to a tab debuggee", async () => {
  const fake = installFakeChrome()
  const cdp = createController()

  await cdp.sendCdpCommand(7, session, { method: "Runtime.evaluate", params: { expression: "1" } })

  assert.deepEqual(fake.attached, [{ tabId: 7 }], "a plain call must still attach to the tab")
  assert.equal(fake.commands.at(-1).target.tabId, 7)
})

test("Target.attachToTarget and detachFromTarget work on a non-tab target", async () => {
  const fake = installFakeChrome({
    targets: [{ id: WORKER_TARGET_ID, type: "worker", url: "https://example.test/sw.js", tabId: undefined }],
  })
  const cdp = createController()

  const attached = await cdp.sendCdpCommand(7, session, {
    method: "Target.attachToTarget",
    params: { targetId: WORKER_TARGET_ID },
  })
  assert.equal(attached.targetKind, "non-tab")
  assert.equal(attached.attached, true)
  assert.equal(attached.reused, false)

  // A second attach is reported as reused rather than attaching twice.
  const again = await cdp.sendCdpCommand(7, session, {
    method: "Target.attachToTarget",
    params: { targetId: WORKER_TARGET_ID },
  })
  assert.equal(again.reused, true)
  assert.equal(again.attached, false)
  assert.equal(fake.attached.length, 1)

  const detached = await cdp.sendCdpCommand(7, session, {
    method: "Target.detachFromTarget",
    params: { targetId: WORKER_TARGET_ID },
  })
  assert.equal(detached.detached, true)
  assert.equal(detached.targetKind, "non-tab")
  assert.deepEqual(fake.detached, [{ targetId: WORKER_TARGET_ID }])
})

test("non-tab attaches stay bounded, and an eviction is reported rather than silent", async () => {
  const fake = installFakeChrome()
  const cdp = createController()

  const ids = Array.from({ length: 17 }, (_, index) => `TARGET${String(index).padStart(4, "0")}`)
  let last = null
  for (const targetId of ids) {
    last = await cdp.sendCdpCommand(7, session, {
      targetId,
      method: "Runtime.evaluate",
      params: { expression: "1" },
    })
  }

  // 16 stayed attached, so attaching the 17th had to release the first one.
  assert.equal(fake.detached.length, 1, "exactly one target should have been evicted")
  assert.deepEqual(fake.detached[0], { targetId: ids[0] }, "the oldest attach is evicted first")
  assert.equal(last.evictedTargetId, ids[0])
  assert.match(last.nextStepHint, /released the oldest non-tab attach/)
})

test("the target inventory lists non-tab targets with their capability", async () => {
  installFakeChrome({
    targets: [
      { id: "PAGE1", type: "page", url: "https://example.test/", tabId: 7, title: "Example", active: true },
      { id: WORKER_TARGET_ID, type: "other", url: "blob:https://example.test/abc", tabId: undefined, title: "" },
      { id: "PRIV1", type: "other", url: "chrome://omnibox-popup.top-chrome/", tabId: undefined, title: "" },
      { id: "OTHEREXT", type: "worker", url: "chrome-extension://some-other-extension-id/background.js", tabId: undefined, title: "" },
      { id: "OWNEXT", type: "worker", url: "chrome-extension://own-extension-id/background.js", tabId: undefined, title: "" },
      { id: "NOURL", type: "other", url: "", tabId: undefined, title: "" },
    ],
  })
  const cdp = createController()

  const listed = await cdp.listBrowserTargets(session)

  assert.equal(listed.pageCount, 1)
  assert.equal(listed.nonTabTargetCount, 5)
  const worker = listed.nonTabTargets.find((target) => target.targetId === WORKER_TARGET_ID)
  assert.equal(worker.kind, "non-tab")
  assert.equal(worker.tabId, null, "a non-tab target has no tab")
  assert.equal(worker.type, "other", "Chrome's own type is reported verbatim, not normalised")
  assert.equal(worker.canAttach, true)
  assert.match(worker.capabilityReason, /no tab/)

  const privileged = listed.nonTabTargets.find((target) => target.targetId === "PRIV1")
  assert.equal(privileged.canAttach, false)
  assert.match(privileged.capabilityReason, /chrome:\/\//)

  // Chrome refuses cross-extension debugging, so advertising another
  // extension's worker as attachable costs the caller a guaranteed failure.
  const otherExtension = listed.nonTabTargets.find((target) => target.targetId === "OTHEREXT")
  assert.equal(otherExtension.canAttach, false)
  assert.match(otherExtension.capabilityReason, /cross-extension/)

  const ownExtension = listed.nonTabTargets.find((target) => target.targetId === "OWNEXT")
  assert.equal(ownExtension.canAttach, true)
  assert.match(ownExtension.capabilityReason, /own service worker/)

  // A live browser produced targets with no URL that accept the attach and then
  // never answer Runtime.evaluate; the reason must warn instead of implying the
  // target is a working worker.
  const noUrl = listed.nonTabTargets.find((target) => target.targetId === "NOURL")
  assert.equal(noUrl.canAttach, true)
  assert.match(noUrl.capabilityReason, /never answers/)

  assert.match(listed.nextStepHint, /nonTabTargets have no tabId/)
})
