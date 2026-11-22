#!/usr/bin/env node
/**
 * Client 半自检（不依赖 Harness）：
 *   1. 桩 React 执行 client.js，确认注入与四个 slot 注册；
 *   2. 模拟 DSH 语言切换，确认文案跟随 locale.active；
 *   3. 递归渲染四个组件（面板 / 全部 / 阅读窗 / 页脚 / 设置 / 标签页），
 *      能抓到「函数被误删导致渲染时 ReferenceError」这类问题——上一版正是这样丢的。
 * 用法：node scripts/client-check.mjs
 */
import fs from 'node:fs'
import vm from 'node:vm'

const src = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
let def
const sandbox = {
  window: { __ModuleLoader__: { load: (d) => { def = d } }, addEventListener() {}, removeEventListener() {} },
  navigator: { language: 'zh-CN' },
  fetch: async () => ({ json: async () => ({ ok: true, text: '# 报告\n\n## 主题\n\n- 状态：有实质进展' }) }),
  setInterval: () => 0,
  clearInterval() {},
  setTimeout: () => 0,
  console,
}
vm.createContext(sandbox)
vm.runInContext(src, sandbox)

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: (fn) => {
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

// 静态核对：代码里引用的 COPY.xxx 必须都在两个字典里
{
  const used = new Set([...src.matchAll(/COPY\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))
  used.delete('xxx') // 注释里的示例
  const zh = src.slice(src.indexOf('      zh: {'), src.indexOf('      en: {'))
  const en = src.slice(src.indexOf('      en: {'), src.indexOf('    }\n\n    // 用 Proxy'))
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

const labels = registered.filter((item) => typeof item.label === 'function')
console.log('labels(en):', labels.map((item) => item.label()).join(' / '))
active = 'zh'
for (const fn of subs) fn()
console.log('labels(zh):', labels.map((item) => item.label()).join(' / '))
active = 'ja'
for (const fn of subs) fn()
console.log('labels(ja):', labels.map((item) => item.label()).join(' / '))

const badText = []
function walk(node, depth) {
  if (depth > 12 || node == null) return
  if (typeof node === 'string') {
    if (node.includes('undefined')) badText.push(node)
    return
  }
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, depth))
    return
  }
  if (typeof node !== 'object') return
  const { type, props, children } = node
  if (typeof type === 'function') {
    let out
    try {
      out = type(props || {})
    } catch (error) {
      throw new Error(`render threw in ${type.name || 'anonymous'}: ${error.message}`)
    }
    walk(out, depth + 1)
    return
  }
  ;(children || []).forEach((child) => walk(child, depth))
}

const run = {
  id: 'run-20261122T141848Z',
  path: '/tmp/report.md',
  from: '2026-11-17T00:00:00Z',
  to: '2026-11-22T00:00:00Z',
  startedAt: '2026-11-22T14:18:48Z',
  entries: [{ at: '2026-11-22T14:18:48Z', topic: '主题A', summary: '摘要', sources: ['来源 - https://example.com'] }],
}

let failures = 0
for (const [label, ui] of [
  ['面板', { open: true, all: false, reader: null }],
  ['全部', { open: false, all: true, reader: null }],
  ['阅读窗', { open: false, all: false, reader: run }],
]) {
  sandbox.window.__dshWatchlistUi = { ...ui, backTo: 'panel', dataRev: 0, listeners: new Set() }
  try {
    walk(comps['shell.overlay#watchlist-overlay']({}), 0)
    console.log(`render ${label}: ok`)
  } catch (error) {
    failures += 1
    console.log(`render ${label}: FAIL ${error.message}`)
  }
}

for (const [label, key, props] of [
  ['页脚', 'sidebar.footer.action#watchlist-footer', { wide: true }],
  ['设置页', 'settings.section#watchlist', {}],
  ['标签页', 'sidebar.right.pane.tab#dsh-watchlist/digest', {}],
]) {
  try {
    walk(comps[key](props), 0)
    console.log(`render ${label}: ok`)
  } catch (error) {
    failures += 1
    console.log(`render ${label}: FAIL ${error.message}`)
  }
}

if (badText.length) {
  failures += 1
  console.log(`渲染出 undefined 文案: ${JSON.stringify(badText.slice(0, 3))}`)
}

if (failures) {
  console.error(`\n${failures} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
