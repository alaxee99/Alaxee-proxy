import {
  normalizeBlacklist,
  normalizeHostname,
  normalizeWhitelist
} from "./core.js";

export const PROXY_RULE_SYNC_VERSION = 1;
export const PROXY_RULE_SYNC_BINDING_KEY = "alaxeeProxyRuleSync.v1.boundUserId";
const STORAGE_PREFIX = "alaxeeProxyRuleSync.v1";
const DEFAULT_PAGE_SIZE = 500;
const MAX_REMOTE_PAGES = 200;
const MAX_CONFLICTS = 20;
const REMOTE_COLUMNS = "user_id,host,rule_type,include_subdomains,is_deleted,revision,updated_at";

function assertUserId(value) {
  const userId = String(value ?? "").toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(userId)) {
    throw new Error("A valid authenticated ALAXEE user ID is required.");
  }
  return userId;
}

function assertRemoteRow(row, userId) {
  if (!row || typeof row !== "object") throw new Error("Supabase returned an invalid Proxy rule row.");
  if (String(row.user_id ?? "").toLowerCase() !== userId) {
    throw new Error("Supabase returned a Proxy rule for a different account; sync was stopped.");
  }
  const host = normalizeHostname(row.host);
  if (host !== row.host) throw new Error("Supabase returned a non-normalized Proxy rule host.");
  if (!["whitelist", "blacklist"].includes(row.rule_type)) {
    throw new Error("Supabase returned an unknown Proxy rule type.");
  }
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Supabase returned an invalid Proxy rule revision.");
  }
  if (typeof row.is_deleted !== "boolean" || typeof row.include_subdomains !== "boolean") {
    throw new Error("Supabase returned invalid Proxy rule flags.");
  }
  return {
    user_id: userId,
    host,
    rule_type: row.rule_type,
    include_subdomains: row.include_subdomains,
    is_deleted: row.is_deleted,
    revision,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null
  };
}

function keyFor(userId, name) {
  return `${STORAGE_PREFIX}.${userId}.${name}`;
}

function makeRuleMap(settings) {
  const map = new Map();
  for (const entry of normalizeWhitelist(settings?.whitelist)) {
    map.set(entry.host, {
      host: entry.host,
      ruleType: "whitelist",
      includeSubdomains: entry.includeSubdomains
    });
  }
  for (const entry of normalizeBlacklist(settings?.blacklist)) {
    map.set(entry.host, {
      host: entry.host,
      ruleType: "blacklist",
      includeSubdomains: entry.includeSubdomains
    });
  }
  return map;
}

function activeLists(rows) {
  const whitelist = [];
  const blacklist = [];
  for (const row of rows) {
    if (row.is_deleted) continue;
    const entry = { host: row.host, includeSubdomains: row.include_subdomains };
    if (row.rule_type === "whitelist") whitelist.push(entry);
    else blacklist.push(entry);
  }
  return {
    whitelist: normalizeWhitelist(whitelist),
    blacklist: normalizeBlacklist(blacklist)
  };
}

function rowPayload(operation) {
  return {
    host: operation.host,
    rule_type: operation.ruleType,
    include_subdomains: operation.includeSubdomains,
    is_deleted: operation.isDeleted
  };
}

function makeQuery(parameters) {
  return new URLSearchParams(parameters).toString();
}

