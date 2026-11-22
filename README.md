# dsh-watchlist

A follow-list for DeepSeek Harness: keep the topics you care about, let an Agent
search the web for new progress on a schedule, record daily digests, and push
summaries where you want them.

- **No re-implemented search** — reuses the session's `web_search` / `web_fetch`.
- **No re-implemented summarization** — reuses the current conversation model.
- **Scheduling is delegated** to `dsh-schedule`: the task shows up in the
  Automation tasks page, so it can be paused, edited, or run manually.
- **Data stays in files**: `topics.json`, `settings.json`, `digests/*.md` — hand
  editable, backup friendly.

## Install

Local directory: **Plugins → Add plugin**, pick this directory; or

```sh
dsh plugin --profile desktop add /absolute/path/dsh-watchlist
```

## Quick start

In any conversation:

1. "Add a topic: <something specific>" → `watchlist_add`
2. "Run the check every day at 08:30 and push to WeChat" → `watchlist_settings`
   then `watchlist_schedule sync`
3. "Run it now" → `watchlist_schedule run_now`

## Tools

| Tool | Purpose |
| --- | --- |
| `watchlist_add` | Add a topic (optional keywords and note) |
| `watchlist_remove` | Remove by id or unique name |
| `watchlist_list` | Topics, settings, schedule status |
| `watchlist_run_brief` | Authoritative brief for one run: topics, lookback, push channels |
| `watchlist_record` | Append one topic's result to today's digest |
| `watchlist_schedule` | `sync` / `pause` / `resume` / `remove` / `run_now` |
| `watchlist_settings` | Read or patch settings (JSON patch) |

## Settings

Stored in `<dataDir>/settings.json`; the `cordis.patch.yml` config is only an
initial value, runtime changes win and survive upgrades.

| Key | Default | Meaning |
| --- | --- | --- |
| `dataDir` | `$DSH_HOME/watchlist` | Topics and digests |
| `lookbackDays` | 7 | How far back each search looks |
| `maxTopicsPerRun` | 8 | Topics per run (token budget) |
| `timeZone` | `Asia/Shanghai` | Schedule and digest date zone |
| `schedule.enabled` | `true` | Auto-run; no task is created or run while the list is empty |
| `schedule.frequency` | `daily` | `daily` / `weekly` / `monthly` |
| `schedule.time` | `08:30` | Run time |
| `schedule.weekdays` | `[1]` | ISO weekdays for weekly runs |
| `schedule.monthday` | 1 | Day of month for monthly runs |
| `push.channels` | `["session"]` | `session` / `macos` / `wechat` |
| `workspaceDir` | `null` | Working directory for the scheduled session |
| `locale` | `auto` | UI language: `auto` (follow DSH), `zh`, or `en`; other locales show English |
| `promptHint` | `true` | Adds one line to the system prompt so agents in any session know `watchlist_*` exists |

## Data layout

```text
<dataDir>/
├── topics.json
├── settings.json
├── state.json
└── digests/
    ├── runs.json
    └── run-20261122T140500Z.md
```

## Limitations

- **The Host must be running**: scheduling belongs to `dsh-schedule`; a closed app
  does not fire.
- **Startup catch-up**: after a missed schedule (powered off or app closed), the
  plugin delivers one catch-up run whose search window spans "last run → now"
  (capped at 30 days), producing a single report rather than one per day.
- **Needs web search**: without `web_search` in the model request, a run is empty.
- **WeChat needs the WeChat plugin**: this plugin only tells the Agent to call
  `notify_wechat`; without it the digest stays in the conversation.
- **macOS notifications use `osascript`** and stay on this machine.
- The scheduled prompt is stable; settings changes only affect timing and push
  channels. Edit the task itself to change the instructions.

## Privacy

Files only, no telemetry. Anything networked is the Agent's own `web_search`
call under the Harness network policy.
