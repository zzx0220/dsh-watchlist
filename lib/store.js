/**
 * dsh-watchlist — pure logic layer for the watchlist.
 *
 * Uses no DeepSeek Harness service at all; it only does “files → data → files”:
 *   dataDir/topics.json   the topics being followed
 *   dataDir/settings.json runtime settings (changed in chat or by hand)
 *   dataDir/state.json    scheduled task id, time of the most recent run
 *   dataDir/digests/day-YYYY-MM-DD.md  at most one report file per day; a second
 *                                      run on the same day appends a new section
 *   dataDir/digests/runs.json          run index (machine readable, still per run)
 *
 * Kept as its own module because the host plugin layer needs dsh's defineTool
 * while this layer runs on plain node, so scripts/smoke.mjs can verify it
 * without a Harness.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, appendFileSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

export const VERSION = 1

export const DEFAULT_SETTINGS = {
  lookbackDays: 7,
  timeZone: 'Asia/Shanghai',
  maxTopicsPerRun: 8,
  schedule: {
    enabled: true,
    frequency: 'daily', // daily | weekly | monthly
    time: '08:30',
    weekdays: [1], // ISO weekday, 1 = Monday
    monthday: 1,
  },
  push: {
    channels: ['session'], // session | macos | wechat
  },
  workspaceDir: null, // working directory for check sessions; null = host default
  mirrorDir: null, // also mirror reports into this directory (usually inside the workspace, so DSH can preview them)
  locale: 'auto', // auto | zh | en; auto = follow the DSH language
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
      out[key] = deepMerge(base[key], value)
    } else {
      out[key] = value
    }
  }
  return out
}

export function normalizeSettings(raw) {
  const merged = deepMerge(DEFAULT_SETTINGS, raw ?? {})
  merged.lookbackDays = clampInt(merged.lookbackDays, 1, 90, DEFAULT_SETTINGS.lookbackDays)
  merged.maxTopicsPerRun = clampInt(merged.maxTopicsPerRun, 1, 30, DEFAULT_SETTINGS.maxTopicsPerRun)
  if (typeof merged.timeZone !== 'string' || !merged.timeZone.trim()) merged.timeZone = DEFAULT_SETTINGS.timeZone
  merged.schedule = deepMerge(DEFAULT_SETTINGS.schedule, merged.schedule ?? {})
  if (!['daily', 'weekly', 'monthly'].includes(merged.schedule.frequency)) merged.schedule.frequency = 'daily'
  if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(String(merged.schedule.time))) merged.schedule.time = DEFAULT_SETTINGS.schedule.time
  if (!Array.isArray(merged.schedule.weekdays) || merged.schedule.weekdays.length === 0) merged.schedule.weekdays = [1]
  merged.schedule.monthday = clampInt(merged.schedule.monthday, 1, 28, 1)
  merged.push = deepMerge(DEFAULT_SETTINGS.push, merged.push ?? {})
  if (!Array.isArray(merged.push.channels)) merged.push.channels = ['session']
  merged.push.channels = merged.push.channels.filter((c) => ['session', 'macos', 'wechat'].includes(c))
  if (!['auto', 'zh', 'en'].includes(merged.locale)) merged.locale = 'auto'
  return merged
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

export function normalizeName(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The scheduler wants HH:mm:ss (fractional seconds allowed); users write HH:mm, so pad it here. */
export function toScheduleTime(time) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(time ?? '').trim())
  if (!match) return '08:30:00'
  return `${match[1]}:${match[2]}:${match[3] ?? '00'}`
}

export function newTopicId() {
  return `t_${randomBytes(4).toString('hex')}`
}

function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

export function paths(dataDir) {
  return {
    dir: dataDir,
    topics: join(dataDir, 'topics.json'),
    settings: join(dataDir, 'settings.json'),
    state: join(dataDir, 'state.json'),
    digests: join(dataDir, 'digests'),
  }
}

export function ensureLayout(dataDir) {
  const p = paths(dataDir)
  mkdirSync(p.dir, { recursive: true })
  mkdirSync(p.digests, { recursive: true })
  migrateLegacyRuns(dataDir)
  return p
}

export function loadSettings(dataDir, config) {
  const p = paths(dataDir)
  const stored = readJson(p.settings, {})
  // The config in cordis.patch.yml is the initial default; settings.json overrides it at runtime.
  return normalizeSettings(deepMerge(deepMerge({}, config ?? {}), stored))
}

