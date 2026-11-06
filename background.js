import {
  DEFAULT_SETTINGS,
  normalizeBlacklist,
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
  unknown: "Alaxee Proxy · 当前网页状态未知，或代理设置由其他程序控制"
});

const ICON_IMAGE_CACHE = new Map();

/**
 * Draws the approved XEE mark and its state-specific orbital silhouette.
 * The central X and small flare remain identical; the surrounding route shape
 * carries the meaning so the four states remain distinguishable at 16px.
 */
function drawStateIcon(route, size) {
  if (typeof OffscreenCanvas !== "function") {
    throw new Error("OffscreenCanvas is unavailable");
  }

  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2D canvas is unavailable");

  context.scale(size / 48, size / 48);
  context.lineCap = "round";
  context.lineJoin = "round";

  const orbitGradient = context.createLinearGradient(7, 39, 43, 13);
  orbitGradient.addColorStop(0, "#8D8CFF");
  orbitGradient.addColorStop(0.55, "#F2BC9B");
  orbitGradient.addColorStop(1, "#8AE8FF");

  const flowGradient = context.createLinearGradient(7, 39, 44, 7);
  flowGradient.addColorStop(0, "#8D8CFF");
  flowGradient.addColorStop(0.48, "#D99CFF");
  flowGradient.addColorStop(1, "#69DDF2");

  // State-specific silhouettes replace the old one-size-fits-all orbit:
  // Clash = closed orbit + three route nodes.
  if (route === "clash") {
    context.beginPath();
    context.moveTo(7.7, 29.5);
    context.bezierCurveTo(8.5, 17.4, 19.1, 7.4, 31.5, 9.1);
    context.bezierCurveTo(43.8, 10.8, 46.2, 23.9, 39.1, 33.9);
    context.bezierCurveTo(31.6, 44.5, 15.1, 44.6, 8.6, 34.5);
    context.quadraticCurveTo(7.3, 32.7, 7.7, 29.5);
    context.closePath();
    context.strokeStyle = orbitGradient;
    context.lineWidth = 3.65;
    context.stroke();

    const nodes = [
      { x: 8.6, y: 29.7, r: 3.35, fill: "#B9B2FF" },
      { x: 23.9, y: 41.1, r: 3.35, fill: "#E8B6D9" },
      { x: 40.1, y: 18.2, r: 3.45, fill: "#8AE8FF" }
    ];
    for (const node of nodes) {
      context.beginPath();
      context.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      context.fillStyle = node.fill;
      context.fill();
      context.lineWidth = 0.7;
      context.strokeStyle = "#FFF8F5";
      context.stroke();
    }
  }

  // Direct = one clear trajectory that exits through an arrow.
  if (route === "direct") {
    context.beginPath();
    context.moveTo(6.8, 37.1);
    context.bezierCurveTo(14.7, 41.6, 25.8, 39.1, 31.1, 26);
    context.bezierCurveTo(35.5, 15.3, 39.1, 10.5, 44.3, 5.9);
    context.strokeStyle = flowGradient;
    context.lineWidth = 4.2;
    context.stroke();

    context.beginPath();
    context.moveTo(36.8, 6.2);
    context.lineTo(44.1, 5.9);
    context.lineTo(43.9, 13.2);
    context.strokeStyle = "#8AE8FF";
    context.lineWidth = 3.8;
    context.stroke();

    context.beginPath();
    context.arc(7.3, 37.2, 1.65, 0, Math.PI * 2);
    context.fillStyle = "#B9B2FF";
    context.fill();
  }

  // System proxy = a figure-eight, showing two interleaved route lanes.
  if (route === "system") {
    context.beginPath();
    context.moveTo(6, 24);
    context.bezierCurveTo(6, 7, 18, 6, 24, 24);
    context.bezierCurveTo(30, 42, 42, 41, 42, 24);
    context.bezierCurveTo(42, 7, 30, 6, 24, 24);
    context.bezierCurveTo(18, 42, 6, 41, 6, 24);
    context.closePath();
    context.strokeStyle = orbitGradient;
    context.lineWidth = 3.5;
    context.stroke();

    for (const node of [
      { x: 6.2, y: 24, fill: "#B9B2FF" },
      { x: 41.8, y: 24, fill: "#8AE8FF" }
    ]) {
      context.beginPath();
      context.arc(node.x, node.y, 2.55, 0, Math.PI * 2);
      context.fillStyle = node.fill;
      context.fill();
      context.lineWidth = 0.65;
      context.strokeStyle = "#F8F1FF";
      context.stroke();
    }
  }

  // Unknown/conflict = interrupted orbital fragments and a clear warning marker.
  if (route === "unknown") {
    context.strokeStyle = orbitGradient;
    context.lineWidth = 3.1;

    context.beginPath();
    context.moveTo(7.5, 29.5);
    context.bezierCurveTo(7, 21.1, 13.6, 11.8, 23, 8.8);
    context.stroke();

    context.beginPath();
    context.moveTo(31.3, 8.8);
    context.bezierCurveTo(38.1, 11.1, 41.8, 16.9, 41.5, 23.5);
    context.stroke();

    context.beginPath();
    context.moveTo(39.5, 30.2);
    context.bezierCurveTo(35.6, 37.7, 27.2, 42.2, 18.8, 40.3);
    context.stroke();

    context.beginPath();
    context.moveTo(11.3, 37.1);
    context.quadraticCurveTo(8.5, 34.7, 7.6, 31);
    context.stroke();

    context.beginPath();
    context.moveTo(26.6, 5.5);
    context.lineTo(30.7, 9.6);
    context.lineTo(26.6, 13.7);
    context.lineTo(22.5, 9.6);
    context.closePath();
    context.fillStyle = "#FFD18C";
    context.fill();
    context.lineWidth = 0.8;
    context.strokeStyle = "#FFF0D5";
    context.stroke();

    context.beginPath();
    context.arc(26.6, 9.6, 6.2, 0, Math.PI * 2);
    context.strokeStyle = "rgba(255, 209, 140, 0.25)";
    context.lineWidth = 1.1;
    context.stroke();
  }

  // The approved ALAXEE XEE crossing mark, kept geometrically unchanged.
  const xeeGradient = context.createLinearGradient(9, 9, 41, 40);
  xeeGradient.addColorStop(0, "#FFD88A");
  xeeGradient.addColorStop(0.48, "#D99CFF");
  xeeGradient.addColorStop(1, "#69DDF2");

  context.beginPath();
  context.moveTo(13, 12.5);
  context.lineTo(35, 35.5);
  context.moveTo(35, 12.5);
  context.lineTo(13, 35.5);
  context.strokeStyle = xeeGradient;
  context.lineWidth = 5.1;
  context.stroke();

  // The original upper-right star flare and left glint complete the logo family.
  context.beginPath();
  context.moveTo(37.2, 7.2);
  context.lineTo(37.2, 13.3);
  context.moveTo(34.15, 10.25);
  context.lineTo(40.25, 10.25);
  context.strokeStyle = "#FFE5B6";
  context.lineWidth = 1.25;
  context.stroke();

  context.beginPath();
  context.arc(37.2, 10.25, 1.7, 0, Math.PI * 2);
  context.fillStyle = "#FFF8E9";
  context.fill();

  context.beginPath();
  context.moveTo(7.5, 13.2);
  context.bezierCurveTo(8.9, 11.2, 10.7, 10.05, 12.95, 9.5);
  context.strokeStyle = "rgba(158, 219, 239, 0.72)";
  context.lineWidth = 1.25;
  context.stroke();

  return context.getImageData(0, 0, size, size);
}

