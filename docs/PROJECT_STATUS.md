# Project Status

## P0-P2 Gate And Contract Hardening

The active slice hardens the release gates and the failure contract. It is
additive and does not change the MCP tool count, the extension protocol, or any
existing success result field.

Shipped:

- **Cross-platform release gate.** `scripts/release-check.js` resolves npm's own
  CLI entry point and runs it through `node` instead of spawning a bare `npm`
  command, normalizes path separators before path assertions, and accepts both
  `npm pack --json` output shapes. Before this, the package-contents gate read an
  empty file inventory on npm 10+, and `npm run release:check` could not pass on
  Windows at all.
- **Windows-portable tests.** The learning-memory tests no longer build a
  `file:///tmp/` URL, which threw `ERR_INVALID_FILE_URL_PATH` on Windows. The
  suite is `201 passed / 0 failed / 1 skipped` with the opt-in browser gate
  disabled.
- **The real-browser gate is no longer a no-op.** `tests/e2e.test.js` imported
  `playwright` while the declared dependency is `playwright-core`, so
  `YUNTI_E2E=1 npm run test:e2e` reported `0 pass / 0 fail / 1 skip` and exited
  0. It now resolves `playwright` then `playwright-core`, resolves a browser from
  `YUNTI_E2E_EXECUTABLE_PATH` → Playwright cache → system Chrome/Edge, and fails
  with an explicit diagnosis when none is available. Verified passing against a
  real Chromium extension load.
- **Structured failures survive the transport.** A thrown extension error used to
  collapse to a bare message, losing every machine-readable recovery field.
  `extension/tool-handlers.js` now classifies thrown errors
  (`CONTROLLER_PAGE_ROUTE_REQUIRED`, `EXTENSION_TOOL_TIMEOUT`,
  `CONTENT_SCRIPT_UNAVAILABLE`, `LAST_TAB_CLOSE_BLOCKED`,
  `EXTENSION_TOOL_FAILED`), ships them as a `failure` field, and
  `mcp/bridge-hub.js` + `mcp/server.js` preserve them through
  `code/retryable/retryBudget/recoveryAction/resultUncertain/recoverable/
  recoveryHint/nextStepHint` instead of reporting a generic `YUNTI_TOOL_ERROR`.
- **Snapshot uids are action-ready.** Accessibility nodes carry no geometry, so
  `yunti_take_snapshot` uids previously failed every uid action with
  `UID_COORDINATES_UNAVAILABLE`. The snapshot now resolves viewport rects through
  `DOM.getBoxModel` while the debugger is already attached, translating
  document-space coordinates by the current scroll offset. Nodes without a layout
  box keep no rect and still fail cleanly.
- **Long-poll transport integration tests.** `tests/http-server.test.js` drives
  the real HTTP surface: `/extension/poll`, `/extension/result` (including stale
  request ids and transport mismatch), the three diagnostic event routes,
  `/mcp/request`, `/mcp/local-tool`, `/console/cancel-pending`,
  `/sessions/activate|unregister` ownership, and bridge-token protection.
- **P8.2.4a stable page handle (contract and resolver).** `yunti_list_browser_targets`
  and `yunti_list_pages` now return an opaque `pageHandleId` for every routable
  tab, and page tools accept it as a route. The logical key is the owning browser
  instance plus the live tab identity plus a tab-id reuse generation, so handles
  are unique across Chrome/Edge/profiles and same-numbered tab ids, stable across
  navigation, reload, reinjection, extension reconnect, and Bridge restart, and
  never rebound when Chrome reuses a numeric tab id. Failures are terminal with
  `retryBudget=0`: `YUNTI_PAGE_HANDLE_INVALID`, `YUNTI_PAGE_HANDLE_CLOSED`,
  `YUNTI_PAGE_HANDLE_STALE`, `YUNTI_PAGE_HANDLE_ROUTE_MISMATCH`, and
  `YUNTI_PAGE_HANDLE_UNSUPPORTED_TOOL`. User-facing routing now prefers handles in
  `yunti_get_tool_usage_hints`, the packaged skill, and the Tool Guide.
  Slices b-e (navigation/context replacement, restart recovery, typed lifecycle
  and cancellation, endurance gate) remain open.
- **Status-document sync.** `PUBLISHING_BLOCKERS.md`, `RELEASE.md`,
  `SECURITY.md`, `EXTENSION_DISTRIBUTION.md`, and `NEXT_MAJOR_PLAN.md` no longer
  claim a stale `latest`, a missing `dom-observer.js`, or an `alarms` permission
  gap, and the P6.1.4 / P6.3 / P6.5 statuses match the shipped code. A regression
  test now locks protocol and version identity across the runtime, the extension,
  `doctor`, the manifest, and the published tool surface.

## 0.2.7 Page UI Hotfix

`0.2.7` is an urgent hotfix based directly on published `0.2.6`. It removes
the injected `AI` floating button and connection panel from normal pages while
preserving controller registration, MCP operations, the extension popup,
Content Script actions, and CDP. See [RELEASE_0_2_7.md](RELEASE_0_2_7.md).

## 0.2.6 Dynamic Page Reliability

`0.2.6` is the active reliability release. Its implementation and acceptance
record is documented in [RELEASE_0_2_6.md](RELEASE_0_2_6.md).

Current status:

- runtime/extension protocol and live-version fail-fast: implemented
- `doctor` mismatch failure and zero-retry guidance: implemented and validated
  against the currently running `0.2.2` browser extension
- Chrome/Edge/profile controller coexistence: implemented
- page ownership and same-tab-id cross-browser isolation: implemented
- multi-browser target inventory aggregation: implemented
- running Bridge proxy-version fail-fast: implemented and validated against a
  simulated older Bridge plus the live local `0.2.4` Bridge
- structured MCP retry budget and uncertainty contract: implemented
- packaged skill and user-facing recovery guidance: updated
- automated regression: 184 total tests, 183 passed, 1 opt-in browser smoke
  skipped by default, 0 failed
- full `npm run release:check`: passing; package contains 65 files and extension
  zip contains 13 files
- real Chromium extension E2E: passing
- real Microsoft Edge extension E2E: passing
- simultaneous Chromium + Edge controller/target aggregation E2E: passing
- P8 benchmark expansion candidate: 38/38 scenarios pass across 114 attempts
  and 397 MCP calls, including 20 runs for each guarded-write scenario,
  duplicate writes 0, attempt p50/p95/max 520/1501/1523 ms, and tool-call
  p50/p95/max 9/435/1406 ms on the `0.2.6` release tree in
  `.artifacts/benchmark/2026-07-22T06-24-26-684Z/`
- qualifying Microsoft Edge soak candidate: 900.168 seconds, 840 continuous
  cycles, 22,410/22,410 successful calls, 52/52 MCP tools, 840 stale-route
  recoveries, 281 child tabs, 211 CDP detach/reattach recoveries, duplicate
  writes 0, and call p50/p95/p99/max 4/213/413/956 ms in
  `.artifacts/soak-edge-15m-optimized/2026-07-22T05-58-11-786Z/`
- exact `0.2.6` tree Edge overload diagnostic: 901 seconds, 422 cycles,
  11,288/11,288 successful calls, 52/52 tools, 422 stale recoveries, duplicate
  writes 0, and p50/p95/p99/max 5/321/682/25122 ms. The max budget failed while
  host load average reached 115 under unrelated concurrent compilation; this
  run is retained as functional soak evidence, not as the latency qualifier
- reusable post-installation endurance procedure: complete in
  [SOAK_TEST.md](SOAK_TEST.md)

`yunti-browser-runtime@0.2.5` was published to the official npm registry with
the `latest` dist-tag on 2026-07-22. Post-publication verification passed for
the package name, version, repository, homepage, issues URL, and registry
tarball.

`yunti-browser-runtime@0.2.6` was published to the official npm registry with
the `latest` dist-tag on 2026-07-22. Post-publication verification passed for
the package name, version, repository, homepage, issues URL, and registry
tarball; the published integrity is
`sha512-4uCX1kdIyphV1ykBTkQuYOzZDon7sdB5G/O2ZIdOo1zOumZRX2OsMqK3SjpujZH5LfHbJFFuf8QyRpaTMTqorA==`.

## Current Phase

Post-`0.2.3` planning is now organized as Phase 8 in
[COMPETITOR_RESEARCH_2026.md](COMPETITOR_RESEARCH_2026.md). Alibaba Page Agent
and browser-use are the primary references. Projects without current
maintenance are excluded from prioritization; other active tools are retained
only as narrow supporting evidence.

P8 status:

- P8 research and code-gap audit: complete
- P8.0 reliability benchmark contract: complete in
  [RELIABILITY_BENCHMARK_PLAN.md](RELIABILITY_BENCHMARK_PLAN.md)
- P8.0 benchmark foundation: complete with fixture pages, scenario manifest,
  runner entry, npm scripts, and validation tests
- P8.0 full 38-scenario benchmark matrix: complete locally with all 23
  previously planned scenarios implemented and all four guarded-write scenarios
  retaining 20 repetitions
- P8.0 metric v2: complete; attempt, tool-call, and scenario-total latency are
  reported separately so repeated guarded writes cannot distort operational p95
- P8.0 full-tool browser endurance fixture and 15-minute soak runner: complete
- P8.0 first full `0.2.3` benchmark capture: complete with 15/15 implemented
  benchmark scenarios passing, duplicate writes at 0, p50 duration 112 ms, and
  p95 duration 10227 ms in
  `.artifacts/benchmark/2026-07-19T05-33-41-631Z/`
- P8.1.1 targeted `yunti_find_elements` observation path: complete
- P8.1.2 open shadow-root observation/find coverage: complete
- P8.1.3 same-origin iframe observation/find coverage: complete
- P8.1.4 lighter observation delta verification path: complete
- P8.2.1 selector-path bounded actionability and auto-wait: complete
- P8.2.2 deep wait, fresh observation-scoped uids, and open-shadow coordinate
  action routing: complete locally and covered by the 38-scenario benchmark
- P8.2.3 Edge latency acceptance: complete locally with p95 <= 500 ms and
  max <= 10 seconds enforced by the soak runner; the qualifying run measured
  213 ms p95 and 956 ms max
- P8.2.4 stable page handle: plan complete; next implementation slice is the
  additive `pageHandleId` contract and shared route resolver in
  [STABLE_PAGE_HANDLE_PLAN.md](STABLE_PAGE_HANDLE_PLAN.md)
- Post-0.2.3 Edge sleeping-tab/session recovery hotfix: complete locally and
  validated against Microsoft Edge 150
- P8.2 remaining stable page handle, typed lifecycle, and cancellation: stable
  handle is the next priority; implementation has not started
- P8.3 validated semantic target recipes and self-healing: planned
- P8.4 persistent history, sanitized trajectories, and failure replay: planned
- P8.5 trust boundary and hostile-page fixtures: planned
- P8.6 capability profiles and extension update path: planned
- P8.7 optional remote provider adapter: deferred until local reliability gains
  are measured
- P8.8 DevTools insight packs: deferred behind normal page-operation quality

P8 runtime behavior has now started moving in small, benchmarked slices. The
first reproducible `0.2.3` baseline is captured, and Observation v2 now
includes targeted `yunti_find_elements`, open shadow-root coverage,
same-origin iframe coverage, and an additive `responseMode: "delta"` path for
lighter repeated verification. Delta mode returns page/scroll change summaries
and bounded changed-entry metadata without replacing the normal full observe
path or its actionable uid map.

The first P8.2 slice is now in place for selector-driven actions: content-script
selector paths for click, hover, fill, type, press, and select now share a
bounded readiness wait plus unified actionability checks for presence,
visibility, enabled/editable state, tag expectations, and receives-events
behavior. Structured selector failures now tell agents to wait before retrying
when the target exists but is not yet ready.

