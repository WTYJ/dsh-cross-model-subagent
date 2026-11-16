/** The update status must describe the copy that is running, not a name assumed
 * in advance: a profile still recording an older package name would otherwise be
 * reported as "not installed" while the user looks right at it. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { updateStatus, PACKAGE_NAME, sourceKind } from '../updating-host.js'
import { REPOSITORY, selfUpdateBlocker } from '../updating.js'

const SHA = 'a'.repeat(40)
const COMMIT_URL = 'https://api.github.com/repos/WTYJ/dsh-cross-model-subagent/commits/main'
const CONTENTS_URL = `https://api.github.com/repos/WTYJ/dsh-cross-model-subagent/contents/package.json?ref=${SHA}`

function response({ ok = true, status = 200, body = '' } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { ok, status, headers: { get: () => null }, text: async () => text }
}

/** Answer the commit and the commit-tree manifest; the CDN is never needed. */
function fakeFetch(version = '0.2.0') {
  return async url => {
    if (url === COMMIT_URL) return response({ body: { sha: SHA, commit: { message: 'release', committer: { date: '2026-01-02T00:00:00Z' } } } })
    if (url === CONTENTS_URL) {
      const manifest = JSON.stringify({ version, dsh: { bundle: { patch: './cordis.patch.yml' } } })
      return response({ body: { type: 'file', content: Buffer.from(manifest).toString('base64') } })
    }
    return response({ ok: false, status: 404 })
  }
}

function fakeManager(bundles) {
  return { listBundles: async () => bundles }
}

test('a profile holding an older package name is still recognised', async () => {
  const status = await updateStatus(
    fakeManager([{ name: '@local/dsh-cross-model-subagent', version: '0.1.0', enabled: true, update: undefined, source: 'link:C:/src/plugin' }]),
    ['@wtyj/dsh-cross-model-subagent', '@local/dsh-cross-model-subagent'],
    { fetchImpl: fakeFetch('0.2.0') },
  )
  assert.equal(status.installed, true, 'the running copy must not be reported as missing')
  assert.equal(status.name, '@local/dsh-cross-model-subagent', 'the report names the copy that is installed')
  assert.equal(status.currentVersion, '0.1.0')
  assert.equal(status.status, 'ready', 'a newer release is still detected')
  // A link install cannot upgrade in place, so the page offers migration instead of a button.
  assert.equal(status.canSelfUpdate, false)
  assert.equal(status.installedSource.kind, 'link')
})

test('the canonical name wins when both names are present', async () => {
  const status = await updateStatus(
    fakeManager([
      { name: '@local/dsh-cross-model-subagent', version: '0.1.0', enabled: false, source: 'link:C:/src/plugin' },
      { name: '@wtyj/dsh-cross-model-subagent', version: '0.1.0', enabled: true, update: 'git', source: `https://github.com/WTYJ/dsh-cross-model-subagent.git#${SHA}` },
    ]),
    ['@wtyj/dsh-cross-model-subagent', '@local/dsh-cross-model-subagent'],
    { fetchImpl: fakeFetch('0.2.0') },
  )
  assert.equal(status.name, '@wtyj/dsh-cross-model-subagent')
  assert.equal(status.canSelfUpdate, true)
  assert.equal(status.spec, `https://github.com/WTYJ/dsh-cross-model-subagent.git#${SHA}`)
})

test('an absent installation explains how to install instead of naming a package', async () => {
  const status = await updateStatus(fakeManager([]), [PACKAGE_NAME], { fetchImpl: fakeFetch() })
  assert.equal(status.installed, false)
  assert.match(status.message, /not installed through the plugin manager/)
  assert.match(status.message, new RegExp(REPOSITORY.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(status.message, /is not installed in this profile/)
})

test('a manager failure is reported without throwing', async () => {
  const status = await updateStatus({ listBundles: async () => { throw new Error('profile locked') } }, [PACKAGE_NAME], { fetchImpl: fakeFetch() })
  assert.equal(status.ok, false)
  assert.match(status.message, /profile locked/)
})

test('sourceKind still separates link, git, and registry installs', () => {
  assert.equal(sourceKind('link:C:/src/plugin'), 'link')
  assert.equal(sourceKind('file:C:/src/plugin'), 'link')
  assert.equal(sourceKind('C:\\src\\plugin'), 'path')
  // DSH reports a linked bundle's source with the protocol already stripped.
  assert.equal(sourceKind('C:/Users/MR/Desktop/plugin'), 'path')
  assert.equal(sourceKind('../../../Desktop/plugin'), 'path')
  assert.equal(sourceKind('https://github.com/WTYJ/dsh-cross-model-subagent.git'), 'git')
  assert.equal(sourceKind('git@github.com:WTYJ/dsh-cross-model-subagent.git'), 'git')
  assert.equal(sourceKind('github:WTYJ/dsh-cross-model-subagent'), 'git')
  assert.equal(sourceKind('^0.1.0'), 'registry')
  assert.equal(sourceKind('~0.1.0'), 'registry')
  assert.equal(sourceKind(undefined), 'unknown')
})

test('a stripped link path is still reported as a link install that cannot self-update', async () => {
  const status = await updateStatus(
    fakeManager([{ name: '@local/dsh-cross-model-subagent', version: '0.1.0', enabled: true, source: 'C:/Users/MR/Desktop/dsh团队协作/dsh-cross-model-subagent' }]),
    ['@wtyj/dsh-cross-model-subagent', '@local/dsh-cross-model-subagent'],
    { fetchImpl: fakeFetch('0.1.0') },
  )
  assert.equal(status.installedSource.kind, 'path', 'a directory source is a local install')
  assert.equal(status.status, 'up-to-date')
  assert.equal(status.canSelfUpdate, false)
  assert.match(status.reason, /local link or path/)
})

test('a link copy is blocked from self-updating even when it is current', () => {
  assert.equal(selfUpdateBlocker({ kind: 'link' }, SHA), 'link-install')
})
