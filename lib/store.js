/**
 * dsh-watchlist — 关注清单的纯逻辑层。
 *
 * 这里不依赖 DeepSeek Harness 的任何服务，只做「文件 → 数据 → 文件」：
 *   dataDir/topics.json   关注的主题
 *   dataDir/settings.json 运行设置（对话里改的、手改的都算）
 *   dataDir/state.json    调度任务 id、最近一次巡检时间
 *   dataDir/digests/run-*.md  每次巡检一份报告（按次，不按天）
 *   dataDir/digests/runs.json 巡检索引（机读）
 *
 * 独立成模块的原因：Host 插件层需要 dsh 的 defineTool，而这一层用 node 就能跑，
 * 方便 scripts/smoke.mjs 在没有 Harness 的环境里验证。
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
    enabled: false,
    frequency: 'daily', // daily | weekly | monthly
    time: '08:30',
    weekdays: [1], // ISO 周几，1=周一
    monthday: 1,
  },
  push: {
    channels: ['session'], // session | macos | wechat
  },
  workspaceDir: null, // 指定巡检会话的工作目录；null = 用 Host 默认
  mirrorDir: null, // 把日报同时镜像到这个目录（通常放在工作区内，便于 DSH 预览）
  locale: 'auto', // auto | zh | en；auto = 跟随 DSH 语言
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

/** 调度服务要求 HH:mm:ss（可带小数秒）；用户习惯写 HH:mm，这里补齐。 */
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
  // cordis.patch.yml 里的 config 是初始默认值，settings.json 是运行期覆盖。
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
    }))
}

function saveTopics(dataDir, topics) {
  writeJson(paths(dataDir).topics, { version: VERSION, topics })
}

export function addTopic(dataDir, { topic, keywords, note }) {
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
  }
  topics.push(entry)
  saveTopics(dataDir, topics)
  return { topic: entry, created: true, total: topics.length }
}

export function removeTopic(dataDir, target) {
  const raw = String(target ?? '').trim()
  if (!raw) throw new Error('要删除哪个主题？给 id 或主题名')
  const topics = loadTopics(dataDir)
  let hit = topics.find((t) => t.id === raw)
  if (!hit) hit = topics.find((t) => normalizeName(t.topic) === normalizeName(raw))
  if (!hit) {
    const partial = topics.filter((t) => normalizeName(t.topic).includes(normalizeName(raw)))
    if (partial.length === 1) hit = partial[0]
    else if (partial.length > 1) {
      throw new Error(`有 ${partial.length} 个主题匹配「${raw}」，请用 id 指定：${partial.map((t) => `${t.id}(${t.topic})`).join('、')}`)
    }
  }
  if (!hit) return { removed: null, remaining: topics.length }
  const rest = topics.filter((t) => t.id !== hit.id)
  saveTopics(dataDir, rest)
  return { removed: hit, remaining: rest.length }
}

export function touchTopics(dataDir, ids) {
  const idset = new Set(ids)
  const topics = loadTopics(dataDir)
  const now = new Date().toISOString()
  for (const t of topics) if (idset.has(t.id)) t.lastRunAt = now
  saveTopics(dataDir, topics)
}

export function dayStamp(timeZone, date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  }
}

/* ---------- 巡检记录：一次巡检 = 一个 run = 一个报告文件 ---------- */

function runsPath(dataDir) {
  return join(paths(dataDir).digests, 'runs.json')
}

export function loadRuns(dataDir) {
  const raw = readJson(runsPath(dataDir), { version: VERSION, runs: [] })
  const list = Array.isArray(raw.runs) ? raw.runs : []
  return list.filter((run) => run && typeof run.id === 'string' && Array.isArray(run.entries))
}

function saveRuns(dataDir, runs) {
  writeJson(runsPath(dataDir), { version: VERSION, runs: runs.slice(-365) })
}

export function newRunId(date = new Date()) {
  return `run-${date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`
}

/** 开一次巡检。from/to 是本次检索覆盖的时间窗，写进报告头。 */
export function startRun(dataDir, { from = null, to = null } = {}) {
  ensureLayout(dataDir)
  const runs = loadRuns(dataDir)
  const startedAt = new Date().toISOString()
  // 同一秒内可能连开两次（补检 + 手动），id 撞了就加序号。
  const base = newRunId()
  let id = base
  for (let n = 2; runs.some((item) => item.id === id); n += 1) id = `${base}-${n}`
  const run = { id, startedAt, from, to: to ?? startedAt, finishedAt: null, entries: [] }
  runs.push(run)
  saveRuns(dataDir, runs)
  // 以「本次巡检开始时间」作为下轮的空窗起点：失败也不会让窗口错过。
  saveState(dataDir, { currentRunId: run.id, lastRunAt: startedAt })
  return run
}

export function currentRun(dataDir) {
  const state = loadState(dataDir)
  if (!state.currentRunId) return null
  return loadRuns(dataDir).find((run) => run.id === state.currentRunId) ?? null
}

/** 收尾上一次巡检（没写完的也关掉），返回关掉的那次。 */
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

export function appendRunEntry(dataDir, { topic, hasUpdate, summary, sources, note }) {
  ensureLayout(dataDir)
  const runs = loadRuns(dataDir)
  const state = loadState(dataDir)
  let run = state.currentRunId ? runs.find((item) => item.id === state.currentRunId) : null
  if (!run) {
    const now = new Date().toISOString()
    run = { id: newRunId(), startedAt: now, from: state.lastRunAt ?? null, to: now, finishedAt: null, entries: [] }
    runs.push(run)
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

  const file = join(paths(dataDir).digests, `${run.id}.md`)
  const lines = []
  if (!existsSync(file)) {
    lines.push(`# 关注清单巡检 ${formatStamp(run.startedAt)}`, '')
    lines.push(`- 覆盖区间：${run.from ? formatStamp(run.from) : '首次巡检'} → ${formatStamp(run.to)}`)
    lines.push('')
  }
  lines.push(`## ${entry.topic}`, '')
  lines.push(`- 状态：${entry.hasUpdate ? '有实质进展' : '无实质进展'}`)
  lines.push(`- 摘要：${entry.summary}`)
  if (entry.sources.length) {
    lines.push('- 来源：')
    for (const source of entry.sources) lines.push(`  - ${source}`)
  }
  if (entry.note) lines.push(`- 备注：${entry.note}`)
  lines.push('')
  appendFileSync(file, `${lines.join('\n')}\n`, 'utf8')
  return { runId: run.id, path: file, at, runTotal: run.entries.length }
}

export function markSeen(dataDir) {
  const at = new Date().toISOString()
  saveState(dataDir, { lastSeenAt: at })
  return at
}

export function unreadCount(dataDir) {
  const since = loadState(dataDir).lastSeenAt
  const entries = loadRuns(dataDir).flatMap((run) => run.entries)
  if (!since) return entries.length
  return entries.filter((entry) => String(entry.at) > String(since)).length
}

/** UI 用：最近若干次巡检，按开始时间倒序，附带报告文件路径。 */
export function listRuns(dataDir, limit = 14) {
  return loadRuns(dataDir)
    .slice()
    .sort((a, b) => (String(a.startedAt) < String(b.startedAt) ? 1 : -1))
    .slice(0, limit)
    .map((run) => ({ ...run, path: join(paths(dataDir).digests, `${run.id}.md`) }))
}

export function formatStamp(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 旧版按天存盘的迁移：index.json + YYYY-MM-DD.md → runs.json + run-*.md。 */
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
