import type { CanUseTool, McpServerConfig, Options } from '@anthropic-ai/claude-agent-sdk'
import { loadConfig, type Config } from './core/config.js'
import { TRADER_SERVER, traderServer } from './tools.js'

export const DEFAULT_MODEL = 'claude-sonnet-5-5'
export const DEXRA_SERVER = 'dexra'
export const MAX_TURNS = 25

const t = (name: string) => `mcp__${TRADER_SERVER}__${name}`
export const BUY_TOOL = t('buy')
export const SELL_TOOL = t('sell')
export const TRADE_TOOLS = [BUY_TOOL, SELL_TOOL]
export const READ_ONLY_TOOLS = [t('check_token'), t('preflight'), t('fresh_launches')]

export interface AgentSettings {
  model: string
  /** Remote Dexra MCP server, or null when switched off. */
  dexraMcpUrl: string | null
}

type Env = Record<string, string | undefined>

export function loadAgentSettings(config: Config, env: Env = process.env): AgentSettings {
  const off = ['false', '0', 'no', 'off'].includes((env.DEXRA_MCP ?? '').trim().toLowerCase())
  const url = env.DEXRA_MCP_URL?.trim() || `${config.dexraBaseUrl}/mcp`
  return { model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL, dexraMcpUrl: off ? null : url }
}

export function systemPrompt(config: Config): string {
  const mode = config.live
    ? 'LIVE: buy and sell send real transactions after the user confirms each one in the terminal.'
    : `DRY RUN (${config.dryRunReason}): buy and sell only report what they would do. Say so in every answer about a trade.`
  return [
    'You are a careful Solana trading agent. Dexra checks every buy.',
    `Mode: ${mode}`,
    `Limits: at most ${config.maxTradeSol} SOL per buy, slippage ${config.slippageBps} bps, caution verdicts ${config.allowCaution ? 'pass' : 'block'}.`,
    '',
    'Rules:',
    '- Before any buy, call check_token and preflight (side buy) for the mint and tell the user the verdicts and reasons in plain words.',
    '- The buy tool runs the same checks again and refuses unless they pass. If a buy is blocked, report why and stop. Never retry with a smaller amount, a different tool or any other way around the block.',
    '- Never claim a trade happened unless the tool result says status "executed" and gives a signature.',
    '- Sells are never blocked, so a position can always exit; still report the preflight verdict.',
    '- A Dexra "ok" means launches like this one survived more often in Dexra\'s published report. It does not mean the price will go up. This is not financial advice.',
    '- Keep answers short: verdict first, then the reasons, then what you did.',
  ].join('\n')
}

export type Confirm = (question: string) => Promise<boolean>

/** Decides tool calls that no allow rule approved: buy and sell, plus anything unexpected. */
export function permissionHandler(config: Config, confirm: Confirm | null): CanUseTool {
  return async (toolName, input) => {
    if (!TRADE_TOOLS.includes(toolName)) {
      return { behavior: 'deny', message: `${toolName} is not available to this agent` }
    }
    if (!config.live) return { behavior: 'allow', updatedInput: input }
    if (!confirm) {
      return { behavior: 'deny', message: 'Live trades need a confirmation in a terminal, and none is attached. Nothing was sent.' }
    }
    const what =
      toolName === BUY_TOOL
        ? `LIVE BUY ${String(input.amount_sol)} SOL of ${String(input.mint)}`
        : `LIVE SELL ${String(input.amount_atomic)} atomic units of ${String(input.mint)}`
    if (await confirm(`${what}. Dexra checks run first and can still block it. Send? [y/N] `)) {
      return { behavior: 'allow', updatedInput: input }
    }
    return { behavior: 'deny', message: 'The user declined this trade. Do not retry it unless they ask again.' }
  }
}

/** Options for query(): only the trader tools and the remote Dexra tools, no built-in tools. */
export function agentOptions(
  config: Config = loadConfig(),
  settings: AgentSettings = loadAgentSettings(config),
  confirm: Confirm | null = null,
): Options {
  const mcpServers: Record<string, McpServerConfig> = { [TRADER_SERVER]: traderServer() }
  const allowedTools = [...READ_ONLY_TOOLS]
  if (settings.dexraMcpUrl) {
    mcpServers[DEXRA_SERVER] = {
      type: 'http',
      url: settings.dexraMcpUrl,
      ...(config.dexraApiKey ? { headers: { Authorization: `Bearer ${config.dexraApiKey}` } } : {}),
      alwaysLoad: true,
    }
    // The remote Dexra server only has read-only checks; trading stays on the core.
    allowedTools.push(`mcp__${DEXRA_SERVER}__*`)
  }
  return {
    model: settings.model,
    systemPrompt: systemPrompt(config),
    mcpServers,
    tools: [],
    allowedTools,
    // buy and sell are left out of allowedTools on purpose, so every call reaches canUseTool.
    permissionMode: 'default',
    canUseTool: permissionHandler(config, confirm),
    // Ignore settings files: an allow rule there could approve buy or sell without the callback.
    settingSources: [],
    // Only the servers above: no .mcp.json, plugins or claude.ai connectors from the machine's login.
    strictMcpConfig: true,
    settings: { disableClaudeAiConnectors: true },
    maxTurns: MAX_TURNS,
  }
}