The 2026-07-20 Edge stability investigation confirmed a browser-specific
failure that did not reproduce in Chrome 150. On Edge 150, probing an existing
sleeping tab with `chrome.tabs.sendMessage` or injecting into it can remain
pending instead of rejecting promptly. The controller poll loop previously
awaited that tool execution, so one sleeping tab could block the only poller;
recovery alarms refreshed controller metadata but refused to replace the
apparently existing poller, and Bridge eventually reported the session stale.

The local hotfix now bounds content-script probe and injection time, keeps
controller polling independent from the serialized tool execution queue,
returns a bounded extension-side timeout instead of hanging forever, and uses a
poll-progress watchdog to replace stalled pollers. When Edge blocks background
injection into a sleeping tab, Yunti temporarily activates that tab, injects
the packaged scripts, and restores the previously active tab without reloading
the page. Observe responses are normalized with the authoritative recovered
page session id even when the newly injected content script still reports its
pre-registration null id.

Real Edge evidence: with 21 pre-existing tabs and zero registered page
sessions, `yunti_list_browser_targets` discovered all 21 without a page refresh.
Before the hotfix, observing sleeping tab `1542219058` timed out twice at 25-30
seconds and left the controller poll blocked. After the hotfix, the same tab
recovered and returned 12 elements in 3288 ms. A page session recorded before
an extension reload was then reused after the reload while the page was in the
background; the old session id recovered in 3284 ms and returned 28 elements,
again without a page refresh. Chrome remained unaffected throughout the user
comparison.

Release `yunti-browser-runtime@0.2.3` is complete and verified on the official
npm registry. It fixes page-session expiry under many open tabs, completes
controller-driven page recovery, and restores CDP as a first-class backend.

Current implementation focus: one `browser_controller` long-poll transport per
extension/browser instead of one long poll per page. Page sessions are metadata
bound to live `tabId` values; controller inventory heartbeats renew metadata for
tabs that still exist and remove closed-tab routes. Page tools route through the
controller, then resolve/inject the intended content-script page by page session,
`tabId`, `targetId`, a legacy session id containing the tab id, or the active tab.
Content-script actions and CDP are now documented as complementary first-class
backends. Fresh-uid actions remain available without attaching the debugger, but
agents are no longer told to reserve CDP for exceptional cases. They should use
CDP whenever it improves targeting, input, observation, control, or verification;
the Chrome debugger banner is informational rather than a product restriction.

Post-0.2 planning remains active after this patch.
P6.6.1 browser extension distribution readiness, P6.6.2 store-facing
permission/privacy copy, and P6.6.3 pre-store permission strategy decision are
complete; P6.5 optional local runtime console is complete through real-browser
validation. P6.6.4 store-candidate permission UX design is deferred to the
post-0.2 store-candidate track.

Active slice status: `0.2.3` single-controller transport is released and fully
validated. The confirmed `0.2.2` failure
mode was 25-second per-page long polling competing for the browser's per-origin
HTTP connection pool while Bridge expired sessions after 90 seconds. Live
diagnosis reproduced 28 visible page sessions dropping to 14 while tabs stayed
open, and a controller-routed inventory request timing out. `0.2.3` removes page
pollers, adds stable page ids, separates logical page routing from controller
transport, and recovers content scripts on demand. Manual refresh remains a last
resort only for browser-enforced injection limits.

Acceptance for this slice:

- Keep exactly one controller polling channel regardless of open tab count.
- Keep observe/click/fill content-script based while transporting requests
  through the controller and resolving the concrete tab on demand.
- Recover legacy stale page ids, controller-only state, and absent page sessions
  without asking the user to refresh.
- Return real page session ids (or null) from target inventory; never present the
  controller id as a page id.
- Reconcile live tab ids, deduplicate replacement sessions, and unregister
  closed-tab routes.
- Keep the content-script observe/action path non-CDP by default.
- Treat CDP as an unrestricted first-class backend and select it whenever it is
  the more reliable way to complete or verify a browser task.
- Update README, install guide, skill, Tool Guide, and usage hints so agents no
  longer tell users to refresh as the default post-install step.
- Doctor/no-session guidance should distinguish controller online vs page
  session missing and mention manual refresh only as a fallback.
- Verify with unit tests, release checks, and real-browser E2E if browser
  behavior changes.

Latest post-`0.2.3` validation: targeted bridge/session-manager/tool dispatcher tests
pass, including 30-page zero-page-poller coverage, stale legacy id recovery,
controller-only active-tab recovery, closed-tab reconciliation, controller
startup race prevention, aborted-poller cleanup, and controller transport
dispatch, Edge hanging-message probe timeout, sleeping-tab temporary activation,
stalled-poller replacement, and controller polling during a hung tool. The
latest local `npm test` run covers 169 node:test cases: 168 passed, 1 default
real-browser smoke was skipped, and 0 failed. `npm run check` and `git diff
--check` pass. The last published `0.2.3` release gate passed package contents validation
with 49 files and extension zip validation with 13 files. A separate
`YUNTI_E2E=1 npm run test:e2e` run passes the real-browser smoke, including the
single-controller poller invariants and repeated page operations. `git diff
--check` passes and the npm token residue scan returns no matches.
Official registry verification confirms `version=0.2.3`, `latest=0.2.3`, and a
valid public tarball containing 49 expected files.

Latest visible 0.2.0 phase split:

- P6.1.1 completed: `yunti_observe_page` schema, tool hints, and bridge
  routing.
- P6.1.2 completed: content-script DOM observer, compact text tree, field
  state hints, scroll metadata, and minimum redaction.
- P6.1.3 completed: fresh observe uids feed existing click/hover/fill uid
  actions while preserving the snapshot compatibility path.
- P6.1.4 completed: real-browser `observe -> click uid -> observe/verify`
  closure validation passed with the local `pytest-playwright` environment
  plus temporary Node Playwright 1.58.0.
- P6.2.1 completed: additive structured action result contract and main action
  path coverage.
- P6.2.2 completed: `yunti_select` uid/selector/value/text semantics and
  structured failure diagnostics.
- P6.2.3 completed: `yunti_fill` / `yunti_fill_form` field-state,
  contenteditable, failure aggregation, and post-fill value retention
  diagnostics.
- P6.2.4 completed: `yunti_scroll` uid, coordinate, no-movement, partial
  movement, missing-target, and document-fallback diagnostics.
- P6.2.5 completed: async UI recovery guidance for
  `yunti_wait_for -> yunti_observe_page -> fresh uid`.
- P6.2.6 completed: `yunti_wait_for` now preserves compatibility fields such
  as `found`, `text`, `selector`, `condition`, `value`, and `waitedMs` while
  adding `action: "wait_for"`, `target`, `ok`, `recoverable`, `nextStepHint`,
  and timeout diagnostics with `code: "WAIT_TIMEOUT"` plus `recoveryHint`.
- P6.2.7 completed: structured action result coverage is now captured in
  `docs/ACTION_RESULT_COVERAGE.md` and checked by
  `npm run check:action-results`, which is part of `npm run release:check`.
- P6.3.1 completed: `docs/AGENT_WORKFLOW_CONTRACT.md`,
  `yunti_get_tool_usage_hints` workflow hints, Tool Guide, and the packaged
  skill now share the same default agent workflow contract and copyable prompt.
- P6.3.2 completed: Tool Guide, packaged skill, and `yunti_get_tool_usage_hints`
  now expose minimal workflows for click, form fill, scroll-to-find, tab
  switching, and async wait.
- P6.4.1 completed: strict DOM redaction now covers page title, labels, names,
  visible text, placeholders, value previews, select selected value/text,
  option value/text, scrollable container names, and likely email, phone,
  Luhn-valid payment-card-like, and address-like content while keeping balanced
  credential-like protection as the default.
- P6.4.2 completed: shared MCP redaction now sanitizes likely Bearer tokens,
  JWTs, private keys, long token-like values, emails, phones, Luhn-valid
  payment-card-like values, and address-like text before learning memory writes
  and console diagnostic caching.
- P6.4.3 completed: raw CDP and screenshot tools now expose explicit guidance
  for non-default-redaction diagnostics, sanitized-tool preference, scope
  minimization, safe summarization, and CDP cleanup.
- P6.5.1 completed: optional local runtime console minimum loop. The bridge now
  serves `/console`, `/console/state`, and `/console/cancel-pending`; the CLI
  exposes `yunti-browser-runtime console`; state uses sanitized summaries by
  default and remains protected when bridge auth is enabled.
- P6.5.2 completed: local console diagnostic polish now includes `HEAD
  /console`, runtime/expected-extension/session-extension version summaries,
  extension version mismatch warnings, visible warning cards, doctor console URL
  output, and stronger no-page recovery guidance.
- P6.5.3 completed: real-browser console validation now checks `HEAD
  /console`, `/console`, `/console/state`, runtime/extension version alignment,
  connected page state, and absence of no-page or version-mismatch warnings in
  the opt-in Playwright extension smoke.
- P6.6.1 completed: browser extension distribution readiness audit and public
  doc links.
- P6.6.2 completed: store-facing permission and privacy copy.
- P6.6.3 completed: pre-store permission strategy decision.
- P6.6.4 deferred: store-candidate permission UX design.
- P7.1 completed: `0.2.0` npm/unpacked release closure and npm publication.

Latest detailed P6.2 status:

- Completed: action result main-path coverage, `yunti_select`
  selector/value + uid/value + uid/text, select uid/selector failure
  diagnostics, contenteditable fill, selector/uid fill failure diagnostics,
  `yunti_fill_form` aggregation diagnostics, uid scroll, and scroll
  no-movement recovery diagnostics.
- Completed: uid/selector fill diagnostics for non-editable, hidden, disabled,
  or readonly targets while preserving existing successful fill/select/scroll
  behavior and compatibility fields.
- Completed: uid fill post-value verification for keyboard/contenteditable
  paths. When the value does not remain, `yunti_fill` returns
  `VALUE_NOT_APPLIED` with length-only diagnostics and recovery guidance instead
  of echoing the raw field value.
- Completed: scroll partial-movement diagnostics. When a scroll moves less than
  requested, results keep `ok: true` and include `partialMovement` with
  requested/actual deltas, affected axes, `edgeHint`, and
  `decision: "observe-before-continuing-scroll"`.
- Completed: uid scroll missing/stale target diagnostics. When a scroll uid
  cannot be resolved, `yunti_scroll` returns `scrolled: false`,
  `UID_NOT_FOUND` or `UID_COORDINATES_UNAVAILABLE`, and recovery guidance to
  refresh observation before retrying.
- Completed: coordinate scroll hit/fallback diagnostics. When `x` / `y` is
  provided, `yunti_scroll` can report `coordinateTarget`,
  `scrollContainerFound`, and `coordinateScrollFallback: "document"` so agents
  can detect document fallback instead of assuming a nested panel moved.
- Completed: coordinate scroll document fallback recovery hints. Successful
  document-fallback scrolls keep `ok: true` but can include
  `coordinateFallbackHint` and a clearer `nextStepHint` pointing agents back to
  `yunti_observe_page` and fresh `scrollableContainers[]` uids.
- Completed: wait-observe recovery guidance for async UI transitions. Tool
  usage hints, Tool Guide, and the packaged skill now tell agents to use
  `yunti_wait_for`, then `yunti_observe_page`, then fresh uids for async
  fill/select/scroll recovery instead of reusing old targets.
- Completed: structured `yunti_wait_for` results. Successful waits now include
  `action: "wait_for"`, `target`, `ok: true`, `recoverable: false`, and
  `nextStepHint`; timeout waits return `found: false`, `ok: false`,
  `recoverable: true`, `code: "WAIT_TIMEOUT"`, `recoveryHint`, and
  `nextStepHint`.
- Latest P6.2.6 validation: `git diff --check` passed; token residue grep
  returned no matches; `node --test tests/tool-handlers.test.js` passed 42
  tests; `node --test tests/bridge.test.js` passed 66 tests; `YUNTI_E2E=1 npm
  run test:e2e` skipped because Playwright/Chromium is not installed in the
  current environment; `npm run release:check` passed with 116 node:test cases
  total, 115 passing and 1 default real-browser smoke skipped, plus npm package
  and extension zip content checks.
