# Next Major Plan: 0.2.0 Best Browser Automation Runtime

This document is the durable planning contract for the `0.2.0` development
cycle, now completed by `yunti-browser-runtime@0.2.0`.

## Goal

Build the most useful browser automation operation layer for AI agents and
developers: local-first, LLM-agnostic, MCP-native, and able to operate the
user's real Chrome/Edge browser through fine-grained, inspectable tools.

`0.2.0` should strengthen Yunti's own direction while absorbing the best
practical ideas from the broader browser automation ecosystem:

- observe pages in a compact, agent-friendly text form;
- act through stable element ids and robust DOM action semantics;
- verify each step with clear recovery hints;
- keep sensitive page content redacted by default;
- combine page-level DOM automation with browser-level CDP, tabs, screenshots,
  network, console, file upload, and diagnostics;
- make both human operators and external agents confident about what happened
  and what to do next;
- preserve the current local-first, zero-config install path.

## Product Promise

`0.2.0` should let any MCP agent operate the user's already-open local
Chrome/Edge browser in an observable, recoverable, and auditable way without
asking the user to understand CDP, CSS selectors, browser-extension tokens, or
complex setup.

The practical promise is:

- fewer mis-clicks because agents act through fresh observed uids;
- fewer blind retries because actions return recovery hints;
- less user setup friction because the local zero-config path remains the
  default;
- clearer safety boundaries because observation, diagnostics, and screenshots
  document what they do and do not redact;
- stronger real-browser workflows because Yunti keeps tabs, CDP, screenshots,
  network, console, file upload, and diagnostics alongside page-level DOM
  automation.

Execution should stay incremental. The first implementation slice should focus
on Page Agent / browser-use style page observation and indexed actions. Other
ecosystem lessons are backlog inputs for later phases after the observe/action
spine is stable.

## Planning Discipline Before Code

Before each implementation slice, update this document and
`docs/EXECUTION_PLAN.md` with the concrete scope, non-goals, acceptance checks,
and the reason the slice strengthens Yunti's own product direction.

This prevents two failure modes:

- copying a reference project's architecture instead of extracting useful
  concepts;
- starting a broad rewrite before the current Yunti tool surface has a stable
  incremental path forward.

For `0.2.0`, code should move only after the relevant phase has:

- a user-facing capability statement;
- a stable tool/API contract or compatibility rule;
- an explicit "not this phase" list;
- tests or smoke checks that prove the slice works;
- documentation updates that an external agent can follow.

## Yunti-First Principle

Yunti should not become a clone of any single existing tool. Every browser
automation project is a source of ingredients, not the target architecture.

Yunti's distinctive strengths are:

- local MCP bridge that any agent can connect to;
- fine-grained `yunti_*` tools instead of a single opaque task runner;
- real user Chrome/Edge state, tabs, login sessions, screenshots, CDP, network
  observations, and console diagnostics;
- zero LLM API dependency inside the runtime;
- zero-config local install path after extension loading;
- security boundaries based on local loopback, optional token hardening, and
  explicit redaction.

## Ecosystem Lessons To Absorb

The order matters. Start with Page Agent / browser-use for P6.1 and P6.2, then
fold in other automation-system lessons step by step.

### browser-use / Page Agent

What to absorb first:

- text-oriented DOM observation;
- indexed interactive elements;
- scroll hints and scrollable-container metadata;
- better DOM action semantics;
- task history/activity concepts for optional diagnostics;
- content masking hooks.

How Yunti should differ:

- do not move the LLM loop into the runtime core;
- keep Yunti as the browser hands/eyes for any external agent;
- preserve fine-grained tools instead of only natural-language task execution.

Reference audit from `alibaba/page-agent`:

- `PageController.getBrowserState()` is the closest reference for P6.1:
  combine URL/title, page metrics, scroll hints, and compact interactive DOM
  text into one agent-facing observation.
- `updateTree()` separates observation refresh from action execution. Yunti
  should mirror the idea by making `yunti_observe_page` the explicit refresh
  step before uid-based actions.
- `selectorMap` and simplified HTML show why indexed elements are easier for
  agents than raw CSS selectors. Yunti should adapt this into stable `uid`
  fields while keeping its current `yunti_*` tool style.
- `data-scrollable` metadata is worth absorbing because multi-panel business
  apps often need container scrolling instead of page scrolling.
- Action code around click, input, select, and scroll is useful as an event
  sequencing reference, especially for contenteditable and scrollable
  containers.
