# Publishing Blockers

This document tracks release blockers that require external confirmation before
publishing `yunti-browser-runtime`.

## Current Status

No active npm publish blockers.

`yunti-browser-runtime@0.2.6` is published on the official npm registry and
verified with `npm run release:verify-published`; `latest` points to `0.2.6`.
`0.2.7` is prepared in the working tree as the page-UI hotfix and becomes the
published `latest` only after `npm run release:publish` completes.

## Release Gate Status (Windows)

Since the P0 hardening slice, the gate scripts are cross-platform:

- `npm run release:check` exits 0 on Windows. It resolves npm's own CLI entry
  point and runs it through `node` instead of spawning a bare `npm` command,
  because Windows only ships `.cmd`/`.ps1` shims that cannot be spawned without
  a shell.
- Path assertions normalize separators before comparing, so `npm pack` output
  and `doctor`/`print-config` paths match on Windows.
- `npm pack --json` returns an array on older npm and an object keyed by package
  name on npm 10+, and the package-contents check now accepts both shapes.
- `YUNTI_E2E=1 npm run test:e2e` is a real gate: it fails with an explicit
  diagnosis when no browser or Playwright module can be resolved instead of
  skipping and exiting 0.

## Resolved Blocker: npm 2FA Publish Token

Status: resolved on 2026-07-03.

`npm run release:publish` now passes local release gates and npm login preflight,
then reaches `npm publish --registry=https://registry.npmjs.org/`. The registry
initially rejected the publish with `E403` because the logged-in account requires
two-factor authentication for package publishing.

A temporary npm token retry also passed the local release gate and reached
official npm publish, but npm returned the same `E403`. That token does not
satisfy the publish-time bypass 2FA requirement.

A project-root `.npmrc` retry with the actual token also authenticated
successfully as `xuanzhu`, then failed at `npm publish` with the same `E403`.
The local `.npmrc` is ignored by git and must not be committed.

A second token written to the project-root `.npmrc` also authenticated
successfully as `xuanzhu`, then failed at `npm publish` with the same `E403`.

A publish-capable npm token written to the project-root `.npmrc` authenticated
successfully as `xuanzhu`, and `npm run release:publish` then succeeded for
`yunti-browser-runtime@0.1.0`.

Verification:

```bash
npm run release:verify-published
```

The verification command returns 0 and confirms the published package metadata.

## Resolved Blocker: P4.3 Package URLs

Status: resolved on 2026-07-02 with
`https://github.com/dingguangyi0/yunti-browser-runtime`.

The package metadata currently points to:

- Repository: `https://github.com/dingguangyi0/yunti-browser-runtime`
- Homepage: `https://github.com/dingguangyi0/yunti-browser-runtime#readme`
- Issues: `https://github.com/dingguangyi0/yunti-browser-runtime/issues`

The previous `yunti-ai/yunti-browser-runtime` metadata returned HTTP 404. The
project moved to the `dingguangyi0/yunti-browser-runtime` GitHub repository,
and the initial `main` push succeeded.

## Resolution Options

### Option A: Create Or Publicize The Current Repository

Use this when the intended public home is a not-yet-created or private
repository.

Checklist:

- Create the GitHub repository, or make the existing repository public.
- Enable issues, or choose a different public issue tracker.
- Confirm the repository URL and issues URL return non-404 responses.
- Keep the current `package.json` metadata unchanged if these URLs are correct.
- Run the validation commands below.

### Option B: Update Package Metadata To A Different Public Repository

Use this when the final public repository lives somewhere else.

Checklist:

- Update `package.json` `repository.url`.
- Update `package.json` `homepage`.
- Update `package.json` `bugs.url`.
- Update README, release docs, and status docs if they name the old URL.
- Run the validation commands below.

## Validation Commands

After either option is complete, run:

```bash
npm run check:metadata
npm run release:prepublish
```

Actual result after P4.3 is resolved:

- `npm run check:metadata` exits 0.
- Repository, homepage, and issue URLs are publicly reachable.
- `npm run release:prepublish` reaches and passes `npm run release:check`.
- npm E404 is accepted only for the first publish under the intended package
  name.

Before the final publish, also run:

```bash
npm run release:dry-run
```

## Publish Readiness

`npm run release:prepublish` now passes. Before running `npm run
release:publish`, run and review `npm run release:dry-run`.
