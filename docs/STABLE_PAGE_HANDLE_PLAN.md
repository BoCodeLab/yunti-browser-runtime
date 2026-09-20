# P8.2.4 Stable Page Handle Plan

## Decision

Yunti will make a browser tab, not a transient content-script session, the
agent-facing unit of continuity. An agent should select a tab once and keep an
opaque `pageHandleId`; runtime-internal `browserSessionId` replacement must not
force the agent or user to select, refresh, or register the same live tab again.

This is the next P8 reliability priority. It is additive and must not change the
published `0.2.6` behavior until the compatibility and endurance gates pass.

## Problem

The current controller can recover a live tab by `browserInstanceId`, `tabId`,
or `targetId`, but the public workflow still exposes `browserSessionId` as the
normal follow-up route. That leaks an implementation lease into agent state:

- navigation or reload replaces the page execution context;
- extension reload or content-script reinjection replaces page registration;
- Bridge restart loses in-memory session routes;
- Edge sleeping tabs can require bounded activation and reinjection;
- an agent can repeatedly replay an expired id even though the tab still exists.

Recovery exists, but the agent still has to understand too much of it. The new
contract moves that responsibility into the runtime.

## Identity Model

Yunti will keep the three identity layers explicit internally:

| Layer | Lifetime | Agent contract |
| --- | --- | --- |
| Browser controller | Browser/profile instance | Internal routing owner; exposed only for diagnostics and disambiguation |
| Stable page handle | Lifetime of one live tab in one browser instance | Preferred durable route for all page operations |
| Browser session | Lifetime of the current registered page execution context | Internal lease; compatibility field, not the durable identity |

The logical key behind a handle is the owning browser instance plus its live
tab identity. `targetId` is supporting evidence, not the sole durable key,
because targets can change across navigation or renderer replacement.

`pageHandleId` requirements:

- opaque to agents; callers must not parse or construct it;
- unique across Chrome, Edge, profiles, and same-numbered tab ids;
- stable across navigation, reload, content-script reinjection, MV3 worker
  suspension, extension reconnect, and Bridge restart while the same tab and
  browser instance still exist;
- invalidated when the tab closes or its owning browser instance disappears;
- never reused for a different tab, even if the browser later reuses `tabId`;
- contains no URL, title, origin, account, token, or other page data.

## Additive Tool Contract

No existing MCP tool needs to be removed or renamed.

- `yunti_list_browser_targets` and `yunti_list_pages` return `pageHandleId` for
  every routable HTTP/HTTPS tab.
- Existing page tools accept optional `pageHandleId` alongside current
  `browserSessionId`, `tabId`, and `targetId` compatibility inputs.
- A returned `browserSessionId` remains diagnostic and backward compatible,
  but skills and usage hints prefer `pageHandleId` for multi-step work.
- When both handle and legacy route fields are supplied, the runtime verifies
  that they resolve to the same live tab and fails on disagreement.
- Browser-level and raw CDP tools keep their existing target contracts where a
  page handle is not meaningful.
- The first implementation should extend current tools rather than add a new
  mandatory select/open tool. A separate handle-management tool is justified
  only if later lifecycle operations need one.

## Runtime Resolution Contract

Every page operation routed by `pageHandleId` follows one bounded resolver:

1. Resolve the owning live browser controller.
2. Confirm the original tab still exists in that browser instance.
3. Reuse a compatible live page session when available.
4. If missing, stale, or replaced, recover registration through the controller.
5. Re-resolve after navigation or renderer replacement without changing the
   external handle.
6. Dispatch the operation once.
7. Return the current internal session metadata for diagnostics.

Internal route recovery is part of one tool call and does not consume a second
agent-level retry. Recovery must be bounded by one shared deadline and support
cancellation.

## Lifecycle States

The runtime should expose typed lifecycle diagnostics while keeping transient
states internal during successful recovery:

```text
resolving -> ready -> navigating -> recovering -> ready
    |          |           |            |
    +----------+-----------+------------+-> blocked
                                           closed
```

- `resolving`: controller and tab ownership are being established.
- `ready`: a live tab and usable page/backend route are available.
- `navigating`: the same tab is replacing its document or renderer.
- `recovering`: session, content script, worker, or CDP route is being rebuilt.
- `blocked`: the live tab exists but browser policy or an unsupported URL
  prevents operation.
