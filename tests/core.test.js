import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBypassList,
  buildChromeProxyConfig,
  buildPacScript,
  createBlacklistEntry,
  createWhitelistEntry,
  getPageHostname,
  inferActiveMode,
  isHostBlacklisted,
  isHostWhitelisted,
  normalizeBlacklist,
  normalizeHostname,
  normalizeWhitelist,
  resolveDomainRoute,
  resolveGlobalRoute,
  resolveTabRoute,
  validateProxySettings
} from "../src/core.js";

const BASE = {
  mode: "clash",
  host: "127.0.0.1",
  port: "7890",
  scheme: "http",
  whitelist: [],
  blacklist: []
};

function stateFor(settings) {
  return {
    levelOfControl: "controlled_by_this_extension",
    value: buildChromeProxyConfig(settings)
  };
}

test("normalizes domain names, IDNs and trailing dots", () => {
  assert.equal(normalizeHostname(" Example.COM. "), "example.com");
  assert.equal(normalizeHostname("例子.测试"), "xn--fsqu00a.xn--0zwm56d");
  assert.equal(normalizeHostname("127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeHostname("[::1]"), "[::1]");
});

test("rejects malformed hostnames, URL paths, wildcards and PAC injection characters", () => {
  for (const value of [
    "https://example.com/path",
    "*.example.com",
    "example.com;alert(1)",
    "bad_domain.example",
    "-bad.example",
    "bad-.example",
    "example.com\\nreturn DIRECT"
  ]) {
    assert.throws(() => normalizeHostname(value), undefined, value);
  }
});

test("validates proxy protocol and port range", () => {
  assert.deepEqual(validateProxySettings({ host: "127.0.0.1", port: "7890", scheme: "http" }), {
    host: "127.0.0.1", port: 7890, scheme: "http"
  });
  assert.deepEqual(validateProxySettings({ host: "localhost", port: "1080", scheme: "socks5" }), {
    host: "localhost", port: 1080, scheme: "socks5"
  });
  assert.throws(() => validateProxySettings({ host: "127.0.0.1", port: "0", scheme: "http" }));
  assert.throws(() => validateProxySettings({ host: "127.0.0.1", port: "65536", scheme: "http" }));
  assert.throws(() => validateProxySettings({ host: "127.0.0.1", port: "7890", scheme: "https" }));
});

test("normalizes whitelist and blacklist separately, caps entries and deduplicates", () => {
  const entries = [
    { host: "EXAMPLE.com", includeSubdomains: true },
    { host: "example.com", includeSubdomains: false },
    { host: "bad_domain.example", includeSubdomains: true }
  ];
  assert.deepEqual(normalizeWhitelist(entries), [{ host: "example.com", includeSubdomains: false }]);
  assert.deepEqual(normalizeBlacklist(entries), [{ host: "example.com", includeSubdomains: false }]);
  assert.equal(normalizeWhitelist(Array.from({ length: 600 }, (_, i) => ({ host: `host${i}.example` }))).length, 500);
});

test("matches apex and subdomains only on DNS label boundaries", () => {
  const whitelist = [createWhitelistEntry("example.com", true)];
  assert.equal(isHostWhitelisted("example.com", whitelist), true);
  assert.equal(isHostWhitelisted("a.example.com", whitelist), true);
  assert.equal(isHostWhitelisted("notexample.com", whitelist), false);
  assert.equal(isHostWhitelisted("example.com.evil.test", whitelist), false);
  assert.equal(isHostWhitelisted("a.example.com", [createWhitelistEntry("example.com", false)]), false);
  assert.equal(isHostBlacklisted("a.example.com", [createBlacklistEntry("example.com", true)]), true);
});

test("builds the existing Chromium bypass list for whitelist entries", () => {
  assert.deepEqual(buildBypassList([createWhitelistEntry("example.com", true)]), ["*.example.com", "example.com"]);
  assert.deepEqual(buildBypassList([createWhitelistEntry("example.com", false)]), ["example.com"]);
});

test("direct and system modes without force-proxy exceptions preserve native modes", () => {
  assert.deepEqual(buildChromeProxyConfig({ ...BASE, mode: "direct" }), { mode: "direct" });
  assert.deepEqual(buildChromeProxyConfig({ ...BASE, mode: "system" }), { mode: "system" });
});

test("Clash mode creates mandatory PAC rules with direct whitelist and force-proxy blacklist", () => {
  const settings = {
    ...BASE,
    whitelist: [{ host: "direct.example", includeSubdomains: true }],
    blacklist: [{ host: "force.example", includeSubdomains: false }]
  };
  const config = buildChromeProxyConfig(settings);
  assert.equal(config.mode, "pac_script");
  assert.equal(config.pacScript.mandatory, true);
  assert.match(config.pacScript.data, /if \(matches\(host, forceProxyRules\)\) return "PROXY 127\.0\.0\.1:7890"/);
  assert.match(config.pacScript.data, /if \(matches\(host, allowRules\)\) return "DIRECT"/);
  assert.match(config.pacScript.data, /return "PROXY 127\.0\.0\.1:7890"/);
});

test("global direct mode uses PAC only when blacklist exceptions exist", () => {
  const directOnly = buildChromeProxyConfig({ ...BASE, mode: "direct" });
  assert.deepEqual(directOnly, { mode: "direct" });

  const withBlacklist = buildChromeProxyConfig({
    ...BASE,
    mode: "direct",
    blacklist: [{ host: "force.example", includeSubdomains: true }]
  });
  assert.equal(withBlacklist.mode, "pac_script");
  assert.match(withBlacklist.pacScript.data, /if \(matches\(host, forceProxyRules\)\) return "PROXY 127\.0\.0\.1:7890"/);
  assert.match(withBlacklist.pacScript.data, /return "DIRECT"/);
});

test("blacklist has priority over a broader whitelist when rules overlap", () => {
  const settings = {
    ...BASE,
    whitelist: [{ host: "example.com", includeSubdomains: true }],
    blacklist: [{ host: "api.example.com", includeSubdomains: true }]
  };
  assert.equal(resolveDomainRoute("www.example.com", settings), "direct");
  assert.equal(resolveDomainRoute("example.com", settings), "direct");
  assert.equal(resolveDomainRoute("api.example.com", settings), "clash");
  assert.equal(resolveDomainRoute("v2.api.example.com", settings), "clash");
});

test("PAC route resolver reports the actual page route for all rule combinations", () => {
  const settings = {
    ...BASE,
    whitelist: [{ host: "direct.example", includeSubdomains: true }],
    blacklist: [{ host: "force.example", includeSubdomains: true }]
  };
  const state = stateFor(settings);
  assert.equal(resolveTabRoute("https://www.direct.example/", state, settings), "direct");
  assert.equal(resolveTabRoute("https://other.example/", state, settings), "clash");
  assert.equal(resolveTabRoute("https://force.example/", state, settings), "clash");
  assert.equal(resolveTabRoute("https://sub.force.example/", state, settings), "clash");
  assert.equal(resolveGlobalRoute(state, settings), "clash");
});

test("global direct route marks only blacklisted domains as Clash", () => {
  const settings = {
    ...BASE,
    mode: "direct",
    blacklist: [{ host: "force.example", includeSubdomains: true }]
  };
  const state = stateFor(settings);
  assert.equal(resolveTabRoute("https://normal.example/", state, settings), "direct");
  assert.equal(resolveTabRoute("https://force.example/", state, settings), "clash");
  assert.equal(resolveGlobalRoute(state, settings), "direct");
});

test("system proxy mode explicitly ignores both domain lists", () => {
  const settings = {
    ...BASE,
    mode: "system",
    whitelist: [{ host: "direct.example", includeSubdomains: true }],
    blacklist: [{ host: "force.example", includeSubdomains: true }]
  };
  const state = stateFor(settings);
  assert.equal(resolveTabRoute("https://direct.example/", state, settings), "system");
  assert.equal(resolveTabRoute("https://force.example/", state, settings), "system");
});

test("does not report a route when another extension controls proxy settings", () => {
  const settings = { ...BASE };
  assert.equal(resolveTabRoute("https://example.com/", {
    levelOfControl: "controlled_by_other_extensions",
    value: buildChromeProxyConfig(settings)
  }, settings), "unknown");
  assert.equal(resolveTabRoute("https://example.com/", {
    levelOfControl: "not_controllable",
    value: buildChromeProxyConfig(settings)
  }, settings), "unknown");
});

test("does not infer a foreign PAC script as Alaxee-owned", () => {
  const settings = { ...BASE };
  assert.equal(inferActiveMode({ mode: "pac_script", pacScript: { data: "function FindProxyForURL(){return 'DIRECT'}" } }, settings), null);
});

test("keeps backward compatibility with the prior fixed-server Clash config", () => {
  const saved = { ...BASE, whitelist: [{ host: "example.com", includeSubdomains: true }] };
  const legacy = {
    mode: "fixed_servers",
    rules: { singleProxy: { host: "127.0.0.1", port: 7890, scheme: "http" } }
  };
  assert.equal(inferActiveMode(legacy, saved), "clash");
  assert.equal(resolveTabRoute("https://example.com/", {
    levelOfControl: "controlled_by_this_extension", value: legacy
  }, saved), "direct");
  assert.equal(resolveTabRoute("https://elsewhere.example/", {
    levelOfControl: "controlled_by_this_extension", value: legacy
  }, saved), "clash");
});

test("PAC output contains only JSON-serialized validated domain records", () => {
  const settings = {
    ...BASE,
    whitelist: [{ host: "example.com", includeSubdomains: true }]
  };
  const source = buildPacScript(settings);
  assert.match(source, /"host":"example\.com"/);
  assert.doesNotMatch(source, /alert\(/);
});

test("reads only HTTP and HTTPS page hostnames", () => {
  assert.equal(getPageHostname("https://www.example.com/a?b=1"), "www.example.com");
  assert.equal(getPageHostname("edge://extensions"), null);
  assert.equal(getPageHostname("file:///C:/test.html"), null);
});
