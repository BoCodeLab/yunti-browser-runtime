# 2026 Browser Agent Research And P8 Upgrade Plan

## Document Status

- Research date: 2026-07-19
- Product baseline: `yunti-browser-runtime@0.2.3`
- Scope: planning and evidence only; no runtime implementation is included
- Primary references: Alibaba Page Agent and browser-use
- Freshness rule: projects without current maintenance can appear in historical
  notes, but they cannot define P8 priorities or architecture

This document is the durable recovery anchor for the next Yunti development
cycle. If context is compressed, read this file together with
`PROJECT_STATUS.md`, `EXECUTION_PLAN.md`, and
`RELIABILITY_BENCHMARK_PLAN.md` before changing code.

## Product Direction

Yunti should absorb the strongest browser-agent techniques without becoming a
clone of Page Agent, browser-use, or another framework.

The product remains:

- local-first and able to use the user's existing Chrome/Edge state
- MCP-native, LLM-agnostic, and composed of inspectable `yunti_*` tools
- capable of both high-level DOM actions and unrestricted CDP operations
- usable without a mandatory cloud account, model key, proxy, or CAPTCHA
  service
- explicit about redaction, confirmation, backend choice, and recovery

The next cycle should improve the browser operation layer itself: observe less,
find more precisely, wait correctly, act once, verify the result, and recover
without asking the user to refresh or repeat setup.

## Why Page Agent And browser-use

Yunti needs references that are both current and close to real browser-agent
operation. Page Agent and browser-use pass that filter:

- both are actively maintained as of 2026-07-19
- both expose concrete page-state and action contracts rather than only abstract
  marketing claims
- both highlight browser-agent reliability problems that Yunti also faces:
  state drift, target drift, cancellation, page readiness, multi-step recovery,
  and evaluation

They are references, not templates. Yunti must preserve its own strengths:

- local existing-browser control
- fine-grained MCP tools instead of a single opaque task runner
- no mandatory runtime LLM loop
- unrestricted CDP as a first-class escape hatch
- controller-based page recovery and local redaction

## Primary Reference: Alibaba Page Agent

Official evidence:

- Repository and README: <https://github.com/alibaba/page-agent>
- Main branch commits: <https://github.com/alibaba/page-agent/commits/main/>
- Releases: <https://github.com/alibaba/page-agent/releases>
- PageController docs:
  <https://alibaba.github.io/page-agent/docs/advanced/page-controller>
- PageAgentCore docs:
  <https://alibaba.github.io/page-agent/docs/advanced/page-agent-core>
- Custom tools docs:
  <https://alibaba.github.io/page-agent/docs/features/custom-tools>
- Custom instructions docs:
  <https://alibaba.github.io/page-agent/docs/features/custom-instructions>
- Data masking docs:
  <https://alibaba.github.io/page-agent/docs/features/data-masking>
- Limitations:
  <https://alibaba.github.io/page-agent/docs/introduction/limitations>

Current activity snapshot verified during research:

- latest confirmed main commit:
  `da1db959558dcd49a6c489e76a23accfbda7b156` on 2026-07-17
- recent releases remain dense through `v1.12.2` on 2026-07-16
- recent release notes explicitly mention MV3 stateless tab sync, on-demand tab
  state fetch, tab loading status, and `AbortSignal` support

Why it matters:

- It demonstrates an in-page, text-DOM path that does not require screenshots
  or a multimodal model for ordinary controls.
- `PageController` emits a compact `BrowserState` split into
  `url/title/header/content/footer`.
- `updateTree()` makes observation refresh explicit instead of pretending that
  stale element handles remain valid.
- Its simplified HTML and target indexing show the value of compact
  interaction-oriented state.
- It treats nested scrolling as a first-class problem.
- It already carries MV3 service-worker recovery lessons that map well to
  Yunti's controller-based extension design.

What Yunti should absorb:

1. A compact browser-state contract that joins metadata, targets, scroll state,
   and actionable hints.
2. Explicit observation generations and fresh target maps.
3. Better scroll-container discovery and post-scroll verification.
4. Tool registration, override, disable, and schema-validation conventions.
5. End-to-end cancellation semantics from top-level run down to tab-load wait.
6. Separation between persistent history and transient activity.
7. Local redaction hooks before content is returned to an external agent.
8. MV3 stateless recovery tests and loading-state recovery behavior.

