/**
 * dsh-watchlist — Client half.
 *
 * 三个面：
 *   settings.section      「关注清单」整页：主题增删、巡检设置、推送渠道、日报正文
 *   sidebar.footer.action 侧栏底部图标 + 未读圆点
 *   shell.overlay         未读浮层：最近一次巡检的条目 + 标记已读
 *
 * 数据来自 Host 的 /dsh-watchlist-api（仅回环），Client 不碰文件系统。
 */
window.__ModuleLoader__.load({
  id: 'dsh-watchlist',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    /* ---------- 语言：设置 > DSH 语言 > 浏览器语言；非中文一律英文 ---------- */

    let langOverride = null // 'zh' | 'en' | null（null = 跟随 DSH）

    function dshLang() {
      try {
        const snapshot = services && services.locale && services.locale.getLocale && services.locale.getLocale()
        const id = snapshot && (snapshot.active || snapshot.id || snapshot.locale || snapshot.language)
        if (typeof id === 'string' && id) return /^zh/i.test(id) ? 'zh' : 'en'
      } catch {
        /* 没有 locale 服务时退回浏览器语言 */
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
        openSettings: 'Manage in Settings → Watchlist',
        loading: 'Loading…',
        failed: 'Failed to load',
        next: 'Next run',
        saveFailed: 'Save failed',
      },
    }

    // 用 Proxy 让既有的 COPY.xxx 永远读到当前语言，不必逐处改写。
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

    /** apply() 里拿到的 Client 上下文，组件用它调用 layout / sidebarRight。 */
    let services = null

    function currentSessionId() {
      try {
        const info = services && services.layout && services.layout.panelInfo
        const value = typeof info === 'function' ? info() : info
        if (typeof value === 'string') return value
        if (!value) return null
        // 布局 store 的字段名是 activePanelId；主面板键可能是 'conversation'，只接受会话 id 形状。
        const id = value.activePanelId || value.sessionId || value.id || null
        return typeof id === 'string' && /^session-/.test(id) ? id : null
      } catch {
        return null
      }
    }

    /* ---------- 共享的浮层开关：footer 按钮和 overlay 不在同一棵子树里 ---------- */
    /**
     * 浮层状态挂在 window 上，而不是模块作用域：Client 模块可能被加载成多份，
     * 模块级状态会让「footer 按钮」和「shell.overlay」各拿一份，点击永远没有回响。
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
      .dwl-reader { pointer-events: auto; position: fixed; top: 6vh; left: 7vw; right: 7vw; bottom: 6vh; z-index: 40; display: flex; flex-direction: column;
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

    /** 只覆盖我们自己生成的巡检报告格式：标题、二级标题、列表、链接、粗体。 */
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

    /** 右侧栏日报标签页的当前日期；标签页内容自己订阅它，不依赖 tab 参数。 */
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

    /** 在右侧栏打开插件自己的标签页（不经过文件预览，因此与工作区无关）。 */
    function openDigestTab(runId) {
      try {
        const sidebar = services && services.sidebarRight
        if (!sidebar || typeof sidebar.openTab !== 'function') return 'nohost'
        setDigestDay(runId)
        sidebar.openTab('watchlist-digest', {})
        try {
          if (services.layout && typeof services.layout.openRightbar === 'function') services.layout.openRightbar(true, false)
        } catch {
          /* 面板展开失败不影响标签页 */
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

    /** run-20261122T140500Z → 2026-11-22 14:05（本地时间）；其它输入原样返回。 */
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

    function AllRuns({ state, onClose }) {
      const runs = (state && state.runs) || []
      return h(
        'div',
        { className: 'dwl dwl-reader', role: 'dialog', 'aria-label': COPY.allTitle },
        h(StyleTag),
        h(
          'div',
          { className: 'dwl-reader-head' },
          h('div', { style: { fontWeight: 600 } }, COPY.allTitle),
          h('div', { style: { display: 'flex', gap: 8 } }, h('button', { className: 'dwl-btn', onClick: onClose }, COPY.close)),
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
      )
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
      return h(
        'div',
        { className: 'dwl dwl-reader', role: 'dialog', 'aria-label': COPY.title },
        h(StyleTag),
        h(
          'div',
          { className: 'dwl-reader-head' },
          h(
            'div',
            { style: { minWidth: 0 } },
            h('div', { style: { fontWeight: 600 } }, `${COPY.title} · ${fmt(view.from || view.startedAt)} → ${fmt(view.to)}`),
            h('div', { className: 'dwl-src' }, view.path || ''),
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
            h('button', { className: 'dwl-btn', onClick: closeReader }, COPY.close),
          ),
        ),
        notice ? h('div', { className: 'dwl-meta', style: { padding: '8px 14px 0' } }, notice) : null,
        h(
          'div',
          { className: 'dwl-reader-body' },
          error ? h('div', { className: 'dwl-err' }, error) : text ? h(Markdown, { text }) : h('div', { className: 'dwl-meta' }, COPY.loading),
        ),
      )
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
      if (all) return h(AllRuns, { state, onClose: () => closeAll() })
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
          /* 没有语言服务时只跟随浏览器语言 */
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