- `closed`: the original tab or owning browser instance no longer exists.

Agents should normally receive the final `ready`, `blocked`, or `closed`
outcome, not intermediate stale-session errors.

## Safety And Retry Rules

- A stale internal session is safe to replace before dispatch.
- A read operation may continue after route recovery within the same deadline.
- A write operation may be dispatched only once per tool request.
- If dispatch may have occurred and the result is uncertain, the resolver must
  not recover and replay it automatically. Return `resultUncertain: true` and
  require state verification.
- Tab close, browser exit, ambiguous browser ownership, protocol mismatch, and
  policy denial are terminal for that request and have `retryBudget=0` unless a
  specific recovery action changes the external state.
- Automatic recovery must never activate a different tab permanently or leave
  CDP attached solely because fallback was attempted.

## Acceptance Matrix

A P8.2.4 candidate is complete only when one selected `pageHandleId` survives:

1. 100 same-tab reloads.
2. 100 same-tab HTTP/HTTPS navigations, including origin changes.
3. At least 100 forced content-script registrations or execution-context
   replacements during the endurance run.
4. Extension service-worker suspension and restart.
5. Extension reload followed by controller reconnect.
6. Bridge restart with handle re-resolution from live controller inventory.
7. Edge sleeping-tab recovery without user refresh or tab switching.
8. Chrome and Edge online together with colliding numeric tab ids.
9. CDP detach/reattach while the same handle continues through DOM operations.
10. Explicit terminal failure after the original tab is closed.

Release evidence must include:

- 15 minutes of continuous real Edge operation and a Chrome compatibility run;
- all published MCP tools covered where applicable;
- at least 100 internal page-session replacements;
- zero user-assisted refreshes, tab switches, or browser restarts;
- zero externally visible stale-session failures while the original tab lives;
- zero wrong-tab dispatches and zero duplicate guarded writes;
- p95 and maximum latency reported separately for normal calls and calls that
  performed internal route recovery;
- one failure artifact proving that a closed tab becomes terminal instead of
  being rebound to a reused numeric tab id.

## Rollout Slices

### P8.2.4a - Contract And Resolver

Status: implemented.

- `pageHandleId` is minted by the extension from the stable browser-controller
  id, the live `tabId`, and a persisted tab-id reuse generation, and is surfaced
  through target/page inventory and `consoleState`.
- `mcp/bridge-hub.js` centralizes handle parsing and resolution
  (`parsePageHandleId`, `resolveHandleRoute`) and cross-checks a handle against
  any conflicting `tabId`, `targetId`, `browserInstanceId`, or
  `browserSessionId` before dispatch.
- Browser-level and raw CDP tools reject a handle explicitly instead of ignoring
  it.
- Covered by browser-instance collision, tab-id reuse, closed-tab, malformed
  handle, conflicting-route, unsupported-tool, cross-user, session-replacement,
  and inventory-exposure tests, plus the real-browser gate.

### P8.2.4b - Navigation And Context Replacement

- preserve handles across reload, navigation, renderer replacement, and
  content-script reinjection;
- prevent pre-navigation sessions from escaping as required agent input.

### P8.2.4c - Restart Recovery

- reconstruct handle routing after Bridge and MV3 worker restart;
- validate extension reload and Edge sleeping-tab behavior.

### P8.2.4d - Typed Lifecycle And Cancellation

- expose bounded lifecycle diagnostics and recovery timing;
- propagate cancellation through handle resolution, controller work, page
  waits, and CDP operations.

### P8.2.4e - Agent Contract And Endurance Gate

- update usage hints, packaged skill, README, Tool Guide, and installation
  prompts to prefer handles;
- add the 100-replacement endurance scenario and publish comparison evidence.

## Non-Goals

- No guarantee after the original tab or browser instance closes.
- No automatic rebinding to a restored tab after a full browser restart in the
  first slice.
- No operation on browser-internal or policy-restricted pages.
- No permanent element uid across DOM mutation; observation uids remain fresh
  and observation-scoped.
- No hidden replay of uncertain writes.
- No mandatory remote account, hosted state, or built-in LLM loop.

## Release Strategy

Development stays on an isolated candidate branch. The published `0.2.6`
`latest` release remains unchanged until all compatibility and endurance gates
above pass. The first public candidate must clearly distinguish stable page
handles from observation-scoped element uids and must ship matching runtime,
extension, skill, and documentation versions.