export function saveSettings(dataDir, patch) {
  const p = paths(dataDir)
  const current = readJson(p.settings, {})
  const next = normalizeSettings(deepMerge(current, patch ?? {}))
  writeJson(p.settings, next)
  return next
}

export function loadState(dataDir) {
  return readJson(paths(dataDir).state, { version: VERSION, scheduleTaskId: null, lastRunAt: null })
}

export function saveState(dataDir, patch) {
  const p = paths(dataDir)
  const next = { ...loadState(dataDir), ...patch }
  writeJson(p.state, next)
  return next
}

export function loadTopics(dataDir) {
  const raw = readJson(paths(dataDir).topics, { version: VERSION, topics: [] })
  const topics = Array.isArray(raw.topics) ? raw.topics : []
  return topics
    .filter((t) => t && typeof t.topic === 'string' && t.topic.trim())
    .map((t) => ({
      id: typeof t.id === 'string' && t.id ? t.id : newTopicId(),
      topic: t.topic.trim(),
      keywords: Array.isArray(t.keywords) ? t.keywords.filter((k) => typeof k === 'string' && k.trim()) : [],
      note: typeof t.note === 'string' ? t.note : '',
      createdAt: t.createdAt ?? new Date().toISOString(),
      lastRunAt: t.lastRunAt ?? null,
      everyDays: Number.isFinite(t.everyDays) && t.everyDays >= 1 ? Math.trunc(t.everyDays) : null,
      lastCheckedAt: t.lastCheckedAt ?? t.lastRunAt ?? null,
    }))
}

function saveTopics(dataDir, topics) {
  writeJson(paths(dataDir).topics, { version: VERSION, topics })
}

export function addTopic(dataDir, { topic, keywords, note, everyDays }) {
  const name = String(topic ?? '').trim()
  if (!name) throw new Error('主题不能为空')
  ensureLayout(dataDir)
  const topics = loadTopics(dataDir)
  const existing = topics.find((t) => normalizeName(t.topic) === normalizeName(name))
  if (existing) return { topic: existing, created: false, total: topics.length }
  const entry = {
    id: newTopicId(),
    topic: name,
    keywords: (keywords ?? []).map((k) => String(k).trim()).filter(Boolean),
    note: typeof note === 'string' ? note.trim() : '',
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    everyDays: Number.isFinite(everyDays) && everyDays >= 1 ? Math.trunc(everyDays) : null,
    lastCheckedAt: null,
  }
  topics.push(entry)
  saveTopics(dataDir, topics)
  return { topic: entry, created: true, total: topics.length }
}

function matchTopic(topics, raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { hit: null, ambiguous: [] }
  let hit = topics.find((t) => t.id === text)
  if (!hit) hit = topics.find((t) => normalizeName(t.topic) === normalizeName(text))
  if (!hit) {
    const partial = topics.filter((t) => normalizeName(t.topic).includes(normalizeName(text)))
    if (partial.length === 1) hit = partial[0]
    else if (partial.length > 1) return { hit: null, ambiguous: partial }
  }
  return { hit: hit ?? null, ambiguous: [] }
}

export function removeTopic(dataDir, target) {
  const raw = String(target ?? '').trim()
  if (!raw) throw new Error('要删除哪个主题？给 id 或主题名')
  const topics = loadTopics(dataDir)
  const { hit, ambiguous } = matchTopic(topics, raw)
  if (!hit && ambiguous.length) {
    throw new Error(`有 ${ambiguous.length} 个主题匹配「${raw}」，请用 id 指定：${ambiguous.map((t) => `${t.id}(${t.topic})`).join('、')}`)
  }
  if (!hit) return { removed: null, remaining: topics.length }
  const rest = topics.filter((t) => t.id !== hit.id)
  saveTopics(dataDir, rest)
  return { removed: hit, remaining: rest.length }
}

/** Update one topic's fields (currently everyDays / note / keywords). */
export function updateTopic(dataDir, target, patch = {}) {
  const topics = loadTopics(dataDir)
  const { hit, ambiguous } = matchTopic(topics, target)
  if (!hit && ambiguous.length) {
    throw new Error(`有 ${ambiguous.length} 个主题匹配「${target}」，请用 id 指定`)
  }
  if (!hit) return null
  if ('everyDays' in patch) {
    hit.everyDays = Number.isFinite(patch.everyDays) && patch.everyDays >= 1 ? Math.trunc(patch.everyDays) : null
  }
  if (typeof patch.note === 'string') hit.note = patch.note.trim()
  if (Array.isArray(patch.keywords)) hit.keywords = patch.keywords.map((k) => String(k).trim()).filter(Boolean)
  saveTopics(dataDir, topics)
  return hit
}

