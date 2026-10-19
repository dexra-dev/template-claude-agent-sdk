import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { textOf, traderTools } from '../src/tools.js'
import { BONK, DEXRA, JUP, config, dexraResult, mockFetch, type Routes } from './helpers.js'

let restore = () => {}
afterEach(() => restore())

function use(routes: Routes) {
  const m = mockFetch(routes)
  restore = m.restore
  return m
}

const okChecks: Routes = {
  [`GET ${DEXRA}/token_deep_check`]: dexraResult('ok', ['no linked holders']),
  [`GET ${DEXRA}/swap_preflight`]: dexraResult('ok'),
}

const tools = (env: Record<string, string> = {}) => traderTools(() => config(env))
const parse = (result: Parameters<typeof textOf>[0]) => JSON.parse(textOf(result))

test('check_token returns the Dexra result and sends the API key', async () => {
  const m = use(okChecks)
  const result = await tools().checkToken.handler({ mint: BONK }, {})
  assert.equal(result.isError, undefined)
  assert.equal(parse(result).verdict, 'ok')
  assert.equal(m.calls[0]?.url.searchParams.get('mint'), BONK)
  assert.match(m.calls[0]?.headers.authorization ?? '', /dxr_test/)
})

test('check_token reports a Dexra failure as a tool error', async () => {
  use({ [`GET ${DEXRA}/token_deep_check`]: { status: 402, body: { error: 'payment required' } } })
  const result = await tools().checkToken.handler({ mint: BONK }, {})
  assert.equal(result.isError, true)
  assert.match(textOf(result), /Dexra call failed/)
})

test('preflight passes side and amount through', async () => {
  const m = use(okChecks)
  const result = await tools().preflight.handler({ mint: BONK, side: 'sell', amount: 1000 }, {})
  assert.equal(parse(result).verdict, 'ok')
  assert.equal(m.calls[0]?.url.searchParams.get('side'), 'sell')
  assert.equal(m.calls[0]?.url.searchParams.get('amount'), '1000')
})

test('fresh_launches forwards only the options it was given', async () => {
  const m = use({ [`GET ${DEXRA}/new_launches`]: { body: { result: { count: 0, launches: [] } } } })
  const result = await tools().freshLaunches.handler({ minutes: 15, limit: 5, min_liquidity_usd: undefined, platforms: undefined }, {})
  assert.equal(parse(result).count, 0)
  const params = m.calls[0]?.url.searchParams
  assert.equal(params?.get('minutes'), '15')
  assert.equal(params?.get('limit'), '5')
  assert.equal(params?.has('platforms'), false)
})

test('buy in dry run passes the guard and never touches Jupiter without a key', async () => {
  const m = use(okChecks)
  const result = await tools().buy.handler({ mint: BONK, amount_sol: 0.01 }, {})
  const trade = parse(result)
  assert.equal(trade.status, 'dry_run')
  assert.equal(trade.mode, 'dry_run')
  assert.equal(trade.signature, null)
  assert.equal(m.calls.filter((c) => c.url.host === JUP).length, 0)
})

test('buy is blocked by an avoid verdict', async () => {
  use({ ...okChecks, [`GET ${DEXRA}/token_deep_check`]: dexraResult('avoid', ['mint authority is live']) })
  const trade = parse(await tools().buy.handler({ mint: BONK, amount_sol: 0.01 }, {}))
  assert.equal(trade.status, 'blocked')
  assert.equal(trade.ok, false)
  assert.ok(trade.decision.reasons.some((r: string) => r.includes('mint authority is live')))
})

test('buy fails closed when Dexra is down', async () => {
  use({ ...okChecks, [`GET ${DEXRA}/swap_preflight`]: { status: 503, body: { error: 'down' } } })
  const trade = parse(await tools().buy.handler({ mint: BONK, amount_sol: 0.01 }, {}))
  assert.equal(trade.status, 'blocked')
})

test('buy above MAX_TRADE_SOL is refused before any request', async () => {
  const m = use(okChecks)
  const trade = parse(await tools().buy.handler({ mint: BONK, amount_sol: 1 }, {}))
  assert.equal(trade.status, 'blocked')
  assert.match(trade.message, /MAX_TRADE_SOL/)
  assert.equal(m.calls.length, 0)
})

test('dry run with a Jupiter key quotes but never executes', async () => {
  const m = use({
    ...okChecks,
    [`GET ${JUP}/swap/v2/order`]: {
      body: { requestId: 'r1', inputMint: 'So11111111111111111111111111111111111111112', outputMint: BONK, inAmount: '10000000', outAmount: '42', transaction: null },
    },
  })
  const trade = parse(await tools({ JUPITER_API_KEY: 'jup' }).buy.handler({ mint: BONK, amount_sol: 0.01 }, {}))
  assert.equal(trade.status, 'dry_run')
  assert.equal(trade.quote.outAmount, '42')
  assert.equal(m.calls.some((c) => c.url.pathname.endsWith('/execute')), false)
  assert.equal(m.calls.find((c) => c.url.host === JUP)?.url.searchParams.has('taker'), false)
})

test('sell is not blocked by an avoid verdict and reads decimals first', async () => {
  const m = use({
    [`GET ${DEXRA}/describe_address`]: { body: { result: { stats: { decimals: 5 } } } },
    [`GET ${DEXRA}/swap_preflight`]: dexraResult('avoid', ['thin pool']),
  })
  const trade = parse(await tools().sell.handler({ mint: BONK, amount_atomic: '500000' }, {}))
  assert.equal(trade.status, 'dry_run')
  assert.equal(trade.decision.verdicts.preflight, 'avoid')
  assert.equal(m.calls.find((c) => c.url.pathname === '/swap_preflight')?.url.searchParams.get('amount'), '5')
})

test('an invalid setting comes back as a tool error, not a throw', async () => {
  const m = use(okChecks)
  const bad = traderTools(() => config({ SLIPPAGE_BPS: '5000' }))
  for (const result of [
    await bad.checkToken.handler({ mint: BONK }, {}),
    await bad.buy.handler({ mint: BONK, amount_sol: 0.01 }, {}),
    await bad.sell.handler({ mint: BONK, amount_atomic: '1' }, {}),
  ]) {
    assert.equal(result.isError, true)
    assert.match(textOf(result), /Config error: SLIPPAGE_BPS/)
  }
  assert.equal(m.calls.length, 0)
})
