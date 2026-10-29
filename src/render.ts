import type { CollectedDump } from './collect'
import type { AnalysisDetail, AnalysisOutcome } from './threadmine'

export interface ReportEntry {
  dump: CollectedDump
  /** Absent when the dump was not sent: analyze is off, or it was past the per-run cap. */
  outcome?: AnalysisOutcome
}

export interface RenderContext {
  analyzeEnabled: boolean
  artifactName: string
  runUrl: string
  marker: string
}

const MAX_THREADS = 5
const MAX_STACK_LINES = 5
const FOOTER = 'Thread dumps were analyzed at threadmine.dev. Set `analyze: false` to keep them only in the workflow artifact.'

/** One comment per job and OS: a re-run updates it, matrix legs on other OSes get their own. */
export function commentMarker(job: string, os: string): string {
  return `<!-- threadmine-action:${job}:${os} -->`
}

export function renderReport(entries: ReportEntry[], ctx: RenderContext): string {
  const lines: string[] = [ctx.marker, '## ThreadMine: hung test diagnosis', '']
  for (const entry of entries) {
    lines.push(`### ${entry.dump.label}`, '')
    const outcome = entry.outcome
    if (!outcome) {
      lines.push(`Not analyzed. Dump kept in the ${ctx.artifactName} artifact.`)
    } else if (!outcome.ok) {
      lines.push(`Analysis skipped: ${outcome.reason}`)
    } else {
      lines.push(...renderDetail(outcome.detail))
      lines.push(`Full report (expires in 7 days): ${outcome.reportUrl}`)
    }
    lines.push('')
  }
  lines.push(ctx.analyzeEnabled ? FOOTER : `Dumps are in the ${ctx.artifactName} artifact of ${ctx.runUrl}.`)
  return lines.join('\n') + '\n'
}

function renderDetail(detail: AnalysisDetail): string[] {
  const lines: string[] = []
  const score = detail.healthScore ?? detail.sumarioExecutivo?.healthScore
  if (score != null) lines.push(`Health score: **${score}/100**`, '')
  const problems = detail.problemasDetectados?.problemas ?? []
  if (problems.length === 0) {
    lines.push('No problems detected in this dump.', '')
    return lines
  }
  for (const p of problems) {
    lines.push(`**[${p.severidade ?? 'INFO'}] ${p.tipo ?? 'PROBLEM'}**${p.descricao ? `: ${p.descricao}` : ''}`)
    const ev = p.evidencia
    if (ev?.lockOuRecurso) lines.push(`- Lock: \`${ev.lockOuRecurso}\``)
    const names = ev?.nomesThreads ?? []
    if (names.length > 0) lines.push(`- Threads: ${names.slice(0, MAX_THREADS).map((n) => `\`${n}\``).join(', ')}`)
    if (p.recomendacao?.titulo) lines.push(`- Recommendation: ${p.recomendacao.titulo}`)
    const stack = ev?.stackResumo ?? []
    if (stack.length > 0) lines.push('', '```', ...stack.slice(0, MAX_STACK_LINES), '```')
    lines.push('')
  }
  return lines
}
