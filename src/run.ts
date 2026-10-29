import { errorMessage, type CollectedDump } from './collect'
import { upsertPrComment, type CommentApi, type CommentTarget } from './comment'
import { renderReport, type ReportEntry } from './render'
import type { AnalysisOutcome } from './threadmine'

/** The anonymous endpoint allows 5 analyses per hour per IP; leave room for a re-run. */
export const MAX_ANALYSES_PER_RUN = 3
/** All analyses of one job share this budget, so a slow API cannot hold the runner for long. */
export const ANALYSIS_BUDGET_MS = 240_000

export interface PostDeps {
  analyzeEnabled: boolean
  marker: string
  artifactName: string
  runUrl: string
  collect(): Promise<{ dumps: CollectedDump[]; warnings: string[] }>
  /** deadline: absolute ms on the same clock as now(). */
  analyze(d: CollectedDump, deadline: number): Promise<AnalysisOutcome>
  now(): number
  uploadArtifact(name: string, files: CollectedDump[]): Promise<void>
  writeSummary(md: string): Promise<void>
  /** Null outside pull requests, or when the comment input is false. */
  prTarget: CommentTarget | null
  commentApi: CommentApi
  warn(msg: string): void
  info(msg: string): void
}

/** Artifact names must be unique within a run, and matrix legs share the job id. */
export function artifactName(job: string, os: string, key: string, randomHex: () => string): string {
  const safeKey = key.replace(/[^A-Za-z0-9._-]+/g, '-')
  return `threadmine-thread-dumps-${job}-${os.toLowerCase()}-${safeKey ? `${safeKey}-` : ''}${randomHex()}`
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
    const deadline = deps.now() + ANALYSIS_BUDGET_MS
    let rateLimited = false
    for (const [i, dump] of dumps.entries()) {
      // Past the cap, the budget or a rate limit, the dump stays in the artifact only.
      if (!deps.analyzeEnabled || i >= MAX_ANALYSES_PER_RUN || rateLimited || deps.now() >= deadline) {
        entries.push({ dump })
        continue
      }
      let outcome: AnalysisOutcome
      try {
        outcome = await deps.analyze(dump, deadline)
      } catch (e) {
        outcome = { ok: false, reason: errorMessage(e) }
      }
      if (!outcome.ok && outcome.rateLimited) rateLimited = true
      entries.push({ dump, outcome })
    }

    const md = renderReport(entries, {
      analyzeEnabled: deps.analyzeEnabled, artifactName: deps.artifactName, runUrl: deps.runUrl, marker: deps.marker,
    })
    // Also in the step log: searchable, and readable even when the summary page does not load.
    deps.info(md)
    try {
      await deps.writeSummary(md)
    } catch (e) {
      deps.warn(`Could not write the job summary: ${errorMessage(e)}`)
    }

    // A run cancelled mid-test looks like a hang (its JVMs are alive too). Only a detected problem
    // earns a PR comment; the job summary and the log always get the report.
    const foundProblem = entries.some((e) => e.outcome?.ok && (e.outcome.detail.problemasDetectados?.problemas?.length ?? 0) > 0)
    if (deps.prTarget && foundProblem) {
      const result = await upsertPrComment(deps.commentApi, deps.prTarget, md, deps.marker)
      if (result.warning) deps.warn(result.warning)
    }
  } catch (e) {
    deps.warn(`ThreadMine action failed: ${errorMessage(e)}`)
  }
}
