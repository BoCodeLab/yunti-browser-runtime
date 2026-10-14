export const MIN_QUALIFYING_SOAK_DURATION_MS = 15 * 60 * 1000
export const DEFAULT_SOAK_DURATION_MS = MIN_QUALIFYING_SOAK_DURATION_MS

export const SOAK_TOOL_PHASES = {
  discovery: [
    "yunti_get_tool_usage_hints",
    "yunti_get_page_snapshot",
    "yunti_observe_page",
    "yunti_find_elements",
    "yunti_get_selected_context",
    "yunti_list_browser_targets",
    "yunti_get_browser_target",
    "yunti_list_pages",
    "yunti_select_page",
    "yunti_take_snapshot",
  ],
  interaction: [
    "yunti_click_at",
    "yunti_type_text",
    "yunti_press_key",
    "yunti_scroll",
    "yunti_drag",
    "yunti_upload_file",
    "yunti_click",
    "yunti_hover",
    "yunti_fill",
    "yunti_select",
    "yunti_fill_form",
    "yunti_wait_for",
  ],
  pageLifecycle: [
    "yunti_new_page",
    "yunti_close_page",
    "yunti_navigate_page",
    "yunti_resize_page",
    "yunti_emulate",
    "yunti_handle_dialog",
    "yunti_request_user_confirmation",
  ],
  diagnostics: [
    "yunti_fetch_with_cookie",
    "yunti_read_result_chunk",
    "yunti_list_downloads",
    "yunti_get_network_log",
    "yunti_clear_network_log",
    "yunti_clear_network_requests",
    "yunti_list_network_requests",
    "yunti_get_network_request",
    "yunti_capture_visible_tab",
    "yunti_cdp_send_command",
    "yunti_cdp_detach",
    "yunti_get_cdp_events",
    "yunti_clear_cdp_events",
    "yunti_list_console_messages",
    "yunti_get_console_message",
    "yunti_clear_console_messages",
    "yunti_performance_start_trace",
    "yunti_performance_stop_trace",
    "yunti_take_screenshot",
    "yunti_evaluate_script",
  ],
  reversibleState: [
    "yunti_remember_learning",
    "yunti_get_learning_memory",
    "yunti_forget_learning_memory",
    "yunti_apply_preview_patch",
    "yunti_rollback_preview_patch",
  ],
}

export const SOAK_EXPECTED_TOOLS = Object.freeze(
  Object.values(SOAK_TOOL_PHASES).flat()
)

export function summarizeSoakCoverage(invokedTools, availableTools = SOAK_EXPECTED_TOOLS) {
  const invoked = new Set(invokedTools)
  const expected = [...new Set(availableTools)].sort()
  const covered = expected.filter((name) => invoked.has(name))
  const missing = expected.filter((name) => !invoked.has(name))
  const unexpected = [...invoked].filter((name) => !expected.includes(name)).sort()
  return {
    expectedCount: expected.length,
    coveredCount: covered.length,
    covered,
    missing,
    unexpected,
    complete: missing.length === 0,
  }
}
