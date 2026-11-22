/**
 * dsh-watchlist — Host half.
 *
 * A watchlist: note the topics you want to follow long term, let an Agent search
 * the web for progress on a schedule, write reports to disk, and push summaries
 * where configured. The plugin does no searching and no summarizing — those two
 * belong to the session Agent (web_search + the current model); this half owns
 * only the deterministic parts: topics, settings, scheduling, reports, push.
 *
 * Design trade-offs:
 *   - No re-implemented search or summarizing: reuse web_search / web_fetch and
 *     the conversation model; the plugin only produces a brief.
 *   - No re-implemented scheduling: reuse ctx.schedule, so the task shows up in
 *     the DSH Automation tasks page, where the user can pause or edit it.
 *   - Storage in files: topics.json / settings.json / digests/*.md — hand
 *     editable and backup friendly.
 *   - Push per channel: session (always available), macOS notification (the
 *     client half posts one native notification per run, only when the run has
 *     progress and only after the run stops being written to; clicking it opens
 *     that day's report).
 */
import { execFile, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as store from './lib/store.js'
import { translate } from './lib/copy.js'

export const name = 'watchlist'
export const inject = ['tools']

/** The copy for every user-visible string lives in lib/copy.js, one table per locale. */

/** The OS language stands in for the GUI language while settings.locale is "auto". */
function detectSystemLang() {
  const env = `${process.env.LC_ALL ?? ''} ${process.env.LC_MESSAGES ?? ''} ${process.env.LANG ?? ''}`
  if (/zh/i.test(env)) return 'zh'
  if (process.platform === 'darwin') {
    try {
      const out = spawnSync('defaults', ['read', '-g', 'AppleLanguages'], { encoding: 'utf8', timeout: 1500 })
      if (/zh/i.test(String(out?.stdout ?? ''))) return 'zh'
    } catch {
      /* No `defaults` command: fall through to English */
    }
  }
  return 'en'
}

const SYSTEM_LANG = detectSystemLang()

function expandHome(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (text === '~') return homedir()
  if (text.startsWith('~/')) return join(homedir(), text.slice(2))
  return text
}

function defaultDataDir(config) {
  const configured = expandHome(config?.dataDir)
  if (configured) return configured
  const home = String(process.env.DSH_HOME ?? '').trim() || join(homedir(), '.dsh')
  return join(home, 'watchlist')
}

function buildTiming(settings) {
  const { schedule } = settings
  const tz = settings.timeZone
  const time = store.toScheduleTime(schedule.time)
  const [hh, mm] = time.split(':').map((n) => Number(n))
  const h = Number.isFinite(hh) ? hh : 8
  const m = Number.isFinite(mm) ? mm : 30
  if (schedule.frequency === 'weekly') {
    return { kind: 'weekly', weekly: { time, time_zone: tz, weekdays: schedule.weekdays } }
  }
  if (schedule.frequency === 'monthly') {
    return { kind: 'cron', cron: { expression: `${m} ${h} ${schedule.monthday} * *`, time_zone: tz } }
  }
  return { kind: 'daily', daily: { time, time_zone: tz } }
}

function timingMatches(entry, timing) {
  if (!entry || !timing) return false
  if (entry.kind !== timing.kind) return false
  if (timing.kind === 'daily') {
    return entry.time === timing.daily.time && entry.timeZone === timing.daily.time_zone
  }
  if (timing.kind === 'weekly') {
    const a = (entry.weekdays ?? []).join(',')
    const b = (timing.weekly.weekdays ?? []).join(',')
    return entry.time === timing.weekly.time && entry.timeZone === timing.weekly.time_zone && a === b
  }
  if (timing.kind === 'cron') {
    return entry.expression === timing.cron.expression && entry.timeZone === timing.cron.time_zone
  }
  return false
}


export function apply(ctx, config) {
  const dataDir = defaultDataDir(config)
  store.ensureLayout(dataDir)

  const settingsOf = () => store.loadSettings(dataDir, config)

  /* ---------- Copy: settings.locale, then the OS, then English ---------- */

  // Cached briefly: t() runs many times inside one tool call, and loadSettings reads a file.
  let langCache = { at: 0, value: SYSTEM_LANG }
  const hostLang = () => {
    const now = Date.now()
    if (now - langCache.at < 2000) return langCache.value
    const declared = String(settingsOf().locale ?? 'auto')
    langCache = { at: now, value: declared === 'zh' || declared === 'en' ? declared : SYSTEM_LANG }
    return langCache.value
  }
  const t = (key, vars) => translate(hostLang(), key, vars)
  // «name» vs “name”: quote marks differ per locale, everything else is in copy.js.
  const q = (name) => (hostLang() === 'zh' ? `「${name}」` : `“${name}”`)
  const qList = (names) => names.map(q).join(t('list.sep'))

  const describeTiming = (timing) => {
    if (timing.kind === 'daily') return t('timing.daily', { time: timing.daily.time, zone: timing.daily.time_zone })
    if (timing.kind === 'weekly') {
      const days = (timing.weekly.weekdays ?? []).map((d) => t(`wd.${d}`)).join(t('list.sep'))
      return t('timing.weekly', { days, time: timing.weekly.time, zone: timing.weekly.time_zone })
    }
    if (timing.kind === 'cron') {
      const [mm, hh, day] = timing.cron.expression.split(' ')
      return t('timing.monthly', { day, hh: String(hh).padStart(2, '0'), mm, zone: timing.cron.time_zone })
    }
    return timing.kind
  }

  /**
   * Scheduling is opt-in. A patch that names a schedule turns it on unless the patch
   * carries `enabled` itself, so "check every day at 08:30" never leaves a task that
   * silently does nothing; an explicit `enabled: false` still pauses it.
   */
  const withScheduleIntent = (patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch
    const schedule = patch.schedule
    if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return patch
    if (Object.prototype.hasOwnProperty.call(schedule, 'enabled')) return patch
    return { ...patch, schedule: { ...schedule, enabled: true } }
  }

  const scheduleService = () => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('schedule') : ctx.schedule
    } catch {
      return undefined
    }
  }

  async function ensureTask(force = false) {
    const settings = settingsOf()
    if (!settings.schedule.enabled) return { skipped: true, reason: 'settings.schedule.enabled = false' }
    const schedule = scheduleService()
    if (!schedule) return { skipped: true, reason: t('err.noScheduleService') }
    const timing = buildTiming(settings)
    const state = store.loadState(dataDir)
    const target = { kind: 'new_once', create: settings.workspaceDir ? { cwd: settings.workspaceDir } : {} }

    if (state.scheduleTaskId) {
      const view = await schedule.view({ id: state.scheduleTaskId }).catch(() => null)
      if (view && view.id) {
        if (!force && timingMatches(view, timing) && view.status !== 'ended') {
          return { taskId: view.id, status: view.status, timing: describeTiming(timing), changed: false }
        }
        const result = await schedule.edit({ id: state.scheduleTaskId, action: 'update', patch: { timing } })
        return { taskId: state.scheduleTaskId, status: result?.status ?? 'active', timing: describeTiming(timing), changed: true }
      }
    }
    const created = await schedule.create({ title: t('task.title'), prompt: t('task.prompt'), timing, target })
    store.saveState(dataDir, { scheduleTaskId: created.id })
    return { taskId: created.id, status: created.status, timing: describeTiming(timing), changed: true, created: true }
  }

  // Verify in the background on load: schedule / webServer may come up after the
  // plugin, so retry briefly and fail silently (the tools can be triggered by hand).
  const timers = []
  try {
    ctx.effect(() => () => {
      for (const timer of timers) clearTimeout(timer)
      timers.length = 0
    })
  } catch {
    /* Older Cordis has no effect: skip cleanup, the process exit reclaims it */
  }
  const whenService = (name, run, attempt = 0) => {
    let service
    try {
      service = typeof ctx.get === 'function' ? ctx.get(name) : ctx[name]
    } catch {
      service = undefined
    }
    if (service) {
      run(service)
      return
    }
    if (attempt < 6) timers.push(setTimeout(() => whenService(name, run, attempt + 1), 1500 * (attempt + 1)))
  }

  const defaultEveryDays = (settings) =>
    settings.schedule.frequency === 'weekly' ? 7 : settings.schedule.frequency === 'monthly' ? 30 : 1
  const RUN_INTERVAL_MS = { daily: 86400000, weekly: 7 * 86400000, monthly: 30 * 86400000 }
  const overdue = (settings) => {
    const days = defaultEveryDays(settings)
    return store.dueTopics(dataDir, days).some((topic) => topic.lastCheckedAt)
  }

  whenService('schedule', (schedule) => {
    const settings = settingsOf()
    if (!settings.schedule.enabled) return
    // A new user has an empty list: create no task and run no catch-up; wait for
    // the first watchlist_add to create one.
    if (store.loadTopics(dataDir).length === 0) return
    ensureTask(false)
      .then((task) => {
        if (!task || !task.taskId) return undefined
        if (!overdue(settings)) return undefined
        // The scheduled time passed while the machine or app was off: catch up once
        // after startup; brief defines the window as “last run until now”.
        return Promise.resolve(schedule.run({ id: task.taskId })).catch(() => undefined)
      })
      .catch(() => undefined)
  })

  /* ---------- Loopback-only HTTP API for the client half ---------- */

  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
        } catch {
          resolve({})
        }
      })
      req.on('error', () => resolve({}))
    })
  const sendJson = (res, code, value) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }
  const isLoopback = (req) => {
    const address = req.socket?.remoteAddress ?? ''
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  }

  let routesRegistered = false
  whenService('webServer', (webServer) => {
    if (routesRegistered || typeof webServer.register !== 'function') return
    routesRegistered = true

    const RUN_ID_RE = /^run-\d{8}T\d{6}Z(?:-\d+)?$/
    /**
     * One file per day means the file name no longer carries the run: resolve the run
     * record first, and fall back to the legacy per-run file for older records.
     */
    const reportOfRun = (runId) => {
      const run = store.loadRuns(dataDir).find((item) => item.id === runId) || null
      return { run, file: run ? store.reportPathOf(dataDir, run) : join(dataDir, 'digests', `${runId}.md`) }
    }

    const buildState = async () => {
      const settings = settingsOf()
      const state = store.loadState(dataDir)
      let task = null
      const schedule = scheduleService()
      if (schedule && state.scheduleTaskId) {
        const view = await schedule.view({ id: state.scheduleTaskId }).catch(() => null)
        if (view && view.id) {
          task = {
            id: view.id,
            status: view.status,
            sessionId: view.target && view.target.sessionId ? view.target.sessionId : null,
          }
        }
      }
      // Hand the client a session that really exists for doc-URL authorization:
      // prefer a live Agent, fall back to the task's target session.
      let openSessionId = null
      try {
        const agents = typeof ctx.get === 'function' ? ctx.get('agents') : ctx.agents
        const list = agents && typeof agents.list === 'function' ? agents.list() : []
        const first = Array.isArray(list) && list.length ? list[list.length - 1] : null
        if (first) openSessionId = first.id ?? first.sessionId ?? (first.session && first.session.id) ?? null
      } catch {
        openSessionId = null
      }
      if (!openSessionId && task) openSessionId = task.sessionId
      return {
        ok: true,
        dataDir,
        openSessionId,
        topics: store.loadTopics(dataDir),
        settings,
        schedule: {
          enabled: settings.schedule.enabled,
          timing: describeTiming(buildTiming(settings)),
          task,
        },
        runs: store.listRuns(dataDir, 14),
        highlights: store.highlights(dataDir),
        starredIds: store.starredIds(dataDir),
        starred: store.starredCount(dataDir),
        ...store.counters(dataDir),
        lastSeenAt: state.lastSeenAt ?? null,
      }
    }

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/dsh-watchlist-api/state',
      async handler(req, res) {
        if (!isLoopback(req)) return sendJson(res, 403, { ok: false, error: 'loopback only' })
        if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
        try {
          sendJson(res, 200, await buildState())
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    }))

    // A badge-sized read: the client polls this every few seconds, so it must stay
    // cheap and must not build the whole page state.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/dsh-watchlist-api/counts',
      async handler(req, res) {
        if (!isLoopback(req)) return sendJson(res, 403, { ok: false, error: 'loopback only' })
        if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
        try {
          sendJson(res, 200, { ok: true, ...store.counters(dataDir) })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/dsh-watchlist-api/action',
      async handler(req, res) {
        if (!isLoopback(req)) return sendJson(res, 403, { ok: false, error: 'loopback only' })
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
        const body = await readBody(req)
        const type = String(body.type ?? '')
        try {
          if (type === 'seen' || type === 'unseen') {
            // No runId means "every report"; one runId touches only that report. The
            // write is the only difference, so both actions answer with the new counts.
            const runId = body.runId === undefined || body.runId === null ? '' : String(body.runId).trim()
            if (runId && !RUN_ID_RE.test(runId)) return sendJson(res, 400, { ok: false, error: t('err.badRunId') })
            const mark = type === 'seen'
            if (runId) {
              if (mark) store.markRunSeen(dataDir, runId)
              else store.markRunUnseen(dataDir, runId)
            } else if (mark) {
              store.markSeen(dataDir)
            } else {
              store.markAllUnseen(dataDir)
            }
            return sendJson(res, 200, { ok: true, ...store.counters(dataDir) })
          }
          if (type === 'add') {
            const result = store.addTopic(dataDir, body)
            return sendJson(res, 200, { ok: true, created: result.created, topic: result.topic })
          }
          if (type === 'remove') {
            const result = store.removeTopic(dataDir, body.target)
            return sendJson(res, 200, { ok: true, removed: Boolean(result.removed), remaining: result.remaining })
          }
          if (type === 'update-topic') {
            const patch = {}
            if (body.everyDays !== undefined) patch.everyDays = Number(body.everyDays) > 0 ? Number(body.everyDays) : null
            if (body.note !== undefined) patch.note = String(body.note)
            if (Array.isArray(body.keywords)) patch.keywords = body.keywords
            const updated = store.updateTopic(dataDir, String(body.target ?? body.id ?? ''), patch)
            if (!updated) return sendJson(res, 404, { ok: false, error: t('err.noTopic') })
            return sendJson(res, 200, { ok: true, topic: updated })
          }
          if (type === 'settings') {
            const raw = body.patch && typeof body.patch === 'object' ? body.patch : {}
            const patch = withScheduleIntent(raw)
            const settings = store.saveSettings(dataDir, patch)
            let note = ''
            if (patch.schedule || patch.timeZone || patch.workspaceDir) {
              try {
                const sync = await ensureTask(true)
                note = sync.skipped ? sync.reason : sync.timing
              } catch (error) {
                note = String(error?.message ?? error)
              }
            }
            return sendJson(res, 200, { ok: true, settings, note })
          }
          if (type === 'star' || type === 'unstar') {
            // A star names one finding, not a report: the same run can hold one starred
            // entry and one ordinary one, and reading the report must not clear it.
            const runId = String(body.runId ?? '').trim()
            const entryId = String(body.entryId ?? '').trim()
            if (!RUN_ID_RE.test(runId)) return sendJson(res, 400, { ok: false, error: t('err.badRunId') })
            if (!entryId) return sendJson(res, 400, { ok: false, error: t('err.missingEntryId') })
            const result = store.setStar(dataDir, runId, entryId, type === 'star')
            if (!result) return sendJson(res, 404, { ok: false, error: t('err.noRecord') })
            return sendJson(res, 200, { ok: true, starred: result.starred, ...store.counters(dataDir) })
          }
          if (type === 'read') {
            const runId = String(body.runId ?? '').trim()
            if (!RUN_ID_RE.test(runId)) return sendJson(res, 400, { ok: false, error: t('err.badRunId') })
            const { run, file } = reportOfRun(runId)
            if (!existsSync(file)) return sendJson(res, 404, { ok: false, error: t('err.noReportFile', { runId }) })
            return sendJson(res, 200, {
              ok: true,
              runId,
              day: run ? run.day ?? null : null,
              seq: run ? run.seq ?? null : null,
              path: file,
              text: readFileSync(file, 'utf8'),
            })
          }
          if (type === 'open') {
            const root = join(dataDir, 'digests')
            let file = null
            if (body.runId !== undefined && String(body.runId).trim()) {
              const runId = String(body.runId).trim()
              if (!RUN_ID_RE.test(runId)) return sendJson(res, 400, { ok: false, error: t('err.badRunId') })
              file = reportOfRun(runId).file
            } else if (body.path !== undefined && String(body.path).trim()) {
              file = resolve(String(body.path).trim())
            }
            if (!file) return sendJson(res, 400, { ok: false, error: t('err.needRunIdOrPath') })
            if (!file.startsWith(resolve(root) + sep)) return sendJson(res, 403, { ok: false, error: t('err.outsideDigestDir') })
            if (!file.endsWith('.md')) return sendJson(res, 400, { ok: false, error: t('err.notMarkdown') })
            if (!existsSync(file)) return sendJson(res, 404, { ok: false, error: t('err.fileMissing', { file }) })
            if (process.platform !== 'darwin') return sendJson(res, 400, { ok: false, error: t('err.macOSOnly') })
            execFile('open', [file], (error) => {
              if (error) sendJson(res, 500, { ok: false, error: String(error.message ?? error) })
              else sendJson(res, 200, { ok: true, path: file })
            })
            return
          }
          if (type === 'sync' || type === 'run') {
            const schedule = scheduleService()
            if (!schedule) return sendJson(res, 400, { ok: false, error: t('err.noScheduleProfile') })
            if (type === 'sync') {
              const result = await ensureTask(true)
              return sendJson(res, 200, { ok: true, note: result.skipped ? result.reason : result.timing })
            }
            const state = store.loadState(dataDir)
            if (!state.scheduleTaskId) return sendJson(res, 400, { ok: false, error: t('err.noTaskYet') })
            const result = await schedule.run({ id: state.scheduleTaskId })
            if (result && result.code === 'schedule_execution_pending') return sendJson(res, 400, { ok: false, error: t('err.runPending') })
            return sendJson(res, 200, { ok: true })
          }
          return sendJson(res, 400, { ok: false, error: t('err.unknownAction', { type }) })
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
        }
      },
    }))
  })


  // Tell the agent in any session how the watchlist works (turn off with
  // promptHint: false in cordis.patch.yml).
  if (config?.promptHint !== false) {
    try {
      const systemPrompt = typeof ctx.get === 'function' ? ctx.get('systemPrompt') : ctx.systemPrompt
      if (systemPrompt && typeof systemPrompt.section === 'function') {
        ctx.effect(() =>
          systemPrompt.section({
            name: 'tool:watchlist',
            order: 900,
            text: t('hint.watchlist'),
          }),
        )
      }
    } catch {
      /* Without a systemPrompt service, rely on the tool definitions alone */
    }
  }

  const tool = (definition) => ctx.tools.register(defineTool(definition))
  const text = (value) => [{ type: 'text', text: value.message }]

  tool({
    name: 'watchlist_add',
    description:
      'Add a topic to the watchlist; every check tracks it from then on. Restate the wording and confirm it with the user before writing, and add a note saying what counts as progress. ' +
      'Make the topic specific ("a new release of model X" beats "AI"). Adding the same topic twice does not duplicate it; use topics to add several at once.',
    parameters: {
      topic: { type: 'string', description: 'One topic to follow; use either topic or topics' },
      topics: { type: 'array', items: { type: 'string' }, description: 'Several topics at once; use either topic or topics' },
      keywords: { type: 'array', items: { type: 'string' }, description: 'Extra search keywords; optional' },
      note: { type: 'string', description: 'Note for you and the check: why you care, what counts as progress' },
      everyDays: { type: 'number', description: "This topic's own interval in days; leave empty to follow the global schedule" },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute(args) {
      const single = String(args.topic ?? '').trim()
      const batch = Array.isArray(args.topics) ? args.topics.map((item) => String(item).trim()).filter(Boolean) : []
      const names = single ? [single, ...batch.filter((name) => name !== single)] : batch
      if (!names.length) return { message: t('add.needNames'), ok: false }
      const added = []
      const existed = []
      for (const name of names) {
        const result = store.addTopic(dataDir, { topic: name, keywords: args.keywords, note: args.note, everyDays: args.everyDays, lang: hostLang() })
        if (result.created) added.push(result.topic.topic)
        else existed.push(result.topic.topic)
      }
      if (added.length) {
        // The scheduled task is created only once the first topic arrives.
        const settings = settingsOf()
        if (settings.schedule.enabled) ensureTask(false).catch(() => undefined)
      }
      const total = store.loadTopics(dataDir).length
      const lines = []
      if (added.length) lines.push(t('add.added', { list: qList(added) }))
      if (existed.length) lines.push(t('add.existed', { list: qList(existed) }))
      return {
        message: t('add.done', { lines: lines.join(t('text.sep')), total }),
        ok: true,
        added,
        existed,
        total,
      }
    },
  })

  tool({
    name: 'watchlist_remove',
    description: 'Remove one topic from the watchlist. target may be an id or a topic name; a name is only accepted when exactly one topic matches.',
    parameters: {
      target: { type: 'string', required: true, description: 'Topic id or topic name' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute(args) {
      const result = store.removeTopic(dataDir, args.target, hostLang())
      if (!result.removed) return { message: t('remove.missing', { target: args.target }), remaining: result.remaining }
      return {
        message: t('remove.done', { topic: result.removed.topic, remaining: result.remaining }),
        remaining: result.remaining,
      }
    },
  })

  tool({
    name: 'watchlist_update',
    description:
      'Change one topic: its own interval (everyDays, 0 = follow the global default), its note, or its keywords. ' +
      'Fields you leave out keep their value. target may be an id or a unique topic name.',
    parameters: {
      target: { type: 'string', required: true, description: 'Topic id or topic name' },
      everyDays: { type: 'number', description: "This topic's own interval in days; 0 = follow the global default" },
      note: { type: 'string', description: 'What to watch for, or a reminder' },
      keywords: { type: 'array', items: { type: 'string' }, description: 'Search keywords' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute(args) {
      const patch = {}
      if (args.everyDays !== undefined) patch.everyDays = Number(args.everyDays) > 0 ? Number(args.everyDays) : null
      if (args.note !== undefined) patch.note = args.note
      if (args.keywords !== undefined) patch.keywords = args.keywords
      const updated = store.updateTopic(dataDir, args.target, patch, hostLang())
      if (!updated) return { message: t('update.missing', { target: args.target }), ok: false }
      const every = updated.everyDays ? t('update.every', { days: updated.everyDays }) : t('update.followDefault')
      return { message: t('update.done', { topic: updated.topic, every }), ok: true, topic: updated }
    },
  })

  tool({
    name: 'watchlist_list',
    description: 'Show the watchlist, the current settings, the schedule status, and where the reports live. Use it when the user asks what is being followed or how it is configured.',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute() {
      const settings = settingsOf()
      const topics = store.loadTopics(dataDir)
      const state = store.loadState(dataDir)
      const schedule = scheduleService()
      let task = null
      if (schedule && state.scheduleTaskId) {
        const view = await schedule.view({ id: state.scheduleTaskId }).catch(() => null)
        task = view && view.id ? { id: view.id, status: view.status, timing: describeTiming(buildTiming(settings)) } : null
      }
      const lines = topics.length
        ? topics.map((entry, index) => {
            const last = entry.lastRunAt ? t('list.lastChecked', { date: entry.lastRunAt.slice(0, 10) }) : t('list.neverChecked')
            return t('list.item', { index: index + 1, topic: entry.topic, id: entry.id }) + last
          })
        : [t('list.empty')]
      return {
        message: [
          t('list.header', { count: topics.length }),
          ...lines,
          t('list.schedule', {
            timing: settings.schedule.enabled ? describeTiming(buildTiming(settings)) : t('list.scheduleOff'),
          }) + (task ? t('list.taskSuffix', { status: task.status }) : ''),
          t('list.push', { channels: settings.push.channels.join(t('list.sep')) || t('list.none') }),
          t('list.window', { days: settings.lookbackDays, dir: dataDir }),
        ].join('\n'),
        dataDir,
        topics: topics.map((t) => ({ id: t.id, topic: t.topic, keywords: t.keywords, lastRunAt: t.lastRunAt })),
        settings,
        task,
      }
    },
  })

  tool({
    name: 'watchlist_run_brief',
    description:
      'Call this when a check starts: it opens one run and returns the topics due this round, each topic’s own search window, the push channels, and where the digest is written. ' +
      'It is the only authority for what to search and for which period; never guess, and do not search a topic that is absent from the answer.',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute() {
      const settings = settingsOf()
      const now = Date.now()
      if (store.loadTopics(dataDir).length === 0) {
        return { message: t('brief.empty'), skip: true, reason: 'empty', dataDir }
      }
      const current = store.currentRun(dataDir)
      if (current && now - new Date(current.startedAt).getTime() < 30 * 60 * 1000) {
        return { message: t('brief.recent'), skip: true, runId: current.id, dataDir }
      }
      const days = defaultEveryDays(settings)
      const due = store.dueTopics(dataDir, days)
      if (due.length === 0) {
        return { message: t('brief.noneDue'), skip: true, reason: 'none-due', dataDir }
      }
      store.closeCurrentRun(dataDir)
      const limited = due.slice(0, settings.maxTopicsPerRun)
      const fallback = now - settings.lookbackDays * 86400000
      const windows = limited.map((topic) => {
        const last = topic.lastCheckedAt ? new Date(topic.lastCheckedAt).getTime() : NaN
        return { topic, from: new Date(Number.isFinite(last) ? last : fallback).toISOString() }
      })
      const runFrom = windows.reduce((min, item) => (item.from < min ? item.from : min), windows[0].from)
      const run = store.startRun(dataDir, { from: runFrom, to: new Date(now).toISOString(), day: store.dayStamp(settings.timeZone) })
      const reportPath = store.reportPathOf(dataDir, run)
      const lines = windows.map((item, index) => {
        let line = t('brief.item', {
          index: index + 1,
          topic: item.topic.topic,
          id: item.topic.id,
          from: store.formatStamp(item.from),
        })
        if (item.topic.everyDays) line += t('brief.every', { days: item.topic.everyDays })
        if (item.topic.keywords.length) line += t('brief.keywords', { list: item.topic.keywords.join(' / ') })
        if (item.topic.note) line += t('brief.note', { note: String(item.topic.note).replace(/^(关注点|Focus)[:：]\s*/i, '') })
        return line
      })
      return {
        message: [
          t('brief.header', {
            stamp: store.formatStamp(run.startedAt),
            due: limited.length,
            total: store.loadTopics(dataDir).length,
            channels: settings.push.channels.join(t('list.sep')) || t('list.none'),
          }),
          ...lines,
          due.length > limited.length ? t('brief.more', { count: due.length - limited.length }) : null,
          t('brief.path', { path: reportPath }) + (run.seq > 1 ? t('brief.pathSeq', { seq: run.seq }) : ''),
        ]
          .filter(Boolean)
          .join('\n'),
        runId: run.id,
        runSeq: run.seq ?? 1,
        day: run.day,
        reportPath,
        from: run.from,
        to: run.to,
        dataDir,
        timeZone: settings.timeZone,
        push: settings.push.channels,
        topics: windows.map((item) => ({
          id: item.topic.id,
          topic: item.topic.topic,
          from: item.from,
          everyDays: item.topic.everyDays,
          keywords: item.topic.keywords,
          note: item.topic.note,
        })),
      }
    },
  })

  tool({
    name: 'watchlist_record',
    description:
      'Record one topic’s result for this check: appended to today’s report file (one file per day; several runs on the same day each take their own section). Call it once per topic per check. ' +
      'hasUpdate marks real progress. importance: high means the user should know immediately — only when it changes the picture, needs an action, or is a breakthrough; leave it out for ordinary updates. ' +
      'One source per line in sources, written as “title - link”.',
    parameters: {
      topic: { type: 'string', required: true, description: 'Topic id or name, from watchlist_run_brief' },
      summary: { type: 'string', required: true, description: 'One-sentence verdict: what progressed, or why nothing did' },
      hasUpdate: { type: 'boolean', description: 'Whether there is real progress; default false' },
      importance: {
        type: 'string',
        description: 'high = the user should know immediately (changes the picture / needs an action / breakthrough); normal or empty = ordinary update',
      },
      sources: { type: 'array', items: { type: 'string' }, description: 'Sources, one “title - link” per item' },
      note: { type: 'string', description: 'Extra context; optional' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute(args) {
      const settings = settingsOf()
      const topics = store.loadTopics(dataDir)
      const raw = String(args.topic ?? '').trim()
      const hit =
        topics.find((t) => t.id === raw) ||
        topics.find((t) => store.normalizeName(t.topic) === store.normalizeName(raw)) ||
        topics.find((t) => store.normalizeName(t.topic).includes(store.normalizeName(raw)))
      if (!hit) return { message: t('record.missing', { raw }), recorded: false }
      const importance = store.normalizeImportance(args.importance)
      const result = store.appendRunEntry(dataDir, {
        topic: hit.topic,
        hasUpdate: args.hasUpdate === true,
        importance,
        summary: args.summary,
        sources: args.sources ?? [],
        note: args.note,
        day: store.dayStamp(settings.timeZone),
        lang: hostLang(),
      })
      store.touchTopics(dataDir, [hit.id])
      return {
        message: t('record.done', {
          flag: importance === 'high' ? t('record.important') : '',
          topic: hit.topic,
          path: result.path,
          runTotal: result.runTotal,
          dayTotal: result.dayTotal,
        }),
        recorded: true,
        path: result.path,
        runId: result.runId,
        entryId: result.entryId,
        importance,
        runTotal: result.runTotal,
        dayTotal: result.dayTotal,
        day: result.day,
        seq: result.seq,
      }
    },
  })

  tool({
    name: 'watchlist_schedule',
    description:
      'Manage the automatic check: sync creates or updates the task from the current settings, pause/resume stop and restart it, remove deletes it, ' +
      'run_now delivers one check to the conversation right away. The task also appears on the DSH Automation page.',
    parameters: {
      action: { type: 'string', required: true, description: 'sync | pause | resume | remove | run_now' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute(args) {
      const schedule = scheduleService()
      if (!schedule) return { message: t('sched.noService'), ok: false }
      const state = store.loadState(dataDir)
      const action = String(args.action ?? '').trim()
      if (action === 'sync') {
        const result = await ensureTask(true)
        if (result.skipped) return { message: t('sched.skipped', { reason: result.reason }), ok: false }
        return {
          message: t(result.created ? 'sched.created' : 'sched.updated', { timing: result.timing, id: result.taskId }),
          ok: true,
          taskId: result.taskId,
          timing: result.timing,
        }
      }
      if (!state.scheduleTaskId) return { message: t('sched.noTask'), ok: false }
      if (action === 'pause' || action === 'resume') {
        await schedule.edit({ id: state.scheduleTaskId, action: 'update', patch: { active: action === 'resume' } })
        return { message: t(action === 'pause' ? 'sched.paused' : 'sched.resumed'), ok: true }
      }
      if (action === 'remove') {
        await schedule.edit({ id: state.scheduleTaskId, action: 'delete' })
        store.saveState(dataDir, { scheduleTaskId: null })
        return { message: t('sched.removed'), ok: true }
      }
      if (action === 'run_now') {
        const result = await schedule.run({ id: state.scheduleTaskId })
        if (result && result.code === 'schedule_execution_pending') return { message: t('sched.pending'), ok: false }
        return { message: t('sched.delivered'), ok: true }
      }
      return { message: t('sched.unknown', { action }), ok: false }
    },
  })

  tool({
    name: 'watchlist_settings',
    description:
      'Read or change the check settings. Put only the fields to change in patch, for example {"schedule":{"time":"09:00"},"push":{"channels":["session","macos"]}}. ' +
      'Changing a schedule field syncs the task; watchlist_schedule sync rebuilds it as well.',
    parameters: {
      patch: { type: 'string', description: 'Partial settings as a JSON string, for example {"lookbackDays":3}; leave empty to only read' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute(args) {
      let patch = null
      if (args.patch && String(args.patch).trim()) {
        try {
          patch = JSON.parse(String(args.patch))
        } catch {
          return { message: t('set.badJson'), ok: false }
        }
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { message: t('set.notObject'), ok: false }
        patch = withScheduleIntent(patch)
        store.saveSettings(dataDir, patch)
      }
      const settings = store.loadSettings(dataDir, config)
      const touchesSchedule = patch && (patch.schedule || patch.timeZone || patch.workspaceDir)
      let syncNote = ''
      if (touchesSchedule) {
        try {
          const sync = await ensureTask(true)
          syncNote = sync.skipped ? t('set.noteSkipped', { reason: sync.reason }) : t('set.noteSynced', { timing: sync.timing })
        } catch (error) {
          syncNote = t('set.noteFailed', { message: error?.message ?? error })
        }
      }
      const summary = [
        t('set.lookback', { days: settings.lookbackDays, zone: settings.timeZone, max: settings.maxTopicsPerRun }),
        t('set.schedule', {
          timing: settings.schedule.enabled ? describeTiming(buildTiming(settings)) : t('list.scheduleOff'),
          frequency: settings.schedule.frequency,
        }),
        t('set.push', { channels: settings.push.channels.join(t('list.sep')) || t('list.none') }),
        t('set.data', { dir: dataDir }),
      ].join('\n')
      return { message: patch ? t('set.saved', { note: syncNote }) + `\n${summary}` : summary, ok: true, settings }
    },
  })
}
