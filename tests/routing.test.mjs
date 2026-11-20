import test from 'node:test'
import assert from 'node:assert/strict'
import { snapshotSettings, resolveDefault, updateSettings } from '../routing.js'

const base = () => ({ routingEnabled: false, defaultProvider: '', defaultModel: '', sessionDefaults: [], forceAgentTeams: false })
test('session worker route works with global defaults disabled and can be changed or cleared', () => {
  let settings = updateSettings(base(), { scope: 'session', mode: 'route', provider: 'p', model: 'ds' }, 'one')
  assert.deepEqual(resolveDefault(settings, 'one'), { source: 'session', route: { provider: 'p', model: 'ds' } })
  assert.equal(resolveDefault(settings, 'two').route, null)
  settings = updateSettings(settings, { scope: 'session', mode: 'route', provider: 'p', model: 'glm' }, 'one')
  assert.equal(resolveDefault(settings, 'one').route.model, 'glm')
  settings = updateSettings(settings, { scope: 'session', mode: 'inherit' }, 'one')
  assert.equal(resolveDefault(settings, 'one').route, null)
})
test('parent override opts one session out of global worker defaults', () => {
  const global = updateSettings(base(), { scope: 'global', mode: 'route', provider: 'p', model: 'ds' })
  const parent = updateSettings(global, { scope: 'session', mode: 'parent' }, 'one')
  assert.deepEqual(resolveDefault(parent, 'one'), { source: 'session-parent', route: null })
  assert.equal(resolveDefault(parent, 'two').route.model, 'ds')
  assert.equal(resolveDefault(updateSettings(parent, { scope: 'session', mode: 'inherit' }, 'one'), 'one').route.model, 'ds')
  assert.equal(global.sessionDefaults.length, 0, 'updates must not mutate the accepted snapshot')
})
test('a snapshot reads current volatile values rather than capturing creation-time defaults', () => {
  let model = 'ds'
  const config = { routingEnabled: { get: () => true }, defaultProvider: { get: () => 'p' }, defaultModel: { get: () => model } }
  assert.equal(resolveDefault(snapshotSettings(config), 'one').route.model, 'ds')
  model = 'glm'
  assert.equal(resolveDefault(snapshotSettings(config), 'one').route.model, 'glm')
})
test('legacy multi-route allowlists are never guessed into a default', () => {
  const settings = snapshotSettings({ sessionRoutesJson: '{"one":[{"provider":"p","model":"ds"}]}' })
  assert.equal(settings.legacyRulesPresent, true)
  assert.equal(resolveDefault(settings, 'one').route, null)
})
test('a broken session override affects only that session', () => {
  const settings = {
    ...base(), routingEnabled: true, defaultProvider: 'p', defaultModel: 'global',
    sessionDefaults: [{ sessionId: 'broken', mode: 'route', provider: 'p', model: '' }],
  }
  assert.equal(resolveDefault(settings, 'healthy').route.model, 'global')
  assert.throws(() => resolveDefault(settings, 'broken'), /requires both/)
  settings.sessionDefaults.push({ sessionId: 'broken', mode: 'parent' })
  assert.throws(() => resolveDefault(settings, 'broken'), /Duplicate/)
  assert.equal(resolveDefault(settings, 'healthy').route.model, 'global')
})

test('a broken global default affects only sessions inheriting it', () => {
  const settings = {
    ...base(), routingEnabled: true,
    sessionDefaults: [
      { sessionId: 'parent', mode: 'parent' },
      { sessionId: 'worker', mode: 'route', provider: 'p', model: 'worker' },
    ],
  }
  assert.equal(resolveDefault(settings, 'parent').route, null)
  assert.equal(resolveDefault(settings, 'worker').route.model, 'worker')
  assert.throws(() => resolveDefault(settings, 'inherit'), /requires both/)
})

test('invalid and ambiguous defaults fail explicitly instead of silently inheriting', () => {
  assert.throws(() => resolveDefault({ ...base(), routingEnabled: true }, 'one'), /requires both/)
  assert.throws(() => resolveDefault({ ...base(), sessionDefaults: [{ sessionId: 'one', mode: 'wat' }] }, 'one'), /Unknown/)
  assert.throws(() => resolveDefault({ ...base(), sessionDefaults: [{ sessionId: 'one', mode: 'parent' }, { sessionId: 'one', mode: 'parent' }] }, 'one'), /Duplicate/)
  assert.throws(() => updateSettings(base(), { scope: 'global', mode: 'inherit' }), /Global mode/)
})

test('session and global settings can be repaired independently', () => {
  const row = sessionId => ({ sessionId, mode: 'route', provider: 'p', model: '' })
  const broken = { ...base(), routingEnabled: true, sessionDefaults: [row('one'), row('two')] }
  const cleared = updateSettings(broken, { scope: 'session', mode: 'inherit' }, 'one')
  assert.deepEqual(cleared.sessionDefaults, [row('two')])
  assert.equal(broken.sessionDefaults.length, 2)
  const next = updateSettings(cleared, { scope: 'global', mode: 'route', provider: 'p', model: 'valid' })
  assert.equal(resolveDefault(next, 'one').route.model, 'valid')
  assert.throws(() => resolveDefault(next, 'two'), /requires both/)
  assert.throws(() => updateSettings(next, { scope: 'session', mode: 'route', provider: 'p', model: '' }, 'two'), /requires both/)
})
