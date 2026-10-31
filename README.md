# dsh-plugin-opencode-go-usage

[![license](https://img.shields.io/github/license/keyblues/dsh-plugin-opencode-go-usage.svg)](LICENSE)

DeepSeek Harness（DSH）插件：在 Harness Web UI 里实时查看 OpenCode Go 套餐额度用量。

在输入框下方（`conversation.composer.dock`）加入一个用量条，仅当前会话的模型属于
`opencode-go` 提供商时显示，展示 OpenCode Go 订阅的三个额度窗口：

- `5h` — 5 小时滚动窗口
- `本周` — 每周窗口
- `本月` — 每月窗口

在模型下拉里新选中 `opencode-go`（还没发消息）就会立即出现；切到其它提供商时整条卸载，
停止轮询，已打开的详情卡片也一并关闭。全新会话在明确选择模型或跑过一轮之前不显示。

每个窗口显示一个小圆环进度 + 已用百分比（环形样式与输入框下方「上下文占用」圆环一致，14px
viewBox、2px 描边，颜色同样用 `--dsw-alias-label-tertiary`）；达到 70% 变黄、90% 变红。

**点击整条才弹出详情卡片**——和旁边的「Token 用量」「会话统计」同一套版式（尺寸直接照搬官方
`stat-dialog` 卡片）：内边距 16px、字号 12px/行高 18px、标题行左右分布且 `margin-bottom:8px`、
标题下一条 `--dsw-alias-border-l2` 横线（`margin-bottom:10px`）、明细区两列网格
`minmax(76px,auto) / minmax(0,1fr)`、行列间距 6px / 16px；卡片宽度 `max-content`，上限
`min(440px, 100vw - 24px)`、下限 `min(300px, ...)`。每个窗口一行（窗口名如「5 小时窗口」+
右侧加粗百分比）加一根额度进度条，再一行小字给出重置倒计时与重置时刻；底部横线之后是数据
来源、更新时间和「刷新」按钮。卡片点外部或 Esc 关闭，不点击时没有任何悬浮详情。

页面每 20 秒自动轮询一次（标签页隐藏时暂停），Host 侧有 15 秒的最小上游请求间隔，多个页面
共享同一份结果。后台轮询完全静默（不变暗、不闪），偶发请求失败会保留上一次成功读数。

大致形态：`Go  5h ◔6%  ·  本周 ◔2%  ·  本月 ◔15%`

## 安装

### 从 npm 安装（推荐）

在 Harness 里用插件管理器安装这个 bundle，target 写 npm 包名（可带版本）：

```
plugin_manager install_bundle  target: dsh-plugin-opencode-go-usage
# 或固定版本
plugin_manager install_bundle  target: dsh-plugin-opencode-go-usage@1.0.0
```

### 从本地目录安装（开发）

```
plugin_manager install_bundle  target: <本仓库的绝对路径>
```

安装后立即生效：Host 行激活，浏览器端 bundle 通过 HMR 载入页面（必要时刷新一次页面）。
卸载：

```
plugin_manager remove_bundle  target: dsh-plugin-opencode-go-usage
```

要求：DSH 的 Web 组合（包含 `webserver` / `client-modules` / `client-ui-conversation`）。

## 数据来源

Host 半调用 OpenCode 官方用量接口：

```
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

API Key 只在 Host 进程内使用，浏览器只能拿到固定同源 JSON 路由
（`GET /opencode-go-usage.json`）的百分比数据，拿不到密钥。该路径是 Host/Client 两半共享的
约定（`index.js` 的 `ROUTE_PATH` 与 `client.js` 的 `ROUTE`），刻意不做成配置项。

## API Key 的解析顺序

1. 插件配置里的 `apiKey`（显式写死，不推荐）；
2. Harness 凭据服务中的 `credentialRef`，默认 `OPENCODE_GO_API_KEY`
   —— 也就是 `~/.dsh/.credentials.yaml` 里 `refs.OPENCODE_GO_API_KEY` 这一项；
3. OpenCode 自己保存的登录信息：`~/.local/share/opencode/auth.json` 中的 `opencode-go.key`
   （若该 key 已过期，接口会返回 `api_key_expired`，条上显示「API Key 已过期」）。

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
| `client.js` | 浏览器半：dock 圆环用量条 + 点击弹出的详情卡片，仅在 `opencode-go` 会话挂载，轮询路由、主题令牌样式、中英文本 |
| `cordis.patch.yml` | 插入 `opencode-go-usage` 主机行 |
| `locale/*.json` | 插件管理器里显示的标题与说明 |
| `icon.svg` | 插件图标（原创） |
| `scripts/validate.mjs` | 打包自检：清单、语法、locale、图标、样式令牌 |
| `test/model-gate.test.mjs` | 离线断言：只认 `opencode-go`、隐藏即卸载、dock 注册契约 |

## 开发与发布

```bash
npm test                # 浏览器半离线断言：模型门控与 dock 注册契约
npm run validate        # 清单 / 语法 / locale / 图标 / 样式令牌 自检
npm pack --dry-run      # 预览将发布的 tarball 内容
```

发布到 npm（包名 `dsh-plugin-opencode-go-usage` 已确认可用）：

```bash
npm login
npm publish --access public     # prepublishOnly 会先跑 npm run validate
```

发布后安装侧即可用 `plugin_manager install_bundle` + `dsh-plugin-opencode-go-usage`（或带版本）。

## License

[MIT](LICENSE) © 2026 keyblues
