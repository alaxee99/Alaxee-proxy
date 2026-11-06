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

test("Edge Add-ons release workflow is tag-triggered and uses repository secrets", async () => {
  const workflow = await readFile(path.join(root, ".github/workflows/publish-edge-addons.yml"), "utf8");
  assert.ok(workflow.includes('tags:\n      - "v*"'));
  assert.match(workflow, /EDGE_ADDONS_PRODUCT_ID/);
  assert.match(workflow, /EDGE_ADDONS_CLIENT_ID/);
  assert.match(workflow, /EDGE_ADDONS_API_KEY/);
  assert.match(workflow, /publish-edge-addons\.mjs/);
});
