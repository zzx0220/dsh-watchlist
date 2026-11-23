# @zzx0220/dsh-watchlist

[English](README.md) | **中文**

关注清单：把长期想追的主题记下来，让 DeepSeek Harness 里的 Agent 定期联网找进展、
落盘成日报，并按你的设置推送。

- 不自己实现搜索：复用会话里的 `web_search` / `web_fetch`。
- 不自己实现总结：复用当前对话模型。
- 调度交给 `dsh-schedule`：任务出现在「自动化任务」页面，可暂停、可改、可手动跑。
- 数据是文件：`topics.json`、`settings.json`、`digests/*.md`，能手改、能备份、能同步。
- 两种「重要」：Agent 可把一条发现标为 `high`，未读时它出现在页面顶部的常驻条里、侧栏
  数字变琥珀色；你可以给任意一条发现加星标，读过也不会消失，直到你取消。

## 安装

```sh
dsh plugin --profile desktop add @zzx0220/dsh-watchlist
```

然后**完全退出 DeepSeek Harness 再重新打开**——Host 半是应用启动时加载的模块。
装好后让 Agent 调一次 `watchlist_list`，能看到清单就说明加载成功。

卸载：

```sh
dsh plugin --profile desktop remove @zzx0220/dsh-watchlist
```

数据在 `~/.dsh/watchlist`，删掉这个目录就彻底清除。

如果你要改插件本身，让 profile 指向本地目录：

```sh
dsh plugin --profile desktop add /绝对路径/dsh-watchlist
```

## 快速开始

在任意会话里说：

1. 「帮我加一个关注主题：<某个具体主题>」→ 调用 `watchlist_add`
2. 「开启每天 8:30 巡检，并推一条 macOS 通知」→ `watchlist_settings` + `watchlist_schedule sync`
3. 「现在跑一次」→ `watchlist_schedule run_now`（或直接让 Agent 执行巡检）

## 兼容性

写在 `engines.dsh` 里：**`>=0.2.2-rc.3 <0.3.0`**。范围外的运行时会在安装时直接拒绝，
并打印要求，而不是装上一个从没在它上面验证过的插件、然后半坏。

已验证：

| DSH 版本 | 安装与组合 | Host 接口应答 |
| --- | --- | --- |
| `0.2.2-rc.2` | 拒绝（范围外，符合预期） | — |
| `0.2.2-rc.3` | 通过 | 通过（日常使用的那一版） |
| `0.2.2-rc.4` | 通过 | 未跑 |
| `0.2.2-rc.5`（发布时 latest） | 通过 | 通过 |
| `0.2.3-alpha.2` | 通过 | 未跑 |

维护者可以对任意已发布版本重跑这套检查，不必安装它：

```sh
node scripts/compat.mjs 0.2.2-rc.5 --runtime
```

## 维护

这是一个个人项目，因为自己用着顺手才公开。issue 和 PR 都是尽力而为：会有回复，
但没有期限。具体含义：

- 支持的运行时就是上面表里 `engines.dsh` 的范围。更新的 DeepSeek Harness 也许能用，
  但在表里更新之前不算承诺。
- DSH 发新版导致插件坏掉时，有空就修，不按排期。
- 一份能处理的报告需要包含：插件版本、DSH 版本、操作系统、界面语言。

## 语言

插件写出来的所有文字都跟随 `settings.locale`：`auto`（默认）读系统语言，`zh` 和 `en`
强制指定。范围包括自动化任务标题、投递到会话里的巡检指令、日报标签、工具返回和报错；
应用内页面通过 DeepSeek Harness 自己的语言设置跟随同一档。判断不出来时回退英文。

## 工具

| 工具 | 作用 |
| --- | --- |
| `watchlist_add` | 加主题（可带关键词、备注） |
| `watchlist_remove` | 删主题（id 或唯一名称） |
| `watchlist_list` | 看清单、设置、调度状态 |
| `watchlist_run_brief` | 巡检开始时的权威 brief：主题、回溯天数、推送方式 |
| `watchlist_record` | 记录单个主题的巡检结果到当天日报；可选 `importance: "high"` |
| `watchlist_schedule` | `sync` / `pause` / `resume` / `remove` / `run_now` |
| `watchlist_settings` | 查看或局部修改设置（JSON patch） |

