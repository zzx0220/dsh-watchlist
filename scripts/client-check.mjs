#!/usr/bin/env node
/**
 * Client-half self-check (no Harness required):
 *   1. run client.js against a stub React, confirming injection and the exact
 *      set of slot registrations (the nav entry is a `sidebar.panellist` row
 *      with a matching `main` page, not a `sidebar.footer.action`);
 *   2. simulate a DSH language switch, confirming labels follow locale.active;
 *   3. render every registered component, leaving stateful components three
 *      passes so a resolved state is reached, which catches "a deleted helper
 *      blows up at render time with ReferenceError" and keeps the loading
 *      branch from being the only one exercised.
 * Usage: node scripts/client-check.mjs
 */
import fs from 'node:fs'
import vm from 'node:vm'

/** The `/state` payload every render below starts from. */
const STATE = {
  ok: true,
  dataDir: '/tmp/watchlist',
  unread: 2,
  topics: [
    { id: 't1', topic: '主题A', keywords: ['关键词'], everyDays: 1, lastCheckedAt: '2026-11-21T08:30:00Z' },
    { id: 't2', topic: '主题B', keywords: [], everyDays: 0, lastCheckedAt: null },
  ],
  settings: {
    schedule: { enabled: true, frequency: 'daily', time: '08:30' },
    lookbackDays: 7,
    maxTopicsPerRun: 8,
    push: { channels: ['session', 'macos'] },
    locale: 'auto',
  },
  schedule: { timing: '2026-11-23 08:30', task: { status: 'active' } },
  runs: [
    {
      id: 'run-20261122T141848Z',
      path: '/tmp/report.md',
      from: '2026-11-17T00:00:00Z',
      to: '2026-11-22T00:00:00Z',
      startedAt: '2026-11-22T14:18:48Z',
      day: '2026-11-22',
      entries: [
        { at: '2026-11-22T14:18:48Z', topic: '主题A', summary: '摘要', hasUpdate: true, sources: ['来源 - https://example.com'] },
      ],
    },
  ],
}

const src = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
let def
const sandbox = {
  window: { __ModuleLoader__: { load: (d) => { def = d } }, addEventListener() {}, removeEventListener() {} },
  navigator: { language: 'zh-CN' },
  fetch: async (url) => ({
    json: async () =>
      String(url).endsWith('/action')
        ? { ok: true, text: '# 报告\n\n## 主题\n\n- 状态：有实质进展\n- 来源：https://example.com' }
        : STATE,
  }),
  setInterval: () => 0,
  clearInterval() {},
  setTimeout: () => 0,
  console,
}
vm.createContext(sandbox)
vm.runInContext(src, sandbox)

/* ---------- Stub React: a stateful harness for the top level, a stateless one for children ---------- */
let hookMode = 'stateless'
let cells = []
let cellCursor = 0
let pendingEffects = []

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => {
    if (hookMode !== 'harness') return [typeof init === 'function' ? init() : init, () => {}]
    const index = cellCursor++
    if (!cells[index]) cells[index] = { value: typeof init === 'function' ? init() : init }
    const cell = cells[index]
    return [cell.value, (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next }]
  },
  useEffect: (fn) => {
    if (hookMode === 'harness') {
      pendingEffects.push(fn)
      return
    }
    try {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanup()
    } catch (error) {
      console.log('EFFECT THROW:', error.message)
    }
  },
  useCallback: (fn) => fn,
}
const mod = def.factory((name) => (name === 'react' ? React : {}))

const registered = []
const comps = {}
let active = 'en'
const subs = new Set()
const ctx = {
  slots: {
    inject(_key, cb) {
      cb()
    },
    register(options, component) {
      registered.push(options)
      comps[`${options.name}#${options.key || options.id}`] = component
      return () => {}
    },
  },
  sidebarRightTabs: { register: () => () => {} },
  sidebarRight: {},
  layout: {},
  locale: { getLocale: () => ({ active }), subscribe: (fn) => (subs.add(fn), () => subs.delete(fn)) },
  effect: (fn) => fn(),
}

