import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCatalogRoute } from '../index.js'

// A minimal llm double exposing exactly the surface validateCatalogRoute uses:
// listProviders / listModels / resolveCallConfig. The implementation is imported
// from ../index.js and never re-implemented here.
function makeLlm({ providers, modelsByProvider, listModelsImpl, resolveImpl } = {}) {
  const calls = { listProviders: 0, listModels: [], resolveCallConfig: [] }
  const llm = {
    listProviders() {
      calls.listProviders += 1
      return providers ?? [{ id: 'magpie' }]
    },
    async listModels(provider) {
      calls.listModels.push(provider)
      if (listModelsImpl) return listModelsImpl(provider)
      const models = modelsByProvider ?? { magpie: [{ id: 'workbuddy/deepseek-v4.1-flash' }] }
      return models[provider] ?? []
    },
    async resolveCallConfig(route, signal) {
      calls.resolveCallConfig.push({ route, signal })
      if (resolveImpl) return resolveImpl(route, signal)
      return { ok: true }
    },
  }
  return { llm, calls }
}

test('declared provider/model succeeds and actually runs the preflight resolveCallConfig', async () => {
  const { llm, calls } = makeLlm()
  const route = { provider: 'magpie', model: 'workbuddy/deepseek-v4.1-flash' }
  const result = await validateCatalogRoute(llm, route)
  assert.equal(result, undefined, 'validateCatalogRoute resolves to undefined on success')
  assert.equal(calls.listProviders, 1)
  assert.deepEqual(calls.listModels, ['magpie'])
  assert.equal(calls.resolveCallConfig.length, 1, 'preflight must be invoked exactly once')
  assert.deepEqual(calls.resolveCallConfig[0].route, route)
})

test('missing provider is rejected before any model lookup or preflight', async () => {
  const { llm, calls } = makeLlm({ providers: [{ id: 'other' }] })
  await assert.rejects(
    () => validateCatalogRoute(llm, { provider: 'magpie', model: 'workbuddy/deepseek-v4.1-flash' }),
    /Provider is unavailable: magpie/,
  )
  assert.deepEqual(calls.listModels, [], 'rejection on provider must not reach listModels')
  assert.equal(calls.resolveCallConfig.length, 0)
})

test('missing model in the catalog is rejected before preflight', async () => {
  const { llm, calls } = makeLlm()
  await assert.rejects(
    () => validateCatalogRoute(llm, { provider: 'magpie', model: 'workbuddy/does-not-exist' }),
    /Model is not advertised: magpie\/workbuddy\/does-not-exist/,
  )
  assert.deepEqual(calls.listModels, ['magpie'])
  assert.equal(calls.resolveCallConfig.length, 0, 'an unadvertised model must not reach preflight')
})

test('a throwing listModels is rejected and does not reach preflight', async () => {
  const { llm, calls } = makeLlm({
    listModelsImpl: () => { throw new Error('catalog offline') },
  })
  await assert.rejects(
    () => validateCatalogRoute(llm, { provider: 'magpie', model: 'workbuddy/deepseek-v4.1-flash' }),
    /catalog offline/,
  )
  assert.deepEqual(calls.listModels, ['magpie'])
  assert.equal(calls.resolveCallConfig.length, 0)
})

test('a throwing resolveCallConfig preflight is rejected and surfaces the reason', async () => {
  const { llm, calls } = makeLlm({
    resolveImpl: () => { throw new Error('route not allowed for this Session') },
  })
  await assert.rejects(
    () => validateCatalogRoute(llm, { provider: 'magpie', model: 'workbuddy/deepseek-v4.1-flash' }),
    /route not allowed for this Session/,
  )
  assert.equal(calls.resolveCallConfig.length, 1)
})

test('the caller cancellation signal is forwarded to the preflight', async () => {
  const { llm, calls } = makeLlm()
  const controller = new AbortController()
  const { signal } = controller
  await validateCatalogRoute(llm, { provider: 'magpie', model: 'workbuddy/deepseek-v4.1-flash' }, signal)
  assert.equal(calls.resolveCallConfig.length, 1)
  assert.equal(calls.resolveCallConfig[0].signal, signal, 'the same AbortSignal instance must be forwarded')
})

test('an already-aborted signal is honoured by the preflight receiver', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled by caller'))
  const { llm, calls } = makeLlm({
    resolveImpl: (_route, signal) => {
      assert.equal(signal, controller.signal)
      assert.equal(signal.aborted, true)
      signal.throwIfAborted()
    },
  })
  await assert.rejects(
    () => validateCatalogRoute(llm, { provider: 'magpie', model: 'workbuddy/deepseek-v4.1-flash' }, controller.signal),
    /cancelled by caller/,
  )
  assert.equal(calls.resolveCallConfig.length, 1)
})