- Completed: `yunti_observe_page` field-state hints, select selected-option
  hints, select `options[]` summaries, and structured disabled-option
  diagnostics for `yunti_select`.
- Completed: P6.2.7 coverage audit gate. `docs/ACTION_RESULT_COVERAGE.md`
  now records the 11 core action surfaces and their success paths, failure
  diagnostics, preserved compatibility fields, and remaining real-browser
  validation notes. `scripts/check-action-result-coverage.js` validates the
  matrix and is exposed as `npm run check:action-results`.
- Latest P6.2.7 validation: `npm run check:action-results` passed with 11
  coverage rows; `npm run check` passed; `git diff --check` passed; token
  residue grep returned no matches; `YUNTI_E2E=1 npm run test:e2e` skipped
  because Playwright/Chromium is not installed in the current environment;
  `npm run release:check` passed with 116 node:test cases total, 115 passing
  and 1 default real-browser smoke skipped, plus npm package contents
  validation with 44 files and extension zip contents validation with 13 files.
- Completed: P6.3.1 agent workflow contract. `docs/AGENT_WORKFLOW_CONTRACT.md`
  records the default browser operation loop, recovery rules, confirmation
  boundary, copyable prompt, and non-goals. `yunti_get_tool_usage_hints` now
  accepts `topic: "workflow"` and returns `defaultPageOperation`,
  `confirmationBoundary`, and `copyableAgentPrompt`. Tool Guide and packaged
  skill now include the same default page operation contract.
- Latest P6.3.1 validation: `node --test tests/bridge.test.js` passed 67
  tests; `git diff --check` passed; token residue grep returned no matches;
  `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium is not
  installed in the current environment; `npm run release:check` passed with
  117 node:test cases total, 116 passing and 1 default real-browser smoke
  skipped, plus npm package contents validation with 45 files and extension zip
  contents validation with 13 files.
- Next: implement P6.3.2 minimal use cases in Tool Guide and skill, or close
  P6.1.4 first if Playwright/Chromium is available for real-browser closure.
- Completed: P6.3.2 minimal use cases. Tool Guide and packaged skill now cover
  Click, Fill Form, Scroll To Find, Switch Tab, and Wait For Async Result.
  `yunti_get_tool_usage_hints` now returns matching `minimalUseCases` under
  the `workflow` topic, and bridge tests lock the five keys plus critical
  guidance such as fresh observation, field state, `scrollableContainers[]`,
  `Target.activateTarget`, and `WAIT_TIMEOUT`.
- Latest P6.3.2 validation: `node --test tests/bridge.test.js` passed 68
  tests; `git diff --check` passed; token residue grep returned no matches;
  `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium is not
  installed in the current environment; `npm run release:check` passed with
  118 node:test cases total, 117 passing and 1 default real-browser smoke
  skipped, plus npm package contents validation with 45 files and extension zip
  contents validation with 13 files.
- Completed: P6.4.1 DOM redaction policy deepening. `strict` mode now redacts
  PII-like text surfaces in `yunti_observe_page`, including page title, labels,
  names, visible text, placeholders, value previews, select selected value/text,
  option value/text, scrollable container names, email, phone, Luhn-valid
  payment-card-like values, and address-like text. `balanced` remains the
  default credential-like protection mode; `off` remains explicit local
  debugging only.
- Latest P6.4.1 validation: `node --check extension/dom-observer.js` passed;
  `node --test tests/dom-observer.test.js` passed 6 tests covering strict PII
  categories, select option text redaction, page title redaction, and balanced
  ordinary business text behavior; `node --test tests/bridge.test.js` passed 68
  tests; `git diff --check` passed; token residue grep returned no matches;
  `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium is not
  installed in the current environment; `npm run release:check` passed with
  119 node:test cases total, 118 passing and 1 default real-browser smoke
  skipped, plus npm package contents validation with 45 files and extension zip
  contents validation with 13 files.
- Completed: P6.4.2 learning memory / diagnostic artifacts secret-boundary
  tightening. `mcp/redaction.js` now provides shared likely-sensitive text
  sanitization for Bearer tokens, JWTs, private keys, long token-like values,
  emails, phones, Luhn-valid payment-card-like values, and address-like text.
  `yunti_remember_learning` sanitizes title, detail, tags, and source before
  disk writes. Console diagnostics sanitize text, stackTrace, and args before
  caching. Raw CDP events intentionally remain raw low-level diagnostics and
  are documented as an explicit exception to clear after debugging.
- Latest P6.4.2 validation: `node --check mcp/redaction.js`,
  `node --check mcp/memory.js`, and `node --check mcp/bridge-hub.js` passed;
  `node --test tests/bridge.test.js` passed 70 tests, including new memory and
  console redaction coverage; `git diff --check` passed; token residue grep
  returned no matches; `npm run check` passed; `npm test` passed with 121
  node:test cases total, 120 passing and 1 default real-browser smoke skipped;
  `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium is not
  installed in the current environment; `npm run release:check` passed, plus npm
  package contents validation with 45 files and extension zip contents validation
  with 13 files.
- Completed: P6.4.3 raw CDP / screenshot non-redaction diagnostic guidance and
  cleanup boundaries. Tool descriptions, `yunti_get_tool_usage_hints`, Tool
  Guide, packaged skill, and Security docs now tell agents to prefer sanitized
  diagnostics, use raw CDP only for low-level debugging, filter by `method` and
  `limit`, clear with `yunti_clear_cdp_events`, treat screenshots as real
  visible pixels outside DOM redaction, prefer viewport screenshots when enough,
  and summarize safe findings instead of storing raw payloads or images.
- Latest P6.4.3 validation: `node --check mcp/tools.js` passed;
  `node --test tests/bridge.test.js` passed 71 tests, including new raw CDP and
  screenshot safety-boundary usage hints coverage; `git diff --check` passed;
  token residue grep returned no matches; `npm run check` passed; `npm test`
  passed with 122 node:test cases total, 121 passing and 1 default real-browser
  smoke skipped; `YUNTI_E2E=1 npm run test:e2e` skipped because
  Playwright/Chromium is not installed in the current environment;
  `npm run release:check` passed, plus npm package contents validation with 45
  files and extension zip contents validation with 13 files.
- Completed: P6.1.4 real-browser closure validation. The local
  `/opt/miniconda3/envs/pytest-playwright` environment provides Python
  Playwright 1.58.0 and existing browser caches; the Node E2E still needs the
  Node `playwright` package, so validation used temporary `npm install --no-save
  --package-lock=false playwright@1.58.0` with
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` and without changing package metadata.
  `YUNTI_E2E=1 npm run test:e2e` then passed the real browser extension bridge
  smoke with `observe -> click uid -> verify`. Final validation for this status
  update: `git diff --check` passed; token residue grep returned no matches;
  `npm run check` passed; `npm test` passed with 122 node:test cases total,
  121 passing and 1 default real-browser smoke skipped; `YUNTI_E2E=1 npm run
  test:e2e` passed with 1 real-browser smoke test; `npm run release:check`
  passed, plus npm package contents validation with 45 files and extension zip
  contents validation with 13 files.
- Completed: P6.5.1 optional local runtime console minimum loop. `mcp/http-server.js`
  now serves an optional `/console` page, protected `/console/state` JSON, and
  protected `/console/cancel-pending` action. `BridgeHub` tracks sanitized
  recent activity, summarizes connected sessions without raw secrets, exposes
  pending/queued request counts, and can cancel runtime requests that are still
  queued or waiting for browser results. `bin/yunti-browser-runtime.js` and
  `package.json` now expose a `console` command that starts the bridge and
  prints the local console URL.
- Latest P6.5.1 validation: `git diff --check` passed; token residue grep
  returned no matches; `npm run check` passed; `npm test` passed with 125
  node:test cases total, 124 passing and 1 default real-browser smoke skipped;
  `YUNTI_E2E=1 npm run test:e2e` passed with 1 real-browser smoke test;
  `npm run release:check` passed, including 11 action-result coverage rows, npm
  package contents validation with 45 files, and extension zip contents
  validation with 13 files.
- Completed: P6.5.2 local console diagnostic polish. Extension sessions now
  report `client.extensionVersion`; console state reports runtime and expected
  extension versions, session extension versions, and warning entries for no
  connected pages, unknown extension version, or mismatched extension/runtime
  versions. The `/console` route now supports `HEAD` for simple probes, the
  console UI renders warning cards and version metadata, and `doctor` JSON plus
  human summary now include the optional console URL.
- Latest P6.5.2 validation: `git diff --check` passed; token residue grep
  returned no matches; `npm run check` passed; `npm test` passed with 126
  node:test cases total, 125 passing and 1 default real-browser smoke skipped;
  `YUNTI_E2E=1 npm run test:e2e` passed with 1 real-browser smoke test;
  `npm run release:check` passed, including 11 action-result coverage rows, npm
  package contents validation with 45 files, and extension zip contents
  validation with 13 files.
- Completed: P6.5.3 real-browser console validation. `tests/e2e.test.js` now
  verifies the optional local console against a real Playwright-loaded
  extension session: `HEAD /console` returns HTML, `/console` renders the page,
  `/console/state` includes runtime and expected extension versions, the
  connected session reports the current extension version, and no
  `NO_CONNECTED_PAGES` or `EXTENSION_VERSION_MISMATCH` warning appears after a
  real page registers.
- Latest P6.5.3 validation: `git diff --check` passed; token residue grep
  returned no matches; `npm run check` passed; `npm test` passed with 126
  node:test cases total, 125 passing and 1 default real-browser smoke skipped;
  `YUNTI_E2E=1 npm run test:e2e` passed with 1 real-browser smoke test;
  `npm run release:check` passed, including 11 action-result coverage rows, npm
  package contents validation with 45 files, and extension zip contents
  validation with 13 files.
- Completed: P6.6.1 browser extension distribution readiness. Added
  `docs/EXTENSION_DISTRIBUTION.md` with the current manifest permission audit,
  Chrome Web Store / Edge Add-ons policy references, submission checklist,
  privacy disclosure topics, and permission narrowing options. Linked it from
  README, Security notes, and Roadmap.
- Latest P6.6.1 validation: `git diff --check` passed; token residue grep
  returned no matches; `npm run check` passed; `npm test` passed with 126
  node:test cases total, 125 passing and 1 default real-browser smoke skipped;
  `YUNTI_E2E=1 npm run test:e2e` passed with 1 real-browser smoke in the local
  `pytest-playwright` environment; `npm run release:check` passed, including
  public documentation residue checks, public Markdown link checks for 15 files,
  11 action-result coverage rows, npm package contents validation with 46
  files, and extension zip contents validation with 13 files.
- Completed: P6.6.2 store-facing permission and privacy copy. Added
  `docs/EXTENSION_STORE_COPY.md` with draft short and long descriptions,
  permission rationale, privacy-policy language, store data disclosure guidance,
  reviewer notes, local bridge dependency notes, and final review checklist.
- Latest P6.6.2 validation: `git diff --check` passed; token residue grep
  returned no matches; `npm run check` passed; `npm test` passed with 126
  node:test cases total, 125 passing and 1 default real-browser smoke skipped;
  `YUNTI_E2E=1 npm run test:e2e` passed with 1 real-browser smoke in the local
  `pytest-playwright` environment; `npm run release:check` passed, including
  public documentation residue checks, public Markdown link checks for 16 files,
  11 action-result coverage rows, npm package contents validation with 47
  files, and extension zip contents validation with 13 files.
- Completed: P6.6.3 pre-store permission strategy decision. Added
  `docs/EXTENSION_PERMISSION_STRATEGY.md`, keeping the current npm/unpacked
  developer path unchanged, deciding that the current broad-permission manifest
  should not be submitted to browser stores unchanged by default, and defining a
  future store-candidate track for optional host access and optional network
  diagnostics.
- Latest P6.6.3 validation: `git diff --check` passed; token residue grep
  returned no matches; `npm run check` passed; `npm test` passed with 126
  node:test cases total, 125 passing and 1 default real-browser smoke skipped;
  `YUNTI_E2E=1 npm run test:e2e` passed with 1 real-browser smoke in the local
  `pytest-playwright` environment; `npm run release:check` passed, including
  public documentation residue checks, public Markdown link checks for 17 files,
  11 action-result coverage rows, npm package contents validation with 48
  files, and extension zip contents validation with 13 files.
- P7.1 completed: package and extension versions are both `0.2.0`; metadata,
  release, dry-run, publish, and post-publish verification gates passed.
  `npm run release:publish` published `yunti-browser-runtime@0.2.0` to the
  official npm registry, and `npm run release:verify-published` verified the
  published package metadata and tarball URL.

## Current State

- Project directory created.
- Project intent, install, tool, security, roadmap, and status docs exist.
- Local-first architecture selected.
- MCP server, local bridge, extension, runtime path helper, doctor command, and
  bridge tests have been extracted.
- A distributable agent skill exists at
  `skills/yunti-browser-runtime/SKILL.md`.
- README is Chinese-first and includes browser extension setup, MCP registration,
  and agent skill installation steps.
- A staged execution plan exists at `docs/EXECUTION_PLAN.md`.
- Tool prefix is `yunti_*`.
- MCP local mode defaults to `userId=local`.
- Local loopback bridge HTTP routes do not require a token by default; setting
  `YUNTI_BROWSER_BRIDGE_TOKEN` re-enables `x-yunti-browser-token` checks.
- Binding the bridge to a non-loopback host requires
  `YUNTI_BROWSER_BRIDGE_TOKEN`.
- Bridge CORS now echoes only local debug origins and browser extension origins
  by default, with `YUNTI_BROWSER_BRIDGE_ALLOW_ORIGINS` as an override.
- Extension popup can save the local bridge URL, optional token, and page match
  patterns.
- Browser sessions now track `lastSeenAt`, `lastActivatedAt`, `expiresAt`, and
  `staleReason`; extension polling refreshes heartbeat and expired sessions are
  cleaned up with recovery guidance.
- `npm run doctor` now checks Node version, bridge reachability, auth mode,
  registered sessions, active session, extension presence, MCP server path, and
  skill path; it emits JSON plus a human-readable summary.
- `npm run print-config` prints MCP configuration for Codex, Claude Code,
  Cursor, and Cline, including project paths, bridge port, token guidance, and
  skill installation hints.
- `npm run package:extension` writes a minimal extension zip to `dist/` with
  only extension runtime files.
- `npm run release:dry-run` and `npm run release:publish` pin the official npm
  registry at `https://registry.npmjs.org/`, avoiding accidental publication to
  a locally configured mirror registry.
