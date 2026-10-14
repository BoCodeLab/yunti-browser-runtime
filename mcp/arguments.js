import { schemaForTool, BRIDGE_LOCAL_TOOLS, MEMORY_LOCAL_TOOLS, META_LOCAL_TOOLS } from "./tools.js"

export function validateToolArguments(tool, args) {
  const schema = schemaForTool(tool)
  const fail = (message) => {
    const error = new Error(`YUNTI_PARAMETER_INVALID: ${tool}: ${message}`)
    error.structuredFailure = {
      code: "YUNTI_PARAMETER_INVALID", retryable: false, retryBudget: 0,
      recoveryAction: "fix_arguments_and_retry", resultUncertain: false,
    }
    throw error
  }
  if (!schema) fail("unknown tool")
  function validate(value, rule, location) {
    const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value
    if (rule.type && !(rule.type === type || rule.type === "integer" && Number.isInteger(value))) fail(`${location} must be ${rule.type}`)
    if (rule.enum && !rule.enum.includes(value)) fail(`${location} must be one of ${rule.enum.join(", ")}`)
    if (typeof value === "number" && (!Number.isFinite(value) || value < (rule.minimum ?? -Infinity) || value > (rule.maximum ?? Infinity))) fail(`${location} is outside its declared range`)
    if (type === "object") {
      for (const key of rule.required || []) if (value[key] === undefined) fail(`${location}.${key} is required`)
      for (const [key, child] of Object.entries(value)) {
        if (rule.properties?.[key]) validate(child, rule.properties[key], `${location}.${key}`)
        else if (rule.additionalProperties === false) fail(`unknown argument ${location}.${key}; allowed: ${Object.keys(rule.properties || {}).join(", ")}`)
        else if (rule.additionalProperties && typeof rule.additionalProperties === "object") validate(child, rule.additionalProperties, `${location}.${key}`)
      }
      if (rule.anyOf && !rule.anyOf.some(option => (option.required || []).every(key => value[key] !== undefined))) fail(`${location} must provide one of the documented argument combinations`)
    }
    if (type === "array" && rule.items) value.forEach((child, i) => validate(child, rule.items, `${location}[${i}]`))
  }
  validate(args, schema, "arguments")
  return args
}

export function effectiveToolTimeoutMs(tool, args, timeoutMs) {
  const declared = ["yunti_wait_for", "yunti_evaluate_script"].includes(tool) ? Number(args.timeoutMs || 0) : 0
  if (timeoutMs === undefined) return Math.max(30000, declared + 2000)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000 || timeoutMs < declared) {
    throw new Error("YUNTI_PARAMETER_INVALID: outer timeoutMs must cover the declared tool timeout and be between 1 and 120000 milliseconds")
  }
  return timeoutMs
}

export function dispatchBridgeTool(hub, tool, args, timeoutMs) {
  validateToolArguments(tool, args)
  if (BRIDGE_LOCAL_TOOLS.has(tool) || MEMORY_LOCAL_TOOLS.has(tool) || META_LOCAL_TOOLS.has(tool)) return hub.callBridgeLocalTool(tool, args)
  return hub.callTool(tool, args, effectiveToolTimeoutMs(tool, args, timeoutMs))
}
