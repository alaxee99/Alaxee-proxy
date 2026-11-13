import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

function assertLocalFile(relativePath, label) {
  assert.ok(existsSync(path.join(root, relativePath)), `${label} points to missing file: ${relativePath}`);
}

test("manifest popup path exists", () => {
  assertLocalFile(manifest.action.default_popup, "action.default_popup");
});

test("popup stylesheet and module paths resolve relative to popup html", async () => {
  const htmlPath = manifest.action.default_popup;
  const html = await readFile(path.join(root, htmlPath), "utf8");
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((v) => !/^(https?:|data:|#)/i.test(v));
  for (const ref of refs) assertLocalFile(path.join(path.dirname(htmlPath), ref), "popup asset");
});

test("options page and its local assets exist", async () => {
  assertLocalFile(manifest.options_ui.page, "options_ui.page");
  const html = await readFile(path.join(root, manifest.options_ui.page), "utf8");
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((v) => !/^(https?:|data:|#)/i.test(v));
  for (const ref of refs) assertLocalFile(path.join(path.dirname(manifest.options_ui.page), ref), "options asset");
});

test("manifest icons exist", () => {
  for (const icon of Object.values(manifest.icons)) assertLocalFile(icon, "manifest icon");
  for (const icon of Object.values(manifest.action.default_icon)) assertLocalFile(icon, "action icon");
});

test("extension JavaScript imports resolve to packaged files", async () => {
  const jsFiles = [manifest.action.default_popup, manifest.options_ui.page].map((p) => path.join(root, p));
  for (const htmlFile of jsFiles) {
    const html = await readFile(htmlFile, "utf8");
    for (const [, scriptPath] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
      const scriptFile = path.join(path.dirname(htmlFile), scriptPath);
      assert.ok(existsSync(scriptFile), `missing script: ${scriptFile}`);
      const source = await readFile(scriptFile, "utf8");
      for (const [, importPath] of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        if (importPath.startsWith(".")) {
          assert.ok(existsSync(path.resolve(path.dirname(scriptFile), importPath)), `missing module import: ${importPath}`);
        }
      }
    }
  }
});


test("the full options page reuses the popup controls and controller", async () => {
  const html = await readFile(path.join(root, manifest.options_ui.page), "utf8");
  assert.match(html, /src="settings\.js"/);
  const entry = await readFile(path.join(root, "settings.js"), "utf8");
  assert.match(entry, /chrome\.runtime\.getURL\("src\/popup\.html\?full=1"\)/);
  assert.match(entry, /window\.location\.replace/);

  const popup = await readFile(path.join(root, "src/popup.html"), "utf8");
  for (const id of ["schemeInput", "saveConnectButton", "currentHost", "addCurrentDirectButton", "addCurrentProxyButton", "whitelistTab", "blacklistTab", "ruleHostInput"]) {
    assert.ok(popup.includes(`id="${id}"`), `full settings control missing: ${id}`);
  }
  const script = await readFile(path.join(root, "src/popup.js"), "utf8");
  assert.match(script, /get\("full"\) === "1"/);
  assert.match(script, /chrome\.tabs, "create"/);
  assert.match(script, /chrome\.tabs, "remove"/);
  assert.match(script, /sourceTabId/);
  const css = await readFile(path.join(root, "src/popup.css"), "utf8");
  assert.match(css, /html\.full-page #overviewView/);
  assert.match(css, /html\.full-page #overviewView \.mode-panel/);
});

test("popup uses one bounded scroll container", async () => {
  const css = await readFile(path.join(root, "src/popup.css"), "utf8");
  assert.match(css, /html, body \{[^}]*overflow: hidden/s);
  assert.match(css, /\.app-shell \{[^}]*overflow-y: auto/s);
  assert.match(css, /\.app-shell \{[^}]*height: 600px/s);
});


test("repository includes the dependency-free Edge store packager", async () => {
  assertLocalFile("scripts/package-extension.py", "store package script");
  assertLocalFile("docs/EDGE-ADDONS-PUBLISHING.md", "store publishing guide");
  assertLocalFile("PRIVACY.md", "privacy notice");
  assertLocalFile("STORE-LISTING.md", "store listing draft");
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["package:extension"], "python scripts/package-extension.py");
});

test("Edge Add-ons publisher script exists without triggering store publication in CI", async () => {
  assertLocalFile("scripts/publish-edge-addons.mjs", "Edge Add-ons publisher script");
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["package:extension"], "python scripts/package-extension.py");
});


test("per-tab status service worker and optional permission are declared", async () => {
  assert.equal(manifest.background?.service_worker, "background.js");
  assert.ok(manifest.optional_permissions?.includes("tabs"));
  assertLocalFile(manifest.background.service_worker, "background service worker");
  const worker = await readFile(path.join(root, manifest.background.service_worker), "utf8");
  assert.match(worker, /chrome\.tabs\.onActivated/);
  assert.match(worker, /chrome\.proxy\.settings\.onChange/);
  assert.match(worker, /resolveTabRoute/);
});

test("all four XEE toolbar state icons are included in the package", () => {
  for (const state of ["clash", "direct", "system", "unknown"]) {
    for (const size of [16, 32]) assertLocalFile(`icons/status/${state}${size}.png`, `${state} toolbar icon`);
  }
});


test("popup brand mark follows the active page route with four distinct XEE silhouettes", async () => {
  const html = await readFile(path.join(root, "src/popup.html"), "utf8");
  const css = await readFile(path.join(root, "src/popup.css"), "utf8");
  const script = await readFile(path.join(root, "src/popup.js"), "utf8");
  assert.match(html, /id="brandMark"/);
  for (const route of ["clash", "direct", "system", "unknown"]) {
    assert.ok(html.includes(`route-shape route-${route}`));
    assert.ok(css.includes(`data-route="${route}"`));
  }
  assert.ok(script.includes("resolveTabRoute(currentTabUrl, proxyStateSnapshot, settings)"));
  assert.ok(css.includes("prefers-reduced-motion: reduce"));
});

test("domain rule changes do not request tabs permission; only the explicit status control does", async () => {
  const script = await readFile(path.join(root, "src/popup.js"), "utf8");
  assert.ok(script.includes('ui.addCurrentDirect.addEventListener("click", () => {'));
  assert.ok(script.includes('ui.addCurrentProxy.addEventListener("click", () => {'));
  assert.ok(script.includes('ui.ruleForm.addEventListener("submit", (event) => {'));
  assert.ok(script.includes('ui.statusPermissionButton.addEventListener("click", () => {'));
  assert.ok(script.includes('chrome.permissions.request({ permissions: ["tabs"] }'));
  assert.doesNotMatch(script, /requestTabsPermissionAndRun|tabsPermissionGranted/);
  const ruleActions = script.slice(script.indexOf('ui.addCurrentDirect.addEventListener'), script.indexOf('ui.includeSubdomains.addEventListener'));
  assert.doesNotMatch(ruleActions, /permissions\.request/);
});

test("domain rule manager supports search and direct subdomain-scope editing", async () => {
  const html = await readFile(path.join(root, "src/popup.html"), "utf8");
  const script = await readFile(path.join(root, "src/popup.js"), "utf8");
  const css = await readFile(path.join(root, "src/popup.css"), "utf8");
  assert.ok(html.includes('id="ruleSearchInput"'));
  assert.ok(html.includes('id="ruleFilterSummary"'));
  assert.ok(script.includes('ui.ruleSearchInput.addEventListener("input"'));
  assert.ok(script.includes("visibleEntries = query"));
  assert.ok(script.includes("async function updateRuleSubdomains("));
  assert.ok(script.includes('scopeInput.addEventListener("change"'));
  assert.ok(css.includes(".rule-item-actions"));
});

test("proxy panel distinguishes browser configuration from local Clash health and refreshes external changes", async () => {
  const html = await readFile(path.join(root, "src/popup.html"), "utf8");
  const script = await readFile(path.join(root, "src/popup.js"), "utf8");
  assert.ok(html.includes("不会探测本机 Clash / Mihomo 服务是否在线"));
  assert.ok(html.includes("保存并应用到 Edge"));
  assert.ok(script.includes('chrome.proxy.settings.onChange.addListener'));
  assert.ok(script.includes('controlled_by_other_extensions: "其他扩展控制"'));
  assert.ok(script.includes("Clash 路由已应用"));
  assert.ok(script.includes("Edge 代理设置由 Alaxee Proxy 控制"));
  assert.ok(script.includes("!['not_controllable', 'controlled_by_other_extensions'].includes(level)"));
  const applyMode = script.slice(script.indexOf("async function applyMode("), script.indexOf("async function addDomainRule("));
  assert.ok(applyMode.indexOf("await saveSettings(next)") < applyMode.indexOf('chrome.proxy.settings, "set"'));
  assert.ok(applyMode.includes("await saveSettings(previousSettings)"));
});

test("toolbar reports unknown rather than the global mode when tabs permission is absent", async () => {
  const worker = await readFile(path.join(root, "background.js"), "utf8");
  assert.ok(worker.includes('await setActionState("unknown")'));
  assert.ok(worker.includes('setActionState("unknown", tab.id)'));
});

test("popup includes overview and separate domain-rule submenus", async () => {
  const html = await readFile(path.join(root, "src/popup.html"), "utf8");
  const script = await readFile(path.join(root, "src/popup.js"), "utf8");
  assert.ok(html.includes('data-view="overview"'));
  assert.ok(html.includes('data-view="rules"'));
  assert.ok(html.includes('id="whitelistTab"'));
  assert.ok(html.includes('id="blacklistTab"'));
  assert.ok(html.includes('id="ruleHostInput"'));
  assert.ok(script.includes('switchRuleType("whitelist")'));
  assert.ok(script.includes("addDomainRule(activeRuleType, host, ui.ruleIncludeSubdomains.checked)"));
  assert.ok(script.includes('activeRuleType = type === "blacklist" ? "blacklist" : "whitelist"'));
});

test("popup uses exact per-page route resolver for the current page status", async () => {
  const script = await readFile(path.join(root, "src/popup.js"), "utf8");
  assert.ok(script.includes("resolveTabRoute(currentTabUrl, proxyStateSnapshot, settings)"));
  assert.ok(script.includes("isHostBlacklisted(currentHostname, settings.blacklist)"));
  assert.ok(script.includes("isHostWhitelisted(currentHostname, settings.whitelist)"));
  assert.ok(script.includes("系统代理模式，规则暂不生效"));
});

test("SOCKS5 is the new-install default while HTTP remains selectable", async () => {
  const core = await readFile(path.join(root, "src/core.js"), "utf8");
  const popup = await readFile(path.join(root, "src/popup.html"), "utf8");
  assert.match(core, /scheme: "socks5"/);
  assert.match(popup, /SOCKS5（推荐：Mixed \/ SOCKS5 端口）/);
  assert.match(popup, /HTTP（Mixed \/ HTTP 端口）/);
});

test("full settings preserve both direct and force-proxy rule lists through the shared controller", async () => {
  const script = await readFile(path.join(root, "src/popup.js"), "utf8");
  assert.ok(script.includes("normalizeBlacklist(raw.blacklist)"));
  assert.ok(script.includes("normalizeWhitelist(raw.whitelist)"));
});

test("unified account auth is limited to the shared Supabase project host", async () => {
  assert.ok(manifest.permissions.includes("proxy"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("alarms"));
  assert.ok(manifest.optional_permissions.includes("tabs"));
  assert.deepEqual(manifest.host_permissions, ["https://kystcwxlqqzgjbdhdmap.supabase.co/*"]);
  const supabaseConfig = await readFile(path.join(root, "src/supabase-config.js"), "utf8");
  assert.ok(supabaseConfig.includes('export const SUPABASE_URL = "https://kystcwxlqqzgjbdhdmap.supabase.co";'));
  assert.match(supabaseConfig, /SUPABASE_PUBLISHABLE_KEY = "sb_publishable_[^"]+"/);
  assert.ok(!manifest.permissions.includes("webRequest"));
  assert.ok(!manifest.permissions.includes("identity"));
  assertLocalFile("src/supabase-auth.js", "Supabase auth module");
  assertLocalFile("src/supabase-config.js", "Supabase browser configuration");
  const worker = await readFile(path.join(root, "background.js"), "utf8");
  assert.match(worker, /ALAXEE_AUTH_SIGN_IN/);
  assert.match(worker, /TRUSTED_CONTEXTS/);
});


test("Edge package includes every background service-worker module", async () => {
  const packager = await readFile(path.join(root, "scripts/package-extension.py"), "utf8");
  for (const modulePath of [
    "src/supabase-auth.js",
    "src/supabase-config.js",
    "src/proxy-rule-sync.js"
  ]) {
    assert.ok(packager.includes(`"${modulePath}"`), `store package omits runtime module: ${modulePath}`);
  }
});