- The prompt rules around evaluating previous action results, avoiding blind
  retries, and scrolling only when there are pixels above/below should inform
  Yunti skill/tool hints.

What not to copy:

- Page Agent's built-in LLM loop is not Yunti's runtime responsibility.
- Page Agent's hub/sidebar/operator UI should not become required for Yunti's
  default local path.
- Page Agent's single-page-task framing should not remove Yunti's tab, CDP,
  network, console, screenshot, file upload, and diagnostics capabilities.
- Numeric indexes can inspire the UX, but Yunti should keep `uid` naming
  aligned with existing `yunti_take_snapshot` and action tools.

Page Agent / browser-use should remain the first DOM observation/action
reference only. Yunti's product boundary remains broader: MCP connection,
real-browser sessions, tab routing, CDP escape hatches, network/console
diagnostics, screenshots, uploads, local installation, and explicit safety
controls.

### Playwright / Puppeteer / Selenium

What to absorb:

- reliable action semantics for click, fill, select, keyboard, upload, wait, and
  navigation;
- clear locator strategy and auto-waiting behavior;
- trace-style debugging and reproducible action logs;
- screenshot/video/artifact thinking for failures;
- browser context and tab management discipline.

How Yunti should differ:

- operate the user's already-open real browser instead of forcing a separate
  test-runner profile;
- expose capabilities through MCP tools that external agents can compose;
- keep install and runtime local-first.

### Chrome DevTools Protocol

What to absorb:

- complete browser-level power: targets, runtime evaluation, screenshots,
  network, console, performance, DOM, file upload, and emulation;
- precise low-level escape hatches when high-level DOM actions are not enough.

How Yunti should differ:

- wrap CDP with safer, friendlier workflows and recovery hints;
- avoid forcing agents to know raw CDP for common tasks.

### BrowserGym / Web Evaluation Harnesses

What to absorb:

- scenario-based task evaluation;
- deterministic smoke pages and fixtures;
- measurable success/failure criteria for browser actions;
- regression suites for common interaction patterns.

How Yunti should differ:

- prioritize real local browser usefulness over benchmark-only behavior.

### Browser Extensions And Local Runtimes

What to absorb:

- easy install/update paths;
- visible runtime health and connection status;
- permission transparency;
- optional debugging UI that does not block first use.

How Yunti should differ:

- keep the default popup zero-config;
- make richer UI optional and diagnostic, not mandatory.

When a design choice conflicts with Yunti's current strengths, keep Yunti's
current strengths.

## Reference Absorption Ladder

Yunti should absorb browser automation ideas in this order:

1. **Observe/action spine**: Page Agent and browser-use inspire compact page
   observation, indexed interactive elements, and scroll hints.
2. **Action reliability**: Playwright, Puppeteer, and Selenium inspire more
   predictable clicking, filling, selecting, waiting, and upload behavior.
3. **Diagnostics and escape hatches**: CDP remains Yunti's deep browser-control
   layer for screenshots, network, console, targets, runtime evaluation, and
   lower-level recovery.
4. **Regression confidence**: BrowserGym-style fixtures and scenario checks
   help measure whether common browser actions keep working.
5. **Operator experience**: extension/runtime patterns help reduce install
   friction and make connection health visible without adding mandatory UI.

Each rung must be additive. If a new idea requires removing fine-grained
`yunti_*` tools, hiding browser state behind an opaque task runner, or requiring
an LLM provider key inside the runtime, it does not belong in the default
`0.2.0` path.

## Non Goals

- Do not require an LLM API key inside Yunti Browser Runtime.
- Do not replace fine-grained `yunti_*` MCP tools with a single black-box
  natural-language `execute_task` tool.
- Do not make a hub tab, side panel, or UI console mandatory for first use.
- Do not mix remote multi-user mode into the local single-user core.
- Do not remove CDP, network, console, screenshot, or tab-level capabilities in
  favor of a narrower page-only agent abstraction.
- Do not treat compatibility or API parity with any reference project as a goal.
- Do not optimize only for benchmarks while making real user-browser automation
  harder.
- Do not weaken the local loopback security boundary or publish real secrets in
  docs, config output, logs, or tests.

## Release Theme

`0.2.0` should be a compatibility-preserving enhancement release that makes
Yunti feel like the most practical browser automation layer for agents. Existing
tools continue to work, while agents are guided toward a stronger default
workflow:

