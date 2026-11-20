import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import * as host from '../index.js'
import { candidateNames, mountUpdater } from '../updating-entry.js'
import { buildGitSpec } from '../updating.js'

const installed = async name => import(pathToFileURL(host.resolveInstalled(name)).href)
const { Context } = await installed('@deepseek-ai/cordis')
const { ToolsService } = await installed('@deepseek-ai/dsh-tools')
const { createScope } = await installed('@deepseek-ai/dsh-scope')
const native = await installed('@deepseek-ai/dsh-tool-subagent')

// Real Cordis, registry, scope shadowing and official native tool. Only the
// outside-world catalog, projection and activation services are controlled.
async function fixture() {
  let ctx = new Context()
  const live = []
  const activations = []
  const preflights = []
  const teamChanges = []
  const roots = new Map()
  const providers = new Map([['spawn', { name: 'spawn', capabilities: { agentOptions: true, agentPreset: true, outputSchema: true, depthLimit: true }, inheritsParentContext: false, prepareContinuable: async () => ({}) }]])
  ctx.provide('systemPrompt', { tools() {}, section() {}, context() {}, getSectionOrder: () => 1, getContextOrder: () => 1 })
  ctx.provide('sessionProjections', { register: async () => ({ stateOf: session => session.policy ?? null }) })
  ctx.provide('llm', {
    listProviders: () => [{ id: 'gpt', name: 'GPT' }, { id: 'ds', name: 'DS' }],
    listModels: async provider => provider === 'ds' ? [{ id: 'A' }, { id: 'B' }] : [{ id: 'parent' }],
    resolveCallConfig: async (route, signal) => { signal?.throwIfAborted(); preflights.push({ ...route }); return route },
  })
  ctx.provide('agents', { list: () => [...live], get: id => live.find(agent => agent.id === id) })
  ctx.provide('agentTeams', { setEnabled: async (...args) => { teamChanges.push(args) } })
  ctx.provide('subagents', {
    getProvider: name => providers.get(name),
    resolveMaxDepth: configured => configured === 'provider-managed' ? undefined : configured ?? 2,
    rootOf: agent => roots.get(agent) ?? agent,
    startActivation: async spec => { activations.push(spec); return { name: spec.name ?? 'child', childId: 'child-id' } },
  })
  const tools = ctx.plugin(ToolsService)
  await tools
  const harness = ctx.plugin({ inject: [...host.inject, 'agentTeams'], apply() {} })
  await harness
  ctx = harness.ctx
  const presetKey = {}
  const preset = createScope(ctx, presetKey)
  const nativeMount = preset.ctx.plugin({ inject: native.inject, apply: inner => native.apply(inner, { provider: 'spawn', modelSelection: true, toolName: 'subagent' }) })
  await nativeMount
  const fork = { name: 'subagent_fork', description: 'unchanged fork', parameters: { type: 'object' }, output: { schema: { type: 'object' }, render: () => [] }, execute: async () => ({ original: true }) }
  preset.ctx.tools.register(fork)
  function agent(id, origin) {
    const value = { id, options: { provider: 'gpt', model: 'parent', reasoningEffort: 'high' }, session: { header: { id, ...(origin ? { origin } : {}) }, firstLiveSeq: 0, requestHeader: () => ({ config: { provider: 'gpt', model: 'parent', reasoningEffort: 'high' } }), snapshotEvents: () => [] }, model: { current: () => ({ provider: 'gpt', model: 'parent' }) } }
    const scope = createScope(ctx, value, { parent: presetKey })
    value.ctx = scope.ctx
    live.push(value)
    return value
  }
  const config = { routingEnabled: true, defaultProvider: 'ds', defaultModel: 'A', sessionDefaults: [], forceAgentTeams: true, sessionRoutesJson: '{}' }
  const existing = agent('existing')
  const original = ctx.tools.get('subagent', existing)
  const owner = ctx.plugin({ inject: host.inject, apply: inner => host.apply(inner, config) })
  await owner
  async function run(target, args = {}, definition = ctx.tools.get('subagent', target)) {
    return definition.execute({ description: 'test worker', prompt: 'work', ...args }, { agent: target, signal: new AbortController().signal })
  }
  return { ctx, config, existing, original, owner, fork, agent, roots, activations, preflights, teamChanges, run }
}

