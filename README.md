# @zzx0220/dsh-watchlist

**English** | [中文](README.zh.md)

A follow-list for DeepSeek Harness: keep the topics you care about, let an Agent
search the web for new progress on a schedule, record daily digests, and push
summaries where you want them.

- **No re-implemented search** — reuses the session's `web_search` / `web_fetch`.
- **No re-implemented summarization** — reuses the current conversation model.
- **Scheduling is delegated** to `dsh-schedule`: the task shows up in the
  Automation tasks page, so it can be paused, edited, or run manually.
- **Data stays in files**: `topics.json`, `settings.json`, `digests/*.md` — hand
  editable, backup friendly.
- **Two kinds of important**: the Agent can mark a finding `high` — it then sits in a
  band above the page and turns the sidebar count amber while unread; you can star any
  finding and it stays in that band until you unstar it, read or not.

## Install

Local directory: **Plugins → Add plugin**, pick this directory; or

```sh
dsh plugin --profile desktop add /absolute/path/dsh-watchlist
```

## Quick start

In any conversation:

1. "Add a topic: <something specific>" → `watchlist_add`
2. "Run the check every day at 08:30 and notify me on macOS" → `watchlist_settings`
   then `watchlist_schedule sync`
3. "Run it now" → `watchlist_schedule run_now`

## Compatibility

Declared as `engines.dsh`: **`>=0.2.2-rc.3 <0.3.0`**. A runtime outside that range
refuses the install with the requirement spelled out, instead of loading a plugin that
was never tested against it.

Verified so far:

| DSH version | Install and compose | Host API answers |
| --- | --- | --- |
| `0.2.2-rc.2` | refused (outside the range, as intended) | — |
| `0.2.2-rc.3` | yes | yes (the build in daily use) |
| `0.2.2-rc.4` | yes | not run |
| `0.2.2-rc.5` (latest at release) | yes | yes |
| `0.2.3-alpha.2` | yes | not run |

Maintainers can re-run that check against any published version without installing it:

```sh
node scripts/compat.mjs 0.2.2-rc.5 --runtime
```

## Language

Everything the plugin writes follows `settings.locale`: `auto` (the default) reads the
system language, `zh` and `en` force one. That covers the Automation task title, the
check instruction delivered to a session, digest labels, tool results and errors; the
in-app page follows the same setting through DeepSeek Harness's own locale. An
undeterminable language falls back to English.

## Tools

| Tool | Purpose |
| --- | --- |
| `watchlist_add` | Add a topic (optional keywords and note) |
| `watchlist_remove` | Remove by id or unique name |
| `watchlist_list` | Topics, settings, schedule status |
| `watchlist_run_brief` | Authoritative brief for one run: topics, lookback, push channels |
| `watchlist_record` | Append one topic's result to today's digest; optional `importance: "high"` |
| `watchlist_schedule` | `sync` / `pause` / `resume` / `remove` / `run_now` |
| `watchlist_settings` | Read or patch settings (JSON patch) |

## Important information

A finding can be important in two ways, and the page treats them differently:

- **The Agent's call** — `watchlist_record({ importance: "high" })` for news that
  changes the picture or needs an action. While the report is unread it sits in a band
  directly under the page header (outside the scroll box, so it cannot be missed), is
  tagged `important` in the history, and turns the sidebar count amber.
- **Your star** — the `☆` on every history row. A starred finding stays in the band
  until you unstar it, whether or not you have read the report.

Reading a report retires the Agent's flag, because by then it is no longer news; a star
is yours and is never cleared that way.

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
| `push.channels` | `["session"]` | `session` / `macos` |
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
    ├── runs.json              # run index (one record per run)
    └── day-2026-11-22.md      # at most one report file per day, one section per run
```

## Cadence

- `schedule.frequency` is both the scheduler tick and the **default interval for new topics** (daily = 1, weekly = 7, monthly = 30 days).
- Each topic can override it: `watchlist_add({ topic: "...", everyDays: 3 })`.
- A run only picks **due** topics; the report stays one-per-run and contains only that run's entries.
- When nothing is due, the run is skipped and no empty report is written.
- The settings page marks the global block as "Default schedule"; the add form and each row can override the interval.

## Limitations

- **The Host must be running**: scheduling belongs to `dsh-schedule`; a closed app
  does not fire.
- **Startup catch-up**: after a missed schedule (powered off or app closed), the
  plugin delivers one catch-up run whose search window spans "last run → now"
  (capped at 30 days), producing a single report rather than one per day.
- **Needs web search**: without `web_search` in the model request, a run is empty.
- **macOS notifications come from the in-app client**: one per run, only when the
  run has progress, and clicking it opens that run's report. They are posted by
  the renderer (attributed to DeepSeek Harness), so the app must be running and
  allowed under System Settings → Notifications; the settings page has a test button.
- The scheduled prompt is stable; settings changes only affect timing and push
  channels. Edit the task itself to change the instructions.

## Testing

- `npm run check` runs the two self-checks: store logic (`scripts/smoke.mjs`)
  and client registration/render/language (`scripts/client-check.mjs`). Neither
  needs Harness running.
- [docs/TESTING.md](docs/TESTING.md) is the manual regression plan: layered
  cases (loading, the eight tools, the client surfaces, data files, push),
  expected outputs, a 10-minute pass, and a triage table.

## Privacy

Files only, no telemetry. Anything networked is the Agent's own `web_search`
call under the Harness network policy.
