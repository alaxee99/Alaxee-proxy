# ALAXEE shared account integration

## Canonical identity

All ALAXEE products use the existing `alaxee-start` Supabase Auth project (`xcvxpallbauhpgigyxeh`). The canonical identity is the Supabase `auth.users.id`; products must not create separate user tables as an alternate identity authority.

A shared account means the same ALAXEE user ID is recognized across products. Each product/browser installation keeps its own local Auth session; this is not automatic cookie sharing or OS-level single sign-on. A user may need to sign in separately in each product.

## Product rollout

| Product | Identity integration | Product data sync |
| --- | --- | --- |
| ALAXEE Start | Identity management UI is merged. Social provider flows still depend on Supabase provider configuration and end-to-end verification. | Existing Start data remains in current user-scoped tables. |
| ALAXEE Proxy | Email/password sign-in against the shared Auth project is implemented on the feature branch; real Edge sign-in acceptance remains. | The dedicated migration and RLS tests pass in disposable PostgreSQL CI; an isolated sync engine/outbox module is implemented and under CI. It is not integrated into the service worker, deployed to Supabase, or enabled for network traffic. |
| ALAXEE SteamHub | Not integrated yet. | After real Steam injection acceptance and translation-core implementation, decide which user-owned dictionaries/preferences merit sync. |

## Proxy data boundary

Keep these fields on the device: proxy host, port, scheme, browser proxy mode, and device-specific connection state.

The cloud dataset is limited to domain whitelist and force-proxy blacklist entries, including subdomain matching options. The implementation contract uses one row per `(user_id, host)` so a host cannot be both allowlisted and force-proxied, with tombstones and server revisions for safe multi-device conflict handling. The dedicated table is `public.proxy_domain_rules`; do not reuse Start's `public.user_settings`. The migration file exists and passes disposable PostgreSQL/RLS CI tests, but it is not deployed. The isolated sync engine/outbox module is present on the feature branch; the service worker is not integrated and sign-in still performs no rule upload/download.

## Security

- Browser clients may contain only the Supabase project URL and publishable key.
- Never embed a service-role key, secret key, database password, or privileged credential in the extension.
- The account password is sent directly to Supabase Auth and never persisted by the extension.
- Rotating refresh/access tokens stay in extension-local storage and are not returned to popup UI or content scripts.
- Products must validate ownership at the database boundary, not by trusting client-supplied user IDs.
- SteamHub must not collect Steam cookies, login tokens, private profiles, inventories, or saved games.

## Next implementation unit

Next: integrate the isolated sync engine with the background service worker through a trusted-context-only Supabase REST adapter. Add visible sync status and update the privacy notice before enabling remote rule traffic. Apply the existing migration to the live Supabase project only after explicit approval. Then verify two Edge profiles/devices for cross-user isolation, concurrent edits, offline behavior, account switching, and local-only endpoint preservation.
