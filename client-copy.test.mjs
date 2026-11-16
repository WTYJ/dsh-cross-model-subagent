/** Guard against a missing translation key: every `t('key')` used by the panel
 * must exist in each dictionary, so adding a label cannot silently render the
 * raw key at runtime. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const start = source.indexOf('const dict = {')
const end = source.indexOf('// Verified theme tokens')
assert.ok(start !== -1 && end > start, 'the dictionary block must be locatable')

// Evaluate only the literal dictionaries: no React, no module loader, no DOM.
const sandbox = {}
vm.runInNewContext(source.slice(start, end).replace('const dict = {', 'dict = {'), sandbox)
const dict = sandbox.dict

const used = [...new Set([...source.matchAll(/t\('([A-Za-z]+)'\)/g)].map((match) => match[1]))]

test('the panel renders text through t() only', () => {
  assert.ok(used.length > 40, 'the panel should use the dictionaries for its labels')
})

for (const locale of ['zh', 'en']) {
  test(`every used key exists in ${locale}`, () => {
    const missing = used.filter((key) => !(key in dict[locale]))
    assert.deepEqual(missing, [], `${locale} is missing: ${missing.join(', ')}`)
  })
}

test('both dictionaries define the same keys', () => {
  const zh = Object.keys(dict.zh).sort()
  const en = Object.keys(dict.en).sort()
  assert.deepEqual(zh, en, 'a key present in one language but not the other leaves a raw key on screen')
})