What Yunti should not copy:

- Do not move Page Agent's built-in LLM loop into Yunti's runtime.
- Do not require its hub, side panel, or page-embedded UI for normal use.
- Do not narrow Yunti to a single-page task abstraction.
- Do not copy its position indexes as durable cross-step identity.
- Do not accept Page Agent's DOM-only capability ceiling, because Yunti already
  has CDP, screenshots, tabs, network, console, and upload surfaces.
- Do not adopt default page masking that blocks the user in an
  existing-browser workflow.
- Do not use Page Agent's Beta MCP topology as Yunti's control-plane template.

## Primary Reference: browser-use

Official evidence:

- Repository and README: <https://github.com/browser-use/browser-use>
- Main branch commits: <https://github.com/browser-use/browser-use/commits/main/>
- Open-source docs: <https://docs.browser-use.com/>
- Browser parameters:
  <https://docs.browser-use.com/open-source/customize/browser/all-parameters>
- Browser source tree:
  <https://github.com/browser-use/browser-use/tree/main/browser_use>
- Typed browser events:
  <https://github.com/browser-use/browser-use/blob/main/browser_use/browser/events.py>
- Watchdogs:
  <https://github.com/browser-use/browser-use/tree/main/browser_use/browser/watchdogs>
- Enhanced snapshot:
  <https://github.com/browser-use/browser-use/blob/main/browser_use/dom/enhanced_snapshot.py>

Current activity snapshot verified during research:

- latest confirmed main commit:
  `950eb03617e67548d759c02beac1ad122c6b6458` on 2026-07-17
- release commit says `Release 0.13.6 with Browser Harness 0.1.6`
- repository activity is very high, but the latest visible main-branch commit
  showed a failing status, so Yunti should copy ideas only with its own gates

Why it matters:

- It is a current browser-agent system, not only a test runner wrapper.
- It emphasizes indexed state, real-world task evaluation, recovery-oriented
  execution, and browser session lifecycle.
- It shows how local browser mechanics can stay useful while optional
  infrastructure adds persistence, proxies, CAPTCHA handling, and scale.
- Its codebase has already separated typed events, watchdogs, snapshots, and
  session behavior in a way that is useful to study independent of its Python
  stack.

What Yunti should absorb:

1. A scenario benchmark with success, wrong-action, recovery, latency, and
   observation-size metrics.
2. Typed runtime operation events with per-operation timeout, result, and error
   surfaces.
3. Watchdogs for crash, reconnect, download, popup, security, and permissions.
4. CDP-enhanced snapshots with `backendNodeId`, bounds, paint order, and
   stacking context for occlusion and clickability checks.
5. Runtime-enforced allowed/prohibited domain policy instead of only prompt
   guidance.
6. Structured download lifecycle events.
7. Optional HAR/trace/screenshot diagnostic bundles.
8. Event-driven readiness and reconnect quality metrics instead of fixed sleep.

What Yunti should not copy:

- Do not require browser-use's Agent class, prompt system, or model provider.
- Do not make a new temporary/headless Chromium instance the default.
- Do not turn stealth, proxies, CAPTCHA handling, or hosted filesystem/memory
  into Yunti's local-core assumptions.
- Do not import intrusive browser defaults that are unsuitable for a user's
  existing browser.
- Do not copy its Python module layout or event library instead of extracting
  the underlying contracts.

## Active Supporting References

These projects are narrow evidence sources, not product templates. Stale
projects are excluded from prioritization.

