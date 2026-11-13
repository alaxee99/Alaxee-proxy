import { createSupabaseAuthService } from "./src/supabase-auth.js";
import {
  createProxyRuleSyncService,
  PROXY_RULE_SYNC_BINDING_KEY
} from "./src/proxy-rule-sync.js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./src/supabase-config.js";

import {
  DEFAULT_SETTINGS,
  buildChromeProxyConfig,
  mergeConcurrentSettings,
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
  if (typeof OffscreenCanvas !== "function") throw new Error("OffscreenCanvas is unavailable");
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2D canvas is unavailable");
  context.translate(size / 2, size / 2);
  context.scale((size / 64) * 1.12, (size / 64) * 1.12);
  context.translate(-32, -32);
  context.lineCap = "round"; context.lineJoin = "round";
  const orbit = context.createLinearGradient(7, 54, 57, 9);
  orbit.addColorStop(0, "#908BFF"); orbit.addColorStop(.52, "#D7A7E8"); orbit.addColorStop(1, "#77E2F3");
  const flow = context.createLinearGradient(8, 51, 56, 9);
  flow.addColorStop(0, "#958CFF"); flow.addColorStop(.55, "#C7A0FF"); flow.addColorStop(1, "#70E2F3");
  if (route === "clash") {
    context.beginPath(); context.moveTo(9,39); context.bezierCurveTo(10.2,22.5,22,9.5,37.5,11.5);
    context.bezierCurveTo(52.2,13.4,59.3,27,52,40.4); context.bezierCurveTo(44.8,53.3,24.6,56.2,12.8,45.3);
    context.strokeStyle=orbit; context.lineWidth=4.2; context.stroke();
    for (const node of [{x:9.5,y:39,fill:"#AFA7FF"},{x:32,y:53,fill:"#D4A8EF"},{x:54,y:25,fill:"#78DFF2"}]) {
      context.beginPath(); context.arc(node.x,node.y,3.2,0,Math.PI*2); context.fillStyle=node.fill; context.fill();
      context.strokeStyle="#F5F2FF"; context.lineWidth=1; context.stroke();
    }
  } else if (route === "direct") {
    context.beginPath(); context.moveTo(9,50); context.bezierCurveTo(20,54,29,48,36,33); context.bezierCurveTo(41,23,47,16,56,9);
    context.strokeStyle=flow; context.lineWidth=4.5; context.stroke();
    context.beginPath(); context.moveTo(46.5,9.5); context.lineTo(56,9); context.lineTo(56,19);
    context.strokeStyle="#82E6F7"; context.lineWidth=4; context.stroke();
    context.beginPath(); context.arc(9.5,50,2.4,0,Math.PI*2); context.fillStyle="#B8B0FF"; context.fill();
  } else if (route === "system") {
    context.beginPath(); context.moveTo(7,32); context.bezierCurveTo(7,15,23,14,32,32); context.bezierCurveTo(41,50,57,49,57,32);
    context.bezierCurveTo(57,15,41,14,32,32); context.bezierCurveTo(23,50,7,49,7,32);
    context.strokeStyle=orbit; context.lineWidth=4.1; context.stroke();
    for (const node of [{x:7.5,fill:"#B8B0FF"},{x:56.5,fill:"#82E6F7"}]) {
      context.beginPath(); context.arc(node.x,32,3,0,Math.PI*2); context.fillStyle=node.fill; context.fill();
      context.strokeStyle="#F5F2FF"; context.lineWidth=.8; context.stroke();
    }
  } else {
    context.strokeStyle=orbit; context.lineWidth=4;
    const segments=[
      ()=>{context.moveTo(9,39);context.bezierCurveTo(8.5,29,14,19,23,14);},
      ()=>{context.moveTo(40,12.5);context.bezierCurveTo(50,16,56,25,55,34);},
      ()=>{context.moveTo(51,44);context.bezierCurveTo(42,54,29,57,19,51);},
      ()=>{context.moveTo(11.5,46.5);context.lineTo(9,42);}
    ];
    for(const segment of segments){context.beginPath();segment();context.stroke();}
    context.beginPath();context.arc(32,11,7,0,Math.PI*2);context.fillStyle="rgba(243,179,108,.16)";context.fill();
    context.beginPath();context.moveTo(32,6.2);context.lineTo(36.8,11);context.lineTo(32,15.8);context.lineTo(27.2,11);context.closePath();
    context.fillStyle="#FFD18C";context.fill();context.strokeStyle="#FFF0D5";context.lineWidth=1;context.stroke();
  }
  const core=context.createLinearGradient(12,11,53,52);
  core.addColorStop(0,"#FFE0A0");core.addColorStop(.42,"#C59BFF");core.addColorStop(1,"#67DFF2");
  context.beginPath();context.moveTo(15,50);context.bezierCurveTo(21.5,33,28.5,14,32.5,12);context.bezierCurveTo(36.5,14,43.5,33,50,50);
  context.strokeStyle=core;context.lineWidth=6.2;context.stroke();
  context.beginPath();context.moveTo(21.5,36);context.bezierCurveTo(29,32.4,37.5,32.4,45,36);context.strokeStyle=core;context.lineWidth=4.6;context.stroke();
  context.beginPath();context.moveTo(48,8.5);context.lineTo(48,16.5);context.moveTo(44,12.5);context.lineTo(52,12.5);
  context.strokeStyle="#FFE6BC";context.lineWidth=1.5;context.stroke();
  context.beginPath();context.arc(48,12.5,2,0,Math.PI*2);context.fillStyle="#FFF8E9";context.fill();
  context.beginPath();context.moveTo(10.5,18.5);context.bezierCurveTo(12,16,14,14,16.6,12.8);
  context.strokeStyle="rgba(145,223,242,.82)";context.lineWidth=1.5;context.stroke();
  return context.getImageData(0,0,size,size);
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

let proxySettingsMutationQueue = Promise.resolve();

function serializeProxySettingsMutation(operation) {
  const result = proxySettingsMutationQueue.then(operation, operation);
  proxySettingsMutationQueue = result.catch(() => {});
  return result;
}

async function readStoredProxySettings() {
  const stored = await chromeCall(chrome.storage.local, "get", "settings");
  const raw = stored?.settings ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    whitelist: normalizeWhitelist(raw.whitelist),
    blacklist: normalizeBlacklist(raw.blacklist)
  };
}

