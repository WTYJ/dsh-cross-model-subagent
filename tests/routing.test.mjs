import test from 'node:test'
import assert from 'node:assert/strict'
import { snapshotSettings, resolveDefault, updateSettings, validateSettings } from '../routing.js'

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
test('invalid and ambiguous defaults fail explicitly instead of silently inheriting', () => {
  assert.throws(() => resolveDefault({ ...base(), routingEnabled: true }, 'one'), /requires both/)
  assert.throws(() => validateSettings({ ...base(), sessionDefaults: [{ sessionId: 'one', mode: 'wat' }] }), /Unknown/)
  assert.throws(() => validateSettings({ ...base(), sessionDefaults: [{ sessionId: 'one', mode: 'parent' }, { sessionId: 'one', mode: 'parent' }] }), /Duplicate/)
  assert.throws(() => updateSettings(base(), { scope: 'global', mode: 'inherit' }), /Global mode/)
})
