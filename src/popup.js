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

const fullPageMode = new URLSearchParams(window.location.search).get("full") === "1";
if (fullPageMode) {
  document.documentElement.classList.add("full-page");
  document.title = "Alaxee Proxy · 完整设置";
  const intro = document.getElementById("fullPageIntro");
  if (intro) intro.hidden = false;
  const settingsButton = document.getElementById("openSettingsButton");
  if (settingsButton) {
    settingsButton.textContent = "关闭设置";
    settingsButton.title = "关闭完整设置页，返回浏览器";
    settingsButton.setAttribute("aria-label", "关闭完整设置页");
  }
}

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
  accountView: $("accountView"),
  accountSignedOut: $("accountSignedOut"),
  accountSignedIn: $("accountSignedIn"),
  accountLoginForm: $("accountLoginForm"),
  accountEmailInput: $("accountEmailInput"),
  accountPasswordInput: $("accountPasswordInput"),
  accountLoginButton: $("accountLoginButton"),
  accountUserEmail: $("accountUserEmail"),
  accountSignOutButton: $("accountSignOutButton"),
  accountFeedback: $("accountFeedback"),
  accountSyncDescription: $("accountSyncDescription"),
  accountSyncStatus: $("accountSyncStatus"),
  accountSyncButton: $("accountSyncButton"),
  viewButtons: [...document.querySelectorAll("[data-view]")],
  whitelistTab: $("whitelistTab"),
  blacklistTab: $("blacklistTab"),
  ruleDescription: $("ruleDescription"),
  ruleForm: $("ruleForm"),
  ruleHostInput: $("ruleHostInput"),
  ruleIncludeSubdomains: $("ruleIncludeSubdomainsInput"),
  ruleSearchInput: $("ruleSearchInput"),
  ruleFilterSummary: $("ruleFilterSummary"),
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
let accountUser = null;
let activeRuleType = "whitelist";
let ruleSearchQuery = "";
let proxyApplyInFlight = false;
let proxyConfigDirty = false;
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

function sendAccountMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response ?? { ok: false, error: "账户服务没有返回结果。" });
    });
  });
}

function setAccountFeedback(message = "", kind = "") {
  ui.accountFeedback.textContent = message;
  ui.accountFeedback.className = kind ? `account-feedback account-feedback-${kind}` : "account-feedback";
}

function renderAccountUser(user) {
  accountUser = user ?? null;
  ui.accountSignedOut.hidden = Boolean(accountUser);
  ui.accountSignedIn.hidden = !accountUser;
  ui.accountUserEmail.textContent = accountUser?.email || "ALAXEE 账户已连接";
}

async function loadAccount() {
  try {
    const response = await sendAccountMessage({ type: "ALAXEE_AUTH_GET_SESSION" });
    if (!response.ok) throw new Error(response.error || "无法读取账户状态。");
    renderAccountUser(response.user);
    setAccountFeedback(response.user ? "统一账号已连接。" : "尚未登录。代理功能仍可在本机独立使用。", "neutral");
    await refreshRuleSyncUi();
  } catch (error) {
    renderAccountUser(null);
    setAccountFeedback(error.message || "暂时无法连接 ALAXEE 账户服务。", "error");
    await refreshRuleSyncUi();
  }
}

function readableAccountError(error) {
  const message = String(error?.message || error || "");
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials") || normalized.includes("invalid_credentials")) {
    return "邮箱或密码不正确，请确认这是 ALAXEE Start 中已注册的邮箱登录方式。";
  }
  if (normalized.includes("email not confirmed")) return "邮箱尚未验证，请先在 ALAXEE Start 完成邮箱验证。";
  if (normalized.includes("无法连接") || normalized.includes("failed to fetch")) {
    return "无法连接统一账号服务，请检查网络或代理后重试。";
  }
  return message || "登录失败，请稍后重试。";
}

async function submitAccountLogin(event) {
  event.preventDefault();
  const email = ui.accountEmailInput.value.trim();
  const password = ui.accountPasswordInput.value;
  if (!email || !password) return;
  ui.accountLoginButton.disabled = true;
  setAccountFeedback("正在验证 ALAXEE 账户…", "neutral");
  try {
    const response = await sendAccountMessage({ type: "ALAXEE_AUTH_SIGN_IN", email, password });
    if (!response.ok || !response.user) throw new Error(response.error || "登录失败。");
    renderAccountUser(response.user);
    ui.accountPasswordInput.value = "";
    setAccountFeedback("登录成功。此设备已连接到你的 ALAXEE 统一账号。", "success");
    await refreshRuleSyncUi();
  } catch (error) {
    setAccountFeedback(readableAccountError(error), "error");
  } finally {
    ui.accountLoginButton.disabled = false;
  }
}

