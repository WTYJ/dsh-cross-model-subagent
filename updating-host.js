/** Update checks for the settings page.
 *
 * The page calls this plugin's Host-side functions through its own bridge. An
 * installation is delegated to DSH's plugin manager, so profile files,
 * rollback, and restart reporting stay owned by the framework instead of being
 * reimplemented in the page. Nothing here edits profile files. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { REPOSITORY, buildGitSpec, checkForUpdate, selfUpdateBlocker } from './updating.js'

export const PACKAGE_NAME = '@wtyj/dsh-cross-model-subagent'

/** Read this bundle's own version from beside the running module. */
export function installedVersion(moduleUrl = import.meta.url) {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', moduleUrl)), 'utf8'))
  return typeof manifest.version === 'string' ? manifest.version : null
}

const HOSTED = /^https?:\/\/[^/\s]+\/[^/\s]+\/[^/#\s]+(?:\.git)?(?:#.*)?$/i

/** Classify a profile dependency value: link, local path, git address, or registry range.
 *
 * Accepts either a saved dependency value (`link:...`, `file:...`, a Git address, a
 * version range) or the resolved directory DSH reports as a bundle's source, which is
 * the same value with its protocol prefix already stripped. A filesystem-looking path
 * is therefore a link install, not a registry range.
 */
export function sourceKind(value) {
  if (typeof value !== 'string' || !value.trim()) return 'unknown'
  const spec = value.trim()
  if (/^(?:link|file):/i.test(spec)) return 'link'
  // A version range starts with `^`, `~`, or a digit; only a path segment separator makes a
  // value a directory, so `~0.1.0` stays a registry range while `~/src` is a path.
  if (/^[A-Za-z]:[\\/]|^[\\/]/.test(spec)) return 'path'
  if (/^~[\\/]/.test(spec)) return 'path'
  if (/^\.{1,2}[\\/]/.test(spec)) return 'path'
  if (/^(?:github|gitlab|bitbucket|gist):/i.test(spec) || /^git(?:\+[a-z]+)?:\/\//i.test(spec)
    || /^git@[^:]+:/i.test(spec) || HOSTED.test(spec)) return 'git'
  return 'registry'
}

/**
 * Check the repository for a newer release and report whether this copy can install it.
 * @param manager the plugin manager service.
 * @param names package names to look for, most specific first. The copy that is actually
 *   running wins, so a profile still holding an older package name is not reported as
 *   "not installed".
 * @param options.version override the installed version (tests).
 * @param options.cache previous result to reuse while fresh (spares the anonymous quota).
 * @param options.force skip the cache, for an explicit "check again".
 */
export async function updateStatus(manager, names = [PACKAGE_NAME], { version, fetchImpl, signal, timeoutMs, cache, force } = {}) {
  const candidates = (Array.isArray(names) ? names : [names]).filter(name => typeof name === 'string' && name)
  if (candidates.length === 0) candidates.push(PACKAGE_NAME)
  let bundles
  try {
    bundles = await manager.listBundles()
  } catch (error) {
    return { ok: false, name: candidates[0], installed: false, message: error?.message ?? String(error) }
  }
  const bundle = candidates.map(name => bundles.find(item => item.name === name)).find(item => item !== undefined)
  const name = bundle?.name ?? candidates[0]
  const currentVersion = version ?? bundle?.version ?? null
  if (!bundle) {
    return {
      ok: false,
      name,
      installed: false,
      currentVersion,
      message: `This plugin is not installed through the plugin manager, so updates cannot be checked from here. Install it from ${REPOSITORY.url} to enable in-page updates.`,
    }
  }
  // BundleInfo.source may be a complete install spec (name@dependency).
  const prefix = `${bundle.name}@`
  const source = typeof bundle.source === 'string' ? bundle.source : undefined
  const dependency = source?.startsWith(prefix) ? source.slice(prefix.length) : source
  const installedSource = { kind: dependency ? sourceKind(dependency) : 'unknown', spec: dependency }
  const check = await checkForUpdate({ fetchImpl, signal, currentVersion, installedSource, timeoutMs, cache, force })
  return {
    ok: true,
    name,
    installed: true,
    enabled: bundle.enabled === true,
    updateChannel: bundle.update ?? null,
    currentVersion,
    latestVersion: check.latestVersion,
    latestCommit: check.latestCommit,
    status: check.status,
    canSelfUpdate: check.canSelfUpdate && bundle.update === 'git',
    spec: check.canSelfUpdate && bundle.update === 'git' ? check.spec : null,
    reason: check.reason,
    notes: check.notes,
    publishedAt: check.publishedAt,
    checkedAt: check.checkedAt,
    cached: check.cached === true,
    retryAfterSeconds: check.retryAfterSeconds,
    // Presented only so the caller can store it; never sent to the browser.
    cacheable: check.cacheable === true,
    installedSource: check.installedSource,
    fetchAttempts: check.fetchAttempts,
    expectedRepository: REPOSITORY.url,
  }
}

/** Map a manager failure to one readable line without leaking internals. */
export function describeFailure(result) {
  const error = result?.error
  if (!error) return 'The update did not complete.'
  const codes = {
    'invalid-spec': 'The target release is not a valid pinned commit of this repository.',
    'operation-error': 'The package manager could not reach the repository or registry.',
    'incompatible-version': 'The target release does not accept the running DSH version.',
    'not-bundle': 'The target release does not declare itself as a DSH bundle.',
    'already-installed': 'An installation with that package name already exists in this profile.',
    'not-removable': 'The installed copy cannot be replaced in this profile.',
    'management-required': 'This installation is managed by the profile and cannot be replaced here.',
  }
  return codes[error.code]
    ?? (typeof error.diagnostic === 'string' ? error.diagnostic.split('\n')[0] : 'The update failed.')
}

/** Whether the running build can install a target without a one-time migration. */
export function updateEligibility(installedSource, latestVersion) {
  const blocker = selfUpdateBlocker(installedSource, latestVersion)
  return blocker === null ? { ok: true, code: null } : { ok: false, code: blocker }
}

/** Whether a spec pins one full commit of this repository. */
export function isPinnedSpec(spec) {
  if (typeof spec !== 'string') return false
  const hash = spec.indexOf('#')
  if (hash === -1) return false
  try { return buildGitSpec(spec.slice(hash + 1)) === spec } catch { return false }
}

/**
 * Apply a checked release through DSH's own updateBundle.
 * @param manager the plugin manager service.
 * @param request { version, spec, name?, requestId? }
 * @returns the manager's outcome plus one readable line.
 */
export async function applyUpdate(manager, request = {}) {
  const name = request.name ?? PACKAGE_NAME
  const { version, spec } = request
  if (typeof version !== 'string' || typeof spec !== 'string' || !isPinnedSpec(spec)) {
    return { ok: false, application: 'failed', message: 'A checked version and its pinned commit are required.' }
  }
  let result
  try {
    result = await manager.updateBundle(name, version, { spec, requestId: request.requestId })
  } catch (error) {
    return { ok: false, application: 'failed', message: error?.message ?? String(error) }
  }
  const application = result?.result?.application ?? 'failed'
  const restored = result?.restore?.application
  return {
    ok: application === 'applied' || application === 'restart-required',
    name,
    from: result?.from ?? null,
    to: result?.to ?? null,
    step: result?.step ?? null,
    application,
    restartReason: result?.result?.restartReason ?? null,
    restored: restored === undefined ? null : restored,
    message: application === 'failed' || application === 'cancelled'
      ? describeFailure(result?.result) + (restored ? ` The previous version was reinstalled (${restored}).` : '')
      : application === 'restart-required'
        ? 'The update is installed; restart DSH to load the new version.'
        : 'The update is installed and active.',
  }
}
