import {
  DEFAULT_SETTINGS,
  normalizeWhitelist,
  resolveGlobalRoute,
  resolveTabRoute
} from "./src/core.js";

const ICON_PATHS = Object.freeze({
  clash: { 16: "icons/status/clash16.png", 32: "icons/status/clash32.png" },
  direct: { 16: "icons/status/direct16.png", 32: "icons/status/direct32.png" },
  system: { 16: "icons/status/system16.png", 32: "icons/status/system32.png" },
  unknown: { 16: "icons/status/unknown16.png", 32: "icons/status/unknown32.png" }
});

const ICON_TITLES = Object.freeze({
  clash: "Alaxee Proxy · 此网页交由 Clash 处理",
  direct: "Alaxee Proxy · 此网页浏览器直连",
  system: "Alaxee Proxy · 此网页跟随系统代理",
  unknown: "Alaxee Proxy · 代理状态未知或由其他程序控制"
});

function chromeCall(target, method, ...args) {
  return new Promise((resolve, reject) => {
    try {
      target[method](...args, (result) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function readContext() {
  const [stored, proxyState] = await Promise.all([
    chromeCall(chrome.storage.local, "get", "settings"),
    chromeCall(chrome.proxy.settings, "get", { incognito: false })
  ]);
  const raw = stored?.settings ?? {};
  const settings = {
    ...DEFAULT_SETTINGS,
    ...raw,
    whitelist: normalizeWhitelist(raw.whitelist)
  };
  return { settings, proxyState };
}

async function setActionState(route, tabId) {
  const safeRoute = ICON_PATHS[route] ? route : "unknown";
  const target = tabId == null ? {} : { tabId };
  await chromeCall(chrome.action, "setIcon", { path: ICON_PATHS[safeRoute], ...target });
  await chromeCall(chrome.action, "setTitle", { title: ICON_TITLES[safeRoute], ...target });
}

async function refreshTab(tabId, context) {
  if (!Number.isInteger(tabId)) return;
  const runtime = context ?? await readContext();
  const tab = await chromeCall(chrome.tabs, "get", tabId).catch(() => null);
  const route = resolveTabRoute(tab?.url ?? "", runtime.proxyState, runtime.settings);
  await setActionState(route, tabId);
}

async function hasTabsPermission() {
  return chromeCall(chrome.permissions, "contains", { permissions: ["tabs"] });
}

async function refreshAllTabs() {
  const runtime = await readContext();
  const globalRoute = resolveGlobalRoute(runtime.proxyState, runtime.settings);
  await setActionState(globalRoute);

  const hasPermission = await hasTabsPermission();
  if (!hasPermission) return;

  const tabs = await chromeCall(chrome.tabs, "query", {});
  await Promise.all((tabs ?? [])
    .filter((tab) => Number.isInteger(tab.id))
    .map((tab) => {
      const route = resolveTabRoute(tab.url ?? "", runtime.proxyState, runtime.settings);
      return setActionState(route, tab.id);
    }));
}

function refreshAllSafely() {
  void refreshAllTabs().catch((error) => {
    // Keep the extension silent in the background; the popup reports user-facing failures.
    console.warn("Alaxee Proxy status refresh failed:", error?.message ?? error);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== "SYNC_ALL_TABS") return;
  refreshAllTabs()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error?.message ?? "sync_failed" }));
  return true;
});

chrome.runtime.onInstalled.addListener(refreshAllSafely);
chrome.runtime.onStartup.addListener(refreshAllSafely);

chrome.proxy.settings.onChange.addListener(refreshAllSafely);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.settings) refreshAllSafely();
});

chrome.permissions.onAdded.addListener(refreshAllSafely);
chrome.permissions.onRemoved.addListener(refreshAllSafely);

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void hasTabsPermission()
    .then((granted) => granted && refreshTab(tabId))
    .catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url && changeInfo.status !== "complete") return;
  void hasTabsPermission()
    .then((granted) => granted && refreshTab(tabId))
    .catch(() => {});
});

refreshAllSafely();
