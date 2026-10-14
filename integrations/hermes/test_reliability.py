import importlib.util
import json
import sys
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("yunti_reliability", Path(__file__).parent / "yunti-reliability" / "__init__.py")
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


class ReliabilityTests(unittest.TestCase):
    def client(self):
        counts = {}
        client = SimpleNamespace()
        client.calls = 0
        def bump(server): counts[server] = counts.get(server, 0) + 1
        def reset(server): counts[server] = 0
        def factory(server, tool, timeout):
            def handler(args, **kwargs):
                client.calls += 1
                if counts.get(server, 0) >= 3:
                    return json.dumps({"error": "service breaker is open"})
                client._bump_server_error(server)
                return args["result"]
            return handler
        client._bump_server_error = bump
        client._reset_server_error = reset
        client._make_tool_handler = factory
        client.entry = SimpleNamespace(name="mcp__yunti_browser_runtime__yunti_fill", handler=factory(plugin.SERVER, "yunti_fill", 30))
        registry = SimpleNamespace(_lock=threading.RLock(), get_all_entries=lambda: [client.entry])
        plugin.install(client, registry)
        return client, counts

    def test_page_errors_do_not_open_the_service_breaker(self):
        client, counts = self.client()
        handler = client._make_tool_handler(plugin.SERVER, "yunti_fill", 30)
        result = json.dumps({"error": json.dumps({"ok": False, "action": "fill", "code": "TARGET_OBSCURED"})})
        for _ in range(5): self.assertEqual(handler({"result": result}), result)
        self.assertEqual(counts[plugin.SERVER], 0)

    def test_transport_errors_and_other_servers_still_open_breakers(self):
        client, counts = self.client()
        handler = client._make_tool_handler(plugin.SERVER, "yunti_fill", 30)
        for _ in range(3): handler({"result": json.dumps({"error": "Transport closed"})})
        self.assertEqual(counts[plugin.SERVER], 3)
        other = client._make_tool_handler("other", "read", 30)
        other({"result": json.dumps({"ok": False, "code": "TARGET_OBSCURED"})})
        self.assertEqual(counts["other"], 1)

    def test_legacy_extension_timeouts_do_not_open_the_service_breaker(self):
        client, counts = self.client()
        handler = client._make_tool_handler(plugin.SERVER, "yunti_evaluate_script", 30)
        result = json.dumps({"error": "Browser tool execution timed out inside the extension: yunti_evaluate_script"})
        for _ in range(5): self.assertEqual(handler({"result": result}), result)
        self.assertEqual(counts[plugin.SERVER], 0)

    def test_event_data_does_not_masquerade_as_a_top_level_error(self):
        self.assertFalse(plugin.application_failure({"events": [{"ok": False, "code": "TARGET_OBSCURED"}]}))
        self.assertFalse(plugin.application_failure({"error": "Unrecognized connection failure"}))
        self.assertTrue(plugin.application_failure({"error": "YUNTI_PAGE_HANDLE_CLOSED: tab is closed"}))

    def test_pending_counts_are_isolated_between_concurrent_calls(self):
        client, counts = self.client()
        page = client._make_tool_handler(plugin.SERVER, "yunti_fill", 30)
        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(lambda _: page({"result": json.dumps({"ok": False, "code": "TARGET_OBSCURED"})}), range(12)))
        self.assertEqual(counts[plugin.SERVER], 0)

    def test_terminal_calls_are_not_replayed_and_single_retry_is_shared(self):
        client, _ = self.client()
        handler = client._make_tool_handler(plugin.SERVER, "yunti_evaluate_script", 30)
        terminal = json.dumps({"error": json.dumps({"ok": False, "code": "YUNTI_PAGE_HANDLE_CLOSED", "retryBudget": 0})})
        handler({"result": terminal})
        blocked = json.loads(handler({"result": terminal}))
        self.assertEqual(blocked["code"], "YUNTI_RETRY_BUDGET_EXHAUSTED")
        self.assertFalse(blocked["rpcExecuted"])
        self.assertEqual(client.calls, 1)
        retryable = json.dumps({"error": json.dumps({"ok": False, "code": "CONTENT_SCRIPT_UNAVAILABLE", "retryBudget": 1})})
        handler({"result": retryable})
        handler({"result": retryable})
        self.assertFalse(json.loads(handler({"result": retryable}))["rpcExecuted"])
        self.assertEqual(client.calls, 3)

    def test_successful_recovery_allows_a_new_failure_chain(self):
        client, _ = self.client()
        action = client._make_tool_handler(plugin.SERVER, "yunti_click", 30)
        result = json.dumps({"error": json.dumps({"ok": False, "code": "TARGET_OBSCURED", "retryBudget": 0, "resultUncertain": True})})
        action({"result": result})
        self.assertTrue(json.loads(action({"result": result}))["resultUncertain"])
        recovery = client._make_tool_handler(plugin.SERVER, "yunti_observe_page", 30)
        recovery({"result": json.dumps({"ok": True})})
        self.assertEqual(action({"result": result}), result)

    def test_already_registered_handlers_and_keyword_factories_are_wrapped(self):
        client, counts = self.client()
        error = json.dumps({"error": "YUNTI_PAGE_HANDLE_CLOSED: tab closed"})
        for _ in range(5): client.entry.handler({"result": error})
        self.assertEqual(counts[plugin.SERVER], 0)
        self.assertTrue(callable(client._make_tool_handler(server_name=plugin.SERVER, tool_name="yunti_click", tool_timeout=30)))


if __name__ == "__main__":
    unittest.main()
