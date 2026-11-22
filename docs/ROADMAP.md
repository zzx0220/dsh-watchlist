# Roadmap

## Known follow-ups

### 1. macOS notification: only on progress, one line, clickable — done (2026-11-22)

Design agreed on 2026-11-22. Recorded here so the later implementation has a fixed target.

**Implementation** — the Host's `osascript` path was removed: macOS attributes those notifications to Script Editor, so a click opened the wrong app. The client half now posts through the renderer's `Notification` API (attributed to DeepSeek Harness), remembers the last notified run in `localStorage`, waits for a quiet period so the run is listed whole, and routes a click to the run's report (the right sidebar tab at the time; since `6c6bafc` it opens the reader directly). The settings page has a "send a test notification" button to verify the system permission.

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

### 3. Read a digest beside the conversation — idea only, not scheduled (2026-11-23)

While talking to the agent about a topic, it would be nice to keep the day's report open
in the right column instead of covering the chat with the modal reader.

**Why this is not the old right-sidebar tab.** That tab was removed in `6c6bafc` because it
could not work from where users read reports. DSH's right column is session-scoped: its
commands act on the session on screen, and a session is on screen only while the
Conversation fills the middle column. The watchlist page takes that column, so any button
on the page has no session to open a tab into. Restoring the tab without a
conversation-side entry point would just bring back a button that fails.

**What it would take.** An entry point that lives inside a conversation and is rendered
while the conversation is still on screen — for example a card on the result of
`watchlist_run_brief` / `watchlist_record`, offering "open today's report on the right" —
which then registers/opens a tab through the sidebar-right service. The reader stays for
every other path (page history, notification click).

**Open questions.** Card on the tool result versus a link in the agent's prose; which slot
owns that card and whether it is per-tool or generic; whether the right column exists at
narrow widths; whether the tab follows the day file or the run that opened it.

**State.** Deferred on purpose. Revisit after the UI polish item (2) and the page's visual
design have settled, and decide then whether the scenario is worth the extra contract.

---

## 已知待办

### 1. macOS 推送：只推"有进展"，一句话、可点击 — 已完成（2026-11-22）

用户 2026-11-22 提出的设计，先把结论记在这里，后续实现。

**实现说明**：Host 的 `osascript` 路线已移除——系统把这类通知归到 Script Editor 名下，点击会打开错误的 App。改由客户端半用渲染进程的 `Notification` API 发送（归属 DeepSeek Harness），用 `localStorage` 记住上次已通知的 run，等本轮写入静默后再发，保证一次巡检只发一条且主题列全；点击优先打开右侧栏该次报告，失败回退到应用内阅读器。设置页新增「发一条测试通知」按钮，用于验证系统权限。
（**2026-11-23 变更**：右侧栏标签页已移除（`6c6bafc`），点击改为直接打开应用内阅读器。）

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
   一起移除，现在阅读器是唯一的报告界面。

**进展（2026-11-22）**——结构部分已在 `ui/sidebar-panel` 分支完成：左下角入口已移除，
改为 `sidebar.panellist` 的一行，与「插件」「自动化任务」并列；并注册了一个 keyed
`main` 页面，在中间列整页显示清单内容（主题、一列只读状态、报告历史）。调度/推送/语言
留在 设置 → 关注清单，页面不再重复一遍设置表单。仍未完成：该行、整页和报告 Markdown
渲染器的最终视觉设计。

### 3. 边聊边看日报——只是记下来，暂不排期（2026-11-23）

和 Agent 聊某个话题时，如果能把当天的报告摊在右侧、而不是用浮层遮住对话，体验会更好。

**这不等于是恢复旧的右侧栏标签页。** 那个标签页已在 `6c6bafc` 移除，因为它在用户读报告的地方根本跑不通。
DSH 的右侧栏是会话作用域的：命令只作用在"屏幕上的会话"，而会话只在对话占据中间列时存在。
关注清单整页占掉了中间列，所以页面上的任何按钮都没有会话可开。只把标签页加回来、不加会话内的入口，
等于把一个会失败的按钮又装回去。

**要做需要什么。** 一个**位于会话内**、且渲染时对话仍在中间列的入口——例如在
`watchlist_run_brief` / `watchlist_record` 的结果上挂一张卡片，提供"在右侧打开今天的报告"，
再由它通过 sidebar-right 服务注册/打开标签页。其他路径（页面历史、通知点击）继续用阅读器。

**待定的问题。** 卡片挂在工具结果上还是写进 Agent 正文的链接；那张卡片归哪个槽、按工具还是通用；
窄宽度下右侧栏是否还存在；标签页跟随"当天文件"还是"打开它的那次巡检"。

**状态**：刻意搁置。等第 2 项界面美化、整页的视觉设计定下来之后再回来看，那时候再判断这个场景值不值得多绑一套契约。

### 4. Important information: Agent-flagged and user-starred — done (2026-11-23)

The list records a lot of "nothing to report" and a little news; among the news, some is
ordinary and some should not wait for the user to open a report. The design splits that
in two, because the two kinds have different owners and different lifetimes.

**Agent's call.** `watchlist_record` takes `importance: "high" | "normal"`. `hasUpdate`
answers "did anything happen"; `importance` answers "does the user need to know now".
Tool description and the scheduled prompt both say to use `high` only for news that
changes the picture, needs an action, or is a major breakthrough. A high entry is
written to the digest as `- 重要：是`.

**User's star.** Every entry now carries its own id (`e_…`, derived as `run:<index>` for
records written before ids existed), so a star points at one finding rather than a whole
report. `state.json` keeps `starredEntryIds`; stars are pruned to runs still on disk on
every write. A star survives reading the report — reading retires the Agent's flag,
because by then it is no longer news, but never clears a star.

**Surfacing.**

- A band under the page header, outside the scroll box: unread `high` entries plus every
  starred entry, newest first, capped at four. It is absent when empty, so it never
  steals space from the list.
- History rows: an accent bar and an `重要` tag for high entries; a `☆`/`★` toggle on
  every row.
- Sidebar badge: the number still counts unread progress, but turns amber while any of
  them is high — "one important" is a different kind of news than "three ordinary".
- Native notification: content still one line, prefixed `重要：` when the run has a high
  entry, and the high topics are listed first.

**Verification** — `scripts/smoke.mjs` covers importance round-trip, derived ids for old
records, star persistence across read, the band's composition, and the counters;
`scripts/client-check.mjs` covers the band, the star click payload and the amber badge.
