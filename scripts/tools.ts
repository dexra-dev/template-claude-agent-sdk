// Runs the trader tools without a model, always as a dry run, to show what the agent would see.
import { loadConfig } from '../src/core/config.js'
import { textOf, traderTools } from '../src/tools.js'

try {
  process.loadEnvFile('.env')
} catch {
  // No .env file.
}

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const config = loadConfig({ ...process.env, DRY_RUN: 'true' })
const tools = traderTools(() => config)
console.log(`Dexra: ${config.dexraBaseUrl}, dry run: ${config.dryRunReason}`)

const show = async (label: string, call: ReturnType<typeof tools.buy.handler>) => {
  const result = await call
  const text = textOf(result)
  console.log(`\n== ${label}${result.isError ? ' (isError)' : ''}\n${text}`)
  return text
}

await show('fresh_launches', tools.freshLaunches.handler({ minutes: 30, limit: 3, min_liquidity_usd: undefined, platforms: undefined }, {}))
const bought = await show('buy BONK 0.01 SOL', tools.buy.handler({ mint: BONK, amount_sol: 0.01 }, {}))
const parsed = JSON.parse(bought) as { mode?: string; signature?: unknown }
if (parsed.mode !== 'dry_run' || parsed.signature !== null) {
  console.error('tools: expected a dry run with no signature')
  process.exit(1)
}