- `yunti-browser-runtime@0.2.0` is published on the official npm registry.
- Extension popup is a zero-config status panel by default; Bridge URL, page
  matching, and optional Bridge Token stay under advanced settings.
- `npm run test:e2e` provides an opt-in real-browser Playwright smoke test for
  extension loading, page registration, MCP target listing, snapshot, click/fill,
  and CDP `Runtime.evaluate`.
- Package metadata now includes bin, files, repository, keywords, homepage,
  bugs, and packageManager fields. The `yunti-browser-runtime` CLI routes
  `mcp`, `bridge`, `doctor`, `print-config`, and `package-extension`.
- MCP tool schemas and usage hints have been split into `mcp/tools.js` so
  `mcp/server.js` is focused on bridge, routing, and JSON-RPC behavior.
- MCP JSON-RPC response wrappers, redaction/event normalization helpers, and
  learning memory storage have been split into `mcp/json-rpc.js`,
  `mcp/redaction.js`, and `mcp/memory.js`.
- MCP session hub, request queueing, network/CDP/console event caches, and
  bridge-local tool routing have been split into `mcp/bridge-hub.js`, while
  `mcp/server.js` keeps compatibility re-exports.
- MCP HTTP bridge server, CORS/token checks, route handlers, and body parsing
  have been split into `mcp/http-server.js`, while `mcp/server.js` keeps
  compatibility re-exports.
- Extension settings/page matching and network monitoring have been split into
  `extension/settings.js` and `extension/network-monitor.js`, and the extension
  package script includes those module files.
- Extension CDP target routing, debugger attach/detach, and tracing helpers
  have been split into `extension/cdp.js`, and the extension package script
  includes the module file.
- Extension session registration, polling, popup state, bridge posting, and
  console event forwarding have been split into `extension/session-manager.js`,
  and the extension package script includes the module file.
- Extension tool dispatch and page operation handlers have been split into
  `extension/tool-handlers.js`, and the extension package script includes the
  module file.
- P3.2 tool argument validation is complete for `yunti_click`, `yunti_hover`,
  `yunti_fill`, `yunti_close_page`, `yunti_cdp_send_command`, and
  `yunti_forget_learning_memory`, with recovery-oriented errors and updated
  usage hints.
- `docs/TOOL_GUIDE.md` and `skills/yunti-browser-runtime/SKILL.md` now document
  the common P3.2 parameter rules.
- README and INSTALL now include P3.2 parameter recovery guidance.
- SECURITY now documents `storage` permission usage and broad host permission
  rationale for the local-first extension.
- INSTALL now includes Codex, Claude Code, Cursor, and Cline MCP setup examples
  based on `npm run print-config`.
- Extension registers all `http` and `https` pages by default.
- Product-specific fixed conversation, workspace, and side-panel entry points
  have been removed from the standalone extension.
- The next major execution plan is captured in `docs/NEXT_MAJOR_PLAN.md`.
- P6.1 observe/action compatibility has started: `yunti_observe_page` now has an
  MCP tool schema, observe-first usage hints, bridge routing contract tests, a
  content-script DOM observer, focused DOM observer tests, and an opt-in
  real-browser smoke assertion. Fresh observe uids now feed the existing
  click/hover/fill uid resolver while preserving the `yunti_take_snapshot`
  compatibility path.
- Latest P6.1 observe/action validation: `git diff --check` passed,
  `npm run release:check` passed with 69 passing node:test cases and 1 skipped
  real-browser smoke by default, and `YUNTI_E2E=1 npm run test:e2e` skipped
  because Playwright/Chromium is not installed in the current environment.
- Deterministic observe fixtures now cover hidden/offscreen target handling and
  redaction edge modes in addition to fresh uid, text tree, scroll metadata,
  balanced redaction, and stale uid replacement.
- `docs/EXECUTION_PLAN.md` now includes a P6.1 real-browser closure runbook for
  the remaining `observe -> click uid -> observe/verify` validation gap.
- P6.2 preparation has started with tool usage action recovery guidance for
  click/hover/fill, without changing the runtime action implementation.
- Latest P6.2 preparation validation: `git diff --check` passed,
  `node --test tests/bridge.test.js` passed 63 tests, `npm run release:check`
  passed with 70 passing node:test cases and 1 skipped real-browser smoke by
  default, `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium is
  not installed in the current environment, and the token residue grep returned
  no matches.
- P6.2 action result contract guidance now distinguishes current
  compatibility-shaped action returns from the additive target contract for
  `action`, `target`, `ok`, `code`, `recoverable`, `nextStepHint`, and
  before/after summaries.
- Latest P6.2 action result contract validation: `git diff --check` passed,
  `node --test tests/bridge.test.js` passed 64 tests, `npm run release:check`
  passed with 71 passing node:test cases and 1 skipped real-browser smoke by
  default, `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium is
  not installed in the current environment, and the token residue grep returned
  no matches.
- Dispatcher-level action result shape tests now lock the current compatible
  uid click, uid hover, uid fill, and content-script scroll passthrough result
  fields before P6.2 adds structured action result fields.
- Latest P6.2 action result shape validation: `git diff --check` passed,
  `node --test tests/tool-handlers.test.js` passed 4 tests,
  `npm run release:check` passed with 72 passing node:test cases and 1 skipped
  real-browser smoke by default, `YUNTI_E2E=1 npm run test:e2e` skipped because
  Playwright/Chromium is not installed in the current environment, and the token
  residue grep returned no matches.
- uid-based `yunti_click` now returns additive structured action result fields
  (`action`, `target`, `ok`, `recoverable`, and `nextStepHint`) while preserving
  the existing `clicked`, `uid`, `x/y`, and `browserSessionId` compatibility
  fields.
- Latest P6.2 uid-click structured result validation: `git diff --check`
  passed, `node --test tests/tool-handlers.test.js` passed 4 tests,
  `npm run release:check` passed with 72 passing node:test cases and 1 skipped
  real-browser smoke by default, `YUNTI_E2E=1 npm run test:e2e` skipped because
  Playwright/Chromium is not installed in the current environment, and the token
  residue grep returned no matches.
- uid-based `yunti_hover` now returns additive structured action result fields
  (`action`, `target`, `ok`, `recoverable`, and `nextStepHint`) while preserving
  the existing `hovered`, `uid`, `x/y`, and `browserSessionId` compatibility
  fields.
- Latest P6.2 uid-hover structured result validation: `git diff --check`
  passed, `node --test tests/tool-handlers.test.js` passed 4 tests,
  `npm run release:check` passed with 72 passing node:test cases and 1 skipped
  real-browser smoke by default, `YUNTI_E2E=1 npm run test:e2e` skipped because
  Playwright/Chromium is not installed in the current environment, and the token
  residue grep returned no matches.
- uid-based `yunti_fill` keyboard path now returns additive structured action
  result fields (`action`, `target`, `ok`, `recoverable`, and `nextStepHint`)
  while preserving the existing `filled`, `uid`, `method`, `value`, and
  `browserSessionId` compatibility fields. Select/contenteditable/scroll
  semantics are intentionally unchanged in this slice.
- Latest P6.2 uid-fill keyboard structured result validation: `git diff
  --check` passed, `node --test tests/tool-handlers.test.js` passed 4 tests,
  `npm run release:check` passed with 72 passing node:test cases and 1 skipped
  real-browser smoke by default, npm package contents validation passed with 42
  files, extension zip contents validation passed with 13 files,
  `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium is not
  installed in the current environment, and the token residue grep returned no
  matches.
- uid-based `yunti_fill` select path now returns additive structured action
  result fields (`action`, `target`, `ok`, `recoverable`, and `nextStepHint`)
  while preserving the existing `filled`, `uid`, `method`, `value`, and
  `browserSessionId` compatibility fields. Select value dispatch semantics are
  intentionally unchanged in this slice.
- Latest P6.2 uid-fill select structured result targeted validation: `git diff
  --check` passed and `node --test tests/tool-handlers.test.js` passed 5 tests.
- Latest P6.2 uid-fill select structured result full validation: `git diff
  --check` passed, `npm run release:check` passed with 73 passing node:test
  cases and 1 skipped real-browser smoke by default, npm package contents
  validation passed with 42 files, extension zip contents validation passed with
  13 files, `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium
  is not installed in the current environment, and the token residue grep
  returned no matches.
- Coordinate fallback `yunti_click` now returns additive structured action
  result fields (`action`, `target`, `ok`, `recoverable`, and `nextStepHint`)
  while preserving the existing `clicked`, `x/y`, `method`, and
  `browserSessionId` compatibility fields. Coordinate click dispatch semantics
  are intentionally unchanged in this slice.
- Latest P6.2 coordinate-click structured result targeted validation: `git diff
  --check` passed and `node --test tests/tool-handlers.test.js` passed 6 tests.
