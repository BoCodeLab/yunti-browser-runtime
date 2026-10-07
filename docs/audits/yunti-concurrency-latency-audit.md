# Concurrency & Latency Audit — Yunti Browser Runtime v0.2.7 (extension)

Scope: read-only audit of `extension/session-manager.js`, `background.js`, `tool-handlers.js`,
`content.js`, `dom-observer.js`, `cdp.js`, `settings.js`, `network-monitor.js`, plus the bridge
poll/queue model in `mcp/bridge-hub.js` / `mcp/http-server.js` because the extension's execution
model is only meaningful in that context. Tests: `tests/session-manager.test.js`,
`tests/tool-handlers.test.js`. Contracts: `docs/AGENT_WORKFLOW_CONTRACT.md`,
`skills/yunti-browser-runtime/SKILL.md`.

Everything below is cited to `file:line`. Where a conclusion is an inference rather than a
read-off, it is labelled **(likely)**.

---

## 1. Execution model: tool_request → page → result

### 1.1 The path, hop by hop

| # | Hop | Code |
|---|---|---|
| 1 | Agent → MCP tool → `handleJsonRpc` → `callTool` | `mcp/server.js:298`, `mcp/server.js:235-257` |
| 2 | Owner mode calls `hub.callTool(tool, args)` with the default 30 s budget | `mcp/server.js:255`, `mcp/bridge-hub.js:13` |
| 3 | Hub resolves the route → `{logicalSessionId, transportSessionId, targetTabId}` | `mcp/bridge-hub.js:747-918` |
| 4 | Hub builds the `tool_request` payload with `route` + `deadlineAt = now + timeoutMs` | `mcp/bridge-hub.js:997-1013` |
| 5 | Delivery: `session.pollers.shift()` → `poller(payload)`, else `session.queue.push(payload)` | `mcp/bridge-hub.js:1038-1043` |
| 6 | A waiting `GET /extension/poll` resolves and the HTTP response is written | `mcp/bridge-hub.js:1292-1318`, `mcp/http-server.js:350-367` |
| 7 | Background poll loop receives the JSON, sets `controllerPollerLastProgressAt`, hands the event to `queueControllerToolRequest` | `extension/session-manager.js:169-180` |
| 8 | Lane selection + serialization (`tab:<id>` / `exclusive` / `browser`) | `extension/session-manager.js:216-277` |
| 9 | Deadline re-check, then `withTimeout(toolRequestHandler(null, session, event), …)` | `extension/session-manager.js:241-264` |
| 10 | Dispatcher: deadline check → route resolution → `assertConcretePageRoute` → per-tool branch | `extension/tool-handlers.js:27-137` |
| 11 | Page work: `chrome.tabs.sendMessage(tabId, {type:"yunti_execute_tool",…})` or `chrome.debugger.sendCommand` | `extension/tool-handlers.js:132-136`, `extension/cdp.js:515-523` |
| 12 | Content script dispatch table | `extension/content.js:28-42`, `extension/content.js:327-366` |
| 13 | Result POST `POST /extension/result {browserSessionId, requestId, ok, result, error}` | `extension/tool-handlers.js:143-149` |
| 14 | Hub `submitResult` clears the timer, deletes pending, resolves the promise | `mcp/bridge-hub.js:1321-1349` |
| 15 | MCP response returns to the client | `mcp/server.js:298-...` |

Extension-side failure paths also POST to `/extension/result` with `ok:false`:
`extension/session-manager.js:256-263` (timeout / expired before execution).

### 1.2 Every serialization point

1. **Bridge: one outstanding long-poll per transport session.** `mcp/bridge-hub.js:1038-1043` —
   `const poller = session.pollers.shift(); if (poller) poller(payload) else session.queue.push(payload)`.
   A session's `pollers` array only ever holds the pollers that are *currently* awaiting
   (`mcp/bridge-hub.js:1317`) and each `poll` call shifts the queue until it finds a live request
   (`mcp/bridge-hub.js:1287-1290`). Since the extension has exactly one controller poll loop
   (`extension/session-manager.js:153-193`), there is **one delivery slot per browser profile**.
2. **Bridge: `session.queue` (FIFO) when no poller is attached** (`mcp/bridge-hub.js:1042`),
   drained one item per `poll` (`mcp/bridge-hub.js:1287-1290`), discarded on timeout
   (`mcp/bridge-hub.js:1016-1027`) and on cancel (`mcp/bridge-hub.js:1351-1392`).
3. **Extension: `tabToolQueues` Map** (`extension/session-manager.js:41`, `:270-275`) — one promise
   chain per `tab:<id>`.
4. **Extension: `exclusiveToolLane`** (`extension/session-manager.js:42`, `:265-266`).
5. **Extension: `browserToolLane`** (`extension/session-manager.js:43`, `:267-268`).
6. **Content script: one JS thread per tab, but no explicit queue.** `chrome.runtime.onMessage`
   handlers run as they arrive (`extension/content.js:28-42`); async tools (`clickElement`,
   `fillElement`, `resolveActionableSelector` — `extension/content.js:534-553`, `:807-834`)
   `await delay(100)` (`extension/content.js:827`) and therefore **yield**, so two messages that
   reach the same tab concurrently can interleave inside the page (see §4.1).
7. **`pendingTabRecovery` dedupe** (`extension/session-manager.js:36`, `:312-317`) — one in-flight
   `recoverTabRegistration` per tab; this is the only content-script-message-level serialization.
8. **CDP per tab**: `chrome.debugger` allows one debugger client per target; the controller keeps
   `cdpAttachedTabs` (`extension/cdp.js:6`) as its view of it. No queue — concurrent commands to the
   same tab are serialized only by lane 3/4.

### 1.3 The three lanes, precisely

`controllerToolQueueKey` (`extension/session-manager.js:216-222`):