```text
yunti_observe_page -> yunti_click/fill/select/scroll by uid -> observe/verify
```

`yunti_take_snapshot` remains available as the compatibility path. Both it and
`yunti_observe_page` mint action-ready uids: observation uids carry viewport
rects directly, and snapshot uids resolve their rects through the accessibility
tree while the debugger is attached.

Success metrics:

- an agent can identify the active browser page and interact with it without
  asking the user for tokens or selectors;
- `observe -> action by uid -> observe` becomes the documented default path;
- common failures return actionable next steps instead of opaque errors;
- sensitive credential-like values are not exposed by default observation;
- existing `yunti_get_page_snapshot`, `yunti_take_snapshot`, CDP, screenshot,
  network, console, upload, and tab tools remain compatible;
- at least one deterministic fixture proves
  `observe -> click/fill/select/scroll -> observe verify -> recover`.

Tool choice:

- Use `yunti_observe_page` for the normal agent loop.
- Use `yunti_get_page_snapshot` for lightweight route/title/text/auth overview.
- Use `yunti_take_snapshot` as the compatibility path for existing uid-based
  action workflows.
- Use screenshot tools for visual inspection, with the assumption that
  screenshots may contain all visible sensitive page content.
- Use CDP tools for low-level browser recovery or capabilities not covered by
  high-level DOM tools.

## Phase Plan

### P6.0 Product Direction Guardrail

Status: complete.

The release direction is Yunti-first and ecosystem-informed:

- keep Yunti local-first, LLM-agnostic, MCP-native, and real-browser-oriented;
- absorb useful ideas from Playwright, Puppeteer, Selenium, CDP, browser-use,
  Page Agent, BrowserGym, and extension runtimes;
- do not clone a single project or weaken Yunti's current strengths.

### P6.1 Agent-Friendly Page Observation

Status: complete. P6.1.4 real-browser closure passed with Playwright 1.58.0
(`observe -> click uid -> verify`); see `EXECUTION_PLAN.md`.

Create `yunti_observe_page`, a higher-level observation tool. Use Page Agent's
PageController/browser-state approach as the first concrete reference, adapted
to Yunti's MCP/extension architecture. It returns:

- current `browserSessionId`, URL, title, origin, and captured timestamp;
- viewport size, page size, scroll position, pages above/below, and pixels
  above/below;
- compact text DOM tree for visible interactive elements;
- stable uid for each actionable element;
- role, tag, name/text, label, placeholder, value preview policy, rect, disabled
  state, and visibility state;
- scrollable container metadata, including vertical/horizontal scroll capacity;
- optional full-page mode with bounded element and text limits;
- clear next-step hints when no elements are visible, the page is restricted, or
  the content script is stale.

First slice:

- add the tool as an additive replacement path, not a breaking change to
  `yunti_get_page_snapshot` or `yunti_take_snapshot`;
- prefer content-script DOM collection first so basic observation works without
  CDP attachment;
- return both structured fields and a compact text tree so agents can choose
  programmatic or prompt-oriented consumption;
- keep uid generation scoped to the latest observation and make stale uid errors
  point back to `yunti_observe_page`;
- redact sensitive input values by default, even before the full P6.4 policy is
  complete.

Input contract:

- `browserSessionId`: optional target browser session.
- `mode`: `viewport` by default, with bounded `fullPage` support later.
- `maxElements`: bounded element limit.
- `maxTextLength`: bounded text limit.
- `includeHidden`: defaults to false.
- `includeTextTree`: defaults to true.
- `includeRects`: defaults to true.
- `redaction`: defaults to `balanced`; `strict` is allowed for stronger
  privacy; `off` is reserved for explicit local debugging only and must not be
  used by default agent workflows.

Output contract:

- `observationId`, `browserSessionId`, `capturedAt`, and `uidMapVersion`.
- `page`: URL, sanitized URL preview, title, origin, and document ready state.
- `viewport`: width, height, device pixel ratio.
- `scroll`: x/y position, page size, pixels/pages above and below.
- `elements[]`: `uid`, `role`, `tag`, `name`, `text`, `label`,
  `placeholder`, `valuePreview`, `valueRedacted`, `type`, `hrefPreview`,
  `rect`, `visible`, `disabled`, `editable`, `checked`, `selected`,
  `scrollable`, and `containerUid` where applicable.
- `textTree`: compact line-oriented representation of visible interactive
  elements.
