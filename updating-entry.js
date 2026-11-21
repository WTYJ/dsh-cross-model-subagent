/** Update checks and installation for the settings page.
 *
 * A Client half cannot call Host modules, and this installation exposes no
 * generic bridge for third-party Remote methods. This row therefore serves one
 * narrow route on the plugin's own Host server: it accepts only two fixed
 * actions and verifies installation requests through DSH Connection. The
 * plugin manager owns installation, profile files, rollback, and restart reporting. */
import { REPOSITORY } from './updating.js'
import { manifestOf, schema } from './installed.js'
import { PACKAGE_NAME, applyUpdate, isPinnedSpec, updateStatus } from './updating-host.js'

const z = schema()

export const name = 'cross-model-subagent-updates'
// `webServer` is DSH's browser HTTP carrier; without it this row stays inactive.
export const inject = ['tools', 'webServer']

export const Config = z.object({
  // Bound on one GitHub lookup and on one installation request.
  checkTimeoutMs: z.natural().min(1000).max(60000).default(8000),
})

/** This file's own manifest: the running copy, not a name assumed in advance. */
const SELF = manifestOf(import.meta.url)
const LOCAL_PREVIEW = SELF.localPreview === true

export const ROUTE = '/model-delegation/update'
const MAX_BODY = 8 * 1024

/** Package names to look up, with the running name before historical names. */
export function candidateNames(self = SELF) {
  const names = [self?.name, ...(Array.isArray(self?.previousNames) ? self.previousNames : []), PACKAGE_NAME]
  return [...new Set(names.filter(name => typeof name === 'string' && name.length > 0))]
}

const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

function json(res, value, status = 200) {
  if (res.destroyed || res.writableEnded) return
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/** Read at most MAX_BODY bytes of a request body as UTF-8 text. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    let failed = false
    const chunks = []
    req.on('data', chunk => {
      if (failed) return
      size += chunk.length
      if (size > MAX_BODY) {
        failed = true
        req.resume()
        reject(new Error('Request body is too large.'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

export function apply(ctx, config = {}) {
  return mountUpdater(ctx, config)
}

export function mountUpdater(ctx, config, { route = ROUTE, registerTool = true, fetchImpl } = {}) {
  const timeoutMs = Number(config.checkTimeoutMs) > 0 ? Number(config.checkTimeoutMs) : 8000
  const managerOf = () => ctx.get('pluginManager')
  const version = typeof SELF?.version === 'string' ? SELF.version : null
  const names = LOCAL_PREVIEW ? [SELF.name] : candidateNames()
  // GitHub allows 60 anonymous requests per hour per IP and one check costs two, so the
  // last good answer is reused for a while instead of being re-fetched on every visit.
  let cache
  let applying = false

  async function run(action, payload, signal) {
    const manager = managerOf()
    if (!manager) return { ok: false, action, message: 'The plugin manager is unavailable in this profile, so updates cannot be managed here.' }
    if (action === 'check') {
      const result = await updateStatus(manager, names, { fetchImpl, signal, timeoutMs, cache, force: payload?.force === true })
      if (result.cacheable && !result.cached) {
        const { latestVersion, latestCommit, publishedAt, notes, fetchAttempts } = result
        cache = { at: Date.now(), payload: { latestVersion, latestCommit, publishedAt, notes, fetchAttempts } }
      }
      if (LOCAL_PREVIEW) return { ...result, action, localPreview: true }
      if (result.installed && result.name !== PACKAGE_NAME) {
        return { ...result, action, canSelfUpdate: false, spec: null,
          reason: `This copy uses the former package name ${result.name}. Reinstall from ${REPOSITORY.url} to switch to ${PACKAGE_NAME}.` }
      }
      return { ...result, action }
    }
    if (LOCAL_PREVIEW) return { ok: false, action, message: 'Refresh the local preview from the workspace to update it.' }
    const request = { version: payload?.version, spec: payload?.spec, name: PACKAGE_NAME }
    if (typeof request.version !== 'string' || !isPinnedSpec(request.spec)) {
      return { ok: false, action, message: 'Send a version and its pinned commit returned by check.' }
    }
    if (applying) return { ok: false, action, message: 'An update is already in progress.' }
    applying = true
    try {
      const checked = await updateStatus(manager, [PACKAGE_NAME], { cache, cacheOnly: true })
      if (checked.status !== 'ready' || !checked.canSelfUpdate ||
          checked.latestVersion !== request.version || checked.spec !== request.spec) {
        return { ok: false, action, message: 'Check for updates again and install the version and commit offered for this installation.' }
      }
      signal?.throwIfAborted()
      return { ...await applyUpdate(manager, request), action }
    } finally {
      applying = false
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: route,
    async handler(req, res) {
      if (req.method !== 'POST') { json(res, { ok: false, message: 'POST required.' }, 405); return }
      // Electron forwards an authenticated request without Origin. Connection
      // verifies the credentials for installation whether Origin is present or not.
      const signal = AbortSignal.timeout(timeoutMs * 12)
      const origin = req.headers.origin
      if (typeof origin === 'string' && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
        json(res, { ok: false, message: 'Cross-origin updates are refused.' }, 403); return
      }
      try {
        let payload
        try { payload = JSON.parse(await readBody(req)) } catch (error) { json(res, { ok: false, message: error.message }, 400); return }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) { json(res, { ok: false, message: 'The body must be an object.' }, 400); return }
        if (payload.action !== 'check' && payload.action !== 'apply') { json(res, { ok: false, message: 'Unknown action.' }, 400); return }
        if (payload.action === 'apply') {
          const connection = ctx.get('connection')
          if (typeof connection?.admit !== 'function') {
            return json(res, { ok: false, message: 'DSH authentication is unavailable in this profile.' }, 503)
          }
          const admission = connection.admit(req)
          if (admission.rejection === 401) {
            return json(res, { ok: false, message: 'Open the authenticated DSH interface and try again.' }, 401)
          }
          if (admission.peer?.principal.kind !== 'owner') {
            return json(res, { ok: false, message: 'Installing updates requires DSH owner access.' }, 403)
          }
        }
        const result = await run(payload.action, payload, signal)
        // `cacheable` and the internal error text stay on this side of the wire.
        const { cacheable: _cacheable, ...publicResult } = result
        json(res, { ...publicResult, repository: REPOSITORY.url, reportedVersion: version }, result.ok === false && payload.action === 'apply' ? 502 : 200)
      } catch (error) {
        json(res, { ok: false, message: error?.message ?? String(error) }, 502)
      }
    },
  }), 'cross-model-subagent: update route')

  if (registerTool) ctx.tools.register({
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

  return { route, version, repository: REPOSITORY }
}
