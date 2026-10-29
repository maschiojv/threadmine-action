import { errorMessage } from './collect'

export interface CommentTarget {
  owner: string
  repo: string
  issueNumber: number
}

/** The slice of the GitHub API the action needs; post.ts adapts Octokit to it. */
export interface CommentApi {
  listComments(t: CommentTarget): Promise<Array<{ id: number; body?: string }>>
  createComment(t: CommentTarget, body: string): Promise<void>
  updateComment(t: CommentTarget, id: number, body: string): Promise<void>
}

export type UpsertResult = { action: 'created' | 'updated' | 'skipped'; warning?: string }

/** Create the marked comment, or update it on a re-run. API errors become a warning, never a throw. */
export async function upsertPrComment(api: CommentApi, target: CommentTarget, body: string, marker: string): Promise<UpsertResult> {
  try {
    const existing = (await api.listComments(target)).find((c) => c.body?.includes(marker))
    if (existing) {
      await api.updateComment(target, existing.id, body)
      return { action: 'updated' }
    }
    await api.createComment(target, body)
    return { action: 'created' }
  } catch (e) {
    const status = (e as { status?: number }).status
    const warning = status === 403
      ? 'Could not comment on the pull request: the token needs `pull-requests: write` (fork PRs only get a read-only token). The diagnosis is in the job summary.'
      : `Could not comment on the pull request: ${errorMessage(e)}`
    return { action: 'skipped', warning }
  }
}