```js
const route = event.route || {}
const tabId = Number(route.tabId)
if (Number.isFinite(tabId) && tabId > 0) return `tab:${tabId}`
if (PARALLEL_BROWSER_TOOLS.has(event.tool)) return "browser"
return "exclusive"
```

- **`tab:<id>`** — `startAfter = Promise.all([tabTail, exclusiveToolLane]).then(()=>{})`
  (`extension/session-manager.js:236-240`); tail is replaced by this request's completion promise
  (`:270-275`). Same-tab order is preserved; different tabs are independent of each other.
- **`exclusive`** — `startAfter = Promise.all([exclusiveToolLane, Promise.allSettled([...tabToolQueues.values()])])`
  (`extension/session-manager.js:228-232`), and the (non-settled) completion promise becomes
  `exclusiveToolLane` (`:265-266`). So it waits for **all currently queued tab tails** and then
  **blocks all later tab work** (because tab lanes await `exclusiveToolLane`). Yes — `exclusive`
  really does block later tab work: that is proven by the tab branch awaiting `exclusiveToolLane`
  at `:238`, and asserted by `tests/session-manager.test.js:338-388`.
- **`browser`** — `startAfter = browserToolLane.catch(()=>{})` (`extension/session-manager.js:233-234`).
  It neither waits for nor is waited on by the other two lanes: barrier-free in both directions.
  Membership is a hard-coded set of four inventory tools (`extension/session-manager.js:198-203`).
  Precisely: `yunti_new_page` is in that set and it *does* touch a page
  (`extension/tool-handlers.js:2088-2124` → `waitForNewPageRegistration` → `ensureTabRegistered`
  → injection, `:2126-2144`), so the "never touch a page execution context" comment at
  `extension/session-manager.js:196-197` is inaccurate for that one member.

**Critical consequence (proven from the code, not a guess):** the branch requires a *positive
`route.tabId`*, and the bridge only populates `route.tabId` from an explicit `tabId`/`targetId`
argument (`mcp/bridge-hub.js:757-760`, `:1006`). The tool schemas expose `tabId`/`targetId` only on
`yunti_cdp_send_command` and `yunti_list_browser_targets` (`mcp/tools.js:392-421`); every other tool
takes only `browserSessionId` (`mcp/tools.js:29`, `:61`, `:118`, `:170` …). Therefore the canonical
workflow — `observe → click → fill → observe` addressed by `browserSessionId` — has
`route.tabId === undefined` for **every call**, so all of it lands in the single `exclusive` lane
and runs one-at-a-time, *even when the calls target different tabs*. The three-lane model is
effectively a single global lane for the documented workflow; the tab lanes only light up when the
agent passes an explicit `tabId` (`docs/AGENT_WORKFLOW_CONTRACT.md:13-14`,
`skills/yunti-browser-runtime/SKILL.md:17-19` explicitly permit that), and then the extension
resolves a *different* tab inside `resolveToolPageRoute` than the one the lane was chosen for
(see §4.6).

---

## 2. Concurrency limits, with numbers

### 2.1 The single bounding slot (quoted)

```js
// mcp/bridge-hub.js:1038-1043
const poller = session.pollers.shift()
if (poller) {
  poller(payload)
} else {
  session.queue.push(payload)
}
```

and

```js
// mcp/bridge-hub.js:1287-1290
while (session.queue.length > 0) {
  const request = session.queue.shift()
  if (this.pendingRequests.has(request.id) && request.deadlineAt > Date.now()) return request
}
```

One `GET /extension/poll` response == one delivered `tool_request`. The extension issues exactly one
poll request at a time (`await fetch(...)` inside the `while` loop,
`extension/session-manager.js:172-176`). **That is the single slot that bounds throughput.**

Practical throughput = one delivery per `(poll re-arm + bridge RTT + poll-loop overhead)`.
Re-arm cost per cycle, all `await`ed *before* the next `fetch` (`extension/session-manager.js:156-171`):

1. `currentLiveTabIds()` → `chrome.tabs.query({})` — full tab inventory, local IPC
   (`extension/session-manager.js:156`, `:126-135`).
2. `POST /sessions/register` with the whole session object including the full `liveTabIds` array —
   a real HTTP round trip to the bridge (`extension/session-manager.js:159`).
3. `getSettings()` → `chrome.storage.local.get([...5 keys])` (`extension/session-manager.js:160`,
   `extension/settings.js:5-24`).
4. Bridge side: `hub.poll` first runs `cleanupExpiredSessions()` and, for a controller,
   `refreshPageSessionsForController(session)` which iterates **every registered session** and
   rebuilds a `Set` of live tab ids on every poll (`mcp/bridge-hub.js:1276-1285`, `:362-395`,
   `:367-369`).

So per delivered call the controller loop pays one extra full-state registration POST plus a
storage read, and the bridge pays an O(sessions) sweep per poll. With N tabs registered this is the
dominant fixed cost of every call. **(likely)** tens of ms per call on a 100+ tab profile; the
code proves the O(N) work and the extra HTTP round trip, not the wall-clock size.

### 2.2 How many requests can be in flight

- **Per tab: 1 executing.** The `tab:<id>` chain awaits the tail (`extension/session-manager.js:236-239`).
- **Per browser profile: 1 *delivered* at a time, but many *executing*.** Delivery is one request per
  poll response; execution is concurrent across lanes. The poll loop does **not** await the tool —
  `queueControllerToolRequest` is called fire-and-forget (`extension/session-manager.js:178-180`)
  and returns immediately, so the loop re-arms while a tool is still running. Asserted by
  `tests/session-manager.test.js:259-280`.
- **Globally (one machine, one profile): 1 poll slot.** Multiple profiles = multiple controllers =
  multiple poll slots (`extension/session-manager.js:74-110`, `mcp/bridge-hub.js:191-201`).
