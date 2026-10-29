import { describe, expect, it } from 'vitest'
import type { CollectedDump } from '../src/collect'
import type { CommentApi } from '../src/comment'
import { artifactName, runPost, type PostDeps } from '../src/run'
import type { AnalysisOutcome } from '../src/threadmine'

const mkDump = (i: number): CollectedDump => ({ source: 'live-jvm', label: `surefire-fork pid ${i}`, fileName: `thread-dump-${i}.txt`, content: 'x' })
const ok: AnalysisOutcome = { ok: true, publicToken: 't', reportUrl: 'https://threadmine.dev/resultado/t', detail: { id: 'a', status: 'CONCLUIDA' } }
const deadlock: AnalysisOutcome = {
  ok: true, publicToken: 't', reportUrl: 'https://threadmine.dev/resultado/t',
  detail: { id: 'a', status: 'CONCLUIDA', problemasDetectados: { problemas: [{ tipo: 'DEADLOCK', severidade: 'CRITICAL' }] } },
}

function harness(over: Partial<PostDeps> = {}, dumps: CollectedDump[] = [mkDump(1)]) {
  const log = { infos: [] as string[], analyzed: 0, uploaded: [] as string[], summaries: [] as string[], comments: [] as string[], warnings: [] as string[] }
  const commentApi: CommentApi = {
    listComments: async () => [],
    createComment: async (_t, b) => { log.comments.push(b) },
    updateComment: async () => {},
  }
  const deps: PostDeps = {
    analyzeEnabled: true,
    marker: '<!-- threadmine-action:test:Linux -->',
    artifactName: 'threadmine-thread-dumps-test-linux-abc123',
    runUrl: 'https://github.com/o/r/actions/runs/1',
    collect: async () => ({ dumps, warnings: [] }),
    analyze: async () => { log.analyzed++; return ok },
    uploadArtifact: async (_name, files) => { log.uploaded.push(...files.map((f) => f.fileName)) },
    writeSummary: async (md) => { log.summaries.push(md) },
    prTarget: null,
    commentApi,
    warn: (m) => { log.warnings.push(m) },
    info: (m) => { log.infos.push(m) },
    now: () => 0,
    ...over,
  }
  return { deps, log }
}

describe('runPost', () => {
  it('does nothing when no dump is found', async () => {
    const { deps, log } = harness({}, [])
    await runPost(deps)
    expect(log).toMatchObject({ analyzed: 0, uploaded: [], summaries: [], comments: [] })
  })

  it('analyzes at most 3 dumps', async () => {
    const { deps, log } = harness({}, [1, 2, 3, 4, 5].map(mkDump))
    await runPost(deps)
    expect(log.analyzed).toBe(3)
    expect(log.uploaded).toHaveLength(5)
    expect(log.summaries[0]).toContain('surefire-fork pid 5')
    expect(log.summaries[0]).toContain('Not analyzed')
  })

  it('skips analysis when analyze is false', async () => {
    const { deps, log } = harness({ analyzeEnabled: false })
    await runPost(deps)
    expect(log.analyzed).toBe(0)
    expect(log.summaries).toHaveLength(1)
  })

  it('keeps artifact and summary when analysis fails', async () => {
    const { deps, log } = harness({ analyze: async () => ({ ok: false, reason: 'ThreadMine rate limit reached' }) })
    await runPost(deps)
    expect(log.uploaded).toEqual(['thread-dump-1.txt'])
    expect(log.summaries[0]).toContain('Analysis skipped: ThreadMine rate limit reached')
  })

  it('never throws', async () => {
    const { deps, log } = harness({
      uploadArtifact: async () => { throw new Error('artifact service down') },
      analyze: async () => { throw new Error('unexpected') },
    })
    await expect(runPost(deps)).resolves.toBeUndefined()
    expect(log.warnings.join('\n')).toContain('artifact service down')
    expect(log.summaries).toHaveLength(1)
  })

  it('writes the report to the step log too', async () => {
    const { deps, log } = harness()
    await runPost(deps)
    expect(log.infos.join(String.fromCharCode(10))).toContain(log.summaries[0])
  })

  it('passes collection warnings on', async () => {
    const { deps, log } = harness({ collect: async () => ({ dumps: [], warnings: ['jcmd not found'] }) })
    await runPost(deps)
    expect(log.warnings).toEqual(['jcmd not found'])
  })

  it('comments only with a PR target', async () => {
    const without = harness()
    await runPost(without.deps)
    expect(without.log.comments).toEqual([])

    const withPr = harness({ prTarget: { owner: 'o', repo: 'r', issueNumber: 7 }, analyze: async () => deadlock })
    await runPost(withPr.deps)
    expect(withPr.log.comments).toHaveLength(1)
    expect(withPr.log.comments[0]).toBe(withPr.log.summaries[0])
  })
})

describe('runPost noise and time limits', () => {
  it('does not comment when no analysis found a problem', async () => {
    const { deps, log } = harness({ prTarget: { owner: 'o', repo: 'r', issueNumber: 7 } })
    await runPost(deps)
    expect(log.summaries).toHaveLength(1)
    expect(log.comments).toEqual([])
  })

  it('stops analyzing after a rate limit', async () => {
    let calls = 0
    const { deps, log } = harness({
      analyze: async () => { calls++; return { ok: false, reason: 'ThreadMine rate limit reached', rateLimited: true } },
    }, [1, 2, 3].map(mkDump))
    await runPost(deps)
    expect(calls).toBe(1)
    expect(log.summaries[0].match(/Not analyzed/g)).toHaveLength(2)
  })

  it('passes one shared deadline and skips analyses past it', async () => {
    let t = 0
    const deadlines: number[] = []
    const { deps, log } = harness({
      now: () => t,
      analyze: async (_d, deadline) => { deadlines.push(deadline); t += 250_000; return ok },
    }, [1, 2].map(mkDump))
    await runPost(deps)
    expect(deadlines).toEqual([240_000])
    expect(log.summaries[0]).toContain('Not analyzed')
  })
})

describe('artifactName', () => {
  it('artifact names are unique per job leg', () => {
    let n = 0
    const rand = () => ['aaaaaa', 'bbbbbb'][n++]
    const first = artifactName('test', 'Linux', '', rand)
    const second = artifactName('test', 'Linux', '', rand)
    expect(first).not.toBe(second)
    expect(first.startsWith('threadmine-thread-dumps-test-linux-')).toBe(true)
    expect(second.startsWith('threadmine-thread-dumps-test-linux-')).toBe(true)
  })

  it('puts a safe form of the key in the artifact name', () => {
    expect(artifactName('test', 'Linux', 'java 21/x', () => 'cccccc')).toBe('threadmine-thread-dumps-test-linux-java-21-x-cccccc')
  })
})
