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
 *     that day's report), WeChat (the Agent calls notify_wechat; the plugin does
 *     not couple to the WeChat plugin).
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as store from './lib/store.js'

export const name = 'watchlist'
export const inject = ['tools']

const TASK_TITLE = '关注清单巡检'

/** The check prompt stays stable: every variable part comes from watchlist_run_brief at run time. */
const TASK_PROMPT = [
  '【关注清单巡检】',
  '这是一次定期的关注清单巡检，请按以下步骤执行：',
  '1. 调用 watchlist_run_brief，取得本次要追踪的主题、检索窗口（上次巡检到现在）和推送方式。',
  '2. 对每个主题用 web_search 检索该窗口内的新进展；需要确认细节时用 web_fetch 打开原文。只采信带日期的来源。',
  '3. 每个主题调用一次 watchlist_record：hasUpdate 表示是否有实质新进展，summary 写一句话结论，sources 附标题和链接。',
  '4. 全部主题记录完后，把本轮情况汇总成不超过 600 字的简报。',
  '5. 按 brief 给出的推送方式推送：含 wechat 且 notify_wechat 可用时调用它发送简报，否则直接在会话里输出。',
  '只做检索、记录、推送；不要下载文件、不要安装软件、不要改清单以外的文件。',
].join('\n')

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

function describeTiming(timing) {
  if (timing.kind === 'daily') return `每天 ${timing.daily.time}（${timing.daily.time_zone}）`
  if (timing.kind === 'weekly') {
    const names = ['一', '二', '三', '四', '五', '六', '日']
    const days = (timing.weekly.weekdays ?? []).map((d) => `周${names[d - 1] ?? d}`).join('、')
    return `每${days} ${timing.weekly.time}（${timing.weekly.time_zone}）`
  }
  if (timing.kind === 'cron') return `每月 ${timing.cron.expression.split(' ')[2]} 日 ${timing.cron.expression.split(' ')[1]}:${String(timing.cron.expression.split(' ')[0]).padStart(2, '0')}（${timing.cron.time_zone}）`
  return timing.kind
}