async function signOutAccount() {
  ui.accountSignOutButton.disabled = true;
  setAccountFeedback("正在退出…", "neutral");
  try {
    const response = await sendAccountMessage({ type: "ALAXEE_AUTH_SIGN_OUT" });
    if (!response.ok) throw new Error(response.error || "退出失败。");
    renderAccountUser(null);
    await refreshRuleSyncUi();
    ui.accountPasswordInput.value = "";
    setAccountFeedback(
      response.remoteRevoked ? "已退出此设备上的 ALAXEE 账号。" : "本机已退出；远端撤销未能确认，请在账户安全设置中检查活动会话。",
      response.remoteRevoked ? "success" : "error"
    );
  } catch (error) {
    setAccountFeedback(error.message || "退出失败。", "error");
  } finally {
    ui.accountSignOutButton.disabled = false;
  }
}

async function refreshRuleSyncUi() {
  if (!accountUser) {
    ui.accountSyncDescription.textContent = "登录 ALAXEE 账号后可查看域名规则云同步状态。";
    ui.accountSyncStatus.textContent = "未登录，不会同步域名规则。";
    ui.accountSyncButton.disabled = true;
    ui.accountSyncButton.textContent = "请先登录";
    ui.accountSyncButton.dataset.enabled = "false";
    return;
  }

  try {
    const response = await sendAccountMessage({ type: "ALAXEE_PROXY_RULE_SYNC_STATUS" });
    if (!response.ok) throw new Error(response.error || "无法读取云同步状态。");
    const status = response.status ?? {};
    ui.accountSyncButton.dataset.enabled = String(Boolean(status.enabled));

    if (status.accountBindingConflict) {
      ui.accountSyncDescription.textContent = "此 Edge 配置曾绑定另一个 ALAXEE 账号。为防止跨账号传输规则，云同步已暂停。";
      ui.accountSyncStatus.textContent = "账号隔离保护已触发。";
      ui.accountSyncButton.disabled = true;
      ui.accountSyncButton.textContent = "云同步已暂停";
      return;
    }

    if (!status.backendReady) {
      ui.accountSyncDescription.textContent = "云端规则表尚未部署到生产环境。当前白名单和黑名单仍只保存在本机，不会上传或下载。";
      ui.accountSyncStatus.textContent = "等待云端存储上线；Clash 地址、端口和代理模式始终只保存在本机。";
      ui.accountSyncButton.disabled = true;
      ui.accountSyncButton.textContent = "等待云端存储开放";
      return;
    }

    if (status.enabled) {
      ui.accountSyncDescription.textContent = "云同步已启用。此账号的白名单和黑名单会在设备间同步；代理端点和模式不会同步。";
      const details = [`待上传变更：${status.pendingCount ?? 0} 条。`];
      if (Array.isArray(status.conflicts) && status.conflicts.length) {
        details.push(`检测到 ${status.conflicts.length} 次并发修改，已采用云端版本。`);
      }
      if (status.lastSyncedAt) details.push(`上次同步：${new Date(status.lastSyncedAt).toLocaleString()}。`);
      if (status.lastError) details.push(`上次同步未完成：${status.lastError}`);
      ui.accountSyncStatus.textContent = details.join(" ");
      ui.accountSyncButton.disabled = false;
      ui.accountSyncButton.textContent = "立即同步";
    } else {
      ui.accountSyncDescription.textContent = "启用后，域名白名单、黑名单及删除标记会保存在此 ALAXEE 账号下，供其他设备同步。";
      ui.accountSyncStatus.textContent = "首次同步会以云端规则为准处理同名冲突，本机独有规则会保留。";
      ui.accountSyncButton.disabled = false;
      ui.accountSyncButton.textContent = "启用域名规则云同步";
    }
  } catch (error) {
    ui.accountSyncDescription.textContent = "暂时无法读取云同步状态。";
    ui.accountSyncStatus.textContent = error.message || "云同步状态读取失败。";
    ui.accountSyncButton.disabled = true;
    ui.accountSyncButton.textContent = "状态不可用";
  }
}

