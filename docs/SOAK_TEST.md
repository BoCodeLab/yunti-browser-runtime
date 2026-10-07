# Browser Endurance Test

## Purpose

The soak test is the reusable post-installation acceptance test for Yunti
Browser Runtime. It launches an isolated Chromium profile, loads the packaged
extension, starts an isolated local Bridge and fixture server, then continuously
operates a deliberately complex page for at least 15 minutes.

This is not a one-click smoke test. A qualifying run fails on the first tool
error, incomplete MCP tool coverage, duplicate guarded write, or duration below
15 minutes. It also fails when call p95 exceeds 500 ms or any call exceeds 10
seconds.

## Run After Installation

Install the Playwright Chromium binary once if it is not already available:

```bash
npx playwright-core install chromium
```

### When `playwright-core install` times out

`playwright-core install chromium` aborts a request after 30 seconds. On networks
where the Chrome-for-Testing CDN is slow or unreachable — both the default host and
`PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright` have been
observed timing out at that limit — download the archive with a client that
tolerates long transfers, then unpack it where Playwright expects it.

Step 1 — ask Playwright which path it wants (the build number changes between
Playwright releases, so always read it from here instead of copying the example):

```bash
node -e "const {chromium}=require('playwright-core'); console.log(chromium.executablePath())"
```

That prints something like
`<cache>/ms-playwright/chromium-<build>/chrome-win64/chrome.exe`, where `<cache>`
is `%LOCALAPPDATA%` on Windows, `~/Library/Caches` on macOS and `~/.cache` on Linux.

Step 2 — fetch the archive (about 195 MB) without the 30 second cap:

```bash
curl -L --max-time 1200 --retry 2 -o chrome-win64.zip \
  https://cdn.npmmirror.com/binaries/playwright/builds/cft/153.0.8010.12/win64/chrome-win64.zip
```

Step 3 — unpack so that `chrome-win64/` lands directly under the
`chromium-<build>` directory reported in step 1:

```bash
mkdir -p "$CACHE/ms-playwright/chromium-<build>"
tar -xf chrome-win64.zip -C "$CACHE/ms-playwright/chromium-<build>"
```

Step 4 — confirm Playwright can see it:

```bash
node -e "const {chromium}=require('playwright-core'); console.log(require('fs').existsSync(chromium.executablePath()))"
```

`true` means the soak and E2E runners are ready.

### Expect a browser window

The runner starts a **visible** Chromium window and keeps it open for the whole
15 minute run. That is the test browser, not your own Chrome or Edge: it uses a
temporary profile and never touches your normal browsing profile. Do not close
it while the test is running.

Run the qualifying test from any writable directory:

```bash
yunti-browser-runtime soak-test
```

Repository contributors can use the equivalent npm command:

```bash
npm run test:soak
```

The test opens a visible test browser. It uses a temporary profile and does not
modify the user's normal Chrome or Edge profile. Current branded Chrome builds
ignore command-line unpacked-extension loading, so the default runner uses the
Chromium for Testing binary installed by Playwright.

Useful options:

```bash
yunti-browser-runtime soak-test --browser=edge
yunti-browser-runtime soak-test --executable-path=/absolute/path/to/browser
yunti-browser-runtime soak-test --artifact-dir=/writable/output/directory
```

For runner development only, a short run can be enabled explicitly:

```bash
npm run test:soak -- --duration-seconds=180 --allow-short
```

A short run always reports `qualifyingDuration: false` and must not be used as
release evidence.

## Coverage

The fixture combines form entry, selects, async controls, dynamic rerendering,
stale uid recovery, guarded writes, tables, HTTP requests, nested scrolling,
coordinate clicks, drag and drop, upload, same-origin iframe content, open
Shadow DOM, dialogs, preview patch and rollback, navigation, child tabs,
screenshots, traces, emulation, memory operations, console diagnostics, network
diagnostics, and CDP detach/reattach.

