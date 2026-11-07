import { createSupabaseAuthService } from "./src/supabase-auth.js";
import {
  createProxyRuleSyncService,
  PROXY_RULE_SYNC_BINDING_KEY
} from "./src/proxy-rule-sync.js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./src/supabase-config.js";

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

  // Chromium's toolbar action button is fixed at 16 DIP. The previous
  // artwork occupied too little of that canvas, making the icon look inset
  // beside neighboring extensions. Zoom the complete mark around its center
  // so the orbit reaches close to the canvas edge without clipping.
  context.translate(size / 2, size / 2);
  context.scale((size / 48) * 1.16, (size / 48) * 1.16);
  context.translate(-24, -24);
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

const supabaseAuth = createSupabaseAuthService({
  supabaseUrl: SUPABASE_URL,
  publishableKey: SUPABASE_PUBLISHABLE_KEY,
  storage: {
    get: (key) => chromeCall(chrome.storage.local, "get", key),
    set: (value) => chromeCall(chrome.storage.local, "set", value),
    remove: (key) => chromeCall(chrome.storage.local, "remove", key)
  }

});

const PROXY_RULE_SYNC_ENABLED_KEY = "alaxeeProxyRuleSync.v1.enabledUserId";
// The migration exists on the feature branch, but production has not been changed.
// Keep all network sync disabled until the user separately approves that rollout.
const PROXY_RULE_SYNC_BACKEND_READY = false;

async function readLocalValue(key) {
  const stored = await chromeCall(chrome.storage.local, "get", key);
  return stored?.[key] ?? null;
}

async function createRuleSyncContext() {
  const session = await supabaseAuth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("请先登录 ALAXEE 账户。");

  const service = createProxyRuleSyncService({
    userId,
    storage: {
      get: (key) => readLocalValue(key),
      set: (key, value) => chromeCall(chrome.storage.local, "set", { [key]: value })
    },
    request: (path, options) => supabaseAuth.requestWithSession(path, options),
    getCurrentUserId: async () => {
      const current = await supabaseAuth.getSession();
      return current?.user?.id ?? "";
    },
    getLocalSettings: async () => {
      const stored = await chromeCall(chrome.storage.local, "get", "settings");
      return stored?.settings ?? {};
    },
    saveLocalSettings: async (nextSettings) => {
      const stored = await chromeCall(chrome.storage.local, "get", "settings");
      await chromeCall(chrome.storage.local, "set", {
        settings: { ...(stored?.settings ?? {}), ...nextSettings }
      });
    }
  });

  return { userId, service };
}

async function getRuleSyncSnapshot() {
  const session = await supabaseAuth.getSession();
  if (!session?.user?.id) {
    return {
      signedIn: false,
      backendReady: PROXY_RULE_SYNC_BACKEND_READY,
      enabled: false,
      pendingCount: 0,
      accountBindingConflict: false
    };
  }

  const userId = session.user.id;
  const [enabledUserId, boundUserId] = await Promise.all([
    readLocalValue(PROXY_RULE_SYNC_ENABLED_KEY),
    readLocalValue(PROXY_RULE_SYNC_BINDING_KEY)
  ]);
  const accountBindingConflict = Boolean(boundUserId && boundUserId !== userId);
  const { service } = await createRuleSyncContext();
  const status = await service.getStatus();
  return {
    signedIn: true,
    userId,
    backendReady: PROXY_RULE_SYNC_BACKEND_READY,
    enabled: enabledUserId === userId,
    accountBindingConflict,
    ...status
  };
}

async function enableRuleCloudSync() {
  if (!PROXY_RULE_SYNC_BACKEND_READY) {
    throw new Error("域名规则云端存储尚未开放。数据库迁移仍在开发分支，生产数据库没有变更。");
  }
  const { userId, service } = await createRuleSyncContext();
  const existingBinding = await readLocalValue(PROXY_RULE_SYNC_BINDING_KEY);
  if (existingBinding && existingBinding !== userId) {
    throw new Error("此 Edge 配置已绑定其他 ALAXEE 账号。为防止跨账号上传，云同步已停止。");
  }
  const status = await service.sync();
  await chromeCall(chrome.storage.local, "set", { [PROXY_RULE_SYNC_ENABLED_KEY]: userId });
  return { ...status, enabled: true, backendReady: true };
}

