import { createInterface } from 'node:readline'
import { query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { agentOptions, loadAgentSettings, type Confirm } from './agent.js'
import { ConfigError, loadConfig } from './core/config.js'

const USAGE = `Usage:
  npm start                    chat with the agent
  npm start -- --once "<task>"  run one task and exit`

// Read-only tools are pre-approved on purpose; only buy and sell must reach canUseTool, so this warning is expected.
const emitWarning = process.emitWarning.bind(process) as (...args: unknown[]) => void
process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
  const options = rest[0]
  if (options && typeof options === 'object' && (options as { code?: string }).code === 'CLAUDE_SDK_CAN_USE_TOOL_SHADOWED') return
  emitWarning(warning, ...rest)
}) as typeof process.emitWarning

function parseArgs(argv: string[]): { once: string | null } {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    process.exit(0)
  }
  const i = argv.indexOf('--once')
  if (i === -1) return { once: null }
  const task = argv[i + 1]?.trim()
  if (!task) {
    console.error(USAGE)
    process.exit(2)
  }
  return { once: task }
}

/** One readline for both the chat prompt and trade confirmations; resolves null once stdin closes. */
function terminal() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let closed = false
  rl.on('close', () => (closed = true))
  const ask = (question: string) =>
    new Promise<string | null>((resolve) => {
      if (closed) return resolve(null)
      const onClose = () => resolve(null)
      rl.once('close', onClose)
      rl.question(question, (answer) => {
        rl.off('close', onClose)
        resolve(answer)
      })
    })
  const confirm: Confirm = async (question) => /^y(es)?$/i.test((await ask(question))?.trim() ?? '')
  return { ask, confirm, close: () => rl.close() }
}

function print(message: SDKMessage): void {
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text' && block.text.trim()) console.log(`\n${block.text.trim()}`)
      if (block.type === 'tool_use') console.log(`  [${block.name.replace(/^mcp__/, '').replace('__', '.')}] ${JSON.stringify(block.input)}`)
    }
  } else if (message.type === 'result' && message.subtype !== 'success') {
    console.error(`\nThe agent stopped: ${message.subtype}`)
  }
}

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env')
  } catch {
    // No .env file: use the environment as it is.
  }
}

async function main(): Promise<void> {
  const { once } = parseArgs(process.argv.slice(2))
  loadDotEnv()
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Note: ANTHROPIC_API_KEY is not set. The Agent SDK will try other Claude credentials and may fail.')
  }
  const config = loadConfig()
  const settings = loadAgentSettings(config)
  const interactive = process.stdin.isTTY === true
  const io = once && !interactive ? null : terminal()
  const options = agentOptions(config, settings, io?.confirm ?? null)

  console.log(
    `Model ${settings.model}. ${config.live ? 'LIVE trading: each buy and sell asks you first.' : `Dry run (${config.dryRunReason}).`}` +
      ` Dexra MCP: ${settings.dexraMcpUrl ?? 'off'}.`,
  )

  if (once) {
    try {
      for await (const message of query({ prompt: once, options })) print(message)
    } finally {
      io?.close()
    }
    return
  }

  if (!io) throw new Error('unreachable')
  console.log('Ask about a token or a trade. Type "exit" to quit.')
  let turnDone: () => void = () => {}
  async function* turns(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      const line = await io!.ask('\nyou> ')
      if (line === null || ['exit', 'quit'].includes(line.trim())) return
      if (!line.trim()) continue
      const done = new Promise<void>((resolve) => (turnDone = resolve))
      yield { type: 'user', message: { role: 'user', content: line }, parent_tool_use_id: null }
      await done
    }
  }
  try {
    for await (const message of query({ prompt: turns(), options })) {
      print(message)
      if (message.type === 'result') turnDone()
    }
  } finally {
    io.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigError ? `Config error: ${error.message}` : error)
  process.exit(1)
})