- `scrollableContainers[]`: `uid`, `tag`, `name`, `rect`, `scrollTop`,
  `scrollHeight`, `clientHeight`, `canScrollVertical`,
  `canScrollHorizontal`, and pixels available in each direction.
- `limits`: returned/max element and text counts plus truncation flags.
- `redactions`: redaction mode, count, categories, and whether values were
  suppressed.
- `hints[]` and `warnings[]`: next-step and degraded-observation guidance.

Uid lifecycle:

- uids from `yunti_observe_page` are valid for the latest observation in the
  current `browserSessionId`, not permanent selectors.
- Actions should accept uids from either `yunti_observe_page` or
  `yunti_take_snapshot`, but errors must explain which refresh step is needed.
- Stale uid errors should use a structured code such as
  `STALE_OBSERVATION_UID` and recommend calling `yunti_observe_page` again.
- uid maps must stay in memory only; they must not be written to learning
  memory, task history, or persistent diagnostics.

Minimum P6.1 redaction baseline:

- default `balanced` redaction hides password fields, hidden token-like fields,
  token/secret/auth/cookie/session/api-key/credential/otp-like values, JWT-like
  values, Bearer-like values, private-key-like values, and long random-looking
  strings;
- observation uses an attribute allowlist rather than returning arbitrary DOM
  attributes;
- URL query values are summarized or partially redacted by default;
- screenshot redaction is not implied by DOM redaction;
- P6.4 will deepen the policy with optional strict PII redaction and aligned
  DOM/network/console behavior.

Restricted-page and degraded-state hints:

- content script not available;
- unsupported URL such as browser internal pages;
- cross-origin iframe content omitted;
- stale browser session;
- tab changed or no active browser page;
- no visible interactive elements;
- page still loading or action verification uncertain.

Page Agent mapping:

- `BrowserState.header` maps to Yunti's `page`, `viewport`, `scroll`, and
  `hints` fields.
- `BrowserState.content` maps to Yunti's `textTree` plus structured
  `elements[]`.
- `BrowserState.footer` maps to Yunti's above/below scroll hints.
- `selectorMap` maps to Yunti's latest observation uid map.
- Page Agent's `data-scrollable` string maps to Yunti's structured
  `scrollableContainers[]`.

Not this phase:

- no LLM task loop inside the runtime;
- no Page Agent hub tab, side panel, or visual console requirement;
- no full Playwright-style locator engine;
- no benchmark harness beyond a focused fixture/smoke test;
- no remote multi-user browser orchestration.

Acceptance:

- `yunti_observe_page` works on a simple page without CDP attachment.
- It returns a readable tree that an LLM can use without raw selectors.
- It includes scroll hints comparable to "pixels below" and "pages below".
- It redacts sensitive values by default.
- Unit tests cover schema, routing, stale-session recovery, and a fixture page.
- E2E smoke can use `observe -> click uid -> observe` on the test page.
- P6.1 is complete only after schema tests, bridge routing tests, content
  fixture tests, real-browser smoke, skill guidance, and tool usage hints are
  updated.

### P6.2 Robust DOM Action Layer

Status: completed through real-browser validation.

Extract DOM actions from the current content/tool handler code into a focused
module such as `extension/dom-actions.js`. Use Page Agent's action sequencing
as the first reference for click/input/select/scroll behavior, then evolve with
additional lessons from Playwright/CDP in later increments.

Scope:

- use consistent pointer/mouse event order for click and hover;
- improve text input for input, textarea, select, and contenteditable;
- support select-by-visible-text and select-by-value;
- improve uid-targeted fill so contenteditable and rich text editors get better
  fallback behavior;
- support scrolling the document or a scrollable container by uid;
- return structured action results with before/after summary where useful.

Action priority:

- P0: click by uid, fill input/textarea/contenteditable by uid, and verify by
  observing again.
- P0: page and container scrolling recovery.
- P1: select-by-visible-text, select-by-value, dropdown recovery, tab selection,
  and wait/verify templates.
- P2: deeper diagnostics that connect console/network/screenshot/CDP evidence
  to action recovery hints.
- Not now: canvas automation, CAPTCHA solving, complex drag workflows, or a
  black-box task runner.

First slice:

- keep existing `yunti_click`, `yunti_hover`, `yunti_fill`, `yunti_select`,
  `yunti_type_text`, `yunti_press_key`, and `yunti_scroll` names stable;
