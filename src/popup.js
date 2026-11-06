import {
  DEFAULT_SETTINGS,
  buildChromeProxyConfig,
  createDomainEntry,
  describeProxyMode,
  getPageHostname,
  inferActiveMode,
  isHostBlacklisted,
  isHostWhitelisted,
  normalizeBlacklist,
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
  addCurrentDirect: $("addCurrentDirectButton"),
  addCurrentProxy: $("addCurrentProxyButton"),
  removeCurrentRule: $("removeCurrentRuleButton"),
  siteHint: $("siteHint"),
  notice: $("notice"),
  openSettings: $("openSettingsButton"),
  statusPermissionButton: $("statusPermissionButton"),
  statusPermissionHint: $("statusPermissionHint"),
  brandMark: $("brandMark"),
  totalRuleCount: $("totalRuleCount"),
  overviewView: $("overviewView"),
  rulesView: $("rulesView"),
  viewButtons: [...document.querySelectorAll("[data-view]")],
  whitelistTab: $("whitelistTab"),
  blacklistTab: $("blacklistTab"),
  ruleDescription: $("ruleDescription"),
  ruleForm: $("ruleForm"),
  ruleHostInput: $("ruleHostInput"),
  ruleIncludeSubdomains: $("ruleIncludeSubdomainsInput"),
  addRuleButton: $("addRuleButton"),
  activeRuleTitle: $("activeRuleTitle"),
  ruleList: $("rulesList"),
  ruleEmpty: $("rulesEmpty"),
  ruleCount: $("listCount"),
  clearRules: $("clearRulesButton")
};

let settings = { ...DEFAULT_SETTINGS, whitelist: [], blacklist: [] };
let currentHostname = null;
let currentTabUrl = "";
let proxyStateSnapshot = null;
let activeMode = "clash";
let activeView = "overview";
let activeRuleType = "whitelist";
let noticeTimer = null;