test('host composes official native subagent with live defaults and owned scope', async t => {
  const f = await fixture()
  t.after(() => f.ctx.root.fiber.dispose())
  const { ctx, existing, config, owner } = f
  const definition = ctx.tools.get('subagent', existing)
  assert.notEqual(definition, f.original, 'existing root shadows preset native tool')
  assert.equal(ctx.tools.get('subagent_fork', existing), f.fork)
  assert.equal(f.teamChanges.length, 0, 'loading plugin does not alter existing session teams')

  const toolSet = await ctx.tools.resolve({ agent: existing, modelSelection: { provider: 'gpt', model: 'parent' }, signal: new AbortController().signal })
  assert.equal(toolSet.view(existing).get('subagent'), definition)
  await f.run(existing, {}, definition)
  assert.deepEqual(f.activations.at(-1).agentOptions, { provider: 'ds', model: 'A' })
  assert.equal(f.activations.at(-1).maxDepth, 2)
  assert.equal(f.activations.at(-1).delivery, 'parent')
  assert.equal(f.activations.at(-1).parent, existing)

  config.defaultModel = 'B'
  await f.run(existing, {}, toolSet.view(existing).get('subagent'))
  assert.deepEqual(f.activations.at(-1).agentOptions, { provider: 'ds', model: 'B' })
  config.routingEnabled = false
  await f.run(existing, {}, definition)
  assert.equal(f.activations.at(-1).agentOptions, undefined, 'clear delegates native parent inheritance')
  assert.equal(ctx.tools.get('subagent', existing), definition, 'updates never replace cached definition')

  config.routingEnabled = true
  await assert.rejects(f.run(existing, { provider: 'ds', model: 'A' }), /not allowed for this Session/)
  existing.session.policy = [{ provider: 'ds', model: 'A' }]
  await f.run(existing, { provider: 'ds', model: 'A' })
  assert.deepEqual(f.activations.at(-1).agentOptions, { provider: 'ds', model: 'A', reasoningEffort: undefined })
  await assert.rejects(f.run(existing, { reasoning_effort: 'high' }), /requires both/)

  const fresh = f.agent('fresh')
  await ctx.serial('agent/created', { agent: fresh, source: 'startup' })
  await f.run(fresh)
  assert.deepEqual(f.activations.at(-1).agentOptions, { provider: 'ds', model: 'B' })
  assert.equal(f.teamChanges.length, 1)
  const resumed = f.agent('resumed')
  await ctx.serial('agent/created', { agent: resumed, source: 'resume' })
  assert.equal(f.teamChanges.length, 1, 'resume never forces teams')
  const child = f.agent('child', 'subagent')
  f.roots.set(child, existing)
  await ctx.serial('agent/created', { agent: child, source: 'startup' })
  assert.equal(ctx.tools.get('subagent', child), f.original, 'child uses original preset tool')
  assert.equal(ctx.tools.get('subagent_fork', fresh), f.fork)
  const cordis = f.agent('cordis-root')
  cordis.session.header.agentPreset = 'cordis'
  await ctx.serial('agent/created', { agent: cordis, source: 'resume' })
  assert.notEqual(ctx.tools.get('subagent', cordis), f.original, 'the shipped cordis preset supports worker defaults')
  const custom = f.agent('custom-root')
  custom.session.header.agentPreset = 'custom-external-backend'
  await ctx.serial('agent/created', { agent: custom, source: 'resume' })
  assert.equal(ctx.tools.get('subagent', custom), f.original, 'unrecognized presets keep their own backend and tool configuration')

  const configure = ctx.tools.get('cross_model_subagent_configure', existing)
  const exec = { agent: existing, signal: new AbortController().signal }
  assert.match((await configure.execute({ scope: 'session', mode: 'route', provider: 'missing', model: 'A' }, exec)).error, /unavailable/)
  assert.match((await configure.execute({ scope: 'session', mode: 'route', provider: 'ds', model: 'missing' }, exec)).error, /not advertised/)
  assert.match((await configure.execute({ scope: 'session', mode: 'route', provider: 'ds', model: 'A' }, exec)).error, /not editable/)

  toolSet.dispose()
  await owner.dispose()
  assert.equal(ctx.tools.get('subagent', existing), f.original, 'unload restores preset tool')
  assert.equal(ctx.tools.get('subagent', fresh), f.original)
  assert.equal(ctx.tools.get('subagent_fork', existing), f.fork)
  assert.equal(ctx.tools.get('cross_model_subagent_configure', existing), undefined)
})

