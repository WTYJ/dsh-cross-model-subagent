import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { REPOSITORY } from './updating.js'

const exec = promisify(execFile)

/** Variables that would make this isolated repository inherit another Git
 * invocation's state; stripped from the child environment. */
const INHERITED_GIT_VARS = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE',
]

/** Read a public branch tip and its manifest from the same fetched commit. */
export async function readGitRelease(signal) {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-model-update-'))
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
  for (const key of INHERITED_GIT_VARS) delete env[key]
  // An empty credential helper keeps the fetch anonymous even if the profile configures one.
  const git = async (...args) => (await exec('git', ['-c', 'credential.helper=', ...args], {
    cwd, env, signal, windowsHide: true, maxBuffer: 1024 * 1024,
  })).stdout
  try {
    await git('init', '--bare', '--template=')
    await git('fetch', '--depth=1', '--no-tags', REPOSITORY.git, `refs/heads/${REPOSITORY.branch}`)
    const [metadata, manifest] = await Promise.all([
      git('show', '-s', '--format=%H%x00%cI%x00%B', 'FETCH_HEAD'),
      git('show', 'FETCH_HEAD:package.json'),
    ])
    const [sha, date, notes] = metadata.split('\0')
    return { sha, date, notes, manifest }
  } finally {
    await rm(cwd, { recursive: true, force: true, maxRetries: 3 })
  }
}
