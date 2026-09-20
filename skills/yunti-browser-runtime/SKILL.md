---
name: yunti-browser-runtime
description: Use when an agent needs to operate or inspect a user's browser through Yunti Browser Runtime MCP tools, including viewing pages, switching tabs, clicking, typing, screenshots, network or console logs, CDP commands, browser target inventory, or recovering stale browserSessionId routes.
---

# Yunti Browser Runtime

## First Step

For any browser task, first call `yunti_get_tool_usage_hints` unless the user is only asking a conceptual question.

Then call `yunti_list_browser_targets` to understand the live browser state before choosing a page or tab.

## Default Page Operation Contract

1. Call `yunti_get_tool_usage_hints` when tool usage is uncertain.
2. Call `yunti_list_browser_targets`; use the intended page's
   `browserSessionId` when registered, otherwise use its `tabId` / `targetId`.
3. Call `yunti_observe_page` before page actions.
4. Prefer fresh uids for click, hover, fill, select, scroll, type, press, upload, and drag operations. A uid belongs only to the observation that created it; never carry it across a later observe, find, wait, navigation, or rerender.
5. After each action, verify by observing again or using snapshot, evaluate, screenshot, network, or console tools.
6. For async rendering, validation, navigation, option loading, or infinite scroll, call `yunti_wait_for`, then `yunti_observe_page`, then continue with a fresh uid. Text and selector waits can traverse same-origin iframes and open shadow roots.
7. If a result has `ok: false`, read `retryable`, `retryBudget`,
   `recoveryAction`, and `resultUncertain`; retry only when explicitly allowed.
8. Use selector or coordinate fallback only when fresh uids are unavailable or as an explicit recovery/debugging path.

Ask the user before submitting, deleting, approving, purchasing, publishing, uploading sensitive files, changing production data, exposing secrets, or taking an action whose effect cannot be verified from page state.

## Minimal Use Cases

### Click

1. Call `yunti_list_browser_targets` and select the intended page session or
   target `tabId` / `targetId`.
2. Call `yunti_observe_page` and choose the target element uid from the fresh observation.
3. Call `yunti_click` with `browserSessionId` and `uid`.
4. Read `ok`, `code`, `retryable`, `retryBudget`, `recoveryHint`, and
   `nextStepHint`; retry only when the shared budget allows it.
5. Call `yunti_observe_page` again or use screenshot/evaluate to verify the expected page change.

### Fill Form

1. Call `yunti_observe_page` and inspect field state: `fillable`, `readOnly`, `disabled`, `fillBlockReason`, `selectedValue`, `selectedText`, and `options[]`.
2. Fill editable fields with `yunti_fill` using fresh uids; select options with `yunti_select` using `uid` / `value` or `uid` / `text`.
3. For multiple fields, use `yunti_fill_form` when fields are known and inspect per-field `results[]`.
4. If async validation or option loading occurs, call `yunti_wait_for`, then `yunti_observe_page`, then continue with fresh uids.
5. Before submitting or changing production data, ask the user for confirmation.

### Scroll To Find

1. Call `yunti_observe_page` and inspect `scrollableContainers[]`.
2. Prefer `yunti_scroll` with a fresh scrollable container uid instead of document scroll for nested panels.
3. After scrolling, call `yunti_observe_page` and search the new `textTree` / `elements` for the target.
4. If `moved: false`, `partialMovement`, `edgeHint`, or `recoveryHint` appears, follow that guidance before repeating the same scroll.
5. When async content loads after scrolling, call `yunti_wait_for`, then `yunti_observe_page`, then continue with a fresh scroll container uid.

### Switch Tab

1. Call `yunti_list_browser_targets` to inspect current tabs and browser targets.
2. Choose the intended page `browserSessionId`, or its `tabId` / `targetId` when
   no page session is currently registered.
3. Use `yunti_select_page` when switching to a registered Yunti page route.
4. Use `yunti_cdp_send_command` with `Target.activateTarget` only for raw `targetId` / `tabId` browser target activation.
5. After switching, call `yunti_observe_page` or `yunti_get_page_snapshot` to verify the active page before acting.

### Wait For Async Result