- make uid-based actions work naturally after `yunti_observe_page`;
- improve errors so agents understand whether to observe again, scroll, wait, or
  switch tabs;
- keep selector and coordinate fallbacks available for recovery and debugging.

Action result contract:

- return the action name, `browserSessionId`, target uid/selector/coordinate,
  success flag or clear failure code, and a human-readable `nextStepHint`;
- include before/after summaries when useful, such as scroll position, input
  value length, selected option, URL/title change, or detected toast/popup;
- mark recoverable failures explicitly so agents know whether to observe,
  scroll, wait, switch tabs, or ask the user;
- update `yunti_select` planning to support uid and visible text, while keeping
  the current selector/value path compatible.

Page Agent mapping:

- `clickElement()` informs Yunti's pointer/mouse/focus/click event order.
- `inputTextElement()` informs contenteditable fallback sequencing and
  verification.
- `selectOptionElement()` informs select-by-visible-text behavior.
- `scrollVertically()` and `scrollHorizontally()` inform uid-targeted container
  scroll behavior and reached-edge result messages.

Not this phase:

- no large action-runner abstraction that hides individual tool calls;
- no mandatory replay/trace UI;
- no removal of CDP-based fallback behavior.

Acceptance:

- Existing `yunti_click`, `yunti_hover`, `yunti_fill`, `yunti_select`,
  `yunti_type_text`, `yunti_press_key`, and `yunti_scroll` tests keep passing.
- New tests cover contenteditable, select option text, scrollable containers,
  missing uid, stale uid, and action result shape.
- Tool errors recommend running `yunti_observe_page` before retrying.

### P6.3 Agent Workflow Contract

Status: complete. P6.3.1 shipped `docs/AGENT_WORKFLOW_CONTRACT.md`; P6.3.2
shipped the minimal use cases in the Tool Guide, `yunti_get_tool_usage_hints`,
and the packaged skill.

Make the recommended agent workflow explicit in docs, skill, and tool hints.

Scope:

- update `skills/yunti-browser-runtime/SKILL.md` with `observe -> act -> verify`;
- add guidance to evaluate the previous action before retrying;
- discourage repeated blind retries and coordinate-only actions;
- add examples for form filling, tab switching, dropdowns, and scroll recovery;
- add a copyable external-agent prompt for the default Yunti workflow;
- define verification templates for URL changes, visible text, toast messages,
  element disappearance, input value changes, list/table updates, and dialogs;
- define recovery taxonomy for stale sessions, stale uids, hidden/disabled
  elements, covered elements, pending navigation, wrong tab, and restricted
  pages;
- consider local task-history tools:
  - `yunti_begin_task`
  - `yunti_record_step`
  - `yunti_get_task_history`
  - `yunti_end_task`

Acceptance:

- Skill and tool hints consistently prefer `yunti_observe_page`.
- Agents can recover from failed action by observing again and using a fresh uid.
- `yunti_observe_page` release includes updated `yunti_get_tool_usage_hints`;
  this cannot wait until late P6.3.
- Optional task-history tools, if implemented, store no secrets and are scoped to
  the local user.

### P6.4 DOM Redaction And Page Content Policy

Status: complete for the current 0.2.0 planning scope. P6.4.1 DOM strict
redaction, P6.4.2 memory/console diagnostic sanitization, and P6.4.3 raw
diagnostics / screenshot non-redaction guidance are implemented.

Promote DOM snapshot redaction to a first-class runtime capability.

Scope:

- redact password fields, hidden token-like fields, auth-like attributes, and
  long credential-looking strings;
- in `strict`, redact likely email, phone, address-like, and Luhn-valid
  payment-card-like values across page titles, labels, names, visible text,
  placeholders, values, selected option text, and option text;
- add local configuration for redaction modes:
  - `strict`
  - `balanced`
  - `off` for local debugging only;
- show redaction metadata in observation output;
- keep network, console, and learning-memory redaction behavior aligned with
  DOM redaction.

P6.1 already carries the minimum DOM observation baseline. P6.4 is for expanding
coverage, making strict mode robust, aligning DOM/network/console terminology,
and documenting cleanup/diagnostic retention behavior.

Implemented slices:

- P6.4.1: strict DOM observation redaction for common PII-like text surfaces.
- P6.4.2: shared MCP text sanitization before learning-memory writes and
  console diagnostic caching, with raw CDP events documented as the explicit
  low-level exception.
