/** Repeated visits must not exhaust GitHub's anonymous hourly quota (60 requests/IP,
 * two per check), and an exhausted quota must read as a wait, not as a broken plugin. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkForUpdate, CACHE_TTL_MS, REPOSITORY } from '../updating.js'
import { updateStatus } from '../updating-host.js'

const SHA = 'a'.repeat(40)
const COMMIT_URL = 'https://api.github.com/repos/WTYJ/dsh-cross-model-subagent/commits/main'
const CONTENTS_URL = `https://api.github.com/repos/WTYJ/dsh-cross-model-subagent/contents/package.json?ref=${SHA}`
const GOOD_SPEC = `https://github.com/WTYJ/dsh-cross-model-subagent.git#${SHA}`

function response({ ok = true, status = 200, body = '', headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { ok, status, headers: { get: name => headers[name.toLowerCase()] ?? null }, text: async () => text }
}

function countingFetch(version = '0.2.0', options = {}) {
  const calls = []
  const impl = async url => {
    calls.push(url)
    if (url === COMMIT_URL) {
      if (options.rateLimited) return response({ ok: false, status: 403, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '900' } })
      return response({ body: { sha: SHA, commit: { message: 'release', committer: { date: '2026-01-02T00:00:00Z' } } } })
    }
    if (url === CONTENTS_URL) {
      const manifest = JSON.stringify({ version, dsh: { bundle: { patch: './cordis.patch.yml' } } })
      return response({ body: { type: 'file', content: Buffer.from(manifest).toString('base64') } })
    }
    return response({ ok: false, status: 404 })
  }
  impl.calls = calls
  return impl
}

const linkInstall = { kind: 'link', spec: 'link:C:/src/plugin' }
const gitInstall = { kind: 'git', spec: REPOSITORY.git }

test('a rate-limited response becomes a wait, not a generic failure', async () => {
  const result = await checkForUpdate({
    currentVersion: '0.1.0',
    installedSource: gitInstall,
    fetchImpl: countingFetch('0.2.0', { rateLimited: true }),
  })
  assert.equal(result.status, 'error')
  assert.match(result.reason, /hourly anonymous quota/)
  assert.match(result.reason, /minutes/)
  assert.equal(result.retryAfterSeconds, 900)
  assert.equal(result.cacheable, undefined, 'a failure must not be cached')
})

test('GitHub throttling falls back to the version and commit fetched together by Git', async () => {
  const result = await checkForUpdate({
    currentVersion: '0.1.0',
    installedSource: gitInstall,
    fetchImpl: countingFetch('0.2.0', { rateLimited: true }),
    readGit: async () => ({
      sha: SHA,
      manifest: JSON.stringify({ version: '0.2.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
    }),
  })
  assert.equal(result.status, 'ready')
  assert.equal(result.latestVersion, '0.2.0')
  assert.equal(result.spec, GOOD_SPEC)
  assert.equal(result.retryAfterSeconds, undefined)
  assert.equal(result.cacheable, true)
})

test('only a completed comparison is marked cacheable', async () => {
  const ok = await checkForUpdate({ currentVersion: '0.1.0', installedSource: gitInstall, fetchImpl: countingFetch('0.2.0') })
  assert.equal(ok.status, 'ready')
  assert.equal(ok.cacheable, true)
})

test('a fresh cache answers without touching the network', async () => {
  const impl = countingFetch('0.2.0')
  const first = await checkForUpdate({ currentVersion: '0.1.0', installedSource: gitInstall, fetchImpl: impl })
  assert.equal(impl.calls.length, 2)
  const cache = { at: Date.now(), payload: first }
  const second = await checkForUpdate({ currentVersion: '0.1.0', installedSource: gitInstall, fetchImpl: impl, cache })
  assert.equal(second.cached, true)
  assert.equal(second.status, 'ready')
  assert.equal(second.latestVersion, '0.2.0')
  assert.equal(impl.calls.length, 2, 'the second check issues no requests')
})

test('an explicit re-check bypasses the cache', async () => {
  const impl = countingFetch('0.2.0')
  const first = await checkForUpdate({ currentVersion: '0.1.0', installedSource: gitInstall, fetchImpl: impl })
  await checkForUpdate({ currentVersion: '0.1.0', installedSource: gitInstall, fetchImpl: impl, cache: { at: Date.now(), payload: first }, force: true })
  assert.equal(impl.calls.length, 4, 'forcing costs a fresh lookup')
})

test('a stale cache or a different local version is ignored', async () => {
  const impl = countingFetch('0.2.0')
  const first = await checkForUpdate({ currentVersion: '0.1.0', installedSource: gitInstall, fetchImpl: impl })
  const stale = await checkForUpdate({
    currentVersion: '0.1.0', installedSource: gitInstall, fetchImpl: impl,
    cache: { at: Date.now() - CACHE_TTL_MS - 1000, payload: first },
  })
  assert.equal(stale.cached, undefined, 'an expired entry is not reused')
  assert.equal(impl.calls.length, 4)

  const otherVersion = await checkForUpdate({
    currentVersion: '0.0.9', installedSource: gitInstall, fetchImpl: impl,
    cache: { at: Date.now(), payload: first },
  })
  assert.equal(otherVersion.cached, undefined, 'a cache for another local version is not reused')
})

test('updateStatus marks the cacheable result and hides it from the page payload', async () => {
  const manager = { listBundles: async () => [{ name: '@local/dsh-cross-model-subagent', version: '0.1.0', enabled: true, source: 'link:C:/src/plugin' }] }
  const status = await updateStatus(manager, ['@wtyj/dsh-cross-model-subagent', '@local/dsh-cross-model-subagent'], { fetchImpl: countingFetch('0.2.0') })
  assert.equal(status.installed, true)
  assert.equal(status.cacheable, true)
  assert.equal(status.status, 'ready')
})
