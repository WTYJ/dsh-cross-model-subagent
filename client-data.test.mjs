import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Evaluate only the pure data block. No module loader, React, browser, or DOM is simulated.
const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const pure = source.split('// BEGIN PURE HELPERS')[1].split('// END PURE HELPERS')[0]
const helpers = vm.runInNewContext(`(() => { ${pure}; return { routeKey, routeFromKey, sessionRows, defaultValue, sessionValue, replaceSession, beginEdit, isDirty, GLOBAL_GROUPS, rebaseDraft, draftOverlaps, globalOps, acceptedWrite, observeTeam, teamNotifications, teamMemberLookupIds, teamMemberBatch } })()`)
const plain = value => JSON.parse(JSON.stringify(value))

test('client session rows use id, keep titles/current status and filter subagents', () => {
  const rows = helpers.sessionRows({ ids: ['a', 'b', 'child'], byId: {
    a: { id: 'a', sessionId: 'wrong-wire-field', displayTitle: 'Conversation', retainedBy: { mainView: 1 } },
    b: { id: 'b', title: 'Other' }, child: { id: 'child', origin: 'subagent' },
  } })
  assert.deepEqual(plain(rows), [{ id: 'a', title: 'Conversation', current: true }, { id: 'b', title: 'Other', current: false }])
})
test('team notices ignore the loaded catalog and collect only newly started members', () => {
  const old = { id: 'old' }, a = { id: 'a' }, b = { id: 'b' }
  const baseline = helpers.observeTeam(null, true, [old])
  assert.equal(baseline.announced, false)
  assert.equal(helpers.observeTeam(baseline, true, [old]), baseline)
  const first = helpers.observeTeam(baseline, true, [old, a])
  assert.equal(first.announced, true)
  assert.deepEqual(plain(first.members), [a])
  const expanded = helpers.observeTeam(first, true, [old, a, b])
  assert.deepEqual(plain(expanded.members), [a, b])
  const disabled = helpers.observeTeam(expanded, false, [old, a, b])
  assert.equal(disabled.announced, false)
  assert.equal(helpers.observeTeam(disabled, true, [old, a, b]), disabled)
  assert.equal(helpers.observeTeam(expanded, undefined, undefined), expanded)
})

test('temporary dismissal waits for a new member while muting baselines unseen members', () => {
  const notice = helpers.teamNotifications()
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }, d = { id: 'd' }
  notice.observe('root', true, [])
  notice.observe('root', true, [a])
  notice.dismiss('root')
  notice.observe('root', true, [a])
  assert.equal(notice.getSnapshot(), null)
  notice.observe('root', true, [a, b])
  assert.deepEqual(plain(notice.getSnapshot().members), [a, b])
  notice.observe('root', false, [a, b, c])
  assert.equal(notice.getSnapshot(), null)
  notice.observe('root', true, [a, b, c])
  assert.equal(notice.getSnapshot(), null)
  notice.observe('root', true, [a, b, c, d])
  assert.deepEqual(plain(notice.getSnapshot().members), [d])
})

test('new members reuse confirmed models while each manual refresh checks all members once', () => {
  const route = { provider: 'p', model: 'm' }
  const ids = ['confirmed', 'pending', 'new']
  const known = new Map([['confirmed', route]])
  const lastRefresh = new Map()
  const lookup = refreshKey => plain(helpers.teamMemberLookupIds(ids, known, refreshKey, lastRefresh))

  assert.deepEqual(lookup(0), ['pending', 'new'])
  assert.deepEqual(lookup(1), ids)
  lastRefresh.set('confirmed', 1)
  lastRefresh.set('pending', 1)
  assert.deepEqual(lookup(1), ['pending', 'new'])
  known.set('new', route)
  assert.deepEqual(lookup(1), ['pending', 'new'], 'an unfinished refresh still checks a cached model')
  lastRefresh.set('new', 1)
  assert.deepEqual(lookup(1), ['pending'])
  assert.deepEqual(lookup(2), ids)
})

test('refresh distinguishes a failed member batch from models still awaiting confirmation', () => {
  const previousRoute = { provider: 'p', model: 'previous' }
  const newRoute = { provider: 'p', model: 'new' }
  const known = new Map([['cached', previousRoute]])
  const ids = ['cached', 'pending', 'confirmed', 'failed']
  assert.deepEqual(plain(helpers.teamMemberBatch(ids, null, known)), {
    failed: ids, waiting: [], confirmed: [],
  })
  assert.deepEqual(plain(helpers.teamMemberBatch(ids, { ok: true, members: [
    { id: 'cached', route: null, failed: true }, { id: 'confirmed', route: newRoute },
    { id: 'failed', route: null, failed: true }, { id: 'unrequested', route: newRoute },
  ] }, known)), {
    failed: ['cached', 'failed'], waiting: ['pending'], confirmed: [{ id: 'confirmed', route: newRoute }],
  })
  assert.deepEqual(plain(helpers.teamMemberBatch(ids, { ok: true, members: [{ id: 'cached', route: newRoute }] }, known).confirmed),
    [{ id: 'cached', route: newRoute }])
  assert.deepEqual(known.get('cached'), previousRoute)
})

