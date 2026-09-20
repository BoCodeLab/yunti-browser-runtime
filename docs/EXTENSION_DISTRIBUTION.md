# Extension Distribution Readiness

This document tracks browser-store readiness for the Yunti Browser Runtime
extension. It is intentionally an audit and submission plan first, not an
immediate permission rewrite.

## Current Goal

Prepare for Chrome Web Store and Microsoft Edge Add-ons distribution while
preserving Yunti's local-first browser automation purpose:

- operate real user-opened Chrome/Edge pages through a local bridge;
- keep the unpacked extension path for developers and npm installs;
- avoid narrowing permissions until there is a tested replacement path;
- explain broad permissions honestly before any store submission.

## Official Policy Baseline

The store-facing baseline for this project is:

- Chrome permissions must be declared in the manifest, and some permissions
  trigger install warnings. The current `debugger` permission is especially
  sensitive because Chrome warns that it can access the page debugger backend
  and read/change site data.
- Chrome Web Store policy expects a narrow, easy-to-understand single purpose,
  minimum permissions, and user-data use limited to the disclosed purpose.
- Chrome Web Store privacy disclosures must match the extension behavior and
  privacy policy, especially when handling page content, browsing activity,
  request data, screenshots, or form data.
- Edge Add-ons policy similarly requires permissions only when necessary for
  the declared functionality, plus a privacy policy link and store metadata.
- Edge Add-ons submission requires a zip package, required visual assets, a
  listing description, and a privacy policy link.

References:

- Chrome permissions reference:
  https://developer.chrome.com/docs/extensions/reference/permissions-list
- Chrome permission declaration guide:
  https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- Chrome Web Store program policies:
  https://developer.chrome.com/docs/webstore/program-policies/policies
- Chrome Web Store Limited Use policy:
  https://developer.chrome.com/docs/webstore/program-policies/limited-use
- Microsoft Edge extensions overview and publishing requirements:
  https://learn.microsoft.com/en-us/microsoft-edge/extensions/
- Microsoft Edge Add-ons developer policies:
  https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies

## Current Manifest Audit

Current file: `extension/manifest.json`.

| Manifest field | Current value | Why Yunti uses it | Store risk | P6.6.1 decision |
| --- | --- | --- | --- | --- |
| `manifest_version` | `3` | Required modern extension format. | Low. | Keep. |
| `permissions.activeTab` | present | Visible-tab capture fallback and temporary page access semantics. | Low to medium; generally narrower than persistent host access. | Keep. |
| `permissions.alarms` | present | Periodic browser-controller bridge recovery heartbeat so a suspended MV3 worker reconnects without user action. | Low; no user-visible surface. | Keep. |
| `permissions.debugger` | present | CDP commands, target-level automation, console/runtime/network events, and low-level recovery. | High. Chrome shows a debugger warning and reviewers may ask why this is core. | Keep for now; store copy must explain this is the core browser automation transport. |
| `permissions.scripting` | present | Programmatically inject packaged content scripts into already-open supported pages after extension load or recovery. | Medium with broad host access; reviewers may ask why dynamic injection is needed. | Keep for developer/npm path so install does not require manual page refresh; explain it as recovery/registration, not arbitrary remote code execution. |
| `permissions.storage` | present | Local bridge URL, optional token, user id/name, and page match settings. | Low. | Keep. |
| `permissions.tabs` | present | Tab inventory, active tab selection, switching, and metadata routing. | Medium. Chrome may warn about browsing history. | Keep for now; evaluate whether any read paths can use host/activeTab data later. |
| `permissions.webRequest` | present | Sanitized network diagnostics and request observation. | Medium to high with broad hosts. | Keep for now; P6.6.2 should evaluate optionalizing network diagnostics. |
| `host_permissions` | `http://*/*`, `https://*/*` | Register and operate arbitrary user-selected http/https pages. | High because it maps to broad site access. | Keep for developer/npm path; store submission must decide broad access vs optional/site-request flow. |
| `host_permissions` | `http://127.0.0.1/*`, `http://localhost/*` | Local bridge communication. | Low but should be explained as local-only bridge access. | Keep. |
| `content_scripts.matches` | `http://*/*`, `https://*/*` | Observe and act on arbitrary web pages once loaded. | High because content scripts imply broad page access. | Keep for now; evaluate `optional_host_permissions` or user-triggered site access later. |

