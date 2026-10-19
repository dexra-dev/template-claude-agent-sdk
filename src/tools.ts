import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { ConfigError, loadConfig, type Config } from './core/config.js'
import { checkToken, errorText, freshLaunches, preflight } from './core/dexra.js'
import { buy, sell } from './core/trade.js'

export const TRADER_SERVER = 'trader'

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }

function json(value: unknown, isError = false): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) }
}

function failure(error: unknown): ToolResult {
  const what = error instanceof ConfigError ? 'Config error' : 'Dexra call failed'
  return { content: [{ type: 'text', text: `${what}: ${errorText(error)}` }], isError: true }
}

const mint = z.string().describe('Token mint address (base58)')

/** The trader tools, built on the copied core. `getConfig` is read on every call so tests can inject settings. */
export function traderTools(getConfig: () => Config = () => loadConfig()) {
  const checkTokenTool = tool(
    'check_token',
    'Dexra token_deep_check: holder graph, mint and freeze authorities, Token-2022 extensions. Returns a verdict (ok, caution, avoid, unknown) with reasons.',
    { mint },
    async (args) => {
      try {
        return json(await checkToken(args.mint, getConfig()))
      } catch (error) {
        return failure(error)
      }
    },
    { annotations: { readOnlyHint: true, openWorldHint: true } },
  )

  const preflightTool = tool(
    'preflight',
    'Dexra swap_preflight: route, liquidity and honeypot checks for a swap. Amount is SOL for a buy and token units for a sell.',
    {
      mint,
      side: z.enum(['buy', 'sell']),
      amount: z.number().positive().describe('SOL for a buy, token units for a sell'),
    },
    async (args) => {
      try {
        return json(await preflight(args.mint, args.side, args.amount, getConfig()))
      } catch (error) {
        return failure(error)
      }
    },
    { annotations: { readOnlyHint: true, openWorldHint: true } },
  )

  const freshLaunchesTool = tool(
    'fresh_launches',
    'Dexra new_launches: tokens launched in the last minutes, each with its own verdict.',
    {
      minutes: z.number().int().positive().optional().describe('Look-back window in minutes'),
      limit: z.number().int().positive().optional().describe('Maximum number of launches'),
      min_liquidity_usd: z.number().nonnegative().optional(),
      platforms: z.string().optional().describe('Comma-separated launch platforms'),
    },
    async (args) => {
      try {
        return json(await freshLaunches(args, getConfig()))
      } catch (error) {
        return failure(error)
      }
    },
    { annotations: { readOnlyHint: true, openWorldHint: true } },
  )

  const buyTool = tool(
    'buy',
    'Buy a token with SOL. Dexra checks the token first and blocks the buy unless both verdicts pass. Capped by MAX_TRADE_SOL. A dry run unless live trading is on.',
    { mint, amount_sol: z.number().positive().describe('SOL to spend') },
    async (args) => {
      let config: Config
      try {
        config = getConfig()
      } catch (error) {
        return failure(error)
      }
      const result = await buy(args.mint, args.amount_sol, config)
      return json(result, result.status === 'error')
    },
    { annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true } },
  )

  const sellTool = tool(
    'sell',
    'Sell a token for SOL. Never blocked by a verdict, so a position can always exit; the preflight verdict is reported. A dry run unless live trading is on.',
    { mint, amount_atomic: z.string().regex(/^\d+$/).describe('Amount in the token\'s smallest units, as a whole number string') },
    async (args) => {
      let config: Config
      try {
        config = getConfig()
      } catch (error) {
        return failure(error)
      }
      const result = await sell(args.mint, args.amount_atomic, config)
      return json(result, result.status === 'error')
    },
    { annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true } },
  )

  return { checkToken: checkTokenTool, preflight: preflightTool, freshLaunches: freshLaunchesTool, buy: buyTool, sell: sellTool }
}

/** The in-process MCP server Claude sees as `trader`. */
export function traderServer(getConfig?: () => Config): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: TRADER_SERVER,
    version: '0.1.0',
    // Keep the schemas in the first prompt: built-in tools, ToolSearch included, are switched off.
    alwaysLoad: true,
    tools: Object.values(traderTools(getConfig)),
  })
}

/** The text of a tool result, as Claude reads it. */
export function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((block) => (block.type === 'text' ? (block.text ?? '') : '')).join('\n')
}