1. Call `yunti_wait_for` with expected `text`, `selector`, or `urlContains`.
2. If `ok: true`, call `yunti_observe_page` and use fresh uids for follow-up actions.
3. If `code: "WAIT_TIMEOUT"`, observe or inspect current page state before adjusting the condition or retrying.
4. Do not reuse pre-wait uids for newly rendered content.
5. Verify the final result with observe, snapshot, evaluate, screenshot, network, or console tools.

## Routing Rules

- Treat `yunti_list_browser_targets` as the canonical live browser inventory.
- In `0.2.5+`, each browser/profile uses one browser-controller transport for
  its browser and page tools. Chrome, Edge, and separate profiles may coexist;
  page actions route through the controller identified by `browserInstanceId`
  and `routeBrowserSessionId`.
- In `0.2.7+`, prefer the opaque `pageHandleId` for multi-step page work. It
  identifies one live tab inside one browser instance and survives navigation,
  reload, content-script reinjection, MV3 worker suspension, extension
  reconnect, and Bridge restart.
- Treat `pageHandleId` as opaque: never parse, edit, reconstruct, or persist it.
  Only use values returned by the live inventory. It is not an element uid;
  observation uids stay fresh and observation-scoped.
- A handle is terminal — with `retryBudget=0` — when the tab closes
  (`YUNTI_PAGE_HANDLE_CLOSED`), when the numeric tab id was reused for a
  different tab (`YUNTI_PAGE_HANDLE_STALE`), when the value is malformed
  (`YUNTI_PAGE_HANDLE_INVALID`), or when it is combined with a conflicting
  `tabId` / `targetId` / `browserInstanceId` / `browserSessionId`
  (`YUNTI_PAGE_HANDLE_ROUTE_MISMATCH`). List targets again instead of retrying.
- Browser-level and raw CDP tools (`yunti_list_browser_targets`,
  `yunti_list_pages`, `yunti_get_browser_target`, `yunti_cdp_send_command`,
  `yunti_new_page`, `yunti_close_page`, `yunti_select_page`, and the
  diagnostic/memory tools) do not accept a handle.
- A target inventory row has a page `browserSessionId` only when registered.
  `routeBrowserSessionId` is the controller transport and must not be mistaken
  for the page id.
- Keep the returned `browserSessionId` for follow-up page and CDP calls when you
  are not using a handle.
- Treat `retryable`, `retryBudget`, `recoveryAction`, `resultUncertain`,
  `recoverable`, `recoveryHint`, and `nextStepHint` as authoritative. One failure
  chain has one shared retry budget; do not let the MCP client, this skill, and a
  fallback backend each spend a separate retry. Browser-side thrown failures keep
  their structured diagnostics through the bridge, so read them instead of
  guessing from the message.
- For `YUNTI_SESSION_STALE`, discard the stale id, list targets once, and spend
  the single retry on the selected live page route.
- For `YUNTI_BRIDGE_RUNTIME_MISMATCH`,
  `YUNTI_EXTENSION_PROTOCOL_MISMATCH`,
  `YUNTI_BROWSER_INSTANCE_AMBIGUOUS`, or any `YUNTI_PAGE_HANDLE_*` failure,
  retry zero times. Follow `recoveryAction`; do not probe with other page tools.
- If `resultUncertain: true`, verify current page state before deciding whether
  another call is safe. Never replay a possibly completed write through DOM or
  CDP without verification.
- In `0.2.4+`, Edge sleeping tabs are recovered automatically. The runtime may
  briefly activate the target tab to restore the content-script route and then
  return to the user's previously active tab. Do not ask the user to switch,
  refresh, or reopen the page before this automatic recovery has failed.
- Stale-session errors include a reason and recovery hint; never retry the expired id itself.
- Uids are observation-scoped in `0.2.6+`. A newer observe/find invalidates the
  agent's previous uid choices even if a matching numeric position appears in
  the new result. Select a uid from the newest result instead of replaying one.
- New tabs may return a new `browserSessionId`; use that returned value for follow-up actions on the new tab.
- `tabId` / `targetId` may be passed to page tools specifically for automatic
  route recovery; they do not become page session ids.
- Local standalone mode defaults to `userId=local`; do not add `userId` unless the environment explicitly needs a different route user.

## Tool Choice

