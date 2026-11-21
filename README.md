# foxy-weibo（OpenCode 插件）

Foxy 的微博插件：关注一个微博账号，阅读博文、判断是否评论、回复楼中楼，并把读到的内容整理成本地长期记忆。

这是 OpenCode V2 插件（server + RPC + Desktop 设置页），不再是 DSH/Cordis 插件：

- 不依赖 `dsh-foxy`、`foxyMemory` 或 `preset.yml`；
- 默认复用 OpenCode 当前选中的模型，不需要单独的 API Key；
- 记忆保存在本机 JSONL 文件里，可由 `weibo_memory` 工具检索；
- 定时任务在 OpenCode 服务运行期间执行。

## 功能

- **阅读目标账号博文**：按每日时间检查监控账号的博文，每篇写入一条“目标账号博文”记忆，按博文 ID 去重；
- **评论**：可选对博文发表一级评论；可设置评论起始时间，只评论该时间之后的博文；
- **判断**：由模型输出 `skip / remember / comment`，不设最少字数，最多 80 字；
- **楼中楼回复**：读取针对 Foxy 自己评论的新回复并回复，按评论 `cid` 去重；
- **自检去重**：已评论/已跳过的博文写入 `postSeen`；评论前还会检查博文下是否已有本账号评论；
- **状态锁**：同一数据目录下多个 OpenCode 实例不会同时扫描并互相覆盖 `state.json`；
- **快速提取记忆**：读取全部往期博文，按自然周/月/年分组，每组整合为一条阶段记忆；
- **定时发博**：按每日时间让模型根据「发博关键词 / 要求」生成正文并发布一条新微博（例如每天早上 8 点整理 24 小时内新闻 TOP10）；
- **Desktop 设置页**：扫码登录、Cookie 备用、监控账号 UID、模型、每日时间、评论模式、定时发博、记忆开关、调试日志，以及「立即检查 / 立即读取 / 立即回复 / 立即发博」。

## 安装

把插件目录加到全局或项目 `opencode.json(c)` 的 `plugins` 里：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/Users/you/Documents/github_weibo_bot/dsh-foxy-weibo"
  ]
}
```

也可以写成对象形式传默认配置：

```jsonc
{
  "plugins": [
    {
      "package": "/Users/you/Documents/github_weibo_bot/dsh-foxy-weibo",
      "options": {
        "targetUid": "1234567890",
        "scheduleTimes": ["20:00"]
      }
    }
  ]
}
```

保存配置后 OpenCode 会重新加载插件的 server 部分，不需要重启。Desktop 的设置页入口在 **Settings → 微博**；如果新装后没有出现，重启一次 OpenCode Desktop 让窗口加载 GUI bundle。

> `options` 只提供默认值；设置页保存的 `settings.json` 优先级更高。

## 插件结构

| 部分 | 文件 | 说明 |
| --- | --- | --- |
| server | `lib/index.js` | `Plugin.define`，注册工具、定时任务、RPC |
| RPC | `lib/rpc.js` | `Rpc.define` 契约，Desktop 设置页调用 |
| GUI | `lib/gui.cjs` | `./gui-experimental`，预构建 CommonJS，渲染设置页 |
| 业务逻辑 | `lib/core.js` | 扫描、判断、评论、提取记忆 |
| 微博接口 | `lib/weibo.js` / `lib/login.js` | 时间线、评论、扫码登录 |

## 工具

插件注册在 `weibo` 命名空间下，可在 Code Mode 中直接调用：

| 工具 | 说明 |
| --- | --- |
| `weibo_status` | 登录状态、今日评论数、上次运行结果、最近记录 |
| `weibo_check` | 只检查博文，不写记忆、不评论 |
| `weibo_read` | 读取博文并写入本地记忆 |
| `weibo_comment` | 对博文发表一级评论（会请求权限） |
| `weibo_reply` | 回复 Foxy 评论下的楼中楼（会请求权限） |
| `weibo_post` | 按发博关键词生成并发布一条微博（会请求权限） |
| `weibo_extract` | 后台执行全量记忆提取 |
| `weibo_memory` | 搜索插件写入的微博记忆 |

`weibo_comment` 和 `weibo_reply` 在真实发布前会调用 `ctx.permission.assert`，权限动作是 `weibo.comment`；`weibo_post` 的权限动作是 `weibo.post`。

## AI 模型

默认 `llmMode: "opencode"`，通过 OpenCode 调用模型：

- `model`：例如 `deepseek/deepseek-flash`，在设置页「使用的模型」下拉框中选择；
- 留空时使用 `ctx.model.default()`，即 OpenCode 的**默认模型**。默认模型可能是免费模型，会有每日额度限制（报错 `Free usage limit reached`），此时请显式选择一个可用模型。

调用顺序：

1. 优先 `ctx.experimental.generate.text`（不创建会话）；
2. 旧版本回退到 `ctx.session.generate`（创建一个名为「微博判断」的会话）。

如果当前版本不支持复用模型，可以切换到直连模式：

- `llmMode: "direct"`
- `llmBaseUrl`：例如 `https://api.deepseek.com`
- `llmModel`：例如 `deepseek-chat`
- `llmApiKey`：只保存在本机

直连模式失败时，如果配置了 API Key，也会自动回退到直连。

系统提示词来自设置页的「人设」；留空使用内置 Foxy 人设。不再读取 `~/.dsh/foxy/presets`。

## 定时发博

设置页的「定时发博」卡片：

