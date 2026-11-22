# Testing dsh-watchlist

*Applies to v0.6.0. Run this after a feature change, before a release, and
whenever a report, a badge, or a notification "looks wrong".*

The plugin is no longer one screen: eight Host tools, one loopback HTTP API, a
scheduler task, four client slots, native notifications, and a file-based report
store. "Open the panel and see something" does not prove any of that works. This
file is the repeatable pass — what to run, what to expect, and where it usually
breaks.

Two rules keep it useful:

- Every new surface gets at least one case here, and every fixed bug gets a case
  that would have caught it.
- Expected strings are literal. Host runtime copy is still Chinese (see
  `AGENTS.md`), so messages below are quoted as they appear today; update them in
  the same commit that changes the copy.

## 1. What is under test

| Layer | Surface | Cases |
| --- | --- | --- |
| L0 | `lib/store.js` logic, client registration/render | 3 checks + 1 wrapper |
| L1 | plugin loading, tool registration, HTTP API, client slots | 5 |
| L2 | the 8 `watchlist_*` tools | 9 |
| L3 | settings page, nav entry, main page, reader, right tab, notifications, language | 8 |
| L4 | files on disk, report format, unread counting, path guards | 5 |
| L5 | push channels (session / macOS / WeChat) | 3 |

## 2. Before you start

- DeepSeek Harness desktop is running, and the profile links this checkout:
  `~/.dsh/profiles/<profile>/package.json` contains
  `"dsh-watchlist": "link:/path/to/dsh-watchlist"`.
- Node 22+ (this checkout is tested on Node 26).
- Know the data directory. Default: `$DSH_HOME/watchlist`, i.e.
  `~/.dsh/watchlist`. The settings page and `watchlist_list` both print it.
- Tests below mutate that directory. Back it up first:

  ```sh
  cp -R ~/.dsh/watchlist ~/watchlist-backup-$(date +%Y%m%dT%H%M%S)
  ```

  Restore by copying the backup back over the directory (quit the app while you
  do it, or reload the plugin afterwards).
- Prefix every topic you create with `[test]`, and remove it at the end; the
  panel and the day file are supposed to stay clean.
- For L3 keep DevTools open: a deleted helper in `client.js` shows up as a
  `ReferenceError` at render time, not at load time.

## 3. L0 — automated checks (no Harness, no data)

Run from `dsh-watchlist/`:

| ID | Command | Pass |
| --- | --- | --- |
| L0.1 | `node scripts/smoke.mjs` | last line `All checks passed`, exit 0 |
| L0.2 | `node scripts/client-check.mjs` | `copy keys: complete`, the four slot names, `labels(en)`, `labels(zh)`, `labels(ja)`, six `render …: ok` lines, `All checks passed` |
| L0.3 | `node --check index.js && node --check client.js && node --check lib/store.js` | no output, exit 0 |
| L0.4 | `npm run check` | runs L0.1 + L0.2 in one go |

L0.1 covers topic add/dedupe, per-topic cadence, settings clamping, one file per
day with one section per run, record-without-brief, unread counting, and legacy
migration. L0.2 covers slot registration, the language switch, and a recursive
render of all six components. **Neither touches scheduling, HTTP, real
notifications, or interaction** — those are L1–L5.

`scripts/` is dev-only (not in the published `files` list), so these commands
need a checkout, not the installed package.

## 4. L1 — loading and wiring

**L1.1 Tools registered.** In a conversation, call `watchlist_list` with no
arguments. Expected: four lines — `关注清单：N 个主题` plus one line per topic,
`调度：…`, `推送：…`, `窗口：…｜数据目录：…` — and a JSON payload with `topics`,
`settings`, `task`. If the tool name is unknown, the Host half is not loaded:
check Settings → Plugins that `include:watchlist` is enabled, then reload
(disable → enable).

**L1.2 HTTP API.** Use the port from the DSH web GUI URL
(`http://127.0.0.1:<port>`):

```sh
curl -s http://127.0.0.1:<port>/dsh-watchlist-api/state | head -c 300
```

Pass: `{"ok":true,"dataDir":…,"topics":[…],"settings":{…},"schedule":{…},"runs":[…],"unread":…}`.
`ok:false` or 404 means the Host's `webServer` route did not register (it retries
briefly at load, then gives up); the plugin still works through the tools, only
the UI is blind.

**L1.3 Reload without data loss.** Disable and re-enable `include:watchlist`
(`plugin_manager set_plugin`, `false` then `true`). Pass: tools respond again,
topics and digests unchanged, settings unchanged, and the task's next fire time
(`scheduledAt`) is unchanged. Its `updatedAt` may bump on reload because of 9.1 —
that is the known defect, not a new one.