- Use `yunti_get_page_snapshot` for lightweight page text, title, URL, selected text, and page state.
- Once available in the connected runtime, use `yunti_observe_page` as the normal page-operation refresh step, then act by a uid from that exact observation and observe again to verify.
- Observation elements may expose `editable`, `fillable`, `readOnly`, `fillBlockReason`, select `selectedIndex` / `selectedValue` / `selectedText`, and `options[]`; inspect those before filling or selecting when field state matters.
- Use `yunti_take_snapshot` as the compatibility path before uid-based clicks, fills, or hovers.
- Use `yunti_click`, `yunti_fill`, `yunti_hover`, `yunti_press_key`, and `yunti_type_text` for normal page actions.
- Use `yunti_take_screenshot` for visual verification.
- Use `yunti_list_browser_targets` for tab counts, tab selection, target IDs, and whole-browser awareness.
- Use `yunti_cdp_send_command` for Chrome DevTools Protocol commands.
- Use `yunti_list_network_requests`, `yunti_get_network_log`, and `yunti_get_network_request` for network diagnostics.
- Use `yunti_list_console_messages` and `yunti_get_console_message` for console diagnostics.
- Use `yunti_get_tool_usage_hints` before retrying a failed or uncertain tool call.

## CDP Rules

- Treat CDP and content-script actions as complementary first-class backends. Choose whichever path can operate and verify the page most reliably.
- Use CDP proactively for cross-origin frames, shadow DOM, canvas, precise input, browser targets, network control, emulation, tracing, or unreliable DOM paths.
- Chrome may show a debugger banner while CDP is attached. Treat it as informational, not as a reason to avoid CDP or weaken the workflow.
- CDP use does not require user confirmation by itself; confirmation depends on whether the action submits, deletes, purchases, publishes, uploads sensitive files, or changes production data.
- If an action may already have executed but its result is uncertain, verify page state before replaying it through another backend.
- Never run CDP method names in a terminal or shell.
- Always call CDP through `yunti_cdp_send_command`.
- `yunti_cdp_send_command` requires `method`; `params` is optional but must be an object when provided.
- Required CDP shape:

```json
{
  "browserSessionId": "yunti-...",
  "method": "Runtime.evaluate",
  "params": {
    "expression": "document.title",
    "returnByValue": true
  }
}
```

- For tab activation or closing, pass top-level `tabId` or `targetId` with a valid `browserSessionId`.
- For multi-step JavaScript work that depends on page-local state, prefer one `Runtime.evaluate` expression that performs setup, action, wait, and readback in one call.

## Parameter Rules

- `yunti_click` and `yunti_hover` need `uid`, `selector`, or both `x` and `y`; prefer a fresh uid from `yunti_observe_page` once available, or call `yunti_take_snapshot` for the current compatibility path.
- `yunti_fill` requires `value` plus `uid` or `selector`; coordinate-only fill is not supported.
- `yunti_close_page` accepts `browserSessionId`, not raw `tabId` or `targetId`; use `yunti_cdp_send_command` with `Target.closeTarget` for raw browser targets.
- `yunti_forget_learning_memory` needs a memory `id`, or `all=true` and `confirmed=true` for deleting everything.
- `yunti_remember_learning` is for durable patterns and gotchas, not transcripts or raw payloads. It sanitizes likely secrets and PII-like text before storage, but do not intentionally submit secrets, cookies, auth headers, private keys, payment data, or personal contact details.

## Action Recovery

- After `yunti_click`, `yunti_fill`, or `yunti_hover`, observe again or read page state before assuming the action succeeded.
- If a uid is stale or missing, call `yunti_observe_page` again and retry with a fresh uid.
- If an element may be outside the viewport, use observe scroll hints and `yunti_scroll` before falling back to coordinates.
- If the page is loading or changing, wait or observe again instead of blindly repeating the same action.
- For async UI transitions, use `yunti_wait_for` for expected text, selector, or page state, then call `yunti_observe_page` and continue with a fresh uid instead of reusing an old target.
- Read `yunti_wait_for` structured fields when present: `ok: true` means the condition matched; `code: "WAIT_TIMEOUT"` means observe or adjust the condition before repeating the same wait.
- If the target tab is uncertain, call `yunti_list_browser_targets` and continue with the intended `browserSessionId`.

## Action Results

