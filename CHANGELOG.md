# Changelog

Earlier versions predate this file; the entries below start with the release
preparation for the first public version.

## Unreleased

- **Package renamed** to `@zzx0220/dsh-watchlist`. The unscoped `dsh-watchlist`
  belongs to another publisher, so the package moved under a scope only this account
  can publish to. The loader row name and the client factory id follow the package
  name; the HTTP route (`/dsh-watchlist-api`) and the `localStorage` key keep their
  old spelling on purpose.
- **Publish metadata**: `engines.dsh` (`>=0.2.2-rc.3 <0.3.0`), `publishConfig.access:
  public`, `repository`/`homepage`/`bugs`, and a `files` list that ships only
  `docs/DETAIL.md` (the roadmap and the test plan stay in the repository).
- **Scheduling is opt-in.** A fresh install starts paused instead of creating a task
  and catching up on load. Naming a time, frequency, or weekday in a settings patch
  turns scheduling on unless the patch carries `enabled` itself, so "check every day
  at 08:30" still works in one step.
- **Host copy is localized.** Every user-visible Host string (task title, check
  instruction, tool results, digest labels, HTTP errors, the system-prompt hint) lives
  in `lib/copy.js` with `en` and `zh` tables and follows `settings.locale`; `auto`
  reads the system language and falls back to English. Tool and parameter descriptions
  are English only, because the model reads them.
- **Time zone default follows the host** instead of a hard-coded `Asia/Shanghai`;
  day stamps use the same value.
