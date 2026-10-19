import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BUY_TOOL,
  DEFAULT_MODEL,
  READ_ONLY_TOOLS,
  SELL_TOOL,
  agentOptions,
  loadAgentSettings,
  permissionHandler,
  systemPrompt,
} from '../src/agent.js'
import { BONK, config } from './helpers.js'

const live = () => config({ DRY_RUN: 'false', SOLANA_PRIVATE_KEY: 'not-used-in-tests', JUPITER_API_KEY: 'jup' })
const opts = { signal: new AbortController().signal, toolUseID: 't1', requestId: 'r1' }

test('options expose only MCP tools and never pre-approve buy or sell', () => {
  const o = agentOptions(config(), loadAgentSettings(config(), {}))
  assert.deepEqual(o.tools, [])
  assert.deepEqual(o.settingSources, [])
  assert.equal(o.strictMcpConfig, true)
  assert.deepEqual(o.settings, { disableClaudeAiConnectors: true })
  assert.equal(o.permissionMode, 'default')
  assert.equal(o.model, DEFAULT_MODEL)
  assert.deepEqual(o.allowedTools, [...READ_ONLY_TOOLS, 'mcp__dexra__*'])
  assert.ok(!o.allowedTools?.includes(BUY_TOOL) && !o.allowedTools?.includes(SELL_TOOL))
  assert.deepEqual(Object.keys(o.mcpServers ?? {}).sort(), ['dexra', 'trader'])
})

test('the remote Dexra server gets the bearer key and can be switched off', () => {
  const on = agentOptions(config(), loadAgentSettings(config(), {}))
  assert.deepEqual(on.mcpServers?.dexra, {
    type: 'http',
    url: 'http://dexra.test/mcp',
    headers: { Authorization: 'Bearer dxr_test' },
    alwaysLoad: true,
  })
  const off = agentOptions(config(), loadAgentSettings(config(), { DEXRA_MCP: 'false' }))
  assert.equal(off.mcpServers?.dexra, undefined)
  assert.deepEqual(off.allowedTools, READ_ONLY_TOOLS)
})

test('ANTHROPIC_MODEL and DEXRA_MCP_URL override the defaults', () => {
  const s = loadAgentSettings(config(), { ANTHROPIC_MODEL: 'claude-opus-5-5', DEXRA_MCP_URL: 'https://api.dexra.dev/mcp' })
  assert.equal(s.model, 'claude-opus-5-5')
  assert.equal(s.dexraMcpUrl, 'https://api.dexra.dev/mcp')
})

test('dry run lets buy and sell through without asking', async () => {
  let asked = 0
  const can = permissionHandler(config(), async () => (asked++, false))
  const r = await can(BUY_TOOL, { mint: BONK, amount_sol: 0.01 }, opts)
  assert.equal(r?.behavior, 'allow')
  assert.equal(asked, 0)
})

test('any other tool is denied', async () => {
  const can = permissionHandler(config(), async () => true)
  assert.equal((await can('Bash', { command: 'ls' }, opts))?.behavior, 'deny')
  assert.equal((await can('mcp__other__send', {}, opts))?.behavior, 'deny')
})

test('live trades ask first and follow the answer', async () => {
  const questions: string[] = []
  const yes = permissionHandler(live(), async (q) => (questions.push(q), true))
  assert.equal((await yes(BUY_TOOL, { mint: BONK, amount_sol: 0.02 }, opts))?.behavior, 'allow')
  assert.match(questions[0] ?? '', /LIVE BUY 0\.02 SOL of DezX/)

  const no = permissionHandler(live(), async () => false)
  const denied = await no(SELL_TOOL, { mint: BONK, amount_atomic: '100' }, opts)
  assert.equal(denied?.behavior, 'deny')
})

test('live trades are denied when there is no terminal to confirm', async () => {
  const r = await permissionHandler(live(), null)(BUY_TOOL, { mint: BONK, amount_sol: 0.01 }, opts)
  assert.equal(r?.behavior, 'deny')
})

test('the system prompt states the mode and the rules', () => {
  assert.match(systemPrompt(config()), /DRY RUN \(DRY_RUN is not false\)/)
  assert.match(systemPrompt(live()), /LIVE/)
  assert.match(systemPrompt(config()), /Never retry/)
})