**L1.4 Every client surface renders.** Settings → Watchlist shows the page; the
left sidebar lists `关注清单` beside `插件` / `自动化任务` and selecting it shows the
full page in the centre column; the right sidebar can open the `关注清单` report
tab; opening a report from that page shows the reader. Any blank surface with a
console `ReferenceError` fails L1.4 even if the others work.

**L1.5 Version.** Settings → Plugins shows `dsh-watchlist` at the version in
`package.json` (`0.6.0`). A stale version after an edit means the profile link
points at another copy.

## 5. L2 — Host tools

Call these through the agent (that is how users reach them). "Pass" means both
the message and the JSON payload match, because the agent and the client read
different halves.

### L2.1 `watchlist_add`

1. `topic: "[test] Alpha"` → `已加入：「[test] Alpha」（共 N 个主题）`, payload
   `added: ["[test] Alpha"]`, `total` incremented. `topics.json` gains an id of
   the form `t_` + 8 hex characters and `everyDays: null`.
2. Same topic again, with surrounding spaces → `已在清单里：「[test] Alpha」`,
   no new record, file count unchanged (dedupe is by normalized name).
3. `topics: ["[test] Beta", "[test] Gamma"]` → both added in one call; passing
   the same name as `topic` and in `topics` adds it once.
4. `keywords: ["a", "b"]`, `note: "what counts as progress"`, `everyDays: 3` →
   persisted in `topics.json`; the next `watchlist_run_brief` shows `每 3 天`,
   the keywords, and the trimmed note for this topic.
5. Empty call → `需要 topic 或 topics：告诉我至少一个主题`, `ok: false`, nothing
   written.
6. With an empty list and `schedule.enabled = true`, the first successful add
   creates the Automation task (`关注清单巡检`) — check Settings → Automation (or
   `schedule_list`). With auto-run off, no task is created.

### L2.2 `watchlist_update`

1. `target: "[test] Alpha", everyDays: 7` → `已更新「[test] Alpha」：间隔 每 7 天`.
2. `everyDays: 0` → interval back to `跟随全局默认` (`everyDays: null` in the file).
3. `note` / `keywords` only → fields change, interval message still prints the
   current state.
4. Unknown target → `清单里没有「…」`, `ok: false`.
5. A fragment shared by two topics → the call errors with
   `有 2 个主题匹配「…」，请用 id 指定：…`; nothing changes.

### L2.3 `watchlist_remove`

1. By id → `已移除「…」，剩 N 个主题`.
2. By unique name → same.
3. By an ambiguous fragment shared by two topics → the call errors with
   `有 2 个主题匹配「…」，请用 id 指定：<id>(<topic>)、…`; nothing is deleted
   (ambiguous names must never delete).
4. Removing the last topic leaves the Automation task in place; the next run
   skips with `关注清单是空的：本次不巡检。` (documented behavior, not a bug).

### L2.4 `watchlist_list`

Read-only. Pass: every topic line has name, id, and `上次巡检 <date>` or
`尚未巡检`; the schedule line carries the timing and task status; the push line
carries the configured channels; `dataDir` matches the settings page.

### L2.5 `watchlist_run_brief`

1. Empty list → `skip: true`, `reason: "empty"`, no run opened.
2. Immediately after a recent run → `刚刚已经开过一次巡检（30 分钟内），本轮跳过`,
   `skip: true`. (Guard against double runs.)
3. Every topic checked within its own interval → `本轮没有到期的主题`, `skip: true`,
   nothing appended to any day file.
4. At least one due topic → `runId`, `runSeq`, `day`, `reportPath`, `from`, `to`,
   and per-topic `from`; count capped by `maxTopicsPerRun`; the message lists
   `窗口 <from> → 现在`, per-topic `每 N 天`, keywords and note.
5. Window rule: a topic with `lastCheckedAt` uses that timestamp; a never-checked
   topic falls back to `now - lookbackDays`; the run's `from` is the earliest of
   those.
6. `reportPath` is `<dataDir>/digests/day-<YYYY-MM-DD>.md` for today in
   `settings.timeZone`, and a second run that day reports `第 2 次` in the message.

### L2.6 `watchlist_record`

1. By topic name, by id, and by a unique partial name → all resolve;
   `已记录「…」→ <day file>（本次第 N 条｜当日第 M 条）`.