export function touchTopics(dataDir, ids) {
  const idset = new Set(ids)
  const topics = loadTopics(dataDir)
  const now = new Date().toISOString()
  for (const t of topics) {
    if (!idset.has(t.id)) continue
    t.lastRunAt = now
    t.lastCheckedAt = now
  }
  saveTopics(dataDir, topics)
}

/** Each topic is due by its own everyDays; an empty everyDays falls back to the global default. */
export function intervalDaysOf(topic, defaultDays) {
  return topic.everyDays ?? defaultDays
}

export function dueTopics(dataDir, defaultDays, now = new Date()) {
  const at = now.getTime()
  return loadTopics(dataDir).filter((topic) => {
    const days = intervalDaysOf(topic, defaultDays)
    if (!topic.lastCheckedAt) return true
    const last = new Date(topic.lastCheckedAt).getTime()
    if (!Number.isFinite(last)) return true
    return at - last >= days * 86400000 - 60 * 60 * 1000
  })
}

export function dayStamp(timeZone, date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  }
}

/* ---------- Run records: one run = one section, at most one file per day ---------- */

function runsPath(dataDir) {
  return join(paths(dataDir).digests, 'runs.json')
}

/** Report file of a run: the day file, or the legacy per-run file for older records. */
export function reportPathOf(dataDir, run) {
  return join(paths(dataDir).digests, (run && run.file) || `${run.id}.md`)
}

/** The day a run belongs to comes from settings.timeZone, frozen when the run starts. */
function dayOf(dataDir, day) {
  return day || dayStamp(loadSettings(dataDir).timeZone)
}

/** Build one run record. Shared by startRun and the record-without-brief fallback. */
function beginRun(runs, { from, to, startedAt, day }) {
  const base = newRunId(new Date(startedAt))
  let id = base
  // Two runs can start inside one second (catch-up plus manual), so add a counter on id collision.
  for (let n = 2; runs.some((item) => item.id === id); n += 1) id = `${base}-${n}`
  // Count inside the day file, so a migrated day (which lives in run-*.md) never
  // makes the new day file start at "第 2 次".
  const file = `day-${day}.md`
  const seq = runs.filter((item) => item.file === file).length + 1
  const run = { id, day, seq, file, startedAt, from, to, finishedAt: null, entries: [] }
  runs.push(run)
  return run
}

/** Keep the newest ~400 days of runs, so a busy day cannot evict older days. */
function trimRuns(runs) {
  const dayOfRun = (run) => run.day || String(run.startedAt ?? '').slice(0, 10)
  const keepDays = new Set([...new Set(runs.map(dayOfRun))].sort().slice(-400))
  return runs.filter((run) => keepDays.has(dayOfRun(run)))
}

export function loadRuns(dataDir) {
  const raw = readJson(runsPath(dataDir), { version: VERSION, runs: [] })
  const list = Array.isArray(raw.runs) ? raw.runs : []
  return list.filter((run) => run && typeof run.id === 'string' && Array.isArray(run.entries))
}

function saveRuns(dataDir, runs) {
  writeJson(runsPath(dataDir), { version: VERSION, runs: trimRuns(runs) })
}

export function newRunId(date = new Date()) {
  return `run-${date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`
}

/** Start a run. from/to is the window this run covers; `day` decides its report file. */
export function startRun(dataDir, { from = null, to = null, day = null } = {}) {
  ensureLayout(dataDir)
  const runs = loadRuns(dataDir)
  const startedAt = new Date().toISOString()
  const run = beginRun(runs, { from, to: to ?? startedAt, startedAt, day: dayOf(dataDir, day) })
  saveRuns(dataDir, runs)
  // This run's start time is the next window's start, so a failure never makes the window miss.
  saveState(dataDir, { currentRunId: run.id, lastRunAt: startedAt })
  return run
}

export function currentRun(dataDir) {
  const state = loadState(dataDir)
  if (!state.currentRunId) return null
  return loadRuns(dataDir).find((run) => run.id === state.currentRunId) ?? null
}

