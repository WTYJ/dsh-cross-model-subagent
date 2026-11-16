import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REPOSITORY,
  compareVersions,
  buildGitSpec,
  gitOriginOf,
  selfUpdateBlocker,
  checkForUpdate,
} from '../updating.js'
import {
  PACKAGE_NAME,
  sourceKind,
  isPinnedSpec,
  describeFailure,
  updateEligibility,
  applyUpdate,
  installedVersion,
} from '../updating-host.js'

const SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)
const MANIFEST_URL = 'https://raw.githubusercontent.com/WTYJ/dsh-cross-model-subagent/main/package.json'
const COMMIT_URL = 'https://api.github.com/repos/WTYJ/dsh-cross-model-subagent/commits/main'
// The manifest is read from the checked commit first; the raw CDN is the fallback.
const CONTENTS_URL = `https://api.github.com/repos/WTYJ/dsh-cross-model-subagent/contents/package.json?ref=${SHA}`
const GOOD_SPEC = `https://github.com/WTYJ/dsh-cross-model-subagent.git#${SHA}`

// ---- helpers (no network) --------------------------------------------------

function response({ ok = true, status = 200, body = '', headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok,
    status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    text: async () => text,
  }
}

function fakeFetch({ commit, manifest, contents } = {}) {
  return async url => {
    if (url === COMMIT_URL) {
      if (commit instanceof Error) throw commit
      return typeof commit === 'function' ? commit() : commit
    }
    if (url === CONTENTS_URL) {
      if (contents instanceof Error) throw contents
      if (contents !== undefined) return typeof contents === 'function' ? contents() : contents
      if (manifest !== undefined && !(manifest instanceof Error)) {
        const fileResponse = typeof manifest === 'function' ? manifest() : manifest
        // Serve whatever the caller's manifest says, base64-encoded like the contents API.
        return fileResponse.ok
          ? response({ body: { type: 'file', content: Buffer.from(await fileResponse.text()).toString('base64') } })
          : fileResponse
      }
      return response({ ok: false, status: 404 })
    }
    if (url === MANIFEST_URL) {
      if (manifest instanceof Error) throw manifest
      return typeof manifest === 'function' ? manifest() : manifest
    }
    return response({ ok: false, status: 404 })
  }
}

const commitBody = (sha = SHA, message = 'feat: ship it') =>
  response({ body: { sha, commit: { message, committer: { date: '2026-01-02T03:04:05Z' } } } })
const manifestBody = version =>
  response({ body: { version, dsh: { bundle: { patch: './cordis.patch.yml' } } } })

// A faithful fake of the DSH pluginManager surface used by updating-host.js.
function fakeManager({ bundles = [], updateResult, throws } = {}) {
  const calls = []
  return {
    calls,
    async listBundles() {
      return bundles
    },
    async updateBundle(name, version, options) {
      calls.push({ name, version, options })
      if (throws) throw throws
      return updateResult
    },
  }
}

// ---- updating.js -----------------------------------------------------------

test('compareVersions orders releases and prereleases', () => {
  assert.equal(compareVersions('2.1.0', '2.0.0'), 1)
  assert.equal(compareVersions('2.0.0', '2.1.0'), -1)
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0)
  assert.equal(compareVersions('2.0.0-beta.1', '2.0.0'), -1)
  assert.equal(compareVersions('2.0.0-beta.2', '2.0.0-beta.1'), 1)
  assert.equal(compareVersions('2.0.0-alpha', '2.0.0-beta'), -1)
  assert.equal(compareVersions('2.0.0', '2.0.0-rc.1'), 1)
  assert.equal(compareVersions('nope', '2.0.0'), null)
  assert.equal(compareVersions('2.0', '2.0.0'), null)
})

test('buildGitSpec pins a full sha and rejects short/non-hex input', () => {
  assert.equal(buildGitSpec(SHA), GOOD_SPEC)
  assert.equal(buildGitSpec(SHA.toUpperCase()), GOOD_SPEC)
  assert.throws(() => buildGitSpec('abc'), /40-character/)
  assert.throws(() => buildGitSpec('z'.repeat(40)), /40-character/)
})

test('gitOriginOf normalizes repository URL shapes', () => {
  const want = 'github.com/wtyj/dsh-cross-model-subagent'
  assert.equal(gitOriginOf('https://github.com/WTYJ/dsh-cross-model-subagent.git'), want)
  assert.equal(gitOriginOf('git+https://github.com/WTYJ/dsh-cross-model-subagent.git'), want)
  assert.equal(gitOriginOf('git+ssh://github.com/WTYJ/dsh-cross-model-subagent.git'), want)
  assert.equal(gitOriginOf('git@github.com:WTYJ/dsh-cross-model-subagent.git'), want)
  assert.equal(gitOriginOf(`${GOOD_SPEC}&path:`), want)
})