- Current action results may use compatibility fields such as `clicked`, `hovered`, `filled`, `selected`, `scrolled`, `typed`, `pressed`, `uploaded`, `dragged`, aggregate counts like `failed`, per-field `results`, wait fields like `found` / `waitedMs`, `uid`, `selector`, coordinates, `method`, `valueLength`, `before`, `after`, and `browserSessionId`.
- Structured P6.2 fields are additive when present: prefer `action`, `target`, `ok`, `recoverable`, and `nextStepHint`, while still reading existing compatibility fields.
- Treat action results as execution evidence, then verify page state when the task depends on the result.
- Do not require agents to abandon existing result fields while structured action results are being introduced.

## Wait Guidance

- Use `yunti_wait_for` when async rendering, navigation, validation, dynamic select options, or infinite-scroll content needs time to appear.
- Provide at least one of `text`, `selector`, or `urlContains`; set `timeoutMs` only when the default is not appropriate.
- Successful waits preserve compatibility fields such as `found`, `text`, `selector`, `condition`, `value`, `waitedMs`, and `browserSessionId`, and may include `action: "wait_for"`, `target`, `ok: true`, `recoverable: false`, and `nextStepHint`.
- Timeout waits return `found: false`, `ok: false`, `recoverable: true`, `code: "WAIT_TIMEOUT"`, `recoveryHint`, and `nextStepHint`.
- After a successful wait, call `yunti_observe_page` again and use fresh uids for newly rendered elements. After a timeout, observe or inspect current page state before changing the wait condition or retrying.

## Fill Guidance

- Prefer a fresh `uid` from `yunti_observe_page` or `yunti_take_snapshot` when filling inputs, textareas, selects, or contenteditable targets.
- Before filling, inspect observation fields such as `fillable`, `readOnly`, `disabled`, `fillBlockReason`, and select `selectedValue` / `selectedText` / `options[]` when available.
- Uid-targeted contenteditable fills return `method: "contenteditable"` and may include `before` / `after` text length summaries.
- Treat contenteditable fill results as dispatch evidence, then verify with observe, snapshot, evaluate `textContent`, or a page-specific assertion when exact editor state matters.
- Selector-based fill remains compatible and may return content-script-shaped fields such as `element` or `valueLength`.
- Uid and selector fill failures may return structured `filled: false` diagnostics with `code`, `ok: false`, `recoverable: true`, `recoveryHint`, and `nextStepHint`; follow `recoveryHint.nextAction` / `decision` before repeating the same fill.
- If a field appears after async rendering or validation, wait with `yunti_wait_for`, observe again, and fill with a fresh editable uid.
- Non-editable, hidden, disabled, or readonly fill targets may return `code: "TARGET_NOT_EDITABLE"`; inspect the target, wait/unlock the field, or choose a different editable uid/selector before retrying.
- Uid keyboard/contenteditable fills may return `code: "VALUE_NOT_APPLIED"` when the post-fill value does not remain. Use the length-only diagnostics (`expectedValueLength`, `actualValueLength`) and `recoveryHint.decision` to inspect controlled/masked fields before retrying; raw field values are not echoed in this diagnostic.
- Select-option fill misses may include `availableValues` / `availableTexts`; inspect those options before retrying with `yunti_fill` or `yunti_select`.
- `yunti_fill_form` preserves per-field compatibility results and may carry the same structured failure details on failed `results[]` items, including `code`, `recoveryHint`, `availableValues` / `availableTexts`, and `nextStepHint`.

## Scroll Guidance