- Latest P6.2 coordinate-click structured result full validation: `git diff
  --check` passed, `npm run release:check` passed with 74 passing node:test
  cases and 1 skipped real-browser smoke by default, npm package contents
  validation passed with 42 files, extension zip contents validation passed with
  13 files, `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium
  is not installed in the current environment, and the token residue grep
  returned no matches.
- Coordinate fallback `yunti_hover` now returns additive structured action
  result fields (`action`, `target`, `ok`, `recoverable`, and `nextStepHint`)
  while preserving the existing `hovered`, `x/y`, `method`, and
  `browserSessionId` compatibility fields. Coordinate hover dispatch semantics
  are intentionally unchanged in this slice.
- Latest P6.2 coordinate-hover structured result targeted validation: `git diff
  --check` passed and `node --test tests/tool-handlers.test.js` passed 7 tests.
- Latest P6.2 coordinate-hover structured result full validation: `git diff
  --check` passed, `npm run release:check` passed with 75 passing node:test
  cases and 1 skipped real-browser smoke by default, npm package contents
  validation passed with 42 files, extension zip contents validation passed with
  13 files, `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium
  is not installed in the current environment, and the token residue grep
  returned no matches.
- Selector fallback `yunti_hover` now returns additive structured action result
  fields (`action`, `target`, `ok`, `recoverable`, and `nextStepHint`) while
  preserving the existing `hovered`, `selector`, `x/y`, `method`, and
  `browserSessionId` compatibility fields. Selector hover dispatch semantics
  are intentionally unchanged in this slice.
- Latest P6.2 selector-hover structured result targeted validation: `git diff
  --check` passed and `node --test tests/tool-handlers.test.js` passed 8 tests.
- Latest P6.2 selector-hover structured result full validation: `git diff
  --check` passed, `npm run release:check` passed with 76 passing node:test
  cases and 1 skipped real-browser smoke by default, npm package contents
  validation passed with 42 files, extension zip contents validation passed with
  13 files, `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium
  is not installed in the current environment, and the token residue grep
  returned no matches.
- Selector fallback `yunti_click` now returns additive structured action result
  fields (`action`, `target`, `ok`, `recoverable`, and `nextStepHint`) around
  the existing content-script passthrough result while preserving `clicked`,
  `element`, `selector`, `method`, and `browserSessionId` compatibility fields.
  Selector click dispatch semantics are intentionally unchanged in this slice.
- Latest P6.2 selector-click structured result targeted validation: `git diff
  --check` passed and `node --test tests/tool-handlers.test.js` passed 9 tests.
- Latest P6.2 selector-click structured result full validation: `git diff
  --check` passed, `npm run release:check` passed with 77 passing node:test
  cases and 1 skipped real-browser smoke by default, npm package contents
  validation passed with 42 files, extension zip contents validation passed with
  13 files, `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium
  is not installed in the current environment, and the token residue grep
  returned no matches.
- `yunti_scroll` now returns additive structured action result fields
  (`action`, `ok`, `recoverable`, `nextStepHint`, and `browserSessionId`) around
  the existing content-script passthrough result while preserving `scrolled`,
  `deltaX`, `deltaY`, `target`, `before`, and `after` compatibility fields.
  Document/container scroll selection and `scrollBy` dispatch semantics are
  intentionally unchanged in this slice.
- Latest P6.2 scroll structured result targeted validation: `git diff --check`
  passed and `node --test tests/tool-handlers.test.js` passed 9 tests.
- Latest P6.2 scroll structured result full validation: `git diff --check`
  passed, `npm run release:check` passed with 77 passing node:test cases and 1
  skipped real-browser smoke by default, npm package contents validation passed
  with 42 files, extension zip contents validation passed with 13 files,
  `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium is not
  installed in the current environment, and the token residue grep returned no
  matches.
- Selector fallback `yunti_fill` now returns additive structured action result
  fields (`action`, `target`, `ok`, `recoverable`, `nextStepHint`, `selector`,
  `method`, and `browserSessionId`) around the existing content-script
  passthrough result while preserving `filled`, `element`, and `valueLength`
  compatibility fields. Selector fill dispatch semantics are intentionally
  unchanged in this slice.
- Latest P6.2 selector-fill structured result targeted validation: `git diff
  --check` passed and `node --test tests/tool-handlers.test.js` passed 10 tests.
- Latest P6.2 selector-fill structured result full validation: `git diff
  --check` passed, `npm run release:check` passed with 78 passing node:test
  cases and 1 skipped real-browser smoke by default, npm package contents
  validation passed with 42 files, extension zip contents validation passed with
  13 files, `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium
  is not installed in the current environment, and the token residue grep
  returned no matches.
- `yunti_type_text` now returns additive structured action result fields
  (`action`, `target`, `ok`, `recoverable`, `nextStepHint`, and
  `browserSessionId`) for both uid-based CDP keyboard typing and content-script
  passthrough typing, while preserving uid path compatibility fields (`typed`,
  `uid`, `text`, and `method`) and content-script compatibility fields
  (`typed`, `element`, `textLength`, and `mode`). Type dispatch semantics are
  intentionally unchanged in this slice.
- Latest P6.2 type-text structured result targeted validation: `git diff
  --check` passed and `node --test tests/tool-handlers.test.js` passed 12 tests.
- Latest P6.2 type-text structured result full validation: `git diff --check`
  passed, `npm run release:check` passed with 80 passing node:test cases and 1
  skipped real-browser smoke by default, npm package contents validation passed
  with 42 files, extension zip contents validation passed with 13 files,
  `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium is not
  installed in the current environment, and the token residue grep returned no
  matches.
- `yunti_press_key` now returns additive structured action result fields
  (`action`, `target`, `ok`, `recoverable`, `nextStepHint`, and
  `browserSessionId`) for both uid-based CDP keyboard dispatch and
  content-script passthrough key press, while preserving uid path compatibility
  fields (`pressed`, `uid`, and `key`) and content-script compatibility fields
  (`pressed`, `key`, `element`, and `valueChanged`). Key dispatch semantics are
  intentionally unchanged in this slice.
- Latest P6.2 press-key structured result targeted validation: `git diff
  --check` passed and `node --test tests/tool-handlers.test.js` passed 14 tests.
- Latest P6.2 press-key structured result full validation: `git diff --check`
  passed, `npm run release:check` passed with 82 passing node:test cases and 1
  skipped real-browser smoke by default, npm package contents validation passed
  with 42 files, extension zip contents validation passed with 13 files,
  `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium is not
  installed in the current environment, and the token residue grep returned no
  matches.
- `yunti_upload_file` now returns additive structured action result fields
  (`action`, `target`, `ok`, `recoverable`, `nextStepHint`, and
  `browserSessionId`) for both uid-based and selector-based file input
  resolution, while preserving compatibility fields (`uploaded`, `fileCount`,
  and `filePaths`). File input resolution and `DOM.setFileInputFiles` dispatch
  semantics are intentionally unchanged in this slice.
- Latest P6.2 upload-file structured result targeted validation: `git diff
  --check` passed and `node --test tests/tool-handlers.test.js` passed 16 tests.
