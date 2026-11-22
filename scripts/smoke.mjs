#!/usr/bin/env node
/**
 * 无 Harness 也能跑的逻辑自检：清单增删、设置合并、按次巡检的记录与迁移。
 * 用法：node scripts/smoke.mjs
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import * as store from '../lib/store.js'

const dir = mkdtempSync(join(tmpdir(), 'watchlist-smoke-'))
let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${name}: ${error.message}`)
  }
}

try {
  check('add creates a topic', () => {
    const r = store.addTopic(dir, { topic: '某科学进展', keywords: ['关键词A'], note: '看有没有新论文' })
    assert.equal(r.created, true)
    assert.equal(r.total, 1)
    assert.match(r.topic.id, /^t_[0-9a-f]{8}$/)
  })

  check('add dedupes by normalized name', () => {
    const r = store.addTopic(dir, { topic: '  某科学进展  ' })
    assert.equal(r.created, false)
    assert.equal(r.total, 1)
  })

  check('schedule defaults to enabled', () => {
    assert.equal(store.normalizeSettings({}).schedule.enabled, true)
    assert.equal(store.normalizeSettings({ schedule: { enabled: false } }).schedule.enabled, false)
  })

  check('settings merge defaults with patch and clamp', () => {
    const s1 = store.normalizeSettings({ lookbackDays: 1000, schedule: { time: '9:00' } })
    assert.equal(s1.lookbackDays, 90)
    assert.equal(s1.schedule.time, '08:30')
    store.saveSettings(dir, { lookbackDays: 3, push: { channels: ['session', 'macos'] } })
    const s2 = store.loadSettings(dir, { lookbackDays: 7 })
    assert.equal(s2.lookbackDays, 3)
    assert.deepEqual(s2.push.channels, ['session', 'macos'])
  })

  check('a run writes one report file per run', () => {
    const from = new Date(Date.now() - 5 * 86400000).toISOString()
    const run = store.startRun(dir, { from })
    assert.match(run.id, /^run-\d{8}T\d{6}Z$/)
    const r1 = store.appendRunEntry(dir, { topic: '某科学进展', hasUpdate: true, summary: '有新论文', sources: ['论文 - https://example.com/a'] })
    assert.equal(r1.runTotal, 1)
    const r2 = store.appendRunEntry(dir, { topic: '某科学进展', hasUpdate: false, summary: '无更多进展', sources: [] })
    assert.equal(r2.runTotal, 2)
    assert.equal(r1.path, r2.path)
    const text = readFileSync(r2.path, 'utf8')
    assert.match(text, /# 关注清单巡检 /)
    assert.match(text, /覆盖区间：/)
    assert.equal((text.match(/^## /gm) ?? []).length, 2)
    assert.equal(store.listRuns(dir).length, 1)
  })

  check('a second run today gets its own file', () => {
    store.closeCurrentRun(dir)
    const run = store.startRun(dir, {})
    store.appendRunEntry(dir, { topic: '某科学进展', hasUpdate: false, summary: '补查', sources: [] })
    const runs = store.listRuns(dir)
    assert.equal(runs.length, 2)
    assert.notEqual(runs[0].path, runs[1].path)
    assert.equal(runs[0].id, run.id)
  })

  check('unread counts entries after last seen', () => {
    assert.equal(store.unreadCount(dir), 3)
    store.markSeen(dir)
    assert.equal(store.unreadCount(dir), 0)
  })

  check('remove by name, then by id', () => {
    assert.equal(store.removeTopic(dir, '某科学进展').remaining, 0)
    const added = store.addTopic(dir, { topic: '第二个主题' })
    assert.equal(store.removeTopic(dir, added.topic.id).remaining, 0)
  })

  check('legacy day files migrate into runs', () => {
    const legacyDir = mkdtempSync(join(tmpdir(), 'watchlist-legacy-'))
    try {
      const digests = join(legacyDir, 'digests')
      mkdirSync(digests, { recursive: true })
      writeFileSync(join(digests, '2026-11-20.md'), '# 关注清单日报 2026-11-20\n\n## 旧主题\n\n- 摘要：旧数据\n', 'utf8')
      writeFileSync(
        join(digests, 'index.json'),
        JSON.stringify({ version: 1, entries: [{ at: '2026-11-20T01:00:00Z', day: '2026-11-20', topic: '旧主题', hasUpdate: true, summary: '旧数据', sources: [] }] }),
        'utf8',
      )
      store.ensureLayout(legacyDir)
      const runs = store.loadRuns(legacyDir)
      assert.equal(runs.length, 1)
      assert.equal(runs[0].id, 'run-20261120T000000Z')
      assert.ok(existsSync(join(digests, 'run-20261120T000000Z.md')))
      assert.equal(store.unreadCount(legacyDir), 1)
    } finally {
      rmSync(legacyDir, { recursive: true, force: true })
    }
  })
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (failures) {
  console.error(`\n${failures} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
