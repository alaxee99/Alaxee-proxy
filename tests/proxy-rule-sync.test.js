import test from "node:test";
import assert from "node:assert/strict";
import {
  createProxyRuleSyncService,
  PROXY_RULE_SYNC_BINDING_KEY
} from "../src/proxy-rule-sync.js";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async get(key) { return values.get(key); },
    async set(key, value) { values.set(key, structuredClone(value)); }
  };
}

function makeRow(host, ruleType, revision = 1, isDeleted = false, includeSubdomains = true, userId = USER_A) {
  return {
    user_id: userId,
    host,
    rule_type: ruleType,
    include_subdomains: includeSubdomains,
    is_deleted: isDeleted,
    revision,
    updated_at: `2026-11-07T00:00:${String(revision).padStart(2, "0")}.000Z`
  };
}

function createHarness({
  userId = USER_A,
  currentUserId = () => userId,
  remoteRows = [],
  localSettings = {
    mode: "clash",
    host: "127.0.0.1",
    port: "7890",
    scheme: "socks5",
    whitelist: [],
    blacklist: []
  },
  pageSize = 500,
  requestOverride
} = {}) {
  const storage = createStorage();
  const calls = [];
  let settings = structuredClone(localSettings);
  const serverRows = remoteRows.map((row) => structuredClone(row));

  async function request(path, options = {}) {
    calls.push({ path, ...options });
    if (requestOverride) return requestOverride(path, options, serverRows, calls);

    const url = new URL(path, "https://unit.test");
    const method = options.method || "GET";
    const params = url.searchParams;

    if (method === "GET") {
      let rows = serverRows.filter((row) => row.user_id === USER_A);
      if (params.has("host")) rows = rows.filter((row) => row.host === params.get("host").slice(3));
      const offset = Number(params.get("offset") || 0);
      const limit = Number(params.get("limit") || 1000);
      return rows.slice(offset, offset + limit).map((row) => structuredClone(row));
    }

    if (method === "POST") {
      const body = options.body;
      if (serverRows.some((row) => row.user_id === USER_A && row.host === body.host)) {
        const error = new Error("duplicate key");
        error.status = 409;
        throw error;
      }
      const row = makeRow(body.host, body.rule_type, 1, body.is_deleted, body.include_subdomains);
      serverRows.push(row);
      return [structuredClone(row)];
    }

    if (method === "PATCH") {
      const host = params.get("host").slice(3);
      const revision = Number(params.get("revision").slice(3));
      const row = serverRows.find((item) => item.user_id === USER_A && item.host === host);
      if (!row || row.revision !== revision) return [];
      Object.assign(row, options.body, { revision: row.revision + 1, updated_at: "2026-11-07T01:00:00.000Z" });
      return [structuredClone(row)];
    }

    throw new Error(`Unexpected REST method: ${method}`);
  }

  const service = createProxyRuleSyncService({
    userId,
    storage,
    request,
    getCurrentUserId: currentUserId,
    getLocalSettings: async () => structuredClone(settings),
    saveLocalSettings: async (next) => { settings = structuredClone(next); },
    now: () => "2026-11-07T00:00:00.000Z",
    pageSize
  });

  return {
    service,
    storage,
    calls,
    serverRows,
    get settings() { return structuredClone(settings); },
    set settings(value) { settings = structuredClone(value); }
  };
}

test("bootstrap paginates remote rows, remote state wins collisions, and tombstones block resurrection", async () => {
  const harness = createHarness({
    pageSize: 2,
    remoteRows: [
      makeRow("remote-allow.example", "whitelist", 3),
      makeRow("collision.example", "blacklist", 7, false, false),
      makeRow("deleted.example", "whitelist", 9, true)
    ],
    localSettings: {
      mode: "direct",
      host: "127.0.0.1",
      port: "7890",
      scheme: "socks5",
      whitelist: [
        { host: "remote-allow.example", includeSubdomains: false },
        { host: "collision.example", includeSubdomains: true },
        { host: "deleted.example", includeSubdomains: true },
        { host: "local-only.example", includeSubdomains: true }
      ],
      blacklist: []
    }
  });

  const status = await harness.service.bootstrap();
  assert.equal(status.bootstrapped, true);
  assert.equal(status.pendingCount, 1);
  assert.deepEqual(harness.settings.whitelist, [
    { host: "remote-allow.example", includeSubdomains: true },
    { host: "local-only.example", includeSubdomains: true }
  ]);
  assert.deepEqual(harness.settings.blacklist, [
    { host: "collision.example", includeSubdomains: false }
  ]);
  assert.equal(harness.settings.mode, "direct");
  assert.equal(harness.settings.host, "127.0.0.1");
  assert.equal(harness.settings.port, "7890");
  assert.equal(harness.settings.scheme, "socks5");

  const listCalls = harness.calls.filter((call) => call.method === "GET");
  assert.equal(listCalls.length, 2, "a second page is fetched when the first page is full");
  assert.equal(harness.storage.values.get(PROXY_RULE_SYNC_BINDING_KEY), USER_A);

  const flushed = await harness.service.flushOutbox();
  assert.equal(flushed.pendingCount, 0);
  const inserted = harness.calls.find((call) => call.method === "POST");
  assert.ok(inserted);
  assert.equal(inserted.body.host, "local-only.example");
  assert.equal("user_id" in inserted.body, false);
  assert.equal("revision" in inserted.body, false);
  assert.equal("updated_at" in inserted.body, false);
  assert.equal(harness.serverRows.length, 4);
});