2. Unknown topic → `清单里没有「…」，先 watchlist_add 再加记录`, `recorded: false`.
3. `hasUpdate: true` with `sources` and `note` → the day file section is
   `### <topic>`, `- 状态：有实质进展`, `- 摘要：…`, an indented `- 来源：` list,
   `- 备注：…`.
4. `hasUpdate: false` → `- 状态：无实质进展`.
5. Two records in the same run → same file, `dayTotal` 1 → 2, one `## 第 N 次巡检`
   section.
6. Record without a preceding brief → its own run and day file open; payload has
   `runId`, `path`, `runTotal: 1`.
7. After a topic is recorded, `topics.json` shows a fresh `lastCheckedAt` and
   `lastRunAt`; the topic drops out of the next run's due set once the 30-minute
   guard has passed.

### L2.7 `watchlist_settings`

1. No `patch` → four summary lines: lookback/timezone/max topics, schedule,
   push, data dir. No file written.
2. `{"lookbackDays":3}` → `设置已更新` and the summary shows 3;
   `settings.json` gains the key.
3. Clamping: `{"lookbackDays":1000}` → 90; `{"schedule":{"time":"9:00"}}` → falls
   back to `08:30`; `{"schedule":{"frequency":"hourly"}}` → `daily`.
4. Invalid JSON → `patch 不是合法 JSON`, `ok: false`, file untouched.
5. `{"schedule":{"time":"09:15"}}` → note `（任务已同步：每天 …）` and the
   Automation task's next run moves to 09:15 (verify with `schedule_list`).
6. `{"locale":"en"}` → the client page is English after the next state refresh.

### L2.8 `watchlist_schedule`

1. `sync` → `巡检任务已创建/更新：<timing>（任务 id …）`; `schedule_list` shows one
   `关注清单巡检` task, next trigger = `scheduledAtLocal`.
2. `sync` twice with unchanged settings → the second call should be a no-op. Today
   it prints `已更新` again; see 9.1.
3. `pause` → `已暂停自动巡检`, task status paused, next run stops; `resume`
   reverses it.
4. `remove` → `已删除自动巡检任务`, task gone, `state.json.scheduleTaskId` null;
   `run_now` then fails with `还没有巡检任务，先 watchlist_schedule sync`.
5. `run_now` with a task → `已投递一次巡检，目标会话马上开始执行`; the run appears
   in that session, and `schedule_list` records `lastDelivery`.
6. No `dsh-schedule` service in the profile → `当前 profile 没有挂载 dsh-schedule`,
   `ok: false`.

### L2.9 Startup catch-up (optional, slow)

Purpose: a schedule missed while the app was closed produces exactly one run.

1. Set a test data directory where the topic is due (`everyDays: 1`,
   `lastCheckedAt` older than a day — edit `topics.json` by hand or wait).
2. Set the schedule time a few minutes ahead, quit the app, reopen after the time
   has passed.
3. Pass: exactly one catch-up run is delivered to the task session; its window
   starts at the last run; a day with no due topics produces no run and no empty
   report.

## 6. L3 — client surfaces

The client reads only the loopback API and polls every 60 s; after any Host-side
change, wait for a poll or reopen the surface before judging it.

### L3.1 Settings → Watchlist

- Header shows data dir and topic count.
- Add: type a topic, Enter (or 添加) adds it; the interval select next to the
  input applies to the new topic (跟随默认 / 每天 / 每周 / 每月).
- Each row: interval select changes that topic only (`update-topic`), 删除 removes
  the row immediately.
- Default schedule block: 自动巡检 checkbox, 频率, 时间, 回溯天数, 单轮上限, and a
  `下次触发 <timing>` line with task status.
- 推送: session and macOS checkboxes are live; WeChat is disabled with its
  explanation. At least one channel always stays selected.
- 发一条测试通知 → system notification `关注清单测试通知` (or an inline hint when
  permission is denied / unsupported).
- 界面语言: 跟随 DSH / 中文 / English; see L3.8.
- Save feedback: no red error line; the change survives a page reload.
- The time field patches on every keystroke; an invalid intermediate value falls
  back to `08:30`, so clear it, type the full `HH:MM`, then confirm
  `settings.json` and the `下次触发` line.

### L3.2 Sidebar entry (nav list)

- The entry sits in the left sidebar's panel list, beside `插件` and
  `自动化任务` — not in the footer, and with the host's own row styling (glyph
  plus label, selected background) rather than a custom button.
- Collapsed sidebar: only the 16–18px glyph shows, with the same tooltip as the
  other rows.