- Prefer a fresh `scrollableContainers[]` uid from `yunti_observe_page` when scrolling nested app panels or sidebars.
- Uid-targeted scroll resolves the observed container center and reuses the existing coordinate/container scroll path, so coordinate recovery remains compatible.
- Uid scroll preserves the existing `target` compatibility field and adds `uid`, `method: "uid"`, and `scrollTarget` for structured interpretation.
- Coordinate scroll results may include `coordinateTarget`, `scrollContainerFound`, `coordinateScrollFallback: "document"`, and `coordinateFallbackHint`; when document fallback appears, observe again and prefer a fresh `scrollableContainers[]` uid for nested panels.
- When `before` / `after` positions are comparable, scroll results include `moved`; if positions do not change, the result reports `code: "NO_SCROLL_MOVEMENT"`, `ok: false`, `recoverable: true`, directional `edgeHint` values, and a structured `recoveryHint` with `nextAction` / `recommendedTools`, machine-readable `decision`, plus `suggestedRetry` when an opposite delta can be derived.
- If scroll moves less than requested, results may keep `ok: true` and include `partialMovement` with requested/actual deltas, axes, `edgeHint`, `decision: "observe-before-continuing-scroll"`, and `nextAction: "observe-again"`; observe again before repeating the same scroll.
- Uid scroll failures may return structured `scrolled: false` diagnostics with `code` such as `UID_NOT_FOUND` or `UID_COORDINATES_UNAVAILABLE`, plus `recoveryHint.decision: "refresh-scrollable-container-uid-before-retry"`; refresh observation and choose a fresh `scrollableContainers[]` uid before retrying.
- After scrolling, observe again and compare document or container `before` / `after` positions before assuming the needed element is visible. Stop repeating the same scroll when `moved: false` appears; use `recoveryHint`, `decision`, `edgeHint`, and `suggestedRetry` to choose a different container, direction, or recovery path.
- If scrolling depends on newly loaded content, use `yunti_wait_for`, observe again, and choose a fresh `scrollableContainers[]` uid before continuing.

## Select Guidance

- Current `yunti_select` runtime behavior supports selector/value, uid/value, and uid/visible text.
- Use `text` with a fresh uid when the user-facing option label is clearer than the option value; selector path remains selector/value compatible.
- Uid and selector option misses, disabled options, plus non-select targets return structured `selected: false` diagnostics with `code`, `matchMode`, `targetOption`, and `recoveryHint`; option misses include `availableValues` / `availableTexts` when available, and disabled-option failures can include `disabledValue` / `disabledText`.
- Before retrying a failed select, inspect available options with observe, snapshot, evaluate, a stable selector, or `recoveryHint.decision` instead of blindly repeating it.
- If select options are populated asynchronously, wait with `yunti_wait_for`, observe again, and select with a fresh uid/value or uid/text.

## Safety

- Read-only inspection is allowed by default.
- Before submitting forms, deleting data, uploading sensitive files, approving workflows, making purchases, or changing production data, ask the user for explicit confirmation.
- Do not expose raw cookies, passwords, authorization headers, or token-like values.
- Prefer sanitized network and console diagnostics before raw CDP events.
- Treat `yunti_get_cdp_events` as raw low-level diagnostics. Filter by `method`, keep `limit` small, clear it after debugging with `yunti_clear_cdp_events`, and do not copy raw CDP payloads into chat, docs, or learning memory.
- Use `yunti_observe_page` with `redaction: "strict"` when a page may contain personal information. Strict DOM redaction hides likely email, phone, Luhn-valid payment-card-like values, address-like text, page titles, labels, names, visible text, placeholders, values, and select option text.
- Keep `redaction: "off"` only for explicit local debugging.
- If a tool output appears to include sensitive data, summarize only the safe parts.
- DOM observation redaction does not mean screenshots are redacted; treat screenshots as visible page pixels. Use screenshots only when visual proof is needed, prefer viewport captures when enough, and summarize safe visual findings instead of storing raw images in learning memory.

## Recovery

- No connected route: run doctor first. If the extension controller is online
  but no page session is active, call `yunti_list_browser_targets` and pass the
  intended `tabId` / `targetId` to the page tool; the controller establishes the
  route automatically. Edge sleeping tabs are activated and restored by the
  runtime when background injection stalls. Ask the user to refresh only after
  automatic recovery fails because the page is unsupported or browser access is
  explicitly blocked.
- Stale session: retry the page operation once so controller recovery can run.
  If it still fails, call `yunti_list_browser_targets` without the stale id and
  retry with the latest `browserSessionId`, `tabId`, or `targetId`. Do not ask the
  user to refresh, switch tabs, or restart the browser as the default recovery.
- Extension-side timeout: the controller remains available even when one page
  operation times out. Inspect targets and retry the intended live tab once;
  do not assume the whole browser session is disconnected.
- Stale or missing page uid: observe again once `yunti_observe_page` is available, or take a fresh snapshot for compatibility workflows.
- Wrong tab: use `yunti_list_browser_targets` to find the intended tab, then route CDP with that tab's `tabId` or `targetId`.
- Parameter uncertainty: call `yunti_get_tool_usage_hints` with the specific tool name.
- Missing memory id: call `yunti_get_learning_memory` first, then retry with a returned `id`.
