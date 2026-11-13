export const DEFAULT_SETTINGS = Object.freeze({
  mode: "clash",
  host: "127.0.0.1",
  port: "7890",
  scheme: "socks5",
  includeSubdomains: true,
  whitelist: [],
  blacklist: []
});

const VALID_SCHEMES = new Set(["http", "socks5"]);
const MAX_RULE_ENTRIES = 500;
const MERGED_SETTINGS_FIELDS = ["mode", "host", "port", "scheme", "includeSubdomains"];

function sameSettingValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function ruleMap(settings) {
  const rules = new Map();
  for (const entry of normalizeWhitelist(settings?.whitelist)) {
    rules.set(entry.host, { ruleType: "whitelist", includeSubdomains: entry.includeSubdomains });
  }
  for (const entry of normalizeBlacklist(settings?.blacklist)) {
    rules.set(entry.host, { ruleType: "blacklist", includeSubdomains: entry.includeSubdomains });
  }
  return rules;
}

function sameRule(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.ruleType === right.ruleType &&
    left.includeSubdomains === right.includeSubdomains;
}

/**
 * Merge a popup settings edit against the latest stored snapshot.
 * Scalar fields use conflict detection; domain rules merge independently by host.
 * Conflicting edits to the same field or host are rejected instead of overwritten.
 */
export function mergeConcurrentSettings({ currentSettings, baseSettings, proposedSettings }) {
  if (!currentSettings || !baseSettings || !proposedSettings ||
      typeof currentSettings !== "object" || typeof baseSettings !== "object" ||
      typeof proposedSettings !== "object") {
    throw new Error("代理设置更新缺少有效的基准或目标快照。");
  }

  const merged = { ...currentSettings };
  const conflicts = [];

  for (const key of MERGED_SETTINGS_FIELDS) {
    const baseValue = baseSettings[key];
    const proposedValue = proposedSettings[key];
    if (sameSettingValue(baseValue, proposedValue)) continue;

    const currentValue = currentSettings[key];
    if (sameSettingValue(currentValue, baseValue) || sameSettingValue(currentValue, proposedValue)) {
      merged[key] = proposedValue;
    } else {
      conflicts.push(key);
    }
  }

  const baseRules = ruleMap(baseSettings);
  const proposedRules = ruleMap(proposedSettings);
  const currentRules = ruleMap(currentSettings);
  const hosts = new Set([...baseRules.keys(), ...proposedRules.keys()]);

  for (const host of hosts) {
    const baseRule = baseRules.get(host) ?? null;
    const proposedRule = proposedRules.get(host) ?? null;
    if (sameRule(baseRule, proposedRule)) continue;

    const currentRule = currentRules.get(host) ?? null;
    if (sameRule(currentRule, baseRule)) {
      if (proposedRule) currentRules.set(host, proposedRule);
      else currentRules.delete(host);
    } else if (!sameRule(currentRule, proposedRule)) {
      conflicts.push(`rule:${host}`);
    }
  }

  const whitelist = [];
  const blacklist = [];
  for (const [host, rule] of currentRules) {
    const entry = { host, includeSubdomains: rule.includeSubdomains };
    if (rule.ruleType === "blacklist") blacklist.push(entry);
    else whitelist.push(entry);
  }
  if (whitelist.length > MAX_RULE_ENTRIES || blacklist.length > MAX_RULE_ENTRIES) {
    throw new Error(`规则合并后超过单类 ${MAX_RULE_ENTRIES} 条的安全上限；本次修改未保存。`);
  }
  merged.whitelist = normalizeWhitelist(whitelist);
  merged.blacklist = normalizeBlacklist(blacklist);

  return { settings: merged, conflicts };
}

