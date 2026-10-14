import { cp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

// Set the default before the worker's first instruction. Updating storage only
// after startup lets a fixture briefly register with a user's live bridge.
export async function copyIsolatedExtension(source, target, bridgeUrl) {
  await cp(source, target, { recursive: true })
  const file = join(target, "settings.js")
  const text = await readFile(file, "utf8")
  const patched = text.replace(/export const DEFAULT_BRIDGE_URL = "[^"]+"/, `export const DEFAULT_BRIDGE_URL = ${JSON.stringify(bridgeUrl)}`)
  if (patched === text) throw new Error("Fixture extension default bridge could not be isolated")
  await writeFile(file, patched)
  return target
}
