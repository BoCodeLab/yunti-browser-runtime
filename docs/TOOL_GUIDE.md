# Tool Guide

## Agent Workflow

1. Call `yunti_get_tool_usage_hints` when unsure about parameters or routing.
2. Call `yunti_list_browser_targets` to understand the live browser state.
3. Keep a registered page's `browserSessionId`; when it is `null`, pass the
   target's `tabId` / `targetId` to the page tool for automatic recovery.
4. Once `yunti_observe_page` is available in the connected runtime, prefer
   `observe -> act by fresh uid -> observe/verify` for page operations.
5. Read `retryable`, `retryBudget`, `recoveryAction`, and `resultUncertain`.
   The entire recovery chain shares one budget; never retry an expired id.
6. For multi-step page work, prefer one stable `browserSessionId` throughout the
   task.

In `0.2.4+`, Microsoft Edge sleeping tabs use bounded recovery. If background
injection stalls, Yunti may briefly activate the target and then restore the
previously active tab. Agents must not ask the user to refresh, switch tabs, or
restart Edge before controller and explicit `tabId` / `targetId` recovery fail.
One page timeout does not imply that the controller or whole browser is offline.

Each browser/profile controller owns one bridge polling channel. Page sessions are
live-tab metadata, not independent polling connections. Stale-session errors
include a reason and recovery hint; do not repeatedly retry an unknown/closed tab.

In `0.2.5+`, Chrome, Edge, and separate profiles can coexist. Target rows include
`browserInstanceId`, `browserFamily`, and `routeBrowserSessionId`. Protocol
mismatch and ambiguous-browser errors have `retryBudget=0` and must not be retried.

In `0.2.7+`, target rows also include an opaque `pageHandleId`. Prefer it as the
durable route for multi-step work: it identifies one live tab inside one browser
instance and survives navigation, reload, content-script reinjection, MV3 worker
suspension, extension reconnect, and Bridge restart. Never parse, edit,
reconstruct, or persist a handle — only use values returned by the live
inventory. A handle is terminal with `retryBudget=0` when the tab closes
(`YUNTI_PAGE_HANDLE_CLOSED`), when the numeric tab id was reused for a different
tab (`YUNTI_PAGE_HANDLE_STALE`), when the value is malformed
(`YUNTI_PAGE_HANDLE_INVALID`), or when it conflicts with another supplied route
field (`YUNTI_PAGE_HANDLE_ROUTE_MISMATCH`). Browser-level and raw CDP tools do
not accept a handle.

For the full P6.3.1 workflow contract and copyable prompt, see
[Agent Workflow Contract](AGENT_WORKFLOW_CONTRACT.md).

## Default Page Operation Contract

1. Call `yunti_get_tool_usage_hints` when tool usage is uncertain.
2. Call `yunti_list_browser_targets` and choose the intended `pageHandleId`, or
   the `browserSessionId` / `tabId` when a handle is unavailable.
3. Call `yunti_observe_page` before page actions.
4. Prefer fresh uids for click, hover, fill, select, scroll, type, press,
   upload, and drag operations. In `0.2.6+`, each uid is scoped to the
   observation that returned it; never reuse it after another observe/find,
   wait, navigation, or rerender.
5. After each action, verify by observing again or using snapshot, evaluate,
   screenshot, network, or console tools.
6. For async rendering, validation, navigation, option loading, or infinite
   scroll, call `yunti_wait_for`, then `yunti_observe_page`, then continue with
   a fresh uid.
7. If a result has `ok: false`, `code`, `recoveryHint`, or `nextStepHint`,
   follow that guidance before retrying.
8. Use selector or coordinate fallback only when fresh uids are unavailable or
   as an explicit recovery/debugging path.

Ask the user before submitting, deleting, approving, purchasing, publishing,
uploading sensitive files, changing production data, exposing secrets, or
taking an action whose effect cannot be verified from page state.

## Minimal Use Cases

### Click

1. Call `yunti_list_browser_targets` and select the intended
   `browserSessionId`.
2. Call `yunti_observe_page` and choose the target element uid from the fresh
   observation.
