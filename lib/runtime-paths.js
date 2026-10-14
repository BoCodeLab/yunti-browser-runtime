import { homedir } from "node:os"
import { join, resolve } from "node:path"

export function yuntiHome() {
  return expandHome(process.env.YUNTI_HOME || "~/.yunti_agent")
}

export function yuntiMemoryDir(userId = "") {
  const userSegment = yuntiUserIdPathSegment(userId)
  if (userSegment) {
    return join(yuntiHome(), "users", userSegment, "memory")
  }
  return expandHome(
    process.env.YUNTI_BROWSER_DATA_DIR || join(yuntiHome(), "memory")
  )
}

export function yuntiMemoryFile(userId = "") {
  return join(yuntiMemoryDir(userId), "learning-memory.json")
}

export function yuntiUserIdPathSegment(value) {
  const userId = String(value || "").trim()
  if (!userId || userId === "anonymous") return ""
  return encodeURIComponent(userId)
}

export function yuntiOperationLedgerDir() {
  return expandHome(
    process.env.YUNTI_BROWSER_LEDGER_DIR || join(yuntiHome(), "operations")
  )
}

export function yuntiOperationLedgerFile(date = new Date()) {
  const day = (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10)
  return join(yuntiOperationLedgerDir(), `${day}.jsonl`)
}

export function yuntiVendorRoot() {
  return expandHome(
    process.env.YUNTI_VENDOR_DIR || join(yuntiHome(), "vendor")
  )
}

export function expandHome(value) {
  const raw = String(value || "").trim()
  if (!raw || raw === "~") return homedir()
  if (raw.startsWith("~/")) return join(homedir(), raw.slice(2))
  return resolve(raw)
}
