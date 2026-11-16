/** Update checking for this plugin. Pure functions plus one injected-fetch
 * network probe. No external dependencies; only node built-ins. */

export const REPOSITORY = {
  owner: 'WTYJ',
  repo: 'dsh-cross-model-subagent',
  branch: 'main',
  url: 'https://github.com/WTYJ/dsh-cross-model-subagent',
  git: 'https://github.com/WTYJ/dsh-cross-model-subagent.git',
}

const HOST = 'github.com'
const MAX_BODY = 1024 * 1024

/** Split a semver string into numbers and prerelease identifiers, or null. */
function parseSemver(value) {
  if (typeof value !== 'string') return null
  const str = value.trim()
  if (!str) return null
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(str)
  if (!match) return null
  const core = [Number(match[1]), Number(match[2]), Number(match[3])]
  const pre = match[4] === undefined ? null : match[4].split('.')
  if (pre) {
    for (const id of pre) {
      if (id === '') return null
      if (/^\d+$/.test(id) && id.length > 1 && id.startsWith('0')) return null
    }
  }
  return { core, pre }
}

/** Compare two dot-separated prerelease identifier lists per semver. */
function comparePrerelease(a, b) {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) {
      const dx = Number(x)
      const dy = Number(y)
      if (dx !== dy) return dx < dy ? -1 : 1
    } else if (nx) return -1
    else if (ny) return 1
    else if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** Strict semantic-version comparison. Returns -1/0/1 or null for invalid input. */
export function compareVersions(a, b) {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (!left || !right) return null
  for (let i = 0; i < 3; i++) {
    if (left.core[i] !== right.core[i]) return left.core[i] < right.core[i] ? -1 : 1
  }
  return comparePrerelease(left.pre, right.pre)
}

/** Validate a full 40-char commit sha and build the pinned Git spec. */
export function buildGitSpec(sha) {
  if (typeof sha !== 'string' || !/^[0-9a-fA-F]{40}$/.test(sha)) {
    throw new Error('A full 40-character hexadecimal commit sha is required.')
  }
  return `${REPOSITORY.git}#${sha.toLowerCase()}`
}

/** Normalize a source string to `host/owner/repo` (no protocol, no .git). */
function normalizeOrigin(source) {
  if (typeof source !== 'string') return null
  let str = source.trim()
  if (!str) return null
  // Drop a trailing git subpath fragment (`#sha&path:` or `#sha`).
  const hashAt = str.indexOf('#')
  if (hashAt !== -1) str = str.slice(0, hashAt)
  // Stripping the executable-ish prefixes.
  str = str.replace(/^git\+/i, '')
  // scp-like shorthand `user@host:owner/repo`.
  let host
  let path
  const scp = /^[^/@]+@([^/:]+):(.+)$/.exec(str)
  if (scp) {
    host = scp[1]
    path = scp[2]
  } else {
    // A host shorthand (`github:owner/repo`) stands for a known host.
    const shorthand = /^(?:github|gitlab|bitbucket|gist):(.+)$/i.exec(str)
    if (shorthand) {
      const known = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org', gist: 'gist.github.com' }
      host = known[str.slice(0, str.indexOf(':')).toLowerCase()]
      path = shorthand[1]
    } else {
      // Strip protocol and credentials.
      let rest = str.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      const at = rest.indexOf('@')
      if (at !== -1) rest = rest.slice(at + 1)
      const slash = rest.indexOf('/')
      if (slash === -1) return null
      host = rest.slice(0, slash)
      path = rest.slice(slash + 1)
    }
  }
  if (!host || !path) return null
  // Strip port from host.
  host = host.replace(/:\d+$/, '').toLowerCase()
  path = path.replace(/^\/+/, '').replace(/\/+$/, '')
  path = path.replace(/\.git$/i, '')
  // GitHub owner/repo paths are case-insensitive for the repository identity.
  path = path.toLowerCase()
  if (!path) return null
  return `${host}/${path}`
}

/** Minimal equivalent of pinnedGitOrigin: `host/owner/repo` or null. */
export function gitOriginOf(spec) {
  return normalizeOrigin(spec)
}

const EXPECTED_ORIGIN = `${HOST}/${REPOSITORY.owner}/${REPOSITORY.repo}`.toLowerCase()