/** Close the previous run (even if unfinished) and return the one that was closed. */
export function closeCurrentRun(dataDir) {
  const runs = loadRuns(dataDir)
  const state = loadState(dataDir)
  const run = state.currentRunId ? runs.find((item) => item.id === state.currentRunId) : null
  if (!run) {
    if (state.currentRunId) saveState(dataDir, { currentRunId: null })
    return null
  }
  const lastEntry = run.entries.length ? run.entries[run.entries.length - 1].at : run.startedAt
  run.finishedAt = lastEntry
  run.to = lastEntry
  saveRuns(dataDir, runs)
  saveState(dataDir, { currentRunId: null })
  return run
}

export function appendRunEntry(dataDir, { topic, hasUpdate, summary, sources, note, day = null }) {
  ensureLayout(dataDir)
  const runs = loadRuns(dataDir)
  const state = loadState(dataDir)
  let run = state.currentRunId ? runs.find((item) => item.id === state.currentRunId) : null
  if (!run) {
    // No run_brief happened: open one here so the entry is never lost.
    const now = new Date().toISOString()
    run = beginRun(runs, { from: state.lastRunAt ?? null, to: now, startedAt: now, day: dayOf(dataDir, day) })
    saveState(dataDir, { currentRunId: run.id, lastRunAt: now })
  }
  const at = new Date().toISOString()
  const entry = {
    at,
    topic: String(topic).trim(),
    hasUpdate: hasUpdate === true,
    summary: String(summary).trim(),
    sources: (sources ?? []).map((source) => String(source).trim()).filter(Boolean),
    note: typeof note === 'string' ? note.trim() : '',
  }
  run.entries.push(entry)
  run.to = at
  saveRuns(dataDir, runs)

  const file = reportPathOf(dataDir, run)
  const lines = []
  // The day header is written once per file; it must stay true for the whole day,
  // so the per-run window lives in the run section below instead.
  if (!existsSync(file)) lines.push(`# 关注清单日报 ${run.day || formatStamp(run.startedAt).slice(0, 10)}`, '')
  if (run.entries.length === 1) {
    // First entry of this run: open a section so several same-day runs stay readable.
    lines.push(`## 第 ${run.seq ?? 1} 次巡检 ${clockStamp(run.startedAt)}`, '')
    lines.push(`- 覆盖区间：${run.from ? formatStamp(run.from) : '首次巡检'} → ${formatStamp(run.to)}`)
    lines.push('')
  }
  lines.push(`### ${entry.topic}`, '')
  lines.push(`- 状态：${entry.hasUpdate ? '有实质进展' : '无实质进展'}`)
  lines.push(`- 摘要：${entry.summary}`)
  if (entry.sources.length) {
    lines.push('- 来源：')
    for (const source of entry.sources) lines.push(`  - ${source}`)
  }
  if (entry.note) lines.push(`- 备注：${entry.note}`)
  lines.push('')
  appendFileSync(file, `${lines.join('\n')}\n`, 'utf8')
  const dayTotal = runs
    .filter((item) => (item.day || '') === (run.day || ''))
    .reduce((sum, item) => sum + item.entries.length, 0)
  return { runId: run.id, path: file, at, runTotal: run.entries.length, dayTotal, day: run.day, seq: run.seq ?? 1 }
}

/* ---------- Per-report read state ----------
 * Reading is tracked per run, not by one timestamp: opening today's report must not
 * swallow yesterday's unread run. States written before `seenRunIds` existed fall
 * back to the old `lastSeenAt` boundary, and the first write seeds the set from it so
 * one click never resurrects a pile of already-read runs.
 */

function seenRunState(dataDir) {
  const state = loadState(dataDir)
  const explicit = Array.isArray(state.seenRunIds)
  const ids = explicit ? state.seenRunIds.filter((id) => typeof id === 'string' && id) : legacySeenIds(dataDir, state)
  return { state, explicit, ids: new Set(ids) }
}

/** Runs the old timestamp rule treated as read. */
function legacySeenIds(dataDir, state) {
  if (!state.lastSeenAt) return []
  return loadRuns(dataDir)
    .filter((run) => String(run.startedAt || '') <= String(state.lastSeenAt))
    .map((run) => run.id)
}

function runIsSeen(run, seen) {
  if (seen.ids.has(run.id)) return true
  return false
}