function getStateIconImageData(route) {
  const safeRoute = ICON_PATHS[route] ? route : "unknown";
  if (!ICON_IMAGE_CACHE.has(safeRoute)) {
    try {
      ICON_IMAGE_CACHE.set(safeRoute, {
        16: drawStateIcon(safeRoute, 16),
        32: drawStateIcon(safeRoute, 32)
      });
    } catch {
      // The existing PNGs remain a safe fallback on older/limited runtimes.
      ICON_IMAGE_CACHE.set(safeRoute, null);
    }
  }
  return ICON_IMAGE_CACHE.get(safeRoute);
}

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
    whitelist: normalizeWhitelist(raw.whitelist),
    blacklist: normalizeBlacklist(raw.blacklist)
  };
  return { settings, proxyState };
}

async function setActionState(route, tabId) {
  const safeRoute = ICON_PATHS[route] ? route : "unknown";
  const target = tabId == null ? {} : { tabId };
  const imageData = getStateIconImageData(safeRoute);
  const icon = imageData ? { imageData } : { path: ICON_PATHS[safeRoute] };
  await chromeCall(chrome.action, "setIcon", { ...icon, ...target });
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
  const hasPermission = await hasTabsPermission();
  const tabs = await chromeCall(chrome.tabs, "query", {});

  if (!hasPermission) {
    // Never present the global mode as though it were the active page's route.
    // Unknown is the only truthful per-page state until URL access is granted.
    await setActionState("unknown");
    await Promise.all((tabs ?? [])
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) => setActionState("unknown", tab.id)));
    return;
  }

  const globalRoute = resolveGlobalRoute(runtime.proxyState, runtime.settings);
  await setActionState(globalRoute);
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
