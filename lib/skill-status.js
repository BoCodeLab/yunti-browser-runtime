import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"

export function skillFingerprint(file) {
  return existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null
}

export function inspectSkillCopies(source, candidates) {
  const sha256 = skillFingerprint(source)
  const installations = [...new Set(candidates)].filter(file => existsSync(file)).map(file => {
    const installedSha256 = skillFingerprint(file)
    return { path: file, sha256: installedSha256, matchesPackaged: installedSha256 === sha256 }
  })
  return { sha256, installations, mismatches: installations.filter(copy => !copy.matchesPackaged).length }
}
