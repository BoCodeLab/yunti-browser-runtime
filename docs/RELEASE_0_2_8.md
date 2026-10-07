# Yunti Browser Runtime 0.2.8

## Release Positioning

`0.2.8` is the first release published from the `BoCodeLab` repository, and the
first one that documents a source checkout as the primary install path. It
carries the stable-page-handle contract from upstream plus a concurrency and
latency pass over the extension and the bridge.

## Highlights

### Install from the source tree

- `playwright-core` moved to `devDependencies`. The runtime (MCP server, local
  bridge, CLI, browser extension) has no third-party dependencies, so a source
  checkout runs without `npm install`; the dependency only serves the real-browser
  E2E and soak tests.
- `npm run bridge` and `npm run console` no longer use POSIX inline environment
  assignment, which `cmd.exe` cannot parse. They run through `scripts/bridge.js`.
- README and [INSTALL.md](INSTALL.md) document the clone-based install. The npm
  global install path was removed: the `yunti-browser-runtime` name on npm belongs
  to the upstream author, so this repository cannot publish under it.

### Stable page handles and structured failures (from upstream)

- Per-observation scoped element uids, so a stale uid no longer matches a new
  element after a re-render.
- `classifyExtensionFailure` keeps `code`, `retryable`, `retryBudget`,
  `resultUncertain` and `recoveryHint` on extension-side errors instead of
  collapsing them into a generic message.

### Concurrency and latency

Findings and measurements behind this pass are in
[PROBE_REPORT.md](PROBE_REPORT.md) and
[audits/yunti-concurrency-latency-audit.md](audits/yunti-concurrency-latency-audit.md).

- A native modal dialog no longer wedges a tab. `yunti_click` against a frozen
  renderer answers with a structured `dialogOpened` result instead of never
  returning, and a fast click pays nothing because the watch only starts after
  500 ms.
- Controller registration is throttled to every fifth poll cycle. The bridge TTL
  is far larger than the poll cycle, so the heartbeat stays fresh while one
  bridge round trip leaves the critical path of most tool calls.
- A wedged tool lane is released by a watchdog. A queued same-tab request gets a
  structured `YUNTI_TAB_BUSY` instead of an unbounded wait, and the busy result
  is published as soon as the lane frees up.
- `yunti_take_screenshot` reports byte-level diagnostics for an empty CDP
  capture and `SCREENSHOT_FAILED` when both capture paths fail.
- An empty console or network capture explains an active `platformMatches` filter
  instead of looking like "the page produced no events"; a wildcard filter never
  reports `NO_CAPTURED_EVENTS`.
- CDP command timeouts surface `YUNTI_CDP_TIMEOUT` and force a re-attach.
- stdio answers fast requests while a slow tool call is still in flight.

## Verification

- `npm test`: 247 tests, 246 pass, 0 fail, 1 skipped (the real-browser E2E test is
  opt-in via `YUNTI_E2E=1`).
- `npm run release:check`: all gates pass — public doc residue, markdown links,
  version consistency, CLI / doctor / print-config smoke, syntax checks, unit
  tests, npm pack contents, and extension zip contents.

## Upgrade

Source checkout:

```bash
git fetch --tags
git checkout v0.2.8
```

Then reload the unpacked extension once from `chrome://extensions` or
`edge://extensions` so the browser picks up extension version `0.2.8`.

## Compatibility

- MCP tool count remains 52.
- Extension protocol remains version 1.
- Node.js 22+ remains required.
- An existing Agent MCP configuration stays valid as long as the checkout is not
  moved, because it points at the absolute path of `mcp/server.js`.
