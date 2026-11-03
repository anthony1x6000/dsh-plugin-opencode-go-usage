# dsh-plugin-opencode-go-usage

[![npm version](https://img.shields.io/npm/v/dsh-plugin-opencode-go-usage?style=flat-square)](https://www.npmjs.com/package/dsh-plugin-opencode-go-usage)
[![npm downloads](https://img.shields.io/npm/dw/dsh-plugin-opencode-go-usage?style=flat-square)](https://www.npmjs.com/package/dsh-plugin-opencode-go-usage)
[![license](https://img.shields.io/github/license/keyblues/dsh-plugin-opencode-go-usage.svg)](LICENSE)
[![release](https://img.shields.io/github/v/release/keyblues/dsh-plugin-opencode-go-usage?style=flat-square)](https://github.com/keyblues/dsh-plugin-opencode-go-usage/releases)

> **English** — Live OpenCode Go subscription usage for DeepSeek Harness, as a compact meter in the composer dock: the rolling 5-hour, weekly and monthly windows as small rings with used percentages (70% amber, 90% red), plus a click-open detail card with per-window progress bars and reset countdowns. The Host half polls `https://opencode.ai/zen/go/v1/usage` on demand and serves one same-origin JSON route, so the API key never reaches the browser.

DeepSeek Harness（DSH）插件：在 Web UI 输入框下方实时显示 OpenCode Go 套餐三个窗口的用量。数据来自 OpenCode 官方接口，API Key 只留在 Host 进程内，浏览器拿不到。

## 特性

- **输入框下方常驻用量条**：`conversation.composer.dock` 里三个小圆环（`5h` 滚动 / `本周` / `本月`）加已用百分比；环形样式与输入框下方「上下文占用」圆环一致（14px viewBox、2px 描边、主题 token 上色），70% 变黄、90% 变红
- **点击整条弹出详情卡**：版式照搬官方 `stat-dialog` 卡片，每个窗口一行（窗口名 + 右侧加粗百分比）加额度进度条，再给出重置倒计时与重置时刻；底部是数据来源、更新时间与「刷新」按钮，点外部或 Esc 关闭
- **静默刷新**：页面每 20 秒读一次同源 JSON 路由（标签页隐藏时暂停），Host 侧最小上游请求间隔 15 秒、多页面共享同一份结果；后台轮询不变暗不闪，偶发失败保留上一次成功读数
- **Key 不进浏览器**：Host 半按 `配置 → 凭据库 → OpenCode auth.json` 解析 Key 并直接请求上游，浏览器只从 `GET /opencode-go-usage.json` 拿到百分比
- **零 npm 依赖、无构建步骤**：`npm run validate` 自检清单、语法、locale、图标与样式令牌

## 安装

### 从 npm 安装（推荐）

已发布到 npm：[`dsh-plugin-opencode-go-usage`](https://www.npmjs.com/package/dsh-plugin-opencode-go-usage)。

在 Harness 里用插件管理器安装这个 bundle，target 写 npm 包名（可带版本）：

```text
plugin_manager install_bundle  target: dsh-plugin-opencode-go-usage
# 或固定版本
plugin_manager install_bundle  target: dsh-plugin-opencode-go-usage@1.0.1
```

### 从 GitHub Release 安装（离线、固定版本）

从 [Releases](https://github.com/keyblues/dsh-plugin-opencode-go-usage/releases) 下载 `dsh-plugin-opencode-go-usage-<version>.tgz`，在插件管理器里填该文件的绝对路径，或：

```text
plugin_manager install_bundle  target: <下载的 .tgz 绝对路径>
```

### 从本地目录安装（开发）

```text
plugin_manager install_bundle  target: <本仓库的绝对路径>
```

安装后立即生效：Host 行激活，浏览器端 bundle 通过 HMR 载入页面（必要时刷新一次页面）。卸载：

```text
plugin_manager remove_bundle  target: dsh-plugin-opencode-go-usage
```

要求：DSH 的 Web 组合（包含 `webserver` / `client-modules` / `client-ui-conversation`）。

## 使用

用量条大致形态：`Go  5h ◔6%  ·  本周 ◔2%  ·  本月 ◔15%`

不点击时没有任何悬浮详情；点击整条才弹出详情卡片。卡片宽度 `max-content`，上限 `min(440px, 100vw - 24px)`；明细区两列网格 `minmax(76px,auto) / minmax(0,1fr)`，与旁边「Token 用量」「会话统计」同一套版式。

## 数据来源

Host 半调用 OpenCode 官方用量接口：

```text
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <OpenCode Go API Key>
```

返回形如：

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 3, "resetsAt": "2026-10-26T04:49:14.000Z" },
    "weekly":  { "status": "ok", "percent": 1, "resetsAt": "2026-11-02T00:00:00.000Z" },
    "monthly": { "status": "ok", "percent": 14, "resetsAt": "2026-11-24T07:12:36.000Z" }
  }
}
```

`percent` 是**已用百分比**；旧的 `{ rollingUsage, weeklyUsage, monthlyUsage }` 形态也兼容。

API Key 只在 Host 进程内使用，浏览器只能拿到固定同源 JSON 路由（`GET /opencode-go-usage.json`）的百分比数据。该路径是 Host/Client 两半共享的约定（`index.js` 的 `ROUTE_PATH` 与 `client.js` 的 `ROUTE`），刻意不做成配置项。

## API Key 的解析顺序

1. 插件配置里的 `apiKey`（显式写死，不推荐）
2. Harness 凭据服务中的 `credentialRef`，默认 `OPENCODE_GO_API_KEY`——即 `~/.dsh/.credentials.yaml` 里 `refs.OPENCODE_GO_API_KEY` 这一项
3. OpenCode 自己保存的登录信息：`~/.local/share/opencode/auth.json` 中的 `opencode-go.key`（若 key 已过期，接口返回 `api_key_expired`，条上显示「API Key 已过期」）

## 配置项

默认无需任何配置。需要调整时，在本 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: opencode-go-usage
  name: 'dsh-plugin-opencode-go-usage'
  config:
    # 直接指定 Key（优先于凭据服务）
    # apiKey: oc_sk_xxx
    credentialRef: OPENCODE_GO_API_KEY
    # 上游最小请求间隔（毫秒，2000–600000）；调大可减少请求，调小更新更及时
    minIntervalMs: 15000
    # OpenCode auth.json 中使用的 provider 名
    provider: opencode-go
```

`minIntervalMs` 是 Host 侧限流，只影响上游请求频率，不影响浏览器每 20 秒的读取。

## 结构

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半：解析 Key、调用用量接口、注册同源 JSON 路由（按需刷新、合并并发） |
| `client.js` | 浏览器半：dock 圆环用量条 + 点击弹出的详情卡片，轮询路由、主题令牌样式、中英文本 |
| `cordis.patch.yml` | 插入 `opencode-go-usage` 主机行 |
| `locale/*.json` | 插件管理器里显示的标题与说明 |
| `icon.svg` | 插件图标（原创） |
| `scripts/validate.mjs` | 打包自检：清单、语法、locale、图标、样式令牌 |

## 开发与发布

```bash
npm run validate        # 清单 / 语法 / locale / 图标 / 样式令牌自检
npm pack --dry-run      # 预览将发布的 tarball 内容
```

发布到 npm 走 GitHub 联动：`.github/workflows/publish.yml` 在推送 `v*` tag 时用 OIDC（npm Trusted Publishing）执行 `npm publish --provenance`，并把打好的 `.tgz` 附到对应的 GitHub Release。

Trusted Publishing 已配置（`npm trust github`：仓库 `keyblues/dsh-plugin-opencode-go-usage`、workflow `publish.yml`、权限 publish + stage publish），之后每次发版只需：

```bash
npm version patch|minor|major
git push --follow-tags
```

首次发布是在包还不存在时手动做的（此时无法配置 Trusted Publishing）：

```bash
npm login
npm publish --access public     # prepublishOnly 会先跑 npm run validate
```

## License

[MIT](LICENSE) © 2026 keyblues
