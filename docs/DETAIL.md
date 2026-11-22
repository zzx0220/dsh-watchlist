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
   calls `watchlist_record` once, which appends a section to today's digest file. A
   record may carry `importance: "high"` when the news changes the picture or needs an
   action; ordinary updates leave it out, so the flag keeps its meaning.
4. The agent summarizes the run and pushes it according to the brief: in the
   conversation. With the macOS channel on, the client half posts one native
   notification per run by itself — only when the run has progress, only after the
   run stops being written to, and clicking it opens that run's report.

## Where it shows up

- A `Watchlist` row in the left sidebar's panel list, beside Plugins and Automation.
  Selecting it opens the plugin's own page in the centre column: the topic list,
  a read-only status line (auto-run, next run, push channels), and the report
  history.
  The row carries a count badge for unread entries that reported real progress; the
  count turns amber while one of those entries is `importance: high`. Read state is per
  report: opening today's report clears today's entries only, yesterday's report keeps
  its `unread` tag, and every report carries a read/unread toggle. `Mark all read` and
  `Mark all unread` on the page or in Settings flip them all at once.
- A band directly under the page header (outside the scroll box) lists what deserves
  attention before any scrolling: unread `high` entries, plus every starred entry. Each
  row opens the report it belongs to; each row also carries the star toggle.
- Every history row has a `☆` star. A star names one finding (an entry id), not a
  report: a report can hold one starred entry and one ordinary one, and reading it
  never clears a star.
- Settings → Watchlist: the schedule, push and language controls. The page does
  not repeat them; it only reminds you where they are.
- The in-app reader for a single report, opened from the page's history or from a
  notification.

## Why it delegates

Web search, summarization, and status are already owned by DeepSeek Harness.
This plugin owns only the deterministic parts: the list, the settings, the
schedule wiring, the digest files, and the push hand-off.

## Data

Everything lives under `dataDir` (default `$DSH_HOME/watchlist`):

- `topics.json` — the list
- `settings.json` — runtime settings (override the bundle config)
- `state.json` — schedule task id, last run time, read reports (`seenRunIds`), and
  starred entries (`starredEntryIds`)
- `digests/day-YYYY-MM-DD.md` — at most one report file per day; a second
  run on the same day appends one section per run, one entry per topic
- `digests/runs.json` — the run index the page's history reads

## Limitations to keep in mind

- The Host must be running for the schedule to fire; it is not a background
  service and does not survive a closed app.
- A run costs model tokens per topic; `maxTopicsPerRun` and `lookbackDays` are
  the two knobs that bound cost.
- Nothing is downloaded or installed by a run: the instruction explicitly limits
  it to searching, recording, and pushing.