/** Normalize installedSource to `{kind, spec}`; missing input degrades to unknown. */
function normalizeInstalled(installedSource) {
  if (installedSource && typeof installedSource === 'object') {
    const kind = typeof installedSource.kind === 'string' ? installedSource.kind : 'unknown'
    const spec = typeof installedSource.spec === 'string' ? installedSource.spec : null
    return { kind, spec }
  }
  return { kind: 'unknown', spec: null }
}

/** Machine-readable blocker code, or null when a git self-update is possible.
 * kind is expected to be inferred by the caller from BundleInfo.source. */
export function selfUpdateBlocker(installedSource, latestCommit) {
  const installed = normalizeInstalled(installedSource)
  if (installed.kind === 'link' || installed.kind === 'path') return 'link-install'
  if (installed.kind !== 'git') return 'unmanaged-source'
  if (!installed.spec) return 'unmanaged-source'
  if (gitOriginOf(installed.spec) !== EXPECTED_ORIGIN) return 'foreign-origin'
  if (typeof latestCommit !== 'string' || !/^[0-9a-fA-F]{40}$/.test(latestCommit)) return 'no-commit'
  return null
}

/** Strip control characters and truncate to 400 chars. */
function sanitizeNotes(message) {
  if (typeof message !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const cleaned = message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (!cleaned) return undefined
  return cleaned.length > 400 ? cleaned.slice(0, 400) : cleaned
}

/** Read a response body as text with a 1 MiB cap. Reads the full stream via
 * resp.text() first, then checks length — deliberately not a streaming cut. */
async function readCapped(response) {
  const lengthHeader = response.headers?.get?.('content-length')
  if (lengthHeader && Number(lengthHeader) > MAX_BODY) return null
  const text = await response.text()
  if (typeof text === 'string' && text.length > MAX_BODY) return null
  return text
}

/** Check the public repository for a newer release. Never throws for network
 * or payload problems; those surface as status:'error' with an English reason. */
export async function checkForUpdate({ fetchImpl = fetch, signal, currentVersion, installedSource, timeoutMs = 8000 } = {}) {
  const installed = normalizeInstalled(installedSource)
  const fetchAttempts = []
  const result = {
    status: 'error',
    currentVersion: currentVersion ?? null,
    latestVersion: null,
    latestCommit: null,
    publishedAt: null,
    notes: undefined,
    installedSource: { kind: installed.kind, origin: installed.kind === 'git' ? gitOriginOf(installed.spec) : null },
    canSelfUpdate: false,
    reason: null,
    spec: null,
    fetchAttempts,
    checkedAt: new Date().toISOString(),
  }

  const timeout = AbortSignal.timeout(timeoutMs)
  const composite = signal ? AbortSignal.any([signal, timeout]) : timeout

  function fail(code, reason) {
    result.status = 'error'
    result.reason = reason
    return result
  }

  function emptyRepository() {
    // Nothing is published yet: this is not a failure to reach GitHub, and the
    // page reports it as such so a fresh repository does not look broken.
    result.status = 'empty'
    result.reason = 'The repository has no commits on its default branch yet, so there is nothing to compare against.'
    return result
  }

  function blockerReason(code) {
    switch (code) {
      case 'link-install': return 'This copy is installed from a local link or path, so it cannot be upgraded in place; a one-time migration to a Git install is required.'
      case 'unmanaged-source': return 'The installation source is not a managed Git copy of this repository, so self-update is unavailable.'
      case 'foreign-origin': return 'The installed copy does not originate from the expected repository, so it cannot self-update.'
      case 'no-commit': return 'The installed copy cannot be pinned because the latest commit sha is unavailable.'
      default: return 'Self-update is unavailable.'
    }
  }

  let commitSha = null

  // 1. Latest commit on the default branch.
  const commitUrl = `https://api.github.com/repos/${REPOSITORY.owner}/${REPOSITORY.repo}/commits/${REPOSITORY.branch}`
  const commitAttempt = { url: commitUrl }
  fetchAttempts.push(commitAttempt)
  try {
    const res = await fetchImpl(commitUrl, {
      // GitHub asks clients to identify themselves; an anonymous UA is rate-limited sooner.
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-cross-model-subagent' },
      signal: composite,
    })
    commitAttempt.status = res?.status ?? null
    if (res?.status === 409 || res?.status === 404) {
      // GitHub answers 409 "Git Repository is empty" and 404 for a missing
      // repository or branch; both mean there is nothing published yet.
      commitAttempt.problem = `HTTP ${res.status}`
      commitAttempt.reason = 'empty-repository'
      return emptyRepository()
    }
    if (!res || !res.ok) {
      commitAttempt.problem = `HTTP ${res?.status ?? 'unknown'}`
      commitAttempt.reason = 'commit-request-failed'
      return fail('commit-request-failed', `Commit request failed with HTTP ${res?.status ?? 'unknown'}.`)
    }
    const body = await readCapped(res)
    if (body === null) {
      commitAttempt.problem = 'body-too-large'
      return fail('body-too-large', 'Commit response exceeded the 1 MiB limit.')
    }
    let json
    try {
      json = JSON.parse(body)
    } catch {
      commitAttempt.problem = 'invalid-json'
      return fail('invalid-json', 'Commit response was not valid JSON.')
    }
    const sha = json?.sha
    if (typeof sha !== 'string' || !/^[0-9a-fA-F]{40}$/.test(sha)) {
      commitAttempt.problem = 'invalid-sha'
      return fail('invalid-sha', 'Commit response did not include a valid 40-character sha.')
    }
    commitSha = sha.toLowerCase()
    result.latestCommit = commitSha
    const date = json?.commit?.committer?.date ?? json?.commit?.author?.date ?? null
    result.publishedAt = typeof date === 'string' ? date : null
    const notes = sanitizeNotes(json?.commit?.message)
    if (notes) result.notes = notes
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      commitAttempt.problem = 'timeout'
      return fail('timeout', 'Request timed out or was aborted.')
    }
    commitAttempt.problem = 'network'
    return fail('network', 'Network error while contacting the GitHub API.')
  }

  // 2. Published version from the raw package manifest.
  const manifestUrl = `https://raw.githubusercontent.com/${REPOSITORY.owner}/${REPOSITORY.repo}/${REPOSITORY.branch}/package.json`
  const manifestAttempt = { url: manifestUrl }
  fetchAttempts.push(manifestAttempt)
  let latestVersion = null
  try {
    const res = await fetchImpl(manifestUrl, { headers: { 'User-Agent': 'dsh-cross-model-subagent' }, signal: composite })
    manifestAttempt.status = res?.status ?? null
    if (!res || !res.ok) {
      manifestAttempt.problem = `HTTP ${res?.status ?? 'unknown'}`
      return fail('manifest-request-failed', `Manifest request failed with HTTP ${res?.status ?? 'unknown'}.`)
    }
    const body = await readCapped(res)
    if (body === null) {
      manifestAttempt.problem = 'body-too-large'
      return fail('body-too-large', 'Manifest response exceeded the 1 MiB limit.')
    }
    let json
    try {
      json = JSON.parse(body)
    } catch {
      manifestAttempt.problem = 'invalid-json'
      return fail('invalid-json', 'Manifest response was not valid JSON.')
    }
    if (!json || typeof json.version !== 'string' || !json.version.trim()) {
      manifestAttempt.problem = 'missing-version'
      return fail('missing-version', 'Manifest is missing a version field.')
    }
    if (!json.dsh || !json.dsh.bundle) {
      manifestAttempt.problem = 'missing-bundle'
      return fail('missing-bundle', 'Manifest is missing the dsh.bundle marker.')
    }
    latestVersion = json.version.trim()
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      manifestAttempt.problem = 'timeout'
      return fail('timeout', 'Request timed out or was aborted.')
    }
    manifestAttempt.problem = 'network'
    return fail('network', 'Network error while fetching the published manifest.')
  }

  result.latestVersion = latestVersion

  // 3. Version comparison (only when both sides are valid semver).
  const cmp = compareVersions(currentVersion, latestVersion)
  if (cmp === null) {
    result.status = 'unknown-version'
    result.reason = 'Current or latest version is not a valid semantic version, so no comparison is possible.'
    return result
  }

  // 4. Determine whether the running copy can self-update.
  const blocker = selfUpdateBlocker(installed, commitSha)
  if (blocker === null) {
    result.canSelfUpdate = true
    result.spec = buildGitSpec(commitSha)
  } else {
    result.canSelfUpdate = false
    result.reason = blockerReason(blocker)
  }

  // cmp compares current vs latest: negative means latest is newer.
  if (cmp < 0) result.status = 'ready'
  else if (cmp === 0) result.status = 'up-to-date'
  else result.status = 'ahead'

  // A pending release that this copy cannot install keeps canSelfUpdate false,
  // but a version problem must not hide which version is published.
  if (cmp >= 0) result.spec = null
  return result
}
