# Roadmap

## Known follow-ups

### 1. macOS notification: only on progress, one line, clickable — done (2026-11-22)

Design agreed on 2026-11-22. Recorded here so the later implementation has a fixed target.

**Implementation** — the Host's `osascript` path was removed: macOS attributes those notifications to Script Editor, so a click opened the wrong app. The client half now posts through the renderer's `Notification` API (attributed to DeepSeek Harness), remembers the last notified run in `localStorage`, waits for a quiet period so the run is listed whole, and routes a click to the run's report in the right sidebar tab, falling back to the in-app reader. The settings page has a "send a test notification" button to verify the system permission.

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

### 2. UI polish: footer entry and report Markdown — awaiting user design (2026-11-22)

Two things the user is not satisfied with. The change itself is not decided yet: the
user will describe the intended look, and this section should then be turned into a
concrete spec. Do not implement a guessed design before that.

1. **Bottom-left watchlist entry** — the icon plus label in the left nav footer looks
   stiff and plain. `.dwl-footer-btn` in `client.js` is a flat transparent button: a
   16×16 SVG bullseye (three concentric circles), a 12px label when the nav is wide, and
   an unread badge; the only state change is a hover background.
2. **Right-sidebar report rendering** — reports look bad as rendered. The `Markdown`
   component in `client.js` is a deliberate minimal renderer: `# ` / `## ` heading lines
   become styled divs, `-` / `*` bullets become one `<ul>`, and inline text supports only
   `**bold**` plus bare URLs. Paragraphs are plain divs with a 3px vertical margin, so
   there are no code blocks, blockquotes, tables, horizontal rules, nested lists, or a
   third heading level, and no reading column. Both the in-app reader body
   (`.dwl-reader-body`) feeds that component. The right-sidebar report tab this
   section used to mention was removed with the page rework, so the reader is the
   only report surface left.

**Progress (2026-11-22)** — the structural half is done on branch `ui/sidebar-panel`:
the footer entry is gone, the plugin registers a `sidebar.panellist` row beside
Plugins and Automation, and a keyed `main` page shows the whole list in the centre
column (topics, a read-only status line, report history). Settings stay in
Settings → Watchlist, so the page is not a second copy of the settings form.
Still open: the final visual design of the row, the page, and the report Markdown
renderer.

---

## 已知待办

### 1. macOS 推送：只推"有进展"，一句话、可点击 — 已完成（2026-11-22）

用户 2026-11-22 提出的设计，先把结论记在这里，后续实现。

**实现说明**：Host 的 `osascript` 路线已移除——系统把这类通知归到 Script Editor 名下，点击会打开错误的 App。改由客户端半用渲染进程的 `Notification` API 发送（归属 DeepSeek Harness），用 `localStorage` 记住上次已通知的 run，等本轮写入静默后再发，保证一次巡检只发一条且主题列全；点击优先打开右侧栏该次报告，失败回退到应用内阅读器。设置页新增「发一条测试通知」按钮，用于验证系统权限。

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

### 2. 界面美化：左下角入口与报告 Markdown——等用户给出改法（2026-11-22）

用户明确提出两处不满意。改法尚未确定：等用户描述想要的效果后，再把本节改写成
可执行的规格。在此之前不要按猜测动手。

1. **左下角关注清单入口**——左侧导航底部那枚「图标 + 文字」按钮观感呆板、单调。
   `client.js` 里的 `.dwl-footer-btn` 是裸的透明按钮：一枚 16×16 的 SVG 圆环靶心（三层
   同心圆）+ 导航展开时的 12px 文字标签 + 未读角标；唯一的交互反馈是 hover 变背景。
2. **右侧栏报告渲染**——报告渲染出来不好看。`client.js` 的 `Markdown` 组件是刻意做的
   最小实现：`# ` / `## ` 行变成带样式的 div，`-` / `*` 列表收成一个 `<ul>`，行内只认
   `**加粗**` 和裸 URL。段落是 3px 上下边距的普通 div，因此没有代码块、引用、表格、
   分隔线、嵌套列表，也没有第三级标题，更没有阅读栏宽。应用内阅读器正文
   （`.dwl-reader-body`）用同一个组件。本节原先还提到右侧栏报告标签页，它已随整页改造
   一起移除，现在阅读器是唯一的报告界面，
   所以改法要同时照顾这两种宽度下的观感。

**进展（2026-11-22）**——结构部分已在 `ui/sidebar-panel` 分支完成：左下角入口已移除，
改为 `sidebar.panellist` 的一行，与「插件」「自动化任务」并列；并注册了一个 keyed
`main` 页面，在中间列整页显示清单内容（主题、一列只读状态、报告历史）。调度/推送/语言
留在 设置 → 关注清单，页面不再重复一遍设置表单。仍未完成：该行、整页和报告 Markdown
渲染器的最终视觉设计。
