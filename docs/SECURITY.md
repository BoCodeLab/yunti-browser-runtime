# Security, Permissions, And Privacy Notes

## Current Boundary

The first release is local single-user software:

- bridge binds to `127.0.0.1` by default;
- local loopback bridge routes do not require a token by default;
- setting `YUNTI_BROWSER_BRIDGE_TOKEN` enables `x-yunti-browser-token` checks
  for bridge routes, and binding to a non-loopback host requires a token;
- CORS only echoes local debug origins and browser-extension origins by default;
- extension talks to the local bridge;
- MCP tools default to `userId=local`;
- no remote relay is part of the documented install path.

## Data Handling

- Cookies and raw authorization headers are not returned by network tools.
- Network URLs, headers, request bodies, and console messages are sanitized.
- Learning memory sanitizes likely secrets and PII-like text before writing
  title, detail, tags, or source fields to disk. Agents should still avoid
  intentionally submitting raw secrets or personal data to memory.
- DOM observation defaults to `balanced` redaction for credential-like values.
  `strict` redaction additionally hides likely email, phone, Luhn-valid
  payment-card-like values, address-like text, page titles, labels, names,
  visible text, placeholders, values, and select option text.
- Learning memory is stored under `~/.yunti_agent/users/{userId}/memory`.
- Raw CDP event diagnostics are an explicit low-level exception: payloads are
  not redacted, are cached only in memory, and should be cleared after debugging
  with `yunti_clear_cdp_events`.
- Screenshot tools return real visible pixels. They do not inherit DOM
  redaction and should be used only when visual evidence is needed.
- The content script does not call product-specific login APIs.

## Browser Permissions

The extension uses browser permissions required for automation:

- `tabs` for tab inventory and activation;
- `debugger` for CDP commands;
- `scripting` for on-demand content-script recovery and stylesheet injection;
- `storage` for local bridge URL, optional token, user, and page-match settings;
- `webRequest` for sanitized network observations;
- `activeTab` for visible-tab capture fallback paths;
- `alarms` for the periodic browser-controller bridge recovery heartbeat.

The extension currently declares broad `http://*/*` and `https://*/*` host
access so it can register and operate arbitrary local user-selected pages. It
also declares localhost bridge access for the local HTTP bridge. A narrower
allowlist can be configured in the extension popup with page match patterns, and
store-distributed releases should re-review whether broad host permissions are
still appropriate for the intended audience.

The current browser-store readiness audit and submission checklist are tracked
in [EXTENSION_DISTRIBUTION.md](EXTENSION_DISTRIBUTION.md). That document is the
source for store-facing permission rationale, privacy copy, and any future
decision to keep or narrow broad host permissions.
Draft store-facing text is tracked in
[EXTENSION_STORE_COPY.md](EXTENSION_STORE_COPY.md) and must be reviewed before
any browser-store submission.
The pre-store permission strategy is tracked in
[EXTENSION_PERMISSION_STRATEGY.md](EXTENSION_PERMISSION_STRATEGY.md); the
current npm/unpacked path keeps broad local automation permissions, while a
store-candidate path should be designed separately before submission.

Users should only load the extension from a trusted local checkout.

## Privacy Notes

- The runtime is local-first and does not send browser observations to a Yunti
  hosted service.
- Raw cookies, authorization headers, passwords, and token-like fields are not
  returned by the documented tools.
- Console diagnostics and learning memory use shared sanitization for likely
  Bearer tokens, JWTs, private keys, long token-like values, emails, phones,
  Luhn-valid payment-card-like values, and address-like text.
- DOM redaction applies to structured observation text, not to screenshots;
  screenshots are visible page pixels and may contain sensitive content.
- Learning memory is local filesystem data and should not contain secrets.
- Raw CDP diagnostics may contain sensitive payloads; use them only when needed
  for low-level debugging, filter by method/limit where possible, and clear them
  after use.
- Screenshot artifacts may contain all visible sensitive page content; prefer
  structured redacted observations when text/state is enough.
- Agents should summarize sensitive-looking output instead of repeating it.

## Not Yet Implemented

- Signed extension release package.
- Remote multi-user isolation layer.
- Per-tool allow/deny policy.

Remote deployment must be designed separately and must not use the local
no-token loopback default without an authentication and ownership model.