async function handleRuleSyncAction() {
  ui.accountSyncButton.disabled = true;
  const alreadyEnabled = ui.accountSyncButton.dataset.enabled === "true";
  ui.accountSyncStatus.textContent = alreadyEnabled ? "正在同步域名规则…" : "正在启用并初始化云同步…";
  try {
    const response = await sendAccountMessage({
      type: alreadyEnabled ? "ALAXEE_PROXY_RULE_SYNC_NOW" : "ALAXEE_PROXY_RULE_SYNC_ENABLE"
    });
    if (!response.ok) throw new Error(response.error || "域名规则同步失败。");
    await refreshRuleSyncUi();
    setAccountFeedback(alreadyEnabled ? "域名规则同步完成。" : "域名规则云同步已启用。", "success");
  } catch (error) {
    ui.accountSyncStatus.textContent = error.message || "域名规则同步失败。";
    setAccountFeedback(error.message || "域名规则同步失败。", "error");
  } finally {
    await refreshRuleSyncUi();
  }
}

function buildRuleSyncOperations(previousSettings, nextSettings) {
  const toMap = (value) => {
    const map = new Map();
    for (const entry of normalizeWhitelist(value?.whitelist)) {
      map.set(entry.host, { host: entry.host, ruleType: "whitelist", includeSubdomains: entry.includeSubdomains });
    }
    for (const entry of normalizeBlacklist(value?.blacklist)) {
      map.set(entry.host, { host: entry.host, ruleType: "blacklist", includeSubdomains: entry.includeSubdomains });
    }
    return map;
  };
  const previous = toMap(previousSettings);
  const next = toMap(nextSettings);
  const operations = [];
  for (const host of new Set([...previous.keys(), ...next.keys()])) {
    const before = previous.get(host);
    const after = next.get(host);
    if (before && after && before.ruleType === after.ruleType &&
        before.includeSubdomains === after.includeSubdomains) continue;
    const selected = after ?? before;
    operations.push({
      host,
      ruleType: selected.ruleType,
      includeSubdomains: selected.includeSubdomains,
      isDeleted: !after
    });
  }
  return operations;
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
  const previousSettings = settings;
  const next = {
    ...settings,
    ...nextSettings,
    whitelist: normalizeWhitelist(nextSettings.whitelist ?? settings.whitelist),
    blacklist: normalizeBlacklist(nextSettings.blacklist ?? settings.blacklist)
  };
  const syncOperations = buildRuleSyncOperations(previousSettings, next);
  await chromeCall(chrome.storage.local, "set", { settings: next });
  settings = next;
  syncRuleCounts();

  if (syncOperations.length && accountUser) {
    try {
      const response = await sendAccountMessage({
        type: "ALAXEE_PROXY_RULE_SYNC_ENQUEUE",
        operations: syncOperations
      });
      if (!response.ok) {
        sendNotice(`规则已保存在本机，但云同步队列未更新：${response.error || "未知错误"}`, "warning");
      } else if (response.status?.pendingCount > 0) {
        ui.accountSyncStatus.textContent = `有 ${response.status.pendingCount} 条规则等待云端同步。`;
      }
    } catch (error) {
      sendNotice(`规则已保存在本机，但云同步队列未更新：${error.message}`, "warning");
    }
  }
}


function syncSettingsFromStorage(changes, areaName) {
  if (areaName !== "local" || !changes?.settings) return;

  const raw = changes.settings.newValue;
  const stored = raw && typeof raw === "object" ? raw : {};
  settings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    whitelist: normalizeWhitelist(stored.whitelist),
    blacklist: normalizeBlacklist(stored.blacklist)
  };

  // Preserve an in-progress endpoint draft in this page while refreshing saved state.
  if (!proxyConfigDirty) {
    ui.host.value = settings.host;
    ui.port.value = settings.port;
    ui.scheme.value = settings.scheme;
  }
  if (document.activeElement !== ui.includeSubdomains) {
    ui.includeSubdomains.checked = settings.includeSubdomains !== false;
  }

  syncRuleCounts();
  renderRules();
  renderCurrentPage();
}