/**
 * All three unread counters from one read of the two files. The badge polls this,
 * so it must not walk the run list three times.
 */
export function counters(dataDir) {
  const seen = seenRunState(dataDir)
  const result = { unread: 0, unreadUpdates: 0, unreadRunIds: [] }
  for (const run of loadRuns(dataDir)) {
    if (runIsSeen(run, seen)) continue
    result.unreadRunIds.push(run.id)
    result.unread += run.entries.length
    result.unreadUpdates += run.entries.filter((entry) => entry.hasUpdate === true).length
  }
  return result
}

/** Run ids whose report has not been opened yet; the UI marks these rows. */
export function unseenRunIds(dataDir) {
  const seen = seenRunState(dataDir)
  return loadRuns(dataDir)
    .filter((run) => !runIsSeen(run, seen))
    .map((run) => run.id)
}

/** Mark one report read. Seeds from the legacy boundary on the first write. */
export function markRunSeen(dataDir, runId) {
  const seen = seenRunState(dataDir)
  const keep = new Set(loadRuns(dataDir).map((run) => run.id))
  const next = [...seen.ids, runId].filter((id) => keep.has(id))
  const at = new Date().toISOString()
  saveState(dataDir, { seenRunIds: [...new Set(next)], lastSeenAt: at })
  return at
}

/** Mark every report read. */
export function markSeen(dataDir) {
  const at = new Date().toISOString()
  saveState(dataDir, { seenRunIds: loadRuns(dataDir).map((run) => run.id), lastSeenAt: at })
  return at
}

export function unreadCount(dataDir) {
  const seen = seenRunState(dataDir)
  return loadRuns(dataDir)
    .filter((run) => !runIsSeen(run, seen))
    .reduce((sum, run) => sum + run.entries.length, 0)
}

/**
 * Unread entries that reported real progress, across every report not yet read. The
 * sidebar badge counts these, not every recorded topic: a run that found nothing is
 * not something to flag.
 */
export function unreadUpdateCount(dataDir) {
  const seen = seenRunState(dataDir)
  return loadRuns(dataDir)
    .filter((run) => !runIsSeen(run, seen))
    .reduce((sum, run) => sum + run.entries.filter((entry) => entry.hasUpdate === true).length, 0)
}

/** For the UI: the latest runs, newest first, with their report file paths. */
export function listRuns(dataDir, limit = 14) {
  return loadRuns(dataDir)
    .slice()
    .sort((a, b) => (String(a.startedAt) < String(b.startedAt) ? 1 : -1))
    .slice(0, limit)
    .map((run) => ({ ...run, path: reportPathOf(dataDir, run) }))
}

export function formatStamp(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Same stamp, time only: the run section header inside a day file. */
function clockStamp(iso) {
  const text = formatStamp(iso)
  return text.length >= 16 ? text.slice(11, 16) : text
}

/** Migration from the old per-day layout: index.json + YYYY-MM-DD.md → runs.json + run-*.md. */
export function migrateLegacyRuns(dataDir) {
  if (loadRuns(dataDir).length) return
  const legacy = readJson(join(paths(dataDir).digests, 'index.json'), { entries: [] })
  const entries = Array.isArray(legacy.entries) ? legacy.entries : []
  if (!entries.length) return
  const byDay = new Map()
  for (const entry of entries) {
    const day = String(entry.day ?? '')
    if (!day) continue
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(entry)
  }
  const runs = []
  for (const [day, list] of [...byDay.entries()].sort()) {
    const sorted = list.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)))
    const last = sorted[sorted.length - 1]
    runs.push({
      id: `run-${day.replace(/-/g, '')}T000000Z`,
      day,
      startedAt: sorted[0].at,
      from: null,
      to: last.at,
      finishedAt: last.at,
      entries: sorted.map((entry) => ({
        at: entry.at,
        topic: entry.topic,
        hasUpdate: entry.hasUpdate === true,
        summary: entry.summary,
        sources: Array.isArray(entry.sources) ? entry.sources : [],
        note: entry.note ?? '',
      })),
      legacyFile: join(paths(dataDir).digests, `${day}.md`),
    })
  }
  saveRuns(dataDir, runs)
  for (const run of runs) {
    const target = join(paths(dataDir).digests, `${run.id}.md`)
    if (run.legacyFile && existsSync(run.legacyFile) && !existsSync(target)) copyFileSync(run.legacyFile, target)
  }
}
