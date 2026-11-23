#!/usr/bin/env node
/**
 * Compatibility probe for this plugin against released DeepSeek Harness versions.
 *
 * For every version given it packs the current checkout, installs that tarball into a
 * throwaway profile under a throwaway DSH_HOME (the real one is never touched) and
 * checks that the bundle layer composes. With --runtime it also boots that profile's
 * web app on a free port and asks the plugin's own loopback API to answer, which is
 * the cheapest proof that the Host half actually mounted.
 *
 * Usage:
 *   node scripts/compat.mjs 0.2.2-rc.5
 *   node scripts/compat.mjs 0.2.2-rc.3 0.2.2-rc.4 0.2.2-rc.5 --runtime
 *
 * Exit code is non-zero when any version fails. Requires network access for npx.
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const argv = process.argv.slice(2)
const runtime = argv.includes('--runtime')
const versions = argv.filter((arg) => !arg.startsWith('--'))

if (versions.length === 0) {
  console.error('usage: node scripts/compat.mjs <dsh-version> [...] [--runtime]')
  process.exit(2)
}

const work = mkdtempSync(join(tmpdir(), 'watchlist-compat-'))
const results = []

function npx(version, args, env) {
  return execFileSync('npx', ['--yes', `@deepseek-ai/dsh@${version}`, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    timeout: 300000,
  })
}

/** Boot a profile, wait for its printed URL, ask the plugin API, then stop it. */
function probeRuntime(version, home) {
  return new Promise((resolvePromise) => {
    const child = spawn('npx', ['--yes', `@deepseek-ai/dsh@${version}`, '--profile', 'probe', '--no-open', '--port', '0'], {
      env: { ...process.env, DSH_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let settled = false
    let polling = false
    const finish = async (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 3000).unref()
      resolvePromise(result)
    }
    const timer = setTimeout(() => finish({ ok: false, detail: 'no URL printed in 90s' }), 90000)
    const onData = async (chunk) => {
      out += String(chunk)
      const match = out.match(/http:\/\/127\.0\.0\.1:(\d+)/)
      if (!match || polling) return
      polling = true
      // The URL is printed before every plugin row has mounted, so retry until the
      // plugin's own route answers with JSON instead of the SPA fallback.
      for (let attempt = 0; attempt < 40 && !settled; attempt += 1) {
        try {
          const response = await fetch(`http://127.0.0.1:${match[1]}/dsh-watchlist-api/state`, { signal: AbortSignal.timeout(5000) })
          const text = await response.text()
          if (text.trim().startsWith('{')) {
            const body = JSON.parse(text)
            return finish({ ok: body?.ok === true, detail: `HTTP ${response.status} ok=${body?.ok}` })
          }
        } catch {
          /* not up yet: keep trying */
        }
        await new Promise((done) => setTimeout(done, 1000))
      }
      finish({ ok: false, detail: 'plugin API never answered with JSON' })
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', () => finish({ ok: false, detail: 'exited before answering' }))
  })
}

try {
  const packed = execFileSync('npm', ['pack', '--pack-destination', work], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const tarball = join(work, packed.trim().split('\n').pop().trim())
  console.log(`tarball  ${tarball}\n`)

  for (const version of versions) {
    const home = join(work, `home-${version}`)
    mkdirSync(home, { recursive: true })
    const env = { DSH_HOME: home }
    const row = { version, cli: '', install: 'failed', layer: 'missing', runtime: runtime ? 'not run' : 'skipped' }
    try {
      row.cli = npx(version, ['--version'], env).trim().split('\n').pop()
      npx(version, ['plugin', '--profile', 'probe', 'add', tarball], env)
      row.install = 'ok'
      const dumped = npx(version, ['--profile', 'probe', '--dump-config'], env)
      if (dumped.includes(`# == ${manifest.name}`) && dumped.includes('- id: watchlist')) row.layer = 'ok'
      if (runtime && row.layer === 'ok') {
        // The profile needs the web app layer, otherwise there is no server to boot.
        npx(version, ['--profile', 'probe', '--from-default-profile', 'web', '--dump-config'], env)
        npx(version, ['plugin', '--profile', 'probe', 'add', tarball], env)
        const probe = await probeRuntime(version, home)
        row.runtime = probe.ok ? 'ok' : `failed (${probe.detail})`
      }
    } catch (error) {
      const text = String(error.stderr ?? error.message ?? error)
      row.install = /incompatible|rejected/i.test(text) ? 'refused (engines)' : 'failed'
      const first = text.split('\n').find((line) => /error|incompatible|rejected|timed? ?out/i.test(line)) ?? text.split('\n')[0]
      row.detail = String(first ?? '').slice(0, 140)
    }
    results.push(row)
    rmSync(home, { recursive: true, force: true })
  }

  const widths = { version: 16, cli: 16, install: 18, layer: 8, runtime: runtime ? 28 : 8 }
  const line = (cells) => cells.map((cell, index) => String(cell).padEnd(Object.values(widths)[index])).join('')
  console.log(line(Object.keys(widths).map((key) => key.toUpperCase())))
  for (const row of results) console.log(line([row.version, row.cli, row.install, row.layer, row.runtime]))
  if (results.some((row) => row.detail)) {
    console.log('')
    for (const row of results.filter((entry) => entry.detail)) console.log(`${row.version}: ${row.detail}`)
  }

  // A refusal is a verdict, not a failure: it means engines.dsh did its job for a
  // version outside the declared range. The table shows it either way.
  const failed = results.filter((row) => row.install === 'failed' || (row.install === 'ok' && row.layer !== 'ok') || row.runtime.startsWith('failed'))
  if (results.some((row) => row.install.startsWith('refused'))) {
    console.log(`\nrefused versions are outside ${JSON.stringify(manifest.engines?.dsh ?? 'any')}; widen engines.dsh only after they pass.`)
  }
  process.exit(failed.length ? 1 : 0)
} finally {
  rmSync(work, { recursive: true, force: true })
}
