import { errorMessage, type CollectedDump } from './collect'

/** Mirror of the backend's AnaliseDetalheResponse: only the fields the report reads. */
export interface AnalysisDetail {
  id: string
  status: 'AGUARDANDO' | 'PROCESSANDO' | 'CONCLUIDA' | 'FALHA' | 'CANCELADA'
  totalThreads?: number | null
  threadsBloqueadas?: number | null
  healthScore?: number | null
  problemasDetectados?: {
    problemas?: Array<{
      tipo?: string
      severidade?: string
      descricao?: string
      evidencia?: {
        lockOuRecurso?: string | null
        nomesThreads?: string[] | null
        stackResumo?: string[] | null
        quantidadeThreadsAfetadas?: number
      } | null
      recomendacao?: { titulo?: string; descricao?: string } | null
    }>
  } | null
  sumarioExecutivo?: { grauSaude?: string; healthScore?: number } | null
}

export type AnalysisOutcome =
  | { ok: true; publicToken: string; reportUrl: string; detail: AnalysisDetail }
  | { ok: false; reason: string; rateLimited?: true }

export interface AnalyzeOptions {
  apiUrl: string
  fetchFn?: typeof fetch
  sleepFn?: (ms: number) => Promise<void>
  now?: () => number
  /** Absolute time (ms, same clock as now) after which polling stops; the per-dump limit still applies. */
  deadline?: number
}

/** Stored by the backend as the visitor's traffic origin; this is what the success metric counts. */
export const TRAFFIC_ORIGIN = { utmSource: 'github-action', utmMedium: 'ci', utmCampaign: 'github-action' }

const SITE_URL = 'https://threadmine.dev'
const POLL_INTERVAL_MS = 3000
const POLL_LIMIT_MS = 180_000
const NETWORK_BACKOFF_MS = [1000, 2000]
/** A half-dead API must not hold the user's runner: each request gives up after this. */
const REQUEST_TIMEOUT_MS = 30_000

class AnalysisFailed extends Error {
  constructor(message: string, readonly rateLimited = false) {
    super(message)
  }
}

/** Upload one dump to the public endpoint and wait for the result. Never throws. */
export async function analyzeDump(dump: CollectedDump, opts: AnalyzeOptions): Promise<AnalysisOutcome> {
  const api = new PublicApi(opts)
  const now = opts.now ?? Date.now
  try {
    const { tokenPublico } = await api.upload(dump) as { tokenPublico: string }
    const deadline = Math.min(now() + POLL_LIMIT_MS, opts.deadline ?? Infinity)
    for (;;) {
      const result = await api.get(`/api/v1/public/analises/${encodeURIComponent(tokenPublico)}`) as {
        status: AnalysisDetail['status']
        falha?: { motivo?: string | null } | null
      }
      if (result.status === 'CONCLUIDA') {
        const detail = await api.get(`/api/v1/public/analises/${encodeURIComponent(tokenPublico)}/detalhe`) as AnalysisDetail
        return { ok: true, publicToken: tokenPublico, reportUrl: `${SITE_URL}/resultado/${tokenPublico}`, detail }
      }
      if (result.status === 'FALHA' || result.status === 'CANCELADA') {
        const motivo = result.falha?.motivo ? `: ${result.falha.motivo}` : ''
        return { ok: false, reason: `ThreadMine could not analyze this dump${motivo}` }
      }
      if (now() + POLL_INTERVAL_MS > deadline) {
        return { ok: false, reason: `ThreadMine did not finish the analysis in time (limit ${POLL_LIMIT_MS / 1000} s)` }
      }
      await api.sleep(POLL_INTERVAL_MS)
    }
  } catch (e) {
    if (e instanceof AnalysisFailed && e.rateLimited) return { ok: false, reason: e.message, rateLimited: true }
    return { ok: false, reason: errorMessage(e) }
  }
}

class PublicApi {
  private readonly baseUrl: string
  private readonly fetchFn: typeof fetch
  readonly sleep: (ms: number) => Promise<void>

  constructor(opts: AnalyzeOptions) {
    this.baseUrl = opts.apiUrl.replace(/\/+$/, '')
    this.fetchFn = opts.fetchFn ?? fetch
    this.sleep = opts.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  upload(dump: CollectedDump): Promise<unknown> {
    // A fresh FormData per attempt: a body stream cannot be sent twice.
    return this.send('/api/v1/public/analises', 'POST', () => {
      const form = new FormData()
      form.append('arquivo', new Blob([dump.content], { type: 'text/plain' }), dump.fileName)
      form.append('origemTrafego', new Blob([JSON.stringify(TRAFFIC_ORIGIN)], { type: 'application/json' }))
      return form
    })
  }

  get(path: string): Promise<unknown> {
    return this.send(path, 'GET')
  }

  private async send(path: string, method: string, body?: () => FormData): Promise<unknown> {
    let response: Response | undefined
    for (let attempt = 0; ; attempt++) {
      try {
        response = await this.fetchFn(`${this.baseUrl}${path}`, {
          method,
          headers: { 'Accept-Language': 'en' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          ...(body ? { body: body() } : {}),
        })
        break
      } catch (cause) {
        if (attempt >= NETWORK_BACKOFF_MS.length) {
          throw new AnalysisFailed(`Network error calling ThreadMine: ${errorMessage(cause)}`)
        }
        await this.sleep(NETWORK_BACKOFF_MS[attempt])
      }
    }
    if (response.ok) return response.json()
    const problem = await response.json().catch(() => ({})) as { detail?: unknown }
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after')
      const when = retryAfter ? `retry after ${retryAfter}s` : 'retry later'
      throw new AnalysisFailed(`ThreadMine rate limit reached (5 analyses per hour per IP); ${when}`, true)
    }
    const detail = typeof problem.detail === 'string' ? `: ${problem.detail}` : ''
    throw new AnalysisFailed(`ThreadMine API error (HTTP ${response.status})${detail}`)
  }
}