- **In the `exclusive` lane: 1.** Unbounded backlog behind it — the lane is a single promise chain
  with no size cap (`extension/session-manager.js:42`, `:265-266`).
- **No global in-flight cap exists anywhere.** A burst of calls is bounded only by the bridge's
  per-call timer (`mcp/bridge-hub.js:1015-1036`) and by `deadlineAt` drops.

### 2.3 Controller long-poll behaviour (how soon the next poll starts)

`extension/session-manager.js:169-171` requests `timeoutMs=25000`. The bridge clamps the poll hold to
`Math.max(1000, Math.min(timeoutMs, 30_000))` (`mcp/bridge-hub.js:1302-1304`), so a poll returns a
`noop` after ~25 s of silence. On any response — `tool_request`, `noop`, or `stale` — the loop
immediately continues to the next iteration (`extension/session-manager.js:176-180`, loop head at
`:154`). **The next poll does not start immediately:** it starts after `chrome.tabs.query({})` +
`POST /sessions/register` + `storage.local.get` (`:156-161`). Only this blocks re-arm. After a
tool_request the loop re-arms in the same iteration, so the next queued request can be delivered
while the previous tool is still executing.

Error path: any throw → `controllerPollerLastProgressAt = Date.now()` then `await delay(1500)`
backoff (`extension/session-manager.js:181-186`). Bridge-side, the `/extension/poll` handler aborts
its `pollController` when the HTTP client disconnects (`mcp/http-server.js:357-363`), which removes
the poller from `session.pollers` *before* it can consume a request
(`mcp/bridge-hub.js:1294-1318`; asserted at `tests/bridge.test.js:354-365`).

### 2.4 Timeouts and backoff constants (all of them)

| Constant | Value | Where |
|---|---|---|
| Controller poll hold | `timeoutMs=25000` | `extension/session-manager.js:169-171` |
| Bridge poll clamp | `max(1000, min(timeoutMs, 30000))` | `mcp/bridge-hub.js:1302-1304` |
| Extension tool timeout (`controllerToolTimeoutMs`) | 25 000 ms default | `extension/session-manager.js:14`, `:27-30` |
| Effective execution timeout | `min(25 000, deadlineAt - now)` | `extension/session-manager.js:247-255` |
| Bridge tool timeout (`DEFAULT_TOOL_TIMEOUT_MS`) | 30 000 ms | `mcp/bridge-hub.js:13`, used at `mcp/server.js:255` |
| `deadlineAt` | `Date.now() + timeoutMs` at call time | `mcp/bridge-hub.js:1012` |
| Poller stall timeout | 45 000 ms | `extension/session-manager.js:15`, `:31-34` |
| Poll error backoff | 1500 ms | `extension/session-manager.js:184` |
| Fast recovery schedule | 1000/3000/8000/15000/30000 ms + 0.5 min alarm | `extension/background.js:7`, `:87-97` |
| Content-script probe timeout | 1500 ms | `extension/session-manager.js:12`, `:398-402` |
| Content-script injection timeout | 3000 ms | `extension/session-manager.js:13`, `:418-445` |
| Recent-injection wait | 10 × 25 ms = 250 ms | `extension/session-manager.js:352-367` |
| Post-injection registration wait | 10 × 25 ms = 250 ms | `extension/session-manager.js:376-378` |
| Injection-suppression window | 5000 ms | `extension/session-manager.js:351-352` |
| Temporary activation settle delay | 150 ms | `extension/session-manager.js:457` |
| Session TTL | 90 000 ms (`YUNTI_BROWSER_SESSION_TTL_MS`) | `mcp/bridge-hub.js:20-22`, `:183` |
| Actionability poll interval | 100 ms | `extension/content.js:18`, `:827` |
| Actionability default timeout | 1200 ms (clamped 0…5000) | `extension/content.js:17`, `:808-810` |
| `wait_for` page debounce | 120 ms | `extension/dom-observer.js:6`, `:251-254` |
| `wait_for` page interval | 250 ms | `extension/dom-observer.js:7`, `:269` |
| `wait_for` clamp | 100…30000 ms, default 5000 | `extension/dom-observer.js:218`, `extension/tool-handlers.js:1791-1793` |
| Registration re-schedule debounce | 500 ms | `extension/content.js:293-299` |
| Auth-state cache TTL | 5000 ms | `extension/content.js:16`, `:136-141` |
| `yunti_new_page` load wait | 10 000 ms, 50 ms poll | `extension/tool-handlers.js:2130-2136` |
| Drag step delay | 16 ms per step (default 10 steps) | `extension/tool-handlers.js:2176`, `:2194` |
| Trace-complete poll | 100 ms, 5000 ms cap | `extension/cdp.js:579-586` |
| Tab-activation timeout (CDP `Page.captureScreenshot` in `capture_visible_tab`) | none | `extension/tool-handlers.js:58-63` |

Timeout asymmetry worth stating: the bridge's 30 s timer starts at call time and covers queue wait +
transport + execution, while the extension's timer starts when the request reaches the front of its
lane and is capped at `min(25 000, remaining)`. Because the bridge's budget is larger, the
extension normally reports its own timeout first (`extension/session-manager.js:251-255` →
`ok:false` POST). In the pathological case (queue wait > 30 s) the bridge timer fires first, deletes
the pending entry (`mcp/bridge-hub.js:1016-1027`) and the later `/extension/result` POST is rejected
`accepted:false` (`mcp/bridge-hub.js:1321-1326`).

---

## 3. Latency tax per call

### 3.1 `yunti_get_page_snapshot` (dispatched through the generic tail branch)

`yunti_get_page_snapshot` is absent from the dispatcher's if-chain, so it falls through to
`extension/tool-handlers.js:131-137`.