async function getCurrentTab() {
  if (fullPageMode) {
    const sourceTabId = Number(new URLSearchParams(window.location.search).get("sourceTabId"));
    if (Number.isInteger(sourceTabId) && sourceTabId > 0) {
      try {
        const sourceTab = await chromeCall(chrome.tabs, "get", sourceTabId);
        if (sourceTab) return sourceTab;
      } catch {
        // The source tab may have closed or its URL may no longer be available.
      }
    }
  }
  const tabs = await chromeCall(chrome.tabs, "query", { active: true, lastFocusedWindow: true });
  if (fullPageMode) return tabs?.find((tab) => getPageHostname(tab?.url)) ?? tabs?.[0] ?? null;
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
  ui.addCurrentDirect.disabled = proxyApplyInFlight || whitelistExact;
  ui.addCurrentProxy.disabled = proxyApplyInFlight || blacklistExact;
  ui.removeCurrentRule.hidden = !whitelistExact && !blacklistExact;
  ui.removeCurrentRule.disabled = proxyApplyInFlight;
  ui.includeSubdomains.disabled = proxyApplyInFlight || whitelistExact || blacklistExact;

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
  activeView = ["rules", "account"].includes(view) ? view : "overview";
  ui.overviewView.hidden = activeView !== "overview";
  ui.rulesView.hidden = activeView !== "rules";
  ui.accountView.hidden = activeView !== "account";
  ui.viewButtons.forEach((button) => {
    if (button.dataset.view === activeView) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (activeView === "rules") renderRules();
  if (activeView === "account") void loadAccount();
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
  const query = ruleSearchQuery.trim().toLocaleLowerCase();
  const visibleEntries = query
    ? entries.filter((entry) => entry.host.toLocaleLowerCase().includes(query))
    : entries;
  ui.ruleList.replaceChildren();
  ui.ruleCount.textContent = String(entries.length);
  ui.ruleEmpty.hidden = visibleEntries.length > 0;
  ui.clearRules.hidden = entries.length === 0;
  ui.totalRuleCount.textContent = String(countRules());
  ui.ruleFilterSummary.textContent = query
    ? `显示 ${visibleEntries.length} / ${entries.length} 条`
    : `共 ${entries.length} 条`;

  const emptyTitle = ui.ruleEmpty.children[1];
  const emptySubtitle = ui.ruleEmpty.children[2];
  if (entries.length === 0) {
    emptyTitle.textContent = "还没有添加域名";
    emptySubtitle.textContent = "可以在概览页将当前网站加入规则";
  } else if (visibleEntries.length === 0) {
    emptyTitle.textContent = "没有找到匹配的域名";
    emptySubtitle.textContent = "换一个关键词，或切换白名单 / 黑名单";
  }

  for (const entry of visibleEntries) {
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

    const actions = document.createElement("div");
    actions.className = "rule-item-actions";
    const scopeLabel = document.createElement("label");
    scopeLabel.className = "rule-scope-toggle";
    const scopeInput = document.createElement("input");
    scopeInput.type = "checkbox";
    scopeInput.checked = entry.includeSubdomains;
    scopeInput.disabled = proxyApplyInFlight;
    scopeInput.setAttribute("aria-label", `同时匹配 ${entry.host} 的子域名`);
    scopeInput.addEventListener("change", () => {
      void updateRuleSubdomains(entry.host, activeRuleType, scopeInput.checked);
    });
    const scopeText = document.createElement("span");
    scopeText.textContent = "子域";
    scopeLabel.append(scopeInput, scopeText);

    const remove = document.createElement("button");
    remove.className = "remove-button";
    remove.type = "button";
    remove.textContent = "×";
    remove.disabled = proxyApplyInFlight;
    remove.setAttribute("aria-label", `移除 ${entry.host}`);
    remove.addEventListener("click", () => removeDomainRule(entry.host, activeRuleType));
    actions.append(scopeLabel, remove);
    item.append(detail, actions);
    ui.ruleList.append(item);
  }
}

async function readProxyState({ announceControlChange = true } = {}) {
  try {
    const previousLevel = proxyStateSnapshot?.levelOfControl ?? null;
    const result = await chromeCall(chrome.proxy.settings, "get", { incognito: false });
    proxyStateSnapshot = result;
    const level = result?.levelOfControl ?? "unknown";
    const current = result?.value ?? {};
    const label = describeProxyMode(current, settings);
    activeMode = inferActiveMode(current, settings);
    renderModes();
    renderCurrentPage();

    const ownershipLabels = {
      controlled_by_other_extensions: "其他扩展控制",
      not_controllable: "浏览器策略限制"
    };
    const stateLabel = ownershipLabels[level] ??
      (level === "controlled_by_this_extension" && activeMode === "clash" ? "Clash 路由已应用" : label);
    ui.stateText.textContent = stateLabel;
    ui.statePill.className = `state-pill ${level === "controlled_by_this_extension" ? "state-good" : level === "not_controllable" || level === "controlled_by_other_extensions" ? "state-bad" : "state-neutral"}`;
    ui.statePill.title = level === "controlled_by_this_extension"
      ? "Edge 代理设置由 Alaxee Proxy 控制；此状态不检测本机 Clash / Mihomo 服务是否在线。"
      : level === "controlled_by_other_extensions"
        ? "Edge 代理设置当前由其他扩展控制，Alaxee Proxy 无法确认实际路由。"
        : level === "not_controllable"
          ? "Edge 代理设置受到浏览器或组织策略限制。"
          : "当前代理设置可由 Alaxee Proxy 接管。";
    ui.statePill.setAttribute("aria-label", stateLabel + "。" + ui.statePill.title);

    if (announceControlChange && previousLevel !== level &&
        (level === "not_controllable" || level === "controlled_by_other_extensions")) {
      sendNotice("Edge 代理设置的控制权已发生变化：" + stateLabel + "。", "warning");
    }
    if (!['not_controllable', 'controlled_by_other_extensions'].includes(level) &&
        (label === "其他代理配置" || label === "自动检测代理" || label === "其他 PAC 代理配置")) {
      ui.statePill.className = "state-pill state-warn";
    }
    return { level, current };
  } catch (error) {
    ui.stateText.textContent = "无法读取状态";
    ui.statePill.className = "state-pill state-bad";
    ui.statePill.title = "读取 Edge 浏览器代理设置失败。";
    sendNotice(`读取浏览器代理状态失败：${error.message}`, "error");
    return null;
  }
}

function renderProxyControls() {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.disabled = proxyApplyInFlight;
  });
  ui.saveConnect.disabled = proxyApplyInFlight;
  ui.addRuleButton.disabled = proxyApplyInFlight;
  ui.clearRules.disabled = proxyApplyInFlight;
  ui.ruleHostInput.disabled = proxyApplyInFlight;
  ui.ruleIncludeSubdomains.disabled = proxyApplyInFlight;
  document.documentElement.setAttribute("aria-busy", String(proxyApplyInFlight));
  renderCurrentPage();
  renderRules();
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
  if (proxyApplyInFlight) throw new Error("另一项代理设置正在应用，请稍后重试。");
  proxyApplyInFlight = true;
  renderProxyControls();

  const previousSettings = {
    ...settings,
    whitelist: [...settings.whitelist],
    blacklist: [...settings.blacklist]
  };
  const next = {
    ...settings,
    ...overrides,
    mode,
    whitelist: normalizeWhitelist(overrides.whitelist ?? settings.whitelist),
    blacklist: normalizeBlacklist(overrides.blacklist ?? settings.blacklist)
  };

  try {
    const proxyConfig = buildChromeProxyConfig(next);
    // Persist first. If the browser rejects the proxy update, restore the previous local settings.
    await saveSettings(next);
    try {
      await chromeCall(chrome.proxy.settings, "set", {
        value: proxyConfig,
        scope: "regular"
      });
    } catch (applyError) {
      try {
        await saveSettings(previousSettings);
      } catch (rollbackError) {
        await readProxyState({ announceControlChange: false });
        throw new Error(`Edge 未能应用新代理设置；本机设置回滚也失败：${rollbackError.message}`);
      }
      await readProxyState({ announceControlChange: false });
      throw new Error(`Edge 未能应用新代理设置，已恢复原有本机配置：${applyError.message}`);
    }

    activeMode = mode;
    renderModes();
    renderRules();
    await readProxyState({ announceControlChange: false });
  } finally {
    proxyApplyInFlight = false;
    renderProxyControls();
  }
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

  if (activeMode === "system" || !activeMode) {
    await persistWithoutApplying(
      next,
      `${normalized.host} 的${type === "blacklist" ? "代理黑名单" : "直连白名单"}规则`
    );
    if (!activeMode) {
      sendNotice(`${normalized.host} 的规则已保存在本机，但浏览器代理正由其他程序控制，Alaxee Proxy 没有覆盖它。`, "warning");
    }
  } else {
    await applyMode(activeMode, next);
    sendNotice(`${normalized.host} 已加入${type === "blacklist" ? "代理黑名单" : "直连白名单"}。`, "success");
  }
  renderCurrentPage();
}