test('initially missing list is safe and does not claim a session exists', () => {
  assert.deepEqual(plain(helpers.sessionRows(undefined)), [])
})
test('route keys round-trip slash and delimiter-containing exact model ids', () => {
  const route = { provider: 'provider/name', model: 'workbuddy/model\u0000id' }
  assert.deepEqual(plain(helpers.routeFromKey(helpers.routeKey(route))), route)
  assert.notEqual(helpers.routeKey({ provider: 'a/b', model: 'c' }), helpers.routeKey({ provider: 'a', model: 'b/c' }))
})
test('absent session override inherits global defaults', () => {
  assert.deepEqual(plain(helpers.sessionValue({ sessionDefaults: [] }, 'a')), { mode: 'inherit', provider: '', model: '' })
})
test('session override is one route and unrelated sessions survive replacement', () => {
  const entries = [{ sessionId: 'a', mode: 'route', provider: 'p', model: 'old' }, { sessionId: 'b', mode: 'parent', provider: '', model: '' }]
  const result = helpers.replaceSession(entries, 'a', { mode: 'route', provider: 'p', model: 'new' })
  assert.deepEqual(plain(result), [entries[1], { sessionId: 'a', mode: 'route', provider: 'p', model: 'new' }])
  assert.equal(entries[0].model, 'old')
})
test('clear removes only selected override, and parent strips obsolete route fields', () => {
  const entries = [{ sessionId: 'a', mode: 'route', provider: 'p', model: 'm' }, { sessionId: 'b', mode: 'parent' }]
  assert.deepEqual(plain(helpers.replaceSession(entries, 'a', { mode: 'inherit' })), [entries[1]])
  assert.deepEqual(plain(helpers.replaceSession(entries, 'a', { mode: 'parent', provider: 'p', model: 'm' })), [entries[1], { sessionId: 'a', mode: 'parent', provider: '', model: '' }])
})
test('editing keeps initial revision and baseline when the Host changes mid-draft', () => {
  const first = helpers.beginEdit(null, { model: 'old' }, 7, { model: 'draft' })
  const next = helpers.beginEdit(first, { model: 'external' }, 8, { model: 'updated draft' })
  assert.equal(next.revision, 7)
  assert.deepEqual(plain(next.baseline), { model: 'old' })
  assert.equal(helpers.isDirty(next), true)
})
test('rebasing a global toggle preserves and does not submit a concurrently changed model', () => {
  const before = { routingEnabled: true, defaultProvider: 'p', defaultModel: 'old' }
  const current = { ...before, defaultModel: 'external' }
  const edit = helpers.beginEdit(null, before, 1, { ...before, routingEnabled: false })
  assert.equal(helpers.draftOverlaps(edit, current, helpers.GLOBAL_GROUPS), false)
  const rebased = helpers.rebaseDraft(edit, current, 2, helpers.GLOBAL_GROUPS)
  assert.equal(rebased.revision, 2)
  assert.equal(rebased.value.defaultModel, 'external')
  assert.deepEqual(plain(helpers.globalOps(rebased.baseline, rebased.value)), [
    { op: 'set', path: ['routingEnabled'], value: false },
  ])
})

test('rebasing competing model changes keeps the explicitly chosen route as a pair', () => {
  const before = { routingEnabled: true, defaultProvider: 'p', defaultModel: 'old' }
  const draft = { ...before, defaultModel: 'draft' }
  const current = { ...before, defaultProvider: 'other', defaultModel: 'external' }
  const edit = helpers.beginEdit(null, before, 1, draft)
  assert.equal(helpers.draftOverlaps(edit, current, helpers.GLOBAL_GROUPS), true)
  const rebased = helpers.rebaseDraft(edit, current, 2, helpers.GLOBAL_GROUPS)
  assert.deepEqual(plain(helpers.globalOps(rebased.baseline, rebased.value)), [
    { op: 'set', path: ['defaultProvider'], value: 'p' },
    { op: 'set', path: ['defaultModel'], value: 'draft' },
  ])
  assert.equal(helpers.rebaseDraft(edit, draft, 2, helpers.GLOBAL_GROUPS), null)
})

test('a toggle returned to baseline is not dirty; false mutation is never accepted', () => {
  assert.equal(helpers.isDirty(helpers.beginEdit(null, false, 1, false)), false)
  assert.equal(helpers.isDirty(helpers.beginEdit(null, false, 1, true)), true)
  for (const result of [false, undefined, null, {}, 1]) assert.equal(helpers.acceptedWrite(result), false)
  assert.equal(helpers.acceptedWrite(true), true)
})
test('legacy allowlist and sessionRoutesJson never determine execution defaults', () => {
  assert.deepEqual(plain(helpers.defaultValue({ enabled: true, allowedModels: [{ provider: 'p', model: 'm' }], sessionRoutesJson: '{}' })),
    { routingEnabled: false, defaultProvider: '', defaultModel: '' })
})
