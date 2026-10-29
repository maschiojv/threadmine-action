import * as core from '@actions/core'
import * as github from '@actions/github'
import { DefaultArtifactClient } from '@actions/artifact'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { collectDumps, type CollectedDump } from './collect'
import type { CommentApi, CommentTarget } from './comment'
import { findJcmd } from './jvms'
import { commentMarker } from './render'
import { artifactName, runPost } from './run'
import { analyzeDump } from './threadmine'

const execFileAsync = promisify(execFile)
const SKIP_DIRS = new Set(['node_modules', '.git', '.gradle', '.idea'])
const MAX_FILES_SCANNED = 200_000

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const stack = [root]
  while (stack.length > 0 && out.length < MAX_FILES_SCANNED) {
    const dir = stack.pop()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(join(dir, e.name))
      } else if (e.isFile()) {
        out.push(join(dir, e.name))
      }
    }
  }
  return out
}

async function uploadArtifact(name: string, files: CollectedDump[]): Promise<void> {
  const dir = join(process.env.RUNNER_TEMP ?? '/tmp', 'threadmine-dumps')
  await mkdir(dir, { recursive: true })
  const paths: string[] = []
  for (const f of files) {
    const p = join(dir, f.fileName)
    await writeFile(p, f.content)
    paths.push(p)
  }
  await new DefaultArtifactClient().uploadArtifact(name, paths, dir)
}

function prTarget(): CommentTarget | null {
  if (!core.getBooleanInput('comment')) return null
  const { eventName, payload, repo } = github.context
  if (eventName !== 'pull_request' && eventName !== 'pull_request_target') return null
  const number = payload.pull_request?.number
  return typeof number === 'number' ? { owner: repo.owner, repo: repo.repo, issueNumber: number } : null
}

/** Octokit is created on first use, so a missing token only matters when there is a PR to comment on. */
function commentApi(): CommentApi {
  let client: ReturnType<typeof github.getOctokit> | undefined
  const octokitFor = () => (client ??= github.getOctokit(core.getInput('github-token')))
  return {
    listComments: (t) => octokitFor().paginate(octokitFor().rest.issues.listComments,
      { owner: t.owner, repo: t.repo, issue_number: t.issueNumber, per_page: 100 }),
    createComment: async (t, body) => {
      await octokitFor().rest.issues.createComment({ owner: t.owner, repo: t.repo, issue_number: t.issueNumber, body })
    },
    updateComment: async (t, id, body) => {
      await octokitFor().rest.issues.updateComment({ owner: t.owner, repo: t.repo, comment_id: id, body })
    },
  }
}

async function main(): Promise<void> {
  const env = process.env
  if (env.RUNNER_OS === 'Windows') {
    core.info('ThreadMine: Windows runners are not supported yet.')
    return
  }
  const job = env.GITHUB_JOB ?? 'job'
  const os = env.RUNNER_OS ?? 'unknown'
  const jcmd = findJcmd(env, existsSync)
  await runPost({
    analyzeEnabled: core.getBooleanInput('analyze'),
    marker: commentMarker(job, os),
    artifactName: artifactName(job, os, () => randomBytes(3).toString('hex')),
    runUrl: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
    collect: () => collectDumps({
      jcmd,
      workspace: env.GITHUB_WORKSPACE ?? process.cwd(),
      runJcmd: async (args) => (await execFileAsync(jcmd!, args, { timeout: 20_000, maxBuffer: 64 * 1024 * 1024 })).stdout,
      listFiles,
      readFile: (p) => readFile(p, 'utf8'),
    }),
    analyze: (d) => analyzeDump(d, { apiUrl: core.getInput('api-url') }),
    uploadArtifact,
    writeSummary: async (md) => { await core.summary.addRaw(md).write() },
    prTarget: prTarget(),
    commentApi: commentApi(),
    warn: (m) => core.warning(m),
    info: (m) => core.info(m),
  })
}

main().catch((e) => core.warning(`ThreadMine action failed: ${e instanceof Error ? e.message : String(e)}`))
