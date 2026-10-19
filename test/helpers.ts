import { loadConfig, type Config } from '../src/core/config.js'

export const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
export const DEXRA = 'dexra.test'
export const JUP = 'api.jup.ag'

export interface Call {
  method: string
  url: URL
  headers: Record<string, string>
}

type Reply = { status?: number; body: unknown }
export type Routes = Record<string, Reply | ((call: Call) => Reply)>

/** Replaces globalThis.fetch with a router keyed by "METHOD host/path" and records every call. */
export function mockFetch(routes: Routes): { calls: Call[]; restore: () => void } {
  const original = globalThis.fetch
  const calls: Call[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    )
    const call = { method, url, headers }
    calls.push(call)
    const route = routes[`${method} ${url.host}${url.pathname}`]
    if (!route) throw new Error(`unexpected request ${method} ${url.host}${url.pathname}`)
    const reply = typeof route === 'function' ? route(call) : route
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { calls, restore: () => void (globalThis.fetch = original) }
}

export function config(env: Record<string, string> = {}): Config {
  return loadConfig({ DEXRA_BASE_URL: `http://${DEXRA}`, DEXRA_API_KEY: 'dxr_test', ...env })
}

export function dexraResult(verdict: string, reasons: string[] = [], extra: Record<string, unknown> = {}): Reply {
  return { body: { result: { verdict, reasons, summary: `summary ${verdict}`, ...extra } } }
}
