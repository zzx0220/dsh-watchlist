# Roadmap

## Known follow-ups

### 1. macOS notification: only on progress, one line, clickable — not started

Design agreed on 2026-11-22. Recorded here so the later implementation has a fixed target.

**Trigger** — only when the run contains at least one entry with `hasUpdate = true`. A run with no progress stays silent unless `heartbeat` is enabled.

**Content** — one short line, no details, just the short names or keywords of the topics that changed, e.g.

> Watchlist: progress on Riemann hypothesis, P vs NP

**Click** — opening the notification should land on the content itself: prefer activating the DeepSeek Harness window and navigating to that run's report; fall back to opening the report file with the system default application when activation is not possible.

**Constraints**

- One notification per run; never one per `watchlist_record`.
- Keep the text within native notification readability (roughly 60–120 characters), truncating beyond that.
- The click target must be concrete: browser side can use `Notification` plus focusing the existing window; host side can use `osascript` `activate`. Verify that the DSH window can be focused and routed to a specific report first.
- Mutually exclusive with `push.mode = per-topic`; per-topic notifications are allowed only in that mode.

**Acceptance** — 3 topics, 2 with progress → exactly one notification per run, naming those 2 topics, and clicking it shows that run's report.

---

## 已知待办

### 1. macOS 推送：只推"有进展"，一句话、可点击 — 未开始

用户 2026-11-22 提出的设计，先把结论记在这里，后续实现。

**触发**：仅当本轮巡检存在 `hasUpdate = true` 的条目时才推送；无实质进展不打扰（可另配 `heartbeat` 例外）。

**内容**：一句话提示，不展开细节，只列命中主题的关键词/短名，例如

> 关注清单：黎曼猜想、P vs NP 有新进展

**交互**：点击通知要能直接进入内容——优先打开 DeepSeek Harness 窗口并定位到该次巡检的报告（内置阅读），做不到时再退化为用系统默认程序打开报告文件。

**要求**：

- 一次巡检只发一条（不能在 `watchlist_record` 里逐条发）。
- 文案长度按系统通知可读性控制（约 60–120 字），超出截断。
- 点击目标要有明确落点：浏览器端可用 `Notification` + focus 现有窗口；Host 端可用 `osascript` 的 `activate`。需要先验证 DSH 窗口能否被聚焦并导航到指定报告。
- 与 `push.mode = per-topic` 互斥：该模式下才允许逐条通知。

**验收**：3 个主题、其中 2 个有进展 → 一次巡检只弹 1 条通知，文案含那 2 个主题名，点击后能看到该次报告。