test('model summary routes follow the Web service lifecycle after host startup', async t => {
  const f = await fixture()
  t.after(() => f.ctx.root.fiber.dispose())
  const routes = new Set()
  const web = f.ctx.root.plugin({ apply(ctx) {
    ctx.provide('webServer', { register(route) {
      routes.add(route.path)
      return () => { routes.delete(route.path) }
    } })
  } })
  await web
  assert.deepEqual([...routes].sort(), ['/model-delegation/status', '/model-delegation/team-models'])
  await web.dispose()
  assert.equal(routes.size, 0)
})

// Exercise the updater route without invoking an actual plugin installation.
const PINNED = buildGitSpec('a'.repeat(40))
const HOST = '127.0.0.1:12345'

function mountUpdate({ connection = { admit: req => req.admission } } = {}) {
  let handler
  const installs = []
  const bundles = []
  const fetchImpl = async url => new Response(JSON.stringify(url.includes('/commits/')
    ? { sha: 'a'.repeat(40) }
    : { type: 'file', content: Buffer.from(JSON.stringify({ version: '0.0.2', dsh: { bundle: {} } })).toString('base64') }))
  const pluginManager = {
    async listBundles() { return bundles },
    async updateBundle(name, version, options) {
      installs.push({ name, version, options })
      return { result: { application: 'applied' } }
    },
  }
  const services = { connection, pluginManager }
  mountUpdater({
    webServer: { register(route) { handler = route.handler } },
    get: key => services[key],
    effect: mount => mount(),
  }, {}, { registerTool: false, fetchImpl })

  async function call({ headers = {}, admission, body }) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    Object.assign(req, { method: 'POST', headers: { host: HOST, ...headers }, admission })
    const result = {}
    await handler(req, {
      writeHead(status) { result.status = status },
      end(value) { result.body = JSON.parse(value) },
    })
    return result
  }
  async function checkInstalled() {
    if (!bundles.length) bundles.push({ name: 'dsh-cross-model-subagent', version: '0.0.1', source: buildGitSpec('b'.repeat(40)), update: 'git' })
    const result = await call({ body: { action: 'check' } })
    assert.equal(result.body.canSelfUpdate, true)
    assert.equal(result.body.spec, PINNED)
  }
  return { call, installs, bundles, checkInstalled }
}

test('check stays available with no credentials while apply is gated', async () => {
  const u = mountUpdate()
  // No bundle is installed: updateStatus returns an "installed:false" report
  // without touching the network, so this proves check runs credential-free.
  const check = await u.call({ body: { action: 'check' }, admission: { rejection: 401 } })
  assert.equal(check.status, 200)
  assert.equal(check.body.action, 'check')
  assert.equal(check.body.installed, false)
  assert.equal(u.installs.length, 0, 'check never installs')
})

test('apply rejects an unauthenticated request with 401 and never installs', async () => {
  const u = mountUpdate()
  const r = await u.call({ body: { action: 'apply', version: '0.0.2', spec: PINNED }, admission: { rejection: 401 } })
  assert.equal(r.status, 401)
  assert.equal(u.installs.length, 0, 'an unauthenticated apply must not reach updateBundle')
})

