export const STATUS_ROUTE = '/model-delegation/status'

const loopback = /^(?:::1|(?:::ffff:)?127(?:\.\d{1,3}){3})$/i

/** Expose only the panel summary on the local Web listener. */
export function registerStatusRoute(ctx, readStatus, path = STATUS_ROUTE) {
  const server = ctx.get('webServer')
  if (!server) return
  ctx.effect(() => server.register({
    kind: 'exact', path,
    async handler(req, res) {
      const respond = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(body))
      }
      const origin = server.getOrigin()
      const host = new URL(origin).host
      if (req.method !== 'POST') return respond(405, { ok: false })
      if (!loopback.test(req.socket.remoteAddress ?? '') || req.headers.host !== host
        || req.headers.origin !== origin) return respond(403, { ok: false })
      const id = new URL(req.url, origin).searchParams.get('sessionId')
      if (!id || id.length > 160) return respond(400, { ok: false })
      try {
        const status = await readStatus(id)
        return respond(200, {
          ok: true,
          application: status.application,
          parentRoute: status.parentRoute,
          selection: status.selection,
          nativeToolPresent: status.nativeToolPresent,
          presetId: status.presetId,
          configurationInvalid: !!status.configurationError,
          mountFailed: !!status.installationError,
        })
      } catch {
        return respond(503, { ok: false })
      }
    },
  }), 'model delegation: session status route')
}
