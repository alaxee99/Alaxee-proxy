import {
  DEFAULT_SETTINGS,
  buildChromeProxyConfig,
  createWhitelistEntry,
  describeProxyMode,
  getPageHostname,
  inferActiveMode,
  isHostWhitelisted,
  normalizeWhitelist,
  resolveTabRoute,
  validateProxySettings
} from "./core.js";

const $ = (id) => document.getElementById(id);
const ui = {
  statePill: $("statePill"),
  stateText: $("stateText"),
  modeHelp: $("modeHelp"),
  scheme: $("schemeInput"),
  host: $("hostInput"),
  port: $("portInput"),
  saveConnect: $("saveConnectButton"),
  currentHost: $("currentHost"),
  currentRoute: $("currentRoute"),
  routePill: $("siteRoutePill"),
  includeSubdomains: $("includeSubdomainsInput"),
  addCurrent: $("addCurrentButton"),
  removeCurrent: $("removeCurrentButton"),
  siteHint: $("siteHint"),
  list: $("whitelistList"),
  empty: $("whitelistEmpty"),
  count: $("listCount"),
  clearList: $("clearListButton"),
  notice: $("notice"),
  openSettings: $("openSettingsButton"),
  statusPermissionButton: $("statusPermissionButton"),
  statusPermissionHint: $("statusPermissionHint"),
  brandMark: $("brandMark")
};

let settings = { ...DEFAULT_SETTINGS, whitelist: [] };
let currentHostname = null;
let currentTabUrl = "";
let proxyStateSnapshot = null;
let activeMode = "clash";
let noticeTimer = null;

function sendNotice(message, kind = "success") {
  clearTimeout(noticeTimer);
  ui.notice.textContent = message;
  ui.notice.className = `notice notice-${kind}`;
  ui.notice.hidden = false;
  noticeTimer = setTimeout(() => { ui.notice.hidden = true; }, 4200);
}

function chromeCall(target, method, ...args) {
  return new Promise((resolve, reject) => {
    target[method](...args, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

async function loadSettings() {
  const stored = await chromeCall(chrome.storage.local, "get", "settings");
  const raw = stored?.settings ?? {};
  settings = {
    ...DEFAULT_SETTINGS,
    ...raw,
    whitelist: normalizeWhitelist(raw.whitelist)
  };
  activeMode = ["clash", "direct", "system"].includes(settings.mode) ? settings.mode : "clash";
  ui.host.value = settings.host;
  ui.port.value = settings.port;
  ui.scheme.value = settings.scheme;
  ui.includeSubdomains.checked = settings.includeSubdomains !== false;
  renderWhitelist();
}

async function saveSettings(nextSettings) {
  settings = {
    ...settings,
    ...nextSettings,
    whitelist: normalizeWhitelist(nextSettings.whitelist ?? settings.whitelist)
  };
  await chromeCall(chrome.storage.local, "set", { settings });
}

async function getCurrentTab() {
  const tabs = await chromeCall(chrome.tabs, "query", { active: true, lastFocusedWindow: true });
  return tabs?.[0] ?? null;
}

async function inspectCurrentPage() {
  let tab = null;
  try {
    tab = await getCurrentTab();
    currentTabUrl = tab?.url ?? "";
    currentHostname = getPageHostname(currentTabUrl);
  } catch {
    currentHostname = null;
  }
  renderCurrentPage();

}

function renderCurrentPage() {
  const route = resolveTabRoute(currentTabUrl, proxyStateSnapshot, settings);
  const whitelisted = isHostWhitelisted(currentHostname, settings.whitelist);
  const whitelistBypass = proxyStateSnapshot?.value?.mode === "fixed_servers" && whitelisted;
  const routeLabels = {
    clash: "交给 Clash",
    direct: "浏览器直连",
    system: "系统代理",
    unknown: "状态未知"
  };
  const routeMessages = {
    clash: "此网站未命中直连白名单，浏览器请求会交给本机 Clash 处理。",
    direct: whitelistBypass
      ? "此网站命中直连白名单，浏览器请求会绕过浏览器代理。"
      : "当前浏览器处于全局直连模式，所有网站都会直接连接。",
    system: "此网站跟随 Windows 系统代理设置。",
    unknown: "无法确认此网站的浏览器代理路由；可能由其他扩展或管理策略接管。"
  };
  const routeClasses = {
    clash: "route-proxy",
    direct: "route-good",
    system: "route-system",
    unknown: "route-unknown"
  };

  ui.brandMark.dataset.route = route;
  ui.brandMark.setAttribute("aria-label", `当前页面状态：${routeLabels[route]}`);
  ui.routePill.textContent = routeLabels[route];
  ui.routePill.className = `route-pill ${routeClasses[route]}`;

  if (!currentHostname) {
    ui.currentHost.textContent = "当前页面不可用";
    ui.currentRoute.textContent = "请打开普通 HTTP 或 HTTPS 网站后再查看网页路由。";
    ui.addCurrent.disabled = true;
    ui.removeCurrent.hidden = true;
    ui.includeSubdomains.disabled = true;
    ui.siteHint.textContent = "浏览器内部页面不属于普通网站，无法加入直连白名单。";
    return;
  }

  ui.currentHost.textContent = currentHostname;
  ui.currentRoute.textContent = routeMessages[route];
  ui.addCurrent.disabled = whitelisted;
  ui.removeCurrent.hidden = !whitelisted;
  ui.includeSubdomains.disabled = whitelisted;
  ui.siteHint.textContent = whitelisted
    ? whitelistBypass
      ? "此域名命中浏览器直连白名单；不会交给 Clash 的普通代理规则处理。"
      : "此域名已保存为白名单，但当前是全局直连或系统代理模式，实际路由并不依赖这条白名单。"
    : route === "clash"
      ? "添加后会绕过浏览器代理；未添加的网站仍交给 Clash 按现有规则处理。"
      : "白名单只影响浏览器处于 Clash 代理模式时的浏览器级绕过规则。";
}
function renderModes() {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === activeMode));
  });
  ui.modeHelp.textContent = activeMode === "clash"
    ? "普通网站交给 Clash，Clash 继续执行你现有的节点和分流规则。"
    : activeMode === "direct"
      ? "Edge 直接连接网站，不经过浏览器代理；其他应用不受影响。"
      : activeMode === "system"
        ? "Edge 使用 Windows 系统代理设置；不修改 Windows 的代理配置。"
        : "当前代理设置无法识别。你仍可在这里选择一个模式接管 Edge。";
}

