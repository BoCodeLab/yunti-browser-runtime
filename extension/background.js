import { createCdpController } from "./cdp.js"
import { installNetworkMonitor } from "./network-monitor.js"
import { createSessionManager } from "./session-manager.js"
import { createToolDispatcher } from "./tool-handlers.js"
import { installSettingsCacheInvalidation } from "./settings.js"

const BRIDGE_RECOVERY_ALARM_NAME = "yunti_bridge_recovery"
const FAST_RECOVERY_DELAYS_MS = [1000, 3000, 8000, 15000, 30000]

const sessionManager = createSessionManager()
const {
  forwardConsoleEvent,
  postBridge,
  sessionsByTab,
} = sessionManager

const cdp = createCdpController({
  sessionsByTab,
  postBridge,
  forwardConsoleEvent,
})

const { detachCdpTab, installCdpEventForwarder } = cdp
const { executeToolRequest } = createToolDispatcher({
  sessionsByTab,
  postBridge,
  ensureTabRegistered: sessionManager.ensureTabRegistered,
  cdp,
  getPlatformMatches: sessionManager.getPlatformMatches,
  getCaptureDiagnostics: sessionManager.getCaptureDiagnostics,
})

sessionManager.setToolRequestHandler(executeToolRequest)

const networkMonitor = installNetworkMonitor({
  sessionsByTab,
  postBridge,
  getPlatformMatches: sessionManager.getPlatformMatches,
})
if (networkMonitor?.getCaptureDiagnostics) {
  sessionManager.setCaptureDiagnosticsProvider(networkMonitor.getCaptureDiagnostics)
}
installCdpEventForwarder()
installSettingsCacheInvalidation()

chrome.tabs.onRemoved.addListener((tabId) => {
  void detachCdpTab(tabId, null, "tab_removed").catch(() => {})
  void sessionManager.forgetTab(tabId, "tab_removed").catch(() => {})
})

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void sessionManager.activateTab(tabId)
  void sessionManager.ensureTabRegistered(tabId, { reason: "tab_activated" }).catch(() => {})
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return
  void sessionManager.ensureTabRegistered(tabId, {
    tab,
    reason: "tab_updated_complete",
  }).catch(() => {})
})

chrome.runtime.onInstalled.addListener(() => {
  recoverBrowserController("extension_installed")
})

chrome.runtime.onStartup.addListener(() => {
  recoverBrowserController("browser_startup")
})

chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName !== "local") return
  if (!changes.bridgeUrl && !changes.bridgeToken && !changes.localUserId) return
  recoverBrowserController("bridge_settings_changed")
})

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm?.name !== BRIDGE_RECOVERY_ALARM_NAME) return
  recoverBrowserController("bridge_recovery_alarm")
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void sessionManager.handleMessage(message, sender).then(sendResponse, (error) =>
    sendResponse({ ok: false, error: error?.message || String(error) })
  )
  return true
})

function recoverBrowserController(reason) {
  void sessionManager.registerBrowserController(reason).catch(() => {})
}

function scheduleBridgeRecovery() {
  if (chrome.alarms?.create) {
    chrome.alarms.create(BRIDGE_RECOVERY_ALARM_NAME, {
      delayInMinutes: 0.5,
      periodInMinutes: 0.5,
    })
  }
  for (const delayMs of FAST_RECOVERY_DELAYS_MS) {
    setTimeout(() => recoverBrowserController(`bridge_recovery_fast_${delayMs}`), delayMs)
  }
}

recoverBrowserController("background_started")
scheduleBridgeRecovery()
