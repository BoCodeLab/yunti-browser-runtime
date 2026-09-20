export function jsonRpcOk(id, result) {
  return { jsonrpc: "2.0", id, result }
}

export function jsonRpcErr(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

export function toolOk(value) {
  if (value && typeof value === "object" && typeof value.dataUrl === "string") {
    const match = value.dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i)
    if (match) {
      const { dataUrl: _dataUrl, ...summary } = value
      return {
        content: [
          { type: "text", text: JSON.stringify(summary, null, 2) },
          { type: "image", mimeType: match[1], data: match[2] },
        ],
        structuredContent: summary,
      }
    }
  }
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  }
}

export function toolError(message, options = {}) {
  const detail = typeof options === "string" ? options : options.detail || null
  const payload = detail ? `${message}\n${detail}` : message
  const failure = {
    ok: false,
    code: typeof options === "object" ? options.code || "YUNTI_TOOL_ERROR" : "YUNTI_TOOL_ERROR",
    message,
    retryable: typeof options === "object" ? Boolean(options.retryable) : false,
    retryBudget: typeof options === "object" ? Number(options.retryBudget || 0) : 0,
    recoveryAction: typeof options === "object" ? options.recoveryAction || "inspect_error" : "inspect_error",
    resultUncertain: typeof options === "object" ? Boolean(options.resultUncertain) : false,
  }
  // Optional additive fields: browser-side failures carry their own
  // recoverable/recoveryHint/nextStepHint contract, and dropping it here would
  // force the agent back to guessing from prose.
  if (typeof options === "object" && options !== null) {
    for (const key of ["recoverable", "recoveryHint", "nextStepHint", "action", "target", "diagnostics"]) {
      const value = options[key]
      if (value === undefined || value === null || value === "") continue
      failure[key] = value
    }
  }
  return {
    isError: true,
    content: [{ type: "text", text: payload }],
    structuredContent: failure,
  }
}
