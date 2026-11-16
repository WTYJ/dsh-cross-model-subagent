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

const SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)
const MANIFEST_URL = 'https://raw.githubusercontent.com/WTYJ/dsh-cross-model-subagent/main/package.json'
const COMMIT_URL = 'https://api.github.com/repos/WTYJ/dsh-cross-model-subagent/commits/main'
// The manifest is read from the commit's own tree first, so a filtered network never blocks it.
const CONTENTS_URL = `https://api.github.com/repos/WTYJ/dsh-cross-model-subagent/contents/package.json?ref=${SHA}`

// Small response helper matching the subset of the fetch Response API used.
function response({ ok = true, status = 200, body = '', headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok,
    status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    text: async () => text,
  }
}

/** Wrap a manifest response body as the contents API returns it (base64 in `content`). */
function asContents(fileResponse) {
  return response({
    body: {
      type: 'file',
      content: Buffer.from(JSON.stringify(fileResponse.body)).toString('base64'),
    },
  })
}

// Build a fetchImpl that answers the commit and manifest endpoints separately.
// The raw CDN is answered only when `manifest` is given, so a caller can exercise
// the contents-API fallback by leaving it out.
function fakeFetch({ commit, manifest, contents, onRequest } = {}) {
  return async (url, init) => {
    onRequest?.({ url, init })
    if (url === COMMIT_URL) {
      if (commit instanceof Error) throw commit
      return typeof commit === 'function' ? commit() : commit
    }
    if (url === CONTENTS_URL) {
      if (contents instanceof Error) throw contents
      if (contents !== undefined) return typeof contents === 'function' ? contents() : contents
      // Default: serve the same manifest body the raw CDN would, as the contents API does.
      if (manifest !== undefined && !(manifest instanceof Error)) {
        const fileResponse = typeof manifest === 'function' ? manifest() : manifest
        return fileResponse.ok ? asContents({ ...fileResponse, body: JSON.parse(await fileResponse.text()) }) : fileResponse
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

const commitBody = (sha = SHA, message = 'feat: ship it', date = '2026-01-02T03:04:05Z') =>
  response({ body: { sha, commit: { message, committer: { date } } } })
const manifestBody = version => response({ body: { version, dsh: { bundle: { patch: './cordis.patch.yml' } } } })

test('compareVersions orders releases and prereleases', () => {
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0)
  assert.equal(compareVersions('2.0.1', '2.0.0'), 1)
  assert.equal(compareVersions('1.9.9', '2.0.0'), -1)
  assert.equal(compareVersions('2.0.0-beta.1', '2.0.0'), -1)
  assert.equal(compareVersions('2.0.0-beta.2', '2.0.0-beta.1'), 1)
  assert.equal(compareVersions('2.0.0-alpha', '2.0.0-beta'), -1)
  assert.equal(compareVersions('2.0.0-beta.1', '2.0.0-beta.1'), 0)
  assert.equal(compareVersions('2.0.0', '2.0.0-build.5'), 1)
  assert.equal(compareVersions('nope', '2.0.0'), null)
  assert.equal(compareVersions('2.0', '2.0.0'), null)
})

test('buildGitSpec pins a full sha and rejects short or non-hex input', () => {
  assert.equal(buildGitSpec(SHA), `https://github.com/WTYJ/dsh-cross-model-subagent.git#${SHA}`)
  assert.equal(buildGitSpec(SHA.toUpperCase()), `https://github.com/WTYJ/dsh-cross-model-subagent.git#${SHA}`)
  assert.throws(() => buildGitSpec('abc123'), /40-character/)
  assert.throws(() => buildGitSpec('z'.repeat(40)), /40-character/)
  assert.throws(() => buildGitSpec(undefined), /40-character/)
})

test('gitOriginOf recognizes the repository across URL shapes', () => {
  assert.equal(gitOriginOf('https://github.com/WTYJ/dsh-cross-model-subagent.git'), 'github.com/wtyj/dsh-cross-model-subagent')
  assert.equal(gitOriginOf('git+https://github.com/WTYJ/dsh-cross-model-subagent.git'), 'github.com/wtyj/dsh-cross-model-subagent')
  assert.equal(gitOriginOf('git+ssh://github.com/WTYJ/dsh-cross-model-subagent.git'), 'github.com/wtyj/dsh-cross-model-subagent')
  assert.equal(gitOriginOf('git@github.com:WTYJ/dsh-cross-model-subagent.git'), 'github.com/wtyj/dsh-cross-model-subagent')
  assert.equal(gitOriginOf('https://github.com/WTYJ/dsh-cross-model-subagent.git#abc&path:'), 'github.com/wtyj/dsh-cross-model-subagent')
  assert.notEqual(gitOriginOf('https://github.com/someone/else.git'), 'github.com/wtyj/dsh-cross-model-subagent')
})

test('selfUpdateBlocker returns machine-readable codes', () => {
  assert.equal(selfUpdateBlocker({ kind: 'git', spec: REPOSITORY.git }, SHA), null)
  assert.equal(selfUpdateBlocker({ kind: 'link' }, SHA), 'link-install')
  assert.equal(selfUpdateBlocker({ kind: 'path' }, SHA), 'link-install')
  assert.equal(selfUpdateBlocker({ kind: 'registry' }, SHA), 'unmanaged-source')
  assert.equal(selfUpdateBlocker({ kind: 'git' }, SHA), 'unmanaged-source')
  assert.equal(selfUpdateBlocker({ kind: 'git', spec: 'https://github.com/x/y.git' }, SHA), 'foreign-origin')
  assert.equal(selfUpdateBlocker({ kind: 'git', spec: REPOSITORY.git }, null), 'no-commit')
  assert.equal(selfUpdateBlocker(undefined, SHA), 'unmanaged-source')
})

test('ready status from a managed git install produces a compliant spec', async () => {
  const result = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({ commit: commitBody(), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(result.status, 'ready')
  assert.equal(result.currentVersion, '2.0.0')
  assert.equal(result.latestVersion, '2.1.0')
  assert.equal(result.latestCommit, SHA)
  assert.equal(result.canSelfUpdate, true)
  assert.equal(result.spec, `https://github.com/WTYJ/dsh-cross-model-subagent.git#${SHA}`)
  assert.match(result.spec, /\.git#[0-9a-f]{40}$/)
  assert.equal(result.notes, 'feat: ship it')
  assert.ok(result.checkedAt)
})

test('equal versions report up-to-date', async () => {
  const result = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({ commit: commitBody(), manifest: manifestBody('2.0.0') }),
  })
  assert.equal(result.status, 'up-to-date')
})

test('a newer local version reports ahead', async () => {
  const result = await checkForUpdate({
    currentVersion: '2.5.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({ commit: commitBody(), manifest: manifestBody('2.0.0') }),
  })
  assert.equal(result.status, 'ahead')
})

test('non-semver versions report unknown-version without crashing', async () => {
  const result = await checkForUpdate({
    currentVersion: 'stable',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({ commit: commitBody(), manifest: manifestBody('2.0.0') }),
  })
  assert.equal(result.status, 'unknown-version')
  assert.equal(result.canSelfUpdate, false)
  assert.match(result.reason, /semantic version/)
})

test('an empty repository is reported as empty, not as a failed check', async () => {
  const result = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    // GitHub answers 409 for an empty repository and 404 when the branch is absent.
    fetchImpl: fakeFetch({ commit: response({ ok: false, status: 409 }), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(result.status, 'empty')
  assert.equal(result.canSelfUpdate, false)
  assert.equal(result.fetchAttempts[0].status, 409)
  assert.match(result.reason, /no commits/)
})

test('an absent branch is also treated as an empty repository', async () => {
  const result = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({ commit: response({ ok: false, status: 404 }), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(result.status, 'empty')
  assert.equal(result.canSelfUpdate, false)
})

test('API network error is reported as a structured error', async () => {
  const result = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({ commit: new TypeError('fetch failed'), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(result.status, 'error')
  assert.equal(result.fetchAttempts[0].problem, 'network')
  assert.ok(!/at .*\.js/.test(result.reason), 'no stack traces in reason')
})

test('aborted/timed-out request returns error and does not throw', async () => {
  const controller = new AbortController()
  controller.abort()
  const result = await checkForUpdate({
    currentVersion: '2.0.0',
    signal: controller.signal,
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    // A fetch that respects the signal so the abort propagates.
    fetchImpl: async (url, init) => {
      init?.signal?.throwIfAborted()
      return response({ body: {} })
    },
  })
  assert.equal(result.status, 'error')
  assert.equal(result.canSelfUpdate, false)
})

test('oversized response body is rejected', async () => {
  const huge = 'x'.repeat(1024 * 1024 + 10)
  const result = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({ commit: response({ body: huge }), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(result.status, 'error')
  assert.equal(result.fetchAttempts[0].problem, 'body-too-large')
})

test('manifest without dsh.bundle is rejected', async () => {
  const result = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({
      commit: commitBody(),
      // Both locations carry the same manifest, so both reject it for the same reason.
      manifest: response({ body: { version: '2.1.0' } }),
    }),
  })
  assert.equal(result.status, 'error')
  const manifests = result.fetchAttempts.slice(1)
  assert.equal(manifests.length, 2, 'the contents API and the raw CDN are both consulted')
  assert.deepEqual(manifests.map(attempt => attempt.problem), ['no-manifest', 'missing-version'])
})

test('the manifest is read from the checked commit before the raw CDN', async () => {
  const result = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({
      commit: commitBody(),
      manifest: manifestBody('2.1.0'),
    }),
  })
  assert.equal(result.status, 'ready')
  assert.equal(result.latestVersion, '2.1.0')
  assert.equal(result.fetchAttempts[1].url, CONTENTS_URL)
})

test('a commit-tree manifest answers even when the raw CDN is unreachable', async () => {
  const result = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: REPOSITORY.git },
    fetchImpl: fakeFetch({
      commit: commitBody(),
      contents: asContents({ body: { version: '2.1.0', dsh: { bundle: { patch: './cordis.patch.yml' } } } }),
      // This network resolves the raw host to a local proxy that refuses connections.
      manifest: new Error('connect ECONNREFUSED'),
    }),
  })
  assert.equal(result.status, 'ready')
  assert.equal(result.latestVersion, '2.1.0')
  assert.equal(result.fetchAttempts.length, 2, 'the CDN is never consulted once the commit answered')
})

test('link install is never self-updatable and explains migration', async () => {
  const result = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'link', spec: 'file:../dsh-cross-model-subagent' },
    fetchImpl: fakeFetch({ commit: commitBody(), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(result.status, 'ready')
  assert.equal(result.canSelfUpdate, false)
  assert.equal(result.spec, null)
  assert.match(result.reason, /migration/)
})

test('git install of a foreign repository is not self-updatable', async () => {
  const result = await checkForUpdate({
    currentVersion: '2.0.0',
    installedSource: { kind: 'git', spec: 'https://github.com/someone/else.git' },
    fetchImpl: fakeFetch({ commit: commitBody(), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(result.canSelfUpdate, false)
  assert.match(result.reason, /expected repository/)
})

test('missing installedSource degrades to unknown without failing', async () => {
  const result = await checkForUpdate({
    currentVersion: '2.0.0',
    fetchImpl: fakeFetch({ commit: commitBody(), manifest: manifestBody('2.1.0') }),
  })
  assert.equal(result.status, 'ready')
  assert.equal(result.installedSource.kind, 'unknown')
  assert.equal(result.canSelfUpdate, false)
  assert.ok(result.reason)
})
