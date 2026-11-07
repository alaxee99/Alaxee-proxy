# Alaxee Proxy privacy notice

Last updated: 2026-11-07

Alaxee Proxy is a Microsoft Edge extension for controlling Edge's browser proxy setting and maintaining direct-connection and force-proxy domain rules. Proxy routing configuration remains local to the browser profile.

## Information stored locally

- Proxy mode, scheme, local proxy address and port, and domain whitelist/blacklist entries are stored in the browser's local extension storage (`chrome.storage.local`).
- The optional ALAXEE account session is stored in extension-local storage as a rotating Supabase access-token / refresh-token pair. The extension does not store the account password.
- The account session is local to this Edge extension installation. It is not automatically shared with another browser profile or device.

## ALAXEE account authentication

When the user signs in, the extension sends the supplied email address and password directly to the ALAXEE Supabase Auth service at `https://xcvxpallbauhpgigyxeh.supabase.co` over HTTPS. Supabase validates the credentials and returns a session. The extension uses that session to identify the same ALAXEE user account already used by ALAXEE Start.

The extension requests only the fixed Supabase project host permission. It does not send tab URLs, page content, proxy endpoint values, or domain rules as part of sign-in. The password is held only in memory for the sign-in request and is not written to extension storage or logs.

Signing out removes the local session. The extension also asks Supabase Auth to revoke the current local session when reachable; if that cannot be confirmed, the UI reports that remote revocation was not confirmed.

## Domain rules and cloud-sync status

The feature branch contains a user-scoped cloud-sync implementation, but it is not active in the released extension. The production-backend gate remains disabled and the database migration has not been applied. Until a separately approved rollout, whitelist and blacklist entries remain local and sign-in does not upload or download them. Before that gate is enabled, this notice and release documentation must be reviewed and updated.

The local proxy address, port, scheme, and selected browser proxy mode are device-specific settings and are not intended for cloud synchronization.

## Optional per-tab status icons

If the user enables the optional `tabs` permission, the extension reads tab URLs locally to determine the route and update each tab's toolbar icon and tooltip. It does not read page contents, form fields, passwords, or browsing history, and does not transmit tab URLs to Supabase.

## Proxy traffic

When proxy mode is enabled, Edge sends browser network requests to the proxy endpoint configured by the user (normally a local Clash/Mihomo listener such as `127.0.0.1`). The proxy application and its operator may process network traffic according to their own configuration and privacy practices. Alaxee Proxy does not operate that proxy service.

## User controls

Users can change or remove the proxy endpoint and domain rules, sign out of the ALAXEE account, switch Edge to direct or system proxy mode, or uninstall the extension. Uninstalling the extension removes its local extension storage according to Edge's extension-data behavior.

## Changes and contact

This notice will be updated before any later cloud rule-sync feature is enabled. For support or privacy questions, use the contact details shown in the Alaxee Proxy project repository.
