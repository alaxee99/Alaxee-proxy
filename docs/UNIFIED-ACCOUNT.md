# ALAXEE shared account integration

## Canonical identity

All ALAXEE products use the existing `alaxee-start` Supabase Auth project (`xcvxpallbauhpgigyxeh`). The canonical identity is the Supabase `auth.users.id`; products must not create separate user tables as an alternate identity authority.

A shared account means the same ALAXEE user ID is recognized across products. Each product/browser installation keeps its own local Auth session; this is not automatic cookie sharing or OS-level single sign-on. A user may need to sign in separately in each product.

## Product rollout

| Product | Identity integration | Product data sync |
| --- | --- | --- |
| ALAXEE Start | Identity management UI is merged. Social provider flows still depend on Supabase provider configuration and end-to-end verification. | Existing Start data remains in current user-scoped tables. |
| ALAXEE Proxy | Email/password sign-in against the shared Auth project is implemented on the feature branch; automated CI passed, but real Edge sign-in acceptance remains. | Not enabled. The dedicated rule-sync data contract is documented in `docs/PROXY-RULE-SYNC.md`; the database migration and sync engine are still pending. |
| ALAXEE SteamHub | Not integrated yet. | After real Steam injection acceptance and translation-core implementation, decide which user-owned dictionaries/preferences merit sync. |

## Proxy data boundary

Keep these fields on the device: proxy host, port, scheme, browser proxy mode, and device-specific connection state.

The cloud dataset is limited to domain whitelist and force-proxy blacklist entries, including subdomain matching options. The implementation contract uses one row per `(user_id, host)` so a host cannot be both allowlisted and force-proxied, with tombstones and server revisions for safe multi-device conflict handling. The dedicated table is `public.proxy_domain_rules`; do not reuse Start's `public.user_settings`. The schema migration is not yet created or deployed, and sign-in still performs no rule upload/download.

## Security

- Browser clients may contain only the Supabase project URL and publishable key.
- Never embed a service-role key, secret key, database password, or privileged credential in the extension.
- The account password is sent directly to Supabase Auth and never persisted by the extension.
- Rotating refresh/access tokens stay in extension-local storage and are not returned to popup UI or content scripts.
- Products must validate ownership at the database boundary, not by trusting client-supplied user IDs.
- SteamHub must not collect Steam cookies, login tokens, private profiles, inventories, or saved games.

## Next implementation unit

Next: create the `public.proxy_domain_rules` migration using the Supabase CLI, then validate the schema/RLS locally before implementing the background-only sync service and durable outbox. Apply any schema/RLS change to the live Supabase project only after explicit approval. Follow with visible sync status and two-device tests for cross-user isolation, concurrent edits, offline behavior, and local-only endpoint preservation.
