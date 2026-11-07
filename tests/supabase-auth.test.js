import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseAuthService, AUTH_SESSION_STORAGE_KEY } from "../src/supabase-auth.js";

function createHarness(fetchHandler, initialSession = null) {
  const values = new Map();
  if (initialSession) values.set(AUTH_SESSION_STORAGE_KEY, initialSession);
  const calls = [];
  const storage = {
    async get(key) { return { [key]: values.get(key) ?? null }; },
    async set(payload) { for (const [key, value] of Object.entries(payload)) values.set(key, value); },
    async remove(key) { values.delete(key); }
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return fetchHandler(url, init);
  };
  const service = createSupabaseAuthService({
    supabaseUrl: "https://unit-test.supabase.co",
    publishableKey: "sb_publishable_unit_test",
    storage,
    fetchImpl,
    now: () => 1_800_000_000_000
  });
  return { service, values, calls };
}

function response(status, body = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

test("sign-in uses the shared Supabase password endpoint and never stores the password", async () => {
  const { service, values, calls } = createHarness(async (url, init) => {
    assert.match(url, /\/auth\/v1\/token\?grant_type=password$/);
    assert.equal(init.method, "POST");
    assert.equal(init.headers.apikey, "sb_publishable_unit_test");
    assert.deepEqual(JSON.parse(init.body), { email: "owner@example.com", password: "not-persisted" });
    return response(200, {
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      token_type: "bearer",
      user: { id: "user-1", email: "owner@example.com", email_confirmed_at: "2026-11-01T00:00:00Z" }
    });
  });

  const user = await service.signInWithPassword({ email: " owner@example.com ", password: "not-persisted" });
  assert.equal(user.id, "user-1");
  assert.equal(user.email, "owner@example.com");
  assert.equal(calls.length, 1);
  const stored = values.get(AUTH_SESSION_STORAGE_KEY);
  assert.equal(stored.access_token, "access-1");
  assert.equal(stored.refresh_token, "refresh-1");
  assert.equal("password" in stored, false);
});

test("expired sessions rotate the refresh token before validating the user", async () => {
  const initial = {
    access_token: "expired-access",
    refresh_token: "old-refresh",
    expires_at: 1_700_000_000_000,
    token_type: "bearer"
  };
  const { service, values, calls } = createHarness(async (url, init) => {
    if (url.includes("grant_type=refresh_token")) {
      assert.deepEqual(JSON.parse(init.body), { refresh_token: "old-refresh" });
      return response(200, {
        access_token: "access-2",
        refresh_token: "refresh-2",
        expires_in: 3600,
        user: { id: "user-2", email: "sync@example.com" }
      });
    }
    assert.match(url, /\/auth\/v1\/user$/);
    assert.equal(init.headers.Authorization, "Bearer access-2");
    return response(200, { id: "user-2", email: "sync@example.com" });
  }, initial);

  const result = await service.getSession();
  assert.equal(result.user.id, "user-2");
  assert.equal(values.get(AUTH_SESSION_STORAGE_KEY).refresh_token, "refresh-2");
  assert.equal(calls.length, 2);
  assert.equal("access_token" in result, false);
});

test("invalid refresh tokens clear the local session without returning stale identity", async () => {
  const initial = {
    access_token: "expired-access",
    refresh_token: "revoked-refresh",
    expires_at: 1_700_000_000_000
  };
  const { service, values } = createHarness(async () =>
    response(400, { error: "invalid_grant", error_description: "Refresh token is invalid" }), initial);

  assert.equal(await service.getSession(), null);
  assert.equal(values.has(AUTH_SESSION_STORAGE_KEY), false);
});

test("failed sign-in leaves no local session", async () => {
  const { service, values } = createHarness(async () =>
    response(400, { msg: "Invalid login credentials" }));
  await assert.rejects(
    service.signInWithPassword({ email: "wrong@example.com", password: "wrong" }),
    /Invalid login credentials/
  );
  assert.equal(values.has(AUTH_SESSION_STORAGE_KEY), false);
});

test("sign-out clears local credentials even when remote revocation cannot be confirmed", async () => {
  const initial = {
    access_token: "access-3",
    refresh_token: "refresh-3",
    expires_at: 1_900_000_000_000
  };
  const { service, values, calls } = createHarness(async () => {
    throw new Error("network offline");
  }, initial);

  const result = await service.signOut();
  assert.equal(result.remoteRevoked, false);
  assert.equal(values.has(AUTH_SESSION_STORAGE_KEY), false);
  assert.equal(calls.length, 1);
});

test("getSession returns only safe user fields and not bearer credentials", async () => {
  const initial = {
    access_token: "access-4",
    refresh_token: "refresh-4",
    expires_at: 1_900_000_000_000
  };
  const { service } = createHarness(async (_url, init) => {
    assert.equal(init.headers.Authorization, "Bearer access-4");
    return response(200, { id: "user-4", email: "safe@example.com", app_metadata: { provider: "email" } });
  }, initial);

  const result = await service.getSession();
  assert.deepEqual(result, { user: { id: "user-4", email: "safe@example.com", emailConfirmedAt: null } });
});


test("authenticated REST requests carry the user's access token and custom PostgREST headers", async () => {
  const initial = {
    access_token: "access-rest-1",
    refresh_token: "refresh-rest-1",
    expires_at: 1_900_000_000_000
  };
  const { service, calls } = createHarness(async (url, init) => {
    assert.ok(url.includes("/rest/v1/proxy_domain_rules"));
    assert.equal(init.headers.apikey, "sb_publishable_unit_test");
    assert.equal(init.headers.Authorization, "Bearer access-rest-1");
    assert.equal(init.headers.Prefer, "return=representation");
    return response(200, [{ host: "example.com" }]);
  }, initial);

  const rows = await service.requestWithSession("/rest/v1/proxy_domain_rules?select=host", {
    method: "GET",
    headers: { Prefer: "return=representation" }
  });
  assert.deepEqual(rows, [{ host: "example.com" }]);
  assert.equal(calls.length, 1);
});

test("authenticated REST requests refresh an expired session before sending the query", async () => {
  const initial = {
    access_token: "expired-rest-access",
    refresh_token: "rest-old-refresh",
    expires_at: 1_700_000_000_000
  };
  const { service, calls, values } = createHarness(async (url, init) => {
    if (url.includes("grant_type=refresh_token")) {
      assert.deepEqual(JSON.parse(init.body), { refresh_token: "rest-old-refresh" });
      return response(200, {
        access_token: "rest-new-access",
        refresh_token: "rest-new-refresh",
        expires_in: 3600
      });
    }
    assert.ok(url.includes("/rest/v1/proxy_domain_rules"));
    assert.equal(init.headers.Authorization, "Bearer rest-new-access");
    return response(200, []);
  }, initial);

  const rows = await service.requestWithSession("/rest/v1/proxy_domain_rules?select=host");
  assert.deepEqual(rows, []);
  assert.equal(calls.length, 2);
  assert.equal(values.get(AUTH_SESSION_STORAGE_KEY).refresh_token, "rest-new-refresh");
});

test("authenticated REST retries once with a rotated token after an unauthorized response", async () => {
  const initial = {
    access_token: "stale-rest-access",
    refresh_token: "rest-refresh",
    expires_at: 1_900_000_000_000
  };
  const { service, calls } = createHarness(async (url, init) => {
    if (url.includes("grant_type=refresh_token")) {
      return response(200, {
        access_token: "rotated-rest-access",
        refresh_token: "rotated-rest-refresh",
        expires_in: 3600
      });
    }
    if (init.headers.Authorization === "Bearer stale-rest-access") {
      return response(401, { message: "JWT expired" });
    }
    assert.equal(init.headers.Authorization, "Bearer rotated-rest-access");
    return response(200, [{ host: "retried.example" }]);
  }, initial);

  const rows = await service.requestWithSession("/rest/v1/proxy_domain_rules");
  assert.deepEqual(rows, [{ host: "retried.example" }]);
  assert.equal(calls.length, 3);
});
