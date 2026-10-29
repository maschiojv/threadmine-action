import { join } from 'node:path'

/** One line of `jcmd -l`: the pid and everything after it (main class or jar, then arguments). */
export interface JvmProcess {
  pid: number
  command: string
}

export type JvmKind = 'surefire-fork' | 'gradle-test-worker' | 'maven-launcher' | 'ignored'

const LINE = /^(\d+)\s+(.+)$/

export function parseJcmdList(output: string): JvmProcess[] {
  const list: JvmProcess[] = []
  for (const raw of output.split(/\r?\n/)) {
    const match = LINE.exec(raw.trim())
    if (match) list.push({ pid: Number(match[1]), command: match[2].trim() })
  }
  return list
}

export function classifyJvm(p: JvmProcess): JvmKind {
  if (/surefirebooter[^/\s]*\.jar/.test(p.command) || /ForkedBooter/.test(p.command)) return 'surefire-fork'
  if (/GradleWorkerMain.*Gradle Test Executor/.test(p.command)) return 'gradle-test-worker'
  if (/plexus\.classworlds\.launcher\.Launcher/.test(p.command)) return 'maven-launcher'
  return 'ignored'
}

/**
 * JVMs still alive in the post step are the ones the runner left behind when it killed the step.
 * Test forks are the hung ones; the Maven launcher only counts when no fork exists (forkCount=0).
 * Build daemons and clients survive every build, so they never count.
 */
export function selectHungTestJvms(list: JvmProcess[]): JvmProcess[] {
  const forks = list.filter((p) => {
    const kind = classifyJvm(p)
    return kind === 'surefire-fork' || kind === 'gradle-test-worker'
  })
  if (forks.length > 0) return forks
  return list.filter((p) => classifyJvm(p) === 'maven-launcher')
}

export function findJcmd(env: NodeJS.ProcessEnv, exists: (p: string) => boolean): string | null {
  const javaHome = env.JAVA_HOME
  if (!javaHome) return null
  const jcmd = join(javaHome, 'bin', 'jcmd')
  return exists(jcmd) ? jcmd : null
}