test("stale revision is not overwritten; the newer remote row is adopted and conflict is recorded", async () => {
  const harness = createHarness({
    remoteRows: [makeRow("conflict.example", "whitelist", 1, false, true)]
  });

  await harness.service.bootstrap();
  harness.settings = {
    ...harness.settings,
    whitelist: [],
    blacklist: [{ host: "conflict.example", includeSubdomains: false }]
  };
  await harness.service.enqueueRule({
    host: "conflict.example",
    ruleType: "blacklist",
    includeSubdomains: false
  });

  harness.serverRows[0].revision = 2;
  harness.serverRows[0].include_subdomains = false;
  const status = await harness.service.flushOutbox();

  assert.equal(status.pendingCount, 0);
  assert.equal(status.conflicts.length, 1);
  assert.equal(status.conflicts[0].host, "conflict.example");
  assert.deepEqual(harness.settings.whitelist, [
    { host: "conflict.example", includeSubdomains: false }
  ]);
  assert.deepEqual(harness.settings.blacklist, []);
  assert.equal(harness.serverRows[0].rule_type, "whitelist");
  assert.equal(harness.serverRows[0].revision, 2);
});

test("an account switch pauses sync before any network request", async () => {
  const harness = createHarness({ currentUserId: () => USER_B });
  await assert.rejects(harness.service.bootstrap(), /active ALAXEE account changed/);
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.storage.values.has(PROXY_RULE_SYNC_BINDING_KEY), false);
});

test("a browser profile bound to another ALAXEE user cannot bootstrap or upload local rules", async () => {
  const storage = createStorage({ [PROXY_RULE_SYNC_BINDING_KEY]: USER_B });
  let requestCount = 0;
  const service = createProxyRuleSyncService({
    userId: USER_A,
    storage,
    request: async () => { requestCount += 1; return []; },
    getLocalSettings: async () => ({ whitelist: [{ host: "private.example" }], blacklist: [] }),
    saveLocalSettings: async () => {}
  });

  await assert.rejects(service.bootstrap(), /ACCOUNT_SWITCH_REQUIRES_RESET/);
  assert.equal(requestCount, 0);
});

test("offline insert keeps its durable outbox item and does not issue a DELETE", async () => {
  const harness = createHarness({
    localSettings: {
      mode: "clash",
      host: "127.0.0.1",
      port: "7890",
      scheme: "http",
      whitelist: [{ host: "offline.example", includeSubdomains: true }],
      blacklist: []
    },
    requestOverride: async (path, options, rows) => {
      const url = new URL(path, "https://unit.test");
      if ((options.method || "GET") === "GET") return [];
      if (options.method === "POST") throw new Error("network offline");
      if (options.method === "DELETE") throw new Error("DELETE must never be used");
      return rows;
    }
  });

  await assert.rejects(harness.service.sync(), /network offline/);
  const status = await harness.service.getStatus();
  assert.equal(status.pendingCount, 1);
  assert.equal(harness.calls.some((call) => call.method === "DELETE"), false);
});

test("deletion is represented by a tombstone update and never by REST DELETE", async () => {
  const harness = createHarness({
    remoteRows: [makeRow("remove.example", "whitelist", 4)]
  });

  await harness.service.bootstrap();
  harness.settings = { ...harness.settings, whitelist: [] };
  await harness.service.enqueueRule({
    host: "remove.example",
    ruleType: "whitelist",
    includeSubdomains: true,
    isDeleted: true
  });
  const status = await harness.service.flushOutbox();

  assert.equal(status.pendingCount, 0);
  const patch = harness.calls.find((call) => call.method === "PATCH");
  assert.ok(patch);
  assert.equal(patch.body.is_deleted, true);
  assert.equal(patch.body.host, "remove.example");
  assert.equal(harness.serverRows[0].is_deleted, true);
  assert.equal(harness.calls.some((call) => call.method === "DELETE"), false);
});
