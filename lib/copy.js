/**
 * Host-side copy for the watchlist.
 *
 * The Host half writes into conversations, Automation tasks and digest files, so its
 * text has to follow the same language the user reads the GUI in: `settings.locale`
 * first, then the OS, then English. Chinese strings are kept identical to the ones
 * that shipped before the language split, so an existing list and its digests keep
 * reading the same way.
 *
 * Placeholders use `{name}` and are replaced verbatim; keep them in every locale.
 */

export const COPY = {
  en: {
    /* Scheduled task and its instruction */
    'task.title': 'Watchlist check',
    'task.prompt': [
      '[Watchlist check]',
      'This is a scheduled watchlist check. Follow these steps:',
      '1. Call watchlist_run_brief to get the topics due this run, the window (since the last check), and the push channels.',
      '2. For each topic, use web_search for progress inside that window; open the original with web_fetch when you need detail. Only trust sources that carry a date.',
      '3. Call watchlist_record once per topic: hasUpdate says whether there is real progress; set importance to high only when it is genuinely major (it changes the picture, needs an action, or is a breakthrough) and leave it out for ordinary updates. Use summary for the one-sentence verdict, and sources for titles and links.',
      '4. After every topic is recorded, summarize the run in a briefing of at most 600 characters.',
      '5. Push it the way the brief says: print the briefing in the conversation; when macos is included, the in-app client also posts one system notification.',
      'Only search, record, and push. Do not download files, install software, or touch anything outside the list.',
    ].join('\n'),

    /* Schedule descriptions */
    'timing.daily': 'every day at {time} ({zone})',
    'timing.weekly': 'every {days} at {time} ({zone})',
    'timing.monthly': 'monthly on day {day} at {hh}:{mm} ({zone})',
    'wd.1': 'Mon',
    'wd.2': 'Tue',
    'wd.3': 'Wed',
    'wd.4': 'Thu',
    'wd.5': 'Fri',
    'wd.6': 'Sat',
    'wd.7': 'Sun',
    'list.sep': ', ',
    'text.sep': '; ',

    /* Service and HTTP failures */
    'err.noScheduleService': 'the schedule service is unavailable (this profile does not mount dsh-schedule)',
    'err.badRunId': 'invalid runId',
    'err.noTopic': 'no such topic',
    'err.missingEntryId': 'missing entryId',
    'err.noRecord': 'no such record',
    'err.noReportFile': 'no report file for {runId}',
    'err.needRunIdOrPath': 'runId or path required',
    'err.outsideDigestDir': 'only files inside the digest directory can be opened',
    'err.notMarkdown': 'only markdown digests can be opened',
    'err.fileMissing': 'file not found: {file}',
    'err.macOSOnly': 'opening files is only supported on macOS',
    'err.noScheduleProfile': 'this profile does not mount dsh-schedule',
    'err.noTaskYet': 'no check task yet; sync once first',
    'err.runPending': 'the previous check has not finished yet',
    'err.unknownAction': 'unknown action: {type}',

    /* System-prompt hint */
    'hint.watchlist':
      'Watchlist (watchlist_*): when the user wants to follow a topic over time, restate the wording and confirm it first, then call watchlist_add and say in note what counts as progress. everyDays sets one topic’s own interval (watchlist_update changes it later); watchlist_list shows the list and watchlist_remove deletes an entry.',

    /* watchlist_add */
    'add.needNames': 'need topic or topics: pass at least one topic',
    'add.added': 'added: {list}',
    'add.existed': 'already on the list: {list}',
    'add.done': '{lines} ({total} topics)',

    /* watchlist_remove */
    'remove.missing': 'no topic on the list matches “{target}”',
    'remove.done': 'removed “{topic}”, {remaining} topics left',

    /* watchlist_update */
    'update.missing': 'no “{target}” on the list',
    'update.done': 'updated “{topic}”: {every}',
    'update.every': 'every {days} days',
    'update.followDefault': 'follows the global default',

    /* watchlist_list */
    'list.header': 'Watchlist: {count} topics',
    'list.empty': '(empty list — add a topic with watchlist_add)',
    'list.item': '{index}. {topic} ({id})',
    'list.lastChecked': ' · last check {date}',
    'list.neverChecked': ' · never checked',
    'list.schedule': 'Schedule: {timing}',
    'list.scheduleOff': 'off',
    'list.taskSuffix': ' · task {status}',
    'list.push': 'Push: {channels}',
    'list.none': 'none',
    'list.window': 'Window: since the last check (first run {days} days) · data: {dir}',

    /* watchlist_run_brief */
    'brief.empty': 'The watchlist is empty, so nothing was checked. Add topics with watchlist_add first.',
    'brief.recent': 'A check started less than 30 minutes ago; skipping this round to avoid duplicate work.',
    'brief.noneDue': 'No topic is due: every entry is still inside its own interval.',
    'brief.header': 'Check {stamp}: {due}/{total} topics due, push {channels}',
    'brief.item': '{index}. {topic} (id: {id}) · window {from} → now',
    'brief.every': ' · every {days} days',
    'brief.keywords': ' · keywords: {list}',
    'brief.note': ' · focus: {note}',
    'brief.more': '({count} more due topics are skipped this round; they come up next time)',
    'brief.path': 'Record: call watchlist_record once per topic; the report goes to today’s file {path}',
    'brief.pathSeq': ' (run {seq} today, appended as a new section)',

    /* watchlist_record */
    'record.missing': 'no “{raw}” on the list; add it with watchlist_add before recording',
    'record.done': '{flag}recorded “{topic}” → {path} ({runTotal} this run, {dayTotal} today)',
    'record.important': '[important] ',

    /* watchlist_schedule */
    'sched.noService':
      'this profile does not mount dsh-schedule, so there is no automatic check; you can still ask the agent to run one',
    'sched.skipped': 'no task created: {reason}',
    'sched.created': 'check task created: {timing} (task id {id})',
    'sched.updated': 'check task updated: {timing} (task id {id})',
    'sched.noTask': 'no check task yet; run watchlist_schedule sync first',
    'sched.paused': 'automatic checks paused',
    'sched.resumed': 'automatic checks resumed',
    'sched.removed': 'check task removed',
    'sched.pending': 'the previous check is still running; try again shortly',
    'sched.delivered': 'a check was delivered; the target session starts right away',
    'sched.unknown': 'unknown action “{action}”; use sync / pause / resume / remove / run_now',

    /* watchlist_settings */
    'set.badJson': 'patch is not valid JSON, for example: {"lookbackDays":3}',
    'set.notObject': 'patch must be a JSON object',
    'set.saved': 'settings updated{note}',
    'set.noteSkipped': ' (task not synced: {reason})',
    'set.noteSynced': ' (task synced: {timing})',
    'set.noteFailed': ' (task sync failed: {message})',
    'set.lookback': 'lookback: {days} days · time zone: {zone} · max per run: {max}',
    'set.schedule': 'schedule: {timing} · frequency: {frequency}',
    'set.push': 'push: {channels}',
    'set.data': 'data directory: {dir}',

    /* Digest file labels (store.js) */
    'digest.title': '# Watchlist digest {day}',
    'digest.section': '## Check {seq} at {clock}',
    'digest.range': '- Window: {from} → {to}',
    'digest.firstRun': 'first check',
    'digest.status': '- Status: {value}',
    'digest.hasUpdate': 'real progress',
    'digest.noUpdate': 'no real progress',
    'digest.important': '- Important: yes',
    'digest.summary': '- Summary: {text}',
    'digest.sources': '- Sources:',
    'digest.note': '- Note: {text}',

    /* store.js errors */
    'store.emptyTopic': 'a topic cannot be empty',
    'store.needTarget': 'which topic should be removed? pass an id or a topic name',
    'store.ambiguous': '{count} topics match “{raw}”; pass an id: {list}',
    'store.ambiguousShort': '{count} topics match “{target}”; pass an id',
  },

  zh: {
    'task.title': '关注清单巡检',
    'task.prompt': [
      '【关注清单巡检】',
      '这是一次定期的关注清单巡检，请按以下步骤执行：',
      '1. 调用 watchlist_run_brief，取得本次要追踪的主题、检索窗口（上次巡检到现在）和推送方式。',
      '2. 对每个主题用 web_search 检索该窗口内的新进展；需要确认细节时用 web_fetch 打开原文。只采信带日期的来源。',
      '3. 每个主题调用一次 watchlist_record：hasUpdate 表示是否有实质新进展；importance 只在确实重大时写 high' +
        '（会改变判断、需要用户行动、或重大突破），常规更新不写。summary 写一句话结论，sources 附标题和链接。',
      '4. 全部主题记录完后，把本轮情况汇总成不超过 600 字的简报。',
      '5. 按 brief 给出的推送方式推送：把简报输出到会话里；含 macos 时应用内客户端会另发一条系统通知。',
      '只做检索、记录、推送；不要下载文件、不要安装软件、不要改清单以外的文件。',
    ].join('\n'),

    'timing.daily': '每天 {time}（{zone}）',
    'timing.weekly': '每{days} {time}（{zone}）',
    'timing.monthly': '每月 {day} 日 {hh}:{mm}（{zone}）',
    'wd.1': '周一',
    'wd.2': '周二',
    'wd.3': '周三',
    'wd.4': '周四',
    'wd.5': '周五',
    'wd.6': '周六',
    'wd.7': '周日',
    'list.sep': '、',
    'text.sep': '；',

    'err.noScheduleService': 'schedule 服务不可用（当前 profile 未挂载 dsh-schedule）',
    'err.badRunId': 'runId 格式不对',
    'err.noTopic': '没有这个主题',
    'err.missingEntryId': '缺少 entryId',
    'err.noRecord': '没有这条记录',
    'err.noReportFile': '没有 {runId} 的报告文件',
    'err.needRunIdOrPath': '需要 runId 或 path',
    'err.outsideDigestDir': '只允许打开日报目录里的文件',
    'err.notMarkdown': '只允许打开 markdown 日报',
    'err.fileMissing': '文件不存在：{file}',
    'err.macOSOnly': '打开文件目前只支持 macOS',
    'err.noScheduleProfile': '当前 profile 没有挂载 dsh-schedule',
    'err.noTaskYet': '还没有巡检任务，先同步一次',
    'err.runPending': '上一次巡检还没跑完',
    'err.unknownAction': '未知操作：{type}',

    'hint.watchlist':
      '关注清单（watchlist_*）：用户想长期跟进某个话题时，先复述并确认主题措辞，再调用 watchlist_add，' +
      '并在 note 里写清"什么算有进展"；每条可用 everyDays 指定自己的检查间隔（watchlist_update 可改）；查看清单用 watchlist_list，删除用 watchlist_remove。',

    'add.needNames': '需要 topic 或 topics：告诉我至少一个主题',
    'add.added': '已加入：{list}',
    'add.existed': '已在清单里：{list}',
    'add.done': '{lines}（共 {total} 个主题）',

    'remove.missing': '清单里没有匹配「{target}」的主题',
    'remove.done': '已移除「{topic}」，剩 {remaining} 个主题',

    'update.missing': '清单里没有「{target}」',
    'update.done': '已更新「{topic}」：间隔 {every}',
    'update.every': '每 {days} 天',
    'update.followDefault': '跟随全局默认',

    'list.header': '关注清单：{count} 个主题',
    'list.empty': '（空清单，用 watchlist_add 添加主题）',
    'list.item': '{index}. {topic}（{id}）',
    'list.lastChecked': '｜上次巡检 {date}',
    'list.neverChecked': '｜尚未巡检',
    'list.schedule': '调度：{timing}',
    'list.scheduleOff': '未开启',
    'list.taskSuffix': '｜任务 {status}',
    'list.push': '推送：{channels}',
    'list.none': '无',
    'list.window': '窗口：上次巡检到现在（首次默认 {days} 天）｜数据目录：{dir}',

    'brief.empty': '关注清单是空的：本次不巡检。先用 watchlist_add 添加主题。',
    'brief.recent': '刚刚已经开过一次巡检（30 分钟内），本轮跳过，避免重复劳动。',
    'brief.noneDue': '本轮没有到期的主题：所有条目都还没到各自的下次检查时间。',
    'brief.header': '本次巡检 {stamp}，到期 {due}/{total} 个主题，推送 {channels}',
    'brief.item': '{index}. {topic}（id: {id}）｜窗口 {from} → 现在',
    'brief.every': '｜每 {days} 天',
    'brief.keywords': '｜关键词：{list}',
    'brief.note': '｜关注点：{note}',
    'brief.more': '（还有 {count} 个到期主题本轮跳过，下次轮到）',
    'brief.path': '落盘：每个主题调用一次 watchlist_record；报告写到当日文件 {path}',
    'brief.pathSeq': '（本日第 {seq} 次巡检，追加到同一文件的新小节）',

    'record.missing': '清单里没有「{raw}」，先 watchlist_add 再加记录',
    'record.done': '{flag}已记录「{topic}」→ {path}（本次第 {runTotal} 条｜当日第 {dayTotal} 条）',
    'record.important': '【重要】',

    'sched.noService': '当前 profile 没有挂载 dsh-schedule，无法自动巡检；可以手动让 Agent 执行巡检',
    'sched.skipped': '未创建任务：{reason}',
    'sched.created': '巡检任务已创建：{timing}（任务 id {id}）',
    'sched.updated': '巡检任务已更新：{timing}（任务 id {id}）',
    'sched.noTask': '还没有巡检任务，先 watchlist_schedule sync',
    'sched.paused': '已暂停自动巡检',
    'sched.resumed': '已恢复自动巡检',
    'sched.removed': '已删除自动巡检任务',
    'sched.pending': '上一次巡检还没跑完，稍后再试',
    'sched.delivered': '已投递一次巡检，目标会话马上开始执行',
    'sched.unknown': '未知操作「{action}」，可用：sync / pause / resume / remove / run_now',

    'set.badJson': 'patch 不是合法 JSON，例如：{"lookbackDays":3}',
    'set.notObject': 'patch 必须是 JSON 对象',
    'set.saved': '设置已更新{note}',
    'set.noteSkipped': '（任务未同步：{reason}）',
    'set.noteSynced': '（任务已同步：{timing}）',
    'set.noteFailed': '（任务同步失败：{message}）',
    'set.lookback': '回溯天数：{days}｜时区：{zone}｜单轮上限：{max}',
    'set.schedule': '调度：{timing}｜频率：{frequency}',
    'set.push': '推送：{channels}',
    'set.data': '数据目录：{dir}',

    'digest.title': '# 关注清单日报 {day}',
    'digest.section': '## 第 {seq} 次巡检 {clock}',
    'digest.range': '- 覆盖区间：{from} → {to}',
    'digest.firstRun': '首次巡检',
    'digest.status': '- 状态：{value}',
    'digest.hasUpdate': '有实质进展',
    'digest.noUpdate': '无实质进展',
    'digest.important': '- 重要：是',
    'digest.summary': '- 摘要：{text}',
    'digest.sources': '- 来源：',
    'digest.note': '- 备注：{text}',

    'store.emptyTopic': '主题不能为空',
    'store.needTarget': '要删除哪个主题？给 id 或主题名',
    'store.ambiguous': '有 {count} 个主题匹配「{raw}」，请用 id 指定：{list}',
    'store.ambiguousShort': '有 {count} 个主题匹配「{target}」，请用 id 指定',
  },
}

export const LOCALES = Object.keys(COPY)

/** Resolve one key for one language, replacing `{name}` placeholders. */
export function translate(lang, key, vars) {
  const table = COPY[lang] ?? COPY.en
  let text = table[key] ?? COPY.en[key]
  if (text === undefined) return key
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value))
  }
  return text
}
