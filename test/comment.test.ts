import { describe, expect, it } from 'vitest'
import { upsertPrComment, type CommentApi } from '../src/comment'

const target = { owner: 'o', repo: 'r', issueNumber: 7 }
const MARKER = '<!-- threadmine-action:test:Linux -->'
const body = `${MARKER}\n## report`

function fakeApi(existing: Array<{ id: number; body?: string }>, createError?: unknown) {
  const created: string[] = []
  const updated: Array<{ id: number; body: string }> = []
  const api: CommentApi = {
    listComments: async () => existing,
    createComment: async (_t, b) => { if (createError) throw createError; created.push(b) },
    updateComment: async (_t, id, b) => { updated.push({ id, body: b }) },
  }
  return { api, created, updated }
}

describe('upsertPrComment', () => {
  it('creates a comment when none is marked', async () => {
    const f = fakeApi([{ id: 1, body: 'lgtm' }, { id: 2, body: '<!-- threadmine-action:other:Linux -->' }])
    expect(await upsertPrComment(f.api, target, body, MARKER)).toEqual({ action: 'created' })
    expect(f.created).toEqual([body])
    expect(f.updated).toEqual([])
  })

  it('updates the existing marked comment', async () => {
    const f = fakeApi([{ id: 1, body: 'lgtm' }, { id: 9, body: `${MARKER}\nold` }])
    expect(await upsertPrComment(f.api, target, body, MARKER)).toEqual({ action: 'updated' })
    expect(f.updated).toEqual([{ id: 9, body }])
    expect(f.created).toEqual([])
  })

  it('warns and continues on 403', async () => {
    const f = fakeApi([], Object.assign(new Error('Resource not accessible by integration'), { status: 403 }))
    const result = await upsertPrComment(f.api, target, body, MARKER)
    expect(result.action).toBe('skipped')
    expect(result.warning).toContain('pull-requests: write')
  })

  it('warns on any other API error', async () => {
    const f = fakeApi([], Object.assign(new Error('boom'), { status: 500 }))
    const result = await upsertPrComment(f.api, target, body, MARKER)
    expect(result.action).toBe('skipped')
    expect(result.warning).toContain('boom')
  })
})