| Hop | Cost | Avoidable? |
|---|---|---|
| MCP stdio/HTTP → `handleJsonRpc` → `hub.callTool` | local | unavoidable |
| `resolveToolRoute`: session map lookups, `getLiveSession`, `selectControllerSession` | microseconds + `cleanupExpiredSessions()` O(sessions) | unavoidable-ish |
| Bridge `poll` → HTTP response | loopback RTT | unavoidable |
| Extension poll-loop re-arm: `chrome.tabs.query({})` + `POST /sessions/register` + `storage.local.get` | **pure overhead, paid before the request is even dispatched** | avoidable (§6.1) |
| Lane hop (`exclusive` → wait for all tab tails) | 0 when idle | structural |
| `resolveToolPageRoute` | for a controller session: `normalizeTabId` … then `chrome.tabs.get(targetTabId)` to compare URLs (`extension/tool-handlers.js:194-201`) — **one extra tabs.get per call, only when `knownPageSession.url` is truthy** | partially avoidable (§6.5) |
| `chrome.tabs.sendMessage` (runtime messaging to the content script) | one IPC hop | unavoidable |
| `getPageSnapshot` → `getAuthState()` | cache hit within 5 s TTL (`extension/content.js:126-141`) | unavoidable |
| `collectVisibleText(maxTextLength)` | `TreeWalker` over **all** text nodes; per node it calls `isVisible(node.parentElement)` → `getComputedStyle` + `getBoundingClientRect` (`extension/content.js:1206-1220`, `:1348-1356`). Forced style+layout work per accepted/rejected node — the loop stops only after `out.length` exceeds the cap, but every node *considered* pays the check. **Largest single cost in the call.** | reducible (§6.3) |
| `getPageOverview()` | 4 more full-document `querySelectorAll` passes + `.filter(isVisible)` each (`extension/content.js:1222-1252`) | reducible |
| `describeForm/describeClickable/describeInput/describeTable` (detailed mode only) | per element `cssPath()` walks parents and scans siblings (`extension/content.js:1358-1373`) + `innerText` reads | avoidable by staying in light mode |
| Result POST `/extension/result` | loopback RTT, **fire-and-forget** (not awaited by the caller chain) | unavoidable |
| Hub `submitResult` → promise resolve → MCP response | local | unavoidable |

Unavoidable per call: bridge delivery RTT, runtime message to the tab, the page's own DOM work, and
the result POST. Pure overhead: the poll-loop re-arm block (tab query + register POST + storage
read) and, on the bridge, the per-poll O(sessions) sweep — neither is needed to execute the call.
Note the module-system cost: each `session-manager.js` function that talks to the bridge re-reads
settings through `getSettings()` (`extension/session-manager.js:72`, `:108`, `:160`, `:289`, `:321`,
`:497`, `:536`, `:597`, `:609`), i.e. a storage round trip per helper call even though the value only
changes on the settings-changed listener (`extension/background.js:65-69`).

### 3.2 A CDP tool (`yunti_cdp_send_command`, `Runtime.evaluate`)

`extension/tool-handlers.js:75-76` → `extension/cdp.js:48-107`.

| Hop | Cost | Avoidable? |
|---|---|---|
| Everything from §3.1 through the lane hop | as above | as above |
| `resolveCdpTargetTabId` (`extension/cdp.js:391-399`) | 0 extra RTT when `tabId` given, otherwise `chrome.debugger.getTargets` | — |
| `ensureCdpAttached` (`extension/cdp.js:449-461`) | cached path: 0 commands. Cold path: `chrome.debugger.attach` **+ `Page.enable` + `Runtime.enable` + `Log.enable`** = **4 sequential CDP round trips before the requested command** (`:459`, `:463-471`) | first-call-only in practice |
| Requested command | 1 CDP round trip | unavoidable |
| Result POST + hub resolve | as above | unavoidable |

So a CDP call is `+1 attach, +3 domain enables` on first use per tab, then `+0` while attached;
`detachCdpTab` deletes `cdpEnabledDomains` for the tab (`extension/cdp.js:483-485`), so a
detach/attach cycle re-pays all four. Note also `Runtime.evaluate` via
`chromeDebuggerSendCommand` is a *different* path from `yunti_evaluate_script`
(`extension/tool-handlers.js:401-432`); both attach, but the dedicated tool enforces the
`maxLength` serialization (`:434-446`) and the CDP tool does not.

### 3.3 Fixed sleeps / polls you pay on the hot paths

- Actionability: up to `1.2 s` at `100 ms` steps per selector action (`extension/content.js:17-18`,
  `:807-834`); only when the element is not ready.
- `yunti_wait_for`: `120 ms` debounce + `250 ms` interval, i.e. a matched condition is reported up to
  ~370 ms late (`extension/dom-observer.js:6-7`, `:249-254`, `:269`).
- Injection recovery: `2×250 ms` worst-case waits (`extension/session-manager.js:353-354`, `:376-378`)
  and a `150 ms` settle after temporary activation (`:457`).
- `yunti_new_page`: 50 ms poll until tab `status === "complete"` or 10 s (`extension/tool-handlers.js:2132-2138`).
- `yunti_performance_stop_trace`: 100 ms poll until `Tracing.tracingComplete`, max 5 s
  (`extension/cdp.js:579-586`).
- `yunti_drag`: `16 ms × steps` (default 10 → 160 ms) (`extension/tool-handlers.js:2176`, `:2187-2195`).
- Content-script self-registration: every DOM mutation schedules a `register()` 500 ms later
  (`extension/content.js:277-281`, `:293-299`) and each `register()` costs **two** runtime messages
  plus **two** background-side bridge POSTs (`extension/content.js:74-94` →
  `extension/session-manager.js:469-470`, `:496-533`). On a continuously mutating SPA this is a
  standing background cost of up to ~2 registrations/s per tab, competing with tool traffic on the
  same service worker and the same bridge. `tests/session-manager.test.js:434-473` asserts 30 page
  sessions produce exactly one poll, but nothing bounds this registration rate.