- Latest P6.2 upload-file structured result full validation: `git diff
  --check` passed, `npm run release:check` passed with 84 passing node:test
  cases and 1 skipped real-browser smoke by default, npm package contents
  validation passed with 42 files, extension zip contents validation passed with
  13 files, `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium
  is not installed in the current environment, and the token residue grep
  returned no matches.
- `yunti_drag` now returns additive structured action result fields (`action`,
  `target`, `ok`, `recoverable`, `nextStepHint`, and `browserSessionId`) while
  preserving compatibility fields (`dragged`, `from`, `to`, and `steps`). CDP
  mouse event dispatch semantics are intentionally unchanged in this slice.
- Latest P6.2 drag structured result targeted validation: `git diff --check`
  passed and `node --test tests/tool-handlers.test.js` passed 17 tests.
- Latest P6.2 drag structured result full validation: `git diff --check`
  passed, `npm run release:check` passed with 85 passing node:test cases and 1
  skipped real-browser smoke by default, npm package contents validation passed
  with 42 files, extension zip contents validation passed with 13 files,
  `YUNTI_E2E=1 npm run test:e2e` skipped because Playwright/Chromium is not
  installed in the current environment, and the token residue grep returned no
  matches.
- P6.2 action result coverage has been audited after the drag slice. Structured
  action result fields now cover the main single-action paths for click, hover,
  fill, scroll, type text, press key, upload, and drag while preserving existing
  compatibility fields. Remaining action result gaps are standalone
  `yunti_select` content-script passthrough and aggregate `yunti_fill_form`.
  These must be completed before moving into deeper fill/select/scroll
  semantics.
- Latest P6.2 action result coverage checklist validation: `git diff --check`
  passed, `npm run release:check` passed with 85 passing node:test cases and 1
  skipped real-browser smoke by default, npm package contents validation passed
  with 42 files, extension zip contents validation passed with 13 files. This
  slice only updates docs and skill guidance, so `YUNTI_E2E=1 npm run test:e2e`
  was not rerun; the token residue grep returned no matches.
- Standalone `yunti_select` now returns additive structured action result
  fields (`action`, `target`, `ok`, `recoverable`, `nextStepHint`, and
  `browserSessionId`) around the existing content-script passthrough result
  while preserving compatibility fields (`selected`, `element`, and `value`).
  Select value assignment and input/change event dispatch semantics are
  intentionally unchanged in this slice.
- Latest P6.2 select structured result targeted validation: `git diff --check`
  passed and `node --test tests/tool-handlers.test.js` passed 18 tests.
- Latest P6.2 select structured result full validation: `git diff --check`
  passed; `npm run release:check` passed with 87 node:test cases total, 86
  passed, and 1 real-browser smoke skipped by default; npm package contents
  validation passed with 42 files; extension zip contents validation passed
  with 13 files; `YUNTI_E2E=1 npm run test:e2e` was executed but skipped
  because Playwright/Chromium is not installed locally; the token residue grep
  returned no matches.
- Aggregate `yunti_fill_form` now returns additive structured action result
  fields (`action`, `target`, `ok`, `recoverable`, `nextStepHint`, and
  `browserSessionId`) around the existing aggregate summary while preserving
  compatibility fields (`filled`, `failed`, and `results`). Per-field
  `fillByUid` and content-script selector fill semantics are intentionally
  unchanged in this slice.
- Latest P6.2 fill_form structured result targeted validation: `git diff --check`
  passed and `node --test tests/tool-handlers.test.js` passed 19 tests.
- Latest P6.2 fill_form structured result full validation: `git diff --check`
  passed; `npm run release:check` passed with 88 node:test cases total, 87
  passed, and 1 real-browser smoke skipped by default; npm package contents
  validation passed with 42 files; extension zip contents validation passed
  with 13 files; `YUNTI_E2E=1 npm run test:e2e` was executed but skipped
  because Playwright/Chromium is not installed locally; the token residue grep
  returned no matches.
- `yunti_select` now has a P6.2 uid/visible text planning contract in schema
  and usage hints. The current runtime remains selector/value compatible; uid
  and visible text selection semantics are intentionally left for the next
  runtime slice.
- Latest P6.2 select uid/text contract targeted validation: `git diff --check`
  passed and `node --test tests/bridge.test.js` passed.
- Latest P6.2 select uid/text contract full validation: `git diff --check`
  passed; `npm run release:check` passed with 89 node:test cases total, 88
  passed, and 1 real-browser smoke skipped by default; npm package contents
  validation passed with 42 files; extension zip contents validation passed
  with 13 files. This slice only updates schema, usage hints, docs, and skill
  guidance, so `YUNTI_E2E=1 npm run test:e2e` was not rerun; the token residue
  grep returned no matches.
- `yunti_select` now supports the `uid + value` runtime path while preserving
  selector/value compatibility. The uid path reuses the latest observe/snapshot
  uid map, matches select options by option value, dispatches change/input
  events, and returns structured action result fields. Visible option text
  selection remains intentionally deferred to the next runtime slice.
- Latest P6.2 select uid/value runtime targeted validation: `git diff --check`
  passed and `node --test tests/tool-handlers.test.js tests/bridge.test.js`
  passed 85 tests.
- Latest P6.2 select uid/value runtime full validation: `git diff --check`
  passed; `npm run release:check` passed with 90 node:test cases total, 89
  passed, and 1 real-browser smoke skipped by default; npm package contents
  validation passed with 42 files; extension zip contents validation passed
  with 13 files; `YUNTI_E2E=1 npm run test:e2e` was executed but skipped
  because Playwright/Chromium is not installed locally; the token residue grep
  returned no matches.
- `yunti_select` now supports the `uid + visible text` runtime path while
  preserving selector/value and uid/value compatibility. The text path reuses
  the latest observe/snapshot uid map, matches select options by visible label,
  dispatches change/input events, and returns structured action result fields.
- Latest P6.2 select uid/text runtime targeted validation: `git diff --check`
  passed and `node --test tests/tool-handlers.test.js tests/bridge.test.js`
  passed 86 tests.
- Latest P6.2 select uid/text runtime full validation: `git diff --check`
  passed; `npm run release:check` passed with 91 node:test cases total, 90
  passed, and 1 real-browser smoke skipped by default; npm package contents
  validation passed with 42 files; extension zip contents validation passed
  with 13 files; `YUNTI_E2E=1 npm run test:e2e` was executed but skipped
  because Playwright/Chromium is not installed locally; the token residue grep
  returned no matches.
- `yunti_select` uid failure paths now return structured recovery diagnostics.
  Option misses return `selected: false`, `code: "OPTION_NOT_FOUND"`,
  `matchMode`, `targetOption`, available option values/texts when exposed by
  the page, and `recoveryHint`; non-select uid targets return `code:
  "NOT_SELECT"` plus `recoveryHint.decision` pointing agents toward the actual
  select element or selector/value fallback.
- Latest P6.2 select uid failure diagnostic targeted validation:
  `node --test tests/tool-handlers.test.js tests/bridge.test.js` passed 93
  tests.
- Latest P6.2 select uid failure diagnostic full validation: `git diff
  --check` passed; `node --test tests/tool-handlers.test.js tests/bridge.test.js`
  passed 93 tests; `npm run release:check` passed with 98 node:test cases
  total, 97 passed, and 1 real-browser smoke skipped by default; npm package
  contents validation passed with 42 files; extension zip contents validation
  passed with 13 files; `YUNTI_E2E=1 npm run test:e2e` was executed but skipped
  because Playwright/Chromium is not installed locally; the token residue grep
  returned no matches.
- `yunti_select` selector/value failure paths now return structured recovery
  diagnostics. Value mismatches return `selected: false`, `code:
  "OPTION_NOT_FOUND"`, `actualValue`, `matchMode`, `targetOption`, and
  `recoveryHint`; thrown selector failures return `code:
  "SELECTOR_SELECT_FAILED"` plus `recoveryHint.decision` pointing agents toward
  the actual select element or a fresh uid/value fallback.
- Latest P6.2 select selector failure diagnostic targeted validation:
  `node --test tests/tool-handlers.test.js tests/bridge.test.js` passed 95
  tests.
- Latest P6.2 select selector failure diagnostic full validation: `git diff
  --check` passed; `node --test tests/tool-handlers.test.js tests/bridge.test.js`
  passed 95 tests; `npm run release:check` passed with 100 node:test cases
  total, 99 passed, and 1 real-browser smoke skipped by default; npm package
  contents validation passed with 42 files; extension zip contents validation
  passed with 13 files; `YUNTI_E2E=1 npm run test:e2e` was executed but skipped
  because Playwright/Chromium is not installed locally; the token residue grep
  returned no matches.
- P6.2 action path coverage was re-audited after select uid/text support.
  Structured action result fields now cover the main action surfaces, and
  `yunti_select` has selector/value, uid/value, and uid/text operation paths.
  The next work should move into deeper fill/select/scroll semantics while
  preserving selector/value compatibility, CDP fallback, diagnostics, and
  existing action result fields.
- Latest P6.2 action path coverage audit validation: `git diff --check`
  passed; `npm run release:check` passed with 91 node:test cases total, 90
  passed, and 1 real-browser smoke skipped by default; npm package contents
  validation passed with 42 files; extension zip contents validation passed
  with 13 files; the token residue grep returned no matches. Real-browser E2E
  was not rerun for this docs-only audit patch.
- P6.2 deeper fill semantics have started with uid-targeted contenteditable
  result reporting. The runtime keeps the existing CDP keyboard input flow, but
  contenteditable targets now return `method: "contenteditable"` plus
  before/after text length summaries and a verification-oriented next step
  hint. Selector fill and normal keyboard fill compatibility fields are
  unchanged.
- Latest P6.2 contenteditable fill targeted validation:
  `node --test tests/tool-handlers.test.js` passed 22 tests.
- Latest P6.2 contenteditable fill full validation: `git diff --check`
  passed; `node --test tests/tool-handlers.test.js tests/bridge.test.js`
  passed 87 tests; `npm run release:check` passed with 92 node:test cases
  total, 91 passed, and 1 real-browser smoke skipped by default; npm package
  contents validation passed with 42 files; extension zip contents validation
  passed with 13 files; `YUNTI_E2E=1 npm run test:e2e` was executed but
  skipped because Playwright/Chromium is not installed locally; the token
  residue grep returned no matches.
- P6.2 fill failure diagnostics have started. Selector fill thrown failures and
  uid select option misses now return structured `filled: false` diagnostics
  with `ok: false`, `recoverable: true`, `code`, `recoveryHint`, and
  `nextStepHint`, while preserving successful fill compatibility fields and
  dispatch semantics. Uid select option misses include `availableValues` /
  `availableTexts` when the page exposes them.
- Latest P6.2 fill failure diagnostic targeted validation:
  `node --check extension/tool-handlers.js` passed; `node --test
  tests/tool-handlers.test.js` passed 32 tests.
- Latest P6.2 fill failure diagnostic full validation: `git diff --check`
  passed; the token residue grep returned no matches; `YUNTI_E2E=1 npm run
  test:e2e` was executed but skipped because Playwright/Chromium is not
  installed locally; `npm run release:check` passed with 102 node:test cases
  total, 101 passed, and 1 real-browser smoke skipped by default; npm package
  contents validation passed with 42 files; extension zip contents validation
  passed with 13 files.
- P6.2 fill_form aggregation now preserves per-field structured fill failure
  diagnostics. Aggregate results keep existing `filled`, `failed`, `results`,
  `action: "fill_form"`, `target`, `ok`, `recoverable`, and `nextStepHint`
  fields, while failed `results[]` items can carry `code`, `recoveryHint`,
  `availableValues` / `availableTexts`, and field-level `nextStepHint` from
  `yunti_fill`.
- Latest P6.2 fill_form diagnostic aggregation targeted validation:
  `node --check extension/tool-handlers.js` passed; `node --test
  tests/tool-handlers.test.js` passed 32 tests.
- Latest P6.2 fill_form diagnostic aggregation full validation: `git diff
  --check` passed; the token residue grep returned no matches; `YUNTI_E2E=1
  npm run test:e2e` was executed but skipped because Playwright/Chromium is
  not installed locally; `npm run release:check` passed with 102 node:test
  cases total, 101 passed, and 1 real-browser smoke skipped by default; npm
  package contents validation passed with 42 files; extension zip contents
  validation passed with 13 files.
- P6.2 non-editable fill diagnostics are complete. Uid fill now inspects the
  resolved target before dispatching keyboard events and returns structured
  `TARGET_NOT_EDITABLE` diagnostics for hidden/no-size, disabled, readonly, or
  non-editable targets. Selector fill now checks editability in the content
  script before mutating values. Failed results keep `filled: false`, `ok:
  false`, `recoverable: true`, `code`, `recoveryHint`, and `nextStepHint`; uid
  failures can also include a lightweight `element` diagnostic summary.
- Latest P6.2 non-editable fill diagnostic targeted validation:
  `node --check extension/tool-handlers.js` passed; `node --check
  extension/content.js` passed; `node --test tests/tool-handlers.test.js`
  passed 34 tests.
- Latest P6.2 non-editable fill diagnostic full validation: `git diff
  --check` passed; the token residue grep returned no matches; `YUNTI_E2E=1
  npm run test:e2e` was executed but skipped because Playwright/Chromium is
  not installed locally; `npm run release:check` passed with 104 node:test
  cases total, 103 passed, and 1 real-browser smoke skipped by default; npm
  package contents validation passed with 42 files; extension zip contents
  validation passed with 13 files.
- P6.2 observe field-state hints are complete. `yunti_observe_page` element
  entries can now expose `editable`, `fillable`, `readOnly`,
  `fillBlockReason`, and select `options[]` summaries so agents can inspect
  field state before calling `yunti_fill` or `yunti_select`. This is additive
  observe metadata only; uid lifecycle, default balanced redaction, and existing
  page action tools remain unchanged.
- Latest P6.2 observe field-state targeted validation:
  `node --check extension/dom-observer.js` passed; `node --test
  tests/dom-observer.test.js` passed 5 tests; `node --test tests/bridge.test.js`
  passed 65 tests.
- Latest P6.2 observe field-state full validation: `git diff --check` passed;
  the token residue grep returned no matches; `YUNTI_E2E=1 npm run test:e2e`
  was executed but skipped because Playwright/Chromium is not installed
  locally; `npm run release:check` passed with 105 node:test cases total, 104
  passed, and 1 real-browser smoke skipped by default; npm package contents
  validation passed with 42 files; extension zip contents validation passed
  with 13 files.
- P6.2 observe select-state hints are complete. Select elements can now expose
  `selectedIndex`, `selectedValue`, `selectedValueRedacted`, and `selectedText`
  alongside `options[]`, so agents can inspect the current selection before
  deciding whether to call `yunti_select`. This is additive observe metadata
  only; `yunti_select` execution, uid lifecycle, and default balanced redaction
  remain unchanged.
- Latest P6.2 observe select-state targeted validation:
  `node --check extension/dom-observer.js` passed; `node --test
  tests/dom-observer.test.js` passed 5 tests.
- P6.2 select disabled-option diagnostics are complete. Uid/value, uid/text,
  and selector/value select paths now return structured `OPTION_DISABLED`
  failures with `disabledValue`, `disabledText`, and recovery guidance to
  choose an enabled option, wait for the field to unlock, or ask the user
  before retrying. Existing successful select paths and compatibility fields
  remain unchanged.
- Latest P6.2 select disabled-option targeted validation:
  `node --check extension/tool-handlers.js` passed; `node --check
  extension/content.js` passed; `node --test tests/tool-handlers.test.js`
  passed 36 tests.
- Latest P6.2 select disabled-option full validation: `git diff --check`
  passed; the token residue grep returned no matches; `YUNTI_E2E=1 npm run
  test:e2e` was executed but skipped because Playwright/Chromium is not
  installed locally; `npm run release:check` passed with 107 node:test cases
  total, 106 passed, and 1 real-browser smoke skipped by default; npm package
  contents validation passed with 42 files; extension zip contents validation
  passed with 13 files.
- P6.2 deeper scroll semantics have started with fresh observed scrollable
  container uids. `yunti_observe_page` scrollableContainers now feed the current
  browserSessionId uid map, and `yunti_scroll` can resolve a container uid to
  its center while reusing the existing coordinate/container scroll path. The
  existing `target` compatibility field is preserved; uid scroll adds `uid`,
  `method: "uid"`, and `scrollTarget`.
- Latest P6.2 uid scroll targeted validation:
  `node --test tests/tool-handlers.test.js` passed 23 tests.
- Latest P6.2 uid scroll full validation: `git diff --check` passed;
  `node --test tests/tool-handlers.test.js tests/bridge.test.js` passed 88
  tests; `npm run release:check` passed with 93 node:test cases total, 92
  passed, and 1 real-browser smoke skipped by default; npm package contents
  validation passed with 42 files; extension zip contents validation passed
  with 13 files; `YUNTI_E2E=1 npm run test:e2e` was executed but skipped
  because Playwright/Chromium is not installed locally; the token residue grep
  returned no matches.
- P6.2 scroll boundary diagnostics now report movement when before/after scroll
  positions are comparable. A scroll that dispatches but does not move returns
  `moved: false`, `code: "NO_SCROLL_MOVEMENT"`, `ok: false`, and
  `recoverable: true`, while preserving existing `scrolled`, `target`, and
  before/after compatibility fields.
- Latest P6.2 scroll no-movement targeted validation:
  `node --test tests/tool-handlers.test.js` passed 24 tests.
- Latest P6.2 scroll no-movement full validation: `git diff --check` passed;
  `node --test tests/tool-handlers.test.js tests/bridge.test.js` passed 89
  tests; `npm run release:check` passed with 94 node:test cases total, 93
  passed, and 1 real-browser smoke skipped by default; npm package contents
  validation passed with 42 files; extension zip contents validation passed
  with 13 files; `YUNTI_E2E=1 npm run test:e2e` was executed but skipped
  because Playwright/Chromium is not installed locally; the token residue grep
  returned no matches.
- P6.2 scroll no-movement diagnostics now include directional `edgeHint` values
  when delta direction can be inferred, such as `possible-bottom-edge`,
  `possible-top-edge`, `possible-right-edge`, and `possible-left-edge`. This
  helps agents stop repeating the same scroll and choose a different direction,
  nearby scrollable container uid, or recovery path.
- Latest P6.2 scroll edge-hint targeted validation:
  `node --test tests/tool-handlers.test.js` passed 25 tests.
- Latest P6.2 scroll edge-hint full validation: `git diff --check` passed;
  `node --test tests/tool-handlers.test.js tests/bridge.test.js` passed 90
  tests; `npm run release:check` passed with 95 node:test cases total, 94
  passed, and 1 real-browser smoke skipped by default; npm package contents
  validation passed with 42 files; extension zip contents validation passed
  with 13 files; `YUNTI_E2E=1 npm run test:e2e` was executed but skipped
  because Playwright/Chromium is not installed locally; the token residue grep
  returned no matches.
- P6.2 scroll no-movement diagnostics now include structured `recoveryHint`.
  For `NO_SCROLL_MOVEMENT`, the result includes reason, nextAction,
  recommendedTools, currentTarget, edgeHint, and, for fresh scrollable container
  uids, lastObservedContainer scrollability and remaining-pixel metadata.
- Latest P6.2 scroll recovery-hint targeted validation:
  `node --test tests/tool-handlers.test.js` passed 26 tests.
- Latest P6.2 scroll recovery-hint full validation: `git diff --check` passed;
  `node --test tests/tool-handlers.test.js tests/bridge.test.js` passed 91
  tests; `npm run release:check` passed with 96 node:test cases total, 95
  passed, and 1 real-browser smoke skipped by default; npm package contents
  validation passed with 42 files; extension zip contents validation passed
  with 13 files; `YUNTI_E2E=1 npm run test:e2e` was executed but skipped
  because Playwright/Chromium is not installed locally; the token residue grep
  returned no matches.
- P6.2 scroll recovery guidance now includes `recoveryHint.suggestedRetry`.
  When an opposite direction can be derived from `edgeHint`, the hint carries a
  one-shot opposite `deltaX` / `deltaY`; uid-targeted scroll keeps the same
  fresh container uid so agents can retry once, observe again, then switch
  container or stop repeating if there is still no movement.
- Latest P6.2 scroll suggested-retry targeted validation:
  `node --test tests/tool-handlers.test.js tests/bridge.test.js` passed 91
  tests.
- Latest P6.2 scroll suggested-retry full validation: `git diff --check`
  passed; `node --test tests/tool-handlers.test.js tests/bridge.test.js`
  passed 91 tests; `npm run release:check` passed with 96 node:test cases
  total, 95 passed, and 1 real-browser smoke skipped by default; npm package
  contents validation passed with 42 files; extension zip contents validation
  passed with 13 files; `YUNTI_E2E=1 npm run test:e2e` was executed but
  skipped because Playwright/Chromium is not installed locally; the token
  residue grep returned no matches.
- P6.2 scroll recovery guidance now includes `recoveryHint.decision`. For
  `NO_SCROLL_MOVEMENT`, the decision is derived from `edgeHint` and whether the
  scroll used a fresh container uid, producing machine-readable guidance such
  as observing for a container, retrying the opposite direction once on the
  same container, or providing a nonzero delta.
- Latest P6.2 scroll decision-hint targeted validation:
  `node --test tests/tool-handlers.test.js tests/bridge.test.js` passed 91
  tests.
- Latest P6.2 scroll decision-hint full validation: `git diff --check` passed;
  `node --test tests/tool-handlers.test.js tests/bridge.test.js` passed 91
  tests; `npm run release:check` passed with 96 node:test cases total, 95
  passed, and 1 real-browser smoke skipped by default; npm package contents
  validation passed with 42 files; extension zip contents validation passed
  with 13 files; `YUNTI_E2E=1 npm run test:e2e` was executed but skipped
  because Playwright/Chromium is not installed locally; the token residue grep
  returned no matches.
- P6.2 uid fill post-value verification is complete. Keyboard/contenteditable
  fill paths now perform a lightweight post-dispatch value check when possible.
  If the target value does not remain, `yunti_fill` returns structured
  `filled: false`, `ok: false`, `code: "VALUE_NOT_APPLIED"`,
  `expectedValueLength`, `actualValueLength`, `recoveryHint`, and
  `nextStepHint` diagnostics without echoing the raw field value. Existing
  successful fill/select/scroll compatibility fields are preserved.
- Latest P6.2 uid fill post-value verification targeted validation:
  `node --check extension/tool-handlers.js` passed; `node --test
  tests/tool-handlers.test.js` passed 37 tests.
- P6.2 scroll partial-movement diagnostics are complete. When comparable
  `before` / `after` positions show movement that is smaller than the requested
  `deltaX` / `deltaY`, `yunti_scroll` keeps the action successful but adds a
  structured `partialMovement` hint with requested/actual deltas, affected axes,
  `edgeHint`, `nextAction: "observe-again"`, and
  `decision: "observe-before-continuing-scroll"`.
- Latest P6.2 scroll partial-movement targeted validation:
  `node --check extension/tool-handlers.js` passed; `node --test
  tests/tool-handlers.test.js` passed 38 tests.
- P6.2 uid scroll missing/stale target diagnostics are complete. Missing,
  stale, hidden, or coordinate-unresolvable scroll uids now return structured
  `scrolled: false`, `ok: false`, `recoverable: true`, `code`, `recoveryHint`,
  and `nextStepHint` instead of only bubbling a generic dispatcher error.
  Existing successful scroll, no-movement, and partial-movement paths are
  preserved.
- Latest P6.2 uid scroll missing-target targeted validation:
  `node --check extension/tool-handlers.js` passed; `node --test
  tests/tool-handlers.test.js` passed 39 tests.
- P6.2 coordinate scroll hit/fallback diagnostics are complete. Coordinate
  scrolls can now report `coordinateTarget`, `scrollContainerFound`, and
  `coordinateScrollFallback: "document"` from the content script, so agents can
  distinguish nested container hits from document fallback without changing the
  existing scroll dispatch behavior.
- P6.2 coordinate scroll document fallback recovery hints are complete. When
  handler results include `coordinateScrollFallback: "document"`, successful
  scrolls keep `ok: true` and `recoverable: false` while adding
  `coordinateFallbackHint` plus a clearer `nextStepHint` to observe again and
  choose a fresh `scrollableContainers[]` uid when a panel/sidebar was intended.
- Latest P6.2 coordinate scroll fallback targeted validation:
  `node --test tests/tool-handlers.test.js tests/bridge.test.js
  tests/content-scroll.test.js` passed 107 tests.
- Latest P6.2 coordinate scroll fallback full validation: `git diff --check`
  passed; the token residue grep returned no matches; `YUNTI_E2E=1 npm run
  test:e2e` was executed but skipped because Playwright/Chromium is not
  installed locally; `npm run release:check` passed with 113 node:test cases
  total, 112 passed, and 1 real-browser smoke skipped by default; npm package
  contents validation passed with 42 files; extension zip contents validation
  passed with 13 files.
- P6.2 wait-observe recovery guidance is complete for tool guidance surfaces.
  `yunti_get_tool_usage_hints`, `docs/TOOL_GUIDE.md`, and the packaged skill now
  tell agents to recover from async rendering, validation, option population, or
  newly loaded content by calling `yunti_wait_for`, observing again, and using a
  fresh uid for fill/select/scroll continuation.
- Latest P6.2 wait-observe guidance targeted validation: `node --test
  tests/bridge.test.js` passed 65 tests.
- Latest P6.2 wait-observe guidance full validation: `git diff --check` passed;
  the token residue grep returned no matches; `YUNTI_E2E=1 npm run test:e2e`
  was executed but skipped because Playwright/Chromium is not installed locally;
  `npm run release:check` passed with 113 node:test cases total, 112 passed, and
  1 real-browser smoke skipped by default; npm package contents validation
  passed with 42 files; extension zip contents validation passed with 13 files.

## Decisions

- Project name: `yunti-browser-runtime`.
- Public package/tooling prefix: `yunti`.
- Environment variable prefix: `YUNTI_BROWSER_`.
- Tool prefix target: `yunti_*`.
- `yunti_list_pages` is a compatibility alias for the live browser target
  inventory, not a separate registration registry.
- If a `browserSessionId` becomes stale, agents should call
  `yunti_list_browser_targets` to refresh the route inventory.
- The content script must not call product-specific login APIs in the
  standalone runtime.
- `0.2.0` is a Yunti-first enhancement cycle aimed at becoming the most useful
  local browser automation operation layer for agents and developers.
- Reference projects such as Playwright, Puppeteer, Selenium, CDP, browser-use,
  Page Agent, BrowserGym, and extension runtimes are sources of practical ideas,
  not product shapes to copy.
- Page Agent has been reviewed as the concrete first reference for P6.1/P6.2:
  absorb browser-state observation, indexed interactive elements, scrollable
  metadata, action sequencing, and retry discipline; do not copy its built-in
  LLM loop or make its UI model mandatory.
- A multi-perspective 0.2.0 review has been completed across product,
  architecture/API, Agent workflow, security/privacy, and test/release strategy.
  The resulting plan changes emphasize product success metrics, field-level
  observation contracts, uid lifecycle, P6.1 minimum redaction, deterministic
  fixtures, and observe-first skill/tool guidance.
- Implementation should proceed step by step: first use Page Agent/browser-use
  as the concrete reference for P6.1 page observation and P6.2 indexed actions,
  then absorb Playwright/CDP/BrowserGym-style reliability and diagnostics later.
- Each `0.2.0` implementation slice should be documented before code changes:
  user-facing capability, compatibility rule, non-goals, acceptance checks, and
  why it strengthens Yunti's own direction.
- Yunti should not require an LLM API key, mandatory hub tab, side panel, or
  single black-box `execute_task` tool in the default path.
- Yunti should preserve its own distinctive capabilities: fine-grained MCP
  tools, real Chrome/Edge state, CDP, screenshots, network/console diagnostics,
  tab control, local bridge routing, and zero-config local install.
- P6.1 implementation is proceeding in small slices: schema/tool hints/bridge
  routing are complete, content-script observation MVP is underway, and fresh
  observe uids now feed existing uid-based actions without replacing the
  snapshot path.

## Open Work

- Follow `docs/NEXT_MAJOR_PLAN.md` for the next major cycle.
- P6.1 real-browser closure is complete: `YUNTI_E2E=1 npm run test:e2e` passed
  locally with temporary Node Playwright 1.58.0 and the existing Playwright
  browser cache from `/opt/miniconda3/envs/pytest-playwright`.
- Continue 0.2.0 in small compatibility-preserving slices. Current completed
  subphases are P6.2.1 action result coverage, P6.2.2 select semantics, P6.2.3
  fill/form diagnostics, P6.2.4 scroll diagnostics, P6.2.5 wait-observe
  guidance, P6.2.6 structured `yunti_wait_for` results, and P6.2.7 automated
  action result coverage audit, P6.3.1 agent workflow contract, P6.3.2 minimal
  Tool Guide use cases, P6.4.1 DOM redaction policy deepening, P6.4.2 learning
  memory / console diagnostic secret-boundary tightening, P6.4.3 raw CDP /
  screenshot non-redaction diagnostic guidance, P6.5.1 optional local runtime
  console minimum loop, P6.5.2 local console diagnostic polish, and P6.5.3
  real-browser console validation. P6.6.1 browser extension distribution
  readiness, P6.6.2 store-facing permission/privacy copy, and P6.6.3 pre-store
  permission strategy decision are complete. P6.6.4 store-candidate permission
  UX design is deferred to post-0.2. The next anchored slice should be chosen
  from post-0.2 planning, with browser-store permission UX still available as a
  separate store-candidate track.
- For the next coding slice, update all affected guidance surfaces in one
  commit: `mcp/tools.js`, `docs/TOOL_GUIDE.md`,
  `skills/yunti-browser-runtime/SKILL.md`, `docs/EXECUTION_PLAN.md`, and this
  status file.
- P4.1 release-readiness docs and permission review is complete.
- P4.2 Agent integration examples are complete.
- P4.3 npm publishing URL confirmation is complete with the GitHub repository
  `https://github.com/BoCodeLab/yunti-browser-runtime`; package metadata points
  to that repository/homepage/issues URL set and all three URLs return HTTP 200.
