# Yunti Browser Runtime 0.2.9 — candidate

This is an unreleased reliability candidate addressing the fourteen required
findings in the [audit checklist](AUDIT_FIXES_2026_10.md). MCP tool count remains
52 and extension protocol remains 1. Runtime and extension versions both advance
to 0.2.9 so a partial upgrade cannot silently pair the new contracts with old
content scripts.

- Observed uids retain live DOM identity. Replaced, disabled or obscured targets
  fail before input; a supplied selector cannot override the uid. Snapshot uids
  are observation-scoped and resolve their backend node before each action.
- Diagnostic routes reject unsupported tab/target/handle arguments instead of
  falling back to an active page. Results expose the effective page route.
- Evaluate reports serialized completeness, zero-length limits, pending promises
  and redacted exception details. Oversized objects/arrays return a missing
  value with an explicit truncation flag instead of malformed JSON.
- Declared waits and evaluate budgets receive bounded transport overhead.
  Queue failures are distinct from execution uncertainty. Abandoned operations
  cannot publish a second late result, and an uncertain CDP write is not
  automatically replayable.
- Offline browser instances, stale inventories and confirmed closed tabs have
  distinct recovery contracts. A fresh inventory updates the cached evidence.
- Both HTTP endpoints and stdio validate the tool schema before execution and
  retain structured failures through local proxies and relays. Action failures,
  unmet waits and failed network events have separate status semantics.
- Table summaries declare rendered-DOM row/column totals, preview limits and
  truncation. Shared-page and pagination workflows require explicit routing and
  business postconditions.
- Doctor and the skill installer expose skill fingerprints. The packaged
  instructions have one stale-route recovery order and document unknown
  parameters, result completeness and shared retry budgets.
- An optional [Hermes profile adapter](../integrations/hermes/README.md) prevents
  application errors from opening the MCP transport breaker and enforces a
  shared retry allowance for identical requests. It does not modify Hermes core.

Validation uses unit/integration tests, isolated real-browser interaction and
extension smoke tests, the Hermes adapter regression, and the release gate.
Test extensions and stdio clients use private bridges; fixtures never register
with the user's active bridge. Source validation and package creation do not
publish, upgrade an active runtime, restart a gateway or reload a user's browser.
