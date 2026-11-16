import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import * as host from '../index.js'

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
