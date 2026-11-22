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
   conversation, through `notify_wechat` when the WeChat plugin is installed, or
   as a macOS notification at record time when that channel is enabled.

## Why it delegates

Web search, summarization, and status are already owned by DeepSeek Harness.
This plugin owns only the deterministic parts: the list, the settings, the
schedule wiring, the digest files, and the push hand-off.

## Data

Everything lives under `dataDir` (default `$DSH_HOME/watchlist`):

- `topics.json` — the list
- `settings.json` — runtime settings (override the bundle config)
- `state.json` — schedule task id and last run time
- `digests/YYYY-MM-DD.md` — one section per topic per run

## Limitations to keep in mind

- The Host must be running for the schedule to fire; it is not a background
  service and does not survive a closed app.
- A run costs model tokens per topic; `maxTopicsPerRun` and `lookbackDays` are
  the two knobs that bound cost.
- Nothing is downloaded or installed by a run: the instruction explicitly limits
  it to searching, recording, and pushing.
