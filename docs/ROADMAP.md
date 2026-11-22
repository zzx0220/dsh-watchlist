# Roadmap

Known todos: designed or decided, not built yet. Each item carries its English
and Chinese wording, English first.

## Known todos / 已知待办

### 1. macOS push: only when there is progress — not started / macOS 推送：只推「有进展」— 未开始

Designed by the user on 2026-11-22; the decision is recorded here until it is built.
用户 2026-11-22 提出的设计，先把结论记在这里，后续实现。

**Trigger / 触发**: push only when this run contains an entry with
`hasUpdate = true`; stay silent when nothing real happened (a separate
`heartbeat` option may allow exceptions).
仅当本轮巡检存在 `hasUpdate = true` 的条目时才推送；无实质进展不打扰（可另配 `heartbeat` 例外）。

**Content / 内容**: one sentence, no details — just the matched topic names or
keywords, for example:
一句话提示，不展开细节，只列命中主题的关键词/短名，例如

> Watchlist: progress on the Riemann hypothesis and P vs NP
> 关注清单：黎曼猜想、P vs NP 有新进展

**Interaction / 交互**: clicking the notification should lead straight to the
content — preferably focus the DeepSeek Harness window on that run's report
(built-in reader); otherwise fall back to opening the report file with the
system default application.
点击通知要能直接进入内容——优先打开 DeepSeek Harness 窗口并定位到该次巡检的报告（内置阅读），做不到时再退化为用系统默认程序打开报告文件。

**Requirements / 要求**:

- One notification per run (never one per `watchlist_record` call).
  一次巡检只发一条（不能在 `watchlist_record` 里逐条发）。
- Text length sized for a system notification (about 60–120 characters), truncated beyond that.
  文案长度按系统通知可读性控制（约 60–120 字），超出截断。
- Clicking needs a definite destination: in the browser, `Notification` plus
  focusing the existing window; on the host side, `activate` through `osascript`.
  Whether a DSH window can be focused and navigated to a given report still has to be verified.
  点击目标要有明确落点：浏览器端可用 `Notification` + focus 现有窗口；Host 端可用 `osascript` 的 `activate`。需要先验证 DSH 窗口能否被聚焦并导航到指定报告。
- Mutually exclusive with `push.mode = per-topic`: only that mode allows per-topic notifications.
  与 `push.mode = per-topic` 互斥：该模式下才允许逐条通知。

**Acceptance / 验收**: 3 topics, 2 of them with progress → one run raises exactly
one notification naming those 2 topics, and clicking it shows that run's report.
3 个主题、其中 2 个有进展 → 一次巡检只弹 1 条通知，文案含那 2 个主题名，点击后能看到该次报告。

### 2. English runtime strings and localizable prompts — not started / 运行时文案英文化与可本地化 — 未开始

The repository is English (comments, docs, commit messages) and Chinese lives
only in localization (`README.zh.md`, `locale/zh.json`, the `zh` dictionary in
`client.js`). The host side still returns Chinese runtime strings: the scheduled
task title, the check prompt, report labels, and tool error messages. Next step:
move them into a dictionary selected by `settings.locale` (`auto` follows the
DSH language) while keeping the default Chinese for existing users.

仓库层面已经是英文（注释、文档、提交信息），中文只保留在本地化资源里
（`README.zh.md`、`locale/zh.json`、`client.js` 的 `zh` 字典）。Host 半仍有中文运行
时文案：定时任务标题、巡检指令、报告标签、工具报错。下一步是把这些收进一份字典，
按 `settings.locale` 选择（`auto` 跟随 DSH 语言），对现有用户默认仍是中文。

**Acceptance / 验收**: with `locale: "en"` a run produces an English task title,
prompt, report and error messages; with `auto` on a Chinese DSH it stays Chinese.
`locale: "en"` 时一次巡检产出的任务标题、指令、报告与报错都是英文；`auto` 在中文
DSH 上仍是中文。