async function removeDomainRule(host, type) {
  const key = type === "blacklist" ? "blacklist" : "whitelist";
  const nextEntries = settings[key].filter((entry) => entry.host !== host);
  const message = `${host} 已从${type === "blacklist" ? "代理黑名单" : "直连白名单"}移除`;
  if (activeMode === "system" || !activeMode) {
    await persistWithoutApplying({ [key]: nextEntries }, message);
    if (!activeMode) sendNotice(`${message}。代理设置由其他程序控制，因此没有更改浏览器代理。`, "warning");
  } else {
    await applyMode(activeMode, { [key]: nextEntries });
    sendNotice(`${message}。`, "success");
  }
  renderCurrentPage();
}

async function updateRuleSubdomains(host, type, includeSubdomains) {
  const key = type === "blacklist" ? "blacklist" : "whitelist";
  const current = settings[key].find((entry) => entry.host === host);
  if (!current || current.includeSubdomains === Boolean(includeSubdomains)) return;
  const nextEntries = settings[key].map((entry) => entry.host === host
    ? { ...entry, includeSubdomains: Boolean(includeSubdomains) }
    : entry);
  const next = { [key]: nextEntries };

  try {
    if (activeMode === "system") {
      await persistWithoutApplying(next, `${host} 的子域名匹配范围`);
    } else if (!activeMode) {
      await saveSettings(next);
      renderRules();
      renderCurrentPage();
      sendNotice(`${host} 的子域名匹配范围已保存在本机；当前浏览器代理由其他程序控制。`, "warning");
    } else {
      await applyMode(activeMode, next);
      sendNotice(`${host} 的子域名匹配范围已更新。`, "success");
    }
  } catch (error) {
    renderRules();
    sendNotice(`更新规则失败：${error.message}`, "error");
  }
}

