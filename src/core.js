export const DEFAULT_SETTINGS = Object.freeze({
  mode: "clash",
  host: "127.0.0.1",
  port: "7890",
  scheme: "http",
  includeSubdomains: true,
  whitelist: []
});

const VALID_SCHEMES = new Set(["http", "socks5"]);
const MAX_WHITELIST_ENTRIES = 500;

export function normalizeHostname(value) {
  const host = String(value ?? "").trim().replace(/^\.+|\.+$/g, "").toLowerCase();
  if (!host || /[\s/@?#\\]/.test(host) || host.includes("*")) {
    throw new Error("请输入有效的主机名，不要填写协议、路径或通配符。");
  }

  // URL performs IDN conversion and validates bracketed IPv6 literals.
  let parsed;
  try {
    parsed = new URL(`http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}/`);
  } catch {
    throw new Error("主机名格式无效。");
  }

  const normalized = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized === "[") {
    throw new Error("主机名格式无效。");
  }
  return normalized;
}

export function validateProxySettings(settings) {
  if (!settings || typeof settings !== "object") {
    throw new Error("代理设置无效。");
  }

  const scheme = String(settings.scheme ?? "http").toLowerCase();
  if (!VALID_SCHEMES.has(scheme)) {
    throw new Error("目前只支持 HTTP 和 SOCKS5 代理。");
  }

  const host = normalizeHostname(settings.host);
  const portText = String(settings.port ?? "").trim();
  if (!/^\d{1,5}$/.test(portText)) {
    throw new Error("端口必须是 1 到 65535 之间的数字。");
  }
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("端口必须是 1 到 65535 之间的数字。");
  }

  return { host, port, scheme };
}

export function normalizeWhitelist(entries) {
  if (!Array.isArray(entries)) return [];
  const unique = new Map();
  for (const entry of entries.slice(0, MAX_WHITELIST_ENTRIES)) {
    try {
      const host = normalizeHostname(entry?.host);
      const includeSubdomains = Boolean(entry?.includeSubdomains);
      unique.set(host, { host, includeSubdomains });
    } catch {
      // Ignore malformed persisted entries instead of breaking the popup.
    }
  }
  return [...unique.values()];
}

export function createWhitelistEntry(host, includeSubdomains = true) {
  return {
    host: normalizeHostname(host),
    includeSubdomains: Boolean(includeSubdomains)
  };
}

export function buildBypassList(entries) {
  const normalized = normalizeWhitelist(entries);
  const patterns = new Set();

  for (const entry of normalized) {
    patterns.add(entry.host);
    if (entry.includeSubdomains && !isIpLiteral(entry.host)) {
      // Chromium's *.example.com pattern does not include example.com itself.
      patterns.add(`*.${entry.host}`);
    }
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

export function isHostWhitelisted(host, entries) {
  let normalizedHost;
  try {
    normalizedHost = normalizeHostname(host);
  } catch {
    return false;
  }

  return normalizeWhitelist(entries).some(({ host: itemHost, includeSubdomains }) => {
    if (normalizedHost === itemHost) return true;
    return includeSubdomains && !isIpLiteral(itemHost) && normalizedHost.endsWith(`.${itemHost}`);
  });
}

export function buildChromeProxyConfig(settings) {
  if (settings.mode === "direct") return { mode: "direct" };
  if (settings.mode === "system") return { mode: "system" };
  if (settings.mode !== "clash") throw new Error("未知的代理模式。");

  const server = validateProxySettings(settings);
  return {
    mode: "fixed_servers",
    rules: {
      singleProxy: server,
      bypassList: buildBypassList(settings.whitelist)
    }
  };
}

export function inferActiveMode(value, savedSettings) {
  if (!value || typeof value !== "object") return null;
  if (value.mode === "direct") return "direct";
  if (value.mode === "system") return "system";
  if (value.mode === "fixed_servers") {
    const proxy = value.rules?.singleProxy;
    if (!proxy) return null;
    try {
      const saved = validateProxySettings(savedSettings);
      if (proxy.host === saved.host && Number(proxy.port) === saved.port && proxy.scheme === saved.scheme) {
        return "clash";
      }
    } catch {
      // The current fixed proxy does not match this extension's saved endpoint.
    }
  }
  return null;
}

export function describeProxyMode(value, savedSettings) {
  if (!value || typeof value !== "object") return "状态未知";
  if (value.mode === "direct") return "直接连接";
  if (value.mode === "system") return "跟随系统代理";
  if (value.mode === "fixed_servers") {
    const proxy = value.rules?.singleProxy;
    if (!proxy) return "其他代理配置";
    try {
      const saved = validateProxySettings(savedSettings);
      if (
        proxy.host === saved.host &&
        Number(proxy.port) === saved.port &&
        proxy.scheme === saved.scheme
      ) return "Clash 代理";
    } catch {
      // Settings may not be configured yet.
    }
    return "其他代理配置";
  }
  if (value.mode === "pac_script") return "PAC 自动代理";
  if (value.mode === "auto_detect") return "自动检测代理";
  return "状态未知";
}
