export function classifyToolFailure(error, tool = "") {
  const message = error instanceof Error ? error.message : String(error)
  const structured = normalizeBridgeFailure(error)
  // A failure that already carries its own contract outranks the message-shape
  // heuristics below: the extension knows more about its own failure than a
  // regex over the error text does.
  if (structured) {
    return {
      message,
      code: structured.code,
      retryable: Boolean(structured.retryable),
      retryBudget: Number(structured.retryBudget || 0),
      recoveryAction: structured.recoveryAction || inferRecoveryAction(structured.code),
      resultUncertain: Boolean(structured.resultUncertain),
      recoverable: structured.recoverable,
      action: structured.action,
      target: structured.target,
      recoveryHint: structured.recoveryHint,
      nextStepHint: structured.nextStepHint,
      diagnostics: structured.diagnostics,
      detail: buildFailureDetail(structured, message),
    }
  }
  if (/YUNTI_EXTENSION_PROTOCOL_MISMATCH/.test(message)) {
    return {
      message,
      code: "YUNTI_EXTENSION_PROTOCOL_MISMATCH",
      retryable: false,
      retryBudget: 0,
      recoveryAction: "reload_extension_then_run_doctor",
      resultUncertain: false,
      detail: "Do not retry browser tools until yunti-browser-runtime doctor reports matching runtime, extension, and protocol versions.",
    }
  }
  if (/YUNTI_BRIDGE_RUNTIME_MISMATCH/.test(message)) {
    return {
      message,
      code: "YUNTI_BRIDGE_RUNTIME_MISMATCH",
      retryable: false,
      retryBudget: 0,
      recoveryAction: "restart_mcp_bridge_then_run_doctor",
      resultUncertain: false,
      detail: "Do not retry browser tools until the running bridge version matches this MCP package.",
    }
  }
  if (/YUNTI_BROWSER_INSTANCE_AMBIGUOUS/.test(message)) {
    return {
      message,
      code: "YUNTI_BROWSER_INSTANCE_AMBIGUOUS",
      retryable: false,
      retryBudget: 0,
      recoveryAction: "select_browser_instance",
      resultUncertain: false,
      detail: "List targets through the intended routeBrowserSessionId, then pass that page browserSessionId or browserInstanceId.",
    }
  }
  if (/YUNTI_TAB_BUSY|YUNTI_CDP_TIMEOUT/.test(message)) {
    return {
      message,
      code: /YUNTI_TAB_BUSY/.test(message) ? "YUNTI_TAB_BUSY" : "YUNTI_CDP_TIMEOUT",
      retryable: !/YUNTI_CDP_TIMEOUT/.test(message),
      retryBudget: /YUNTI_CDP_TIMEOUT/.test(message) ? 0 : 1,
      recoveryAction: "verify_page_state_then_retry",
      resultUncertain: /YUNTI_CDP_TIMEOUT/.test(message),
      detail: "A previous operation on this tab has not finished. Verify the current page state, then retry once instead of stacking more work on the same tab.",
    }
  }
  if (/YUNTI_PARAMETER_INVALID|is required|must be (a )?number/.test(message)) {
    return {
      message,
      code: "YUNTI_PARAMETER_INVALID",
      retryable: false,
      retryBudget: 0,
      recoveryAction: "fix_arguments_and_retry",
      resultUncertain: false,
      detail: "The tool arguments were rejected before the browser was touched. Correct the arguments from yunti_get_tool_usage_hints and retry.",
    }
  }
  if (/stale or disconnected|heartbeat expired|no longer exists|showing error page/i.test(message)) {
    return {
      message,
      code: "YUNTI_SESSION_STALE",
      retryable: true,
      retryBudget: 1,
      recoveryAction: "list_targets_then_retry_once",
      resultUncertain: false,
      detail: "Discard the stale browserSessionId, list live targets once, and retry only with the selected live page route.",
    }
  }
  if (/timed out/i.test(message)) {
    return {
      message,
      code: "YUNTI_TOOL_TIMEOUT",
      retryable: false,
      retryBudget: 0,
      recoveryAction: "verify_state_before_retry",
      resultUncertain: true,
      detail: `The ${tool || "browser"} result is uncertain. Inspect current page state before deciding whether another call is safe.`,
    }
  }
  return {
    message,
    code: "YUNTI_TOOL_ERROR",
    retryable: false,
    retryBudget: 0,
    recoveryAction: "inspect_error",
    resultUncertain: false,
    detail: "Inspect the error and current browser targets before making another call.",
  }
}

const STRUCTURED_FAILURE_KEYS = [
  "code",
  "retryable",
  "retryBudget",
  "recoveryAction",
  "resultUncertain",
  "recoverable",
  "action",
  "target",
  "recoveryHint",
  "nextStepHint",
  "diagnostics",
]

function normalizeBridgeFailure(error) {
  const raw = error?.structuredFailure
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const out = {}
  for (const key of STRUCTURED_FAILURE_KEYS) {
    const value = raw[key]
    if (value === undefined || value === null || value === "") continue
    out[key] = value
  }
  if (typeof out.code !== "string" || !out.code) return null
  return out
}

function inferRecoveryAction(code) {
  switch (code) {
    case "CONTROLLER_PAGE_ROUTE_REQUIRED":
      return "list_targets_then_retry_with_tab_id_or_page_session"
    case "CONTENT_SCRIPT_UNAVAILABLE":
      return "list_targets_then_retry_same_page_once"
    case "EXTENSION_TOOL_TIMEOUT":
      return "verify_state_before_retry"
    case "LAST_TAB_CLOSE_BLOCKED":
      return "inspect_error"
    default:
      return "inspect_error"
  }
}

function buildFailureDetail(structured, message) {
  const hint = structured.recoveryHint
  const nextAction = hint?.nextAction || structured.recoveryAction || ""
  const tools = Array.isArray(hint?.recommendedTools)
    ? ` Recommended tools: ${hint.recommendedTools.join(", ")}.`
    : ""
  const uncertain = structured.resultUncertain
    ? " The browser-side result is uncertain; verify page state before repeating a write."
    : ""
  const next = structured.nextStepHint ? ` ${structured.nextStepHint}` : ""
  return `${next}${nextAction ? ` Next action: ${nextAction}.` : ""}${tools}${uncertain}`.trim()
}

export function errorFromFailure(data, fallback) {
  const error = new Error(data?.error || fallback)
  if (data?.failure?.code) error.structuredFailure = data.failure
  return error
}