- `postEnabled`：是否启用定时发布；
- `postTimes`：每日发布时间，使用时间选择器（点击后上下滚动选择），选中即自动保存，最多 6 个；
- `postPrompt`：发博关键词 / 要求，例如 `整理24小时以内全球新闻TOP10，每条一句话`；
- `postSearch`：发博前是否用 OpenCode 的搜索服务联网补充资料（默认开启；未配置搜索时自动跳过）。

到点后插件调用当前选择的模型生成正文（只输出正文，400 字以内），再通过 `weibo.com/ajax/statuses/update` 发布；失败时回退到 `m.weibo.cn` 接口。发布记录写入 `state.json` 的 `lastPost` 和 `history`。

发布前会按“计划分钟”占位去重（`lastPost.slot`，例如 `2026-11-21 08:00`）：即使同时存在多个插件实例/进程，同一个计划分钟也只会发布一次。`postTimes` 为空时不会自动发布。

注意：关键词是**写作要求**，不会被原样发布；模型会重新组织内容。开启 `postSearch` 时，插件会先用 OpenCode 的 `websearch` 拉取参考资料，再让模型基于资料撰写；如果搜索不可用，会在提示词里明确“不要编造具体新闻”。发布前仍建议先用「立即发博」确认效果。

### 锁屏与休眠

调度器每 15 秒按系统时间检查一次，而不是依赖一个长定时器：

- **只锁屏、Mac 未休眠**：后台服务继续运行，会按设定时间发布；
- **系统休眠 / 合盖**：休眠期间不会发布，唤醒后 15 秒内会补发（实际时间会晚于设定时间）；
- **退出 OpenCode / 后台服务**：不会发布；重新启动后只等下一个时间点，不补发已错过的那次；
- 后台服务由 launchd 托管（`opencode-cli serve --service`），关闭 Desktop 窗口不影响它。

如果希望“错过超过一段时间就不补发”，可以再加一个补发窗口，目前是唤醒后直接补发。

## 扫码登录

设置页点「扫码登录」，用微博 App 扫码确认：

1. 获取 `login.sina.com.cn` 的二维码；
2. 每 2 秒轮询扫码状态；
3. 登录成功后合并 `SUB/SUBP/XSRF-TOKEN` 等 Set-Cookie；
4. 自动填写账号 UID，并把 Cookie 保存到本机。

二维码过期时点「刷新二维码」。也可以手动填 Cookie 作为备用。

## 数据位置

默认在 OpenCode 配置目录下：

```
~/.config/opencode/foxy-weibo/
├── settings.json   # 设置、Cookie、API Key
├── state.json      # 已读博文、已回复评论、运行记录
└── memory.jsonl    # 长期记忆（每行一条 JSON）
```

可用环境变量覆盖：

- `OPENCODE_CONFIG_DIR`：OpenCode 配置目录；
- `XDG_CONFIG_HOME`：标准 XDG 配置目录；
- `OPENCODE_WEIBO_HOME`：直接指定插件数据目录。

首次加载时，如果 `settings.json` 不存在，会尝试读取旧的 `~/.dsh/foxy-weibo/settings.json` 并迁移。

Cookie 和 API Key 只保存在本机，`weibo_status` 和设置页只返回 `cookieSet` / `llmApiKeySet` 布尔值。

## 记忆

OpenCode 没有 `foxyMemory` provider，插件改用本地 JSONL：

- 阅读博文：`weibo_owner_post`
- 评论博文：`weibo_comment`
- 回复楼中楼：`weibo_reply`
- 阶段回顾：`weibo_digest`

每条记录包含 `at`、`text`、`eventType`、`channelId`、`url` 等字段。判断时会读取最近 8 条作为上下文；`weibo_memory` 可以按关键词搜索。

## 快速提取记忆

设置页「快速提取记忆」把全部历史博文一次性整理成长期记忆：

- 分组单位：按周、按月或按年；每组只写入一条阶段记忆；
- 读取范围：监控账号的全部可见博文；
- 每组内容：阶段总结 + 最多 5 条重要事件；
- 记忆正文以 `我在微博回顾了 YYYY-MM-DD 至 YYYY-MM-DD 的博文：...` 开头；
- 提取只读博文，不评论；任务在后台运行，设置页显示当前分组与进度；
- 同一分组完成后不会重复写入；需要重新生成时需更换分组单位或清理 `state.digests`。

提取提示词可在同一卡片中追加，不会改变 JSON 输出契约。

## 建议顺序

1. 扫码登录，填监控账号 UID，`enabled: true`、`replyMode: off`；
2. 设置每日检查时间，或先点「立即检查博文」；
3. 点「立即读取博文」把未读博文写入记忆；
4. 确认判断正常后，再开启 `replyMode: auto`，每日上限先设为 1；
5. 「立即回复」会真实评论一篇，适合测试；「回复楼中楼」只处理针对 Foxy 评论的新回复；
6. 评论有账号风控，不要高频。

## 限制

- 微博没有稳定的官方开放评论 API；Cookie 过期、风控或接口变更会导致读取/评论失败；
- 读取评论使用热门评论接口，可能不是全量；
- 定时任务依赖 OpenCode 服务进程；服务停止时不会运行；
- 设置页属于 OpenCode Desktop 的实验性 GUI API，仅 Desktop 可用；CLI/TUI 仍可使用工具和 RPC。

## 开发

```bash
cd dsh-foxy-weibo
npm test        # 微博接口、核心逻辑、GUI 冒烟测试
npm run check   # node --check 语法检查
```

本地调试时，把插件目录写进 `opencode.json` 后运行：

```bash
opencode serve --port 4599
```

服务日志在 `~/.local/share/opencode/log/opencode.log`，筛选 `foxy-weibo` 可看到加载与运行记录。
