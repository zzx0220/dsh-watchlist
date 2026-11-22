# dsh-watchlist

关注清单：把长期想追的主题记下来，让 DeepSeek Harness 里的 Agent 定期联网找进展、
落盘成日报，并按你的设置推送。

- 不自己实现搜索：复用会话里的 `web_search` / `web_fetch`。
- 不自己实现总结：复用当前对话模型。
- 调度交给 `dsh-schedule`：任务出现在「自动化任务」页面，可暂停、可改、可手动跑。
- 数据是文件：`topics.json`、`settings.json`、`digests/*.md`，能手改、能备份、能同步。

## 安装

本机目录安装：**Plugins → Add plugin**，选择本仓库目录；或

```sh
dsh plugin --profile desktop add /绝对路径/dsh-watchlist
```

## 快速开始

在任意会话里说：

1. 「帮我加一个关注主题：<某个具体主题>」→ 调用 `watchlist_add`
2. 「开启每天 8:30 巡检，推微信」→ `watchlist_settings` + `watchlist_schedule sync`
3. 「现在跑一次」→ `watchlist_schedule run_now`（或直接让 Agent 执行巡检）

## 工具

| 工具 | 作用 |
| --- | --- |
| `watchlist_add` | 加主题（可带关键词、备注） |
| `watchlist_remove` | 删主题（id 或唯一名称） |
| `watchlist_list` | 看清单、设置、调度状态 |
| `watchlist_run_brief` | 巡检开始时的权威 brief：主题、回溯天数、推送方式 |
| `watchlist_record` | 记录单个主题的巡检结果到当天日报 |
| `watchlist_schedule` | `sync` / `pause` / `resume` / `remove` / `run_now` |
| `watchlist_settings` | 查看或局部修改设置（JSON patch） |

## 设置

设置存在 `<dataDir>/settings.json`，`cordis.patch.yml` 里的 config 只是初值；
运行期改动优先，升级不丢。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `dataDir` | `$DSH_HOME/watchlist` | 清单与日报目录 |
| `lookbackDays` | 7 | 每次搜索回溯多少天 |
| `maxTopicsPerRun` | 8 | 单轮最多跑几个主题（控 token） |
| `timeZone` | `Asia/Shanghai` | 调度与日报日期用的时区 |
| `schedule.enabled` | `false` | 是否自动巡检（默认关，开了才建任务） |
| `schedule.frequency` | `daily` | `daily` / `weekly` / `monthly` |
| `schedule.time` | `08:30` | 执行时刻 |
| `schedule.weekdays` | `[1]` | 每周几（ISO，1=周一） |
| `schedule.monthday` | 1 | 每月几号 |
| `push.channels` | `["session"]` | `session` / `macos` / `wechat` |
| `workspaceDir` | `null` | 巡检会话的工作目录，默认用 Host 默认目录 |
| `locale` | `auto` | 界面语言：`auto`（跟随 DSH）／`zh`／`en`；其他语言显示英文 |

## 数据文件

```text
<dataDir>/
├── topics.json     # 主题
├── settings.json   # 运行期设置
├── state.json      # 调度任务 id、最近巡检时间
└── digests/
    └── 2026-11-22.md
```

## 限制

- **Host 必须运行**：调度由 `dsh-schedule` 负责，App 关着不会触发；重启后只补最近一次。
- **需要 web 搜索能力**：模型请求里没有 `web_search` 时，巡检只能空跑。
- **微信推送需要另装微信插件**：本插件只负责在 brief 里告诉 Agent「该推微信」，实际调用
  `notify_wechat` 由 Agent 完成；没装就退回会话内输出。
- **macOS 通知走 `osascript`**，仅在本机生效，不跨设备。
- 巡检任务的 prompt 保持稳定，改设置只改时间/推送方式；要改指令本身请编辑任务或重装。

## 隐私

插件只在本机写文件，不联网、不带遥测；联网检索由 Agent 的 `web_search` 发起，
遵守 Harness 的搜索与网络策略。