async function clearActiveRules() {
  const key = activeRuleType === "blacklist" ? "blacklist" : "whitelist";
  const next = { [key]: [] };
  if (activeMode === "system" || !activeMode) {
    await persistWithoutApplying(next, activeRuleType === "blacklist" ? "代理黑名单已清空" : "直连白名单已清空");
    if (!activeMode) sendNotice("规则已清空；当前浏览器代理由其他程序控制，未更改其设置。", "warning");
  } else {
    await applyMode(activeMode, next);
    sendNotice(activeRuleType === "blacklist" ? "代理黑名单已清空。" : "直连白名单已清空。", "success");
  }
  renderCurrentPage();
}

async function addCurrentRule(type) {
  if (!currentHostname) return;
  try {
    await addDomainRule(type, currentHostname, ui.includeSubdomains.checked);
  } catch (error) {
    sendNotice(`添加规则失败：${error.message}`, "error");
  }
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
    proxyConfigDirty = false;
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
    chrome.storage.onChanged.addListener(syncSettingsFromStorage);
    await loadAccount();
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
  ui.accountLoginForm.addEventListener("submit", submitAccountLogin);
  ui.accountSignOutButton.addEventListener("click", () => { void signOutAccount(); });
  ui.accountSyncButton.addEventListener("click", () => { void handleRuleSyncAction(); });
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

  chrome.proxy.settings.onChange.addListener(() => {
    void readProxyState();
  });

  [ui.host, ui.port, ui.scheme].forEach((input) => {
    input.addEventListener("input", () => { proxyConfigDirty = true; });
  });
  ui.saveConnect.addEventListener("click", connectClash);
  ui.openSettings.addEventListener("click", async () => {
    try {
      if (fullPageMode) {
        const currentTab = await chromeCall(chrome.tabs, "getCurrent");
        if (currentTab?.id != null) await chromeCall(chrome.tabs, "remove", currentTab.id);
        else window.close();
        return;
      }
      const currentTab = await getCurrentTab();
      const params = new URLSearchParams({ full: "1" });
      if (currentTab?.id != null) params.set("sourceTabId", String(currentTab.id));
      await chromeCall(chrome.tabs, "create", {
        url: chrome.runtime.getURL(`src/popup.html?${params.toString()}`)
      });
    } catch (error) {
      sendNotice(`无法打开完整设置：${error.message}`, "error");
    }
  });
  ui.addCurrentDirect.addEventListener("click", () => { void addCurrentRule("whitelist"); });
  ui.addCurrentProxy.addEventListener("click", () => { void addCurrentRule("blacklist"); });
  ui.ruleSearchInput.addEventListener("input", () => {
    ruleSearchQuery = ui.ruleSearchInput.value;
    renderRules();
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
