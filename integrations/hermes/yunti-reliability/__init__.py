"""Profile-scoped adapter; does not edit the shared Hermes installation."""

import json
import hashlib
import re
import threading
from collections import OrderedDict
from contextvars import ContextVar
from functools import wraps

SERVER = "yunti-browser-runtime"
RECOVERY_TOOLS = {"yunti_list_browser_targets", "yunti_list_pages", "yunti_observe_page", "yunti_get_page_snapshot", "yunti_take_snapshot"}
APPLICATION_CODES = {
    "TARGET_OBSCURED", "TARGET_HIDDEN", "TARGET_DISABLED", "TARGET_READONLY",
    "TARGET_NOT_EDITABLE", "TARGET_WRONG_TAG", "VALUE_NOT_APPLIED",
    "UID_NOT_FOUND", "UID_COORDINATES_UNAVAILABLE", "WAIT_TIMEOUT",
    "SCRIPT_EXECUTION_FAILED", "OPTION_NOT_FOUND", "OPTION_DISABLED",
    "EXTENSION_TOOL_TIMEOUT", "CONTENT_SCRIPT_UNAVAILABLE", "LAST_TAB_CLOSE_BLOCKED",
    "YUNTI_PARAMETER_INVALID", "YUNTI_SESSION_STALE", "YUNTI_OBSERVATION_STALE",
    "YUNTI_PAGE_HANDLE_CLOSED", "YUNTI_PAGE_HANDLE_STALE", "YUNTI_PAGE_HANDLE_INVALID",
    "YUNTI_PAGE_HANDLE_ROUTE_MISMATCH", "YUNTI_PAGE_HANDLE_UNSUPPORTED_TOOL",
    "YUNTI_BROWSER_INSTANCE_OFFLINE", "YUNTI_INVENTORY_STALE", "YUNTI_TAB_BUSY",
    "YUNTI_TOOL_QUEUE_TIMEOUT", "YUNTI_CDP_TIMEOUT", "SCREENSHOT_FAILED",
    "YUNTI_TOOL_ERROR", "YUNTI_TOOL_TIMEOUT", "YUNTI_EXTENSION_PROTOCOL_MISMATCH",
    "YUNTI_BRIDGE_RUNTIME_MISMATCH", "YUNTI_BROWSER_INSTANCE_AMBIGUOUS",
}


def application_failure(result):
    """Only inspect the top-level tool failure, never arbitrary page/event data."""
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except (ValueError, TypeError):
            return False
    if not isinstance(result, dict):
        return False
    if result.get("ok") is False and (result.get("errorCategory") == "application" or result.get("code") in APPLICATION_CODES):
        return True
    error = result.get("error")
    if isinstance(error, str):
        # Hermes wraps an MCP isError text block in {"error": ...}. New Yunti
        # action failures use JSON; thrown failures begin with their code.
        try:
            return application_failure(json.loads(error))
        except (ValueError, TypeError):
            return any(error.startswith(code + ":") for code in APPLICATION_CODES) or error.startswith((
                "Browser tool execution timed out inside the extension:",
                "Timed out waiting for browser tool result:",
                "Yunti browser session is stale or disconnected:",
                "Another debugger is already attached", "unsupported_tab",
            ))
    return False


def failure_policy(result):
    """Read retry fields from the top-level failure or Hermes' error wrapper."""
    value = result
    for _ in range(4):
        if isinstance(value, str):
            try:
                value = json.loads(value)
                continue
            except (ValueError, TypeError):
                match = re.search(r"retryBudget=(\d+)", value)
                if match and application_failure({"error": value}):
                    return {"retryBudget": int(match.group(1)), "resultUncertain": "resultUncertain=true" in value}
                return None
        if not isinstance(value, dict):
            return None
        if value.get("ok") is False and isinstance(value.get("retryBudget"), int):
            return value
        value = value.get("error")
    return None


def install(mcp, registry):
    if getattr(mcp, "_yunti_reliability_installed", False):
        return
    pending = ContextVar("yunti_breaker_updates", default=None)
    original_bump = mcp._bump_server_error
    original_factory = mcp._make_tool_handler
    tickets = OrderedDict()
    tickets_lock = threading.RLock()

    def bump(server):
        updates = pending.get()
        if server == SERVER and updates is not None:
            updates.append(server)
        else:
            original_bump(server)

    def wrap(handler, tool_name):
        if getattr(handler, "_yunti_reliability", False):
            return handler

        @wraps(handler)
        def guarded(*args, **kwargs):
            fingerprint = hashlib.sha256(json.dumps(args[0] if args else kwargs.get("args", {}), sort_keys=True, default=str).encode()).hexdigest()
            key = (tool_name, fingerprint)
            with tickets_lock:
                ticket = tickets.get(key)
                if ticket:
                    if ticket["remaining"] <= 0:
                        return json.dumps({"ok": False, "code": "YUNTI_RETRY_BUDGET_EXHAUSTED", "error": "The shared retry budget is exhausted; verify state or refresh targets before choosing a new request.", "retryable": False, "retryBudget": 0, "resultUncertain": ticket["uncertain"], "rpcExecuted": False})
                    ticket["remaining"] -= 1
            updates = []
            token = pending.set(updates)
            result = None
            try:
                result = handler(*args, **kwargs)
                return result
            finally:
                pending.reset(token)
                if application_failure(result):
                    # An application reply proves the MCP transport worked.
                    mcp._reset_server_error(SERVER)
                else:
                    for server in updates:
                        original_bump(server)
                policy = failure_policy(result)
                with tickets_lock:
                    if policy:
                        if key not in tickets:
                            tickets[key] = {"remaining": max(0, policy["retryBudget"]), "uncertain": bool(policy.get("resultUncertain"))}
                        while len(tickets) > 512:
                            tickets.popitem(last=False)
                    elif result is not None and not application_failure(result):
                        try:
                            payload = json.loads(result) if isinstance(result, str) else result
                            if isinstance(payload, dict) and "error" not in payload and payload.get("ok") is not False:
                                tickets.pop(key, None)
                                if tool_name in RECOVERY_TOOLS:
                                    tickets.clear()
                        except (ValueError, TypeError):
                            pass
        guarded._yunti_reliability = True
        return guarded

    def factory(server_name, tool_name, tool_timeout):
        handler = original_factory(server_name, tool_name, tool_timeout)
        return wrap(handler, tool_name) if server_name == SERVER else handler

    mcp._bump_server_error = bump
    mcp._make_tool_handler = factory
    # Cover tools already discovered before plugin registration as well as
    # future discoveries/reconnects. Other MCP servers retain their handlers.
    with registry._lock:
        for entry in registry.get_all_entries():
            if entry.name.startswith("mcp__yunti_browser_runtime__"):
                entry.handler = wrap(entry.handler, entry.name.split("__")[-1])
    mcp._yunti_reliability_installed = True


def register(ctx):
    from tools import mcp_tool
    from tools.registry import registry
    install(mcp_tool, registry)