## 重要信息

一条发现有两种「重要」，页面分开处理：

- **Agent 判定**：`watchlist_record({ importance: "high" })`，用于会改变判断或需要行动的消息。
  报告未读时它常驻页面标题下方的条带（在滚动区之外，不会被滚走），历史里带「重要」标签，
  侧栏计数变琥珀色。
- **你的星标**：历史每行的 `☆`。星标条目一直留在顶部条里，直到你取消，与是否已读无关。

读掉一份报告只会清掉 Agent 的标记（那时它已经不是新闻了），不会清掉你的星标。

## 设置

设置存在 `<dataDir>/settings.json`，`cordis.patch.yml` 里的 config 只是初值；
运行期改动优先，升级不丢。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `dataDir` | `$DSH_HOME/watchlist` | 清单与日报目录 |
| `lookbackDays` | 7 | 每次搜索回溯多少天 |
| `maxTopicsPerRun` | 8 | 单轮最多跑几个主题（控 token） |
| `timeZone` | `Asia/Shanghai` | 调度与日报日期用的时区 |
| `schedule.enabled` | `true` | 是否自动巡检；清单为空时不建任务、不执行 |
| `schedule.frequency` | `daily` | `daily` / `weekly` / `monthly` |
| `schedule.time` | `08:30` | 执行时刻 |
| `schedule.weekdays` | `[1]` | 每周几（ISO，1=周一） |
| `schedule.monthday` | 1 | 每月几号 |
| `push.channels` | `["session"]` | `session` / `macos` |
| `workspaceDir` | `null` | 巡检会话的工作目录，默认用 Host 默认目录 |
| `locale` | `auto` | 界面语言：`auto`（跟随 DSH）／`zh`／`en`；其他语言显示英文 |
| `promptHint` | `true` | 是否在系统提示里加一句提醒，让任意会话的 agent 知道可以用 `watchlist_*` |

## 数据文件

```text
<dataDir>/
├── topics.json     # 主题
├── settings.json   # 运行期设置
├── state.json      # 调度任务 id、最近巡检时间、当前 run
└── digests/
    ├── runs.json                       # 巡检索引（机读，仍按次一条）
    └── day-2026-11-22.md               # 每日最多一份报告，同一天多次巡检各占一节
```

## 检查频率

- 全局 `schedule.frequency` 既是调度节拍，也是**新主题的默认间隔**（每天=1、每周=7、每月=30 天）。
- 每个主题可以有自己的间隔：`watchlist_add({ topic: "...", everyDays: 3 })`。
- 每次巡检只挑**到期**的主题；报告仍按「这次巡检」生成一份，里面只有本轮检查的条目。
- 没有到期主题时，那一轮直接跳过，不生成空报告。
- 设置页把全局设置标为「默认巡检设置」；添加主题时可选间隔，列表里每行也能随时改。

## 限制

- **Host 必须运行**：调度由 `dsh-schedule` 负责，App 关着不会触发。
- **启动补检**：错过计划时间（关机／关 App）后重新启动，插件会补投一轮；检索窗口自动取「上次巡检到现在」（最长 30 天），只生成**一份**报告，不按天数补多份。
- **需要 web 搜索能力**：模型请求里没有 `web_search` 时，巡检只能空跑。
- **macOS 通知由应用内客户端发出**：一次巡检只发一条、仅在本轮有进展时发，点击可直接打开该次报告；
  通知由渲染进程发出（归属 DeepSeek Harness），所以需要 App 在运行、并在 系统设置 → 通知 里允许；
  设置页有「发一条测试通知」按钮可随时验证。
- 巡检任务的 prompt 保持稳定，改设置只改时间/推送方式；要改指令本身请编辑任务或重装。

## 自检与回归

- `npm run check` 串跑两个自检：逻辑层（`scripts/smoke.mjs`）与客户端注册/渲染/语言（`scripts/client-check.mjs`），不依赖 Harness 运行。
- [docs/TESTING.md](docs/TESTING.md) 是手工回归计划：按层（加载、8 个工具、界面、数据文件、推送）列用例与预期输出，另有 10 分钟快速通道和故障排查表。

## 隐私

插件只在本机写文件，不联网、不带遥测；联网检索由 Agent 的 `web_search` 发起，
遵守 Harness 的搜索与网络策略。