3. Call `yunti_click` with `browserSessionId` and `uid`.
4. Read `ok`, `code`, `recoverable`, `recoveryHint`, and `nextStepHint`; if
   recoverable, follow the hint before retrying.
5. Call `yunti_observe_page` again or use screenshot/evaluate to verify the
   expected page change.

### Fill Form

1. Call `yunti_observe_page` and inspect field state: `fillable`, `readOnly`,
   `disabled`, `fillBlockReason`, `selectedValue`, `selectedText`, and
   `options[]`.
2. Fill editable fields with `yunti_fill` using fresh uids; select options with
   `yunti_select` using `uid` / `value` or `uid` / `text`.
3. For multiple fields, use `yunti_fill_form` when fields are known and inspect
   per-field `results[]`.
4. If async validation or option loading occurs, call `yunti_wait_for`, then
   `yunti_observe_page`, then continue with fresh uids.
5. Before submitting or changing production data, ask the user for
   confirmation.

### Scroll To Find

1. Call `yunti_observe_page` and inspect `scrollableContainers[]`.
2. Prefer `yunti_scroll` with a fresh scrollable container uid instead of
   document scroll for nested panels.
3. After scrolling, call `yunti_observe_page` and search the new
   `textTree` / `elements` for the target.
4. If `moved: false`, `partialMovement`, `edgeHint`, or `recoveryHint` appears,
   follow that guidance before repeating the same scroll.
5. When async content loads after scrolling, call `yunti_wait_for`, then
   `yunti_observe_page`, then continue with a fresh scroll container uid.

### Switch Tab

1. Call `yunti_list_browser_targets` to inspect current tabs and browser
   targets.
2. Choose the intended `browserSessionId` for Yunti page tools.
3. Use `yunti_select_page` when switching to a registered Yunti page route.
4. Use `yunti_cdp_send_command` with `Target.activateTarget` only for raw
   `targetId` / `tabId` browser target activation.
5. After switching, call `yunti_observe_page` or `yunti_get_page_snapshot` to
   verify the active page before acting.

### Wait For Async Result

1. Call `yunti_wait_for` with expected `text`, `selector`, or `urlContains`.
2. If `ok: true`, call `yunti_observe_page` and use fresh uids for follow-up
   actions.
3. If `code: "WAIT_TIMEOUT"`, observe or inspect current page state before
   adjusting the condition or retrying.
4. Do not reuse pre-wait uids for newly rendered content.
5. Verify the final result with observe, snapshot, evaluate, screenshot,
   network, or console tools.

## Core Tools

- `yunti_list_browser_targets`: canonical live inventory for tabs and targets.
- `yunti_list_pages`: compatibility alias for the same live inventory.
- `yunti_observe_page`: P6.1 observe-first page operation contract with fresh
  uids, compact text tree, scroll metadata, and DOM redaction metadata.
  Element entries may include `editable`, `fillable`, `readOnly`,
  `fillBlockReason`, select `selectedIndex` / `selectedValue` /
  `selectedText`, and `options[]` summaries for action planning.
  Default `balanced` redaction hides credential-like values; `strict` also
  hides likely email, phone, Luhn-valid payment-card-like values, address-like
  text, page titles, labels, names, visible text, placeholders, values, and
  select option text.
- `yunti_get_page_snapshot`: lightweight page state and visible context.
- `yunti_take_snapshot`: element-oriented snapshot for uid-based actions.
- `yunti_wait_for`: wait for async text, selector, or URL state before
  observing again and continuing with fresh uids. Text and selector matching
  traverses same-origin iframes and open shadow roots.
- `yunti_click`, `yunti_fill`, `yunti_hover`: common DOM actions.
- `yunti_cdp_send_command`: low-level CDP access routed through the extension.
- `yunti_get_network_log`, `yunti_list_network_requests`: sanitized network
  observations.
- `yunti_list_console_messages`: sanitized console diagnostics.
- `yunti_get_cdp_events`: raw low-level CDP diagnostics; clear after debugging.
- `yunti_remember_learning`, `yunti_get_learning_memory`: sanitized local agent
  memory.

## Routing Rules