async function syncRuleCloudNow() {
  if (!PROXY_RULE_SYNC_BACKEND_READY) {
    throw new Error("域名规则云端存储尚未开放，当前不会向 Supabase 上传或下载规则。");
  }
  const { userId, service } = await createRuleSyncContext();
  const enabledUserId = await readLocalValue(PROXY_RULE_SYNC_ENABLED_KEY);
  if (enabledUserId !== userId) throw new Error("请先在当前 ALAXEE 账号下启用域名规则云同步。");
  return { ...(await service.sync()), enabled: true, backendReady: true };
}

async function enqueueLocalRuleChanges(operations) {
  if (!PROXY_RULE_SYNC_BACKEND_READY) return { queued: false, backendReady: false };
  if (!Array.isArray(operations) || operations.length > 100) {
    throw new Error("本次域名规则变更数量无效，已停止云同步。");
  }
  const session = await supabaseAuth.getSession();
  if (!session?.user?.id) return { queued: false, signedIn: false };
  const enabledUserId = await readLocalValue(PROXY_RULE_SYNC_ENABLED_KEY);
  if (enabledUserId !== session.user.id) return { queued: false, enabled: false };

  const { service, userId } = await createRuleSyncContext();
  for (const operation of operations) {
    if (!operation || typeof operation.host !== "string" ||
        !["whitelist", "blacklist"].includes(operation.ruleType) ||
        typeof operation.isDeleted !== "boolean") {
      throw new Error("收到无效的 Proxy 域名规则同步操作。");
    }
    await service.enqueueRule(operation);
  }
  const status = await service.getStatus();
  if (status.bootstrapped && status.pendingCount > 0) await service.flushOutbox();
  return { queued: true, userId, ...(await service.getStatus()) };
}

// Keep rotating Auth tokens available only to trusted extension contexts.
try {
  const accessLevelUpdate = chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  accessLevelUpdate?.catch?.(() => {});
} catch {
  // Older Chromium builds may not expose this optional API.
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  if (message?.type === "ALAXEE_PROXY_RULE_SYNC_STATUS") {
    getRuleSyncSnapshot()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) => sendResponse({ ok: false, error: error?.message ?? "proxy_rule_sync_status_failed" }));
    return true;
  }
  if (message?.type === "ALAXEE_PROXY_RULE_SYNC_ENABLE") {
    enableRuleCloudSync()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) => sendResponse({ ok: false, error: error?.message ?? "proxy_rule_sync_enable_failed" }));
    return true;
  }
  if (message?.type === "ALAXEE_PROXY_RULE_SYNC_NOW") {
    syncRuleCloudNow()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) => sendResponse({ ok: false, error: error?.message ?? "proxy_rule_sync_failed" }));
    return true;
  }
  if (message?.type === "ALAXEE_PROXY_RULE_SYNC_ENQUEUE") {
    enqueueLocalRuleChanges(message.operations)
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) => sendResponse({ ok: false, error: error?.message ?? "proxy_rule_sync_enqueue_failed" }));
    return true;
  }
  if (message?.type === "ALAXEE_AUTH_GET_SESSION") {
    supabaseAuth.getSession()
      .then((session) => sendResponse({ ok: true, user: session?.user ?? null }))
      .catch((error) => sendResponse({ ok: false, error: error?.message ?? "auth_session_failed" }));
    return true;
  }
  if (message?.type === "ALAXEE_AUTH_SIGN_IN") {
    supabaseAuth.signInWithPassword({ email: message.email, password: message.password })
      .then((user) => sendResponse({ ok: true, user }))
      .catch((error) => sendResponse({ ok: false, error: error?.message ?? "auth_sign_in_failed" }));
    return true;
  }
  if (message?.type === "ALAXEE_AUTH_SIGN_OUT") {
    supabaseAuth.signOut()
      .then((result) => sendResponse({ ok: true, remoteRevoked: result.remoteRevoked }))
      .catch((error) => sendResponse({ ok: false, error: error?.message ?? "auth_sign_out_failed" }));
    return true;
  }
  if (message?.type !== "SYNC_ALL_TABS") return;
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