test('selfUpdateBlocker returns machine-readable codes', () => {
  assert.equal(selfUpdateBlocker({ kind: 'git', spec: REPOSITORY.git }, SHA), null)
  assert.equal(selfUpdateBlocker({ kind: 'link' }, SHA), 'link-install')
  assert.equal(selfUpdateBlocker({ kind: 'path' }, SHA), 'link-install')
  assert.equal(selfUpdateBlocker({ kind: 'registry' }, SHA), 'unmanaged-source')
  assert.equal(selfUpdateBlocker({ kind: 'git' }, SHA), 'unmanaged-source')
  assert.equal(selfUpdateBlocker({ kind: 'git', spec: 'https://github.com/x/y.git' }, SHA), 'foreign-origin')
  assert.equal(selfUpdateBlocker({ kind: 'git', spec: REPOSITORY.git }, null), 'no-commit')
})

test('checkForUpdate ready: managed git install yields compliant pinned spec', async () => {
  const r = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({ commit: commitBody(), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(r.status, 'ready')
  assert.equal(r.latestVersion, '2.1.0')
  assert.equal(r.latestCommit, SHA)
  assert.equal(r.canSelfUpdate, true)
  assert.equal(r.spec, GOOD_SPEC)
  assert.equal(r.notes, 'feat: ship it')
  assert.equal(r.installedSource.kind, 'git')
  assert.ok(Array.isArray(r.fetchAttempts) && r.fetchAttempts.length === 2)
})

test('checkForUpdate up-to-date and ahead', async () => {
  const same = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({ commit: commitBody(), manifest: manifestBody('2.0.0') }),
  })
  assert.equal(same.status, 'up-to-date')
  assert.equal(same.spec, null, 'no install spec when nothing is newer')

  const ahead = await checkForUpdate({
    currentVersion: '2.5.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({ commit: commitBody(), manifest: manifestBody('2.0.0') }),
  })
  assert.equal(ahead.status, 'ahead')
  assert.equal(ahead.spec, null)
})