- Standalone local mode defaults to `userId=local`.
- Agents do not need to pass `userId` unless they intentionally override
  `YUNTI_BROWSER_USER_ID`.
- `browserSessionId` identifies a registered browser page route; the controller
  is a transport route and is not a page id.
- In `0.2.5+`, one controller heartbeat per browser/profile keeps only that
  instance's live-tab page metadata current.
  Page tools automatically recover a stale session from its tab id, or accept a
  `tabId` / `targetId` from `yunti_list_browser_targets` directly.
- New tabs can return a new `browserSessionId`; use the returned value for
  follow-up calls on that tab.
- Raw `targetId` or `tabId` remains the target selector for CDP and can also be
  supplied to page tools for controller-driven session recovery.

## CDP Rules

- CDP and content-script actions are complementary first-class backends. Choose
  whichever offers better reach, reliability, and verification for the task.
- Use CDP directly for cross-origin frames, shadow DOM, canvas, precise input,
  browser targets, network control, emulation, tracing, or unreliable DOM paths.
- Chrome may show a debugger banner while attached. This is informational and
  should not cause an Agent to avoid CDP or reduce browser capability.
- CDP itself does not require user confirmation. Confirmation is based on the
  effect of an action, not the backend used to execute it.
- If a write action may already have executed, verify state before replaying it
  through either CDP or content script.
- Do not run CDP method names in a shell.
- Use `yunti_cdp_send_command` with `method` and optional `params`.
- `params` must be an object when provided.
- For `Target.activateTarget` or `Target.closeTarget`, pass top-level `tabId`
  or `targetId` with a valid `browserSessionId`.
- Use `Runtime.evaluate` for JavaScript evaluation, but keep related multi-step
  work in one eval when page state must stay in the same execution context.

## Parameter Rules

- `yunti_click` and `yunti_hover` require a `uid`, a `selector`, or both `x`
  and `y`; prefer a fresh uid from `yunti_observe_page` once available, or use
  `yunti_take_snapshot` for the current compatibility path.
- `yunti_fill` requires `value` and either `uid` or `selector`; it does not
  support coordinate-only targeting.
- `yunti_close_page` closes by `browserSessionId`; to close by raw `tabId` or
  `targetId`, use `yunti_cdp_send_command` with `Target.closeTarget`.
- `yunti_forget_learning_memory` requires `id`, or `all=true` plus
  `confirmed=true` when deleting every memory.
- `yunti_remember_learning` is for durable patterns and gotchas, not transcripts
  or raw payloads. It sanitizes likely secrets and PII-like text before storage,
  but agents should avoid submitting secrets, cookies, auth headers, private
  keys, payment data, or personal contact details in the first place.

## Action Recovery Rules

- After a click, fill, or hover, observe again or read page state before treating
  the action as successful.
- If a uid is stale or missing, call `yunti_observe_page` again for a fresh uid
  before retrying the same action.
- If an element may be outside the viewport, use observe scroll hints and
  `yunti_scroll` before falling back to coordinates.
- If the page is loading or changing, wait or observe again instead of blindly
  repeating the same action.
- For async UI transitions, use `yunti_wait_for` for expected text, selector, or
  page state, then call `yunti_observe_page` and continue with a fresh uid
  instead of reusing an old target.
- Read `yunti_wait_for` structured fields when present: `ok: true` means the
  wait condition matched; `code: "WAIT_TIMEOUT"` means inspect or adjust the
  condition before repeating the same wait.
- If the target tab is uncertain, call `yunti_list_browser_targets` and route
  follow-up work through the intended `browserSessionId`.

## Action Result Rules

- Current action results remain compatibility-shaped and may include fields such
  as `clicked`, `hovered`, `filled`, `selected`, `scrolled`, `typed`, `pressed`,
  `uploaded`, `dragged`, aggregate counts like `failed`, per-field `results`,
  wait fields like `found` / `waitedMs`, `uid`, `selector`, `x`, `y`, `method`,
  `valueLength`, `before`, `after`, and `browserSessionId`.
- P6.2 structured action result fields are being introduced additively. Agents
  should prefer `action`, `target`, `ok`, `recoverable`, and `nextStepHint` when
  present, while still preserving and reading compatibility fields. `code` and
  richer before/after summaries remain follow-on fields where useful.
