import { describe, expect, it } from 'vitest'
import type { CollectedDump } from '../src/collect'
import { analyzeDump, TRAFFIC_ORIGIN } from '../src/threadmine'

const dump: CollectedDump = { source: 'live-jvm', label: 'surefire-fork pid 1', fileName: 'thread-dump-1.txt', content: 'Full thread dump' }
const TOKEN = '11111111-2222-3333-4444-555555555555'

interface Call { url: string; init: RequestInit }

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

/** Fake API: the upload returns the token, each poll pops the next status, detail returns a fixed body. */
function fakeApi(statuses: string[], extra: Partial<{ upload: () => Response; falha: unknown }> = {}) {
  const calls: Call[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (init.method === 'POST') return extra.upload ? extra.upload() : json(201, { analiseId: 'a1', tokenPublico: TOKEN })
    if (url.endsWith('/detalhe')) return json(200, { id: 'a1', status: 'CONCLUIDA', healthScore: 20 })
    const status = statuses.length > 1 ? statuses.shift()! : statuses[0]
    return json(200, { analiseId: 'a1', tokenPublico: TOKEN, status, falha: extra.falha ?? null })
  }) as unknown as typeof fetch
  return { calls, fetchFn }
}

function fakeClock() {
  let t = 0
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => t,
    sleepFn: async (ms: number) => { sleeps.push(ms); t += ms },
  }
}

const opts = (fetchFn: typeof fetch, clock = fakeClock()) => ({ apiUrl: 'https://api.test/', fetchFn, sleepFn: clock.sleepFn, now: clock.now })

describe('analyzeDump', () => {
  it('uploads multipart with attribution', async () => {
    const { calls, fetchFn } = fakeApi(['CONCLUIDA'])
    await analyzeDump(dump, opts(fetchFn))
    const upload = calls[0]
    expect(upload.url).toBe('https://api.test/api/v1/public/analises')
    const form = upload.init.body as FormData
    const file = form.get('arquivo') as File
    expect(file.name).toBe('thread-dump-1.txt')
    expect(await file.text()).toBe('Full thread dump')
    expect(JSON.parse(await (form.get('origemTrafego') as Blob).text())).toEqual(TRAFFIC_ORIGIN)
    expect(TRAFFIC_ORIGIN).toEqual({ utmSource: 'github-action', utmMedium: 'ci', utmCampaign: 'github-action' })
    const headers = upload.init.headers as Record<string, string>
    expect(headers['Accept-Language']).toBe('en')
    expect(headers.Authorization).toBeUndefined()
  })

  it('polls until CONCLUIDA then fetches detail', async () => {
    const { calls, fetchFn } = fakeApi(['PROCESSANDO', 'CONCLUIDA'])
    const outcome = await analyzeDump(dump, opts(fetchFn))
    expect(outcome).toEqual({
      ok: true,
      publicToken: TOKEN,
      reportUrl: `https://threadmine.dev/resultado/${TOKEN}`,
      detail: { id: 'a1', status: 'CONCLUIDA', healthScore: 20 },
    })
    expect(calls.at(-1)!.url).toBe(`https://api.test/api/v1/public/analises/${TOKEN}/detalhe`)
  })

  it('gives up after 180 s', async () => {
    const { fetchFn } = fakeApi(['PROCESSANDO'])
    const clock = fakeClock()
    const outcome = await analyzeDump(dump, opts(fetchFn, clock))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('180')
    expect(clock.now()).toBeLessThanOrEqual(183_000)
  })

  it('reports FALHA', async () => {
    const { fetchFn } = fakeApi(['FALHA'], { falha: { motivo: 'FORMATO_NAO_RECONHECIDO' } })
    const outcome = await analyzeDump(dump, opts(fetchFn))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('FORMATO_NAO_RECONHECIDO')
  })

  it('turns 429 into a reason without waiting', async () => {
    const { fetchFn } = fakeApi([], { upload: () => json(429, { detail: 'limit' }, { 'retry-after': '1800' }) })
    const clock = fakeClock()
    const outcome = await analyzeDump(dump, opts(fetchFn, clock))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('1800')
    expect(clock.sleeps.every((ms) => ms <= 3000)).toBe(true)
  })

  it('retries network errors then reports them', async () => {
    let attempts = 0
    const fetchFn = (async () => { attempts++; throw new TypeError('fetch failed') }) as unknown as typeof fetch
    const outcome = await analyzeDump(dump, opts(fetchFn))
    expect(attempts).toBe(3)
    expect(outcome.ok).toBe(false)
  })
})
