# Publishing Readiness

## Distribution Status

Checked on 2026-10-15:

- The public repository is
  [BoCodeLab/yunti-browser-runtime](https://github.com/BoCodeLab/yunti-browser-runtime).
- The latest GitHub release is
  [v0.2.9](https://github.com/BoCodeLab/yunti-browser-runtime/releases/tag/v0.2.9).
  The recommended installation path uses GitHub source or the release's source
  archive and loads the unpacked extension.
- The official npm registry reports `0.2.6`. A GitHub release does not publish
  a new npm package or change npm's `latest` tag.

These are dated observations. Recheck the selected channel before making a
release claim, and do not infer a running browser's version from a source tag.

## Local Gates

Before committing or preparing distribution:

```bash
npm run check:metadata
npm run release:check
```

The release gate validates public documentation, links, versions, CLI behavior,
syntax, tests, npm file inventory, and the extension ZIP. Real-browser tests
require `YUNTI_E2E=1`; zero failures with skipped browser tests is incomplete
acceptance. See [the endurance test](SOAK_TEST.md) for the full 15-minute gate.

Before publishing, scan the working tree, reachable Git history, and the actual
distribution archives for secrets. Keep local scan reports and generated
artifacts out of Git, and redact credential values in diagnostic output.

## npm Publishing

npm authentication and publish authorization must be checked for the current
release; a successful historical publish does not prove that credentials still
work. Use the release commands to verify identity and package contents:

```bash
npm run release:whoami
npm run release:dry-run
```

If npm requires two-factor authentication or different token permissions,
resolve that through npm's account controls before retrying. Keep tokens in
local credential storage. Never put them in source, commit messages, reports,
or a tracked `.npmrc`.

Actual npm publication is a separate action:

```bash
npm run release:publish
npm run release:verify-published
```

Only a successful publication followed by registry readback confirms the new
npm version. Repository pushes, extension ZIP creation, and passing tests do
not publish it. The complete workflow is documented in [RELEASE.md](RELEASE.md).
