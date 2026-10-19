# Dexra agent: Claude Agent SDK

A Claude agent that trades on Solana and asks [Dexra](https://dexra.dev?utm_source=github&utm_medium=referral&utm_campaign=templates&utm_content=template-claude-agent-sdk) before every buy. Each buy gets a verdict first: `ok` lets it through, `avoid`, `unknown` or any Dexra error blocks it, and `caution` blocks it unless you allow caution. The agent tells you the verdict and the reasons in plain words. It runs as a dry run until you switch live trading on, and then it asks you in the terminal before each live buy or sell.

It is built with the [Claude Agent SDK for TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript): a `query()` loop, an in-process MCP server called `trader` with the trading tools, and Dexra's remote MCP server for read-only checks. Claude gets no shell or file tools.

## Safety

- **Dry run by default.** Trades are sent only when `DRY_RUN=false`, `SOLANA_PRIVATE_KEY` and `JUPITER_API_KEY` are all set. If one is missing, the agent stays in dry run and says why.
- **You confirm every live trade.** `buy` and `sell` are never pre-approved. In live mode the permission callback asks `[y/N]` in the terminal; with no terminal attached, the trade is denied.
- **Caps.** `MAX_TRADE_SOL` (default 0.05) is a hard limit per buy. A larger buy is refused, not reduced. `SLIPPAGE_BPS` defaults to 100.
- **What blocks a buy.** An invalid mint or amount, an amount over the cap, a `token_deep_check` or `swap_preflight` verdict other than `ok` (or `caution` with `ALLOW_CAUTION=true`), and any Dexra failure, including 402, 429, 5xx and network errors. The check runs inside the `buy` tool itself, so the model can't skip it.
- **Sells are never blocked**, so a position can always exit. The preflight verdict is still reported.
- Keys are read only from the environment. The wallet key is never logged or shown to the model.

Use a dedicated wallet that holds little SOL. The cap limits each trade, not all trades together.

Not financial advice. A Dexra `ok` means launches like it survived more often in our published report, not that the price will go up.

## Quick start

Click **Use this template** on GitHub, or clone it:

```bash
git clone https://github.com/dexra-dev/template-claude-agent-sdk.git
cd template-claude-agent-sdk
cp .env.example .env   # add ANTHROPIC_API_KEY and DEXRA_API_KEY
npm install
npm start
```

Run one task and exit:

```bash
npm start -- --once "Check DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 and buy 0.01 SOL if it passes"
```

See what the tools return without a model (always a dry run):

```bash
npm run tools
```

Get a Dexra key at [dexra.dev/app/keys](https://dexra.dev/app/keys?utm_source=github&utm_medium=referral&utm_campaign=templates&utm_content=template-claude-agent-sdk). The free tier gives 100 credits a day. Dexra also accepts pay-per-call over x402.

Node 20.18 or newer.

## Configuration

| Variable | Default | Meaning |
| - | - | - |
| `ANTHROPIC_API_KEY` | unset | Claude API key for the agent. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model. `claude-opus-5-5` is the stronger option, at a higher price. |
| `DEXRA_API_KEY` | unset | `dxr_…` key. Without it paid checks answer 402, so every buy is blocked. |
| `DEXRA_BASE_URL` | `https://api.dexra.dev` | Dexra API. Point it at a local API for testing. |
| `DEXRA_MCP` | `true` | Also connect Dexra's remote MCP server (read-only checks). |
| `DEXRA_MCP_URL` | `$DEXRA_BASE_URL/mcp` | Remote MCP endpoint, Streamable HTTP, `Authorization: Bearer $DEXRA_API_KEY`. |
| `JUPITER_API_KEY` | unset | Adds a Jupiter quote in a dry run. Needed for live trading. |
| `SOLANA_PRIVATE_KEY` | unset | Base58 64-byte secret key. Needed for live trading. |
| `DRY_RUN` | `true` | Only `false`, `0`, `no` or `off` turn it off. |
| `MAX_TRADE_SOL` | `0.05` | Hard cap per buy, in SOL. |
| `SLIPPAGE_BPS` | `100` | Slippage sent to Jupiter, 0 to 1000. |
| `ALLOW_CAUTION` | `false` | When true, a `caution` verdict passes. |

## How the guard works

The `trader` server exposes five tools, all built on the shared trading core in [`src/core`](src/core/README.md):

| Tool | Core call | Pre-approved |
| - | - | - |
| `check_token` | `token_deep_check` | yes |
| `preflight` | `swap_preflight` | yes |
| `fresh_launches` | `new_launches` | yes |
| `buy` | `buy`: guard, then Jupiter | no, goes through `canUseTool` |
| `sell` | `sell`: preflight logged, then Jupiter | no, goes through `canUseTool` |

`buy` runs `token_deep_check` and `swap_preflight` in parallel and refuses unless both pass. Then it quotes through Jupiter Swap API v2 in a dry run, or signs and sends the order when live. The full rules are in the [core README](src/core/README.md#safety-rules).

The agent options in [`src/agent.ts`](src/agent.ts) keep the tool surface small:

- `tools: []` removes every built-in tool (Bash, file tools, web).
- `allowedTools` pre-approves only the three read-only trader tools and `mcp__dexra__*`.
- `permissionMode: 'default'` and `canUseTool` decide `buy` and `sell`: allowed in a dry run, asked in the terminal when live, and anything else is denied.
- `settingSources: []`, `strictMcpConfig: true` and `disableClaudeAiConnectors` stop settings files, `.mcp.json` or a logged-in account from adding allow rules or other servers.

The remote Dexra server has only read-only tools. Trading stays on the core so the guard can't be bypassed.

## Project layout

```
src/
  main.ts       CLI: interactive chat and --once
  agent.ts      query() options, system prompt, canUseTool
  tools.ts      in-process "trader" MCP server (tool() + zod)
  core/         Dexra trading core, copied as is
scripts/
  tools.ts      runs the tools without a model, dry run only
test/           tool handlers and permission logic with mocked fetch, no model calls
```

`npm test` runs the tests, `npm run typecheck` runs TypeScript.

## Links

- Dexra template docs: [dexra.dev/docs/templates](https://dexra.dev/docs/templates?utm_source=github&utm_medium=referral&utm_campaign=templates&utm_content=template-claude-agent-sdk)
- Dexra API keys: [dexra.dev/app/keys](https://dexra.dev/app/keys?utm_source=github&utm_medium=referral&utm_campaign=templates&utm_content=template-claude-agent-sdk)
- Dexra published report: [dexra.dev/accuracy](https://dexra.dev/accuracy?utm_source=github&utm_medium=referral&utm_campaign=templates&utm_content=template-claude-agent-sdk)
- Claude Agent SDK: [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript), [custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools), [MCP](https://code.claude.com/docs/en/agent-sdk/mcp), [permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- Jupiter Swap API v2: [order and execute](https://developers.jup.ag/docs/swap/order-and-execute)

## License

MIT