function renderWhitelist() {
  settings.whitelist = normalizeWhitelist(settings.whitelist);
  ui.list.replaceChildren();
  ui.count.textContent = String(settings.whitelist.length);
  ui.empty.hidden = settings.whitelist.length > 0;
  ui.clearList.hidden = settings.whitelist.length === 0;

  for (const entry of settings.whitelist) {
    const item = document.createElement("li");
    item.className = "whitelist-item";

    const detail = document.createElement("div");
    detail.style.minWidth = "0";
    const domain = document.createElement("div");
    domain.className = "whitelist-domain";
    domain.textContent = entry.host;
    const meta = document.createElement("div");
    meta.className = "whitelist-meta";
    meta.textContent = entry.includeSubdomains ? "主域名及其子域名直连" : "仅此主机名直连";
    detail.append(domain, meta);

    const remove = document.createElement("button");
    remove.className = "remove-button";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `移除 ${entry.host}`);
    remove.addEventListener("click", () => removeWhitelistEntry(entry.host));

    item.append(detail, remove);
    ui.list.append(item);
  }
  renderCurrentPage();
}

async function readProxyState() {
  try {
    const result = await chromeCall(chrome.proxy.settings, "get", { incognito: false });
    proxyStateSnapshot = result;
    const level = result?.levelOfControl ?? "unknown";
    const current = result?.value ?? {};
    const label = describeProxyMode(current, settings);
    activeMode = inferActiveMode(current, settings);
    renderModes();
    renderCurrentPage();
    ui.stateText.textContent = label;
    ui.statePill.className = `state-pill ${level === "controlled_by_this_extension" ? "state-good" : level === "not_controllable" ? "state-bad" : "state-neutral"}`;

    if (level === "not_controllable" || level === "controlled_by_other_extensions") {
      sendNotice("浏览器代理设置当前由其他扩展或管理策略控制，Alaxee Proxy 可能无法切换。请检查其他代理扩展。", "error");
    }
    if (label === "其他代理配置" || label === "PAC 自动代理" || label === "自动检测代理") {
      ui.statePill.className = "state-pill state-warn";
    }
    return { level, current };
  } catch (error) {
    ui.stateText.textContent = "无法读取状态";
    ui.statePill.className = "state-pill state-bad";
    sendNotice(`读取浏览器代理状态失败：${error.message}`, "error");
    return null;
  }
}

async function applyMode(mode, overrides = {}) {
  const next = {
    ...settings,
    ...overrides,
    mode,
    whitelist: normalizeWhitelist(overrides.whitelist ?? settings.whitelist)
  };

  let proxyConfig;
  try {
    proxyConfig = buildChromeProxyConfig(next);
  } catch (error) {
    sendNotice(error.message, "error");
    throw error;
  }

  await chromeCall(chrome.proxy.settings, "set", {
    value: proxyConfig,
    scope: "regular"
  });
  await saveSettings(next);
  activeMode = mode;
  renderModes();
  renderWhitelist();
  await readProxyState();
}

