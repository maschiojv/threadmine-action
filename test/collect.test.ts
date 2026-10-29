import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectDumps, type CollectDeps } from '../src/collect'

const fixtures = join(__dirname, 'fixtures')
const jcmdList = (name: string) => readFileSync(join(fixtures, 'jcmd-l', name), 'utf8')
const surefireFile = join(fixtures, 'surefire-reports', 'surefire-timeout-jstack-1-4242.txt')

function deps(over: Partial<CollectDeps> & { list?: string; files?: string[] }): CollectDeps {
  const list = over.list ?? ''
  return {
    jcmd: '/jdk/bin/jcmd',
    workspace: '/ws',
    runJcmd: async (args) => (args[0] === '-l' ? list : `dump of ${args[0]}`),
    listFiles: async () => over.files ?? [],
    readFile: async (p) => readFileSync(p, 'utf8'),
    ...over,
  }
}

describe('collectDumps', () => {
  it('dumps every hung test JVM', async () => {
    const { dumps, warnings } = await collectDumps(deps({ list: jcmdList('gradle.txt') }))
    expect(warnings).toEqual([])
    expect(dumps).toHaveLength(1)
    expect(dumps[0]).toMatchObject({
      source: 'live-jvm', label: 'gradle-test-worker pid 2402', fileName: 'thread-dump-2402.txt', content: 'dump of 2402',
    })
  })

  it('adds surefire timeout files after live JVMs', async () => {
    const { dumps } = await collectDumps(deps({
      list: jcmdList('maven.txt'),
      files: ['/ws/target/surefire-reports/TEST-demo.xml', surefireFile],
    }))
    expect(dumps.map((d) => d.source)).toEqual(['live-jvm', 'surefire-timeout'])
    expect(dumps[1]).toMatchObject({ label: 'surefire-timeout-jstack-1-4242.txt', fileName: 'surefire-timeout-jstack-1-4242.txt' })
    expect(dumps[1].content).toContain('Found one Java-level deadlock')
  })

  it('skips live JVMs when jcmd is missing', async () => {
    const { dumps, warnings } = await collectDumps(deps({ jcmd: null, list: jcmdList('maven.txt'), files: [surefireFile] }))
    expect(dumps.map((d) => d.source)).toEqual(['surefire-timeout'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('jcmd')
  })

  it('a failing Thread.print becomes a warning', async () => {
    const twoForks = '10 /w/surefirebooter-1.jar x\n11 /w/surefirebooter-2.jar x\n'
    const { dumps, warnings } = await collectDumps(deps({
      runJcmd: async (args) => {
        if (args[0] === '-l') return twoForks
        if (args[0] === '10') throw new Error('Unable to open socket file')
        return `dump of ${args[0]}`
      },
    }))
    expect(dumps.map((d) => d.label)).toEqual(['surefire-fork pid 11'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('10')
  })

  it('returns nothing for a plain failure', async () => {
    expect(await collectDumps(deps({ list: jcmdList('plain-failure.txt') }))).toEqual({ dumps: [], warnings: [] })
  })
})
