#!/usr/bin/env node
// Cross-platform replacement for the inline POSIX env assignment that used to
// live in package.json ("YUNTI_BROWSER_BRIDGE_ONLY=1 node mcp/server.js").
// cmd.exe on Windows cannot parse that syntax, so the bridge-only mode is
// selected here instead. Used by both `npm run bridge` and `npm run console`.
//
// mcp/server.js only auto-starts when it is the entry point, so importing it
// and calling runBridgeOnly() is the equivalent of running it with
// YUNTI_BROWSER_BRIDGE_ONLY=1.
const { runBridgeOnly } = await import("../mcp/server.js")
await runBridgeOnly()