export function normalizeHostname(value) {
  const host = String(value ?? "").trim().replace(/^\.+|\.+$/g, "").toLowerCase();
  if (!host || /[\s/@?#\\]/.test(host) || host.includes("*")) {
    throw new Error("请输入有效的主机名，不要填写协议、路径或通配符。");
  }

  let parsed;
  try {
    parsed = new URL(`http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}/`);
  } catch {
    throw new Error("主机名格式无效。");
  }

  const normalized = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const ipv6 = /^\[[0-9a-f:.]+\]$/i.test(normalized) && normalized.includes(":");
  const ipv4Parts = normalized.split(".");
  const ipv4 = ipv4Parts.length === 4 && ipv4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  const dnsLabels = normalized.split(".");
  const dns = normalized.length <= 253 && dnsLabels.every((label) =>
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
  if (!normalized || (!ipv6 && !ipv4 && !dns)) throw new Error("主机名格式无效。");
  return normalized;
}

export function validateProxySettings(settings) {
  if (!settings || typeof settings !== "object") throw new Error("代理设置无效。");

  const scheme = String(settings.scheme ?? "http").toLowerCase();
  if (!VALID_SCHEMES.has(scheme)) throw new Error("目前只支持 HTTP 和 SOCKS5 代理。");

  const host = normalizeHostname(settings.host);
  const portText = String(settings.port ?? "").trim();
  if (!/^\d{1,5}$/.test(portText)) throw new Error("端口必须是 1 到 65535 之间的数字。");
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("端口必须是 1 到 65535 之间的数字。");
  }

  return { host, port, scheme };
}

export function normalizeDomainEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const unique = new Map();
  for (const entry of entries.slice(0, MAX_RULE_ENTRIES)) {
    try {
      const host = normalizeHostname(entry?.host);
      unique.set(host, { host, includeSubdomains: Boolean(entry?.includeSubdomains) });
    } catch {
      // Ignore malformed persisted entries instead of breaking proxy startup.
    }
  }
  return [...unique.values()];
}

export function normalizeWhitelist(entries) {
  return normalizeDomainEntries(entries);
}

export function normalizeBlacklist(entries) {
  return normalizeDomainEntries(entries);
}

export function createDomainEntry(host, includeSubdomains = true) {
  return { host: normalizeHostname(host), includeSubdomains: Boolean(includeSubdomains) };
}

export function createWhitelistEntry(host, includeSubdomains = true) {
  return createDomainEntry(host, includeSubdomains);
}

export function createBlacklistEntry(host, includeSubdomains = true) {
  return createDomainEntry(host, includeSubdomains);
}

export function buildBypassList(entries) {
  const normalized = normalizeDomainEntries(entries);
  const patterns = new Set();
  for (const entry of normalized) {
    patterns.add(entry.host);
    if (entry.includeSubdomains && !isIpLiteral(entry.host)) patterns.add(`*.${entry.host}`);
  }
  return [...patterns].sort((a, b) => a.localeCompare(b));
}

export function isIpLiteral(host) {
  return host.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

export function getPageHostname(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return normalizeHostname(url.hostname);
  } catch {
    return null;
  }
}

export function isHostMatched(host, entries) {
  let normalizedHost;
  try {
    normalizedHost = normalizeHostname(host);
  } catch {
    return false;
  }

  return normalizeDomainEntries(entries).some(({ host: itemHost, includeSubdomains }) => {
    if (normalizedHost === itemHost) return true;
    return includeSubdomains && !isIpLiteral(itemHost) && normalizedHost.endsWith(`.${itemHost}`);
  });
}

export function isHostWhitelisted(host, entries) {
  return isHostMatched(host, entries);
}

export function isHostBlacklisted(host, entries) {
  return isHostMatched(host, entries);
}

/**
 * Resolve an individual domain rule.
 * Explicit force-proxy rules win over direct-bypass rules when parent/child
 * entries overlap. This makes a narrow blacklist entry override a broad
 * whitelist entry, such as api.example.com over *.example.com.
 */
export function resolveDomainRoute(host, settings) {
  if (!host) return "unknown";
  if (settings?.mode === "system") return "system";
  if (isHostBlacklisted(host, settings?.blacklist)) return "clash";
  if (isHostWhitelisted(host, settings?.whitelist)) return "direct";
  return settings?.mode === "direct" ? "direct" : settings?.mode === "clash" ? "clash" : "unknown";
}

export function buildPacScript(settings) {
  if (!settings || !["clash", "direct"].includes(settings.mode)) {
    throw new Error("PAC 规则只支持 Clash 或全局直连模式。");
  }

  const server = validateProxySettings(settings);
  const proxyDirective = server.scheme === "socks5"
    ? `SOCKS5 ${server.host}:${server.port}`
    : `PROXY ${server.host}:${server.port}`;
  const whitelist = normalizeDomainEntries(settings.whitelist);
  const blacklist = normalizeDomainEntries(settings.blacklist);
  const defaultDirective = settings.mode === "clash" ? proxyDirective : "DIRECT";

  // Values are JSON-serialized from validated domain records; user input is
  // never interpolated as executable source.
  return `/* ALAXEE_PROXY_RULES_V1 */
function FindProxyForURL(url, host) {
  var allowRules = ${JSON.stringify(whitelist)};
  var forceProxyRules = ${JSON.stringify(blacklist)};
  host = String(host || "").toLowerCase().replace(/\\.$/, "");

  function matches(hostname, rules) {
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (hostname === rule.host) return true;
      if (rule.includeSubdomains && rule.host.charAt(0) !== "[" &&
          hostname.length > rule.host.length &&
          hostname.slice(-(rule.host.length + 1)) === "." + rule.host) return true;
    }
    return false;
  }

  // Blacklist is the stronger explicit instruction and wins on overlap.
  if (matches(host, forceProxyRules)) return ${JSON.stringify(proxyDirective)};
  if (matches(host, allowRules)) return "DIRECT";
  return ${JSON.stringify(defaultDirective)};
}`;
}

