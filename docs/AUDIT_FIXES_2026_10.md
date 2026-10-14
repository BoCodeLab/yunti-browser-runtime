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
