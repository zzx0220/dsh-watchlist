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
        subtitle: '长期追踪你关心的话题：按次检索进展、落盘日报，并推送到你想要的地方。',
        openSettings: '巡检设置：设置 → 关注清单',
        dataDir: '数据目录',
        topics: '主题',
        empty: '还没有主题，添加一个想长期追踪的题目。',
        addPlaceholder: '添加主题，例如：某模型的新版本发布',
        add: '添加',
        remove: '删除',
        runNow: '立即运行一次',
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
        testNotify: '发一条测试通知',
        testNotifySent: '已发送；看不到请检查 系统设置 → 通知 → DeepSeek Harness',
        testNotifyDenied: '系统拒绝了通知权限，先在 系统设置 → 通知 里打开',
        testNotifyFailed: '发送失败，当前环境可能不支持系统通知',
        notifyTitle: '关注清单：有新进展',
        notifyTestTitle: '关注清单测试通知',
        digests: '日报',
        openFile: '用外部程序打开',
        noDigest: '还没有巡检记录。',
        lastRun: '上次巡检',
        never: '尚未巡检',
        unread: '未读',
        close: '关闭',
        entryHint: '点条目直接阅读',
        loading: '加载中…',
        failed: '加载失败',
        next: '下次触发',
        saveFailed: '保存失败',
      },
      en: {
        nav: 'Watchlist',
        title: 'Watchlist',
        subtitle: 'Follow the topics you care about: scheduled searches, a daily digest on disk, and pushes where you want them.',
        openSettings: 'Schedule settings: Settings → Watchlist',
        dataDir: 'Data',
        topics: 'Topics',
        empty: 'No topics yet. Add something you want to follow.',
        addPlaceholder: 'Add a topic, e.g. a model release',
        add: 'Add',
        remove: 'Remove',
        runNow: 'Run now',
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
        testNotify: 'Send a test notification',
        testNotifySent: 'Sent; if it is missing check System Settings → Notifications → DeepSeek Harness',
        testNotifyDenied: 'Notifications are denied; enable them in System Settings → Notifications',
        testNotifyFailed: 'Failed; this environment may not support system notifications',
        notifyTitle: 'Watchlist: new progress',
        notifyTestTitle: 'Watchlist test notification',
        digests: 'Digests',
        openFile: 'Open externally',
        noDigest: 'No digests yet.',
        lastRun: 'Last run',
        never: 'never',
        unread: 'unread',
        close: 'Close',
        entryHint: 'Click an entry to read',
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

    /* ---------- Native notifications: one per run, only when the run has updates ----------
     * The Host used to post through `osascript`, which macOS attributes to Script
     * Editor, so a click opened the wrong app. The renderer's Notification API is
     * attributed to DeepSeek Harness and can carry an onclick, which is the only
     * route that lands on the report. Runs happen while the app is open, so the
     * renderer is there to post them; a closed app fires no runs either.
     */
    const NOTIFIED_KEY = 'dsh-watchlist-notified-run'
    const NOTIFY_MAX_AGE = 2 * 60 * 60 * 1000 // an older run is history, not news
    const NOTIFY_QUIET_MS = 60 * 1000 // wait until the run stops being written to

    function readNotifiedRun() {
      try {
        return (window.localStorage && window.localStorage.getItem(NOTIFIED_KEY)) || null
      } catch {
        return null
      }
    }

    function writeNotifiedRun(id) {
      try {
        if (window.localStorage) window.localStorage.setItem(NOTIFIED_KEY, id)
      } catch {
        /* No persistent store: the guard degrades to per page load */
      }
    }

    function shortTopicName(topic) {
      const text = String(topic || '').split(/[（(，,：:]/)[0].trim()
      return text.length > 18 ? `${text.slice(0, 18)}…` : text
    }

    function composeNotifyBody(entries) {
      const names = [...new Set(entries.map((entry) => shortTopicName(entry.topic)).filter(Boolean))]
      const shown = names.slice(0, 3)
      const more = names.length - shown.length
      const list = shown.join(zh() ? '、' : ', ') + (more > 0 ? (zh() ? ` 等 ${names.length} 个` : ` and ${more} more`) : '')
      return (zh() ? `${list} 有新进展` : `Progress on ${list}`).slice(0, 120)
    }

    function notificationSupport() {
      if (typeof Notification === 'undefined') return 'unsupported'
      if (Notification.permission === 'denied') return 'denied'
      return 'ok'
    }

    /** Fall back to the in-app reader when the sidebar tab is unavailable. */
    function openRunReport(run) {
      if (!run || !run.id) return
      openReader({ runId: run.id, path: run.path, from: run.from, to: run.to })
    }

    function notifyRun(run, test) {
      if (notificationSupport() !== 'ok') return false
      const updated = (run.entries || []).filter((entry) => entry.hasUpdate === true)
      if (!test && !updated.length) return false
      try {
        const title = test ? COPY.notifyTestTitle : COPY.notifyTitle
        const body = test
          ? zh()
            ? '点它应打开最近一次巡检报告'
            : 'Clicking it should open the latest report'
          : composeNotifyBody(updated)
        const note = new Notification(title, { body })
        note.onclick = () => {
          try {
            if (typeof window.focus === 'function') window.focus()
          } catch {
            /* Focus is best effort */
          }
          openRunReport(run)
          try {
            note.close()
          } catch {
            /* The system may have dismissed it already */
          }
        }
        return true
      } catch {
        return false
      }
    }

    /** Runs on every state refresh: at most one notification per run, and only for a run with updates. */
    function useRunNotifier(state) {
      useEffect(() => {
        if (!state || !state.ok) return
        const channels = (state.settings && state.settings.push && state.settings.push.channels) || []
        if (!channels.includes('macos')) return
        const run = (state.runs || [])[0]
        if (!run) return
        if (readNotifiedRun() === run.id) return
        const updated = (run.entries || []).filter((entry) => entry.hasUpdate === true)
        const startedAt = Date.parse(run.startedAt) || 0
        const fresh = Date.now() - startedAt < NOTIFY_MAX_AGE
        if (!fresh || !updated.length) {
          writeNotifiedRun(run.id)
          return
        }
        const lastAt = Math.max(startedAt, ...(run.entries || []).map((entry) => Date.parse(entry.at) || 0))
        if (Date.now() - lastAt < NOTIFY_QUIET_MS) return // still being written to; wait for the next poll
        notifyRun(run, false)
        writeNotifiedRun(run.id)
      }, [state])
    }

    /* ---------- Shared UI state: the nav icon and the reader overlay live in different subtrees ---------- */
    /**
     * This state lives on window rather than in module scope: the client module may
     * be loaded more than once, and module-level state would give the nav icon and
     * shell.overlay separate copies, so the unread dot and clicks would never agree.
     */
    function uiStore() {
      if (!window.__dshWatchlistUi) window.__dshWatchlistUi = { reader: null, unread: 0, listeners: new Set() }
      return window.__dshWatchlistUi
    }
    function notifyUi() {
      for (const listener of uiStore().listeners) listener()
    }
    /** Publish the unread count from whichever polling component last read the state. */
    function setUnread(value) {
      const ui = uiStore()
      const next = Number(value) || 0
      if (ui.unread === next) return
      ui.unread = next
      notifyUi()
    }
    function openReader(view) {
      const ui = uiStore()
      ui.reader = view
      notifyUi()
    }
    function closeReader() {
      const ui = uiStore()
      ui.reader = null
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
      return { reader: ui.reader, unread: ui.unread }
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
      .dwl-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); }
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
      .dwl-popbackdrop { position: fixed; inset: 0; z-index: 19; background: transparent; pointer-events: auto; }
      .dwl-backdrop { position: fixed; inset: 0; z-index: 39; background: rgba(0, 0, 0, .18); pointer-events: auto; }
      .dwl-reader { -webkit-app-region: no-drag; pointer-events: auto; position: fixed; top: 6vh; left: 7vw; right: 7vw; bottom: 6vh; z-index: 40; display: flex; flex-direction: column;
        background: var(--dsw-alias-bg-overlay, #fff); color: var(--dsw-alias-label-primary, #111);
        border: 1px solid var(--dsw-alias-border-l1, #ddd); border-radius: 12px; box-shadow: 0 18px 48px rgba(0,0,0,.22);
        font-size: 13px; overflow: hidden; }
      .dwl-reader-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
        padding: 12px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e5e5e5); }
      .dwl-reader-body { flex: 1; overflow: auto; padding: 14px 18px; line-height: 1.75; }

      /* ---------- Main panel page: the whole watchlist in one surface ---------- */
      .dwlp { height: 100%; min-height: 0; display: flex; flex-direction: column;
        background: var(--dsw-alias-bg-layer-1, transparent); }
      .dwlp-head { flex: none; display: flex; align-items: flex-start; justify-content: space-between; gap: 18px;
        padding: 22px 32px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)); }
      .dwlp-eyebrow { font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
        color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, #8a8a8a)); }
      .dwlp-title { margin-top: 4px; font-size: 19px; font-weight: 650; line-height: 1.3; }
      .dwlp-sub { margin-top: 5px; font-size: 12px; line-height: 1.6; max-width: 60ch;
        color: var(--dsw-alias-label-secondary, #666); }
      .dwlp-head-actions { display: flex; align-items: center; gap: 10px; flex: none; padding-top: 2px; }
      .dwlp-chip { font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 999px;
        background: var(--dsw-alias-button-info-fill, #2b6cf6); color: #fff; }
      /* The page's one action, but not a high-contrast slab: a faint accent tint with a
         normal-weight label reads as a button without pulling the eye off the content.
         The second declaration wins where color-mix is supported; the first is the
         neutral fallback. */
      .dwlp-primary { font-weight: 600; padding: 4px 12px;
        border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12));
        background: var(--dsw-alias-interactive-bg-hover-accent, rgba(0,0,0,.06));
        background: color-mix(in srgb, var(--dsw-alias-link, #2b6cf6) 9%, transparent);
        color: var(--dsw-alias-label-primary, inherit); }
      .dwlp-primary:hover { background: var(--dsw-alias-interactive-bg-hover-accent, rgba(0,0,0,.1));
        background: color-mix(in srgb, var(--dsw-alias-link, #2b6cf6) 16%, transparent); }
      .dwlp-scroll { flex: 1; min-height: 0; overflow: auto; }
      .dwlp-inner { max-width: 940px; margin: 0 auto; padding: 20px 32px 56px;
        display: flex; flex-direction: column; gap: 16px; }
      .dwlp-status { display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
        padding: 0 2px; font-size: 12px; color: var(--dsw-alias-label-secondary, #666); }
      .dwlp-status-item { display: inline-flex; align-items: center; gap: 6px; }
      .dwlp-status-dot { width: 6px; height: 6px; border-radius: 50%;
        background: var(--dsw-alias-label-tertiary, #bbb); }
      .dwlp-status-dot[data-on='true'] { background: var(--dsw-alias-state-success-primary, #1a9c62); }
      .dwlp-status-hint { margin-left: auto; font-size: 11px;
        color: var(--dsw-alias-label-tertiary, #999); }
      .dwlp-card { border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 12px;
        background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.018)); padding: 15px 17px 16px; }
      .dwlp-cardhead { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; margin-bottom: 11px; }
      .dwlp-cardhead h2 { margin: 0; font-size: 13px; font-weight: 600; }
      .dwlp-cardhead .dwl-meta { font-size: 11px; text-align: right; }
      .dwlp-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(248px, 1fr)); gap: 2px 24px; }
      .dwlp-fields .dwl-field { margin: 4px 0; }
      .dwlp-add { display: flex; gap: 8px; margin-bottom: 12px; }
      .dwlp-topics { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: 10px; }
      .dwlp-topic { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1, transparent); }
      .dwlp-topic-name { font-size: 13px; font-weight: 600; line-height: 1.45; word-break: break-word; }
      .dwlp-topic-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
      .dwlp-topic-foot .dwl-meta { font-size: 11px; }
      .dwlp-mini { padding: 1px 5px; font-size: 11px; }
      .dwlp-icon-btn { border: 0; background: none; color: var(--dsw-alias-label-secondary, #777);
        cursor: pointer; padding: 2px 6px; border-radius: 6px; font-size: 11px; font: inherit; font-size: 11px; }
      .dwlp-icon-btn:hover { background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.06));
        color: var(--dsw-alias-state-error-primary, #c00); }
      .dwlp-history { display: flex; flex-direction: column; gap: 8px; }
      .dwlp-day { border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 10px; overflow: hidden; }
      .dwlp-dayhead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
        padding: 8px 12px; background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.025)); }
      .dwlp-dayhead strong { font-size: 12px; font-weight: 600; }
      .dwlp-dayhead .dwl-meta { font-size: 11px; }
      .dwlp-entry { display: block; width: 100%; text-align: left; border: 0; cursor: pointer;
        border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06));
        background: none; color: inherit; font: inherit; font-size: 12px; padding: 8px 12px; }
      .dwlp-entry:hover { background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.04)); }
      .dwlp-empty { font-size: 12px; color: var(--dsw-alias-label-secondary, #666); padding: 6px 0; }

      /* Nav glyph: the sidebar owns the row, button and label; this is only the mark. */
      .dwlp-glyph { position: relative; display: inline-flex; align-items: center; justify-content: center; }
      .dwlp-dot { position: absolute; top: 0; right: -1px; width: 6px; height: 6px; border-radius: 50%;
        background: var(--dsw-alias-button-info-fill, #2b6cf6);
        box-shadow: 0 0 0 1.5px var(--dsw-alias-bg-layer-1, #fff); }
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
                style: { color: 'var(--dsw-alias-link, #2b6cf6)' },
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

    /* ---------- Shared controls: the settings section and the sidebar page render the same fields ---------- */

    /** Read-only reminder of what the scheduler will do: the page edits topics, not settings. */
    function StatusLine({ settings, schedule }) {
      const autoOn = Boolean(settings.schedule && settings.schedule.enabled)
      const channels = (settings.push && settings.push.channels) || []
      const channelText = channels.length
        ? channels.map((channel) => (channel === 'macos' ? COPY.macos : COPY.session)).join(' / ')
        : '—'
      return h(
        'div',
        { className: 'dwlp-status' },
        h(
          'span',
          { className: 'dwlp-status-item' },
          h('span', { className: 'dwlp-status-dot', 'data-on': autoOn ? 'true' : 'false' }),
          `${COPY.enabled} ${autoOn ? (zh() ? '开' : 'on') : zh() ? '关' : 'off'}`,
        ),
        h('span', { className: 'dwlp-status-item' }, `${COPY.next} ${schedule.timing || '—'}`),
        h('span', { className: 'dwlp-status-item' }, `${COPY.push} ${channelText}`),
        h('span', { className: 'dwlp-status-hint' }, COPY.openSettings),
      )
    }

    /** Default schedule: auto-run, frequency and time, lookback and the per-run cap. */
    function ScheduleFields({ settings, schedule, busy, patchSettings, run }) {
      return h(
        'div',
        { className: 'dwlp-fields' },
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
            className: 'dwl-input dwlp-mini',
            value: (settings.schedule && settings.schedule.time) || '08:30',
            onChange: (event) => patchSettings({ schedule: { time: event.target.value } }),
          }),
        ),
        h(
          'div',
          { className: 'dwl-field' },
          h('span', null, COPY.lookback),
          h('input', {
            className: 'dwl-input dwlp-mini',
            type: 'number',
            value: settings.lookbackDays || 7,
            onChange: (event) => patchSettings({ lookbackDays: Number(event.target.value) || 7 }),
          }),
          h('span', null, COPY.maxTopics),
          h('input', {
            className: 'dwl-input dwlp-mini',
            type: 'number',
            value: settings.maxTopicsPerRun || 8,
            onChange: (event) => patchSettings({ maxTopicsPerRun: Number(event.target.value) || 8 }),
          }),
        ),
        h(
          'div',
          { className: 'dwl-field dwl-meta' },
          h('span', null, COPY.next),
          `${schedule.timing || '—'}${schedule.task ? ` · ${schedule.task.status}` : ''}`,
        ),
      )
    }

    /** Push channels plus the test-notification button. */
    function PushFields({ settings, state, patchSettings, notifyNotice, setNotifyNotice }) {
      const channels = (settings.push && settings.push.channels) || []
      return h(
        'div',
        { className: 'dwlp-fields' },
        h(
          'div',
          { className: 'dwl-field' },
          ['session', 'macos'].map((channel) =>
            h(
              'label',
              { className: 'dwl-check', key: channel },
              h('input', {
                type: 'checkbox',
                checked: channels.includes(channel),
                onChange: (event) => {
                  const next = event.target.checked
                    ? [...new Set([...channels, channel])]
                    : channels.filter((item) => item !== channel)
                  patchSettings({ push: { channels: next.length ? next : ['session'] } })
                },
              }),
              channel === 'session' ? COPY.session : COPY.macos,
            ),
          ),
          h('label', { className: 'dwl-check dwl-meta' }, h('input', { type: 'checkbox', disabled: true }), COPY.wechat),
        ),
        h(
          'div',
          { className: 'dwl-field' },
          h(
            'button',
            {
              className: 'dwl-btn',
              onClick: () => {
                const support = notificationSupport()
                if (support !== 'ok') {
                  setNotifyNotice(support === 'denied' ? COPY.testNotifyDenied : COPY.testNotifyFailed)
                  return
                }
                const latest = (state.runs || [])[0]
                setNotifyNotice(
                  notifyRun(latest || { id: '', entries: [] }, true) ? COPY.testNotifySent : COPY.testNotifyFailed,
                )
              },
            },
            COPY.testNotify,
          ),
          notifyNotice ? h('span', { className: 'dwl-meta' }, notifyNotice) : null,
        ),
      )
    }

    /** Interface language: follow DSH, or pin one. */
    function LanguageFields({ settings, patchSettings }) {
      return h(
        'div',
        { className: 'dwlp-fields' },
        h(
          'div',
          { className: 'dwl-field' },
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

    /** Add row with its own draft, so typing does not re-render the surrounding page. */
    function AddTopicBar({ busy, onAdd }) {
      const [draft, setDraft] = useState('')
      const [every, setEvery] = useState('')
      const submit = () => {
        const topic = draft.trim()
        if (!topic) return
        onAdd(topic, every)
        setDraft('')
        setEvery('')
      }
      return h(
        'div',
        { className: 'dwlp-add' },
        h('input', {
          className: 'dwl-input dwl-grow',
          placeholder: COPY.addPlaceholder,
          value: draft,
          onChange: (event) => setDraft(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') submit()
          },
        }),
        h(
          'select',
          {
            className: 'dwl-input',
            value: every,
            title: COPY.interval,
            onChange: (event) => setEvery(event.target.value),
          },
          h('option', { value: '' }, COPY.iDefault),
          h('option', { value: '1' }, COPY.iDay),
          h('option', { value: '7' }, COPY.iWeek),
          h('option', { value: '30' }, COPY.iMonth),
        ),
        h('button', { className: 'dwl-btn', disabled: busy || !draft.trim(), onClick: submit }, COPY.add),
      )
    }

    /** Topic cards: name, keywords, last run, per-topic interval, remove. */
    function TopicCards({ state, busy, run }) {
      if (!state.topics.length) return h('div', { className: 'dwlp-empty' }, COPY.empty)
      return h(
        'div',
        { className: 'dwlp-topics' },
        state.topics.map((topic) =>
          h(
            'div',
            { key: topic.id, className: 'dwlp-topic' },
            h('div', { className: 'dwlp-topic-name' }, topic.topic),
            topic.keywords && topic.keywords.length ? h('div', { className: 'dwl-meta' }, topic.keywords.join(' · ')) : null,
            h(
              'div',
              { className: 'dwlp-topic-foot' },
              h(
                'span',
                { className: 'dwl-meta' },
                `${COPY.lastRun} ${topic.lastCheckedAt ? fmt(topic.lastCheckedAt) : COPY.never}`,
              ),
              h(
                'select',
                {
                  className: 'dwl-input dwlp-mini',
                  value: topic.everyDays ? String(topic.everyDays) : '',
                  disabled: busy,
                  title: COPY.interval,
                  onChange: (event) =>
                    run('update-topic', {
                      target: topic.id,
                      everyDays: event.target.value ? Number(event.target.value) : 0,
                    }),
                },
                h('option', { value: '' }, COPY.iDefault),
                h('option', { value: '1' }, COPY.iDay),
                h('option', { value: '7' }, COPY.iWeek),
                h('option', { value: '30' }, COPY.iMonth),
              ),
              h('button', { className: 'dwlp-icon-btn', disabled: busy, onClick: () => run('remove', { target: topic.id }) }, COPY.remove),
            ),
          ),
        ),
      )
    }

    /** Reports grouped by day file; one entry per topic, clicking opens the reader. */
    function HistorySection({ state }) {
      const groups = groupRunsByFile((state && state.runs) || [])
      if (!groups.length) return h('div', { className: 'dwlp-empty' }, COPY.noDigest)
      return h(
        'div',
        { className: 'dwlp-history' },
        groups.map((group) =>
          h(
            'div',
            { key: group.key, className: 'dwlp-day' },
            h(
              'div',
              { className: 'dwlp-dayhead' },
              h('strong', null, group.day),
              h(
                'span',
                { className: 'dwl-meta' },
                `${group.runs.length}${zh() ? ' 次巡检' : group.runs.length === 1 ? ' run' : ' runs'} · ${group.entries}${zh() ? ' 条' : ''}`,
              ),
            ),
            group.runs.flatMap((runRecord) =>
              runRecord.entries.map((entry, index) =>
                h(
                  'button',
                  {
                    key: `${runRecord.id}-${entry.at}-${index}`,
                    className: 'dwlp-entry',
                    onClick: () =>
                      openReader({ runId: runRecord.id, path: runRecord.path, from: runRecord.from, to: runRecord.to }),
                  },
                  h('div', null, entry.topic),
                  h('div', { className: 'dwl-meta' }, entry.summary),
                ),
              ),
            ),
          ),
        ),
      )
    }

    /** Settings → Watchlist: the same controls in a plain scrolling section. */
    function WatchlistPage() {
      useLang()
      const { state, error, busy, run } = useWatchlist()
      const [notifyNotice, setNotifyNotice] = useState('')
      if (!state) return h('div', { className: 'dwl' }, h(StyleTag), error || COPY.loading)

      const settings = state.settings || {}
      const schedule = state.schedule || {}
      const patchSettings = (patch) => run('settings', { patch })

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
        h(AddTopicBar, { busy, onAdd: (topic, every) => run('add', { topic, everyDays: every ? Number(every) : undefined }) }),
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
        h(ScheduleFields, { settings, schedule, busy, patchSettings, run }),

        h('h3', null, COPY.push),
        h(PushFields, { settings, state, patchSettings, notifyNotice, setNotifyNotice }),

        h('h3', null, COPY.language),
        h(LanguageFields, { settings, patchSettings }),
      )
    }

    /** The sidebar panel: the whole watchlist in one page, selected from the nav list. */
    function WatchlistPanel() {
      useLang()
      const { state, error, busy, run, reload } = useWatchlist()
      // Opening the page is reading the list: clear the count the nav dot shows.
      useEffect(() => {
        if (!state || !state.unread) return
        act('seen').then(() => reload())
      }, [state])

      const settings = (state && state.settings) || {}
      const schedule = (state && state.schedule) || {}
      const unread = (state && state.unread) || 0

      return h(
        'div',
        { className: 'dwl dwlp' },
        h(StyleTag),
        h(
          'div',
          { className: 'dwlp-head' },
          h(
            'div',
            { style: { minWidth: 0 } },
            h('div', { className: 'dwlp-eyebrow' }, COPY.nav),
            h('div', { className: 'dwlp-title' }, COPY.title),
            h('div', { className: 'dwlp-sub' }, COPY.subtitle),
          ),
          h(
            'div',
            { className: 'dwlp-head-actions' },
            unread ? h('span', { className: 'dwlp-chip' }, `${unread} ${COPY.unread}`) : null,
            h('button', { className: 'dwl-btn dwlp-primary', disabled: busy, onClick: () => run('run') }, COPY.runNow),
          ),
        ),
        h(
          'div',
          { className: 'dwlp-scroll' },
          h(
            'div',
            { className: 'dwlp-inner' },
            h(ErrorLine, { text: error }),
            !state
              ? h('div', { className: 'dwlp-empty' }, COPY.loading)
              : [
                  h(StatusLine, { key: 'status', settings, schedule }),
                  h(
                    'section',
                    { key: 'topics', className: 'dwlp-card' },
                    h(
                      'div',
                      { className: 'dwlp-cardhead' },
                      h('h2', null, COPY.topics),
                      h(
                        'span',
                        { className: 'dwl-meta' },
                        `${state.topics.length} ${zh() ? '个主题' : 'topics'} · ${state.dataDir}`,
                      ),
                    ),
                    h(AddTopicBar, {
                      busy,
                      onAdd: (topic, every) =>
                        run('add', { topic, everyDays: every ? Number(every) : undefined }),
                    }),
                    h(TopicCards, { state, busy, run }),
                  ),
                  h(
                    'section',
                    { key: 'history', className: 'dwlp-card' },
                    h(
                      'div',
                      { className: 'dwlp-cardhead' },
                      h('h2', null, COPY.digests),
                      h('span', { className: 'dwl-meta' }, COPY.entryHint),
                    ),
                    h(HistorySection, { state }),
                  ),
                ],
          ),
        ),
      )
    }

    /** Nav mark: the sidebar owns the row, label and selected state; this is only the glyph. */
    function WatchlistNavIcon(props) {
      const { unread } = useUiState()
      const size = (props && props.size) || 16
      return h(
        'span',
        { className: 'dwlp-glyph' },
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.7,
            'aria-hidden': 'true',
          },
          h('circle', { cx: 12, cy: 12, r: 8.4 }),
          h('circle', { cx: 12, cy: 12, r: 4 }),
          h('circle', { cx: 12, cy: 12, r: 1.1, fill: 'currentColor', stroke: 'none' }),
        ),
        unread > 0 ? h('span', { className: 'dwlp-dot' }) : null,
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

    /** Runs grouped by their report file: one file per day, so one block per file.
     *  Older records have no `file`; each of them is its own block. */
    function groupRunsByFile(runs) {
      const order = []
      const byFile = new Map()
      for (const run of runs) {
        const key = run.file || run.path || run.id
        if (!byFile.has(key)) {
          byFile.set(key, [])
          order.push(key)
        }
        byFile.get(key).push(run)
      }
      return order.map((key) => {
        const list = byFile.get(key).slice().sort((a, b) => (String(a.startedAt) < String(b.startedAt) ? 1 : -1))
        const first = list[0]
        return {
          key,
          day: first.day || String(first.startedAt || '').slice(0, 10),
          runs: list,
          path: first.path || '',
          entries: list.reduce((sum, run) => sum + run.entries.length, 0),
        }
      })
    }

    /** One report: the day file's own Markdown, a shortcut to the right sidebar, and the file itself. */
    function Reader({ view }) {
      const [text, setText] = useState('')
      const [error, setError] = useState('')
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
        h('div', { key: 'backdrop', className: 'dwl-backdrop', onClick: closeReader }),
        h(
          'div',
          { key: 'card', className: 'dwl dwl-reader', role: 'dialog', 'aria-label': COPY.title },
          h(StyleTag),
          h(
            'div',
            { className: 'dwl-reader-head' },
            h(
              'div',
              { style: { minWidth: 0 } },
              h(
                'div',
                { style: { fontWeight: 600 } },
                `${COPY.title} · ${fmt(view.from || view.startedAt)} → ${fmt(view.to)}`,
              ),
              h('div', { className: 'dwl-src' }, view.path || ''),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 8, flexShrink: 0 } },
              h('button', { className: 'dwl-btn', onClick: () => act('open', { runId: view.runId }) }, COPY.openFile),
              h('button', { className: 'dwl-btn', onClick: closeReader }, COPY.close),
            ),
          ),
          h(
            'div',
            { className: 'dwl-reader-body' },
            error
              ? h('div', { className: 'dwl-err' }, error)
              : text
                ? h(Markdown, { text })
                : h('div', { className: 'dwl-meta' }, COPY.loading),
          ),
        ),
      ]
    }

    /**
     * Always-mounted overlay: it owns the reader, the unread count the nav dot
     * shows, the 60-second poll that lets a run notify while another panel is
     * open, and Escape handling. It renders nothing until a report is opened.
     */
    function Overlay() {
      useLang()
      const { reader } = useUiState()
      const { state, reload } = useWatchlist()
      useRunNotifier(state)
      useEffect(() => {
        setUnread((state && state.unread) || 0)
      }, [state])
      useEffect(() => {
        const timer = setInterval(reload, 60000)
        return () => clearInterval(timer)
      }, [reload])
      useEffect(() => {
        if (!reader) return undefined
        reload()
        act('seen').then(() => reload())
        const onKey = (event) => {
          if (event.key === 'Escape') closeReader()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [reader, reload])
      if (!reader) return null
      return h(Reader, { view: reader })
    }

    return {
      inject: ['slots', 'locale'],
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
        // The page must exist before the sidebar row can select it: the sidebar
        // lists a panel only while a `main` entry carries the same key.
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'watchlist' }, WatchlistPanel),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'watchlist', order: 20, label: () => COPY.nav },
            WatchlistNavIcon,
          ),
        )
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'watchlist-overlay', order: 91000 }, Overlay),
        )
      },
    }
  },
})