export function buildChromeProxyConfig(settings) {
  if (settings.mode === "system") return { mode: "system" };
  if (settings.mode === "direct" && normalizeDomainEntries(settings.blacklist).length === 0) {
    return { mode: "direct" };
  }
  if (!["clash", "direct"].includes(settings.mode)) throw new Error("未知的代理模式。");

  return {
    mode: "pac_script",
    pacScript: {
      data: buildPacScript(settings),
      mandatory: true
    }
  };
}

export function inferActiveMode(value, savedSettings) {
  if (!value || typeof value !== "object") return null;
  if (value.mode === "direct") return "direct";
  if (value.mode === "system") return "system";

  if (value.mode === "pac_script") {
    try {
      const expected = buildChromeProxyConfig(savedSettings);
      if (expected.mode === "pac_script" && value.pacScript?.data === expected.pacScript.data) {
        return savedSettings.mode;
      }
    } catch {
      // A different or invalid PAC script is not owned by this extension.
    }
    return null;
  }

  // Backward compatibility with settings installed before domain PAC rules.
  if (value.mode === "fixed_servers") {
    const proxy = value.rules?.singleProxy;
    if (!proxy) return null;
    try {
      const saved = validateProxySettings(savedSettings);
      if (proxy.host === saved.host && Number(proxy.port) === saved.port && proxy.scheme === saved.scheme) {
        return "clash";
      }
    } catch {
      // The fixed proxy does not match this extension's saved endpoint.
    }
  }
  return null;
}

export function describeProxyMode(value, savedSettings) {
  if (!value || typeof value !== "object") return "状态未知";
  if (value.mode === "direct") return "直接连接";
  if (value.mode === "system") return "跟随系统代理";
  if (value.mode === "pac_script") {
    const mode = inferActiveMode(value, savedSettings);
    if (mode === "clash") return "Clash 代理（域名规则）";
    if (mode === "direct") return "全局直连（黑名单例外）";
    return "其他 PAC 代理配置";
  }
  if (value.mode === "fixed_servers") {
    const proxy = value.rules?.singleProxy;
    if (!proxy) return "其他代理配置";
    try {
      const saved = validateProxySettings(savedSettings);
      if (proxy.host === saved.host && Number(proxy.port) === saved.port && proxy.scheme === saved.scheme) {
        return "Clash 代理";
      }
    } catch {
      // Settings may not be configured yet.
    }
    return "其他代理配置";
  }
  if (value.mode === "auto_detect") return "自动检测代理";
  return "状态未知";
}

/**
 * "clash" means the browser hands requests to the local listener. It does not
 * guarantee Clash will choose a proxy node instead of DIRECT.
 */
export function resolveTabRoute(url, proxyState, savedSettings) {
  const hostname = getPageHostname(url);
  if (!hostname || !proxyState || typeof proxyState !== "object") return "unknown";

  const level = proxyState.levelOfControl;
  if (level === "not_controllable" || level === "controlled_by_other_extensions") return "unknown";

  const value = proxyState.value ?? {};
  const activeMode = inferActiveMode(value, savedSettings);
  if (activeMode === null) return "unknown";

  if (value.mode === "pac_script") return resolveDomainRoute(hostname, savedSettings);
  if (value.mode === "fixed_servers") {
    if (activeMode !== "clash") return "unknown";
    return isHostWhitelisted(hostname, savedSettings.whitelist) && !isHostBlacklisted(hostname, savedSettings.blacklist)
      ? "direct"
      : "clash";
  }
  if (activeMode === "direct") return "direct";
  if (activeMode === "system") return "system";
  return "unknown";
}

export function resolveGlobalRoute(proxyState, savedSettings) {
  if (!proxyState || typeof proxyState !== "object") return "unknown";
  const level = proxyState.levelOfControl;
  if (level === "not_controllable" || level === "controlled_by_other_extensions") return "unknown";
  return inferActiveMode(proxyState.value ?? {}, savedSettings) ?? "unknown";
}
