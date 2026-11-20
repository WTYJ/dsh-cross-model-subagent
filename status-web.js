const STATUS_ROUTE = '/model-delegation/status'
const TEAM_MODELS_ROUTE = '/model-delegation/team-models'

const loopback = /^(?:::1|(?:::ffff:)?127(?:\.\d{1,3}){3})$/i
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 160

function registerSummaryRoute(ctx, path, read) {
  ctx.inject(['webServer'], webCtx => {
    const server = webCtx.webServer
    webCtx.effect(() => server.register({
      kind: 'exact', path,
      async handler(req, res) {
        const respond = (status, body) => {
          if (res.destroyed) return
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(body))
        }
        const origin = server.getOrigin()
        if (req.method !== 'POST') return respond(405, { ok: false })
        if (!loopback.test(req.socket.remoteAddress ?? '') || req.headers.host !== new URL(origin).host) {
          return respond(403, { ok: false })
        }
        if (req.headers.origin !== origin) {
          if (req.headers.origin !== undefined) return respond(403, { ok: false })
          // Electron removes Origin when forwarding requests and supplies its Host-issued cookie.
          const admission = ctx.get('connection')?.admit?.(req)
          if (admission?.peer?.principal.kind !== 'owner') return respond(admission?.rejection ?? 403, { ok: false })
        }
        const query = new URL(req.url, origin).searchParams
        const id = query.get('sessionId')
        if (!validId(id)) return respond(400, { ok: false })
        const aborted = new AbortController()
        const close = () => aborted.abort()
        res.once('close', close)
        try {
          const signal = AbortSignal.any([aborted.signal, AbortSignal.timeout(5000)])
          const result = await read(id, query, signal)
          return result ? respond(200, { ok: true, ...result }) : respond(400, { ok: false })
        } catch {
          return respond(503, { ok: false })
        } finally {
          res.off('close', close)
        }
      },
    }), `model delegation: ${path}`)
  })
}

/** Expose only the panel summary on the local Web listener. */
export function registerStatusRoute(ctx, readStatus) {
  registerSummaryRoute(ctx, STATUS_ROUTE, async id => {
    const status = await readStatus(id)
    return {
      application: status.application,
      parentRoute: status.parentRoute,
      selection: status.selection,
      nativeToolPresent: status.nativeToolPresent,
      presetId: status.presetId,
      configurationInvalid: !!status.configurationError,
      mountFailed: !!status.installationError,
    }
  })
}

function modelIdentity(route) {
  return typeof route?.provider === 'string' && route.provider && typeof route.model === 'string' && route.model
    ? { provider: route.provider, model: route.model } : null
}

/** A fork can carry its parent's request history. Only inspect the child's own events. */
export function recordedModel(session) {
  const events = session.ownEvents()
  for (let index = events.length - 1; index >= 0; index--) {
    const { type, data } = events[index]
    const route = type === 'request/header' ? data.header.config
      : type === 'request/context' ? data
        : type === 'assistant/message' && data.message.source.kind === 'model' ? data.message.source : null
    const model = modelIdentity(route)
    if (model) return model
  }
  return null
}

export async function readTeamModels(ctx, id, requestedIds, signal) {
  if (requestedIds.length > 20 || !requestedIds.every(validId)) return null
  const root = ctx.agents.get(id)
  if (!root || root.session.header.origin === 'subagent' || !ctx.get('agentTeams')?.isEnabled(root)) {
    return { enabled: false, parentRoute: null, members: [] }
  }
  const requested = new Set(requestedIds)
  const children = new Map()
  for (const event of root.session.ownEvents()) {
    if (event.type === 'subagent/catalog' && requested.has(event.data.childId)) {
      children.set(event.data.childId, event.data.mode)
    }
  }
  const query = ctx.get('sessionQuery')
  const members = await Promise.all([...children].map(async ([childId, mode]) => {
    if (mode === 'external') return { id: childId, route: null }
    try {
      const child = ctx.agents.get(childId)
      if (child) return { id: childId, route: recordedModel(child.session) }
      if (query) return { id: childId, route: (await query.inspectSession(childId, recordedModel, signal)) ?? null }
    } catch {
      signal.throwIfAborted()
    }
    return { id: childId, route: null, failed: true }
  }))
  return { enabled: true, parentRoute: recordedModel(root.session) ?? modelIdentity(root.model.current()), members }
}

export function registerTeamModelsRoute(ctx) {
  registerSummaryRoute(ctx, TEAM_MODELS_ROUTE, (id, query, signal) => readTeamModels(ctx, id, query.getAll('memberId'), signal))
}
