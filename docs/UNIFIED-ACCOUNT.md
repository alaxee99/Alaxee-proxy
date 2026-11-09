# ALAXEE shared account integration

## Canonical identity

All ALAXEE products use the existing `alaxee-start` Supabase Auth project (`kystcwxlqqzgjbdhdmap`). The canonical identity is the Supabase `auth.users.id`; products must not create separate user tables as an alternate identity authority.

A shared account means the same ALAXEE user ID is recognized across products. Each product/browser installation keeps its own local Auth session; this is not automatic cookie sharing or OS-level single sign-on. A user may need to sign in separately in each product.

## Product rollout

| Product | Identity integration | Product data sync |
| --- | --- | --- |
| ALAXEE Start | Identity management UI is merged. Social provider flows still depend on Supabase provider configuration and end-to-end verification. | Existing Start data remains in current user-scoped tables. |
| ALAXEE Proxy | Email/password sign-in against the shared Auth project is implemented on the feature branch; real Edge sign-in acceptance remains. | The dedicated migration/RLS tests pass in disposable PostgreSQL CI. The sync engine/outbox is integrated with the background service worker, but its production-backend gate is deliberately disabled; the live schema is not deployed and no rule traffic is active. |
| ALAXEE SteamHub | Not integrated yet. | After real Steam injection acceptance and translation-core implementation, decide which user-owned dictionaries/preferences merit sync. |

## Proxy data boundary

Keep these fields on the device: proxy host, port, scheme, browser proxy mode, and device-specific connection state.

The cloud dataset is limited to domain whitelist and force-proxy blacklist entries, including subdomain matching options. The implementation contract uses one row per `(user_id, host)` so a host cannot be both allowlisted and force-proxied, with tombstones and server revisions for safe multi-device conflict handling. The dedicated table is `public.proxy_domain_rules`; do not reuse Start's `public.user_settings`. The migration file exists and passes disposable PostgreSQL/RLS CI tests, but it is not deployed. The sync engine/outbox is connected to the trusted service-worker message boundary on the feature branch; the production-backend gate remains false, so sign-in still performs no rule upload/download.

## Security

- Browser clients may contain only the Supabase project URL and publishable key.
- Never embed a service-role key, secret key, database password, or privileged credential in the extension.
- The account password is sent directly to Supabase Auth and never persisted by the extension.
- Rotating refresh/access tokens stay in extension-local storage and are not returned to popup UI or content scripts.
- Products must validate ownership at the database boundary, not by trusting client-supplied user IDs.
- SteamHub must not collect Steam cookies, login tokens, private profiles, inventories, or saved games.

## Next implementation unit

Next: complete manual Edge acceptance on the feature branch: proxy mode switching, current-site whitelist/blacklist rules, subdomain matching and priority, optional per-tab status permission, persistence after browser restart, interaction with another proxy extension, and ALAXEE account sign-in/session refresh/sign-out.

Cloud rule sync remains deliberately disabled. A live Supabase migration and two-profile/device sync acceptance are a separate rollout that requires explicit approval; do not enable the backend gate as part of this manual test.