| Active reference | Official evidence | Narrow lesson |
| --- | --- | --- |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | accessibility snapshots, `browser_find`, existing-browser extension, origin controls, CLI/skill and MCP modes | targeted observation, actionability, auto-wait, slim profiles |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | performance insights, Lighthouse, screencast, heap diagnostics, slim mode | high-level diagnostic recipes over raw CDP |
| [Stagehand](https://github.com/browserbase/stagehand) | action preview, cache, validation, self-healing invalidation | deterministic recipe cache with fail-closed validation |
| [BrowserGym](https://github.com/ServiceNow/BrowserGym) | scenario suites, AgentLab traces, injection/security evaluation | benchmark design and hostile-page fixtures |

Remote-browser vendors remain evidence for an optional provider interface only.
They do not justify changing Yunti's local default.

## Current Yunti Baseline

`0.2.3` strengths that must be preserved:

- one controller transport per browser instead of one poller per page
- controller inventory, tab metadata, stale-session recovery, and content-script
  reinjection on demand
- fresh-uid DOM observation and structured click/fill/select/scroll results
- content-script and unrestricted CDP backends
- tabs, screenshots, network, console, upload, emulation, tracing, local
  console, doctor, MCP config generation, and packaged skill guidance
- local loopback operation without a token and no runtime LLM dependency
- DOM and diagnostic redaction contracts

This means the next cycle is not another session-registration rewrite. It is a
quality cycle for precision, reliability, evaluation, and recovery.

## Code-Gap Evidence In Current Yunti

The main post-0.2.3 gaps are visible directly in the current codebase:

1. Observation is still full-return and bounded only by coarse caps.
   - `extension/dom-observer.js` defaults to 200 elements and 12,000 text
     characters.
   - The observer returns a full observation each time instead of a targeted
     query or delta stream.
2. Target identity is intentionally short-lived.
   - `extension/dom-observer.js` rebuilds `uidCounter` on every observation.
   - `uidMapVersion` is still `observe-v1`.
3. Deep DOM normalization is missing.
   - `extension/dom-observer.js` starts from top-level
     `document.querySelectorAll(...)`.
   - Same-origin iframe traversal and open-shadow traversal are not normalized
     into the high-level observe contract.
4. Action waiting remains narrow.
   - `extension/tool-handlers.js` `waitForCondition(...)` only supports
     `text`, `selector`, or `urlContains`.
   - There is no shared actionability contract for attached, visible, stable,
     enabled, editable, or receives-events checks.
5. Activity history is too small for durable diagnosis.
   - `mcp/bridge-hub.js` sets `MAX_ACTIVITY_EVENTS = 100`.
6. Real browser E2E coverage is still thin relative to the next goals.
   - `tests/e2e.test.js` covers a valuable happy-path smoke, but not the
     broader matrix needed for benchmarked reliability.

## Evidence-Backed Gap Matrix

| ID | Current Yunti evidence | Reference evidence | Required upgrade |
| --- | --- | --- | --- |
| G1 Observation cost | full observation each call, 200-element / 12k-text cap | Page Agent uses compact interaction state; browser-use relies on indexed state; Playwright MCP provides bounded `browser_find` | add targeted find and observation deltas while preserving full observe |
| G2 Target lifetime | fresh uids are rebuilt every observe and stop being valid | both primary references treat current-state handles as ephemeral and add structured recovery around them | keep fresh uids, add semantic descriptors and validated recipes |
| G3 Action readiness | `wait_for` only supports text/selector/urlContains | Page Agent action sequencing and browser-use guarded execution both assume richer readiness | add shared actionability checks and bounded auto-wait |
| G4 Deep pages | top-level DOM query only, no normalized iframe/shadow path | real-world pages in both primary references require deeper page modeling | normalize same-origin frame/open-shadow targets and cross-origin routes |
| G5 Backend policy | DOM, screenshot, and CDP exist without one high-level decision contract | Page Agent optimizes around cheap state; browser-use supplements with deeper browser/session machinery | report backend choice and add a clear observation/action policy |
| G6 Self-healing | stale uids require re-observe and memory stores notes, not executable validated targets | browser-use and Stagehand both validate and recover from changed state | add semantic recipes, precondition validation, fail-closed invalidation |
| G7 Trajectory | only 100 in-memory activity events; failure artifacts are narrow | browser-use history and BrowserGym traces show the diagnostic value of durable action journals | add sanitized before/action/after journals and failure bundles |
| G8 Evaluation | one real-browser smoke is not a benchmark | browser-use publishes real-world benchmark thinking; BrowserGym supplies scenario methodology | establish a Yunti reliability benchmark before broad feature work |
| G9 Trust boundary | redaction and confirmation exist, but page text is not formally marked untrusted and origin policy is limited | BrowserGym security fixtures and Playwright MCP origin controls define concrete boundaries | mark page content untrusted and add origin policy/injection fixtures |
| G10 Context surface | 52 fine-grained tools are exposed to every MCP client | active MCP projects provide slim modes or CLI/skill alternatives | add `core`, `devtools`, and `full` profiles without removing tools |
| G11 Distribution | npm/unpacked updates can still require manual extension reload | Page Agent provides a store extension; active MCP tools ship skills/plugins | prepare store update path while keeping unpacked fallback |
| G12 Remote lifecycle | local existing-browser mode only | browser-use and active browser infrastructure vendors validate optional persistence and remote scale demand | define an optional provider boundary after local reliability work |
| G13 Route lifetime | controller recovery exists, but agents still retain transient `browserSessionId` values | browser-use separates browser/session lifecycle from page execution details; Page Agent refreshes ephemeral page state instead of promising permanent execution handles | add a stable tab-scoped `pageHandleId` and keep session replacement inside the runtime |

## P8 Execution Plan

### P8.0 - Reliability Benchmark Baseline (P0, Next)

Reason:

- browser-use's benchmark culture is the biggest missing feedback loop in Yunti
- without a baseline, adding more tools can increase complexity without
  improving completion

Scope and acceptance:

- build at least 30 deterministic scenarios covering forms, async UI, nested
  scroll, navigation, tabs, iframe, shadow DOM, downloads/uploads, stale
  targets, controller recovery, and guarded writes
- record success rate, wrong-action rate, recovery rate, duplicate-write count,
  p50/p95 latency, observation bytes, and approximate tokens
- run critical write scenarios 20 times with zero duplicate submissions
- require every later P8 slice to name the baseline metric it intends to
  improve

Non-goals:

- no public-leaderboard optimization before local workflows are reliable
- no runtime model dependency merely to run the benchmark

Detailed benchmark contract:
[RELIABILITY_BENCHMARK_PLAN.md](RELIABILITY_BENCHMARK_PLAN.md)

### P8.1 - Observation v2: Find, Delta, Deep Targets (P0)

Scope and acceptance:

- add a bounded semantic find returning snippets and target descriptors
- add `sinceObservationId` deltas with explicit full-observation fallback
- traverse open shadow roots and same-origin frames; expose cross-origin routes
- describe role, accessible name, text cues, relative context, frame/shadow
  path, field state, and geometry while keeping fresh observation-scoped uids
- reduce median observation payload by at least 50% without lowering benchmark
  success
- operate same-origin iframe and open-shadow fixtures without raw selectors

Non-goal:

- no promise of permanent element ids across arbitrary page mutations

### P8.2 - Typed Operation Lifecycle, Actionability, Cancellation (P0)

Scope and acceptance:

- share attached, visible, stable, enabled, editable, and receives-events
  checks across click/fill/select/upload/scroll
- use bounded waits with structured timeout reasons
- report backend, preconditions, dispatch, postcondition, and recovery
  candidates
- add typed operation events with per-action timeout, result, and error surface
- add watchdogs for crash, reconnect, download, popup, and security conditions
- propagate cancellation from MCP request down to bridge pending work, CDP, and
  page waits
- verify write outcomes before retry and fail closed when uncertain
- ensure dynamic-render and overlay fixtures require no agent-authored sleep
  loop

#### P8.2.4 - Stable Page Handle (P0, Next)

Make the live browser tab the agent-facing continuity unit. Add an opaque,
tab-scoped `pageHandleId` to target inventory and existing page tools while
keeping `browserSessionId`, `tabId`, and `targetId` backward compatible.
Navigation, reload, content-script replacement, MV3 restart, extension
reconnect, Bridge restart, and Edge sleeping-tab recovery must replace internal
sessions without changing the handle or asking the user to refresh.

Writes remain dispatch-once and fail closed when their result is uncertain.
Acceptance requires at least 100 forced internal session replacements, zero
externally visible stale-session failures while the tab remains live, zero
wrong-tab dispatches, zero duplicate writes, and no user-assisted recovery.
The complete identity, lifecycle, compatibility, rollout, and endurance
contract is in [STABLE_PAGE_HANDLE_PLAN.md](STABLE_PAGE_HANDLE_PLAN.md).

### P8.3 - Validated Target Recipes And Self-Healing (P1)

Scope and acceptance:

- cache recipes using role/name/text/relative context/frame path/postcondition
- validate page identity and target preconditions before dispatch
- on invalidation, re-observe and return ranked candidates instead of silently
  choosing a destructive replacement
- keep recipes local, versioned, redacted, inspectable, and removable
- valid recipes run without model inference; invalid recipes fail closed
- mutation scenarios materially outperform the uid-only baseline

### P8.4 - Persistent History, Sanitized Trajectory, Failure Replay (P1)

Scope and acceptance:

- separate persistent history from transient activity
- record opt-in before/action/after metadata, timing, target, backend, route,
  postcondition, and redaction mode
- export a failure bundle and provide a local viewer/replay harness
- keep screenshots, raw CDP, bodies, and field values opt-in
- diagnose a failed benchmark run from one bundle with no known secret residue

### P8.5 - Trust Boundary And Hostile-Page Tests (P1)

Scope and acceptance:

- mark page text and attributes as untrusted observations, never instructions
- add origin allow/block policy and redirect-chain reporting
- test instruction injection, exfiltration requests, confirmation bypass,
  unexpected navigation, and download/upload abuse
- distinguish policy denial, page failure, and transport failure

### P8.6 - Capability Profiles And Distribution (P1)

Scope and acceptance:

- add `core`, `devtools`, and `full` MCP profiles with discoverability
- keep full-tool clients compatible while reducing normal schema load
- continue Chrome/Edge store and automatic-update work
- keep npm/unpacked installation as a supported fallback

### P8.7 - Optional Remote Browser Adapter (P2)

Scope and acceptance:

- define provider-neutral connect/session/profile interfaces around CDP or
  Playwright endpoints
- keep local existing-browser mode as the default with no cloud account
- treat proxy, stealth, CAPTCHA, video, and persistence as provider
  capabilities, not core requirements
- begin only after P8.0-P8.3 show measurable local reliability gains

### P8.8 - DevTools Insight Packs (P2)

Scope and acceptance:

- add high-level performance summaries, optional Lighthouse, screencast, and
  heap diagnostics over existing CDP
- write large artifacts to files and return bounded MCP summaries
- keep this behind normal page-operation reliability

## Release Gates For The Next Version

1. Preserve the published `0.2.6` 38-scenario benchmark and latency metrics.
2. Preserve all controller/session/Edge recovery tests from `0.2.3`-`0.2.6`.
3. Preserve compatibility fields and the full MCP profile.
4. Run deterministic tests and opt-in real-browser E2E.
5. Report benchmark deltas against the `0.2.6` release-tree capture.
6. Prove zero duplicate submissions in repeated guarded-write scenarios.
7. Scan docs, logs, trajectories, and package contents for secret residue.
8. Update Tool Guide, packaged skill, usage hints, status, and migration notes
   whenever the agent workflow changes.
9. For P8.2.4, keep one `pageHandleId` across at least 100 internal session
   replacements with zero user-assisted recovery, wrong-tab dispatches,
   externally visible stale-session failures, or duplicate guarded writes.

## Deferred Or Rejected

- mandatory runtime LLM orchestration
- one opaque natural-language task tool as the default surface
- cloud-only execution as the default
- automatic replay of uncertain writes
- permanent element indexes
- stealth, proxy rotation, or CAPTCHA inside the local core
- prioritizing stale projects because they once had an interesting architecture
- advanced performance tooling ahead of observation/action reliability

## Recovery Prompt

```text
Continue Yunti Browser Runtime after 0.2.6. First read
docs/COMPETITOR_RESEARCH_2026.md, docs/PROJECT_STATUS.md,
docs/EXECUTION_PLAN.md, docs/STABLE_PAGE_HANDLE_PLAN.md, and
docs/NEXT_MAJOR_PLAN.md. Page Agent and browser-use are the primary references;
use other actively maintained tools only as narrow evidence and do not
prioritize stale projects. Preserve Yunti's local-first, existing-browser,
MCP-native, LLM-agnostic, fine-grained-tool, controller-recovery, redaction, and
unrestricted-CDP strengths. P8.0-P8.2.3 are complete. Start only P8.2.4a: add
the compatible pageHandleId contract and shared route resolver, then update
status and evidence. Do not begin P8.3 and never replay an uncertain write.
```