- P6.4.3: raw CDP and screenshot tools now expose usage guidance for sanitized
  tool preference, method/limit scoping, CDP cleanup, screenshot non-redaction,
  viewport preference, and safe summarization.

Security caveats to keep explicit:

- DOM redaction is not complete data-loss prevention; visible business data can
  still be returned.
- Screenshots are real visible pixels and should be treated as sensitive unless
  future pixel masking exists.
- External agents may transmit observed page content according to their own
  policies; Yunti can keep the runtime local but cannot promise what a third
  party agent does with returned content.

Acceptance:

- Sensitive input values are not returned by default observation tools.
- Redaction behavior is deterministic and unit tested.
- Docs explain what is and is not redacted.

### P6.5 Optional Local Runtime Console

Status: complete. P6.5.1 through P6.5.3 shipped `/console`,
`/console/state`, `/console/cancel-pending`, the `console` CLI command, and
real-browser validation.

Create a non-required local console for debugging and operator confidence.

Scope:

- list bridge status and connected browser sessions;
- show recent MCP tool calls, action results, errors, and stale-session events;
- provide a stop/cancel affordance for pending browser tasks;
- display extension version and bridge version mismatch warnings;
- keep popup zero-config and small.

Acceptance:

- The console is optional and never blocks the first-run path.
- It exposes no raw secrets.
- It shows sanitized summaries by default, not raw DOM, screenshots, console
  payloads, network bodies, or credential-like values.
- It helps diagnose "extension loaded but no page connected" without asking the
  user to inspect logs manually.

P6.5.1 completed:

- Optional `/console` page served by the local bridge.
- Protected `/console/state` JSON with sanitized session, pending request,
  diagnostic-count, and recent activity summaries.
- Protected `/console/cancel-pending` action for queued/runtime-pending browser
  requests, with an explicit boundary that it does not undo browser-side
  effects that already happened.
- `yunti-browser-runtime console` CLI entry that starts the bridge and prints
  the console URL.

P6.5.2 completed:

- `HEAD /console` works for simple local probes.
- Console state includes runtime version, expected extension version, connected
  session extension versions, and warning entries.
- Extension sessions report `client.extensionVersion`.
- Console UI renders version metadata and warning cards.
- `doctor` JSON and human summary include the optional console URL.

P6.5.3 completed:

- Real-browser E2E validates `HEAD /console`, `/console`, `/console/state`,
  runtime/extension version alignment, connected page state, and absence of
  no-page/version-mismatch warnings after a page registers.
- Remaining stale-session and extension-not-loaded UX refinement can continue as
  polish, but P6.5 no longer blocks the 0.2.0 direction.

### P6.6 Extension Distribution Readiness

Status: complete for `0.2.0` npm/unpacked release scope. P6.6.1, P6.6.2, and
P6.6.3 are complete. P6.6.4 is deferred to the post-0.2 store-candidate track.

Prepare for browser-store distribution to reduce manual loading friction.

Scope:

- review Chrome Web Store and Edge Add-ons permission text;
- write public privacy and permission rationale docs;
- decide whether broad host permissions remain required or can be narrowed;
- produce store-ready icons, screenshots, and package artifacts;
- keep unpacked extension support for developers and npm installs.

Acceptance:

- A store submission checklist exists.
- Permission rationale is understandable to non-developers.
- Release packaging can produce both npm package and extension-store artifact.

P6.6.1 completed:

- Added `docs/EXTENSION_DISTRIBUTION.md` as the durable browser-store readiness
  audit.
- Audited the current `extension/manifest.json` permissions and broad host
  access without changing runtime behavior.
- Captured Chrome Web Store and Edge Add-ons policy references, store material
  checklist, privacy disclosure topics, and permission narrowing options.
- Linked the audit from README, Security notes, and Roadmap so it stays visible
  before any store-distributed release.

P6.6.2 scope:

- Draft store-facing permission and privacy copy for `debugger`, `tabs`,
  `webRequest`, broad `http` / `https` access, localhost bridge access,
  screenshots, DOM observation, network/console diagnostics, and learning
  memory.
- Keep this as copy and decision support first; manifest narrowing remains a
  later tested implementation slice.

P6.6.2 completed:

- Added `docs/EXTENSION_STORE_COPY.md` as the draft store copy pack.
- Drafted short and long descriptions, permission rationale, privacy-policy
  language, store data disclosure guidance, reviewer notes, and final review
  checklist.
