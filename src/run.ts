import { errorMessage, type CollectedDump } from './collect'
import { upsertPrComment, type CommentApi, type CommentTarget } from './comment'
import { renderReport, type ReportEntry } from './render'
import type { AnalysisOutcome } from './threadmine'

/** The anonymous endpoint allows 5 analyses per hour per IP; leave room for a re-run. */
export const MAX_ANALYSES_PER_RUN = 3

export interface PostDeps {
  analyzeEnabled: boolean
  marker: string
  artifactName: string
  runUrl: string
  collect(): Promise<{ dumps: CollectedDump[]; warnings: string[] }>
  analyze(d: CollectedDump): Promise<AnalysisOutcome>
  uploadArtifact(name: string, files: CollectedDump[]): Promise<void>
  writeSummary(md: string): Promise<void>
  /** Null outside pull requests, or when the comment input is false. */
  prTarget: CommentTarget | null
  commentApi: CommentApi
  warn(msg: string): void
  info(msg: string): void
}

/** Artifact names must be unique within a run, and matrix legs share the job id. */
export function artifactName(job: string, os: string, randomHex: () => string): string {
  return `threadmine-thread-dumps-${job}-${os.toLowerCase()}-${randomHex()}`
}

/** The post step. Every failure becomes a warning: this action must never fail the job. */
export async function runPost(deps: PostDeps): Promise<void> {
  try {
    const { dumps, warnings } = await deps.collect()
    warnings.forEach((w) => deps.warn(w))
    if (dumps.length === 0) {
      deps.info('ThreadMine: no hung test JVM and no Surefire timeout dump found; nothing to report.')
      return
    }

    try {
      await deps.uploadArtifact(deps.artifactName, dumps)
    } catch (e) {
      deps.warn(`Could not upload the thread dumps artifact: ${errorMessage(e)}`)
    }

    const entries: ReportEntry[] = []
    for (const [i, dump] of dumps.entries()) {
      if (!deps.analyzeEnabled || i >= MAX_ANALYSES_PER_RUN) {
        entries.push({ dump })
        continue
      }
      let outcome: AnalysisOutcome
      try {
        outcome = await deps.analyze(dump)
      } catch (e) {
        outcome = { ok: false, reason: errorMessage(e) }
      }
      entries.push({ dump, outcome })
    }

    const md = renderReport(entries, {
      analyzeEnabled: deps.analyzeEnabled, artifactName: deps.artifactName, runUrl: deps.runUrl, marker: deps.marker,
    })
    try {
      await deps.writeSummary(md)
    } catch (e) {
      deps.warn(`Could not write the job summary: ${errorMessage(e)}`)
    }

    if (deps.prTarget) {
      const result = await upsertPrComment(deps.commentApi, deps.prTarget, md, deps.marker)
      if (result.warning) deps.warn(result.warning)
    }
  } catch (e) {
    deps.warn(`ThreadMine action failed: ${errorMessage(e)}`)
  }
}