export function apply(ctx, config) {
  const dataDir = defaultDataDir(config)
  store.ensureLayout(dataDir)

  const settingsOf = () => store.loadSettings(dataDir, config)

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
    if (!schedule) return { skipped: true, reason: 'schedule 服务不可用（当前 profile 未挂载 dsh-schedule）' }
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
    const created = await schedule.create({ title: TASK_TITLE, prompt: TASK_PROMPT, timing, target })
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
            if (runId && !RUN_ID_RE.test(runId)) return sendJson(res, 400, { ok: false, error: 'runId 格式不对' })
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
            if (!updated) return sendJson(res, 404, { ok: false, error: '没有这个主题' })
            return sendJson(res, 200, { ok: true, topic: updated })
          }
          if (type === 'settings') {
            const patch = body.patch && typeof body.patch === 'object' ? body.patch : {}
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
          if (type === 'read') {
            const runId = String(body.runId ?? '').trim()
            if (!RUN_ID_RE.test(runId)) return sendJson(res, 400, { ok: false, error: 'runId 格式不对' })
            const { run, file } = reportOfRun(runId)
            if (!existsSync(file)) return sendJson(res, 404, { ok: false, error: `没有 ${runId} 的报告文件` })
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
              if (!RUN_ID_RE.test(runId)) return sendJson(res, 400, { ok: false, error: 'runId 格式不对' })
              file = reportOfRun(runId).file
            } else if (body.path !== undefined && String(body.path).trim()) {
              file = resolve(String(body.path).trim())
            }
            if (!file) return sendJson(res, 400, { ok: false, error: '需要 runId 或 path' })
            if (!file.startsWith(resolve(root) + sep)) return sendJson(res, 403, { ok: false, error: '只允许打开日报目录里的文件' })
            if (!file.endsWith('.md')) return sendJson(res, 400, { ok: false, error: '只允许打开 markdown 日报' })
            if (!existsSync(file)) return sendJson(res, 404, { ok: false, error: `文件不存在：${file}` })
            if (process.platform !== 'darwin') return sendJson(res, 400, { ok: false, error: '打开文件目前只支持 macOS' })
            execFile('open', [file], (error) => {
              if (error) sendJson(res, 500, { ok: false, error: String(error.message ?? error) })
              else sendJson(res, 200, { ok: true, path: file })
            })
            return
          }
          if (type === 'sync' || type === 'run') {
            const schedule = scheduleService()
            if (!schedule) return sendJson(res, 400, { ok: false, error: '当前 profile 没有挂载 dsh-schedule' })
            if (type === 'sync') {
              const result = await ensureTask(true)
              return sendJson(res, 200, { ok: true, note: result.skipped ? result.reason : result.timing })
            }
            const state = store.loadState(dataDir)
            if (!state.scheduleTaskId) return sendJson(res, 400, { ok: false, error: '还没有巡检任务，先同步一次' })
            const result = await schedule.run({ id: state.scheduleTaskId })
            if (result && result.code === 'schedule_execution_pending') return sendJson(res, 400, { ok: false, error: '上一次巡检还没跑完' })
            return sendJson(res, 200, { ok: true })
          }
          return sendJson(res, 400, { ok: false, error: `未知操作：${type}` })
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
            text:
              '关注清单（watchlist_*）：用户想长期跟进某个话题时，先复述并确认主题措辞，再调用 watchlist_add，' +
              '并在 note 里写清"什么算有进展"；每条可用 everyDays 指定自己的检查间隔（watchlist_update 可改）；查看清单用 watchlist_list，删除用 watchlist_remove。',
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
      '把主题加入关注清单，之后每次巡检都会追踪它。写入前先向用户复述并确认主题措辞，并尽量补一条 note 说明"什么算有进展"。' +
      '主题写得具体一点（"某个模型的新版本发布" 好过 "AI"）。重复添加同一主题不会新增。可用 topics 一次加多个。',
    parameters: {
      topic: { type: 'string', description: '要长期追踪的主题（单个）；与 topics 二选一' },
      topics: { type: 'array', items: { type: 'string' }, description: '一次加多个主题；与 topic 二选一' },
      keywords: { type: 'array', items: { type: 'string' }, description: '补充搜索关键词，可留空' },
      note: { type: 'string', description: '给自己和巡检用的备注：为什么关注、什么叫有进展' },
      everyDays: { type: 'number', description: '这条自己的检查间隔（天）。留空则跟随全局调度频率' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute(args) {
      const single = String(args.topic ?? '').trim()
      const batch = Array.isArray(args.topics) ? args.topics.map((item) => String(item).trim()).filter(Boolean) : []
      const names = single ? [single, ...batch.filter((name) => name !== single)] : batch
      if (!names.length) return { message: '需要 topic 或 topics：告诉我至少一个主题', ok: false }
      const added = []
      const existed = []
      for (const name of names) {
        const result = store.addTopic(dataDir, { topic: name, keywords: args.keywords, note: args.note, everyDays: args.everyDays })
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
      if (added.length) lines.push(`已加入：${added.map((name) => `「${name}」`).join('、')}`)
      if (existed.length) lines.push(`已在清单里：${existed.map((name) => `「${name}」`).join('、')}`)
      return {
        message: `${lines.join('；')}（共 ${total} 个主题）`,
        ok: true,
        added,
        existed,
        total,
      }
    },
  })

  tool({
    name: 'watchlist_remove',
    description: '从关注清单移除一个主题。target 可以是 id，也可以是主题名；只有唯一匹配时才会按名字删除。',
    parameters: {
      target: { type: 'string', required: true, description: '主题 id 或主题名' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute(args) {
      const result = store.removeTopic(dataDir, args.target)
      if (!result.removed) return { message: `清单里没有匹配「${args.target}」的主题`, remaining: result.remaining }
      return {
        message: `已移除「${result.removed.topic}」，剩 ${result.remaining} 个主题`,
        remaining: result.remaining,
      }
    },
  })

  tool({
    name: 'watchlist_update',
    description:
      '修改一条关注主题：单独设置它的检查间隔（everyDays，0 表示跟随全局默认）、备注或关键词。' +
      '不传的字段保持不变。target 可用 id 或唯一主题名。',
    parameters: {
      target: { type: 'string', required: true, description: '主题 id 或主题名' },
      everyDays: { type: 'number', description: '这条自己的检查间隔（天）；0 = 跟随全局默认' },
      note: { type: 'string', description: '关注点/备注' },
      keywords: { type: 'array', items: { type: 'string' }, description: '搜索关键词' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute(args) {
      const patch = {}
      if (args.everyDays !== undefined) patch.everyDays = Number(args.everyDays) > 0 ? Number(args.everyDays) : null
      if (args.note !== undefined) patch.note = args.note
      if (args.keywords !== undefined) patch.keywords = args.keywords
      const updated = store.updateTopic(dataDir, args.target, patch)
      if (!updated) return { message: `清单里没有「${args.target}」`, ok: false }
      const every = updated.everyDays ? `每 ${updated.everyDays} 天` : '跟随全局默认'
      return { message: `已更新「${updated.topic}」：间隔 ${every}`, ok: true, topic: updated }
    },
  })

  tool({
    name: 'watchlist_list',
    description: '查看关注清单、当前设置、调度状态和日报目录。回答"我现在追什么/怎么配的"时用它。',
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
        ? topics.map((t, i) => `${i + 1}. ${t.topic}（${t.id}）${t.lastRunAt ? `｜上次巡检 ${t.lastRunAt.slice(0, 10)}` : '｜尚未巡检'}`)
        : ['（空清单，用 watchlist_add 添加主题）']
      return {
        message: [
          `关注清单：${topics.length} 个主题`,
          ...lines,
          `调度：${settings.schedule.enabled ? describeTiming(buildTiming(settings)) : '未开启'}${task ? `｜任务 ${task.status}` : ''}`,
          `推送：${settings.push.channels.join('、') || '无'}`,
          `窗口：上次巡检到现在（首次默认 ${settings.lookbackDays} 天）｜数据目录：${dataDir}`,
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
      '巡检开始时调用：开一次巡检，返回本轮**到期**的主题、每个主题各自的检索窗口、推送方式和落盘位置。' +
      '这是"该搜什么、搜哪段时间"的唯一权威来源，不要自己猜；不在返回里的主题本轮不要搜。',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute() {
      const settings = settingsOf()
      const now = Date.now()
      if (store.loadTopics(dataDir).length === 0) {
        return { message: '关注清单是空的：本次不巡检。先用 watchlist_add 添加主题。', skip: true, reason: 'empty', dataDir }
      }
      const current = store.currentRun(dataDir)
      if (current && now - new Date(current.startedAt).getTime() < 30 * 60 * 1000) {
        return { message: '刚刚已经开过一次巡检（30 分钟内），本轮跳过，避免重复劳动。', skip: true, runId: current.id, dataDir }
      }
      const days = defaultEveryDays(settings)
      const due = store.dueTopics(dataDir, days)
      if (due.length === 0) {
        return { message: '本轮没有到期的主题：所有条目都还没到各自的下次检查时间。', skip: true, reason: 'none-due', dataDir }
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
      const lines = windows.map(
        (item, index) =>
          `${index + 1}. ${item.topic.topic}（id: ${item.topic.id}）｜窗口 ${store.formatStamp(item.from)} → 现在` +
          `${item.topic.everyDays ? `｜每 ${item.topic.everyDays} 天` : ''}` +
          `${item.topic.keywords.length ? `｜关键词：${item.topic.keywords.join(' / ')}` : ''}` +
          `${item.topic.note ? `｜关注点：${String(item.topic.note).replace(/^关注点[:：]\s*/, '')}` : ''}`,
      )
      return {
        message: [
          `本次巡检 ${store.formatStamp(run.startedAt)}，到期 ${limited.length}/${store.loadTopics(dataDir).length} 个主题，推送 ${settings.push.channels.join('、') || '无'}`,
          ...lines,
          due.length > limited.length ? `（还有 ${due.length - limited.length} 个到期主题本轮跳过，下次轮到）` : null,
          `落盘：每个主题调用一次 watchlist_record；报告写到当日文件 ${reportPath}` +
            `${run.seq > 1 ? `（本日第 ${run.seq} 次巡检，追加到同一文件的新小节）` : ''}`,
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
      '记录一个主题本次的巡检结果：追加到当日报告文件（每天最多一份；同一天的多次巡检各占一个小节）。每个主题每次巡检调用一次；' +
      'hasUpdate 为真表示有实质新进展。sources 每行一个来源，写成「标题 - 链接」。',
    parameters: {
      topic: { type: 'string', required: true, description: '主题 id 或主题名，来自 watchlist_run_brief' },
      summary: { type: 'string', required: true, description: '一句话结论：有了什么新进展，或为什么没有' },
      hasUpdate: { type: 'boolean', description: '是否有实质新进展，默认 false' },
      sources: { type: 'array', items: { type: 'string' }, description: '来源，每项「标题 - 链接」' },
      note: { type: 'string', description: '补充说明，可选' },
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
      if (!hit) return { message: `清单里没有「${raw}」，先 watchlist_add 再加记录`, recorded: false }
      const result = store.appendRunEntry(dataDir, {
        topic: hit.topic,
        hasUpdate: args.hasUpdate === true,
        summary: args.summary,
        sources: args.sources ?? [],
        note: args.note,
        day: store.dayStamp(settings.timeZone),
      })
      store.touchTopics(dataDir, [hit.id])
      return {
        message: `已记录「${hit.topic}」→ ${result.path}（本次第 ${result.runTotal} 条｜当日第 ${result.dayTotal} 条）`,
        recorded: true,
        path: result.path,
        runId: result.runId,
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
      '管理自动巡检任务：sync 按当前设置创建/更新任务，pause/resume 暂停或恢复，remove 删除，' +
      'run_now 立即投递一次巡检到会话。任务也会出现在 DSH 的「自动化任务」页面。',
    parameters: {
      action: { type: 'string', required: true, description: 'sync | pause | resume | remove | run_now' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute(args) {
      const schedule = scheduleService()
      if (!schedule) return { message: '当前 profile 没有挂载 dsh-schedule，无法自动巡检；可以手动让 Agent 执行巡检', ok: false }
      const state = store.loadState(dataDir)
      const action = String(args.action ?? '').trim()
      if (action === 'sync') {
        const result = await ensureTask(true)
        if (result.skipped) return { message: `未创建任务：${result.reason}`, ok: false }
        return {
          message: `巡检任务已${result.created ? '创建' : '更新'}：${result.timing}（任务 id ${result.taskId}）`,
          ok: true,
          taskId: result.taskId,
          timing: result.timing,
        }
      }
      if (!state.scheduleTaskId) {
        if (action === 'run_now') return { message: '还没有巡检任务，先 watchlist_schedule sync', ok: false }
        return { message: '还没有巡检任务，先 watchlist_schedule sync', ok: false }
      }
      if (action === 'pause' || action === 'resume') {
        await schedule.edit({ id: state.scheduleTaskId, action: 'update', patch: { active: action === 'resume' } })
        return { message: action === 'pause' ? '已暂停自动巡检' : '已恢复自动巡检', ok: true }
      }
      if (action === 'remove') {
        await schedule.edit({ id: state.scheduleTaskId, action: 'delete' })
        store.saveState(dataDir, { scheduleTaskId: null })
        return { message: '已删除自动巡检任务', ok: true }
      }
      if (action === 'run_now') {
        const result = await schedule.run({ id: state.scheduleTaskId })
        if (result && result.code === 'schedule_execution_pending') return { message: '上一次巡检还没跑完，稍后再试', ok: false }
        return { message: '已投递一次巡检，目标会话马上开始执行', ok: true }
      }
      return { message: `未知操作「${action}」，可用：sync / pause / resume / remove / run_now`, ok: false }
    },
  })

  tool({
    name: 'watchlist_settings',
    description:
      '查看或修改巡检设置。patch 里只写要改的字段，例如 {"schedule":{"time":"09:00"},"push":{"channels":["session","macos"]}}。' +
      '改到 schedule 字段会自动同步任务；也可用 watchlist_schedule sync 强制重建。',
    parameters: {
      patch: { type: 'string', description: 'JSON 字符串形式的局部设置，例如 {"lookbackDays":3}；留空则只查看' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute(args) {
      let patch = null
      if (args.patch && String(args.patch).trim()) {
        try {
          patch = JSON.parse(String(args.patch))
        } catch {
          return { message: 'patch 不是合法 JSON，例如：{"lookbackDays":3}', ok: false }
        }
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { message: 'patch 必须是 JSON 对象', ok: false }
        store.saveSettings(dataDir, patch)
      }
      const settings = store.loadSettings(dataDir, config)
      const touchesSchedule = patch && (patch.schedule || patch.timeZone || patch.workspaceDir)
      let syncNote = ''
      if (touchesSchedule) {
        try {
          const sync = await ensureTask(true)
          syncNote = sync.skipped ? `（任务未同步：${sync.reason}）` : `（任务已同步：${sync.timing}）`
        } catch (error) {
          syncNote = `（任务同步失败：${error?.message ?? error}）`
        }
      }
      const summary = [
        `回溯天数：${settings.lookbackDays}｜时区：${settings.timeZone}｜单轮上限：${settings.maxTopicsPerRun}`,
        `调度：${settings.schedule.enabled ? describeTiming(buildTiming(settings)) : '未开启'}｜频率：${settings.schedule.frequency}`,
        `推送：${settings.push.channels.join('、') || '无'}`,
        `数据目录：${dataDir}`,
      ].join('\n')
      return { message: patch ? `设置已更新${syncNote}\n${summary}` : summary, ok: true, settings }
    },
  })
}