- Kept the current extension manifest and runtime behavior unchanged.

P6.6.3 scope:

- Decide the pre-store permission strategy for broad host permissions and
  `webRequest`: keep broad install-time access, move to optional host
  permissions, optionalize diagnostics, or explicitly defer store submission.
- If behavior changes, update `extension/manifest.json`, extension UX,
  `mcp/tools.js`, Tool Guide, packaged skill, Security notes, and tests in one
  small compatibility-preserving slice.

P6.6.3 completed:

- Added `docs/EXTENSION_PERMISSION_STRATEGY.md` as the pre-store permission
  decision record.
- Kept the npm/unpacked developer path unchanged for `0.2.0`.
- Decided that the current broad-permission manifest should not be submitted to
  browser stores unchanged by default.
- Defined a future store-candidate track around optional host access and
  optional network diagnostics, without changing runtime behavior yet.

P6.6.4 deferred:

- Design the store-candidate permission UX and technical prototype plan:
  optional host access, missing-permission recovery, optional diagnostics, and
  the exact docs/tool/skill/test surfaces that would change.
- This is not a `0.2.0` npm/unpacked release blocker.

### P7.1 0.2.0 Release Closure

Status: completed.

Scope:

- bump package and extension versions to `0.2.0`;
- preserve the npm/unpacked developer path and current local runtime behavior;
- run metadata, release, real-browser E2E, dry-run, publish, and
  post-publish verification gates.

## Suggested Implementation Order

1. P6.1 `yunti_observe_page`
2. P6.2 robust DOM action layer
3. P6.3 skill/tool workflow updates
4. P6.4 DOM redaction policy
5. P6.5 optional console
6. P6.6 store distribution readiness

The first two phases should be treated as the technical core of `0.2.0`, but
they must remain additive enhancements to Yunti's MCP tool surface.

For the first implementation cycle, do not attempt to absorb every ecosystem
lesson at once. Complete the Page-Agent-informed observe/action foundation
first, then add Playwright/CDP/BrowserGym-style reliability and diagnostics in
separate follow-up increments.

## Compatibility Rules

- Keep existing `yunti_*` tools unless a replacement has shipped and docs have a
  migration path.
- Add aliases only when they reduce agent confusion.
- Avoid breaking package install, MCP config printer, doctor, and bridge startup.
- Preserve Yunti's CDP, tab, network, console, screenshot, and fine-grained DOM
  action capabilities.
- Maintain Node.js `>=22`.
- Keep local default tokenless loopback behavior unless binding is non-loopback
  or `YUNTI_BROWSER_BRIDGE_TOKEN` is explicitly configured.

## Validation Gates

For every phase:

```bash
npm run check
npm test
```

When observation/action behavior changes:

```bash
npm run release:check
YUNTI_E2E=1 npm run test:e2e
```

P6.1/P6.2 fixture matrix:

- `observe-basic.fixture.html`: title, links, buttons, labels, inputs,
  textarea, select, and visible element metadata.
- `observe-redaction.fixture.html`: password, hidden token, ordinary search
  input, credential-looking strings, and redaction metadata.
- `observe-scroll.fixture.html`: long page and nested scroll container.
- `observe-dynamic.fixture.html`: DOM change after action and stale uid
  recovery.
- `actions-form.fixture.html`: click, fill, select-by-text, select-by-value,
  and event counters.
- `actions-contenteditable.fixture.html`: contenteditable edit and verification.
- `actions-scroll-container.fixture.html`: uid-targeted container scrolling and
  reached-edge feedback.

The fixture suite is for deterministic local regression, not benchmark
optimization.

Before publishing `0.2.0`:

```bash
npm run release:check
npm run release:publish
npm run release:verify-published
```

## Current Next Step

Start with docs-first P6.1 preparation:

1. Confirm the `yunti_observe_page` output contract in this plan and
   `docs/EXECUTION_PLAN.md`.
2. Confirm how its uid map relates to existing `yunti_take_snapshot` uid
   behavior.
3. Confirm the first smoke fixture: `observe -> click uid -> observe`.
4. Confirm default redaction rules for password/token-like values.
5. Only then begin the implementation slice:

   - define the `yunti_observe_page` schema in `mcp/tools.js`;
   - implement content-script collection for page metrics and interactive text
     tree;
   - add routing through the extension dispatcher;
   - add unit tests for schema/routing and an E2E smoke update;
   - update skill and docs to prefer observe-first workflows.
