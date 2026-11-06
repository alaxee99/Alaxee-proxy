# Security policy

Alaxee Proxy is designed for local use. It stores its settings in the browser's local extension storage and does not send them to a remote service.

## Reporting a vulnerability

Please report suspected security issues privately to the project maintainer before public disclosure. Include the affected version, reproduction steps, and impact. Do not include live proxy credentials or private subscription URLs in a public issue.

## Security boundaries

- The extension controls Edge's browser proxy setting through Chromium's `proxy` API.
- The extension does not implement proxy transport or authenticate to a remote proxy server.
- The configured local endpoint should normally remain bound to loopback (`127.0.0.1`).
- A browser-level bypass entry does not guarantee that traffic bypasses an OS-level VPN, TUN interface, transparent proxy, or network filter.
