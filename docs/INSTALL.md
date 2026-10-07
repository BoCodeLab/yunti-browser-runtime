# Install Guide

## Requirements

- Node.js 22 or newer.
- Chrome, Edge, or another Chromium browser with extension developer mode.
- An MCP-capable agent.

## Bridge Startup

Normal MCP usage does not require manually starting the bridge. After the agent
loads the `yunti-browser-runtime` MCP server, that stdio process starts the
local bridge automatically.

For standalone debugging from the project root:

```bash
npm install
npm run bridge
```

By default the bridge listens on:

```text
http://127.0.0.1:48887
```

Use a custom port when needed:

```bash
YUNTI_BROWSER_BRIDGE_PORT=48999 npm run bridge
```

默认本地 bridge 只监听 `127.0.0.1`，不需要配置 token。需要额外加固本机访问、
或自定义部署时，可以显式启用 token：

```bash
YUNTI_BROWSER_BRIDGE_TOKEN="$(openssl rand -hex 24)" npm run bridge
```

需要自定义允许的 CORS 来源时：

```bash
YUNTI_BROWSER_BRIDGE_ALLOW_ORIGINS="http://127.0.0.1,http://localhost,chrome-extension://*" npm run bridge
```

When Yunti Browser Runtime is registered as an MCP server, the agent starts the
stdio MCP process and that process starts the local bridge automatically. The
standalone `bridge` command is useful for debugging, doctor checks, or manual
extension testing.

## Load The Extension

Development loading:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select the project `extension/` directory.
5. Open or keep any `http` or `https` page. The extension first connects a
   browser-level controller heartbeat to the bridge; concrete page sessions are
   registered on activation, page load, or when page tools need a route.
6. Do not open the extension popup unless you want to confirm status or
   customize settings.

The extension defaults to `http://127.0.0.1:48887`. Local installs do not need a
token, opening the popup, or saving popup settings. The extension maintains a
browser controller route and registers page routes with the local bridge when
needed. It does not create agent conversations or depend on a remote workspace.

To create a distributable zip:

```bash
npm run package:extension
```

The package is written to `dist/yunti-browser-runtime-extension-<version>.zip`
and contains only the extension runtime files.

## Register MCP

Print the MCP server configuration for your agent, then add it to your agent
configuration:

```bash
npm run print-config
npm run print-config -- --agent codex --human
npm run print-config -- --agent claude-code --human
npm run print-config -- --agent cursor --human
npm run print-config -- --agent cline --human
```

The stdio MCP server starts or reuses the local bridge automatically. Running
`npm run bridge` manually is useful for debugging, but not always required by
agents that launch the MCP server themselves.

### Agent Examples

These examples intentionally use `npm run print-config` instead of hard-coded
local paths. Copy the JSON printed by the command into the matching agent's MCP
configuration file or UI.

#### Codex

```bash
npm run print-config -- --agent codex --human
```

Then install the browser skill if your Codex setup supports skills:

```bash
mkdir -p ~/.codex/skills
cp -R skills/yunti-browser-runtime ~/.codex/skills/
```

Start a new Codex session after adding the MCP server and skill. For browser
tasks, the session should call `yunti_get_tool_usage_hints` first, then
`yunti_list_browser_targets`.

#### Claude Code

```bash
npm run print-config -- --agent claude-code --human
```

Add the printed `mcpServers.yunti-browser-runtime` block to Claude Code's MCP
configuration. The default local loopback setup does not require a bridge token.
If using a bridge token, set `YUNTI_BROWSER_BRIDGE_TOKEN` in the same environment
Claude Code uses to launch the MCP server, and save the same token in the
extension popup.

#### Cursor

```bash
npm run print-config -- --agent cursor --human
```

Add the printed `mcpServers` JSON to Cursor's MCP configuration. Restart or
reload Cursor after saving the config, then run `npm run doctor` from this
project to confirm the bridge and extension are healthy.

#### Cline

```bash
npm run print-config -- --agent cline --human
```

Add the printed server entry to Cline's MCP settings. Keep the extension loaded
in Chrome/Edge. The extension should register accessible `http`/`https` pages
on activation, load, or page-tool use. In `0.2.3+`, page tools can take the
`tabId` / `targetId` returned by `yunti_list_browser_targets` and recover the
page route automatically; refresh only when browser injection is explicitly
blocked.

## Check Health

```bash
npm run doctor
```

Expected JSON output includes `ok: true` when the local setup is healthy.
The command also prints a human-readable summary to stderr. If an agent needs
machine-only output, run:

```bash
npm run doctor:json
```

In `0.2.5+`, doctor also compares the runtime with the extension version and
protocol actually running in the browser. `YUNTI_EXTENSION_PROTOCOL_MISMATCH`
must be resolved before browser tools are called; retries cannot repair an old
service worker.

## Release Check

Before publishing or sharing a release candidate, run:

```bash
npm run release:check
```

This command checks public docs for local/internal residue, runs syntax checks,
runs the unit test suite, and verifies the npm package contents with
`npm pack --dry-run`.

## Common Recovery

- If tools say no browser route is connected, run doctor first. If the extension
  controller is online but no page session is active, call
  `yunti_list_browser_targets`, then pass the intended `tabId` or `targetId`
  directly to the page tool. The controller will establish the page route.
- If doctor reports `authorized: false` with `authRequired: true`, set
  `YUNTI_BROWSER_BRIDGE_TOKEN` and save the same token in the extension popup.
- Read `retryable`, `retryBudget`, `recoveryAction`, and `resultUncertain` before
  recovery. For a stale route, discard the stale id, list targets once, and use
  the single retry on the selected live page route.
- In `0.2.4+`, Edge sleeping tabs are recovered with bounded probe/injection
  timeouts. Yunti may briefly activate the target tab and then restore the
  user's previous tab. Do not ask the user to switch, refresh, or reopen the
  page before this automatic recovery and explicit `tabId` / `targetId` retry
  have failed.
- If a parameter error appears, call `yunti_get_tool_usage_hints` with the
  failed tool name before retrying.
- For `yunti_fill`, pass `value` plus `uid` or `selector`; coordinate-only fill
  is rejected.
- For closing a raw `tabId` or `targetId`, use `yunti_cdp_send_command` with
  `Target.closeTarget` instead of `yunti_close_page`.
- If the extension was reloaded, the browser controller should reconnect
  automatically. Page routes register on activation, load, or page-tool use;
  the user does not need to refresh ordinary `http` / `https` pages.
  A timed-out page operation does not disconnect the controller. Refresh browser
  pages only if the page cannot be injected or remains invisible after bounded
  controller, sleeping-tab, and explicit target recovery.

## Real Browser Smoke Test

The real-browser E2E smoke test is opt-in so regular CI and local checks can run
without launching a browser:

```bash
YUNTI_E2E=1 npm run test:e2e
```

It uses Playwright with a persistent Chromium profile, loads the unpacked
extension, starts a local test page, starts the bridge, and verifies MCP list
targets, page snapshot, `observe -> click uid -> verify`, fill, and CDP
`Runtime.evaluate`. Install
Playwright and Chromium before enabling it. Failures print the artifact
directory containing screenshot and error log paths.
