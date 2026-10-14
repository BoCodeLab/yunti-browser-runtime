# Browser reliability audit fixes

This change addresses the fourteen required findings from the October 2026
usage audit. It keeps the existing tool names and does not add optional export,
download, worker-target, or recording features.

| Findings | Implementation and acceptance |
| --- | --- |
| M01 | Bind observation uids to live nodes; reject removed, obscured and conflicting targets. Verify layout drift, replacement and uid/selector precedence in a real browser fixture. |
| M02 | Resolve diagnostic routes explicitly; never fall back from a supplied route to another page. Verify two-page reads and clears. |
| M03 | Report serialized result completeness correctly and preserve JSON validity. Verify strings, objects, arrays and zero/boundary limits. |
| M04 | Respect one operation deadline; distinguish queue expiry from execution uncertainty and suppress late duplicate replies. Verify long waits and abandoned operations. |
| M05 | Separate transport completion, action status and data completeness. Verify failures and normal empty/event results. |
| M06 | Distinguish offline browser instances, stale inventories and closed tabs. Verify reconnect and actual tab closure. |
| M07 | Share retry budgets; do not replay terminal routes or uncertain writes. Add explicit client guidance and machine-readable recovery. |
| M08 | Supply a profile-scoped Hermes integration that keeps page failures out of the service breaker. Verify application versus transport errors without restarting a live gateway. |
| M09 | Require explicit task routing in shared-browser guidance and check the observation id when supplied. Independent tasks use independent tabs. |
| M10 | Share argument validation and dispatch between stdio and HTTP; preserve structured failures through proxies. Verify both HTTP endpoints. |
| M11 | Mark table previews with total/returned row and column counts and truncation. Verify more than five rows and ten columns. |
| M12 | Require business postconditions and pagination fingerprints in the packaged workflow. Supply a bounded verification example; do not edit or replay business collection jobs. |
| M13 | Reject unknown arguments with actionable diagnostics and document effective time/output budgets. Verify the same contract at each public entry point. |
| M14 | Align schemas, hints and skill guidance; retain script exception details and expose skill fingerprints for installation checks. |

Validation proceeds from focused regression tests to the full unit suite, real
browser interaction checks, and the release gate. Runtime deployment and process
or extension reload are separate from source validation.

## Verification record (2026-10-14, 0.2.9)

Each required finding was re-checked against the 0.2.9 source. Where the audit
left a reproducer, that reproducer was re-run across 0.2.7 / 0.2.8 / 0.2.9, so
the before-and-after is a measurement rather than a re-reading of the code.

| Finding | Evidence | Result |
| --- | --- | --- |
| M01 | Real Chromium: uid identity across layout drift and node replacement | Pass |
| M02 | Audit reproducer ×3 versions: `tabId`, `targetId` and conflicting routes are rejected; a clear no longer deletes another page's records | Fixed |
| M03 | Audit reproducer ×3 versions: object and array stay parseable; `maxLength:100` returns 100 chars; `maxLength:0` returns none | Fixed |
| M04 | Real Chromium: a 13 s declared wait is not cut off by the 12 s watchdog | Pass |
| M05 | Real payload shape: `transportStatus`, `actionStatus` and `errorCategory` are separated | Pass |
| M06 | `tests/contracts.test.js`: the three terminal codes are distinguished | Pass (unit) |
| M07 | `tests/contracts.test.js` plus the Hermes adapter regression | Pass |
| M08 | `integrations/hermes/test_reliability.py`: 8 tests OK | Pass |
| M09 | Packaged guidance plus real-browser uid identity | Pass |
| M10 | `tests/contracts.test.js`: validation and dispatch shared across entry points | Pass (unit) |
| M11 | Real Chromium: `tables[0].totalRows` reports the full row count | Pass |
| M12 | Documented in `docs/AGENT_WORKFLOW_CONTRACT.md` | Documented |
| M13 | `tests/contracts.test.js` plus `additionalProperties:false` on all 54 tools | Pass |
| M14 | Live `doctor` reported 3 differing skill copies, then 0 after `install-skill --force` | Pass |

The audit reproducer for M05 sends a synthetic payload without `action`, so it
cannot exercise the 0.2.9 status fix; the check above uses the shape the tool
actually returns.

### Found while verifying

`yunti_wait_for` returned the matched-condition *string* in `found` instead of
the documented boolean. The content script reports `found: "selector"`, and the
result literal spread `...match` *after* `found: true`, so the string overwrote
the boolean on the selector and text paths while `urlContains` stayed boolean.
The unit test had encoded the wrong shape, which is how it survived into 0.2.8.
Fixed, with the test corrected.

### Optional findings

| Finding | Status |
| --- | --- |
| O01 large-result export and cursor pagination | Not implemented |
| O02 non-tab CDP targets (worker attach/send/detach) | Done. A first pass wrongly concluded this was infeasible: its probe filtered `chrome.debugger.getTargets()` by `type === "worker"`, which drops a dedicated worker — Chrome types it `other` — and its fixture produced no shared or registered service worker. `scripts/probe-nontab-targets.mjs` covers all three flavours and shows they are listed before any attach, are attachable via `chrome.debugger.attach({targetId})`, and accept `Runtime.evaluate`. `yunti_cdp_send_command` now routes a `targetId` that maps to no tab to a `{targetId}` debuggee instead of rejecting it, `Target.attachToTarget` / `Target.detachFromTarget` handle non-tab targets, and the old error that told callers to "use chrome.debugger.attach directly" is gone. `Target.setDiscoverTargets` remains refused for an extension debuggee and is not needed. |
| O03 per-page capability matrix in the inventory | Not implemented |
| O04 `yunti_fetch_with_cookie` same-origin wording | Not implemented |
| O05 download and navigation completion closures | Done. Navigation takes an opt-in `waitForStage` (`commit` / `domContentLoaded` / `load`) and reports the stage it actually reached plus the document identity it settled on; expiry returns `NAVIGATION_STAGE_TIMEOUT` with `ok:false` rather than a navigation that never completed. Download reporting was first verified infeasible over CDP — an extension tab debuggee cannot reach the Browser domain (`Browser.setDownloadBehavior` is `'not found'`, `Page.setDownloadBehavior` is refused with `Cannot not access browser-level commands`, and a real download produces no observable event; reproduce with `node scripts/probe-download-observability.mjs`) — so the extension now requests the `downloads` permission instead, and `yunti_list_downloads` reports id, the absolute local path the browser wrote, state, `bytesReceived`/`totalBytes`, MIME, timing, `exists` and `error`. Downloads are not redirected. No checksum: an extension cannot read the downloaded file. |
| O06 typed output, naming and units | Partial: the `found` type is fixed; `maxBytes` still slices JS string length (`extension/content.js:496`) |
| O07 cross-agent operation ledger | Not implemented |
| O08 delta reports a text change on a static page | Fixed: the comparison strips the observation-scoped uid |
| O09 `/health` without `userId` reads as offline | Fixed: reports `scope` / `userSelected`, and `extensionConnected: null` when unscoped |

### Evidence limits

M02, M03 and M05 were verified with the audit's offline reproducer (fixture
page, fixture bridge). Those prove code behaviour, not a business-page
end-to-end regression. M06, M07, M10 and M13 rest on unit tests with fixtures.
No business page was replayed to validate a finding, and the live browser was
not driven for this record.