- Do not treat a dispatched action as final proof of success; verify page state
  with observe, snapshot, evaluate, screenshot, or CDP when the workflow needs
  proof.
- Compatibility fields must remain available while structured result fields are
  introduced.

## Wait Guidance

- Use `yunti_wait_for` when async rendering, navigation, validation, dynamic
  select options, or infinite-scroll content needs time to appear.
- Provide at least one of `text`, `selector`, or `urlContains`; set
  `timeoutMs` only when the default is too short or too long.
- Successful waits preserve compatibility fields such as `found`, `text`,
  `selector`, `condition`, `value`, `waitedMs`, and `browserSessionId`, and may
  include `action: "wait_for"`, `target`, `ok: true`, `recoverable: false`, and
  `nextStepHint`.
- Timeout waits return `found: false`, `ok: false`, `recoverable: true`,
  `code: "WAIT_TIMEOUT"`, `recoveryHint`, and `nextStepHint`.
- After a successful wait, call `yunti_observe_page` again and use fresh uids
  for newly rendered elements. After a timeout, observe or inspect current page
  state before changing the wait condition or retrying.

## Fill Guidance

- Prefer a fresh `uid` from `yunti_observe_page` or `yunti_take_snapshot` when
  filling inputs, textareas, selects, or contenteditable targets.
- Before filling, inspect observation fields such as `fillable`, `readOnly`,
  `disabled`, `fillBlockReason`, and select `selectedValue` / `selectedText`
  / `options[]` when present.
- Uid-targeted contenteditable fills now return `method: "contenteditable"` and
  include `before` / `after` text length summaries when available.
- Treat contenteditable results as dispatch evidence, not final proof. Verify
  with observe, snapshot, evaluate `textContent`, or a page-specific assertion
  when exact editor state matters.
- Selector-based fill remains compatible and may return content-script-shaped
  fields such as `element` or `valueLength`.
- Uid and selector fill failures can return structured `filled: false`
  diagnostics with `code`, `ok: false`, `recoverable: true`, `recoveryHint`,
  and `nextStepHint`; follow `recoveryHint.nextAction` / `decision` before
  repeating the same fill.
- If a field appears after async rendering or validation, wait for the expected
  text/selector/state with `yunti_wait_for`, observe again, and fill with a
  fresh editable uid.
- Non-editable, hidden, disabled, or readonly fill targets return
  `code: "TARGET_NOT_EDITABLE"` diagnostics instead of being treated as
  successful fills; inspect the target or wait/unlock the field before retrying.
- Uid keyboard/contenteditable fills verify the post-fill value when possible.
  If the value does not remain, `yunti_fill` returns
  `code: "VALUE_NOT_APPLIED"` with `expectedValueLength`, `actualValueLength`,
  `recoveryHint`, and `nextStepHint` instead of exposing the raw field value.
  Inspect whether the target is framework-controlled, masked, or needs
  `yunti_type_text` / `yunti_press_key` semantics before retrying.
- Select-option fill misses include `availableValues` / `availableTexts` when
  available, so inspect those options before retrying with `yunti_fill` or
  `yunti_select`.
- `yunti_fill_form` preserves per-field compatibility results and can carry the
  same structured failure details on failed `results[]` items, including
  `code`, `recoveryHint`, `availableValues` / `availableTexts`, and
  `nextStepHint`.

## Scroll Guidance

- Prefer a fresh `scrollableContainers[]` uid from `yunti_observe_page` when
  scrolling nested app panels or sidebars.
- Uid-targeted scroll resolves the observed container center and reuses the
  existing coordinate/container scroll path, so coordinate recovery remains
  compatible.
- Uid scroll preserves the existing `target` compatibility field and adds
  `uid`, `method: "uid"`, and `scrollTarget` for structured interpretation.
- Coordinate scroll results may include `coordinateTarget`,
  `scrollContainerFound`, `coordinateScrollFallback: "document"`, and
  `coordinateFallbackHint`. Use these fields to tell whether the coordinate
  actually hit a nested scrollable container or fell back to document scrolling;
  when fallback appears, observe again and prefer a fresh
  `scrollableContainers[]` uid for nested panels.
