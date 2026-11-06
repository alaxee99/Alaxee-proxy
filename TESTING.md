# Manual verification checklist

The automated Node tests cover pure validation and proxy-rule generation. They do not emulate the Edge extension runtime or prove that a local Clash/Mihomo process is listening. Complete this checklist on the target Windows + Edge + Clash setup before relying on the extension daily.

## First install

- [ ] Load the unpacked project from `edge://extensions` with Developer mode enabled.
- [ ] Confirm Edge accepts the Manifest V3 extension without manifest or service-worker errors.
- [ ] Confirm the permission prompt is limited to proxy control, local storage, and access to the active tab when invoked.
- [ ] Open the popup and verify the displayed mode matches Edge's actual proxy mode.
- [ ] Confirm the popup has one vertical scrollbar only (the main panel scroll container).
- [ ] Open Settings, click “返回浏览器”, confirm the Settings tab closes, then reopen the quick panel from the Edge toolbar icon.

## Clash/Mihomo connection

- [ ] Confirm the configured address and port match the local HTTP/Mixed or SOCKS listener in Clash/Mihomo.
- [ ] Choose HTTP for an HTTP or Mixed listener; choose SOCKS5 for a SOCKS listener.
- [ ] Select **保存并连接 Clash** and verify an ordinary proxied destination loads.
- [ ] Verify Clash's own rule mode, selected proxy group, and rule set still decide how non-bypassed domains route.
- [ ] Stop Clash temporarily and verify the extension does not claim to have performed a successful health check; the browser may show connection errors until the local listener returns.

## Direct whitelist

- [ ] On an HTTPS site, add the current domain with subdomains enabled.
- [ ] Verify the apex domain and one subdomain bypass the browser proxy.
- [ ] Verify a similar but unrelated hostname does not match (for example, `notexample.com`).
- [ ] Remove the entry and confirm the site returns to Clash routing.
- [ ] Add an exact-host-only entry and confirm a subdomain is not covered.
- [ ] Restart Edge and confirm settings and whitelist persist.

## Modes and conflicts

- [ ] Switch to **直接连接** and verify Edge no longer uses its browser proxy.
- [ ] Switch to **跟随系统代理** and verify Edge follows the Windows system proxy setting.
- [ ] Switch back to **Clash 代理** and verify the saved endpoint and bypass list are restored.
- [ ] Test with other proxy extensions disabled, then enabled, and confirm the UI reports control conflicts clearly.
- [ ] If Clash TUN or another system-wide traffic capture mode is enabled, separately verify its behavior; browser bypass alone does not guarantee OS-level bypass.


## Package entry-point regression test

`npm run check` verifies that the manifest popup path, options page, icons, and all local CSS/JavaScript references point to files that exist in the package. It also guards against linking the Settings page directly to the popup document and checks that the popup owns a single bounded scroll container.
