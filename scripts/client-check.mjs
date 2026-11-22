#!/usr/bin/env node
/**
 * Client 半自检（不依赖 Harness）：用桩 React 执行 client.js，验证注入与四个 slot 注册，
 * 并模拟 DSH 语言切换，确认文案会跟随 locale 快照的 active 字段。
 * 用法：node scripts/client-check.mjs
 */
import fs from 'node:fs'
import vm from 'node:vm'
const src = fs.readFileSync('client.js', 'utf8')
let def
const sandbox = {
  window: { __ModuleLoader__: { load: (d) => { def = d } }, addEventListener() {}, removeEventListener() {} },
  navigator: { language: 'zh-CN' },
  fetch: async () => ({ json: async () => ({ ok: true }) }),
  setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, console,
}
vm.createContext(sandbox)
vm.runInContext(src, sandbox)
const React = { createElement: () => null, useState: () => [null, () => {}], useEffect: () => {}, useCallback: (f) => f }
const mod = def.factory((n) => (n === 'react' ? React : {}))
const registered = []
let active = 'en'
const subs = new Set()
const ctx = {
  slots: { inject(k, cb) { cb() }, register(o) { registered.push(o); return () => {} } },
  sidebarRightTabs: { register() { return () => {} } },
  sidebarRight: {}, layout: {},
  locale: { getLocale: () => ({ active, locales: [], revision: 0 }), subscribe(fn) { subs.add(fn); return () => subs.delete(fn) } },
  effect(fn) { return fn() },
}
mod.apply(ctx)
const labels = registered.filter((o) => typeof o.label === 'function')
console.log('DSH=active:en  ->', labels.map((o) => o.label()).join(' / '))
active = 'zh'
for (const fn of subs) fn()
console.log('DSH=active:zh  ->', labels.map((o) => o.label()).join(' / '))
active = 'ja'
for (const fn of subs) fn()
console.log('DSH=active:ja  ->', labels.map((o) => o.label()).join(' / '))
