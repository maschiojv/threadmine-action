import { basename } from 'node:path'
import { classifyJvm, parseJcmdList, selectHungTestJvms } from './jvms'

export interface CollectedDump {
  source: 'live-jvm' | 'surefire-timeout'
  label: string
  fileName: string
  content: string
}

export interface CollectDeps {
  runJcmd(args: string[]): Promise<string>
  /** Absolute path of jcmd, or null when the runner has none. */
  jcmd: string | null
  workspace: string
  /** Every file under root, skipping node_modules and .git. */
  listFiles(root: string): Promise<string[]>
  readFile(p: string): Promise<string>
  /** When the main step ran (ms epoch); null when unknown. */
  startedAt: number | null
  modifiedAt(p: string): Promise<number>
}

/** Written by Surefire/Failsafe 3.6+ right before killing a fork past forkedProcessTimeoutInSeconds. */
const SUREFIRE_TIMEOUT_DUMP = /^surefire-timeout-jstack-.*\.txt$/

export async function collectDumps(deps: CollectDeps): Promise<{ dumps: CollectedDump[]; warnings: string[] }> {
  const dumps: CollectedDump[] = []
  const warnings: string[] = []

  if (deps.jcmd === null) {
    warnings.push('jcmd not found under JAVA_HOME; live JVMs were not dumped. Run actions/setup-java before this action.')
  } else {
    let hung: ReturnType<typeof selectHungTestJvms> = []
    try {
      hung = selectHungTestJvms(parseJcmdList(await deps.runJcmd(['-l'])))
    } catch (e) {
      warnings.push(`jcmd -l failed: ${errorMessage(e)}`)
    }
    for (const jvm of hung) {
      try {
        const content = await deps.runJcmd([String(jvm.pid), 'Thread.print'])
        dumps.push({
          source: 'live-jvm',
          label: `${classifyJvm(jvm)} pid ${jvm.pid}`,
          fileName: `thread-dump-${jvm.pid}.txt`,
          content,
        })
      } catch (e) {
        warnings.push(`Could not dump JVM ${jvm.pid}: ${errorMessage(e)}`)
      }
    }
  }

  let files: string[] = []
  try {
    files = await deps.listFiles(deps.workspace)
  } catch (e) {
    warnings.push(`Could not scan the workspace for Surefire timeout dumps: ${errorMessage(e)}`)
  }
  for (const file of files) {
    const name = basename(file)
    if (!SUREFIRE_TIMEOUT_DUMP.test(name)) continue
    try {
      // A file older than this job (committed, or left by a cached workspace) is not this run's hang.
      if (deps.startedAt !== null && (await deps.modifiedAt(file)) < deps.startedAt) continue
      dumps.push({ source: 'surefire-timeout', label: name, fileName: name, content: await deps.readFile(file) })
    } catch (e) {
      warnings.push(`Could not read ${file}: ${errorMessage(e)}`)
    }
  }

  return { dumps, warnings }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