---

## 4. Race / correctness risks under concurrency

### 4.1 Content-script reentrancy is only *mostly* covered by the tab lane
The tab lane guarantees one *tool* per tab, but content-script messages can also arrive from
`ensureTabRegistered` (background listeners: `extension/background.js:44-55`, popup refresh
`extension/session-manager.js:647-651`) and from `resolveToolPageRoute` (`extension/tool-handlers.js:203-205`).
`pendingTabRecovery` dedupes recoveries per tab (`extension/session-manager.js:312-317`) but does not
serialize them against tool traffic: an in-flight `yunti_refresh_registration`
(`extension/session-manager.js:399`) can run inside `register()` (`extension/content.js:74-94`) — which
calls `getAuthState({forceAuth:true})` → `collectVisibleText(5000)` → a full DOM text walk
(`extension/content.js:152`) — concurrently with a tool's actionability loop. Net effect: an
occasional multi-hundred-ms spike in a click/fill, not corruption. **(likely)**

### 4.2 uid map invalidation between observe and act
`pageUidStore` is keyed by `browserSessionId` (`extension/tool-handlers.js:449`, `:522-534`) and is
**wholly replaced** on each observe/find/snapshot (`:528-533`). Cross-tab clobbering is not possible
(pages have distinct stable ids, `extension/session-manager.js:681-686`), and same-tab observe/act is
serialized while both are addressed by `browserSessionId`/same `tabId`. The real exposure is when the
bound tab differs from the lane's tab (§4.6) or when two tabs' sessions alias
`stableChildPageSessionId` for the same tab (`extension/tool-handlers.js:2146-2153`,
`extension/cdp.js:288-295`): two different helpers compute the same shape
`yunti-page-<tabId>-<suffix>` with **different suffixes** for the same tab, so `sessionsByTab` (last
writer wins, `extension/tool-handlers.js:2105`) and the bridge's logical route can disagree while
`pageUidStore` keeps a map under the *old* id. A subsequent `yunti_click` with a uid from that older
map resolves `backendNodeId`/`nodeId` (`:1643-1665`) that may now designate a different node —
silent mis-click. Also note `uidMapVersion`/`observationId` are recorded (`:494-497`) but **never
validated** on read (`:1643-1652`), so `SKILL.md:102-104`'s "observation-scoped uid" contract is
enforced by the *page* (`extension/dom-observer.js:76`: `yunti-${uidScope}-${uidCounter}`) but not by
the dispatcher.
Delta observations are excluded from clobbering (`:490-498`), which is the one guard that exists.

### 4.3 Tab activation + restore (`extension/session-manager.js:447-465`)
The sequence is: read the window's active tab (`:451-452`), `chrome.tabs.update(tabId,{active:true})`
(`:455`), `delay(150)`, inject (`:458`), restore the previous tab in `finally` (`:461-463`).
Two concurrent recoveries for different tabs (e.g. two tool calls targeting two tabs, both injected
while the extension had just restarted) each capture a different `previousActiveTabId`: the second
call's `query({active:true})` observes the tab activated by the first, so **both** restore
"previous", or the first restores the user's tab while the second is still injecting. Outcomes:
injection lands on a backgrounded tab (which is exactly what it was working around), and the user's
foreground tab flickers or ends up wrong. `pendingTabRecovery` (`:312-317`) does **not** prevent this
— it dedupes per tab, not per window. Not covered by any test beyond the single-tab case at
`tests/session-manager.test.js:176-198`.
Related: `chrome.tabs.captureVisibleTab(session.windowId)` (`extension/tool-handlers.js:42-44`)
captures the **active** tab of that window, which an in-flight recovery (§4.3) or another agent call
(`Target.activateTarget` interception, `extension/cdp.js:354-366`) may have changed — the screenshot
can be of the wrong page, and the CDP fallback (`:59-63`) is only reached when `captureVisibleTab`
*throws*.

### 4.4 CDP attach/detach shared per tab
`cdpAttachedTabs` / `cdpEnabledDomains` are module-scoped per tab (`extension/cdp.js:6-7`).
`detachCdpTab` (`:473-493`) and the `chrome.debugger.onDetach` listener (`:30-45`) delete the enabled
set for the tab. Enables are marked **after** the command resolves (`:466-470`), so a detach landing
between an `ensureCdpDomains` call and its `enabled.add` leaves the controller believing `Runtime`/
`Log` are enabled when the fresh session never enabled them — silently losing console events and
`Log.entryAdded` forwarding (`:26-28`, `:38-45`). Same-tab tool ordering prevents this only while
every detach request is itself queued behind the attach request; `yunti_cdp_detach`
(`extension/tool-handlers.js:81-82`) and `Target.detachFromTarget` interception (`extension/cdp.js:325-352`)
can also be triggered from `interceptTargetCloseTarget` (`:248`) and `closePage`
(`extension/tool-handlers.js:2163`) — i.e. from a *different* call than the one holding the attach.

### 4.5 Dialog handling
`yunti_handle_dialog` (`extension/tool-handlers.js:1982-1994`) issues
`Page.handleJavaScriptDialog` on the tab. While a JS dialog is open Chrome blocks script execution on
that tab; the guarantee that the extension has a dialog to handle comes from the page itself
(`window.confirm` in `extension/content.js:802-805`), and the tool cannot know whether the dialog has
been auto-dismissed by navigation. Because the CDP backend is per tab and lane-ordered, dialog
handling cannot interleave *with that tab's* tools, but a dialog opened by a `yunti_evaluate_script`
call is only reachable after that call returns — and if the evaluate call is still awaiting its CDP
reply, the dialog tool is queued behind it and cannot unblock it. This is a design-level deadlock
window for `Runtime.evaluate` expressions that open `alert/confirm` (no test covers it).

