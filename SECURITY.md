# Security

This plugin runs inside DeepSeek Harness with the same permissions as the Host process.
What it touches is deliberately small:

## What it reads and writes

- `<dataDir>` (`$DSH_HOME/watchlist` by default): `topics.json`, `settings.json`,
  `state.json`, `digests/*.md`, `digests/runs.json`. Nothing outside that directory is
  written. An optional `mirrorDir` copies digest files into a directory you choose.
- The Host half serves a local HTTP API on the loopback interface only
  (`/dsh-watchlist-api/*`); requests from other addresses are rejected. It has no
  authentication of its own, so any process running as you on this machine can call it,
  exactly like the rest of the local application.
- No telemetry, no analytics endpoint, no outbound request of its own. Web access
  happens through the session's `web_search` / `web_fetch` tools, which belong to
  DeepSeek Harness and are billed and governed there.

## Prompt injection and untrusted content

A check run asks the agent to search the web and record what it finds. Search results
are untrusted text: they can try to steer the model. The plugin does not execute
anything from a digest — it stores Markdown — but a hostile source could influence the
summary the model writes, or try to make the model call tools with wrong arguments.
Read digests with the same suspicion you apply to any web page. The scheduled
instruction limits a run to searching, recording, and pushing.

## Cost

Each run spends model tokens per topic: `maxTopicsPerRun` and `lookbackDays` bound the
cost. Scheduling is opt-in, so a fresh install never runs on its own.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository ("Security" →
"Report a vulnerability"), or open an issue that describes the problem without
publishing a working exploit. Please include the DSH version, the plugin version, and
the steps that reproduce the issue.

## Supported versions

The current minor line receives fixes. The manifest declares `engines.dsh`; an install
on an untested DeepSeek Harness release is refused rather than silently half-working.