## Store Submission Checklist

Required before submitting to either store:

- Store description with one clear purpose:
  "Local browser runtime that lets user-authorized AI agents inspect and
  operate the user's own Chrome/Edge pages through a local bridge."
- Permission rationale for every manifest permission above.
- Privacy policy page that states:
  - no hosted Yunti service is used in the default install path;
  - observations are sent only to the local bridge on loopback by default;
  - screenshots are visible pixels and may contain sensitive content;
  - raw CDP diagnostics are a low-level exception and should be cleared;
  - learning memory is local filesystem data;
  - network/console/memory text is sanitized before storage or display;
  - users can remove the extension and clear local memory.
- Store privacy/data disclosure answers aligned with `docs/SECURITY.md`.
- Visual assets:
  - extension icon set for store and manifest;
  - at least one screenshot of the optional local console;
  - at least one screenshot or diagram of the extension popup zero-config state;
  - optional short demo media showing local bridge + extension + agent workflow.
- Package artifact:
  - `npm run package-extension` zip;
  - package/manifest version consistency verified by `npm run release:check`;
  - no local-only residue in public docs.
- Review notes:
  - explain why `debugger` is core to browser automation;
  - explain why broad host access exists in the developer/npm path;
  - document the local-only bridge and no hosted relay default.

## Permission Narrowing Options

These are follow-up options, not P6.6.1 changes:

| Option | Benefit | Cost / risk |
| --- | --- | --- |
| Keep broad host permissions for store release | Preserves current one-step operation after install. | Highest review and user-trust burden. |
| Move broad hosts to optional host permissions | Better minimum-permission story. | Requires new UX for granting host access and robust recovery when not granted. |
| Use `activeTab` for a user-invoked page grant path | Much smaller default warning surface. | Breaks always-on agent operation unless redesigned around explicit user gestures. |
| Make network diagnostics optional | Reduces review surface for users who only need DOM actions. | Splits tool availability and recovery guidance; needs schema/tool hint updates. |
| Keep unpacked-only for 0.2.0 and defer store listing | Avoids premature permission compromises. | Users still manually load the extension. |

Recommended next slice: keep current manifest behavior, but draft store-facing
permission and privacy copy. Then decide whether `webRequest` and broad hosts
should become optional before a real store submission.

## Store Copy Draft

P6.6.2 store-facing copy is tracked in
[EXTENSION_STORE_COPY.md](EXTENSION_STORE_COPY.md). It contains draft short and
long descriptions, permission rationale, privacy-policy text, store data
disclosure guidance, reviewer notes, and the final review checklist.

## Permission Strategy Decision

P6.6.3 pre-store permission strategy is tracked in
[EXTENSION_PERMISSION_STRATEGY.md](EXTENSION_PERMISSION_STRATEGY.md). The
current decision keeps the npm/unpacked developer path unchanged, does not
recommend submitting the current broad-permission manifest unchanged by default,
and defines a future store-candidate track for optional host access and optional
network diagnostics.

## Current P6.6.1 Outcome

P6.6.1 completes when this audit is linked from public docs and the status files
identify the next store-readiness slice. It does not change extension runtime
behavior.

## Current P6.6.2 Outcome

P6.6.2 completes when the draft store copy pack is available and linked from
this distribution readiness audit. It does not change extension runtime
behavior or the submitted manifest strategy.

## Current P6.6.3 Outcome

P6.6.3 completes when the permission strategy decision is available and linked
from this distribution readiness audit. It does not change extension runtime
behavior or `extension/manifest.json`.
