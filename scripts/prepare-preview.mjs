#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'))
const previewName = `${manifest.name}-preview`
const destination = path.resolve(source, '..', previewName)
const previewManifest = path.join(destination, 'package.json')

await mkdir(destination, { recursive: true })
if ((await readdir(destination)).length) {
  const existing = JSON.parse(await readFile(previewManifest, 'utf8'))
  if (existing.name !== previewName || existing.localPreview !== true) {
    throw new Error(`Refusing to overwrite a directory that is not the preview package: ${destination}`)
  }
}

function replaceRequired(content, oldValue, newValue) {
  if (!content.includes(oldValue)) throw new Error(`Preview source no longer contains ${oldValue}`)
  return content.replaceAll(oldValue, newValue)
}

const patch = await readFile(path.join(source, 'cordis.patch.yml'), 'utf8')
const previewPatch = replaceRequired(
  replaceRequired(patch, 'id: cross-model-subagent', 'id: cross-model-subagent-preview'),
  `name: ${manifest.name}`, `name: ${previewName}`,
)
const client = await readFile(path.join(source, 'client.js'), 'utf8')
let previewClient = replaceRequired(client, `id: '${manifest.name}'`, `id: '${previewName}'`)
previewClient = replaceRequired(previewClient, "const CONFIG = 'cross-model-subagent'", "const CONFIG = 'cross-model-subagent-preview'")
previewClient = replaceRequired(previewClient, "panelIcon: '模型分工'", "panelIcon: '模型分工（预览）'")
previewClient = replaceRequired(previewClient, "panelTitle: '模型分工'", "panelTitle: '模型分工（预览）'")
previewClient = replaceRequired(previewClient, "panelIcon: 'Model delegation'", "panelIcon: 'Model delegation (Preview)'")
previewClient = replaceRequired(previewClient, "panelTitle: 'Model delegation'", "panelTitle: 'Model delegation (Preview)'")

const routePrefix = value => replaceRequired(value, "'/model-delegation/", "'/model-delegation-preview/")
const generated = {
  'package.json': `${JSON.stringify({ ...manifest, name: previewName, localPreview: true, previousNames: [], description: `模型分工（预览） · Local development preview. ${manifest.description}` }, null, 2)}\n`,
  'cordis.patch.yml': previewPatch,
  'client.js': routePrefix(previewClient),
}
for (const file of ['status-web.js', 'updating-entry.js']) {
  generated[file] = routePrefix(await readFile(path.join(source, file), 'utf8'))
}

for (const entry of await readdir(source)) {
  const included = manifest.files.some(pattern => pattern === entry || pattern.startsWith(`${entry}/`))
  if (included && !Object.hasOwn(generated, entry)) {
    await cp(path.join(source, entry), path.join(destination, entry), { recursive: true })
  }
}
for (const [file, content] of Object.entries(generated)) {
  await writeFile(path.join(destination, file), content)
}
console.log(destination)