function sendNotice(message, kind = "success") {
  clearTimeout(noticeTimer);
  ui.notice.textContent = message;
  ui.notice.className = `notice notice-${kind}`;
  ui.notice.hidden = false;
  noticeTimer = setTimeout(() => { ui.notice.hidden = true; }, 4600);
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

function getRuleList(type) {
  return type === "blacklist" ? settings.blacklist : settings.whitelist;
}

function countRules() {
  return settings.whitelist.length + settings.blacklist.length;
}

function syncRuleCounts() {
  ui.totalRuleCount.textContent = String(countRules());
  ui.ruleCount.textContent = String(getRuleList(activeRuleType).length);
}

async function loadSettings() {
  const stored = await chromeCall(chrome.storage.local, "get", "settings");
  const raw = stored?.settings ?? {};
  settings = {
    ...DEFAULT_SETTINGS,
    ...raw,
    whitelist: normalizeWhitelist(raw.whitelist),
    blacklist: normalizeBlacklist(raw.blacklist)
  };
  activeMode = ["clash", "direct", "system"].includes(settings.mode) ? settings.mode : "clash";
  ui.host.value = settings.host;
  ui.port.value = settings.port;
  ui.scheme.value = settings.scheme;
  ui.includeSubdomains.checked = settings.includeSubdomains !== false;
  ui.ruleIncludeSubdomains.checked = true;
  renderRules();
  renderModes();
}

async function saveSettings(nextSettings) {
  settings = {
    ...settings,
    ...nextSettings,
    whitelist: normalizeWhitelist(nextSettings.whitelist ?? settings.whitelist),
    blacklist: normalizeBlacklist(nextSettings.blacklist ?? settings.blacklist)
  };
  await chromeCall(chrome.storage.local, "set", { settings });
  syncRuleCounts();
}

async function getCurrentTab() {
  const tabs = await chromeCall(chrome.tabs, "query", { active: true, lastFocusedWindow: true });
  return tabs?.[0] ?? null;
}

async function inspectCurrentPage() {
  try {
    const tab = await getCurrentTab();
    currentTabUrl = tab?.url ?? "";
    currentHostname = getPageHostname(currentTabUrl);
  } catch {
    currentTabUrl = "";
    currentHostname = null;
  }
  renderCurrentPage();
}

function renderCurrentPage() {
  const route = resolveTabRoute(currentTabUrl, proxyStateSnapshot, settings);
  const whitelisted = Boolean(currentHostname && isHostWhitelisted(currentHostname, settings.whitelist));
  const blacklisted = Boolean(currentHostname && isHostBlacklisted(currentHostname, settings.blacklist));
  const whitelistExact = Boolean(currentHostname && settings.whitelist.some((entry) => entry.host === currentHostname));
  const blacklistExact = Boolean(currentHostname && settings.blacklist.some((entry) => entry.host === currentHostname));
  const labels = {
    clash: "交给 Clash",
    direct: "浏览器直连",
    system: "系统代理",
    unknown: "状态未知"
  };
  const messages = {
    clash: blacklisted
      ? "此网站命中代理黑名单，浏览器请求会强制交给本机 Clash。"
      : "此网站未命中直连白名单，浏览器请求会交给本机 Clash 处理。",
    direct: whitelisted
      ? "此网站命中直连白名单，浏览器请求会绕过浏览器代理。"
      : "当前浏览器处于全局直连模式，所有网站都会直接连接。",
    system: "此网站跟随 Windows 系统代理设置；白名单和黑名单在此模式下暂不生效。",
    unknown: "无法确认此网站的浏览器代理路由；可能由其他扩展或管理策略接管。"
  };
  const classes = {
    clash: "route-proxy",
    direct: "route-good",
    system: "route-system",
    unknown: "route-unknown"
  };

  ui.brandMark.dataset.route = route;
  ui.brandMark.setAttribute("aria-label", `当前页面状态：${labels[route]}`);
  ui.routePill.textContent = labels[route];
  ui.routePill.className = `route-pill ${classes[route]}`;

  if (!currentHostname) {
    ui.currentHost.textContent = "当前页面不可用";
    ui.currentRoute.textContent = "请打开普通 HTTP 或 HTTPS 网站后再查看网页路由。";
    ui.addCurrentDirect.disabled = true;
    ui.addCurrentProxy.disabled = true;
    ui.removeCurrentRule.hidden = true;
    ui.includeSubdomains.disabled = true;
    ui.siteHint.textContent = "浏览器内部页面不属于普通网站，无法加入域名规则。";
    return;
  }

  ui.currentHost.textContent = currentHostname;
  ui.currentRoute.textContent = messages[route];
  ui.addCurrentDirect.disabled = whitelistExact;
  ui.addCurrentProxy.disabled = blacklistExact;
  ui.removeCurrentRule.hidden = !whitelistExact && !blacklistExact;
  ui.includeSubdomains.disabled = whitelistExact || blacklistExact;

  if (route === "system") {
    ui.siteHint.textContent = "系统代理模式会把规则暂时搁置；切回 Clash 或全局直连后规则会重新生效。";
  } else if (blacklisted) {
    ui.siteHint.textContent = "当前命中代理黑名单；即使同时匹配上级白名单，也会优先交给 Clash。";
  } else if (whitelisted) {
    ui.siteHint.textContent = "当前命中直连白名单；浏览器会跳过本机代理。";
  } else {
    ui.siteHint.textContent = "白名单让网站直连；代理黑名单让网站强制经 Clash。重叠时黑名单优先。";
  }
}

function renderModes() {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === activeMode));
  });
  ui.modeHelp.textContent = activeMode === "clash"
    ? "默认网站交给 Clash；白名单网站直连，代理黑名单网站强制经 Clash。"
    : activeMode === "direct"
      ? "默认网站直接连接；代理黑名单是例外，会强制经本机 Clash。"
      : activeMode === "system"
        ? "Edge 使用 Windows 系统代理设置；域名白名单和黑名单在此模式下暂不生效。"
        : "当前代理设置无法识别。你仍可在这里选择一个模式接管 Edge。";
}

