import { describe, expect, it } from 'vitest'
import type { CollectedDump } from '../src/collect'
import { commentMarker, renderReport, type ReportEntry } from '../src/render'
import type { AnalysisDetail } from '../src/threadmine'

const FOOTER = 'Thread dumps were analyzed at threadmine.dev. Set `analyze: false` to keep them only in the workflow artifact.'
const dump: CollectedDump = { source: 'live-jvm', label: 'surefire-fork pid 2466', fileName: 'thread-dump-2466.txt', content: '' }
const ctx = { analyzeEnabled: true, artifactName: 'threadmine-thread-dumps-test-linux-abc123', runUrl: 'https://github.com/o/r/actions/runs/1', marker: commentMarker('test', 'Linux') }

const deadlock: AnalysisDetail = {
  id: 'a1',
  status: 'CONCLUIDA',
  healthScore: 20,
  problemasDetectados: {
    problemas: [{
      tipo: 'DEADLOCK',
      severidade: 'CRITICAL',
      descricao: 'Deadlock between 2 threads.',
      evidencia: {
        lockOuRecurso: '0x00000000c0000020 (java.lang.Object)',
        nomesThreads: ['worker-A', 'worker-B', 't3', 't4', 't5', 't6', 't7'],
        stackResumo: ['at demo.DeadlockTest.lambda$hangs$0(DeadlockTest.java:10)', 'at java.lang.Thread.run(Thread.java:1583)'],
      },
      recomendacao: { titulo: 'Acquire locks in a consistent order' },
    }],
  },
}
const analyzed: ReportEntry = {
  dump,
  outcome: { ok: true, publicToken: 'tok', reportUrl: 'https://threadmine.dev/resultado/tok', detail: deadlock },
}

describe('commentMarker', () => {
  it('identifies the job and OS', () => {
    expect(commentMarker('test', 'Linux')).toBe('<!-- threadmine-action:test:Linux -->')
  })
})

describe('renderReport', () => {
  it('renders a deadlock with lock, threads and stack', () => {
    const md = renderReport([analyzed], ctx)
    expect(md.startsWith('<!-- threadmine-action:test:Linux -->')).toBe(true)
    expect(md).toContain('### surefire-fork pid 2466')
    expect(md).toContain('[CRITICAL] DEADLOCK')
    expect(md).toContain('Deadlock between 2 threads.')
    expect(md).toContain('0x00000000c0000020 (java.lang.Object)')
    expect(md).toContain('worker-A')
    expect(md).toMatch(/```\n.*DeadlockTest\.java:10/)
    expect(md).toContain('Acquire locks in a consistent order')
    expect(md).toContain('https://threadmine.dev/resultado/tok')
  })

  it('caps thread names at 5', () => {
    const md = renderReport([analyzed], ctx)
    expect(md).toContain('t5')
    expect(md).not.toContain('t6')
  })

  it('renders a skipped analysis with its reason', () => {
    const md = renderReport([{ dump, outcome: { ok: false, reason: 'ThreadMine rate limit reached' } }], ctx)
    expect(md).toContain('Analysis skipped: ThreadMine rate limit reached')
  })

  it('renders not-analyzed entries and the artifact line when analyze is off', () => {
    const md = renderReport([{ dump }], { ...ctx, analyzeEnabled: false })
    expect(md).toContain('Not analyzed. Dump kept in the threadmine-thread-dumps-test-linux-abc123 artifact.')
    expect(md).toContain('Dumps are in the threadmine-thread-dumps-test-linux-abc123 artifact of https://github.com/o/r/actions/runs/1.')
    expect(md).not.toContain('threadmine.dev')
  })

  it('ends with the privacy footer when analyze is on', () => {
    expect(renderReport([analyzed], ctx).trimEnd().endsWith(FOOTER)).toBe(true)
  })

  it('says so when no problem was detected', () => {
    const clean = { ...analyzed, outcome: { ...analyzed.outcome!, detail: { id: 'a', status: 'CONCLUIDA' as const } } } as ReportEntry
    expect(renderReport([clean], ctx)).toContain('No problems detected')
  })
})

describe('renderReport without a stack summary from the API', () => {
  it('shows the stacks of the involved threads from the dump itself', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    const content = readFileSync(join(__dirname, 'fixtures', 'surefire-reports', 'surefire-timeout-jstack-1-4242.txt'), 'utf8')
    const detail: AnalysisDetail = {
      id: 'a', status: 'CONCLUIDA',
      problemasDetectados: { problemas: [{ tipo: 'DEADLOCK', severidade: 'CRITICAL', evidencia: { nomesThreads: ['worker-A', 'worker-B'], stackResumo: [] } }] },
    }
    const md = renderReport([{ dump: { ...dump, content }, outcome: { ok: true, publicToken: 't', reportUrl: 'u', detail } }], ctx)
    expect(md).toContain('`worker-A`:')
    expect(md).toContain('at demo.DeadlockTest.lambda$hangs$0(DeadlockTest.java:10)')
    expect(md).toContain('`worker-B`:')
    expect(md).toContain('at demo.DeadlockTest.lambda$hangs$1(DeadlockTest.java:11)')
  })
})