### 4.6 `yunti_emulate` / `yunti_resize_page` overriding device metrics
`yunti_resize_page` (`extension/tool-handlers.js:1996-2010`) and `yunti_emulate`
(`:2012-2065`) set `Emulation.setDeviceMetricsOverride`, `setUserAgentOverride`,
`Network.emulateNetworkConditions`, and `setCPUThrottlingRate` on the tab and **do not restore
them** (except `emulate({clear:true})`, `:2015-2026`). Layout-sensitive work in *other* tools on the
same tab is ordered, but layout-sensitive work on *other tabs* runs concurrently in the tab lane
while the browser-process emulation state (`Network.emulateNetworkConditions` is profile-scoped)
applies. Concretely: `yunti_take_screenshot({fullPage:true})` temporarily sets the device metrics to
the content size and clears them in a `finally` (`:344-349`, `:363-371`) — a concurrent
`yunti_resize_page`/observe on the same tab cannot interleave only because they share a lane; if the
screenshot and the resize carry *different* `route.tabId` resolution (§1.3) they may still collide
via the `exclusive` fallback path. Any `yunti_observe_page` after an `emulate` reports viewport
numbers that look like the real device but are emulated; nothing in the observation records that
emulation is active (`extension/dom-observer.js:112-116`), so an agent measuring layout has no signal.

### 4.7 Screenshot racing navigation
Same-tab navigation (`extension/tool-handlers.js:231-296`) and screenshot (`:325-383`) share a lane
when both carry the same `route.tabId`, so ordering holds. But `action === "reload"` returns
immediately after `chrome.tabs.reload(tabId)` (`:235-238`) and `action === "url"` after
`chrome.tabs.update` (`:294-295`) — neither waits for the new document. A screenshot issued right
after a navigate call therefore captures either the old or the new document depending on timing, and
`Page.captureScreenshot` may fail with "target closed"/blank while the new document commits. The
result contains no navigation-generation marker, so the caller cannot tell which document the image
belongs to.

### 4.8 `route.tabId` absent ⇒ everything into `exclusive`
Fully covered in §1.3. The risk is twofold: (a) throughput collapse for the documented
`browserSessionId`-only workflow; (b) a *safety* asymmetry — the exclusive lane is the only lane
that stops the world, so an agent doing `observe`(exclusive) → `click`(exclusive) on tab A while a
`tabId`-addressed call runs on tab B gets a mixed global ordering with no documented meaning.

### 4.9 Stale-request / deadline handling inside the queue
- Extension pre-check: `if (deadlineAt <= Date.now()) throw` *before* the handler
  (`extension/session-manager.js:244-246`) and again at `extension/tool-handlers.js:33-35`; the
  error is reported as a result (`extension/session-manager.js:256-263`). Covered by
  `tests/session-manager.test.js:390-414` and `tests/tool-handlers.test.js:176-189`.
- The timeout does **not** cancel work. `withTimeout` is a `Promise.race` with a timer
  (`extension/session-manager.js:770-782`); when it fires, the lane promise *resolves* (the catch is
  attached at `:266-268`), so the `exclusive` lane — and the whole tab-blocking barrier — is released
  while the underlying page operation is still running. The contract acknowledges the result is
  uncertain (`docs/AGENT_WORKFLOW_CONTRACT.md:37-39`, `SKILL.md:242-244`) but does not state that the
  mutual-exclusion barrier itself is released early.
- `deadlineAt` is not propagated to tool handlers: `executeToolRequest` receives `(tabId, session, event)`
  and re-reads `event.deadlineAt` itself (`extension/tool-handlers.js:33`), so long operations
  (`yunti_wait_for`, `new_page`, device emulation) cannot shorten their own budget; the bridge may
  time out first and reject the late result (`mcp/bridge-hub.js:1321-1326`).

### 4.10 Other concrete interleavings found while reading
- **`sessionsByTab` last-writer-wins:** `registerContentSession` (`extension/session-manager.js:530`),
  `newPage` (`extension/tool-handlers.js:2105`), `interceptTargetCreateTarget`
  (`extension/cdp.js:276`) all `set` the map without comparing `kind`/`url`, so a stale page
  registration overwriting a newer one is possible under concurrent tab-open + navigation events.
- **`activateTab` ordering:** background posts `/sessions/activate` from the tab-activation listener
  (`extension/background.js:44-47` → `extension/session-manager.js:279-286`); two rapid activations
  can be applied out of order at the hub (`mcp/bridge-hub.js:525-543`), leaving
  `activeSessionByUser` pointing at the tab the user just left — which then decides the default
  route for calls with no explicit `browserSessionId` (`mcp/bridge-hub.js:855-905`).
- **Unresolved-tab timing:** when the extension resolves the bound tab *after* the lane decision,
  it uses `await activeTabId()` (`extension/tool-handlers.js:190`, `:215-218`) — i.e. the request can
  land on whatever tab is active at execution time, not at submit time. Combined with §4.3 (the
  recovery path itself changes the active tab) a call order can land on a tab that no call intended.

---

## 5. Unit-test blind spots

`tests/session-manager.test.js` (537 lines) covers: injection of existing tabs (`:131-154`), probe
timeout recovery (`:156-174`), single-tab temporary activation + restore (`:176-198`), controller
registration shape (`:200-230`), one-controller/one-poll-loop under `Promise.all` (`:232-257`),
polling continues during a hung tool (`:259-280`), per-tab ordering vs. cross-tab parallelism
(`:282-336`), exclusive-lane mutual exclusion (`:338-388`), expired-request drop (`:390-414`),
stall-watchdog poller replacement (`:416-432`), stable page ids without per-tab pollers (`:434-473`),
bridge-URL change restart (`:475-499`), no-injection-when-reachable (`:501-518`), popup refresh
fallback (`:520-537`).

