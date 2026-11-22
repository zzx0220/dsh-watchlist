#!/usr/bin/env node
/**
 * Logic self-check that needs no Harness: topic add/remove, settings merge,
 * per-run records and migration.
 * Usage: node scripts/smoke.mjs
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
    const r = store.addTopic(dir, { topic: 'Some scientific advance', keywords: ['keyword-a'], note: 'look for new papers' })
    assert.equal(r.created, true)
    assert.equal(r.total, 1)
    assert.match(r.topic.id, /^t_[0-9a-f]{8}$/)
  })

  check('add dedupes by normalized name', () => {
    const r = store.addTopic(dir, { topic: '  Some scientific advance  ' })
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

  check('dropped push channels are filtered out', () => {
    const mixed = store.normalizeSettings({ push: { channels: ['wechat', 'macos', 'nope'] } })
    assert.deepEqual(mixed.push.channels, ['macos'])
    const gone = store.normalizeSettings({ push: { channels: ['wechat'] } })
    assert.deepEqual(gone.push.channels, ['session'])
  })

  check('topics keep their own cadence', () => {
    const cadenceDir = mkdtempSync(join(tmpdir(), 'watchlist-cadence-'))
    try {
      const daily = store.addTopic(cadenceDir, { topic: 'Daily topic', everyDays: 1 })
      const weekly = store.addTopic(cadenceDir, { topic: 'Weekly topic', everyDays: 7 })
      assert.equal(daily.topic.everyDays, 1)
      assert.equal(weekly.topic.everyDays, 7)
      // Never checked: both count as due
      assert.equal(store.dueTopics(cadenceDir, 1).length, 2)
      store.touchTopics(cadenceDir, [daily.topic.id])
      const due = store.dueTopics(cadenceDir, 1)
      assert.ok(!due.some((t) => t.id === daily.topic.id), 'a daily topic just checked must not be due')
      assert.ok(due.some((t) => t.id === weekly.topic.id), 'a weekly topic never checked must be due')
    } finally {
      rmSync(cadenceDir, { recursive: true, force: true })
    }
  })

  check('updateTopic changes cadence and clears it', () => {
    const updateDir = mkdtempSync(join(tmpdir(), 'watchlist-update-'))
    try {
      const added = store.addTopic(updateDir, { topic: 'Topic with an editable interval' })
      assert.equal(added.topic.everyDays, null)
      const weekly = store.updateTopic(updateDir, added.topic.id, { everyDays: 7 })
      assert.equal(weekly.everyDays, 7)
      const cleared = store.updateTopic(updateDir, 'Topic with an editable interval', { everyDays: null })
      assert.equal(cleared.everyDays, null)
      assert.equal(store.updateTopic(updateDir, 'does not exist', { everyDays: 1 }), null)
    } finally {
      rmSync(updateDir, { recursive: true, force: true })
    }
  })

  check('a run writes into the day report', () => {
    const from = new Date(Date.now() - 5 * 86400000).toISOString()
    const day = store.dayStamp('Asia/Shanghai')
    const run = store.startRun(dir, { from })
    assert.match(run.id, /^run-\d{8}T\d{6}Z$/)
    assert.equal(run.day, day)
    assert.equal(run.seq, 1)
    const r1 = store.appendRunEntry(dir, { topic: 'Some scientific advance', hasUpdate: true, summary: 'new paper', sources: ['paper - https://example.com/a'] })
    assert.equal(r1.runTotal, 1)
    assert.equal(r1.dayTotal, 1)
    assert.equal(r1.path, join(dir, 'digests', `day-${day}.md`))
    const r2 = store.appendRunEntry(dir, { topic: 'Some scientific advance', hasUpdate: false, summary: 'no further progress', sources: [] })
    assert.equal(r2.runTotal, 2)
    assert.equal(r2.path, r1.path)
    const text = readFileSync(r2.path, 'utf8')
    assert.match(text, /^# 关注清单日报 \d{4}-\d{2}-\d{2}$/m)
    assert.match(text, /^## 第 1 次巡检 \d{2}:\d{2}$/m)
    assert.match(text, /覆盖区间：/)
    assert.equal((text.match(/^## /gm) ?? []).length, 1)
    assert.equal((text.match(/^### /gm) ?? []).length, 2)
    assert.equal(store.listRuns(dir).length, 1)
  })

  check('a second run today appends to the same day file', () => {
    store.closeCurrentRun(dir)
    const day = store.dayStamp('Asia/Shanghai')
    const run = store.startRun(dir, {})
    assert.equal(run.seq, 2)
    const r1 = store.appendRunEntry(dir, { topic: 'Some scientific advance', hasUpdate: false, summary: 'catch-up', sources: [] })
    assert.equal(r1.dayTotal, 3)
    const runs = store.listRuns(dir)
    assert.equal(runs.length, 2)
    assert.equal(runs[0].id, run.id)
    assert.equal(runs[0].path, runs[1].path, 'both runs share the day file')
    assert.equal(r1.path, join(dir, 'digests', `day-${day}.md`))
    const text = readFileSync(r1.path, 'utf8')
    assert.equal((text.match(/^## /gm) ?? []).length, 2, 'one section per run')
    assert.match(text, /^## 第 2 次巡检 /m)
    assert.equal((text.match(/^# 关注清单日报 /gm) ?? []).length, 1, 'one day header only')
  })

  check('the day is frozen when the run starts, not when it records', () => {
    const lateDir = mkdtempSync(join(tmpdir(), 'watchlist-day-'))
    try {
      const run = store.startRun(lateDir, { from: null, day: '2026-01-01' })
      assert.equal(run.day, '2026-01-01')
      assert.equal(run.file, 'day-2026-01-01.md')
      const r = store.appendRunEntry(lateDir, { topic: 'Topic A', hasUpdate: false, summary: 'x', day: '2026-01-02' })
      // The run keeps its own day even if the caller passes a later one.
      assert.equal(r.path, join(lateDir, 'digests', 'day-2026-01-01.md'))
      assert.equal(r.day, '2026-01-01')
      assert.equal(store.listRuns(lateDir)[0].day, '2026-01-01')
    } finally {
      rmSync(lateDir, { recursive: true, force: true })
    }
  })

  check('a record without a brief opens its own run and day file', () => {
    const directDir = mkdtempSync(join(tmpdir(), 'watchlist-direct-'))
    try {
      const day = store.dayStamp('Asia/Shanghai')
      const r = store.appendRunEntry(directDir, { topic: 'Topic B', hasUpdate: true, summary: 'y' })
      assert.equal(r.day, day)
      assert.equal(r.path, join(directDir, 'digests', `day-${day}.md`))
      assert.equal(store.listRuns(directDir).length, 1)
    } finally {
      rmSync(directDir, { recursive: true, force: true })
    }
  })

  check('unread counts entries after last seen', () => {
    assert.equal(store.unreadCount(dir), 3)
    assert.equal(store.unreadUpdateCount(dir), 1, 'only the entry with progress badges the nav')
    store.markSeen(dir)
    assert.equal(store.unreadCount(dir), 0)
    assert.equal(store.unreadUpdateCount(dir), 0)
  })

  check('reading one report marks only that report', () => {
    const readDir = mkdtempSync(join(tmpdir(), 'watchlist-read-'))
    try {
      const first = store.appendRunEntry(readDir, { topic: 'Topic A', hasUpdate: true, summary: 'a' })
      store.closeCurrentRun(readDir)
      const second = store.appendRunEntry(readDir, { topic: 'Topic B', hasUpdate: true, summary: 'b' })
      assert.deepEqual(store.unseenRunIds(readDir).sort(), [first.runId, second.runId].sort())
      assert.equal(store.unreadUpdateCount(readDir), 2)
      store.markRunSeen(readDir, second.runId)
      assert.deepEqual(store.unseenRunIds(readDir), [first.runId], 'the other report stays unread')
      assert.equal(store.unreadUpdateCount(readDir), 1)
      store.markRunSeen(readDir, first.runId)
      assert.deepEqual(store.unseenRunIds(readDir), [])
      assert.equal(store.unreadUpdateCount(readDir), 0)
    } finally {
      rmSync(readDir, { recursive: true, force: true })
    }
  })

  check('a report can be put back to unread, one or all', () => {
    const backDir = mkdtempSync(join(tmpdir(), 'watchlist-unread-'))
    try {
      const first = store.appendRunEntry(backDir, { topic: 'Topic A', hasUpdate: true, summary: 'a' })
      store.closeCurrentRun(backDir)
      const second = store.appendRunEntry(backDir, { topic: 'Topic B', hasUpdate: true, summary: 'b' })
      store.markSeen(backDir)
      assert.deepEqual(store.unseenRunIds(backDir), [])
      store.markRunUnseen(backDir, second.runId)
      assert.deepEqual(store.unseenRunIds(backDir), [second.runId], 'only the toggled report goes back')
      assert.equal(store.unreadUpdateCount(backDir), 1)
      store.markRunUnseen(backDir, first.runId)
      assert.equal(store.unseenRunIds(backDir).length, 2, 'each report toggles on its own')
      store.markSeen(backDir)
      assert.deepEqual(store.unseenRunIds(backDir), [])
      store.markAllUnseen(backDir)
      assert.equal(store.unseenRunIds(backDir).length, 2, 'mark all unread covers every report')
      store.markSeen(backDir)
      assert.deepEqual(store.unseenRunIds(backDir), [])
    } finally {
      rmSync(backDir, { recursive: true, force: true })
    }
  })

  check('an old state seeds read reports from its timestamp', () => {
    const legacySeenDir = mkdtempSync(join(tmpdir(), 'watchlist-seen-'))
    try {
      const first = store.appendRunEntry(legacySeenDir, { topic: 'Old', hasUpdate: true, summary: 'a' })
      store.closeCurrentRun(legacySeenDir)
      // Pretend anything started at or before this instant was already read, the
      // pre-seenRunIds rule. The boundary is the first run's own stamp, so the test
      // does not depend on two records landing in different milliseconds.
      const boundary = store.loadRuns(legacySeenDir)[0].startedAt
      store.saveState(legacySeenDir, { lastSeenAt: boundary })
      assert.deepEqual(store.unseenRunIds(legacySeenDir), [], 'the old boundary still applies')
      const until = Date.now() + 5
      while (Date.now() < until) { /* let the next run start after the boundary */ }
      const second = store.appendRunEntry(legacySeenDir, { topic: 'New', hasUpdate: true, summary: 'b' })
      assert.deepEqual(store.unseenRunIds(legacySeenDir), [second.runId])
      // The first per-report write must not resurrect the run the old boundary covered.
      store.markRunSeen(legacySeenDir, second.runId)
      assert.deepEqual(store.unseenRunIds(legacySeenDir), [], `run ${first.runId} must stay read`)
    } finally {
      rmSync(legacySeenDir, { recursive: true, force: true })
    }
  })

  check('a record can carry importance, and every entry gets an id', () => {
    const impDir = mkdtempSync(join(tmpdir(), 'watchlist-importance-'))
    try {
      store.startRun(impDir, {})
      const high = store.appendRunEntry(impDir, { topic: 'Big news', hasUpdate: true, importance: 'high', summary: 'major' })
      assert.match(high.entryId, /^e_[0-9a-f]{8}$/)
      store.appendRunEntry(impDir, { topic: 'Small news', hasUpdate: true, summary: 'minor' })
      const entries = store.loadRuns(impDir)[0].entries
      assert.equal(entries[0].id, high.entryId)
      assert.equal(entries[0].importance, 'high')
      assert.equal(entries[1].importance, 'normal', 'a record without importance is ordinary news')
      const text = readFileSync(high.path, 'utf8')
      assert.equal((text.match(/^- 重要：是$/gm) ?? []).length, 1, 'only the important entry is marked in the report')
      // An unknown importance value must not leak into the store, but a near miss
      // (boolean true, upper case) still means what the caller meant.
      const odd = store.appendRunEntry(impDir, { topic: 'Odd', hasUpdate: true, importance: 'urgent', summary: 'x' })
      assert.equal(store.loadRuns(impDir)[0].entries.find((entry) => entry.id === odd.entryId).importance, 'normal')
      assert.equal(store.normalizeImportance(true), 'high')
      assert.equal(store.normalizeImportance('HIGH'), 'high')
      assert.equal(store.normalizeImportance(' high '), 'high')
    } finally {
      rmSync(impDir, { recursive: true, force: true })
    }
  })

  check('records written before entry ids get a stable derived id', () => {
    const legacyEntryDir = mkdtempSync(join(tmpdir(), 'watchlist-entryid-'))
    try {
      mkdirSync(join(legacyEntryDir, 'digests'), { recursive: true })
      writeFileSync(
        join(legacyEntryDir, 'digests', 'runs.json'),
        JSON.stringify({
          version: 1,
          runs: [
            {
              id: 'run-20260101T000000Z',
              day: '2026-01-01',
              startedAt: '2026-01-01T00:00:00Z',
              entries: [{ at: '2026-01-01T00:00:00Z', topic: 'Old', hasUpdate: true, summary: 'old', sources: [] }],
            },
          ],
        }),
        'utf8',
      )
      const runs = store.loadRuns(legacyEntryDir)
      assert.equal(runs[0].entries[0].id, 'run-20260101T000000Z:0')
      assert.equal(runs[0].entries[0].importance, 'normal')
      // Reading twice must produce the same id: stars point at it.
      assert.equal(store.loadRuns(legacyEntryDir)[0].entries[0].id, 'run-20260101T000000Z:0')
    } finally {
      rmSync(legacyEntryDir, { recursive: true, force: true })
    }
  })

  check('a star names one entry and survives reading the report', () => {
    const starDir = mkdtempSync(join(tmpdir(), 'watchlist-star-'))
    try {
      const first = store.appendRunEntry(starDir, { topic: 'Topic A', hasUpdate: true, summary: 'a' })
      store.appendRunEntry(starDir, { topic: 'Topic B', hasUpdate: true, summary: 'b' })
      const result = store.setStar(starDir, first.runId, first.entryId, true)
      assert.equal(result.starred, true)
      assert.deepEqual(store.starredIds(starDir), [first.entryId])
      assert.equal(store.starredCount(starDir), 1)
      store.markSeen(starDir)
      assert.deepEqual(store.starredIds(starDir), [first.entryId], 'a read report keeps its star')
      assert.equal(store.setStar(starDir, first.runId, 'e_missing', true), null, 'an unknown entry cannot be starred')
      store.setStar(starDir, first.runId, first.entryId, false)
      assert.deepEqual(store.starredIds(starDir), [])
    } finally {
      rmSync(starDir, { recursive: true, force: true })
    }
  })

  check('highlights are unread important entries plus every star', () => {
    const bandDir = mkdtempSync(join(tmpdir(), 'watchlist-band-'))
    try {
      const high = store.appendRunEntry(bandDir, { topic: 'Major', hasUpdate: true, importance: 'high', summary: 'm' })
      const normal = store.appendRunEntry(bandDir, { topic: 'Minor', hasUpdate: true, summary: 'n' })
      let band = store.highlights(bandDir)
      assert.deepEqual(band.map((item) => item.topic), ['Major'], 'an ordinary entry is not news')
      assert.equal(band[0].entryId, high.entryId)
      assert.equal(band[0].unread, true)
      store.setStar(bandDir, normal.runId, normal.entryId, true)
      band = store.highlights(bandDir)
      assert.deepEqual(band.map((item) => item.topic).sort(), ['Major', 'Minor'])
      store.markSeen(bandDir)
      band = store.highlights(bandDir)
      assert.deepEqual(band.map((item) => item.topic), ['Minor'], 'reading retires the agent flag, not the star')
      store.setStar(bandDir, normal.runId, normal.entryId, false)
      assert.deepEqual(store.highlights(bandDir), [])
    } finally {
      rmSync(bandDir, { recursive: true, force: true })
    }
  })

  check('counters count unread important entries apart from progress', () => {
    const countDir = mkdtempSync(join(tmpdir(), 'watchlist-count-'))
    try {
      store.appendRunEntry(countDir, { topic: 'X', hasUpdate: true, importance: 'high', summary: 'x' })
      store.appendRunEntry(countDir, { topic: 'Y', hasUpdate: true, summary: 'y' })
      const counts = store.counters(countDir)
      assert.equal(counts.unreadUpdates, 2)
      assert.equal(counts.unreadImportant, 1)
      store.markSeen(countDir)
      assert.equal(store.counters(countDir).unreadImportant, 0)
    } finally {
      rmSync(countDir, { recursive: true, force: true })
    }
  })

  check('remove by name, then by id', () => {
    assert.equal(store.removeTopic(dir, 'Some scientific advance').remaining, 0)
    const added = store.addTopic(dir, { topic: 'Second topic' })
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
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed')