test('apply rejects an authenticated non-owner with 403 and never installs', async () => {
  const u = mountUpdate()
  const r = await u.call({ body: { action: 'apply', version: '0.0.2', spec: PINNED }, admission: { peer: { principal: { kind: 'remote' } } } })
  assert.equal(r.status, 403)
  assert.equal(u.installs.length, 0, 'a non-owner peer must not reach updateBundle')
})

test('apply rejects a cross-origin request with 403 and never installs', async () => {
  const u = mountUpdate()
  const r = await u.call({
    headers: { origin: 'https://example.com' },
    body: { action: 'apply', version: '0.0.2', spec: PINNED },
    admission: { peer: { principal: { kind: 'owner' } } },
  })
  assert.equal(r.status, 403)
  assert.equal(u.installs.length, 0)
})

test('apply refuses with 503 when the Connection service is missing', async () => {
  const u = mountUpdate({ connection: null })
  const r = await u.call({ body: { action: 'apply', version: '0.0.2', spec: PINNED } })
  assert.equal(r.status, 503)
  assert.equal(u.installs.length, 0, 'without a Connection guard the install never proceeds')
})

test('the updater looks up the new package name before either historical name', () => {
  assert.deepEqual(candidateNames(), [
    'dsh-cross-model-subagent', '@wtyj/dsh-cross-model-subagent', '@local/dsh-cross-model-subagent',
  ])
})

test('an owner browser on the same origin reaches the simulated updateBundle', async () => {
  const u = mountUpdate()
  await u.checkInstalled()
  const r = await u.call({
    headers: { origin: `http://${HOST}` },
    admission: { peer: { principal: { kind: 'owner' } } },
    body: { action: 'apply', version: '0.0.2', spec: PINNED },
  })
  assert.equal(r.status, 200)
  assert.equal(u.installs.length, 1, 'the owner install is delegated to the plugin manager')
  assert.equal(u.installs[0].name, 'dsh-cross-model-subagent')
  assert.equal(u.installs[0].version, '0.0.2')
  assert.equal(u.installs[0].options.spec, PINNED)
})

test('an Electron owner request with no Origin reaches the simulated updateBundle', async () => {
  const u = mountUpdate()
  await u.checkInstalled()
  const r = await u.call({
    // Electron strips Origin and forwards a Host-issued cookie; admit() then
    // returns the owner browser Peer, so a no-Origin install proceeds.
    headers: {},
    admission: { peer: { principal: { kind: 'owner' } } },
    body: { action: 'apply', version: '0.0.2', spec: PINNED },
  })
  assert.equal(r.status, 200)
  assert.equal(u.installs.length, 1)
  assert.equal(u.installs[0].options.spec, PINNED)
})

test('an owner install with an unpinned spec fails before the manager is called', async () => {
  const u = mountUpdate()
  const r = await u.call({
    body: { action: 'apply', version: '0.0.2', spec: 'https://github.com/WTYJ/dsh-cross-model-subagent.git' },
    admission: { peer: { principal: { kind: 'owner' } } },
  })
  assert.equal(u.installs.length, 0, 'an unpinned spec never reaches updateBundle')
  assert.equal(r.body.ok, false)
  assert.equal(r.status, 502)
})

test('apply requires a checked version and commit that remain eligible', async () => {
  const u = mountUpdate()
  const admission = { peer: { principal: { kind: 'owner' } } }
  const apply = (version, spec) => u.call({ admission, body: { action: 'apply', version, spec } })
  assert.equal((await apply('0.0.2', PINNED)).body.ok, false)
  await u.checkInstalled()
  assert.equal((await apply('0.0.3', PINNED)).body.ok, false)
  assert.equal((await apply('0.0.2', buildGitSpec('c'.repeat(40)))).body.ok, false)
  u.bundles[0].source = 'github:example/other#' + 'd'.repeat(40)
  assert.equal((await apply('0.0.2', PINNED)).body.ok, false)
  assert.equal(u.installs.length, 0)
})