`tests/tool-handlers.test.js` (55 tests, lines listed via grep) is entirely **sequential
single-call** coverage of result shapes plus two uid-map sequential tests (`:2802`, `:2781`) and one
expired-request test (`:176`).

**Not covered by any test:**

1. **`route.tabId` missing ⇒ everything serializes in `exclusive`.** Every queue test passes an
   explicit `route.tabId` (`tests/session-manager.test.js:292`, `:299`, `:306`, `:347`, `:355`,
   `:362`). No test exercises the real bridge payload for a `browserSessionId`-only page tool, which
   has no `tabId`. The single-lane collapse documented in §1.3 is therefore invisible to the suite.
2. **Lane decision made from the bridge's tab but execution bound to the extension's tab.** No test
   asserts that the tab used by `resolveToolPageRoute` equals the tab the lane was chosen for.
3. **Concurrent recovery for two different tabs / two windows** (the `previousActiveTabId` race in
   §4.3). Only the single-tab case exists (`tests/session-manager.test.js:176-198`).
4. **`withTimeout` releasing the `exclusive` barrier while the handler keeps running** (§4.9). The
   hung-tool test (`:259-280`) checks that the *result* is posted, never that the lane stayed closed.
5. **Concurrent `executeToolRequest` on two tabs** — no test invokes the dispatcher twice without
   awaiting the first, so nothing covers `pageUidStore` under interleaving, `resolveUidCenter`
   against a map replaced mid-call, or `sessionsByTab` clobbering.
6. **The uid-map identity/alias hazard of `stableChildPageSessionId` vs `stablePageSessionId`**
   (§4.2) — `tests/tool-handlers.test.js:290-323` covers only a single new-page path.
7. **`cdpAttachedTabs`/`cdpEnabledDomains` invalidation by a concurrent detach** (§4.4). cdp.js has no
   unit test at all in this repo; the dispatcher harness stubs `ensureCdpAttached` to a no-op
   (`tests/tool-handlers.test.js:117-135`), so attach/detach/domain-enable logic is never executed.
8. **`captureVisibleTab` capturing a non-target tab** (§4.3) — no test, and the e2e smoke
   (`tests/e2e.test.js`, `YUNTI_E2E=1`) is strictly sequential (`:132-221`).
9. **`yunti_emulate` / `yunti_resize_page` leak of device metrics and their effect on concurrent
   layout reads** (§4.6) — no test references either tool (grep for `yunti_emulate` in `tests/`
   returns nothing).
10. **Dialog vs. blocked-tab deadlock** (§4.5) — no test.
11. **Screenshot/navigation generation mismatch** (§4.7) — no test.
12. **Content-script reentrancy and the registration-storm rate** (§4.1, §3.3) — no test bounds
    `scheduleRegister` frequency; `tests/session-manager.test.js:434-473` only checks poll count.
13. **Bridge single-poller back-pressure with a real burst** — `tests/bridge.test.js:359/364/430`
    assert `pollers.length`, and `tests/e2e.test.js:80` asserts total pollers `<= 1`, but no test
    drives N concurrent `hub.callTool` calls through one controller poll slot and measures queue
    growth, ordering, or `deadlineAt` drops. The ad-hoc probe scenarios
    (`scripts/yunti-probe/probe.js:663-768`: `same-tab-parallel-read`, `cross-tab-parallel`,
    `mcp-http-mixed`, `sequential-burst`) cover this measurement but are not part of the test suite.

---

## 6. Concrete, minimal optimizations

Ordered by expected effect per unit of risk. Every item is local to one function.

