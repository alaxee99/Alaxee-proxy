import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBypassList,
  buildChromeProxyConfig,
  createWhitelistEntry,
  getPageHostname,
  inferActiveMode,
  isHostWhitelisted,
  normalizeHostname,
  normalizeWhitelist,
  resolveGlobalRoute,
  resolveTabRoute,
  validateProxySettings
} from "../src/core.js";

test("normalizes domain names and removes a trailing dot", () => {
  assert.equal(normalizeHostname(" Example.COM. "), "example.com");
});

test("rejects proxy host values containing a URL path or wildcard", () => {
  assert.throws(() => normalizeHostname("https://example.com/path"));
  assert.throws(() => normalizeHostname("*.example.com"));
});

test("validates supported proxy schemes and port range", () => {
  assert.deepEqual(validateProxySettings({ host: "127.0.0.1", port: "7890", scheme: "http" }), {
    host: "127.0.0.1", port: 7890, scheme: "http"
  });
  assert.throws(() => validateProxySettings({ host: "127.0.0.1", port: "0", scheme: "http" }));
  assert.throws(() => validateProxySettings({ host: "127.0.0.1", port: "65536", scheme: "http" }));
  assert.throws(() => validateProxySettings({ host: "127.0.0.1", port: "7890", scheme: "https" }));
});

test("builds bypass patterns for apex and subdomains", () => {
  assert.deepEqual(buildBypassList([createWhitelistEntry("example.com", true)]), ["*.example.com", "example.com"]);
});

test("an exact-only entry does not bypass subdomains", () => {
  assert.deepEqual(buildBypassList([createWhitelistEntry("example.com", false)]), ["example.com"]);
  assert.equal(isHostWhitelisted("www.example.com", [{ host: "example.com", includeSubdomains: false }]), false);
});

test("subdomain matching is boundary-aware", () => {
  assert.equal(isHostWhitelisted("a.example.com", [{ host: "example.com", includeSubdomains: true }]), true);
  assert.equal(isHostWhitelisted("notexample.com", [{ host: "example.com", includeSubdomains: true }]), false);
});

test("normalizes duplicate whitelist entries", () => {
  assert.deepEqual(normalizeWhitelist([
    { host: "EXAMPLE.com", includeSubdomains: true },
    { host: "example.com", includeSubdomains: false }
  ]), [{ host: "example.com", includeSubdomains: false }]);
});

test("reads only HTTP and HTTPS page hostnames", () => {
  assert.equal(getPageHostname("https://www.example.com/a?b=1"), "www.example.com");
  assert.equal(getPageHostname("edge://extensions"), null);
  assert.equal(getPageHostname("file:///C:/test.html"), null);
});

test("creates direct, system, and fixed Clash proxy configurations", () => {
  assert.deepEqual(buildChromeProxyConfig({ mode: "direct" }), { mode: "direct" });
  assert.deepEqual(buildChromeProxyConfig({ mode: "system" }), { mode: "system" });
  assert.deepEqual(buildChromeProxyConfig({
    mode: "clash", host: "127.0.0.1", port: "7890", scheme: "http",
    whitelist: [{ host: "example.com", includeSubdomains: true }]
  }), {
    mode: "fixed_servers",
    rules: {
      singleProxy: { host: "127.0.0.1", port: 7890, scheme: "http" },
      bypassList: ["*.example.com", "example.com"]
    }
  });
});


test("identifies the actual Edge mode instead of assuming the saved preference is active", () => {
  const saved = { host: "127.0.0.1", port: "7890", scheme: "http" };
  assert.equal(inferActiveMode({ mode: "system" }, saved), "system");
  assert.equal(inferActiveMode({ mode: "direct" }, saved), "direct");
  assert.equal(inferActiveMode({
    mode: "fixed_servers",
    rules: { singleProxy: { host: "127.0.0.1", port: 7890, scheme: "http" } }
  }, saved), "clash");
  assert.equal(inferActiveMode({
    mode: "fixed_servers",
    rules: { singleProxy: { host: "127.0.0.1", port: 7891, scheme: "http" } }
  }, saved), null);
});


test("classifies per-tab routes without confusing browser and Clash routing", () => {
  const settings = {
    host: "127.0.0.1",
    port: "7890",
    scheme: "http",
    whitelist: [{ host: "example.com", includeSubdomains: true }]
  };
  const ownClash = {
    levelOfControl: "controlled_by_this_extension",
    value: {
      mode: "fixed_servers",
      rules: { singleProxy: { host: "127.0.0.1", port: 7890, scheme: "http" } }
    }
  };

  assert.equal(resolveTabRoute("https://www.example.com/path", ownClash, settings), "direct");
  assert.equal(resolveTabRoute("https://other.test/", ownClash, settings), "clash");
  assert.equal(resolveTabRoute("edge://extensions", ownClash, settings), "unknown");
  assert.equal(resolveTabRoute("https://other.test/", {
    levelOfControl: "controlled_by_other_extensions",
    value: { mode: "direct" }
  }, settings), "unknown");
  assert.equal(resolveTabRoute("https://other.test/", {
    levelOfControl: "controlled_by_this_extension",
    value: { mode: "system" }
  }, settings), "system");
  assert.equal(resolveGlobalRoute(ownClash, settings), "clash");
});
