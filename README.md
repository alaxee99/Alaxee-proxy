# Alaxee Proxy

一个面向 Microsoft Edge 的轻量级 Manifest V3 代理扩展。它不提供代理节点、不管理订阅，也不替代 Clash/Mihomo；它只负责把 Edge 浏览器流量交给本机 Clash/Mihomo，并维护一份浏览器级别的直连白名单。

## 当前版本

- 版本：`0.1.2`
- 目标浏览器：Microsoft Edge（Chromium，Manifest V3）
- 发布方式：Microsoft Edge Add-ons（计划上架）；开发期间也可本地加载解压缩版本
- 运行依赖：无第三方 JavaScript 运行时依赖

## 功能

- **Clash 代理**：使用用户配置的本机地址和 HTTP 或 SOCKS5 端口。
- **直接连接**：让 Edge 不使用浏览器代理。
- **跟随系统代理**：让 Edge 使用 Windows 系统代理设置。
- **当前网站一键直连**：从当前标签页读取 HTTP/HTTPS 主机名，加入直连白名单。
- **子域名选项**：可选择仅当前主机名，或同时绕过主域名及其子域名。
- **逐标签页状态图标**：启用可选标签页权限后，工具栏会按当前网页显示不同的 XEE 轨道图形：交给 Clash、浏览器直连、系统代理或状态未知。每个标签页独立更新。
- **本地持久化**：代理地址、模式和白名单保存在 `chrome.storage.local`，没有云端同步或遥测。

## 与 Clash/Mihomo 的关系

在 **Clash 代理** 模式下，扩展将 Edge 的浏览器代理设置指向你配置的本机监听地址。普通网站仍由 Clash/Mihomo 按其现有的 `rule`、节点组和策略处理。扩展不会读取、修改或复制 Clash 的 YAML、订阅或规则集。

建议优先使用 Clash/Mihomo 的 **Mixed Port**，在扩展中选择 `HTTP`。Mixed Port 同时接受 HTTP 和 SOCKS5 客户端连接，但浏览器此处仍需选择一种客户端协议。若你使用单独的 SOCKS 端口，则选择 `SOCKS5`。

默认地址和端口 `127.0.0.1:7890` 只是常见示例，必须以 Clash 客户端当前的端口设置为准。不同客户端、不同配置的端口可能不同。

### 直连白名单的优先级

白名单在 Chromium 浏览器代理层生效。命中白名单的网站会绕过浏览器代理，因此不会再交给 Clash 的普通代理入站规则判断；未命中白名单的网站才会交给 Clash。

启用“包含子域名”时，扩展会同时添加 `example.com` 和 `*.example.com`。Chromium 的 `*.example.com` 本身不匹配根域名 `example.com`，所以两条规则都需要。

**注意：** 如果 Clash/Mihomo 同时启用了 TUN、系统透明代理或其他网络接管方式，浏览器的 DIRECT 不一定意味着数据包完全绕过 Clash/TUN。那需要结合你的 Clash 模式和路由配置单独确认。

## 本地安装到 Edge

1. 解压发布包到固定目录，例如 `C:\AData\Projects\Alaxee-Proxy`。
2. 在 Edge 地址栏打开 `edge://extensions`。
3. 打开 **开发人员模式**。
4. 点击 **加载解压缩的扩展**。
5. 选择能直接看到 `manifest.json` 的项目文件夹。
6. 将 Alaxee Proxy 固定到工具栏。
7. 点击扩展图标打开快捷面板；面板内可以切换代理、快速修改代理端口并管理当前网站白名单。
8. 点击面板右上角「设置」打开完整设置页。设置页的「返回浏览器」会关闭当前设置标签页；随后从 Edge 工具栏重新打开快捷面板。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `proxy` | 设置 Edge 浏览器代理模式及 bypassList。 |
| `storage` | 本地保存设置和直连白名单。 |
| `activeTab` | 用户点击扩展时读取当前标签页 URL，以便快捷添加当前网站；不申请全站内容访问权限。 |
| `tabs`（可选） | 用户主动启用逐标签页状态图标后，读取标签页 URL 并按白名单更新对应工具栏图标和悬停标题；仅本地处理，不读取页面内容、不上传数据。 |

扩展不申请 `webRequest`、`host_permissions`、剪贴板、账户或网络访问权限；`tabs` 仅作为可选权限，由用户在快捷面板中主动开启。没有远程脚本、遥测或后台服务器。

## 开发与测试

要求 Node.js 20+ 和 Python 3。无需安装 npm 依赖。

```bash
npm test
npm run check
python -m json.tool manifest.json > /dev/null
npm run package:extension
```

`npm run package:extension` 会在 `dist/` 生成仅包含扩展运行文件的商店 ZIP，不会把测试、文档和 Git 元数据打进商店包。

## 发布和自动更新

- 初次上架：必须在 Microsoft Partner Center 创建 Edge Add-ons 产品、填写商店信息和隐私/权限声明，并提交首次审核。
- 商店用户更新：首次发布后，Edge 通过商店机制自动向用户提供审核通过的更新。
- 开发者自动发布：项目包含 GitHub Actions。首次上架完成、启用 Edge Add-ons Publish API 并在仓库配置密钥后，推送匹配版本的 `vX.Y.Z` 标签会自动运行测试、构建商店 ZIP，并将新包提交给 Microsoft 审核。
- 自动化提交不等于审核通过或立即上架；Microsoft 仍控制认证和发布时间。

完整步骤见 [`docs/EDGE-ADDONS-PUBLISHING.md`](docs/EDGE-ADDONS-PUBLISHING.md)。商店列表草稿见 [`STORE-LISTING.md`](STORE-LISTING.md)，隐私说明见 [`PRIVACY.md`](PRIVACY.md)。

## 已知边界

- 代理设置是 **Edge 配置级别** 的，不是只作用于当前标签页。
- 加入白名单会影响 Edge 中访问该主机名的所有标签页和请求，而不只是添加时所在的标签页。
- `edge://`、扩展商店等受限页面、`file://` 本地文件不能加入当前网站白名单；这类页面显示未知状态图形。
- 未启用可选 `tabs` 权限前，工具栏显示全局代理模式；打开弹窗后只为当前活动页面即时计算一次图标。
- 扩展不能仅凭代理设置判断 Clash 进程是否存活；状态显示的是浏览器当前代理配置，不是对 Clash 服务端的健康检查。
- 其他代理扩展、组织策略或浏览器管理策略可能占用代理设置控制权。若出现冲突，应关闭其他代理扩展或检查管理策略。
- 第一版不支持代理认证账号密码、PAC 规则编辑、订阅导入、分应用代理和云同步。

## 安全原则

- 只连接用户自行配置的代理监听地址。
- 默认绑定 loopback (`127.0.0.1`)，不要求 Clash 开启 LAN 访问。
- 不读取代理订阅、不收集浏览记录、不上传白名单。
- 不使用远程代码或动态代码执行。
- Edge Add-ons API 凭据必须保存在 GitHub Actions Secrets，不能提交到代码仓库。

## 仓库可见性与许可证

项目目前未指定开源许可证。除非维护者决定公开授权范围，否则不要添加开源许可证。商店发布所需的公开隐私政策 URL 应在上架前确定；仓库是否公开可单独决定。
