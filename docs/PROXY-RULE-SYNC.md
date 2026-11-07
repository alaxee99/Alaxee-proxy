# Proxy domain-rule cloud sync contract

**Status: design agreed for implementation; schema is not deployed and synchronization is not active.**

This contract covers only the direct-connection whitelist and force-proxy blacklist. It does not sync proxy endpoints or browser proxy mode.

## Data boundary

| Data | Storage |
| --- | --- |
| Whitelist domains | Supabase, scoped to the authenticated ALAXEE user |
| Blacklist domains | Supabase, scoped to the authenticated ALAXEE user |
| Subdomain matching flag | Supabase, stored with each domain rule |
| Proxy host and port | Device-local only |
| Proxy scheme (HTTP/SOCKS5) | Device-local only |
| Browser proxy mode and connection state | Device-local only |
| Account access/refresh tokens | Trusted extension-local storage only |
| Password, tab URLs, page content, Clash configuration | Never synchronized |

The dedicated table is `public.proxy_domain_rules`. Do not put Proxy data into Start's `public.user_settings` or any other Start-owned table.

## Row model

One row represents one normalized host for one user. The primary key is `(user_id, host)`, not `(user_id, rule_type, host)`. This is deliberate: a host can be either a whitelist rule or a blacklist rule, never both. It preserves the current local behavior where adding a host to one list removes it from the other.

| Column | Contract |
| --- | --- |
| `user_id` | UUID FK to `auth.users(id)`; default is `auth.uid()`; ownership is enforced by RLS |
| `host` | Lowercase canonical hostname/IP literal from `normalizeHostname`; bounded length and checked again by the database |
| `rule_type` | `whitelist` or `blacklist` |
| `include_subdomains` | Boolean; same meaning as the current local rule model |
| `is_deleted` | Tombstone. Deletions are rows, not SQL DELETE operations |
| `revision` | Server-controlled positive integer; increments on every update |
| `updated_at` | Server-controlled timestamp; set by a trigger on insert/update |

Use a composite primary key on `(user_id, host)` and an index beginning with `(user_id, updated_at)` for ordered sync reads. Keep tombstones so an offline device cannot silently resurrect a rule removed elsewhere.

## Database access and RLS

- Enable RLS on the public table.
- Revoke table access from `PUBLIC` and `anon`; grant only `SELECT`, `INSERT`, and `UPDATE` to `authenticated`.
- Add owner-scoped `SELECT`, `INSERT`, and `UPDATE` policies. Both `USING` and `WITH CHECK` are required for update.
- Do not grant `DELETE`; clients must write tombstones.
- The update trigger sets `updated_at` and increments `revision`. It must be an invoker function with a locked-down search path, not `SECURITY DEFINER`.
- Do not trust a client-supplied `user_id`. Omit it on insert and rely on the database default plus RLS; any explicit owner value must still match `auth.uid()`.
- Never put a service-role key, database password, or privileged credential in the extension.

## Bootstrap and merge rules

1. Resolve the current Supabase session in the background service worker. Do not pass bearer tokens to popup UI.
2. Fetch remote rows, including tombstones, for the authenticated user only.
3. For a host already present remotely, the remote row wins during first bootstrap. A remote tombstone therefore prevents a stale pre-sync local copy from resurrecting that host.
4. Preserve local-only hosts that have no remote row and enqueue them as new rows.
5. Apply the resulting active rows to the two local rule lists. The proxy endpoint, scheme, and mode fields remain untouched.
6. Record the synced user ID and each host's server revision locally.

This gives deterministic first-sync behavior: server state wins for a host collision; local-only rules are added to the account. No browser history or tab data is involved.

## Incremental sync, concurrency and offline behavior

- Local edits are written to `chrome.storage.local` first, then recorded in a durable outbox keyed by Supabase user ID.
- Outbox operations contain the normalized host, rule type or tombstone, subdomain flag, and the server revision they were based on.
- New rows use conflict-safe insert semantics. Existing rows are updated only when the remote revision still equals the recorded base revision.
- If an update affects zero rows, another device changed that host first. Fetch the current remote row, adopt it locally, and surface a sync-conflict status instead of silently overwriting the newer version.
- The database trigger is the sole authority for the new revision and timestamp.
- Keep unsent operations when offline or when the service worker is suspended. Retry on extension startup, account sign-in, and the next available sync opportunity. Remove an outbox item only after the server confirms the matching write or the client has explicitly adopted the newer remote row.
- A remove operation writes `is_deleted = true`. It never issues a REST DELETE.
- Paginate remote reads; do not silently treat a partial response as a complete rule set.

The conflict rule is intentionally conservative: a stale offline edit does not overwrite a newer server revision. The user is told that a conflict occurred; a later explicit “keep this device's version” action may retry against the newly fetched revision.

## Account isolation

- Store outbox and sync metadata under a user-ID namespace.
- Never send an outbox created for user A with user B's access token.
- On first sign-in to an account, existing local rules can be bootstrapped using the merge rule above.
- If the browser profile was previously bound to a different synced user ID, pause synchronization and require an explicit account-switch/reset path. Do not auto-upload the previous account's local rule set to the newly signed-in user.
- Sign-out stops network sync but does not silently delete local rules, queued operations, or remote account data.

## Rollout gates

1. Create and review the migration file in this repository.
2. Test schema, RLS ownership, insert/update restrictions, tombstones, and timestamp/revision trigger in a disposable local database.
3. Implement the background-only sync service and durable outbox with mocked REST/storage tests.
4. Update the privacy notice and visible sync status before enabling remote rule traffic.
5. Apply the migration to the live Supabase project only after explicit approval.
6. Manually verify two Edge profiles/devices with the same account, then test a different account and offline/reconnect behavior.

Until those gates pass, sign-in must not upload or download domain rules.
