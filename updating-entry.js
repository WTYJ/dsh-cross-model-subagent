/** Update checks and installation for the settings page.
 *
 * A Client half cannot call Host modules, and this installation exposes no
 * generic bridge for third-party Remote methods. This row therefore serves one
 * narrow route on the plugin's own Host server: it accepts only two fixed
 * actions, validates every page-supplied value, carries no credentials, and
 * delegates installation to DSH's plugin manager so profile files, rollback,
 * and restart reporting stay framework-owned. */
import { REPOSITORY } from './updating.js'
import { schema } from './installed.js'
import { PACKAGE_NAME, applyUpdate, installedVersion, isPinnedSpec, updateStatus } from './updating-host.js'

const z = schema()

export const name = 'cross-model-subagent-updates'
// `webServer` is DSH's browser HTTP carrier; without it this row stays inactive.
export const inject = ['tools', 'webServer']

export const Config = z.object({
  // Bound on one GitHub lookup and on one installation request.
  checkTimeoutMs: z.natural().min(1000).max(60000).default(8000),
})

export const ROUTE = '/model-delegation/update'
const MAX_BODY = 8 * 1024

const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

function json(res, value, status = 200) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/** Read at most MAX_BODY bytes of a request body as UTF-8 text. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) { reject(new Error('Request body is too large.')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function apply(ctx, config = {}) {
  const timeoutMs = Number(config.checkTimeoutMs) > 0 ? Number(config.checkTimeoutMs) : 8000
  const managerOf = () => ctx.get('pluginManager')
  const version = installedVersion()

  async function run(action, payload, signal) {
    const manager = managerOf()
    if (!manager) return { ok: false, action, message: 'The plugin manager is unavailable in this profile, so updates cannot be managed here.' }
    if (action === 'check') return { ...await updateStatus(manager, PACKAGE_NAME, { signal, timeoutMs }), action }
    const request = { version: payload?.version, spec: payload?.spec, name: PACKAGE_NAME }
    if (typeof request.version !== 'string' || typeof request.spec !== 'string' || !isPinnedSpec(request.spec)) {
      return { ok: false, action, message: 'Send a version and its pinned commit returned by check.' }
    }
    return { ...await applyUpdate(manager, request), action }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    async handler(req, res) {
      const signal = AbortSignal.timeout(timeoutMs * 12)
      // Only the plugin's own page posts here; other methods and origins get no action.
      if (req.method !== 'POST') { json(res, { ok: false, message: 'POST required.' }, 405); return }
      const origin = req.headers.origin
      if (typeof origin === 'string' && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
        json(res, { ok: false, message: 'Cross-origin updates are refused.' }, 403); return
      }
      try {
        let payload
        try { payload = JSON.parse(await readBody(req)) } catch (error) { json(res, { ok: false, message: error.message }, 400); return }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) { json(res, { ok: false, message: 'The body must be an object.' }, 400); return }
        if (payload.action !== 'check' && payload.action !== 'apply') { json(res, { ok: false, message: 'Unknown action.' }, 400); return }
        const result = await run(payload.action, payload, signal)
        json(res, { ...result, repository: REPOSITORY.url, reportedVersion: version }, result.ok === false && payload.action === 'apply' ? 502 : 200)
      } catch (error) {
        json(res, { ok: false, message: error?.message ?? String(error) }, 502)
      }
    },
  }), 'cross-model-subagent: update route')

  ctx.tools.register({
    name: 'cross_model_subagent_update',
    description: 'Check the public repository for a newer release of this plugin, or install the checked release. Installation goes through the DSH plugin manager, which rolls back a failed change and reports whether a restart is required. This tool never edits profile files.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['check', 'apply'] },
        version: { type: 'string', description: 'apply: the checked latest version.' },
        spec: { type: 'string', description: 'apply: the pinned git spec returned by check.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      try {
        return await run(args.action === 'apply' ? 'apply' : 'check', args, exec.signal)
      } catch (error) {
        return { ok: false, error: error?.message ?? String(error) }
      }
    },
  })

  return { route: ROUTE, version, repository: REPOSITORY }
}