1. **Move the poll re-arm ahead of the per-cycle bookkeeping** —
   `extension/session-manager.js:153-193` (`startControllerPolling`/`loop`). Currently
   `chrome.tabs.query({})`, `POST /sessions/register`, and `getSettings()` all complete before the
   next `fetch` starts (`:156-171`). Restructure so the poll `fetch` is issued first and the
   registration POST + tab query run while the poll is parked (they only carry heartbeat data;
   the next poll's `hub.poll` refreshes page heartbeats anyway, `mcp/bridge-hub.js:1282-1285`).
   **Effect:** removes one HTTP round trip plus a full `tabs.query({})` from the delivery latency of
   every call; on 100+ tab profiles this is the largest fixed per-call cost. **Risk:** low — the
   registration payload is a heartbeat, not a prerequisite. One caveat that is *not* obviously safe:
   if `controllerSession.liveTabIds` goes stale by one cycle, a closed tab is refreshed once more
   before the hub marks it stale (`mcp/bridge-hub.js:380-384`), so a call submitted in that ~1 s
   window can still route to a dead tab and fail in `resolveToolPageRoute`
   (`extension/tool-handlers.js:203-211`) — which is recoverable but adds one failed call. Verify
   that trade-off before shipping.
   Contract check: no contract statement depends on register-before-poll ordering.

2. **Cache settings for the poll loop instead of re-reading per cycle** —
   `extension/session-manager.js:597-606` (`postBridge`), `:137-194` (`startControllerPolling`), and
   the other `getSettings()` call sites (`:72`, `:108`, `:289`, `:321`, `:497`, `:536`, `:609`).
   Invalidate on the existing `chrome.storage.onChanged` listener (`extension/background.js:65-69`).
   **Effect:** removes 2–4 `storage.local.get` round trips per delivered call.
   **Risk:** low; the settings-changed path already restarts the poller on URL/token change
   (`extension/session-manager.js:163-168`).

3. **Make `collectVisibleText` layout-free and cap-driven** —
   `extension/content.js:1206-1220` (+ `isVisible` at `:1348-1356`). Skip `getComputedStyle`/
   `getBoundingClientRect` per text node: either use `parentElement.offsetParent !== null`-style
   cheap checks, or precompute a `Set` of hidden subtrees once per snapshot and skip nodes inside
   them, and stop the walk as soon as `out.length >= maxTextLength` (the cap is already passed in).
   **Effect:** removes O(text nodes) forced style/layout work from every `yunti_get_page_snapshot`;
   this is the dominant in-page cost of the light path. **Risk:** medium-low — visibility fidelity of
   `visibleText` changes marginally; no contract in `docs/AGENT_WORKFLOW_CONTRACT.md` or `SKILL.md`
   specifies *how* visible text is filtered (only that it is "lightweight page text",
   `SKILL.md:112`). Keep the element-level `isVisible` for `observe_page` untouched.

4. **Give the `exclusive` lane an escape hatch for calls that already name their target tab.**
   Two equivalent fix points, both minimal:
   (a) bridge side — `mcp/bridge-hub.js:780-842`: the explicit-session branches already fall back to
   `normalizeTabId(session.meta?.tabId)` for non-controller sessions (`:826`, `:838`) but return bare
   `requestedTabId` (i.e. `undefined` for a `browserSessionId`-only call) in the
   controller-routing branch (`:821-829`) and in the no-explicit-route branch (`:897-905`); add the
   same `|| normalizeTabId(session.meta?.tabId)` fallback there so `route.tabId` is populated.
   (b) extension side — `extension/session-manager.js:216-222`: resolve the tab synchronously from
   `sessionsByTab` using `route.browserSessionId` (stable page ids embed the tab,
   `extension/session-manager.js:681-686`) before choosing the lane.
   **Effect:** the documented `browserSessionId`-only workflow stops serializing globally on one lane;
   two tabs progress in parallel as the three-lane comment intends
   (`extension/session-manager.js:205-215`). **Risk:** medium — path (b) must keep `exclusive` as the
   fallback when no tab resolves so `tests/session-manager.test.js:338-388` semantics are preserved;
   path (a) changes a bridge payload field the extension already tolerates as optional.

5. **Bound the `exclusive` lane's backlog and surface it** — `extension/session-manager.js:265-266`.
   Track a counter, and when a tab-addressed request has waited longer than a fraction of
   `deadlineAt - createdAt`, either fail fast (already implemented as an error shape at `:244-246`) or
   log/emit it through the existing `/extension/result` error path. **Effect:** converts silent
   latency into an explicit, contract-compatible error instead of a late `YUNTI_TOOL_TIMEOUT`
   (`mcp/server.js:114-124`). **Risk:** low.

6. **Skip the URL revalidation `tabs.get` on the hot path** —
   `extension/tool-handlers.js:194-202` (`resolveToolPageRoute`). Cache the last validated
   `(tabId, url)` pair per session and only re-`get` when the tab-update listener says the URL
   changed (`extension/background.js:49-55` already sees those events). **Effect:** removes one
   `chrome.tabs.get` per page call for controller sessions. **Risk:** low-medium — staleness window is
   bounded by the tab-update listener, which already triggers `ensureTabRegistered`.

7. **Make `ensureCdpDomains` idempotent under concurrency** —
   `extension/cdp.js:463-471`. Add the domain to the enabled `Set` *before* awaiting the enable
   command (and delete it on failure), or keep a per-tab in-flight promise. **Effect:** prevents the
   §4.4 lost-domain window and duplicate `Page.enable`/`Runtime.enable`/`Log.enable` trips when an
   attach races a detach or two attaches race. **Risk:** low.

8. **Guard the temporary-activation restore per window** —
   `extension/session-manager.js:447-465`. Serialize `injectAfterTemporaryActivation` per `windowId`
   (a small `Map<windowId, Promise>` mirroring `pendingTabRecovery`) and restore only if the tab this
   call activated is still active. **Effect:** removes the §4.3 flicker/wrong-restore race; keeps the
   documented Edge-sleeping-tab behaviour (`docs/AGENT_WORKFLOW_CONTRACT.md:33-36`,
   `SKILL.md:97-100`). **Risk:** low.

9. **Raise the actionability default only when the caller asked for it** —
   `extension/content.js:17-18`, `:807-810`. The 1200 ms default + 100 ms poll is spent *before* the
   dispatcher can return the current rich failure diagnostic (`extension/tool-handlers.js:916-948`),
   which already tells the agent to wait. Reducing the default to ~300 ms and letting
   `yunti_wait_for` own the waiting cuts up to ~1 s off each not-yet-ready selector action.
   **Effect:** faster, more honest failures. **Risk:** medium — changes `waitedMs`/`actionability`
   values asserted in `tests/tool-handlers.test.js:567-618`, `:692-726`; those tests must be updated
   and `SKILL.md:190-192` guidance re-checked. Include only if the contract review accepts it.

10. **Publish the fence-metadata already computed** — `extension/content.js:399-410` /
    `extension/tool-handlers.js:499-504`. `getPageSnapshot` already returns `capturedAt`; the
    dispatcher drops nothing but also exposes no per-call timing. Adding the observed
    `observationId`/`uidMapVersion` to action results and echoing the session's `tabId` would let an
    agent detect the §4.2/§4.6 mismatches instead of guessing. **Effect:** diagnosability, not raw
    speed. **Risk:** very low (additive fields; `SKILL.md:170-173` already treats structured fields as
    additive).

Items 1–5 are the ones that change the numbers in §2/§3; 6–10 are safety/diagnosability with small
latency side-effects. Nothing above requires changing a documented contract field name or the
default loop in `docs/AGENT_WORKFLOW_CONTRACT.md:8-23` / `SKILL.md:14-27`.
