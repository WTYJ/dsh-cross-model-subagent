/** Host half: session worker defaults.
 *
 * Worker defaults reuse DSH's public native delegation tool in an agent scope,
 * with live agentOptions. Update checks and installation live in a separate
 * bundle row (see updating-entry.js) so each concern has one owner. */
import { pathToFileURL } from 'node:url'
import { resolveInstalled, schema } from './installed.js'
import { snapshotSettings, resolveDefault, checkedRoute, updateSettings } from './routing.js'

const z = schema()
const nativeTool = await import(pathToFileURL(resolveInstalled('@deepseek-ai/dsh-tool-subagent')).href)

// Re-exported so tests and diagnostics resolve packages exactly as the Host does.
export { resolveInstalled }

export const name = 'cross-model-subagent'
export const inject = ['tools', 'agents', 'subagents', 'llm', 'systemPrompt', 'sessionProjections']
export const Config = z.object({
  routingEnabled: z.boolean().default(false).volatile(),
  defaultProvider: z.string().default('').volatile(),
  defaultModel: z.string().default('').volatile(),
  sessionDefaults: z.array(z.object({
    sessionId: z.string().min(1).required(),
    mode: z.union(['route', 'parent']).required(),
    provider: z.string().default(''),
    model: z.string().default(''),
  })).default([]).volatile(),
  forceAgentTeams: z.boolean().default(false).volatile(),
  // Preserve v1 configuration without converting a multi-route allowlist into
  // an arbitrary default. The UI explicitly identifies this as legacy data.
  sessionRoutesJson: z.string().default('{}').volatile(),
})

const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] }

export async function validateCatalogRoute(llm, route, signal) {
  const providers = llm.listProviders()
  if (!providers.some(provider => provider.id === route.provider)) throw new Error(`Provider is unavailable: ${route.provider}`)
  const models = await llm.listModels(route.provider)
  if (!models.some(model => model.id === route.model)) throw new Error(`Model is not advertised: ${route.provider}/${route.model}`)
  await llm.resolveCallConfig(route, signal)
}