function switchView(view) {
  activeView = view === "rules" ? "rules" : "overview";
  ui.overviewView.hidden = activeView !== "overview";
  ui.rulesView.hidden = activeView !== "rules";
  ui.viewButtons.forEach((button) => {
    if (button.dataset.view === activeView) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (activeView === "rules") renderRules();
}

function switchRuleType(type) {
  activeRuleType = type === "blacklist" ? "blacklist" : "whitelist";
  ui.whitelistTab.setAttribute("aria-pressed", String(activeRuleType === "whitelist"));
  ui.blacklistTab.setAttribute("aria-pressed", String(activeRuleType === "blacklist"));
  ui.activeRuleTitle.textContent = activeRuleType === "blacklist" ? "代理黑名单" : "直连白名单";
  ui.ruleDescription.textContent = activeRuleType === "blacklist"
    ? "命中的网站会强制通过本机 Clash，即使它也匹配某条上级直连白名单。"
    : "命中的网站会绕过浏览器代理，直接连接。";
  ui.ruleHostInput.placeholder = activeRuleType === "blacklist" ? "force-proxy.example.com" : "direct.example.com";
  ui.addRuleButton.textContent = activeRuleType === "blacklist" ? "添加代理规则" : "添加直连规则";
  renderRules();
}

function renderRules() {
  const entries = getRuleList(activeRuleType);
  ui.ruleList.replaceChildren();
  ui.ruleCount.textContent = String(entries.length);
  ui.ruleEmpty.hidden = entries.length > 0;
  ui.clearRules.hidden = entries.length === 0;
  ui.totalRuleCount.textContent = String(countRules());

  for (const entry of entries) {
    const item = document.createElement("li");
    item.className = "whitelist-item";

    const detail = document.createElement("div");
    detail.className = "rule-detail";
    const domain = document.createElement("div");
    domain.className = "whitelist-domain";
    domain.textContent = entry.host;
    const meta = document.createElement("div");
    meta.className = "whitelist-meta";
    meta.textContent = entry.includeSubdomains ? "主域名及其子域名" : "仅此主机名";
    const type = document.createElement("span");
    type.className = `rule-type-label ${activeRuleType === "blacklist" ? "rule-type-proxy" : "rule-type-direct"}`;
    type.textContent = activeRuleType === "blacklist" ? "强制 Clash" : "直连";
    detail.append(domain, meta, type);

    const remove = document.createElement("button");
    remove.className = "remove-button";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `移除 ${entry.host}`);
    remove.addEventListener("click", () => removeDomainRule(entry.host, activeRuleType));

    item.append(detail, remove);
    ui.ruleList.append(item);
  }
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
    ui.statePill.className = `state-pill ${level === "controlled_by_this_extension" ? "state-good" : level === "not_controllable" || level === "controlled_by_other_extensions" ? "state-bad" : "state-neutral"}`;

    if (level === "not_controllable" || level === "controlled_by_other_extensions") {
      sendNotice("浏览器代理设置当前由其他扩展或管理策略控制，Alaxee Proxy 可能无法切换。", "error");
    }
    if (label === "其他代理配置" || label === "自动检测代理" || label === "其他 PAC 代理配置") {
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

async function persistWithoutApplying(nextSettings, message) {
  await saveSettings(nextSettings);
  renderRules();
  renderCurrentPage();
  if (activeMode === "system") {
    sendNotice(`${message} 已保存；当前为系统代理模式，规则暂不生效。`, "warning");
  } else {
    sendNotice(`${message} 已保存。`, "success");
  }
}

async function applyMode(mode, overrides = {}) {
  const next = {
    ...settings,
    ...overrides,
    mode,
    whitelist: normalizeWhitelist(overrides.whitelist ?? settings.whitelist),
    blacklist: normalizeBlacklist(overrides.blacklist ?? settings.blacklist)
  };

  const proxyConfig = buildChromeProxyConfig(next);
  await chromeCall(chrome.proxy.settings, "set", {
    value: proxyConfig,
    scope: "regular"
  });
  await saveSettings(next);
  activeMode = mode;
  renderModes();
  renderRules();
  await readProxyState();
}

async function addDomainRule(type, host, includeSubdomains = true) {
  const normalized = createDomainEntry(host, includeSubdomains);
  const ownKey = type === "blacklist" ? "blacklist" : "whitelist";
  const otherKey = ownKey === "blacklist" ? "whitelist" : "blacklist";
  const ownEntries = settings[ownKey].filter((entry) => entry.host !== normalized.host);
  const otherEntries = settings[otherKey].filter((entry) => entry.host !== normalized.host);
  const next = {
    [ownKey]: [...ownEntries, normalized],
    [otherKey]: otherEntries
  };

  if (activeMode === "system") {
    await persistWithoutApplying(next, `${normalized.host} 的${type === "blacklist" ? "代理黑名单" : "直连白名单"}规则`);
  } else {
    await saveSettings(next);
    await applyMode(activeMode, next);
    sendNotice(`${normalized.host} 已加入${type === "blacklist" ? "代理黑名单" : "直连白名单"}。`, "success");
  }
  renderCurrentPage();
}

async function removeDomainRule(host, type) {
  const key = type === "blacklist" ? "blacklist" : "whitelist";
  const nextEntries = settings[key].filter((entry) => entry.host !== host);
  const message = `${host} 已从${type === "blacklist" ? "代理黑名单" : "直连白名单"}移除`;
  if (activeMode === "system") {
    await persistWithoutApplying({ [key]: nextEntries }, message);
  } else {
    await saveSettings({ [key]: nextEntries });
    await applyMode(activeMode, { [key]: nextEntries });
    sendNotice(`${message}。`, "success");
  }
  renderCurrentPage();
}

async function clearActiveRules() {
  const key = activeRuleType === "blacklist" ? "blacklist" : "whitelist";
  const next = { [key]: [] };
  if (activeMode === "system") {
    await persistWithoutApplying(next, activeRuleType === "blacklist" ? "代理黑名单已清空" : "直连白名单已清空");
  } else {
    await saveSettings(next);
    await applyMode(activeMode, next);
    sendNotice(activeRuleType === "blacklist" ? "代理黑名单已清空。" : "直连白名单已清空。", "success");
  }
  renderCurrentPage();
}

async function addCurrentRule(type, permissionResult = true) {
  if (!currentHostname) return;
  try {
    await addDomainRule(type, currentHostname, ui.includeSubdomains.checked);
    if (permissionResult === false) {
      sendNotice("规则已保存，但未启用逐网页图标权限；工具栏暂时无法逐网页区分代理状态。", "warning");
    }
  } catch (error) {
    sendNotice(`添加规则失败：${error.message}`, "error");
  }
}

function requestTabsPermissionAndRun(action) {
  // This callback is invoked directly from a user click. Permission is optional;
  // rule changes work even if the user denies it.
  chrome.permissions.request({ permissions: ["tabs"] }, (granted) => {
    const permissionError = chrome.runtime.lastError;
    if (permissionError) {
      void action(false);
      return;
    }
    void action(granted);
  });
}

async function addManualRule() {
  const host = ui.ruleHostInput.value.trim();
  if (!host) {
    sendNotice("请先输入域名。", "error");
    return;
  }
  try {
    await addDomainRule(activeRuleType, host, ui.ruleIncludeSubdomains.checked);
    ui.ruleHostInput.value = "";
  } catch (error) {
    sendNotice(`添加失败：${error.message}`, "error");
  }
}

async function connectClash() {
  const config = { host: ui.host.value, port: ui.port.value, scheme: ui.scheme.value };
  try {
    validateProxySettings(config);
    await applyMode("clash", config);
    sendNotice("Clash 地址和端口已保存，代理规则已应用到 Edge。", "success");
  } catch (error) {
    sendNotice(`连接设置未能应用：${error.message}`, "error");
  }
}

function renderStatusPermission() {
  chrome.permissions.contains({ permissions: ["tabs"] }, (granted) => {
    ui.statusPermissionButton.textContent = granted ? "已启用 · 刷新" : "启用逐网页显示";
    ui.statusPermissionButton.setAttribute("aria-pressed", String(granted));
    ui.statusPermissionHint.textContent = granted
      ? "逐网页状态已启用：根据白名单、黑名单和全局模式分别显示。仅本地读取标签页网址。"
      : "逐网页图标需要读取标签页网址；不会读取网页内容或上传浏览数据。添加规则仍然可用。";
  });
}

async function initialize() {
  try {
    await loadSettings();
    switchRuleType("whitelist");
    renderStatusPermission();
    renderModes();
    await inspectCurrentPage();
    await readProxyState();
    switchView(activeView);
  } catch (error) {
    sendNotice(`插件初始化失败：${error.message}`, "error");
  }

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await applyMode(button.dataset.mode);
        const message = button.dataset.mode === "clash"
          ? "已切换到 Clash 代理。"
          : button.dataset.mode === "direct"
            ? "已切换为浏览器全局直连（黑名单仍强制经 Clash）。"
            : "已切换为跟随系统代理；域名规则暂不生效。";
        sendNotice(message, "success");
      } catch (error) {
        sendNotice(`切换失败：${error.message}`, "error");
      }
    });
  });

  ui.viewButtons.forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  ui.whitelistTab.addEventListener("click", () => switchRuleType("whitelist"));
  ui.blacklistTab.addEventListener("click", () => switchRuleType("blacklist"));
  ui.ruleForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void addManualRule();
  });
  ui.clearRules.addEventListener("click", () => {
    void clearActiveRules().catch((error) => sendNotice(`清空失败：${error.message}`, "error"));
  });

  ui.statusPermissionButton.addEventListener("click", () => {
    chrome.permissions.request({ permissions: ["tabs"] }, (granted) => {
      if (!granted) {
        sendNotice("未授予标签页权限。域名规则仍可用，但工具栏无法逐网页更新图标。", "warning");
        renderStatusPermission();
        return;
      }
      renderStatusPermission();
      chrome.runtime.sendMessage({ type: "SYNC_ALL_TABS" }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          sendNotice("权限已启用，但标签页图标同步失败；请重新打开面板重试。", "error");
          return;
        }
        sendNotice("已启用逐网页状态图标。", "success");
      });
    });
  });

  ui.saveConnect.addEventListener("click", connectClash);
  ui.openSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
  ui.addCurrentDirect.addEventListener("click", () => {
    requestTabsPermissionAndRun((granted) => addCurrentRule("whitelist", granted));
  });
  ui.addCurrentProxy.addEventListener("click", () => {
    requestTabsPermissionAndRun((granted) => addCurrentRule("blacklist", granted));
  });
  ui.removeCurrentRule.addEventListener("click", async () => {
    if (!currentHostname) return;
    try {
      if (settings.blacklist.some((entry) => entry.host === currentHostname)) {
        await removeDomainRule(currentHostname, "blacklist");
      }
      if (settings.whitelist.some((entry) => entry.host === currentHostname)) {
        await removeDomainRule(currentHostname, "whitelist");
      }
    } catch (error) {
      sendNotice(`移除规则失败：${error.message}`, "error");
    }
  });
  ui.includeSubdomains.addEventListener("change", () => {
    void saveSettings({ includeSubdomains: ui.includeSubdomains.checked })
      .catch((error) => sendNotice(`保存选项失败：${error.message}`, "error"));
  });
}

initialize();
