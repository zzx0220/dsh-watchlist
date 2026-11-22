/**
 * dsh-watchlist — 关注清单的纯逻辑层。
 *
 * 这里不依赖 DeepSeek Harness 的任何服务，只做「文件 → 数据 → 文件」：
 *   dataDir/topics.json   关注的主题
 *   dataDir/settings.json 运行设置（对话里改的、手改的都算）
 *   dataDir/state.json    调度任务 id、最近一次巡检时间
 *   dataDir/digests/*.md  每次巡检的落盘记录
 *
 * 独立成模块的原因：Host 插件层需要 dsh 的 defineTool，而这一层用 node 就能跑，
 * 方便 scripts/smoke.mjs 在没有 Harness 的环境里验证。
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, appendFileSync } from 'node:fs'
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

export function recordDigest(dataDir, { timeZone, topic, hasUpdate, summary, sources, note }) {
  ensureLayout(dataDir)
  const day = dayStamp(timeZone)
  const file = join(paths(dataDir).digests, `${day}.md`)
  const lines = []
  if (!existsSync(file)) lines.push(`# 关注清单日报 ${day}`, '')
  lines.push(`## ${topic.trim()}`, '')
  lines.push(`- 状态：${hasUpdate ? '有实质进展' : '无实质进展'}`)
  lines.push(`- 摘要：${String(summary).trim()}`)
  if (sources && sources.length) {
    lines.push('- 来源：')
    for (const s of sources) lines.push(`  - ${String(s).trim()}`)
  }
  if (note && String(note).trim()) lines.push(`- 备注：${String(note).trim()}`)
  lines.push('')
  appendFileSync(file, `${lines.join('\n')}\n`, 'utf8')
  const text = readFileSync(file, 'utf8')
  const dayTotal = (text.match(/^## /gm) ?? []).length
  const at = new Date().toISOString()
  appendIndex(dataDir, {
    at,
    day,
    topic: topic.trim(),
    hasUpdate: hasUpdate === true,
    summary: String(summary).trim(),
    sources: (sources ?? []).map((s) => String(s).trim()),
    note: typeof note === 'string' ? note.trim() : '',
  })
  return { path: file, day, dayTotal, at }
}

/* ---------- 机读索引：UI 与未读计数用，markdown 仍给人看 ---------- */

function indexPath(dataDir) {
  return join(paths(dataDir).digests, 'index.json')
}

export function readIndex(dataDir) {
  const raw = readJson(indexPath(dataDir), { version: VERSION, entries: [] })
  return Array.isArray(raw.entries) ? raw.entries : []
}

export function appendIndex(dataDir, entry) {
  const entries = readIndex(dataDir)
  entries.push(entry)
  writeJson(indexPath(dataDir), { version: VERSION, entries: entries.slice(-500) })
  return entry
}

export function markSeen(dataDir) {
  const at = new Date().toISOString()
  saveState(dataDir, { lastSeenAt: at })
  return at
}

export function unreadCount(dataDir) {
  const since = loadState(dataDir).lastSeenAt
  const entries = readIndex(dataDir)
  if (!since) return entries.length
  return entries.filter((e) => String(e.at) > String(since)).length
}

/** 最近若干天，按日倒序分组；同时给出当天 markdown 的路径。 */
export function groupDigests(dataDir, days = 14) {
  const entries = readIndex(dataDir)
  const byDay = new Map()
  for (const entry of entries) {
    const day = String(entry.day ?? '')
    if (!day) continue
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(entry)
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, days)
    .map(([day, list]) => ({
      day,
      entries: list.slice().sort((a, b) => (String(a.at) < String(b.at) ? 1 : -1)),
      path: join(paths(dataDir).digests, `${day}.md`),
    }))
}
