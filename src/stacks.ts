const FRAME = /^\s*(at |- (waiting to lock|locked|parking to wait for|waiting on) )/

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Top stack lines of one thread in a jstack / jcmd Thread.print dump: frames plus the lock lines
 * that say what it holds and waits for. Only the thread header counts ("name" followed by #id,
 * daemon, prio= or tid=), not the same name quoted in the deadlock summary.
 */
export function threadStack(dump: string, threadName: string, maxLines: number): string[] {
  const header = new RegExp(`^"${escapeRegExp(threadName)}"\\s+(#|daemon|prio=|tid=)`)
  const lines = dump.split(/\r?\n/)
  const start = lines.findIndex((l) => header.test(l))
  if (start < 0) return []
  const out: string[] = []
  for (let i = start + 1; i < lines.length && out.length < maxLines; i++) {
    const line = lines[i]
    if (line.trim() === '') break
    if (FRAME.test(line)) out.push(line.trim())
  }
  return out
}