test('checkForUpdate unknown-version keeps canSelfUpdate false', async () => {
  const r = await checkForUpdate({
    currentVersion: 'stable',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({ commit: commitBody(), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(r.status, 'unknown-version')
  assert.equal(r.canSelfUpdate, false)
  assert.match(r.reason, /semantic version/)
})

test('checkForUpdate error paths are structured, never thrown', async () => {
  const notFound = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    // GitHub answers 404 for an absent branch and 409 for an empty repository:
    // both mean nothing is published yet, so the check reports 'empty'.
    fetchImpl: fakeFetch({ commit: response({ ok: false, status: 404 }), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(notFound.status, 'empty')
  assert.equal(notFound.fetchAttempts[0].status, 404)

  const serverError = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({ commit: response({ ok: false, status: 500 }), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(serverError.status, 'error')
  assert.equal(serverError.fetchAttempts[0].status, 500)

  const network = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({ commit: new TypeError('boom'), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(network.status, 'error')
  assert.equal(network.fetchAttempts[0].problem, 'network')
  assert.ok(!/\bat .*:\d+/.test(network.reason), 'no stack frames in reason')

  const big = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({ commit: response({ body: 'x'.repeat(1024 * 1024 + 16) }), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(big.fetchAttempts[0].problem, 'body-too-large')

  const noBundle = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({ commit: commitBody(), manifest: response({ body: { version: '2.1.0' } }) }),
  })
  // Both manifest locations carry the same bundle-less file, so both reject it.
  assert.equal(noBundle.status, 'error')
  assert.deepEqual(noBundle.fetchAttempts.slice(1).map(attempt => attempt.problem), ['no-manifest', 'missing-version'])
})

test('checkForUpdate aborts cleanly under an already-aborted external signal', async () => {
  const controller = new AbortController()
  controller.abort()
  const r = await checkForUpdate({
    currentVersion: '2.0.0',
    signal: controller.signal,
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: async (url, init) => {
      init?.signal?.throwIfAborted()
      return response({ body: {} })
    },
  })
  assert.equal(r.status, 'error')
  assert.equal(r.canSelfUpdate, false)
})

test('checkForUpdate keeps canSelfUpdate false for link/foreign/missing source', async () => {
  const link = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'link', spec: 'file:../x' },
    fetchImpl: fakeFetch({ commit: commitBody(), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(link.canSelfUpdate, false)
  assert.match(link.reason, /migration/)

  const foreign = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: 'https://github.com/someone/else.git' },
    fetchImpl: fakeFetch({ commit: commitBody(), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(foreign.canSelfUpdate, false)
  assert.match(foreign.reason, /expected repository/)

  const missing = await checkForUpdate({
    currentVersion: '2.0.0',
    fetchImpl: fakeFetch({ commit: commitBody(), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(missing.installedSource.kind, 'unknown')
  assert.equal(missing.canSelfUpdate, false)
})

// ---- updating-host.js: sourceKind ------------------------------------------

test('sourceKind classifies profile dependency values', () => {
  assert.equal(sourceKind('link:../x'), 'link')
  assert.equal(sourceKind('file:../x'), 'link')
  assert.equal(sourceKind('C:\\work\\plugin'), 'path')
  assert.equal(sourceKind('/usr/local/plugin'), 'path')
  assert.equal(sourceKind('github:WTYJ/repo'), 'git')
  assert.equal(sourceKind('git+https://github.com/WTYJ/repo.git'), 'git')
  assert.equal(sourceKind('git@github.com:WTYJ/repo.git'), 'git')
  assert.equal(sourceKind(GOOD_SPEC), 'git')
  assert.equal(sourceKind('^2.1.0'), 'registry')
  assert.equal(sourceKind(''), 'unknown')
  assert.equal(sourceKind(undefined), 'unknown')
})

// ---- updating-host.js: isPinnedSpec ----------------------------------------

test('isPinnedSpec accepts a full pinned commit of this repo only', () => {
  assert.equal(isPinnedSpec(GOOD_SPEC), true)
  assert.equal(isPinnedSpec(`https://github.com/WTYJ/dsh-cross-model-subagent.git#${'abc'}`), false)
  assert.equal(isPinnedSpec('https://github.com/WTYJ/dsh-cross-model-subagent.git'), false)
  assert.equal(isPinnedSpec('https://github.com/other/repo.git#' + SHA), false)
  assert.equal(isPinnedSpec(REPOSITORY.git + '#not-a-sha'), false)
  assert.equal(isPinnedSpec(undefined), false)
})

// ---- updating-host.js: updateEligibility ----------------------------------

test('updateEligibility maps blocker codes', () => {
  assert.deepEqual(updateEligibility({ kind: 'git', spec: REPOSITORY.git }, SHA), { ok: true, code: null })
  assert.deepEqual(updateEligibility({ kind: 'link' }, SHA), { ok: false, code: 'link-install' })
})

// ---- updating-host.js: describeFailure ------------------------------------

test('describeFailure maps known codes and falls back safely', () => {
  assert.match(describeFailure({ error: { code: 'invalid-spec' } }), /valid pinned commit/)
  assert.match(describeFailure({ error: { code: 'incompatible-version' } }), /DSH version/)
  assert.equal(describeFailure({ error: { code: 'mystery', diagnostic: 'line one\nline two' } }), 'line one')
  assert.equal(describeFailure({ error: {} }), 'The update failed.')
  assert.equal(describeFailure(undefined), 'The update did not complete.')
})

// ---- updating-host.js: applyUpdate ----------------------------------------

test('applyUpdate forwards a valid pinned spec to manager.updateBundle', async () => {
  const manager = fakeManager({
    updateResult: {
      from: '2.0.0',
      to: '2.1.0',
      step: 'install',
      result: { application: 'applied', stage: 'install', target: PACKAGE_NAME },
    },
  })
  const out = await applyUpdate(manager, { version: '2.1.0', spec: GOOD_SPEC, requestId: 'req-1' })
  assert.equal(manager.calls.length, 1)
  assert.equal(manager.calls[0].name, PACKAGE_NAME)
  assert.equal(manager.calls[0].version, '2.1.0')
  assert.equal(manager.calls[0].options.spec, GOOD_SPEC)
  assert.equal(manager.calls[0].options.requestId, 'req-1')
  assert.equal(out.ok, true)
  assert.equal(out.from, '2.0.0')
  assert.equal(out.to, '2.1.0')
  assert.equal(out.application, 'applied')
})

test('applyUpdate rejects a missing or unpinned spec before calling manager', async () => {
  const manager = fakeManager({})
  const bad = await applyUpdate(manager, { version: '2.1.0', spec: 'https://github.com/WTYJ/dsh-cross-model-subagent.git' })
  assert.equal(bad.ok, false)
  assert.equal(manager.calls.length, 0, 'must not call updateBundle without a pinned spec')
})

test('applyUpdate reports restart-required and failure with readable messages', async () => {
  const restart = await applyUpdate(
    fakeManager({ updateResult: { from: '2.0.0', to: '2.1.0', step: 'install', result: { application: 'restart-required', restartReason: 'no-hmr' } } }),
    { version: '2.1.0', spec: GOOD_SPEC },
  )
  assert.equal(restart.ok, true)
  assert.equal(restart.application, 'restart-required')
  assert.match(restart.message, /restart DSH/)

  const failed = await applyUpdate(
    fakeManager({ updateResult: { from: '2.0.0', to: '2.1.0', step: 'install', result: { application: 'failed', error: { code: 'invalid-spec' } } } }),
    { version: '2.1.0', spec: GOOD_SPEC },
  )
  assert.equal(failed.ok, false)
  assert.match(failed.message, /valid pinned commit/)
})

test('applyUpdate swallows a thrown manager error into a failure result', async () => {
  const out = await applyUpdate(fakeManager({ throws: new Error('network down') }), { version: '2.1.0', spec: GOOD_SPEC })
  assert.equal(out.ok, false)
  assert.equal(out.application, 'failed')
  assert.match(out.message, /network down/)
})

// ---- updating-host.js: installedVersion ------------------------------------

test('installedVersion reads the real package.json beside the module', () => {
  const v = installedVersion()
  assert.match(v, /^\d+\.\d+\.\d+/)
})
