# Watchlist

Keep a list of topics you want to follow, and let a scheduled agent look for new
progress, write it down, and push a summary.

## What it does

1. You keep a topic list (`watchlist_add` / `watchlist_remove`, or ask the agent
   in chat).
2. A scheduled task delivers a fixed instruction into a reused conversation.
   The instruction tells the agent to call `watchlist_run_brief`, which returns
   the topics, the lookback window, and the push channels you configured.
3. For each topic the agent searches the web (the session's `web_search`), then
   calls `watchlist_record` once, which appends a section to today's digest file.
4. The agent summarizes the run and pushes it according to the brief: in the
   conversation, or through `notify_wechat` when the WeChat plugin is installed.
   With the macOS channel on, the client half posts one native notification per
   run by itself — only when the run has progress, only after the run stops being
   written to, and clicking it opens that run's report.

## Where it shows up

- A `关注清单` row in the left sidebar's panel list, beside Plugins and Automation.
  Selecting it opens the plugin's own page in the centre column: topics, the
  default schedule, push channels, interface language, and the report history.
- Settings → Watchlist: the same controls inside the settings page.
- The right sidebar's report tab, plus the in-app reader for a single report.

## Why it delegates

Web search, summarization, and status are already owned by DeepSeek Harness.
This plugin owns only the deterministic parts: the list, the settings, the
schedule wiring, the digest files, and the push hand-off.

## Data

Everything lives under `dataDir` (default `$DSH_HOME/watchlist`):

- `topics.json` — the list
- `settings.json` — runtime settings (override the bundle config)
- `state.json` — schedule task id and last run time
- `digests/day-YYYY-MM-DD.md` — at most one report file per day; a second
  run on the same day appends one section per run, one entry per topic
- `digests/runs.json` — the run index the panel and the report tab read

## Limitations to keep in mind

- The Host must be running for the schedule to fire; it is not a background
  service and does not survive a closed app.
- A run costs model tokens per topic; `maxTopicsPerRun` and `lookbackDays` are
  the two knobs that bound cost.
- Nothing is downloaded or installed by a run: the instruction explicitly limits
  it to searching, recording, and pushing.
