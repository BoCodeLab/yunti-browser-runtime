export const DEFAULT_BRIDGE_URL = "http://127.0.0.1:48887"
export const BRIDGE_TOKEN_HEADER = "x-yunti-browser-token"
export const DEFAULT_PLATFORM_MATCHES = ["*"]

// Settings are read several times per tool call (bridge URL, token, platform
// matches, route user). Each read is a storage round trip on the hot path, so
// cache the normalized snapshot briefly. Invalidation is explicit through
// chrome.storage.onChanged (see installSettingsCacheInvalidation) and every
// mutation path also clears the cache, so a changed setting is never served
// for longer than SETTINGS_CACHE_TTL_MS.
const SETTINGS_CACHE_TTL_MS = 2_000
let cachedSettings = null
let cachedSettingsAt = 0

export function invalidateSettingsCache() {
  cachedSettings = null
  cachedSettingsAt = 0
}

export function installSettingsCacheInvalidation(target = globalThis.chrome) {
  if (!target?.storage?.onChanged?.addListener) return false
  target.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return
    invalidateSettingsCache()
  })
  return true
}

export async function getSettings() {
  const now = Date.now()
  if (cachedSettings && now - cachedSettingsAt < SETTINGS_CACHE_TTL_MS) {
    return cachedSettings
  }
  const stored = await chrome.storage.local.get([
    "localUserName",
    "localUserId",
    "bridgeUrl",
    "bridgeToken",
    "platformMatches",
  ])
  const platformMatches = normalizePlatformMatches(stored.platformMatches)
  const localUserName = normalizeLocalUserName(stored.localUserName || "local")
  const localUserId = stored.localUserId || "local"
  cachedSettings = {
    localUserName,
    localUserId,
    bridgeUrl: normalizeBaseUrl(stored.bridgeUrl || DEFAULT_BRIDGE_URL),
    bridgeToken: normalizeBridgeToken(stored.bridgeToken || ""),
    agentType: "browser_agent",
    platformMatches,
  }
  cachedSettingsAt = Date.now()
  return cachedSettings
}

export function normalizeBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
}

export function normalizeBridgeToken(value) {
  return String(value || "").trim()
}

export function normalizePlatformMatches(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[\n,]/)
        .map((item) => item.trim())
  const normalized = list.map(normalizeHostPattern).filter(Boolean)
  return normalized.length ? [...new Set(normalized)] : DEFAULT_PLATFORM_MATCHES
}

function normalizeHostPattern(value) {
  let text = String(value || "")
    .trim()
    .toLowerCase()
  if (!text) return ""
  text = text.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  return text
}

export function normalizeLocalUserName(value) {
  return String(value || "").trim().slice(0, 120)
}

export function isPlatformUrl(rawUrl, settings = null) {
  try {
    const url = new URL(String(rawUrl || ""))
    if (!["http:", "https:"].includes(url.protocol)) return false
    const matches = settings?.platformMatches || DEFAULT_PLATFORM_MATCHES
    return matches.some((pattern) => hostMatchesPattern(url.hostname, pattern))
  } catch {
    return false
  }
}

export function platformLabelForUrl(rawUrl) {
  try {
    return new URL(String(rawUrl || "")).hostname
  } catch {
    return "page"
  }
}

function hostMatchesPattern(hostname, pattern) {
  const host = String(hostname || "").toLowerCase()
  const pat = String(pattern || "").toLowerCase()
  if (!host || !pat) return false
  if (pat === "*") return true
  if (pat.startsWith("*.")) {
    const suffix = pat.slice(1)
    return host.endsWith(suffix) && host.length > suffix.length
  }
  return host === pat
}

export function bridgeHeaders(settings) {
  const headers = { "content-type": "application/json" }
  if (settings?.bridgeToken) headers[BRIDGE_TOKEN_HEADER] = settings.bridgeToken
  return headers
}
