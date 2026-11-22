/**
 * dsh-watchlist — Client half.
 *
 * Three surfaces:
 *   settings.section       the full “Watchlist” page: add/remove topics, check
 *                          settings, push channels, report body
 *   sidebar.footer.action  footer icon plus an unread dot
 *   shell.overlay          unread overlay: entries from the latest run, mark as read
 *
 * Data comes from the host's /dsh-watchlist-api (loopback only); the client half
 * never touches the filesystem.
 */
window.__ModuleLoader__.load({
  id: 'dsh-watchlist',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    /* ---------- Language: setting > DSH locale > browser language; anything but Chinese means English ---------- */

    let langOverride = null // 'zh' | 'en' | null (null = follow DSH)

    function dshLang() {
      try {
        const snapshot = services && services.locale && services.locale.getLocale && services.locale.getLocale()
        const id = snapshot && (snapshot.active || snapshot.id || snapshot.locale || snapshot.language)
        if (typeof id === 'string' && id) return /^zh/i.test(id) ? 'zh' : 'en'
      } catch {
        /* No locale service: fall back to the browser language */
      }
      try {
        return /^zh/i.test(navigator.language || '') ? 'zh' : 'en'
      } catch {
        return 'en'
      }
    }

    function currentLang() {
      return langOverride || dshLang()
    }

    function zh() {
      return currentLang() === 'zh'
    }

    const DICT = {
      zh: {
        nav: '关注清单',
        title: '关注清单',
        dataDir: '数据目录',
        topics: '主题',
        empty: '还没有主题，添加一个想长期追踪的题目。',
        addPlaceholder: '添加主题，例如：某模型的新版本发布',
        add: '添加',
        remove: '删除',
        runNow: '立即运行一次',
        running: '已投递',
        settings: '巡检设置',
        defaultSettings: '默认巡检设置',
        defaultHint: '新添加的主题默认沿用这里；每个主题可单独设置间隔。',
        interval: '检查间隔',
        iDefault: '跟随默认',
        iDay: '每天',
        iWeek: '每周',
        iMonth: '每月',
        enabled: '自动巡检',
        frequency: '频率',
        daily: '每天',
        weekly: '每周',
        monthly: '每月',
        time: '时间',
        lookback: '回溯天数',
        maxTopics: '单轮上限',
        push: '推送',
        language: '界面语言',
        langAuto: '跟随 DSH',
        session: '会话内消息',
        macos: '系统通知',
        wechat: '微信（需微信插件）',
        digests: '日报',
        openFile: '用外部程序打开',
        openSidebar: '在侧栏打开',
        needSession: '没有可用的会话，先用下面的内联阅读',
        noHost: '当前版本没有侧栏预览服务，先用下面的内联阅读',
        noDigest: '还没有巡检记录。',
        lastRun: '上次巡检',
        never: '尚未巡检',
        unread: '未读',
        close: '关闭',
        openExternal: '外部打开',
        entryHint: '点条目直接阅读',
        viewAll: '查看全部',
        back: '返回',
        closeAll: '关闭全部',
        allTitle: '全部巡检记录',
        openSettings: '在 设置 → 关注清单 中管理',
        loading: '加载中…',
        failed: '加载失败',
        next: '下次触发',
        saveFailed: '保存失败',
      },
      en: {
        nav: 'Watchlist',
        title: 'Watchlist',
        dataDir: 'Data',
        topics: 'Topics',
        empty: 'No topics yet. Add something you want to follow.',
        addPlaceholder: 'Add a topic, e.g. a model release',
        add: 'Add',
        remove: 'Remove',
        runNow: 'Run now',
        running: 'Queued',
        settings: 'Schedule',
        defaultSettings: 'Default schedule',
        defaultHint: 'Applies to new topics; each topic can override it.',
        interval: 'Interval',
        iDefault: 'Follow default',
        iDay: 'Daily',
        iWeek: 'Weekly',
        iMonth: 'Monthly',
        enabled: 'Auto-run',
        frequency: 'Frequency',
        daily: 'Daily',
        weekly: 'Weekly',
        monthly: 'Monthly',
        time: 'Time',
        lookback: 'Lookback (days)',
        maxTopics: 'Topics per run',
        push: 'Push',
        language: 'Language',
        langAuto: 'Follow DSH',
        session: 'Session message',
        macos: 'System notification',
        wechat: 'WeChat (needs plugin)',
        digests: 'Digests',
        openFile: 'Open externally',
        openSidebar: 'Open in sidebar',
        needSession: 'No session available; read inline below',
        noHost: 'Sidebar preview unavailable; read inline below',
        noDigest: 'No digests yet.',
        lastRun: 'Last run',
        never: 'never',
        unread: 'unread',
        close: 'Close',
        openExternal: 'Open externally',
        entryHint: 'Click an entry to read',
        viewAll: 'View all',
        back: 'Back',
        closeAll: 'Close all',
        allTitle: 'All runs',
        openSettings: 'Manage in Settings → Watchlist',
        loading: 'Loading…',
        failed: 'Failed to load',
        next: 'Next run',
        saveFailed: 'Save failed',
      },
    }

    // A Proxy keeps every existing COPY.xxx read resolving to the current language,
    // so no call site needs rewriting.
    const COPY = new Proxy({}, { get: (_target, key) => (DICT[currentLang()] || DICT.en)[key] })

    const langListeners = new Set()
    function notifyLang() {
      for (const listener of langListeners) listener()
    }
    function applyLocaleSetting(value) {
      const next = value === 'zh' || value === 'en' ? value : null
      if (next === langOverride) return
      langOverride = next
      notifyLang()
    }
    function useLang() {
      const [, bump] = useState(0)
      useEffect(() => {
        const listener = () => bump((n) => n + 1)
        langListeners.add(listener)
        return () => langListeners.delete(listener)
      }, [])
      return currentLang()
    }

    const API = '/dsh-watchlist-api'

    async function getState() {
      const response = await fetch(`${API}/state`, { headers: { accept: 'application/json' } })
      return response.json()
    }

    async function act(type, payload) {
      const response = await fetch(`${API}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, ...(payload || {}) }),
      })
      return response.json()
    }

    /** Client context from apply(); components use it to reach layout / sidebarRight. */
    let services = null

    function currentSessionId() {
      try {
        const info = services && services.layout && services.layout.panelInfo
        const value = typeof info === 'function' ? info() : info
        if (typeof value === 'string') return value
        if (!value) return null
        // The layout store names the field activePanelId; the main panel key may be
        // 'conversation', so only conversation-id shapes are accepted.
        const id = value.activePanelId || value.sessionId || value.id || null
        return typeof id === 'string' && /^session-/.test(id) ? id : null
      } catch {
        return null
      }
    }

    /* ---------- Shared overlay switch: the footer button and the overlay live in different subtrees ---------- */
    /**
     * Overlay state lives on window rather than in module scope: the client module
     * may be loaded more than once, and module-level state would give the footer
     * button and shell.overlay separate copies, so clicks would never land.
     */
    function uiStore() {
      if (!window.__dshWatchlistUi) window.__dshWatchlistUi = { open: false, all: false, reader: null, backTo: null, dataRev: 0, listeners: new Set() }
      return window.__dshWatchlistUi
    }
    function bumpData() {
      const ui = uiStore()
      ui.dataRev += 1
      notifyUi()
    }
    function notifyUi() {
      for (const listener of uiStore().listeners) listener()
    }
    function setOpen(value) {
      uiStore().open = value
      notifyUi()
    }
    function openAll() {
      const ui = uiStore()
      ui.all = true
      ui.open = false
      notifyUi()
    }
    function closeAll() {
      const ui = uiStore()
      ui.all = false
      ui.open = true
      notifyUi()
    }
    function openReader(view, from = 'panel') {
      const ui = uiStore()
      ui.reader = view
      ui.backTo = from
      ui.open = false
      ui.all = false
      notifyUi()
    }
    /** Step back one layer: the same effect as Escape and the "← Back" control. */
    function stepBack() {
      const ui = uiStore()
      if (ui.reader) closeReader()
      else if (ui.all) closeAll()
      else if (ui.open) setOpen(false)
    }

    /** Close every layer at once (the ✕ control). */
    function closeEverything() {
      const ui = uiStore()
      ui.open = false
      ui.all = false
      ui.reader = null
      ui.backTo = null
      notifyUi()
    }
    function closeReader() {
      const ui = uiStore()
      const back = ui.backTo
      ui.reader = null
      ui.backTo = null
      if (back === 'all') ui.all = true
      else if (back === 'panel') ui.open = true
      notifyUi()
    }
    function useUiState() {
      const [, bump] = useState(0)
      useEffect(() => {
        const ui = uiStore()
        const listener = () => bump((n) => n + 1)
        ui.listeners.add(listener)
        return () => ui.listeners.delete(listener)
      }, [])
      const ui = uiStore()
      return { open: ui.open, all: ui.all, reader: ui.reader, backTo: ui.backTo, dataRev: ui.dataRev }
    }

    function useWatchlist() {
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const load = useCallback(async () => {
        try {
          const data = await getState()
          if (data && data.ok) {
            setState(data)
            setError('')
            applyLocaleSetting(data.settings && data.settings.locale)
          } else {
            setError((data && data.error) || COPY.failed)
          }
        } catch (cause) {
          setError(String((cause && cause.message) || cause))
        }
      }, [])
      useEffect(() => {
        load()
      }, [load])
      const run = useCallback(
        async (type, payload) => {
          setBusy(true)
          try {
            const result = await act(type, payload)
            if (result && result.ok === false) setError(result.error || COPY.saveFailed)
            await load()
            return result
          } catch (cause) {
            setError(String((cause && cause.message) || cause))
            return null
          } finally {
            setBusy(false)
          }
        },
        [load],
      )
      return { state, error, busy, reload: load, run }
    }

    const STYLE = `
      .dwl { color: var(--dsw-alias-label-primary, #111); font-size: 13px; }
      .dwl h3 { margin: 22px 0 8px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary, #666); }
      .dwl h3:first-of-type { margin-top: 4px; }
      .dwl-meta { color: var(--dsw-alias-label-secondary, #666); }
      .dwl-row { display: flex; align-items: flex-start; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--dsw-alias-border-l1, #e5e5e5); }
      .dwl-row:last-child { border-bottom: 0; }
      .dwl-grow { flex: 1; min-width: 0; }
      .dwl-btn { border: 1px solid var(--dsw-alias-border-l2, #ccc); background: var(--dsw-alias-bg-layer-2, #f5f5f5); color: inherit;
        border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
      .dwl-btn:hover { background: var(--dsw-alias-bg-layer-1, #fff); }
      .dwl-btn:disabled { opacity: .5; cursor: default; }
      .dwl-input { border: 1px solid var(--dsw-alias-border-l2, #ccc); background: var(--dsw-alias-bg-layer-1, #fff); color: inherit;
        border-radius: 6px; padding: 4px 8px; font-size: 12px; }
      .dwl-back { min-height: 28px; min-width: 64px; padding: 4px 12px; font-size: 12px; flex: 0 0 auto;
        display: inline-flex; align-items: center; justify-content: center; cursor: pointer; user-select: none;
        -webkit-app-region: no-drag; }
      .dwl-inline { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
      .dwl-field { display: flex; align-items: center; gap: 8px; margin: 6px 0; flex-wrap: wrap; }
      .dwl-field > span { min-width: 84px; color: var(--dsw-alias-label-secondary, #666); }
      .dwl-check { display: flex; align-items: center; gap: 5px; margin-right: 12px; }
      .dwl-err { color: var(--dsw-alias-state-error-primary, #c00); margin: 6px 0; }
      .dwl-day { margin: 4px 0; }
      .dwl-daybtn { background: none; border: 0; color: inherit; font: inherit; cursor: pointer; padding: 2px 0; display: flex; gap: 8px; }
      .dwl-src { color: var(--dsw-alias-label-secondary, #666); font-size: 12px; word-break: break-all; }
      .dwl-badge { position: absolute; top: -3px; right: -6px; min-width: 16px; height: 16px; line-height: 16px; padding: 0 4px;
        border-radius: 8px; background: var(--dsw-alias-brand-primary, #247bbf); color: #fff; font-size: 10px; font-weight: 600; }
      .dwl-footer-btn { position: relative; display: flex; align-items: center; gap: 6px; border: 0; background: none; color: inherit;
        cursor: pointer; padding: 5px 6px; border-radius: 6px; font: inherit; font-size: 12px; }
      .dwl-footer-btn:hover { background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.06)); }
      .dwl-overlay { pointer-events: auto; position: fixed; left: 12px; bottom: 56px; width: 320px; max-height: 60vh; overflow: auto; z-index: 20;
        background: var(--dsw-alias-bg-overlay, #fff); color: var(--dsw-alias-label-primary, #111); border: 1px solid var(--dsw-alias-border-l1, #ddd);
        border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 12px; font-size: 12px; }
      .dwl-overlay h4 { margin: 0 0 8px; font-size: 12px; font-weight: 600; }
      .dwl-sep { height: 1px; background: var(--dsw-alias-border-l1, #e5e5e5); margin: 10px 0; }
      .dwl-empty { color: var(--dsw-alias-label-secondary, #666); padding: 6px 0; }
      .dwl-entry { display: block; width: 100%; text-align: left; border: 0; background: none; color: inherit;
        padding: 6px 4px; border-radius: 6px; cursor: pointer; font: inherit; font-size: 12px; }
      .dwl-entry:hover { background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.05)); }
      .dwl-backdrop { position: fixed; inset: 0; z-index: 39; background: rgba(0, 0, 0, .18); pointer-events: auto; }
      .dwl-reader { -webkit-app-region: no-drag; pointer-events: auto; position: fixed; top: 6vh; left: 7vw; right: 7vw; bottom: 6vh; z-index: 40; display: flex; flex-direction: column;
        background: var(--dsw-alias-bg-overlay, #fff); color: var(--dsw-alias-label-primary, #111);
        border: 1px solid var(--dsw-alias-border-l1, #ddd); border-radius: 12px; box-shadow: 0 18px 48px rgba(0,0,0,.22);
        font-size: 13px; overflow: hidden; }
      .dwl-reader-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
        padding: 12px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e5e5e5); }
      .dwl-reader-body { flex: 1; overflow: auto; padding: 14px 18px; line-height: 1.75; }
    `

    function StyleTag() {
      return h('style', null, STYLE)
    }

    function ErrorLine({ text }) {
      if (!text) return null
      return h('div', { className: 'dwl-err' }, text)
    }

    function inlineNodes(text, keyPrefix) {
      const parts = []
      const regex = /(\*\*[^*]+\*\*|https?:\/\/[^\s)>\]]+)/g
      let last = 0
      let index = 0
      let match
      while ((match = regex.exec(text)) !== null) {
        if (match.index > last) parts.push(text.slice(last, match.index))
        const token = match[0]
        if (token.startsWith('**')) {
          parts.push(h('strong', { key: `${keyPrefix}-b${index++}` }, token.slice(2, -2)))
        } else {
          parts.push(
            h(
              'a',
              {
                key: `${keyPrefix}-a${index++}`,
                href: token,
                target: '_blank',
                rel: 'noreferrer',
                style: { color: 'var(--dsw-alias-brand-primary, #247bbf)' },
              },
              token,
            ),
          )
        }
        last = match.index + token.length
      }
      if (last < text.length) parts.push(text.slice(last))
      return parts
    }

    /** Covers only the check-report format we generate ourselves: headings, subheadings, lists, links, bold. */
    function Markdown({ text }) {
      const blocks = []
      let bullets = []
      const flush = () => {
        if (!bullets.length) return
        blocks.push(
          h(
            'ul',
            { key: `ul${blocks.length}`, style: { margin: '4px 0 8px', paddingLeft: 18 } },
            bullets.map((item, i) => h('li', { key: i }, inlineNodes(item, `l${blocks.length}-${i}`))),
          ),
        )
        bullets = []
      }
      String(text || '')
        .split('\n')
        .forEach((raw, lineNo) => {
          const line = raw.replace(/\s+$/, '')
          if (!line.trim()) {
            flush()
            return
          }
          if (line.startsWith('# ')) {
            flush()
            blocks.push(h('div', { key: `h${lineNo}`, style: { fontWeight: 600, fontSize: 14, margin: '2px 0 8px' } }, line.slice(2)))
            return
          }
          if (line.startsWith('## ')) {
            flush()
            blocks.push(h('div', { key: `h${lineNo}`, style: { fontWeight: 600, margin: '10px 0 4px' } }, line.slice(3)))
            return
          }
          const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
          if (bullet) {
            bullets.push(bullet[1])
            return
          }
          flush()
          blocks.push(h('div', { key: `p${lineNo}`, style: { margin: '3px 0' } }, inlineNodes(line, `p${lineNo}`)))
        })
      flush()
      return h('div', null, blocks)
    }

    function TopicRow({ topic, onRemove, onSetInterval, busy }) {
      const every = topic.everyDays ? String(topic.everyDays) : ''
      return h(
        'div',
        { className: 'dwl-row' },
        h(
          'div',
          { className: 'dwl-grow' },
          h('div', null, topic.topic),
          topic.keywords && topic.keywords.length ? h('div', { className: 'dwl-meta' }, topic.keywords.join(' · ')) : null,
          h(
            'div',
            { className: 'dwl-inline' },
            h('span', { className: 'dwl-meta' }, `${COPY.lastRun}：${topic.lastCheckedAt ? fmt(topic.lastCheckedAt) : COPY.never}`),
            h(
              'select',
              {
                className: 'dwl-input',
                value: every,
                disabled: busy,
                title: COPY.interval,
                onChange: (event) => onSetInterval(topic, event.target.value),
              },
              h('option', { value: '' }, COPY.iDefault),
              h('option', { value: '1' }, COPY.iDay),
              h('option', { value: '7' }, COPY.iWeek),
              h('option', { value: '30' }, COPY.iMonth),
            ),
          ),
        ),
        h('button', { className: 'dwl-btn', disabled: busy, onClick: () => onRemove(topic) }, COPY.remove),
      )
    }

    function WatchlistPage() {
      useLang()
      const { state, error, busy, run } = useWatchlist()
      const [draft, setDraft] = useState('')
      const [keywords, setKeywords] = useState('')
      const [every, setEvery] = useState('')
      if (!state) return h('div', { className: 'dwl' }, h(StyleTag), error || COPY.loading)

      const settings = state.settings || {}
      const schedule = state.schedule || {}

      const patchSettings = (patch) => run('settings', { patch })

      const addTopic = async () => {
        const topic = draft.trim()
        if (!topic) return
        await run('add', { topic, keywords: keywords.split(/[,，\s]+/).filter(Boolean), everyDays: every ? Number(every) : undefined })
        setDraft('')
        setKeywords('')
        setEvery('')
      }

      return h(
        'div',
        { className: 'dwl' },
        h(StyleTag),
        h(ErrorLine, { text: error }),

        h(
          'div',
          { className: 'dwl-meta' },
          `${COPY.dataDir}：${state.dataDir} · ${state.topics.length} ${zh() ? '个主题' : 'topics'}`,
        ),

        h('h3', null, COPY.topics),
        h(
          'div',
          { className: 'dwl-row' },
          h('input', {
            className: 'dwl-input dwl-grow',
            placeholder: COPY.addPlaceholder,
            value: draft,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') addTopic()
            },
          }),
          h(
            'select',
            {
              className: 'dwl-input',
              value: every,
              onChange: (event) => setEvery(event.target.value),
              title: COPY.interval,
            },
            h('option', { value: '' }, COPY.iDefault),
            h('option', { value: '1' }, COPY.iDay),
            h('option', { value: '7' }, COPY.iWeek),
            h('option', { value: '30' }, COPY.iMonth),
          ),
          h('button', { className: 'dwl-btn', disabled: busy || !draft.trim(), onClick: addTopic }, COPY.add),
        ),
        state.topics.length
          ? state.topics.map((topic) =>
              h(TopicRow, {
                key: topic.id,
                topic,
                busy,
                onRemove: (item) => run('remove', { target: item.id }),
                onSetInterval: (item, value) =>
                  run('update-topic', { target: item.id, everyDays: value ? Number(value) : 0 }),
              }),
            )
          : h('div', { className: 'dwl-empty' }, COPY.empty),

        h('h3', null, COPY.defaultSettings),
        h('div', { className: 'dwl-meta', style: { marginBottom: 4 } }, COPY.defaultHint),
        h(
          'div',
          { className: 'dwl-field' },
          h('span', null, COPY.enabled),
          h('input', {
            type: 'checkbox',
            checked: Boolean(settings.schedule && settings.schedule.enabled),
            onChange: (event) => patchSettings({ schedule: { enabled: event.target.checked } }),
          }),
          h('button', { className: 'dwl-btn', disabled: busy, onClick: () => run('run') }, COPY.runNow),
        ),
        h(
          'div',
          { className: 'dwl-field' },
          h('span', null, COPY.frequency),
          h(
            'select',
            {
              className: 'dwl-input',
              value: (settings.schedule && settings.schedule.frequency) || 'daily',
              onChange: (event) => patchSettings({ schedule: { frequency: event.target.value } }),
            },
            h('option', { value: 'daily' }, COPY.daily),
            h('option', { value: 'weekly' }, COPY.weekly),
            h('option', { value: 'monthly' }, COPY.monthly),
          ),
          h('span', null, COPY.time),
          h('input', {
            className: 'dwl-input',
            style: { width: 70 },
            value: (settings.schedule && settings.schedule.time) || '08:30',
            onChange: (event) => patchSettings({ schedule: { time: event.target.value } }),
          }),
        ),
        h(
          'div',
          { className: 'dwl-field' },
          h('span', null, COPY.lookback),
          h('input', {
            className: 'dwl-input',
            style: { width: 60 },
            type: 'number',
            value: settings.lookbackDays || 7,
            onChange: (event) => patchSettings({ lookbackDays: Number(event.target.value) || 7 }),
          }),
          h('span', null, COPY.maxTopics),
          h('input', {
            className: 'dwl-input',
            style: { width: 60 },
            type: 'number',
            value: settings.maxTopicsPerRun || 8,
            onChange: (event) => patchSettings({ maxTopicsPerRun: Number(event.target.value) || 8 }),
          }),
        ),
        h(
          'div',
          { className: 'dwl-field dwl-meta' },
          h('span', null, COPY.next),
          schedule.timing,
          schedule.task ? ` · ${schedule.task.status}` : '',
        ),

        h('h3', null, COPY.push),
        h(
          'div',
          { className: 'dwl-field' },
          ['session', 'macos'].map((channel) =>
            h(
              'label',
              { className: 'dwl-check', key: channel },
              h('input', {
                type: 'checkbox',
                checked: ((settings.push && settings.push.channels) || []).includes(channel),
                onChange: (event) => {
                  const current = (settings.push && settings.push.channels) || []
                  const next = event.target.checked ? [...new Set([...current, channel])] : current.filter((c) => c !== channel)
                  patchSettings({ push: { channels: next.length ? next : ['session'] } })
                },
              }),
              channel === 'session' ? COPY.session : COPY.macos,
            ),
          ),
          h('label', { className: 'dwl-check dwl-meta' }, h('input', { type: 'checkbox', disabled: true }), COPY.wechat),
        ),

        h('h3', null, COPY.language),
        h(
          'div',
          { className: 'dwl-field' },
          h('span', null, COPY.language),
          h(
            'select',
            {
              className: 'dwl-input',
              value: settings.locale || 'auto',
              onChange: (event) => patchSettings({ locale: event.target.value }),
            },
            h('option', { value: 'auto' }, COPY.langAuto),
            h('option', { value: 'zh' }, '中文'),
            h('option', { value: 'en' }, 'English'),
          ),
        ),

      )
    }

    function FooterAction(props) {
      useLang()
      const { state, reload } = useWatchlist()
      const { open, reader: readerOpen, dataRev } = useUiState()
      useEffect(() => {
        reload()
      }, [reload, dataRev])
      useEffect(() => {
        const timer = setInterval(reload, 60000)
        return () => clearInterval(timer)
      }, [reload])
      const unread = (state && state.unread) || 0
      const wide = props && props.wide !== false
      return h(
        'button',
        {
          className: 'dwl-footer-btn',
          title: COPY.nav,
          style: open || readerOpen ? { background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.08))' } : undefined,
          onClick: () => {
            if (readerOpen) {
              closeReader()
              return
            }
            setOpen(!open)
          },
        },
        h(StyleTag),
        h(
          'svg',
          { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 },
          h('circle', { cx: 12, cy: 12, r: 8.5 }),
          h('circle', { cx: 12, cy: 12, r: 4 }),
          h('circle', { cx: 12, cy: 12, r: 1, fill: 'currentColor', stroke: 'none' }),
        ),
        wide ? h('span', null, COPY.nav) : null,
        unread > 0
          ? h('span', { className: 'dwl-badge', title: `${unread} ${zh() ? '条未读' : 'unread'}` }, unread > 99 ? '99+' : String(unread))
          : null,
      )
    }

    const DIGEST_TAB = 'dsh-watchlist/digest'

    /** Current date of the report tab in the right sidebar; the tab body subscribes
     *  to it instead of relying on tab parameters. */
    const digestTab = { runId: null, listeners: new Set() }
    function setDigestDay(runId) {
      digestTab.runId = runId
      for (const listener of digestTab.listeners) listener()
    }
    function useDigestDay() {
      const [, bump] = useState(0)
      useEffect(() => {
        const listener = () => bump((n) => n + 1)
        digestTab.listeners.add(listener)
        return () => digestTab.listeners.delete(listener)
      }, [])
      return digestTab.runId
    }

    /** Open the plugin's own tab in the right sidebar (not through file preview,
     *  so it does not depend on the workspace). */
    function openDigestTab(runId) {
      try {
        const sidebar = services && services.sidebarRight
        if (!sidebar || typeof sidebar.openTab !== 'function') return 'nohost'
        setDigestDay(runId)
        sidebar.openTab('watchlist-digest', {})
        try {
          if (services.layout && typeof services.layout.openRightbar === 'function') services.layout.openRightbar(true, false)
        } catch {
          /* A failed panel expansion does not affect the tab */
        }
        return 'ok'
      } catch (error) {
        return `error:${String((error && error.message) || error)}`
      }
    }

    function DigestTab() {
      useLang()
      const runId = useDigestDay()
      const [text, setText] = useState('')
      const [error, setError] = useState('')
      useEffect(() => {
        if (!runId) return undefined
        let alive = true
        setText('')
        setError('')
        act('read', { runId })
          .then((result) => {
            if (!alive) return
            if (result && result.ok) setText(result.text)
            else setError(String((result && result.error) || COPY.failed))
          })
          .catch((cause) => {
            if (alive) setError(String((cause && cause.message) || cause))
          })
        return () => {
          alive = false
        }
      }, [runId])
      return h(
        'div',
        { className: 'dwl', style: { height: '100%', overflow: 'auto', padding: '10px 14px', boxSizing: 'border-box' } },
        h(StyleTag),
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10 } },
          h('div', { style: { fontWeight: 600 } }, `${COPY.title} · ${fmt(runId)}`),
          h(
            'div',
            { style: { display: 'flex', gap: 8 } },
            h('button', { className: 'dwl-btn', onClick: () => act('open', { runId }) }, COPY.openFile),
          ),
        ),
        error ? h('div', { className: 'dwl-err' }, error) : text ? h(Markdown, { text }) : h('div', { className: 'dwl-meta' }, COPY.loading),
      )
    }

    /** run-20261122T140500Z → 2026-11-22 14:05 (local time); other inputs pass through unchanged. */
    function fmt(value) {
      const text = String(value || '')
      const match = /^run-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(text)
      if (match) return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`
      const date = new Date(text)
      if (!text || Number.isNaN(date.getTime())) return text || '—'
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function Panel({ state, onClose }) {
      const runs = (state && state.runs) || []
      const latest = runs[0]
      const shown = latest ? latest.entries.slice(0, 3) : []
      const total = runs.reduce((sum, run) => sum + run.entries.length, 0)
      return h(
        'div',
        { className: 'dwl dwl-overlay', role: 'dialog', 'aria-label': COPY.title },
        h(StyleTag),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
          h('h4', { style: { margin: 0 } }, COPY.title),
          h('button', { className: 'dwl-btn', onClick: onClose }, COPY.close),
        ),
        latest
          ? h(
              'div',
              { style: { marginBottom: 8 } },
              h('div', { className: 'dwl-meta', style: { margin: '2px 0 4px' } }, `${fmt(latest.startedAt)} · ${latest.entries.length}${zh() ? ' 条' : ''}`),
              shown.map((entry, index) =>
                h(
                  'button',
                  {
                    key: `${entry.at}-${index}`,
                    className: 'dwl-entry',
                    onClick: () => openReader({ runId: latest.id, path: latest.path, from: latest.from, to: latest.to }, 'panel'),
                  },
                  h('div', null, entry.topic),
                  h('div', { className: 'dwl-meta' }, entry.summary),
                ),
              ),
            )
          : h('div', { className: 'dwl-empty' }, COPY.noDigest),
        h('div', { className: 'dwl-sep' }),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
          h('span', { className: 'dwl-meta' }, `${COPY.entryHint}${total ? ` · ${total}` : ''}`),
          h('button', { className: 'dwl-btn', onClick: () => openAll() }, `${COPY.viewAll}${total ? `（${total}）` : ''}`),
        ),
      )
    }

    function AllRuns({ state }) {
      const runs = (state && state.runs) || []
      return [
        h('div', { key: 'backdrop', className: 'dwl-backdrop', onClick: stepBack }),
        h(
          'div',
          { key: 'card', className: 'dwl dwl-reader', role: 'dialog', 'aria-label': COPY.allTitle },
          h(StyleTag),
          h(
            'div',
            { className: 'dwl-reader-head' },
            h(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h('button', { className: 'dwl-btn dwl-back', onClick: closeAll, title: COPY.back }, `← ${COPY.back}`),
              h('div', { style: { fontWeight: 600 } }, COPY.allTitle),
            ),
            h('div', { style: { display: 'flex', gap: 8 } }, h('button', { className: 'dwl-btn', onClick: closeEverything }, COPY.closeAll)),
          ),
          h(
            'div',
            { className: 'dwl-reader-body' },
            runs.length
              ? runs.map((run) =>
                  h(
                    'div',
                    { key: run.id, style: { marginBottom: 14 } },
                    h('div', { className: 'dwl-meta', style: { marginBottom: 4 } }, `${fmt(run.startedAt)} · ${run.entries.length}${zh() ? ' 条' : ''}`),
                    run.entries.map((entry, index) =>
                      h(
                        'button',
                        {
                          key: `${entry.at}-${index}`,
                          className: 'dwl-entry',
                          onClick: () => openReader({ runId: run.id, path: run.path, from: run.from, to: run.to }, 'all'),
                        },
                        h('div', null, entry.topic),
                        h('div', { className: 'dwl-meta' }, entry.summary),
                      ),
                    ),
                  ),
                )
              : h('div', { className: 'dwl-empty' }, COPY.noDigest),
          ),
        ),
      ]
    }

    function Reader({ view }) {
      const [text, setText] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      useEffect(() => {
        let alive = true
        setText('')
        setError('')
        act('read', { runId: view.runId })
          .then((result) => {
            if (!alive) return
            if (result && result.ok) setText(result.text)
            else setError(String((result && result.error) || COPY.failed))
          })
          .catch((cause) => {
            if (alive) setError(String((cause && cause.message) || cause))
          })
        return () => {
          alive = false
        }
      }, [view.runId])
      return [
        h('div', { key: 'backdrop', className: 'dwl-backdrop', onClick: stepBack }),
        h(
        'div',
        { key: 'card', className: 'dwl dwl-reader', role: 'dialog', 'aria-label': COPY.title },
        h(StyleTag),
        h(
          'div',
          { className: 'dwl-reader-head' },
          h(
            'div',
            { style: { minWidth: 0, display: 'flex', gap: 8, alignItems: 'flex-start' } },
            h('button', { className: 'dwl-btn dwl-back', onClick: closeReader, title: COPY.back }, `← ${COPY.back}`),
            h(
              'div',
              { style: { minWidth: 0 } },
              h('div', { style: { fontWeight: 600 } }, `${COPY.title} · ${fmt(view.from || view.startedAt)} → ${fmt(view.to)}`),
              h('div', { className: 'dwl-src' }, view.path || ''),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, flexShrink: 0 } },
            h(
              'button',
              {
                className: 'dwl-btn',
                onClick: () => {
                  const result = openDigestTab(view.runId)
                  if (result === 'ok') closeReader()
                  else setNotice(`${zh() ? '打开失败' : 'Failed'}：${result}`)
                },
              },
              COPY.openSidebar,
            ),
            h('button', { className: 'dwl-btn', onClick: () => act('open', { runId: view.runId }) }, COPY.openFile),
            h('button', { className: 'dwl-btn', onClick: closeEverything }, COPY.closeAll),
          ),
        ),
        notice ? h('div', { className: 'dwl-meta', style: { padding: '8px 14px 0' } }, notice) : null,
        h(
          'div',
          { className: 'dwl-reader-body' },
          error ? h('div', { className: 'dwl-err' }, error) : text ? h(Markdown, { text }) : h('div', { className: 'dwl-meta' }, COPY.loading),
        ),
      ),
      ]
    }

    function Overlay() {
      useLang()
      const { open, all, reader } = useUiState()
      const { state, reload } = useWatchlist()
      useEffect(() => {
        if (!open && !reader && !all) return undefined
        reload()
        if (open && !reader) act('seen').then(() => { bumpData(); reload() })
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (reader) closeReader()
          else if (all) closeAll()
          else setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open, all, reader, reload])
      if (reader) return h(Reader, { view: reader })
      if (all) return h(AllRuns, { state })
      if (!open) return null
      return h(Panel, { state, onClose: () => setOpen(false) })
    }

    return {
      inject: ['slots', 'sidebarRight', 'sidebarRightTabs', 'layout', 'locale'],
      apply(ctx) {
        services = ctx
        try {
          if (services.locale && typeof services.locale.subscribe === 'function') {
            ctx.effect(() => services.locale.subscribe(() => notifyLang()))
          }
        } catch {
          /* Without a locale service, follow the browser language only */
        }
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'watchlist', order: 30, label: () => COPY.nav },
            WatchlistPage,
          ),
        )
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'watchlist-footer', order: 20, label: () => COPY.nav },
            FooterAction,
          ),
        )
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'watchlist-overlay', order: 91000 }, Overlay),
        )
        ctx.effect(() =>
          ctx.sidebarRightTabs.register({
            id: DIGEST_TAB,
            kind: 'watchlist-digest',
            title: () => COPY.nav,
          }),
        )
        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register({ name: 'sidebar.right.pane.tab', key: DIGEST_TAB }, DigestTab),
        )
      },
    }
  },
})