// Static check: every COPY.xxx referenced in the code must exist in both dictionaries
{
  const used = new Set([...src.matchAll(/COPY\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))
  used.delete('xxx') // the example inside a comment
  const zh = src.slice(src.indexOf('      zh: {'), src.indexOf('      en: {'))
  const en = src.slice(src.indexOf('      en: {'), src.indexOf('    }\n\n    // A Proxy'))
  const keysOf = (block) => new Set([...block.matchAll(/^\s{8}([A-Za-z0-9_]+):/gm)].map((m) => m[1]))
  const zhKeys = keysOf(zh)
  const enKeys = keysOf(en)
  const missingZh = [...used].filter((k) => !zhKeys.has(k))
  const missingEn = [...used].filter((k) => !enKeys.has(k))
  console.log('copy keys:', missingZh.length || missingEn.length ? `missing zh=${missingZh} en=${missingEn}` : 'complete')
  if (missingZh.length || missingEn.length) process.exitCode = 1
}

console.log('inject:', mod.inject.join(','))
mod.apply(ctx)
console.log('registered:', registered.map((item) => item.name).join(' | '))

const EXPECTED = [
  'settings.section#watchlist',
  'main#watchlist',
  'sidebar.panellist#watchlist',
  'shell.overlay#watchlist-overlay',
]
let failures = 0
const actual = registered.map((item) => `${item.name}#${item.key || item.id}`)
const surplus = actual.filter((key) => !EXPECTED.includes(key))
const absent = EXPECTED.filter((key) => !actual.includes(key))
console.log('registrations:', surplus.length || absent.length ? `missing=${absent} unexpected=${surplus}` : 'exactly as expected')
if (surplus.length || absent.length) failures += 1

const labels = registered.filter((item) => typeof item.label === 'function')
console.log('labels(en):', labels.map((item) => item.label()).join(' / '))
active = 'zh'
for (const fn of subs) fn()
console.log('labels(zh):', labels.map((item) => item.label()).join(' / '))
active = 'ja'
for (const fn of subs) fn()
console.log('labels(ja):', labels.map((item) => item.label()).join(' / '))

const badText = []

/** Render one component over a few passes so asynchronously loaded state is reached. */
async function renderComponent(Component, props) {
  hookMode = 'harness'
  cells = []
  let tree
  for (let pass = 0; pass < 3; pass += 1) {
    cellCursor = 0
    pendingEffects = []
    tree = Component(props || {})
    const cleanups = pendingEffects.map((fn) => {
      try {
        return fn()
      } catch (error) {
        console.log('EFFECT THROW:', error.message)
        return undefined
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    for (const cleanup of cleanups) {
      if (typeof cleanup === 'function') {
        try {
          cleanup()
        } catch {
          /* listeners were already removed with the pass */
        }
      }
    }
  }
  hookMode = 'stateless'
  return resolveNode(tree, 0)
}

/** Replace every function child with what it renders, so children load state too. */
async function resolveNode(node, depth) {
  if (depth > 12 || node == null) return node
  if (typeof node === 'string') {
    if (node.includes('undefined')) badText.push(node)
    return node
  }
  if (Array.isArray(node)) {
    const out = []
    for (const item of node) out.push(await resolveNode(item, depth))
    return out
  }
  if (typeof node !== 'object') return node
  if (typeof node.type === 'function') {
    let inner
    try {
      inner = await renderComponent(node.type, node.props || {})
    } catch (error) {
      throw new Error(`render threw in ${node.type.name || 'anonymous'}: ${error.message}`)
    }
    return resolveNode(inner, depth + 1)
  }
  const children = []
  for (const child of node.children || []) children.push(await resolveNode(child, depth))
  return { ...node, children }
}

/** Every string a resolved tree reaches. */
function textOf(node, out = []) {
  if (node == null) return out
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    node.forEach((item) => textOf(item, out))
    return out
  }
  if (typeof node !== 'object') return out
  ;(node.children || []).forEach((child) => textOf(child, out))
  return out
}

const run = STATE.runs[0]
active = 'en'
for (const fn of subs) fn()
const cases = [
  ['main page', 'main#watchlist', {}, ['主题A', '2026-11-22', 'Next run']],
  ['settings section', 'settings.section#watchlist', {}, ['主题A']],
  ['nav icon', 'sidebar.panellist#watchlist', { size: 16, active: false }, []],
  ['reader', 'shell.overlay#watchlist-overlay', {}, ['状态：有实质进展']],
]
for (const [label, key, props, expected] of cases) {
  // The reader case opens a report first; every other case renders nothing.
  sandbox.window.__dshWatchlistUi = { reader: key.includes('overlay') ? run : null, unread: 2, listeners: new Set() }
  try {
    const tree = await renderComponent(comps[key], props)
    const joined = textOf(tree).join('\n')
    const missing = expected.filter((text) => !joined.includes(text))
    if (missing.length) throw new Error(`missing rendered text: ${JSON.stringify(missing)}`)
    // The main page edits topics only; schedule, push and language controls belong to Settings.
    if (key === 'main#watchlist') {
      const stale = ['Default schedule', 'Follow DSH', 'Send a test notification'].filter((text) => joined.includes(text))
      if (stale.length) throw new Error(`settings controls leaked into the page: ${JSON.stringify(stale)}`)
    }
    console.log(`render ${label}: ok${expected.length ? ` (state reached: ${expected.join(', ')})` : ''}`)
  } catch (error) {
    failures += 1
    console.log(`render ${label}: FAIL ${error.message}`)
  }
}

// The nav glyph must style itself; the page's <style> unmounts when another panel is selected.
{
  sandbox.window.__dshWatchlistUi = { reader: null, unread: 2, listeners: new Set() }
  const tree = await renderComponent(comps['sidebar.panellist#watchlist'], { size: 16, active: false })
  const flat = JSON.stringify(tree)
  const styled = tree.some((node) => node && node.type === 'style')
  if (!styled) {
    failures += 1
    console.log('nav icon: FAIL the glyph did not render its own <style>')
  } else if (!flat.includes('dwlp-dot')) {
    failures += 1
    console.log('nav icon: FAIL the unread dot is missing while unread')
  } else {
    console.log('nav icon: carries its own style and the unread dot')
  }
}

if (badText.length) {
  failures += 1
  console.log(`rendered an undefined label: ${JSON.stringify(badText.slice(0, 3))}`)
}

if (failures) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed')