- Unread dot on the glyph while entries are unread; it clears after the page or a
  report is opened, and never reappears for the same entries.
- Selecting the row shows the plugin's page in the centre column and marks the
  row selected; it never opens a modal or a floating panel.

### L3.3 Main page (the whole list)

- Header: eyebrow label, title, one-line subtitle, `立即运行一次`, and an
  `N 未读` chip while unread.
- Topics card: add row (input + interval + 添加) and one card per topic with name,
  keywords, `上次巡检 …`, its own interval select, and 删除.
- Default-schedule card: 自动巡检, 频率/时间, 回溯天数/单轮上限, and the
  `下次触发 …` line with task status.
- Push card: session and macOS toggles (WeChat disabled), test-notification
  button and its inline result.
- Language card: 跟随 DSH / 中文 / English.
- Reports card: one block per day file, header `YYYY-MM-DD` and `N 次巡检 · M 条`,
  then one row per topic that opens the reader for that file. Empty state
  `还没有巡检记录。`.
- The page scrolls inside the centre column; the header stays put and nothing
  overflows the column at 480px, 900px, and full width.

### L3.5 Reader

- Title `关注清单 · <from> → <to>`, path line, and rendered markdown. The
  renderer covers only what the reports themselves contain: `#` and `##`
  headings styled, bullets, `**bold**`, and bare URLs turned into `target=_blank`
  links. It does **not** handle `###`, `[label](url)`, or code spans — today a
  `### <topic>` line shows up literally as `### <topic>`; treat that as a known
  cosmetic gap and write a case here when it is fixed.
- Links must open outside the app (system browser) and never replace the card.
- Buttons: `在侧栏打开`, `用外部程序打开` (macOS only; opens the day file with the
  system editor), `关闭`.
- Backdrop click and Esc close the reader and return to whatever was underneath
  (the page, or the app itself when the notification opened it).
- Delete the report file on disk and reopen: the reader shows an error line, not
  a blank card or a crash.

### L3.6 Right sidebar tab

- `在侧栏打开` opens the tab `关注清单` in the right sidebar, titled
  `关注清单 · <day>`, with the same markdown and an `外部打开` button.
- Opening it for another run replaces the content (run id travels as tab
  navigation params, with the module fallback for panes that do not pass params).
- Tab title follows the interface language.
- When the sidebar service is unavailable, the reader shows `打开失败：…` and
  stays usable.

### L3.7 Notifications (macOS)

- Test button (L3.1) posts `关注清单测试通知`; its body says clicking should open
  the latest report, and clicking does.
- Real run with `push.macos` on and at least one `hasUpdate: true` → exactly one
  notification, posted once the run's last entry is at least 60 s old (the client
  polls every 60 s, so allow up to ~2 minutes). Body names up to three short
  topic names, then `等 N 个` when more.
- A run with no progress, or older than two hours, posts nothing.
- No duplicate on refresh: `localStorage["dsh-watchlist-notified-run"]` equals the
  run id.
- Click → the right tab for that run, or the in-app reader when the tab is not
  available. The app window comes forward.

### L3.8 Language

- `跟随 DSH` follows Settings → General → Language; switching DSH language
  updates the plugin's labels without a restart (locale subscription).
- `中文` and `English` pin the language and override DSH.
- Any other DSH locale (`ja`, `fr`, …) shows English.
- Switch both ways and check every surface: settings page, nav label, main page,
  reader, tab title. A label left untranslated is a dictionary gap;
  `client-check.mjs` catches missing keys and undefined labels.

## 7. L4 — data layer

Data dir tree (`<dataDir>`):

```text
topics.json                 # list; id, topic, keywords, note, everyDays, lastRunAt, lastCheckedAt
settings.json               # runtime settings; wins over the bundle patch
state.json                  # scheduleTaskId, lastRunAt, currentRunId, lastSeenAt
digests/
├── runs.json               # run index the UI reads
├── day-YYYY-MM-DD.md       # one report file per day (current format)
└── run-<stamp>.md          # legacy per-run files, if migrated
```

- **One file per day.** Two runs on the same day append two `## 第 N 次巡检
  <time>` sections to the same file; a new day starts a new file. Never a second
  file for the same day in the same timezone.
- **Section body.** Header `# 关注清单日报 <day>` once per file; per run the
  `##` section plus `- 覆盖区间：`; per topic `### <topic>`, `- 状态：`,
  `- 摘要：`, optional `- 来源：` list, optional `- 备注：`.
