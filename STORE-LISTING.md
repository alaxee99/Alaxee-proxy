# Microsoft Edge Add-ons listing draft

## Name
Alaxee Proxy

## Short description
A lightweight Edge proxy switcher for your local Clash/Mihomo service, with a per-site direct-connection list.

## Detailed description
Alaxee Proxy is a small, local-only proxy control panel for Microsoft Edge. It connects Edge to a proxy listener that you already run, such as Clash or Mihomo. It does not provide proxy servers, nodes, subscriptions, or VPN service.

Features:
- Switch Edge between your configured Clash/Mihomo proxy, direct connection, and Windows system proxy.
- Configure a local proxy protocol, host, and port.
- Add the current website to a direct-connection bypass list from the toolbar popup.
- Choose whether a bypass entry applies only to the hostname or also to its subdomains.
- Keep settings locally in Edge; no account or cloud service is required.

The extension does not change your Clash/Mihomo rule sets. Websites not included in the browser bypass list continue through the configured local proxy listener, where your existing Clash/Mihomo rules decide how to route them.

## Permission justifications

- `proxy`: required to set Edge's browser-level proxy mode and hostname bypass list.
- `storage`: required to save the user's proxy preferences and bypass-list entries locally.
- `activeTab`: required to read the hostname of the currently active page after the user invokes the toolbar popup, for the one-click bypass feature.

## Privacy
See `PRIVACY.md`. Publish a publicly accessible privacy policy URL before submitting the store listing if Partner Center requires it for the declared data practices.

## Store visual assets still needed

- Store logo / icon asset in the required Partner Center dimensions.
- Small promotional tile.
- At least one accurate screenshot of the final Edge popup/settings UI.
