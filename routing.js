/** Pure default-route selection. These preferences are deployment defaults,
 * not modifications to DSH's immutable explicit-model authorization policy. */
function readField(value) {
  return value && typeof value.get === 'function' ? value.get() : value
}

export function snapshotSettings(config) {
  return {
    routingEnabled: readField(config.routingEnabled) === true,
    defaultProvider: readField(config.defaultProvider) ?? '',
    defaultModel: readField(config.defaultModel) ?? '',
    sessionDefaults: readField(config.sessionDefaults) ?? [],
    forceAgentTeams: readField(config.forceAgentTeams) === true,
    legacyRulesPresent: !['', '{}', undefined, null].includes(readField(config.sessionRoutesJson)),
  }
}

export function checkedRoute(provider, model) {
  if (typeof provider !== 'string' || typeof model !== 'string' || !provider.trim() || !model.trim()) {
    throw new Error('A default worker model requires both an exact provider and model id.')
  }
  return { provider: provider.trim(), model: model.trim() }
}

export function resolveDefault(settings, sessionId) {
  if (!Array.isArray(settings.sessionDefaults)) throw new Error('sessionDefaults must be an array.')
  const [row, duplicate] = settings.sessionDefaults.filter(row => row?.sessionId === sessionId)
  if (duplicate) throw new Error(`Duplicate session override: ${sessionId}`)
  if (row?.mode === 'parent') return { source: 'session-parent', route: null }
  if (row?.mode === 'route') return { source: 'session', route: checkedRoute(row.provider, row.model) }
  if (row) throw new Error(`Unknown session override mode: ${row.mode}`)
  if (settings.routingEnabled) return { source: 'global', route: checkedRoute(settings.defaultProvider, settings.defaultModel) }
  return { source: 'parent', route: null }
}

export function updateSettings(current, request, sessionId) {
  const next = { ...current }
  if (request.scope === 'global') {
    if (request.mode === 'route') {
      const route = checkedRoute(request.provider, request.model)
      next.routingEnabled = true
      next.defaultProvider = route.provider
      next.defaultModel = route.model
    } else if (request.mode === 'parent') next.routingEnabled = false
    else throw new Error('Global mode must be route or parent.')
  } else if (request.scope === 'session') {
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('No target session.')
    if (!Array.isArray(current.sessionDefaults)) throw new Error('sessionDefaults must be an array.')
    next.sessionDefaults = current.sessionDefaults.filter(row => row?.sessionId !== sessionId)
    if (request.mode === 'route') next.sessionDefaults.push({ sessionId, mode: 'route', ...checkedRoute(request.provider, request.model) })
    else if (request.mode === 'parent') next.sessionDefaults.push({ sessionId, mode: 'parent', provider: '', model: '' })
    else if (request.mode !== 'inherit') throw new Error('Session mode must be route, parent or inherit.')
  } else throw new Error('Scope must be global or session.')
  return next
}
