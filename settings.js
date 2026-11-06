import { DEFAULT_SETTINGS, buildChromeProxyConfig, normalizeBlacklist, normalizeWhitelist, validateProxySettings } from "./src/core.js";

const $ = (id) => document.getElementById(id);
const ui = { scheme: $("schemeInput"), host: $("hostInput"), port: $("portInput"), form: $("settingsForm"), save: $("saveButton"), notice: $("notice"), close: $("closeSettingsButton") };
let settings = { ...DEFAULT_SETTINGS, whitelist: [], blacklist: [] };

function call(target, method, ...args) {
  return new Promise((resolve, reject) => target[method](...args, (result) => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve(result);
  }));
}
function notify(message, kind = "success") {
  ui.notice.textContent = message;
  ui.notice.className = `notice notice-${kind}`;
  ui.notice.hidden = false;
}
async function load() {
  const stored = await call(chrome.storage.local, "get", "settings");
  const raw = stored?.settings ?? {};
  settings = { ...DEFAULT_SETTINGS, ...raw, whitelist: normalizeWhitelist(raw.whitelist), blacklist: normalizeBlacklist(raw.blacklist) };
  ui.scheme.value = settings.scheme;
  ui.host.value = settings.host;
  ui.port.value = settings.port;
}
async function persist(next) {
  settings = { ...settings, ...next, whitelist: normalizeWhitelist(next.whitelist ?? settings.whitelist), blacklist: normalizeBlacklist(next.blacklist ?? settings.blacklist) };
  await call(chrome.storage.local, "set", { settings });
}
async function readProxyControl() {
  return call(chrome.proxy.settings, "get", { incognito: false });
}
async function saveOnly() {
  const endpoint = validateProxySettings({ scheme: ui.scheme.value, host: ui.host.value, port: ui.port.value });
  await persist(endpoint);
  notify("设置已保存在本机。当前 Edge 代理模式没有改变。", "success");
}
async function saveAndConnect(event) {
  event?.preventDefault();
  const endpoint = validateProxySettings({ scheme: ui.scheme.value, host: ui.host.value, port: ui.port.value });
  const next = { ...settings, ...endpoint, mode: "clash" };
  const current = await readProxyControl();
  if (current?.levelOfControl === "not_controllable" || current?.levelOfControl === "controlled_by_other_extensions") {
    throw new Error("Edge 代理设置正由其他扩展或管理策略控制。请先关闭冲突的代理扩展。 ");
  }
  const proxyConfig = buildChromeProxyConfig(next);
  await call(chrome.proxy.settings, "set", { value: proxyConfig, scope: "regular" });
  await persist(next);
  notify("Clash 地址和端口已保存，Edge 代理设置已应用。请再确认 Clash 正在运行且端口一致。", "success");
}

ui.close.addEventListener("click", async () => {
  try {
    const currentTab = await call(chrome.tabs, "getCurrent");
    if (currentTab?.id == null) throw new Error("无法识别当前设置标签页");
    await call(chrome.tabs, "remove", currentTab.id);
  } catch (error) {
    notify(`无法自动关闭设置页：${error.message}。请手动关闭此标签页，再点击 Edge 工具栏中的 Alaxee Proxy 图标。`, "error");
  }
});

ui.save.addEventListener("click", async () => {
  try { await saveOnly(); } catch (error) { notify(`保存失败：${error.message}`, "error"); }
});
ui.form.addEventListener("submit", async (event) => {
  try { await saveAndConnect(event); } catch (error) { notify(`应用失败：${error.message}`, "error"); }
});
load().catch((error) => notify(`读取设置失败：${error.message}`, "error"));