- **Index consistency.** Every current run in `runs.json` has `id`, `startedAt`,
  `from`, `to`, `entries`, `file`, `day`, and `seq`; every entry has `at`,
  `topic`, `hasUpdate`, `summary`, `sources`, `note`. Migrated legacy runs have
  `legacyFile` instead of `file` and resolve to their old `run-<stamp>.md`.
- **Unread.** Unread = entries with `at` later than `state.lastSeenAt`; a fresh
  install (no `lastSeenAt`) counts all entries. Opening the main page or a report
  marks seen.
- **Guards.** `action: "read"` rejects a `runId` that is not
  `run-YYYYMMDDTHHMMSSZ(-N)`; `action: "open"` only accepts `.md` files under
  `<dataDir>/digests` and only on macOS; the whole API rejects non-loopback
  callers with 403.
- **Migration.** A directory with the old `digests/index.json` plus
  `YYYY-MM-DD.md` is migrated once into `runs.json` + `run-*.md`, and unread is
  preserved (L0.1 covers this with a fixture).

## 8. L5 — push channels

| Channel | Where it lands | Pass | Fails if |
| --- | --- | --- | --- |
| `session` | the scheduled session gets the ≤600-character digest | run completes with a summary in that session | agent never prints a summary |
| `macos` | native notification, one per run | L3.7 | permission denied, channel off, run has no progress |
| `wechat` | `notify_wechat` message | digest arrives in WeChat | WeChat plugin missing → falls back to the conversation (not an error) |

The run's brief lists the configured channels; the agent must follow it rather
than its own default.

## 9. Known failures as of the 2026-11-22 baseline

Found while writing this plan (v0.6.0). They are listed so a run does not chase
them as new regressions, and so whoever fixes them adds a case here.

**9.1 `sync` reports "updated" on every call.** `timingMatches()` compares
`08:30:00` with the scheduler's `08:30:00.000`, so it never matches, and every
plugin load (and every `sync`) patches the task and bumps `updatedAt`.
Functionally harmless, but it makes L2.8.2 fail and hides real changes. Fix
candidate: compare the `HH:MM:SS` prefix.

**9.2 A task created before an upgrade keeps the old prompt.** `TASK_PROMPT` is
applied only when the task is created; the pre-0.6 text (lookback wording instead
of per-topic windows) stays in the Automation page. Workaround for testing: remove
the task and `sync` again. Decide separately whether `ensureTask` should refresh
the prompt, since `README.md` invites users to edit the task instructions.

**9.3 Consequence for this plan.** Any case that asserts the task prompt must run
against a freshly created task; otherwise it fails for 9.2 rather than for a real
defect.

## 10. Results log

Copy a row per pass; keep the newest on top. "Partial" means the unchecked layer
was not exercised — say which.

| Date | Version | L0 | L1 | L2 | L3 | L4 | L5 | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-22 | 0.6.0 | pass | pass | partial | not run | not run | not run | baseline: API + `watchlist_list` + `watchlist_schedule sync` verified; 9.1 and 9.2 reproduced |

## Appendix A — the 10-minute pass

For a quick "did the last edit break anything" check:

1. L0.1, L0.2, L0.3.
2. L1.1 (`watchlist_list`) and L1.2 (`curl` state).
3. L3.1 (settings page renders, add/remove one `[test]` topic) and L3.2/L3.3
   (nav row opens the page, the unread dot clears, the page scrolls).
4. L2.5 + L2.6 with one test topic: brief, record, check the day file.
5. L2.8 `sync` when the schedule settings changed.

## Appendix B — triage

| Symptom | Likely cause | Check |
| --- | --- | --- |
| `watchlist_*` tools unknown | Host half not loaded | Plugins page, profile link, reload |
| Settings page blank, console `ReferenceError` | client bundle broken | DevTools, `node --check client.js`, L0.2 |
| Page says `加载失败` | API route not registered / Host error | `curl` state, Host logs |
| Main page's reports card empty while files look fine | `runs.json` missing or stale | L4 index consistency, re-run a record |
| Badge stuck at 0 | `lastSeenAt` newer than entries | L4 unread rule |
| No notification | permission denied, channel off, no `hasUpdate`, >2 h old, already notified | L3.7 |
| Notification click opens nothing | sidebar unavailable and reader fallback failed | L3.6, L3.5 |
| Nothing fires on schedule | app closed, task paused, auto-run off, empty list | L2.8, L1.1 |
| Catch-up never happens | topics not due, no `schedule` service | L2.9, L2.5.3 |
| Report path wrong / split files | `timeZone` changed mid-day | L2.7, L4 |
| WeChat push missing | WeChat plugin absent | L5 |