export function createProxyRuleSyncService({
  userId: rawUserId,
  storage,
  request,
  getCurrentUserId = () => rawUserId,
  getLocalSettings,
  saveLocalSettings,
  now = () => new Date().toISOString(),
  pageSize = DEFAULT_PAGE_SIZE
}) {
  const userId = assertUserId(rawUserId);
  if (!storage || typeof storage.get !== "function" || typeof storage.set !== "function") {
    throw new Error("Proxy rule sync requires a durable local storage adapter.");
  }
  if (typeof request !== "function" || typeof getLocalSettings !== "function" ||
      typeof saveLocalSettings !== "function") {
    throw new Error("Proxy rule sync is missing a required service adapter.");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("Proxy rule sync page size must be between 1 and 1000.");
  }

  const stateKey = keyFor(userId, "state");
  const outboxKey = keyFor(userId, "outbox");
  const bindingKey = PROXY_RULE_SYNC_BINDING_KEY;

  async function readState() {
    const value = await storage.get(stateKey);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { version: PROXY_RULE_SYNC_VERSION, userId, bootstrapped: false, revisions: {}, conflicts: [] };
    }
    if (value.userId !== userId || value.version !== PROXY_RULE_SYNC_VERSION) {
      throw new Error("Stored Proxy sync metadata does not match this account or version.");
    }
    return {
      version: PROXY_RULE_SYNC_VERSION,
      userId,
      bootstrapped: Boolean(value.bootstrapped),
      revisions: value.revisions && typeof value.revisions === "object" ? value.revisions : {},
      conflicts: Array.isArray(value.conflicts) ? value.conflicts.slice(-MAX_CONFLICTS) : [],
      lastSyncedAt: value.lastSyncedAt ?? null,
      lastError: value.lastError ?? null
    };
  }

  async function writeState(state) {
    await storage.set(stateKey, state);
  }

  async function readOutbox() {
    const value = await storage.get(outboxKey);
    if (value == null) return [];
    if (!Array.isArray(value)) throw new Error("Stored Proxy sync outbox is invalid.");
    return value;
  }

  async function writeOutbox(outbox) {
    await storage.set(outboxKey, outbox);
  }

  async function assertAccountBinding() {
    const activeUserId = assertUserId(await getCurrentUserId());
    if (activeUserId !== userId) {
      throw new Error("The active ALAXEE account changed; Proxy cloud sync is paused.");
    }
    const boundUserId = await storage.get(bindingKey);
    if (boundUserId && String(boundUserId).toLowerCase() !== userId) {
      throw new Error("ACCOUNT_SWITCH_REQUIRES_RESET: this browser profile was previously synced with another ALAXEE account.");
    }
    if (!boundUserId) await storage.set(bindingKey, userId);
  }

  async function fetchRemoteRows() {
    const rows = [];
    for (let page = 0; page < MAX_REMOTE_PAGES; page += 1) {
      await assertAccountBinding();
      const offset = page * pageSize;
      const query = makeQuery({
        select: REMOTE_COLUMNS,
        user_id: `eq.${userId}`,
        order: "updated_at.asc,host.asc",
        limit: String(pageSize),
        offset: String(offset)
      });
      const result = await request(`/rest/v1/proxy_domain_rules?${query}`, {
        method: "GET"
      });
      if (!Array.isArray(result)) {
        throw new Error("Supabase returned an incomplete Proxy rules page; local rules were not replaced.");
      }
      const checked = result.map((row) => assertRemoteRow(row, userId));
      rows.push(...checked);
      if (checked.length < pageSize) return rows;
    }
    throw new Error("Proxy rule sync reached its pagination safety limit; refusing to treat a partial download as complete.");
  }

  async function fetchRemoteHost(host) {
    await assertAccountBinding();
    const query = makeQuery({
      select: REMOTE_COLUMNS,
      user_id: `eq.${userId}`,
      host: `eq.${host}`,
      limit: "2"
    });
    const result = await request(`/rest/v1/proxy_domain_rules?${query}`, { method: "GET" });
    if (!Array.isArray(result) || result.length > 1) {
      throw new Error("Supabase returned an invalid result while resolving a Proxy rule conflict.");
    }
    return result.length ? assertRemoteRow(result[0], userId) : null;
  }

  async function applyRemoteRow(row) {
    const settings = await getLocalSettings();
    const whitelist = normalizeWhitelist(settings?.whitelist).filter((entry) => entry.host !== row.host);
    const blacklist = normalizeBlacklist(settings?.blacklist).filter((entry) => entry.host !== row.host);
    if (!row.is_deleted) {
      const entry = { host: row.host, includeSubdomains: row.include_subdomains };
      if (row.rule_type === "whitelist") whitelist.push(entry);
      else blacklist.push(entry);
    }
    await saveLocalSettings({
      ...settings,
      whitelist: normalizeWhitelist(whitelist),
      blacklist: normalizeBlacklist(blacklist)
    });
  }

  async function rememberRemoteRow(state, row) {
    state.revisions[row.host] = row.revision;
    await writeState(state);
  }

  async function bootstrap() {
    await assertAccountBinding();
    const state = await readState();
    if (state.bootstrapped) return getStatus();

    const remoteRows = await fetchRemoteRows();
    const remoteByHost = new Map(remoteRows.map((row) => [row.host, row]));
    const localSettings = await getLocalSettings();
    const localByHost = makeRuleMap(localSettings);
    const remoteActive = remoteRows.filter((row) => !row.is_deleted);
    const preservedLocalOnly = [];

    for (const [host, local] of localByHost) {
      if (remoteByHost.has(host)) continue;
      preservedLocalOnly.push(local);
    }

    const merged = activeLists(remoteActive);
    const whitelist = normalizeWhitelist([
      ...merged.whitelist,
      ...preservedLocalOnly.filter((entry) => entry.ruleType === "whitelist")
    ]);
    const blacklist = normalizeBlacklist([
      ...merged.blacklist,
      ...preservedLocalOnly.filter((entry) => entry.ruleType === "blacklist")
    ]);

    await saveLocalSettings({ ...localSettings, whitelist, blacklist });

    const outbox = await readOutbox();
    for (const local of preservedLocalOnly) {
      const existing = outbox.find((entry) => entry.host === local.host);
      if (existing) continue;
      outbox.push({
        id: `${local.host}:bootstrap`,
        host: local.host,
        ruleType: local.ruleType,
        includeSubdomains: local.includeSubdomains,
        isDeleted: false,
        baseRevision: null,
        createdAt: now()
      });
    }

    state.revisions = Object.fromEntries(remoteRows.map((row) => [row.host, row.revision]));
    state.bootstrapped = true;
    state.lastSyncedAt = now();
    state.lastError = null;
    await writeOutbox(outbox);
    await writeState(state);
    return getStatus();
  }

  async function enqueueRule({ host: rawHost, ruleType, includeSubdomains = true, isDeleted = false }) {
    await assertAccountBinding();
    const host = normalizeHostname(rawHost);
    if (!["whitelist", "blacklist"].includes(ruleType)) throw new Error("A Proxy rule type is required.");
    if (typeof isDeleted !== "boolean") throw new Error("Proxy rule deletion state must be boolean.");

    const state = await readState();
    const outbox = await readOutbox();
    const existing = outbox.find((entry) => entry.host === host);
    const operation = {
      id: `${host}:${now()}`,
      host,
      ruleType,
      includeSubdomains: Boolean(includeSubdomains),
      isDeleted,
      baseRevision: existing ? existing.baseRevision : (state.revisions[host] ?? null),
      createdAt: existing?.createdAt ?? now()
    };
    const next = outbox.filter((entry) => entry.host !== host);
    next.push(operation);
    await writeOutbox(next);
    return getStatus();
  }

  async function resolveConflict(state, outbox, operation, remoteRow) {
    if (!remoteRow) {
      throw new Error(`Conflict row for '${operation.host}' no longer exists; queued change was retained.`);
    }
    await applyRemoteRow(remoteRow);
    state.revisions[remoteRow.host] = remoteRow.revision;
    state.conflicts = [
      ...state.conflicts,
      { host: operation.host, at: now(), remoteRevision: remoteRow.revision }
    ].slice(-MAX_CONFLICTS);
    await writeState(state);
    await writeOutbox(outbox.filter((entry) => entry.id !== operation.id));
  }

  async function flushOutbox() {
    await assertAccountBinding();
    if (!(await readState()).bootstrapped) await bootstrap();

    let state = await readState();
    let outbox = await readOutbox();
    for (const operation of [...outbox]) {
      await assertAccountBinding();
      const payload = rowPayload(operation);
      if (operation.baseRevision == null) {
        try {
          const created = await request("/rest/v1/proxy_domain_rules", {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: payload
          });
          if (!Array.isArray(created) || created.length !== 1) {
            throw new Error("Supabase did not confirm the new Proxy rule row.");
          }
          const row = assertRemoteRow(created[0], userId);
          state.revisions[row.host] = row.revision;
          outbox = outbox.filter((entry) => entry.id !== operation.id);
          await writeState(state);
          await writeOutbox(outbox);
        } catch (error) {
          if (Number(error?.status) !== 409) throw error;
          const remoteRow = await fetchRemoteHost(operation.host);
          await resolveConflict(state, outbox, operation, remoteRow);
          outbox = await readOutbox();
        }
      } else {
        const query = makeQuery({
          user_id: `eq.${userId}`,
          host: `eq.${operation.host}`,
          revision: `eq.${operation.baseRevision}`
        });
        const updated = await request(`/rest/v1/proxy_domain_rules?${query}`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: payload
        });
        if (Array.isArray(updated) && updated.length === 1) {
          const row = assertRemoteRow(updated[0], userId);
          state.revisions[row.host] = row.revision;
          outbox = outbox.filter((entry) => entry.id !== operation.id);
          await writeState(state);
          await writeOutbox(outbox);
        } else if (Array.isArray(updated) && updated.length === 0) {
          const remoteRow = await fetchRemoteHost(operation.host);
          await resolveConflict(state, outbox, operation, remoteRow);
          outbox = await readOutbox();
        } else {
          throw new Error("Supabase returned an ambiguous Proxy rule update; the operation remains queued.");
        }
      }
    }

    state = await readState();
    state.lastSyncedAt = now();
    state.lastError = null;
    await writeState(state);
    return getStatus();
  }

  async function sync() {
    await assertAccountBinding();
    if (!(await readState()).bootstrapped) await bootstrap();
    return flushOutbox();
  }

  async function getStatus() {
    const [state, outbox] = await Promise.all([readState(), readOutbox()]);
    return {
      userId,
      bootstrapped: state.bootstrapped,
      pendingCount: outbox.length,
      lastSyncedAt: state.lastSyncedAt ?? null,
      lastError: state.lastError ?? null,
      conflicts: state.conflicts ?? []
    };
  }

  return Object.freeze({ bootstrap, enqueueRule, flushOutbox, sync, getStatus });
}
