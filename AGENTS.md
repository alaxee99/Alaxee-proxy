# Agent operating rules

## Product boundary
- Keep Alaxee Proxy a small, local-only Microsoft Edge Manifest V3 extension.
- The extension is a browser proxy controller for an already-running local Clash/Mihomo instance. It is not a proxy client, subscription manager, node selector, rule editor, VPN, or hosted service.
- Shared ALAXEE account sign-in and user-scoped domain-rule sync are approved for this feature branch.
- Keep cloud sync disabled until the user separately approves the production database migration and rollout; never apply it to the live Supabase project without that approval.
- Only domain whitelist/blacklist entries and tombstones may sync. Never sync proxy endpoints, ports, schemes, browser mode, tab URLs, page content, or browsing history.
- Do not add analytics, telemetry, remote configuration or remote code.
- Do not read, rewrite, or upload Clash configuration files. Only send browser traffic to the user-configured local proxy endpoint.

## Privacy and permissions
- Keep required permissions minimal: `proxy`, `storage`, `activeTab`, and `alarms`; alarms support retries only for explicitly enabled domain-rule sync.
- The per-tab toolbar-state feature may request the optional `tabs` permission only after the user explicitly enables it in the popup. It is used only to read tab URLs and update each tab's icon/title locally; it must not collect page contents, browsing history or transmit browsing data.
- Keep the one fixed host permission for the ALAXEE Supabase project; do not add other hosts, `webRequest`, content scripts, or page-content collection.
- Keep user settings and whitelist data in `chrome.storage.local`.
- Never expose the local proxy port on LAN or ask the user to enable Clash LAN access as a default requirement.

## Engineering
- Prefer dependency-free JavaScript and native Chromium extension APIs.
- Keep pure validation/configuration logic in `src/core.js` and cover it with Node's built-in test runner.
- No inline JavaScript, `eval`, `new Function`, remote scripts, or dynamic code execution.
- Keep the distinction between browser-level bypass rules and Clash/Mihomo routing rules explicit in the UI and docs.
- Do not claim that browser `DIRECT` bypasses TUN or all system-level traffic capture; qualify this behavior.

## Verification
Run before each release:

```bash
npm test
npm run check
python -m json.tool manifest.json >/dev/null
```

Also load the unpacked extension in Microsoft Edge and manually verify: proxy mode switching, current-site whitelist add/remove, subdomain behavior, persistence after browser restart, and behavior when another extension controls proxy settings.

## Scope control
- Keep changes small and independently verifiable.
- Do not publish to an extension store, create or alter a remote repository, or change a user's browser/network settings without explicit authorization.
