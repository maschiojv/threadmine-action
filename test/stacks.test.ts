import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { threadStack } from '../src/stacks'

const dump = readFileSync(join(__dirname, 'fixtures', 'surefire-reports', 'surefire-timeout-jstack-1-4242.txt'), 'utf8')

describe('threadStack', () => {
  it('returns the top frames and lock lines of a named thread', () => {
    expect(threadStack(dump, 'worker-A', 3)).toEqual([
      'at demo.DeadlockTest.lambda$hangs$0(DeadlockTest.java:10)',
      '- waiting to lock <0x00000000c0000020> (a java.lang.Object)',
      '- locked <0x00000000c0000010> (a java.lang.Object)',
    ])
  })

  it('ignores the thread name inside the deadlock summary', () => {
    expect(threadStack(dump, 'worker-B', 1)).toEqual(['at demo.DeadlockTest.lambda$hangs$1(DeadlockTest.java:11)'])
  })

  it('returns an empty list for an unknown thread', () => {
    expect(threadStack(dump, 'nope', 5)).toEqual([])
  })

  it('handles names with regex characters', () => {
    const text = '"pool-1-thread-1 (x)" #20 prio=5 tid=0x1 nid=0x2 waiting\n   java.lang.Thread.State: WAITING\n\tat a.B.c(B.java:1)\n'
    expect(threadStack(text, 'pool-1-thread-1 (x)', 5)).toEqual(['at a.B.c(B.java:1)'])
  })
})
