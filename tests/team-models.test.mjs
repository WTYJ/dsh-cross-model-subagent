import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readTeamModels, recordedModel, registerStatusRoute } from '../status-web.js'

const model = (provider, id) => ({ provider, model: id })
const request = config => ({ type: 'request/header', data: { header: { config } } })
const member = (childId, mode = 'continuable') => ({ type: 'subagent/catalog', data: { childId, mode } })
const session = (events, origin) => ({ header: { origin }, ownEvents: () => events })

test('team models come from own requests, not seeded requests or configured defaults', () => {
  const inherited = request(model('parent', 'planner'))
  const actual = request({ ...model('worker', 'specialist'), apiKey: 'must not be exposed' })
  const child = { ...session([], 'subagent'), snapshotEvents: () => [inherited] }
  assert.equal(recordedModel(child), null)
  assert.deepEqual(recordedModel(session([actual])), model('worker', 'specialist'))
})

test('team lookup reads confirmed children and keeps unknown external model blank', async () => {
  const rootSession = session([member('live'), member('cold'), member('external', 'external')])
  const live = { session: session([request(model('first', 'explicit'))], 'subagent') }
  const root = { session: rootSession, model: { current: () => model('root', 'current') } }
  const inspected = []
  let enabled = true
  const services = {
    agentTeams: { isEnabled: agent => agent === root && enabled },
    sessionQuery: { inspectSession(id, read) {
      inspected.push(id)
      return read(session([request(model('second', 'completed'))], 'subagent'))
    } },
  }
  const agents = new Map([['root', root], ['live', live]])
  const ctx = { agents, get: name => services[name] }
  const signal = new AbortController().signal
  const result = await readTeamModels(ctx, 'root', ['live', 'external', 'unrelated', 'cold', 'live'], signal)
  assert.deepEqual(result, {
    enabled: true, parentRoute: model('root', 'current'), members: [
      { id: 'live', route: model('first', 'explicit') }, { id: 'cold', route: model('second', 'completed') },
      { id: 'external', route: null },
    ],
  })
  assert.deepEqual(inspected, ['cold'])
  assert.equal((await readTeamModels(ctx, 'live', [], signal)).enabled, false)
  enabled = false
  assert.equal((await readTeamModels(ctx, 'root', ['live'], signal)).enabled, false)
  assert.equal(await readTeamModels(ctx, 'root', Array(21).fill('live'), signal), null)
})

test('team summary keeps the last requested parent model and distinguishes member read errors', async () => {
  const last = model('root', 'last-request')
  const root = {
    session: session([member('failed'), member('pending'), request(last)]),
    model: { current: () => model('root', 'selected-next') },
  }
  const services = {
    agentTeams: { isEnabled: () => true },
    sessionQuery: { async inspectSession(id, read) {
      if (id === 'failed') throw new Error('Storage read failed')
      return read(session([], 'subagent'))
    } },
  }
  const ctx = { agents: new Map([['root', root]]), get: name => services[name] }
  const signal = new AbortController().signal
  assert.deepEqual(await readTeamModels(ctx, 'root', [], signal), {
    enabled: true, parentRoute: last, members: [],
  })
  assert.deepEqual((await readTeamModels(ctx, 'root', ['failed', 'pending'], signal)).members, [
    { id: 'failed', route: null, failed: true }, { id: 'pending', route: null },
  ])
})

test('summary accepts Desktop forwarding with an authenticated owner and no Origin', async () => {
  const origin = 'http://127.0.0.1:12345'
  const host = new URL(origin).host
  const server = { getOrigin: () => origin, register(route) { handler = route.handler } }
  const connection = { admit: req => req.admission }
  let handler
  const ctx = {
    get: key => ({ connection })[key],
    inject: (_services, mount) => mount({ webServer: server, effect: activate => activate() }),
  }
  registerStatusRoute(ctx, async id => ({ parentRoute: model('root', id) }))

  async function request(headers, admission = { rejection: 401 }, remoteAddress = '127.0.0.1') {
    const res = new EventEmitter()
    res.writeHead = status => { res.status = status }
    res.end = body => { res.body = JSON.parse(body) }
    await handler({ method: 'POST', url: '/model-delegation/status?sessionId=root',
      socket: { remoteAddress }, headers: { host, ...headers }, admission }, res)
    return { status: res.status, body: res.body }
  }

  const owner = { peer: { principal: { kind: 'owner' } } }
  assert.deepEqual((await request({}, owner)).body.parentRoute, model('root', 'root'))
  assert.equal((await request({ origin })).status, 200)
  assert.equal((await request({})).status, 401)
  assert.equal((await request({}, { peer: { principal: { kind: 'remote' } } })).status, 403)
  assert.equal((await request({ origin: 'null' }, owner)).status, 403)
  assert.equal((await request({ origin: 'https://example.com' }, owner)).status, 403)
  assert.equal((await request({ host: 'localhost:12345' }, owner)).status, 403)
  assert.equal((await request({}, owner, '192.0.2.20')).status, 403)
})