function describeSettingsConflicts(conflicts) {
  const labels = {
    mode: "代理模式",
    host: "代理地址",
    port: "代理端口",
    scheme: "代理协议",
    includeSubdomains: "默认子域名选项"
  };
  return conflicts.map((key) => key.startsWith("rule:")
    ? `域名规则 ${key.slice(5)}`
    : (labels[key] ?? key)).join("、");
}

async function mutateProxySettings(message) {
  return serializeProxySettingsMutation(async () => {
    const baseSettings = message?.baseSettings;
    const proposedSettings = message?.proposedSettings;
    if (!baseSettings || !proposedSettings ||
        typeof baseSettings !== "object" || typeof proposedSettings !== "object") {
      throw new Error("代理设置更新请求无效；请刷新设置页面后重试。");
    }

    const previousSettings = await readStoredProxySettings();
    const merged = mergeConcurrentSettings({
      currentSettings: previousSettings,
      baseSettings,
      proposedSettings
    });
    if (merged.conflicts.length) {
      throw new Error(
        `设置已在另一个页面发生变化，本次操作未覆盖冲突内容（${describeSettingsConflicts(merged.conflicts)}）。请重新检查当前设置后重试。`
      );
    }

    const applyProxy = message.type === "ALAXEE_PROXY_SETTINGS_APPLY";
    const proxyConfig = applyProxy ? buildChromeProxyConfig(merged.settings) : null;
    await chromeCall(chrome.storage.local, "set", { settings: merged.settings });

    if (applyProxy) {
      try {
        await chromeCall(chrome.proxy.settings, "set", {
          value: proxyConfig,
          scope: "regular"
        });
      } catch (applyError) {
        try {
          // All popup-originated settings writes are serialized through this worker queue.
          await chromeCall(chrome.storage.local, "set", { settings: previousSettings });
        } catch (rollbackError) {
          throw new Error(
            `Edge 拒绝了代理设置；后台也无法恢复此前的本机设置：${rollbackError.message}`
          );
        }
        throw new Error(`Edge 未能应用代理设置，已恢复此前的本机设置：${applyError.message}`);
      }
    }

    return {
      previousSettings,
      settings: merged.settings,
      applied: applyProxy
    };
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
const PROXY_RULE_SYNC_RETRY_ALARM = "alaxeeProxyRuleSync.v1.retry";
const PROXY_RULE_SYNC_RETRY_MINUTES = 15;
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
  await maintainRuleSyncAlarm();
  return { ...status, enabled: true, backendReady: true };
}


async function syncEnabledRuleAccount() {
  if (!PROXY_RULE_SYNC_BACKEND_READY) return { skipped: "backend_not_ready" };
  const session = await supabaseAuth.getSession();
  const userId = session?.user?.id;
  if (!userId) return { skipped: "signed_out" };

  const [enabledUserId, boundUserId] = await Promise.all([
    readLocalValue(PROXY_RULE_SYNC_ENABLED_KEY),
    readLocalValue(PROXY_RULE_SYNC_BINDING_KEY)
  ]);
  if (enabledUserId !== userId || (boundUserId && boundUserId !== userId)) {
    return { skipped: "account_not_enabled_or_binding_mismatch" };
  }

  const { service } = await createRuleSyncContext();
  return service.sync();
}

async function maintainRuleSyncAlarm() {
  const alarms = chrome.alarms;
  if (!alarms) return;
  if (!PROXY_RULE_SYNC_BACKEND_READY) {
    await chromeCall(alarms, "clear", PROXY_RULE_SYNC_RETRY_ALARM).catch(() => false);
    return;
  }

  const session = await supabaseAuth.getSession();
  const userId = session?.user?.id;
  const enabledUserId = userId ? await readLocalValue(PROXY_RULE_SYNC_ENABLED_KEY) : null;
  if (!userId || enabledUserId !== userId) {
    await chromeCall(alarms, "clear", PROXY_RULE_SYNC_RETRY_ALARM).catch(() => false);
    return;
  }
  alarms.create(PROXY_RULE_SYNC_RETRY_ALARM, { periodInMinutes: PROXY_RULE_SYNC_RETRY_MINUTES });
}

async function resumeRuleSyncLifecycle() {
  try {
    await maintainRuleSyncAlarm();
    await syncEnabledRuleAccount();
  } catch (error) {
    console.warn("Alaxee Proxy rule sync recovery deferred:", error?.message ?? error);
  }
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
  if (status.bootstrapped && status.pendingCount > 0) await service.sync();
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

  if (message?.type === "ALAXEE_PROXY_SETTINGS_SAVE" ||
      message?.type === "ALAXEE_PROXY_SETTINGS_APPLY") {
    mutateProxySettings(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message ?? "proxy_settings_update_failed" }));
    return true;
  }
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
      .then(async (user) => {
        await resumeRuleSyncLifecycle();
        sendResponse({ ok: true, user });
      })
      .catch((error) => sendResponse({ ok: false, error: error?.message ?? "auth_sign_in_failed" }));
    return true;
  }
  if (message?.type === "ALAXEE_AUTH_SIGN_OUT") {
    supabaseAuth.signOut()
      .then(async (result) => {
        await maintainRuleSyncAlarm();
        sendResponse({ ok: true, remoteRevoked: result.remoteRevoked });
      })
      .catch((error) => sendResponse({ ok: false, error: error?.message ?? "auth_sign_out_failed" }));
    return true;
  }
  if (message?.type !== "SYNC_ALL_TABS") return;
  refreshAllTabs()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error?.message ?? "sync_failed" }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  refreshAllSafely();
  void resumeRuleSyncLifecycle();
});
chrome.runtime.onStartup.addListener(() => {
  refreshAllSafely();
  void resumeRuleSyncLifecycle();
});
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm?.name !== PROXY_RULE_SYNC_RETRY_ALARM) return;
  void syncEnabledRuleAccount().catch((error) => {
    console.warn("Alaxee Proxy scheduled rule sync deferred:", error?.message ?? error);
  });
});

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
void resumeRuleSyncLifecycle();
