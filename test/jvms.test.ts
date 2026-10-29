import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyJvm, findJcmd, parseJcmdList, selectHungTestJvms } from '../src/jvms'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'jcmd-l', name), 'utf8')
const pids = (out: string) => selectHungTestJvms(parseJcmdList(out)).map((p) => p.pid)

describe('parseJcmdList', () => {
  it('parses pid and command', () => {
    const list = parseJcmdList(fixture('maven.txt'))
    expect(list).toHaveLength(3)
    expect(list[0].pid).toBe(2466)
    expect(list[0].command.startsWith('/home/runner')).toBe(true)
  })

  it('skips blank and garbage lines', () => {
    expect(parseJcmdList('\n  \nnot a jvm line\n42 some.Main\r\n')).toEqual([{ pid: 42, command: 'some.Main' }])
  })
})

describe('classifyJvm', () => {
  it('classifies spike JVMs', () => {
    const kind = (command: string) => classifyJvm({ pid: 1, command })
    expect(kind('/w/target/surefire/surefirebooter-20261029122926452_3.jar /w/target/surefire x')).toBe('surefire-fork')
    expect(kind("worker.org.gradle.process.internal.worker.GradleWorkerMain 'Gradle Test Executor 1'")).toBe('gradle-test-worker')
    expect(kind('org.codehaus.plexus.classworlds.launcher.Launcher -B -q test')).toBe('maven-launcher')
    expect(kind('org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.14')).toBe('ignored')
    expect(kind('/tmp/gradle-8.14/lib/gradle-gradle-cli-main-8.14.jar test --no-daemon')).toBe('ignored')
    expect(kind('jdk.jcmd/sun.tools.jcmd.JCmd -l')).toBe('ignored')
    expect(kind('jdk.compiler/com.sun.tools.javac.launcher.Main fixtures/Deadlock.java')).toBe('ignored')
  })
})

describe('selectHungTestJvms', () => {
  it('selects forks over the launcher', () => {
    expect(pids(fixture('maven.txt'))).toEqual([2466])
  })

  it('ignores daemon and client JVMs', () => {
    expect(pids(fixture('gradle.txt'))).toEqual([2402])
    expect(pids(fixture('plain-failure.txt'))).toEqual([])
  })

  it('falls back to the Maven launcher when no fork is alive', () => {
    expect(pids(fixture('maven-in-process.txt'))).toEqual([2363])
  })
})

describe('findJcmd', () => {
  it('returns JAVA_HOME/bin/jcmd when it exists', () => {
    const found = findJcmd({ JAVA_HOME: '/opt/jdk' }, () => true)
    expect(found).toBe(join('/opt/jdk', 'bin', 'jcmd'))
  })

  it('returns null without JAVA_HOME or when the file is missing', () => {
    expect(findJcmd({}, () => true)).toBeNull()
    expect(findJcmd({ JAVA_HOME: '/opt/jdk' }, () => false)).toBeNull()
  })
})
