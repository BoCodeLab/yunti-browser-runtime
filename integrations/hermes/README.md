# Hermes profile integration

The `yunti-reliability` plugin keeps a valid browser/application failure out of
Hermes' MCP service breaker. Only real connection, RPC and process failures
continue counting toward that breaker. Other MCP servers are unchanged.

Install into the intended profile, rather than editing the shared Hermes
checkout:

1. Copy `yunti-reliability/` into that profile's `plugins/` directory.
2. If the profile uses a plugin allowlist, append `yunti-reliability` to it.
3. Run `install-skill --dest <profile>/skills` to synchronize the agent workflow.
4. Load the profile in a new gateway process or session using its normal
   lifecycle controls. Copying files does not update already running Python.

The plugin wraps both existing tool registry handlers and future MCP discovery.
It defers breaker updates within a context-local call, classifies only a
top-level Yunti failure, and preserves transport-failure updates. Network event
data and arbitrary error-like page text do not close the breaker.

Run the standard-library regression tests with:

```sh
python integrations/hermes/test_reliability.py
```

The adapter uses Hermes' private MCP factory and tool registry. Recheck those
interfaces when updating Hermes. Tests cover repeated application errors,
legacy extension timeout replies, true transport failures, unrelated servers
and concurrent calls. Runtime source validation does not restart a live gateway.

The adapter also shares the explicit retry budget across identical calls. A
zero-budget repeat is rejected before RPC; a budget of one permits one retry,
even if the repeated failure advertises one again. Successful recovery reads
start a new chain. This guard does not replace business-state verification or
authorize replaying an uncertain action through another backend.
