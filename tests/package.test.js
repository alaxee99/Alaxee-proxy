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


test("settings page closes its tab instead of navigating to the popup document", async () => {
  const html = await readFile(path.join(root, manifest.options_ui.page), "utf8");
  assert.match(html, /id="closeSettingsButton"/);
  assert.doesNotMatch(html, /href=["']src\/popup\.html["']/);
  const script = await readFile(path.join(root, "settings.js"), "utf8");
  assert.match(script, /chrome\.tabs, "getCurrent"/);
  assert.match(script, /chrome\.tabs, "remove"/);
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

test("adding a whitelist entry requests optional per-tab URL permission", async () => {
  const script = await readFile(path.join(root, "src/popup.js"), "utf8");
  assert.ok(script.includes('ui.addCurrent.addEventListener("click", () => {'));
  assert.ok(script.includes('chrome.permissions.request({ permissions: ["tabs"] }'));
  assert.ok(script.includes("tabsPermissionGranted === false"));
  assert.ok(script.includes("启用逐网页显示"));
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
  assert.ok(script.includes('addDomainRule("blacklist"'));
});

test("popup uses exact per-page route resolver for the current page status", async () => {
  const script = await readFile(path.join(root, "src/popup.js"), "utf8");
  assert.ok(script.includes("resolveTabRoute(currentTabUrl, proxyStateSnapshot, settings)"));
  assert.ok(script.includes("isHostBlacklisted(currentHostname, settings.blacklist)"));
  assert.ok(script.includes("isHostWhitelisted(currentHostname, settings.whitelist)"));
  assert.ok(script.includes("系统代理模式，规则暂不生效"));
});

test("advanced settings preserve both direct and force-proxy rule lists", async () => {
  const script = await readFile(path.join(root, "settings.js"), "utf8");
  assert.ok(script.includes("normalizeBlacklist(raw.blacklist)"));
  assert.ok(script.includes("normalizeWhitelist(raw.whitelist)"));
});

test("proxy domain rules remain local-only and add no network permissions", () => {
  assert.ok(manifest.permissions.includes("proxy"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.optional_permissions.includes("tabs"));
  assert.ok(!manifest.permissions.includes("webRequest"));
  assert.ok(!manifest.permissions.includes("identity"));
});
