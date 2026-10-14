import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inspectSkillCopies } from "../lib/skill-status.js"

test("skill fingerprints distinguish an outdated harness copy from a matching installation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yunti-skill-status-"))
  try {
    const files = ["packaged", "current", "outdated"].map(name => join(dir, name))
    await Promise.all(files.map((file, i) => writeFile(file, i === 2 ? "stale recovery contract" : "current recovery contract")))
    const result = inspectSkillCopies(files[0], [files[1], files[2], files[1], join(dir, "missing")])
    assert.equal(result.installations.length, 2)
    assert.equal(result.mismatches, 1)
    assert.equal(result.installations[0].matchesPackaged, true)
    assert.equal(result.installations[1].matchesPackaged, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
