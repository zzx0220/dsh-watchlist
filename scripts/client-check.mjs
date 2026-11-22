#!/usr/bin/env node
/**
 * Client-half self-check (no Harness required):
 *   1. run client.js against a stub React, confirming injection and the four
 *      slot registrations;
 *   2. simulate a DSH language switch, confirming labels follow locale.active;
 *   3. render four components recursively (panel / all / reader / footer /
 *      settings / tab), which catches “a deleted helper blows up at render
 *      time with ReferenceError” — exactly how the previous version broke.
 * Usage: node scripts/client-check.mjs
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

// Static check: every COPY.xxx referenced in the code must exist in both dictionaries
{
  const used = new Set([...src.matchAll(/COPY\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))
  used.delete('xxx') // the example inside a comment
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
  ['panel', { open: true, all: false, reader: null }],
  ['all', { open: false, all: true, reader: null }],
  ['reader', { open: false, all: false, reader: run }],
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
  ['footer', 'sidebar.footer.action#watchlist-footer', { wide: true }],
  ['settings', 'settings.section#watchlist', {}],
  ['tab', 'sidebar.right.pane.tab#dsh-watchlist/digest', {}],
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
  console.log(`rendered an undefined label: ${JSON.stringify(badText.slice(0, 3))}`)
}

if (failures) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed')