async function addCurrentToWhitelist(options = {}) {
  if (!currentHostname) return;
  try {
    const entry = createWhitelistEntry(currentHostname, ui.includeSubdomains.checked);
    const whitelist = normalizeWhitelist([...settings.whitelist.filter((item) => item.host !== entry.host), entry]);
    await saveSettings({ whitelist, includeSubdomains: ui.includeSubdomains.checked });
    if (activeMode === "clash") {
      await applyMode("clash", { whitelist });
    } else {
      // Persist the list now; it will be included whenever Clash mode is enabled.
      renderWhitelist();
    }
    if (options.tabsPermissionGranted === false) {
      sendNotice(`${entry.host} 已加入直连白名单；但逐网页图标权限未开启，工具栏暂时只能显示全局模式。可点击上方“启用逐网页显示”开启。`, "warning");
    } else {
      sendNotice(`${entry.host} 已加入直连白名单，当前网页图标将显示为浏览器直连。`, "success");
    }
  } catch (error) {
    sendNotice(`添加失败：${error.message}`, "error");
  }
}

async function removeWhitelistEntry(host) {
  const whitelist = settings.whitelist.filter((entry) => entry.host !== host);
  try {
    await saveSettings({ whitelist });
    if (activeMode === "clash") await applyMode("clash", { whitelist });
    else renderWhitelist();
    sendNotice(`${host} 已从白名单移除。`, "success");
  } catch (error) {
    sendNotice(`移除失败：${error.message}`, "error");
  }
}

async function clearWhitelist() {
  try {
    await saveSettings({ whitelist: [] });
    if (activeMode === "clash") await applyMode("clash", { whitelist: [] });
    else renderWhitelist();
    sendNotice("直连白名单已清空。", "success");
  } catch (error) {
    sendNotice(`清空失败：${error.message}`, "error");
  }
}

async function connectClash() {
  const config = {
    host: ui.host.value,
    port: ui.port.value,
    scheme: ui.scheme.value
  };
  try {
    validateProxySettings(config);
    await applyMode("clash", config);
    sendNotice("Clash 代理设置已保存并应用到 Edge。", "success");
  } catch (error) {
    sendNotice(`连接设置未能应用：${error.message}`, "error");
  }
}

function renderStatusPermission() {
  chrome.permissions.contains({ permissions: ["tabs"] }, (granted) => {
    ui.statusPermissionButton.textContent = granted ? "已启用 · 刷新" : "启用逐网页显示";
    ui.statusPermissionButton.setAttribute("aria-pressed", String(granted));
    ui.statusPermissionHint.textContent = granted
      ? "逐网页状态已启用：白名单网页显示直连，其他网页按当前代理模式显示；仅本地读取网址。"
      : "要让图标真正区分当前网页是否命中白名单，需要允许本地读取标签页网址；不会读取网页内容或上传浏览数据。";
  });
}

async function initialize() {
  try {
    await loadSettings();
    renderStatusPermission();
    renderModes();
    await inspectCurrentPage();
    await readProxyState();
  } catch (error) {
    sendNotice(`插件初始化失败：${error.message}`, "error");
  }

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await applyMode(button.dataset.mode);
        sendNotice(button.dataset.mode === "clash" ? "已切换到 Clash 代理。" : button.dataset.mode === "direct" ? "Edge 已切换为直接连接。" : "Edge 已切换为跟随系统代理。", "success");
      } catch (error) {
        sendNotice(`切换失败：${error.message}`, "error");
      }
    });
  });

  ui.statusPermissionButton.addEventListener("click", () => {
    // permissions.request must be called directly inside this user gesture.
    chrome.permissions.request({ permissions: ["tabs"] }, (granted) => {
      if (!granted) {
        sendNotice("未授予标签页权限。工具栏仍显示全局代理模式；无法自动识别各网页的白名单状态。", "error");
        renderStatusPermission();
        return;
      }
      renderStatusPermission();
      chrome.runtime.sendMessage({ type: "SYNC_ALL_TABS" }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          sendNotice("权限已启用，但标签页图标同步失败；请重新打开面板重试。", "error");
          return;
        }
        sendNotice("已启用每网页状态图标。切换标签页时，图形会对应变化。", "success");
      });
    });
  });

  ui.saveConnect.addEventListener("click", connectClash);
  ui.openSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
  ui.addCurrent.addEventListener("click", () => {
    // Request the optional tabs permission directly from the user gesture.
    // Adding a whitelist entry remains available even when permission is denied.
    chrome.permissions.request({ permissions: ["tabs"] }, (granted) => {
      if (chrome.runtime.lastError) {
        void addCurrentToWhitelist({ tabsPermissionGranted: false });
        return;
      }
      void addCurrentToWhitelist({ tabsPermissionGranted: granted });
    });
  });
  ui.removeCurrent.addEventListener("click", () => currentHostname && removeWhitelistEntry(currentHostname));
  ui.clearList.addEventListener("click", clearWhitelist);
  ui.includeSubdomains.addEventListener("change", async () => {
    try {
      await saveSettings({ includeSubdomains: ui.includeSubdomains.checked });
    } catch (error) {
      sendNotice(`保存选项失败：${error.message}`, "error");
    }
  });
}

initialize();
