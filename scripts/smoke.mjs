#!/usr/bin/env node
/**
 * 无 Harness 也能跑的逻辑自检：验证清单增删、设置合并、日报追加。
 * 用法：node scripts/smoke.mjs
 */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
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

  check('list returns stored topics', () => {
    const topics = store.loadTopics(dir)
    assert.equal(topics.length, 1)
    assert.equal(topics[0].topic, '某科学进展')
    assert.deepEqual(topics[0].keywords, ['关键词A'])
  })

  check('settings merge defaults with patch and clamp', () => {
    const s1 = store.normalizeSettings({ lookbackDays: 1000, schedule: { time: '9:00' } })
    assert.equal(s1.lookbackDays, 90)
    assert.equal(s1.schedule.time, '08:30')
    const file = store.paths(dir).settings
    store.saveSettings(dir, { lookbackDays: 3, push: { channels: ['session', 'macos'] } })
    const s2 = store.loadSettings(dir, { lookbackDays: 7 })
    assert.equal(s2.lookbackDays, 3)
    assert.deepEqual(s2.push.channels, ['session', 'macos'])
    assert.ok(JSON.parse(readFileSync(file, 'utf8')).lookbackDays === 3)
  })

  check('record appends digest sections', () => {
    const r1 = store.recordDigest(dir, {
      timeZone: 'Asia/Shanghai',
      topic: '某科学进展',
      hasUpdate: true,
      summary: '出现新论文',
      sources: ['论文 - https://example.com/a'],
    })
    assert.equal(r1.dayTotal, 1)
    const r2 = store.recordDigest(dir, {
      timeZone: 'Asia/Shanghai',
      topic: '某科学进展',
      hasUpdate: false,
      summary: '无新进展',
      sources: [],
    })
    assert.equal(r2.dayTotal, 2)
    const text = readFileSync(r1.path, 'utf8')
    assert.match(text, /^# 关注清单日报 \d{4}-\d{2}-\d{2}/)
    assert.equal((text.match(/^## /gm) ?? []).length, 2)
  })

  check('remove by name, then by id', () => {
    assert.equal(store.removeTopic(dir, '某科学进展').remaining, 0)
    const added = store.addTopic(dir, { topic: '第二个主题' })
    assert.equal(store.removeTopic(dir, added.topic.id).remaining, 0)
  })

  check('remove misses return null', () => {
    const r = store.removeTopic(dir, '不存在')
    assert.equal(r.removed, null)
  })
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (failures) {
  console.error(`\n${failures} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