export async function apply(ctx, config) {
  const mounts = new Map()
  const current = () => snapshotSettings(config)

  async function mount(agent) {
    if (agent.session.header.origin === 'subagent' || mounts.has(agent)) return
    // Respect presets that deliberately omit delegation. Do not create a new
    // capability in minimal/custom presets with no native subagent tool.
    const original = agent.ctx.tools.get('subagent', agent)
    if (!original) return
    // Only shipped native compositions are supported. A custom preset may use
    // another backend, independent worker preset, or tool-specific limits.
    const preset = ctx.get('agentPresets')?.composedPreset(agent.ctx) ?? agent.session.header.agentPreset
    if (preset && !['standard', 'ptc', 'cordis'].includes(preset)) return
    if (original.parameters?.properties?.agent_preset) return
    const state = { fiber: null, ready: false, error: null }
    mounts.set(agent, state)
    const defaults = {
      provider: 'spawn', toolName: 'subagent', modelSelection: true, modelDiscovery: false,
      get agentOptions() {
        const selection = resolveDefault(current(), agent.id)
        return selection.route ? { ...selection.route } : undefined
      },
    }
    // This wrapper has NO Config schema: do not materialize the live getter.
    // Public native apply preserves preflight, depth, explicit-selection policy,
    // activation ownership, workdir, cancellation and delivery semantics.
    const fiber = agent.ctx.plugin({
      name: 'cross-model-worker-default',
      inject: nativeTool.inject,
      apply: inner => nativeTool.apply(inner, defaults),
    })
    state.fiber = fiber
    // Both owners matter: closing the Agent OR disabling this plugin removes
    // the scoped native tool. Keep the exact Fiber disposer for ordered unwind.
    ctx.effect(() => fiber.dispose, `worker-default:${agent.id}`)
    try {
      await fiber
      state.ready = true
    } catch (error) {
      state.error = error.message ?? String(error)
      throw error
    }
  }

  ctx.on('agent/created', async ({ agent, source, signal }) => {
    await mount(agent)
    if (current().forceAgentTeams && source === 'startup' && agent.session.header.origin !== 'subagent' && agent.session.firstLiveSeq === 0) {
      const teams = ctx.get('agentTeams')
      if (!teams) throw new Error('Agent Teams is unavailable; cannot apply the configured startup default.')
      await teams.setEnabled(agent, true, signal)
    }
  })
  ctx.on('agent/disposed', ({ agent }) => { mounts.delete(agent) })
  for (const agent of ctx.agents.list()) await mount(agent)

  ctx.systemPrompt.context({
    name: 'cross-model-worker-default',
    order: ctx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION'),
    text: context => {
      const agent = context.agent
      if (!agent || agent.session.header.origin === 'subagent' || !mounts.get(agent)?.ready) return ''
      let selection
      try { selection = resolveDefault(current(), agent.id) } catch (error) { return `Worker default configuration is invalid: ${error.message}. Report the failure; do not claim delegated work used the configured model.` }
      if (!selection.route) return ''
      return `Worker model configured by the user for this session: ${selection.route.provider}/${selection.route.model}. `
        + 'Use subagent without provider/model arguments for well-scoped implementation, simple coding and verification tasks; its native tool defaults select this worker model at execution time. '
        + 'Keep planning, task decomposition, integration and final review in the parent agent. Check worker changes and test evidence before accepting them. '
        + 'For review needing the parent model and conversation, subagent_fork retains the native parent-model behavior. '
        + 'Explicit provider/model arguments on subagent remain subject to the native session allowlist; this plugin does not expand that allowlist. '
        + 'Do not delegate trivial one-step work solely because a worker default exists.'
    },
  })

  function rootOf(agent) { return ctx.subagents.rootOf(agent) }
  function status(agent, targetId) {
    const root = rootOf(agent)
    const id = targetId ?? root.id
    const target = ctx.agents.get(id)
    const settings = current()
    let selection = null, configurationError = null
    try { selection = resolveDefault(settings, id) } catch (error) { configurationError = error.message }
    let policy = null
    if (target) {
      const events = target.session.snapshotEvents()
      policy = events.find(event => event.type === 'subagent/model-selection-policy')?.data.allowedModels ?? null
    }
    const installation = target ? mounts.get(target) : undefined
    return {
      sessionId: id,
      callingAgentSessionId: agent.id,
      rootSessionId: root.id,
      parentRoute: target?.model.current() ?? null,
      selection,
      settings,
      configurationError,
      presetId: target ? (ctx.get('agentPresets')?.composedPreset(target.ctx) ?? target.session.header.agentPreset ?? null) : null,
      nativeToolPresent: target ? !!target.ctx.tools.get('subagent', target) : false,
      nativeSubagentOverride: installation?.ready === true,
      installationError: installation?.error ?? null,
      application: !target ? 'next-open' : installation?.ready ? 'next-subagent-call' : 'unavailable-for-this-preset',
      explicitModelPolicy: policy,
      forkBehavior: 'native-parent-model',
      note: 'Defaults are read at each subagent call. Already running children keep their model. Explicit model overrides use native authorization.',
    }
  }

  async function configure(agent, request, signal) {
    const root = rootOf(agent)
    const id = request.sessionId ?? root.id
    if (request.mode === 'route') await validateCatalogRoute(ctx.llm, checkedRoute(request.provider, request.model), signal)
    signal?.throwIfAborted()
    const editor = ctx.get('configEditor')
    const entry = ctx.fiber.entry
    if (!editor || !entry) throw new Error('Configuration is not editable in this profile.')
    // The editor serializes edits and preserves all fields we do not own.
    await editor.edit(entry, raw => {
      const resolved = snapshotSettings({ ...current(), ...raw })
      const next = updateSettings(resolved, request, id)
      return { ...raw, routingEnabled: next.routingEnabled, defaultProvider: next.defaultProvider,
        defaultModel: next.defaultModel, sessionDefaults: next.sessionDefaults }
    })
    return { ok: true, ...status(agent, id) }
  }

  ctx.tools.register({
    name: 'cross_model_subagent_status',
    description: 'Read the configured default worker model and actual native subagent override for the current root session (or a supplied sessionId). Distinguishes default routing from explicit-model authorization. Does not change configuration.',
    parameters: { type: 'object', properties: { sessionId: { type: 'string' } }, additionalProperties: false },
    output, isConcurrencySafe: () => true,
    async execute(args, exec) { return status(exec.agent, args.sessionId) },
  })
  ctx.tools.register({
    name: 'cross_model_subagent_configure',
    description: 'Set a global or per-session default worker model. scope=session targets the current root session unless sessionId is supplied. mode=route sets provider/model; parent uses the parent model; inherit removes a session override. Applies to the next native subagent call, including existing sessions. Does not modify the native allowlist or running children. Validate the exact advertised route before saving.',
    parameters: { type: 'object', properties: {
      scope: { type: 'string', enum: ['global', 'session'] },
      mode: { type: 'string', enum: ['route', 'parent', 'inherit'] },
      sessionId: { type: 'string' }, provider: { type: 'string' }, model: { type: 'string' },
    }, required: ['scope', 'mode'], additionalProperties: false },
    output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      try { return await configure(exec.agent, args, exec.signal) }
      catch (error) { return { ok: false, error: error.message ?? String(error) } }
    },
  })
}