The coverage contract is generated against the published MCP tool list. Adding
a new public tool without adding it to the soak plan fails the normal unit test
suite, so the endurance test cannot silently remain on an old tool surface.

## Pass Criteria

A release-qualifying result requires all of the following:

- elapsed time is at least 900 seconds
- every published MCP tool is invoked
- every recorded tool call succeeds
- at least one complete continuous cycle finishes
- stale page routes recover through the same live browser session
- every created child tab reports `ready: true` before follow-up operations
- accepted guarded writes match cycles and duplicate write attempts remain zero

Call latency is recorded as p50, p95, and maximum. A passing run can still
expose a latency distribution change; the summary therefore also records p99,
calls over one second, per-tool distributions, and the 20 slowest calls.
Repeated screenshots run every 10 cycles, preserving sustained visual coverage
without imposing the previous every-two-cycle rendering pressure.

## Artifacts

By default, each run writes to the current directory:

```text
.artifacts/soak/<timestamp>/
```

The directory contains:

- `operations.jsonl`: one sanitized timing/result row per MCP call
- `summary.json`: machine-readable acceptance result and metrics
- `summary.md`: compact human-readable report
- `error.log`, `failure.png`, and `bridge-state.json` when a run fails

`.artifacts/` is intentionally ignored by Git. Durable release metrics must also
be copied into `docs/PROJECT_STATUS.md`, while the raw local artifacts remain
available for detailed investigation.

## 0.2.5 Baseline

The qualifying run completed on 2026-07-22 in
`.artifacts/soak/2026-07-22T04-42-52-595Z/`:

- elapsed: 900.655 seconds
- cycles: 710
- calls: 19,233 successful out of 19,233
- tool coverage: 52/52
- stale-route recoveries: 710
- child tabs created and closed: 237
- CDP detach/reattach recoveries: 178
- accepted guarded writes: 710
- duplicate write attempts: 0
- call latency p50/p95/max: 4/218/27,682 ms

The maximum latency was one successful `yunti_hover` during a temporary browser
slowdown. It did not change the page session, trigger a duplicate write, or
start an unbounded retry loop, but remains a tail-latency baseline for later
releases.

## Optimized Edge Candidate

The qualifying Microsoft Edge run completed on 2026-07-22 in
`.artifacts/soak-edge-15m-optimized/2026-07-22T05-58-11-786Z/`:

- elapsed: 900.168 seconds
- cycles: 840
- calls: 22,410 successful out of 22,410
- tool coverage: 52/52
- stale-route recoveries: 840
- child tabs created and closed: 281
- CDP detach/reattach recoveries: 211
- accepted guarded writes: 840
- duplicate write attempts: 0
- call latency p50/p95/p99/max: 4/213/413/956 ms
- calls over one second: 0

Compared with the released Chromium baseline, p95 improved from 218 ms to 213
ms and maximum latency improved from 27,682 ms to 956 ms while call volume rose
from 19,233 to 22,410. Browser family differs between these two qualifying runs,
so the result proves the Edge acceptance target and tail-latency reduction, not
a browser-neutral microbenchmark claim.

## 0.2.6 Overload Diagnostic

An exact `0.2.6` tree Edge run completed on 2026-07-22 in
`.artifacts/soak-edge-0.2.6-final/2026-07-22T06-25-58-531Z/`:

- elapsed: 901 seconds
- cycles: 422
- calls: 11,288 successful out of 11,288
- tool coverage: 52/52
- stale-route recoveries: 422
- duplicate write attempts: 0
- call latency p50/p95/p99/max: 5/321/682/25,122 ms

The run passed correctness, coverage, duration, duplicate-write, and p95 gates,
but failed the 10-second maximum gate. During the long-tail window, unrelated
concurrent compilation drove host load average as high as 115 and many unrelated
tool types slowed together. This artifact is overload diagnostic evidence, not
a replacement for the qualifying Edge candidate above.
