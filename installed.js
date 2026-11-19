/** Resolve bundled DSH packages from the running installation.
 *
 * A linked or Git-installed bundle has no `node_modules` of its own, so the
 * installation is found through the Host-provided anchors and the executable
 * path. Inside the packaged Desktop the archive is opaque to Node's resolver;
 * the running Host resolves it natively, and tests normally run under the
 * installation's own runtime. */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)

/** Directories whose `node_modules` may hold the installation's packages. */
function installAnchors() {
  const exe = path.dirname(process.execPath)
  const anchors = [
    process.env.DSH_INSTALL_DIR,
    process.env.DSH_PROFILE_DIR,
    path.join(exe, 'resources', 'app.asar', 'dsh'),
    path.join(exe, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh'),
    path.dirname(exe),
  ].filter(Boolean)
  // A package beside this file only resolves when the bundle was linked into a
  // profile that already holds the DSH packages.
  anchors.push(path.dirname(new URL('.', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')))
  return [...new Set(anchors)]
}

export function resolveInstalled(specifier) {
  for (const anchor of installAnchors()) {
    try { return require.resolve(specifier, { paths: [anchor] }) } catch { /* next anchor */ }
  }
  try { return require.resolve(specifier) } catch { /* fall through */ }
  throw new Error(`Cannot resolve ${specifier} from the running DSH installation.`)
}

/** The installation's Schemastery, whose default export carries the schema API. */
export function schema() {
  const loaded = require(resolveInstalled('@deepseek-ai/schemastery'))
  return loaded.default ?? loaded
}

/** Everything this bundle declares about itself, read from beside the running module.
 * @param moduleUrl - the module whose directory holds the manifest.
 * @returns the parsed manifest, throwing when it is unreadable.
 */
export function manifestOf(moduleUrl) {
  const file = new URL('./package.json', moduleUrl)
  return JSON.parse(readFileSync(fileURLToPath(file), 'utf8'))
}