- `npm view yunti-browser-runtime@0.1.0` returns the published `0.1.0` package
  metadata from `https://registry.npmjs.org/`.
- Latest release gate checks passed after documenting P4.3: public-doc residue
  check, `npm run check`, `npm test`, and `npm pack --dry-run`.
- P4.4 release gate scripting is complete: `npm run release:check` now runs
  public-doc residue checks, `npm run check`, `npm test`, and
  `npm pack --dry-run`.
- P4.5 release runbook is complete: `docs/RELEASE.md` documents external URL
  confirmation, release gates, extension zip checks, optional E2E, and npm
  publish steps.
- Latest `npm run release:check` passed after adding the runbook; the npm
  tarball includes `docs/RELEASE.md`.
- P4.6 package metadata checking is complete: `npm run check:metadata` reports
  public reachability for package repository/homepage/bugs URLs and npm package
  status, returning non-zero while the GitHub URLs are unavailable.
- Latest `npm run release:check` passed after adding metadata checking; the npm
  tarball includes `scripts/check-package-metadata.js`.
- P4.7 prepublish gate is complete: `npm run release:prepublish` now runs
  metadata checks before the local release gate and is expected to fail until
  P4.3 repository URLs are public.
- Latest P4.7 validation: `npm run release:check` passed public-doc residue
  checks, `npm run check`, `npm test`, and `npm pack --dry-run`; `npm run
  release:prepublish` failed as expected at `check:metadata` because the current
  repository and bugs URLs still return 404 or are not publicly reachable.
