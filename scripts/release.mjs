#!/usr/bin/env node
/** Guarded release helper.
 *
 * `dsh plugin add <git address>` installs exactly one commit, and the in-page
 * updater pins that same commit. Moving the manifest version without a commit
 * would therefore leave every installed copy reporting the old version, and a
 * version without a commit gives the updater nothing to pin. This script keeps
 * the two together: it changes the version, runs the tests, commits, tags, and
 * optionally pushes.
 *
 * Usage (from the package directory):
 *   node scripts/release.mjs patch|minor|major|<x.y.z> [--push]
 *   node scripts/release.mjs --check     # verify the manifest and tests only
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(root, 'package.json')
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' })
const capture = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim()

/** Bump a semver version; `kind` is patch, minor, major, or an exact version. */
export function nextVersion(current, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current)
  if (!match) throw new Error(`The manifest version ${current} is not a plain x.y.z version.`)
  const [major, minor, patch] = match.slice(1).map(Number)
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  if (kind === 'major') return `${major + 1}.0.0`
  throw new Error('Usage: release.mjs patch|minor|major|<x.y.z> [--push]')
}

export function readManifest() {
  return JSON.parse(readFileSync(manifestPath, 'utf8'))
}

function verify() {
  run(process.execPath, ['--check', path.join(root, 'client.js')])
  run(process.execPath, ['--test', 'tests/routing.test.mjs', 'tests/host-integration.test.mjs', 'tests/updating.test.mjs', 'client-data.test.mjs'])
}

function main(argv) {
  const args = argv.slice(2)
  if (args.includes('--check')) {
    verify()
    console.log('Manifest and tests are valid.')
    return
  }
  const kind = args.find(value => !value.startsWith('--'))
  if (!kind) throw new Error('Usage: release.mjs patch|minor|major|<x.y.z> [--push]')
  const status = capture('git', ['status', '--porcelain'])
  if (status !== '') throw new Error('Commit or stash every change first: a release pins one clean commit.')
  verify()
  const manifest = readManifest()
  const version = nextVersion(manifest.version, kind)
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`)
  run('git', ['add', 'package.json'])
  run('git', ['commit', '-m', `release: v${version}`])
  run('git', ['tag', `v${version}`])
  if (args.includes('--push')) {
    run('git', ['push', 'origin', 'HEAD'])
    run('git', ['push', 'origin', `v${version}`])
  }
  console.log(`Released v${version}. Installed copies will see it after the commit reaches main.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv) } catch (error) { console.error(error.message ?? error); process.exitCode = 1 }
}
