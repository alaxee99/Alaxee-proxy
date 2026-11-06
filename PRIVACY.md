# Alaxee Proxy privacy notice

Last updated: 2026-11-06

Alaxee Proxy is a local-only Microsoft Edge extension that lets the user control Edge's browser proxy setting and maintain a direct-connection bypass list for selected hostnames.

## Information the extension accesses

- When the user invokes the extension on a web page, `activeTab` is used to read that tab's URL so the user can add the current hostname to the bypass list.
- The extension stores its proxy mode, local proxy address and port, and bypass-list hostnames in the browser's local extension storage (`chrome.storage.local`).
- The extension does not read page contents, form fields, passwords, or browsing history.

## Collection, transmission, and sharing

Alaxee Proxy does not send this information to Alaxee, a developer-operated server, analytics provider, or other third party. It does not include accounts, cloud sync, telemetry, remote configuration, or advertising. The settings and bypass list remain in the local Edge profile.

When proxy mode is enabled, Edge sends browser network requests to the proxy endpoint configured by the user (normally a local Clash/Mihomo listener such as `127.0.0.1`). The proxy application and its operator may process network traffic according to their own configuration and privacy practices. Alaxee Proxy does not operate that proxy service.

## User controls

Users can change or remove the proxy endpoint and bypass-list entries in the extension, switch Edge to direct or system proxy mode, or uninstall the extension. Uninstalling the extension removes its local extension storage according to Edge's extension-data behavior.

## Changes and contact

This notice will be updated if the extension's data practices change. For support or privacy questions, use the contact details shown in the Alaxee Proxy project repository.