- P4.3 blocker remediation is documented in `docs/PUBLISHING_BLOCKERS.md`;
  latest `npm run release:check` passed after adding that guide, and the npm
  tarball now includes the blocker guide with 39 total files.
- P4.8 npm package contents gate is complete: `npm run release:check` now parses
  `npm pack --json --dry-run` and fails if required runtime, extension, skill,
  release documentation, or release helper files are missing from the tarball.
- Latest P4.8 validation: `npm run release:check` passed public-doc residue
  checks, `npm run check`, `npm test`, and the required npm package contents
  check; the parsed npm pack output contained 39 files.
- P4.9 extension zip contents gate is complete: `npm run release:check` now
  runs `npm run package:extension`, parses the generated zip, and fails if the
  archive is missing required extension runtime files or includes unexpected
  files.
- Latest P4.9 validation: `npm run release:check` passed public-doc residue
  checks, `npm run check`, `npm test`, required npm package contents validation,
  and extension zip contents validation; the generated extension zip contained
  exactly 12 runtime files.
- P4.10 package / extension version consistency gate is complete:
  `npm run release:check` now fails if `package.json.version` and
  `extension/manifest.json.version` are missing or different.
- Latest P4.10 validation: `npm run release:check` passed public-doc residue
  checks, version consistency check for `0.1.0`, `npm run check`, `npm test`,
  required npm package contents validation, and extension zip contents
  validation.
- P4.11 npm bin CLI smoke gate is complete: `npm run release:check` now verifies
  `package.json` bin mapping, `yunti-browser-runtime --help`, and
  `yunti-browser-runtime --version` behavior through the local CLI entrypoint.
- Latest P4.11 validation: `npm run release:check` passed public-doc residue
  checks, version consistency check for `0.1.0`, CLI smoke check for `0.1.0`,
  `npm run check`, `npm test`, required npm package contents validation, and
  extension zip contents validation.
- P4.12 Agent config smoke gate is complete: `npm run release:check` now
  validates `print-config` JSON output for Codex, Claude Code, Cursor, and
  Cline, plus the human-readable Codex output for token and skill guidance.
- Latest P4.12 validation: `npm run release:check` passed public-doc residue
  checks, version consistency check for `0.1.0`, CLI smoke check for `0.1.0`,
  print-config smoke check for 4 agents, `npm run check`, `npm test`, required
  npm package contents validation, and extension zip contents validation.
- P4.13 doctor JSON smoke gate is complete: `npm run release:check` now runs
  `scripts/doctor.js`, parses stdout JSON, validates Node/MCP/skill diagnostics,
  and accepts bridge offline as a structured diagnostic state instead of a release
  gate failure.
- Latest P4.13 validation: `npm run release:check` passed public-doc residue
  checks, version consistency check for `0.1.0`, CLI smoke check for `0.1.0`,
  print-config smoke check for 4 agents, doctor smoke check with bridge offline,
  `npm run check`, `npm test`, required npm package contents validation, and
  extension zip contents validation.
- P4.14 public Markdown link gate is complete: `npm run release:check` now scans
  README, docs, and skills Markdown files and fails if a relative Markdown link
  points to a missing local file.
- Latest P4.14 validation: `npm run release:check` passed public-doc residue
  checks, public Markdown link check for 11 Markdown files, version consistency
  check for `0.1.0`, CLI smoke check for `0.1.0`, print-config smoke check for
  4 agents, doctor smoke check with bridge offline, `npm run check`, `npm test`,
  required npm package contents validation, and extension zip contents
  validation. The release gate test run covered 59 tests, with 58 passed and 1
  real-browser smoke test skipped by configuration.
- Latest P4.3 validation: `git push -u origin main` succeeded, `npm run
  check:metadata` passed with repository/homepage/bugs all returning HTTP 200,
  and `npm run release:prepublish` passed end to end.
- `npm run check:metadata` now retries transient repository/homepage/bugs HEAD
  request failures, so temporary GitHub TLS disconnects do not immediately block
  an otherwise reachable public URL set.
- `npm run check:metadata` also reuses the repository HEAD result when homepage
  resolves to the same GitHub URL, reducing duplicate external requests during
  release gates.
- P4.15 npm official registry publish scripts are complete:
  `release:dry-run` and `release:publish` explicitly use
  `https://registry.npmjs.org/`.
- Latest P4.15 validation: local npm registry is
  `https://registry.npmmirror.com`, while
  `npm run release:dry-run` passed and showed the official npm registry as the
  target; the dry-run tarball contained 39 files.
- P4.16 publish script gate chaining is complete: `release:dry-run` and
  `release:publish` now run `npm run release:prepublish` before reaching npm
  publish or publish dry-run.
- Latest P4.16 validation: `npm run release:dry-run` passed, entered
  `release:prepublish` first, then completed npm publish dry-run against
  `https://registry.npmjs.org/`; the tarball contained 39 files.
- P4.17 npm auth preflight is complete: `release:whoami` checks login against
  `https://registry.npmjs.org/`, and `release:publish` runs it before
  `npm publish`.
- Latest P4.17 validation: after npm login, `npm run release:whoami` succeeds
  against `https://registry.npmjs.org/` and reports account `xuanzhu`.
- P4.18 post-publish verification command is complete:
  `release:verify-published` checks the published npm package name, version,
  repository, homepage, bugs URL, and tarball URL against local `package.json`.
- Latest P4.18 validation: after publish, `npm run release:verify-published`
  returns 0 and confirms the published name, version, repository, homepage,
  bugs URL, and tarball URL.
- P4.19 formal npm publish execution is complete: `npm run release:publish`
  passed metadata checks, release gates, `npm run release:whoami`, `npm run
  check`, `npm test`, npm package contents validation, extension zip validation,
  and official npm publish.
- Latest P4.19 validation: official npm publish succeeded for
  `yunti-browser-runtime@0.1.0`; the published tarball URL is
  `https://registry.npmjs.org/yunti-browser-runtime/-/yunti-browser-runtime-0.1.0.tgz`.
- A temporary npm token publish retry also reached official npm publish after
  passing the full local release gate, but npm returned the same `E403`; the
  token does not satisfy npm's publish-time bypass 2FA requirement.
- A project-local `.npmrc` retry with the actual token also authenticated
  successfully as `xuanzhu`, then failed at `npm publish` with the same `E403`;
  `.npmrc` is ignored by git to avoid committing local npm credentials.
- A second npm token written to the project-local `.npmrc` also authenticated
  successfully as `xuanzhu`, then failed at `npm publish` with the same `E403`.
- A publish-capable npm token written to the project-local `.npmrc` authenticated
  successfully as `xuanzhu`; `npm run release:publish` then succeeded, followed
  by successful `npm run release:verify-published`.
- P5.1 local default auth simplification is complete: default `127.0.0.1`
  bridge usage no longer needs a token; explicit `YUNTI_BROWSER_BRIDGE_TOKEN`
  still enforces token checks; non-loopback binding without a token fails fast.
- Latest P5.1 validation: `npm test` passed 61 tests with 60 passing and 1
  real-browser smoke skipped by configuration; `npm run check` and
  `npm run release:check` passed; `npm run release:publish` published
  `yunti-browser-runtime@0.1.1`; `npm run release:verify-published` returned 0.
- P5.2 extension popup and onboarding simplification is complete: Bridge Token
  is now optional under advanced settings, README contains a copyable Agent
  installation prompt, and default extension loading no longer asks users to
  save popup settings.
- Latest P5.2 validation: `npm run release:check` passed; `npm run
  release:publish` published `yunti-browser-runtime@0.1.2`; `npm run
  release:verify-published` returned 0.
- P5.3 extension zero-config first-run is complete: popup first screen now only
  shows connection status plus refresh, optional Bridge URL/page match/token
  controls are hidden under advanced settings, and docs explain that the MCP
  server starts the local bridge automatically.
- Latest P5.3 validation: `npm run release:check` passed; `npm run
  release:publish` published `yunti-browser-runtime@0.1.3`; a first
  `npm run release:verify-published` hit npm registry lag, then a retry passed
  and `npm view yunti-browser-runtime version dist-tags.latest` returned
  `0.1.3`.

## Known Risks

- Remote relay environment variables still exist in MCP code for compatibility
  but are not documented as the first release path.
- Tool argument validation is improved for the P3.2 focus tools, but broader
  long-tail tools can still receive the same treatment before a later release.
- Extension broad host permissions are now documented, but should still be
  re-reviewed before any store-distributed release.
- Package repository/homepage/bugs metadata is publicly reachable and published
  npm metadata now matches local `package.json`.
- Tool names and descriptions must stay clear enough for agents to choose the
  right route without relying on hidden model knowledge.

## Maintenance Rule

Every meaningful change to runtime behavior, tool schema, extension behavior,
or install flow must update this file before commit/release.