- When `before` / `after` positions are comparable, scroll results include
  `moved`; if positions do not change, the result reports
  `code: "NO_SCROLL_MOVEMENT"`, `ok: false`, and `recoverable: true`.
  When direction can be inferred, it also includes `edgeHint` such as
  `possible-bottom-edge`, `possible-top-edge`, `possible-right-edge`, or
  `possible-left-edge`.
- `NO_SCROLL_MOVEMENT` results include `recoveryHint` with a structured
  `nextAction`, machine-readable `decision`, `recommendedTools`, current target
  type, and last observed container metadata when a fresh container uid was
  used. When the attempted direction is clear, `recoveryHint.suggestedRetry`
  also provides a one-shot opposite `deltaX` / `deltaY` to try before switching
  container or stopping.
- Partial movement results keep `ok: true` and add `partialMovement` with
  requested/actual delta summaries, affected axes, `edgeHint`,
  `decision: "observe-before-continuing-scroll"`, and `nextAction:
  "observe-again"`. Observe again before repeating the same scroll.
- Uid scroll failures can return structured `scrolled: false` diagnostics such
  as `code: "UID_NOT_FOUND"` or `code: "UID_COORDINATES_UNAVAILABLE"` with
  `recoveryHint.decision: "refresh-scrollable-container-uid-before-retry"`.
  Refresh observation and choose a fresh `scrollableContainers[]` uid before
  repeating the same uid scroll.
- After scrolling, observe again and compare document or container `before` /
  `after` positions before assuming the needed element is visible. Stop
  repeating the same scroll when `moved: false` appears; use `recoveryHint`,
  `decision`, `edgeHint`, and `suggestedRetry` to choose a different container,
  direction, or recovery path.
- If scrolling depends on newly loaded content, wait for the expected
  text/selector/state with `yunti_wait_for`, observe again, and choose a fresh
  `scrollableContainers[]` uid before continuing.

## Select Guidance

- Current `yunti_select` runtime behavior supports selector/value, uid/value,
  and uid/visible text.
- Use `text` with a fresh uid when the user-facing option label is clearer than
  the option value; selector path remains selector/value compatible.
- Uid and selector option misses, disabled options, plus non-select targets return structured
  `selected: false` diagnostics with `code`, `matchMode`, `targetOption`, and
  `recoveryHint`; option misses include `availableValues` / `availableTexts`
  when the page exposes them, while disabled-option failures can include
  `disabledValue` / `disabledText`.
- Before retrying a failed select, inspect available options with observe,
  snapshot, evaluate, a stable selector, or `recoveryHint.decision` instead of
  blindly repeating it.
- If select options are populated asynchronously, use `yunti_wait_for` for the
  expected option text or form state, then observe again and select with a fresh
  uid/value or uid/text.

## Safety Rules

- Read-only inspection is allowed by default.
- Destructive, financial, credential, upload, or submit actions should require
  explicit user confirmation in the agent workflow.
- Tool outputs redact likely cookies, authorization headers, passwords, and
  token-like values.
- Learning memory and console diagnostics sanitize likely secrets and PII-like
  text before local storage. Raw CDP events are the explicit low-level exception
  and should be cleared after debugging with `yunti_clear_cdp_events`.
- Use `yunti_observe_page` `redaction: "strict"` when the page may contain
  personal information. Keep `redaction: "off"` only for explicit local
  debugging.
- DOM observation redaction does not imply screenshot redaction; screenshots
  represent visible page pixels and may include sensitive content.
- Prefer sanitized tools for diagnostics: `yunti_list_network_requests`,
  `yunti_get_network_request`, `yunti_list_console_messages`, and
  `yunti_get_console_message`.
- Use `yunti_get_cdp_events` only for low-level protocol debugging. Filter by
  `method`, keep `limit` small, do not copy raw `params` into chat or learning
  memory, and clear with `yunti_clear_cdp_events` when done.
- Use screenshots only when visual proof is needed. Prefer viewport screenshots
  over `fullPage` when sufficient, and summarize safe findings instead of
  storing raw image data in learning memory.
