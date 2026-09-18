/**
 * The agent-neutral half of recovering a coding agent's conversation from the
 * transcript it leaves on disk: finding the files, draining the spool, POSTing
 * a body, and running a bounded batch of posts.
 *
 * None of it knows what an agent writes into its transcript or what OTLP body
 * that becomes — those stay with the agent (`codex-rollout-otlp.ts` for codex).
 * Lifted out of that file so a second agent's reader reuses the transport
 * rather than growing a second copy of it.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { GovernanceCliError } from "./cli-api";
import { defaultStateDir } from "./hook-state";
import { drainSessionContextSpool } from "./session-context-spool";

/**
 * Walk a session tree, handing every file to `onFile`. Descends while
 * `depth < maxDepth`, so the caller's own layout — codex's `YYYY/MM/DD`, a flat
 * directory, anything else — is stated once at the call site rather than in
 * each caller's own walk, where a layout change would be fixed in one and
 * missed in the other.
 *
 * Newest first: a caller looking for the session that just ended wants today's
 * directory, and `readdir` order is whatever the filesystem says. Date path
 * segments are zero-padded, so a descending name sort is a descending date
 * sort. A caller that stops on a match (`onFile` returning true) therefore
 * finds a recent session in the first directory it opens, rather than after
 * walking a long-lived account's older ones.
 *
 * `followSymlinks` is off by default and opted into per caller. A directory
 * entry reports what the entry itself is, so a symlink is neither a directory
 * nor a file and is skipped — a linked project folder, or a linked session
 * file, is invisible. That is the right default for an agent whose own reader
 * refuses links, and the wrong one for an agent whose reader follows them:
 * reading fewer files than the agent writes is the silent miss, since nothing
 * fails and no session arrives. Turning it on resolves the link to decide what
 * it points at; a link that points nowhere is skipped, and `maxDepth` bounds a
 * cycle the same way it bounds real directories.
 */
export async function walkSessionFiles({
  root,
  maxDepth,
  followSymlinks = false,
  onFile,
}: {
  root: string;
  maxDepth: number;
  followSymlinks?: boolean;
  onFile: (path: string, name: string) => Promise<boolean | void> | boolean;
}): Promise<void> {
  async function walk(dir: string, depth: number): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    entries.sort((a, b) => b.name.localeCompare(a.name));
    for (const e of entries) {
      const full = join(dir, e.name);
      let isDirectory = e.isDirectory();
      let isFile = e.isFile();
      if (followSymlinks && e.isSymbolicLink()) {
        try {
          // `stat` follows the link; `readdir` reported the link itself.
          const target = await stat(full);
          isDirectory = target.isDirectory();
          isFile = target.isFile();
        } catch {
          continue; // Points nowhere.
        }
      }
      if (isDirectory) {
        if (depth < maxDepth && (await walk(full, depth + 1))) return true;
      } else if (isFile && (await onFile(full, e.name))) {
        return true;
      }
    }
    return false;
  }
  await walk(root, 0);
}

/**
 * Every file under `root` whose name the caller accepts and whose mtime is at
 * or after `sinceMs`.
 *
 * Modification time, not creation time, is the window on purpose: an agent
 * appends to a transcript it reopens, so a resumed session moves back into the
 * window and is offered again in full. What stops those turns being recorded
 * twice is the caller's de-duplication, not this filter. Unreadable entries are
 * skipped rather than failing the sweep.
 *
 * `sinceMs` is compared against a clock this function does not control. A
 * modification time comes from the kernel, and on Linux it advances in
 * one-millisecond steps while `Date.now()` does not, so a file written after a
 * `Date.now()` can carry an mtime up to a millisecond before it — measured.
 * A caller whose `sinceMs` is a `Date.now()` taken moments before the file was
 * written is therefore asking a question whose answer is a coin flip, and gets
 * silence either way. Such a caller must subtract its own grace before calling;
 * see
 * `FS_CLOCK_SKEW_GRACE_MS` in `pi-capture.ts` for the reasoning and for why a
 * grace is safe only where a second, finer window enforces the real boundary.
 */
export async function findFilesModifiedSince({
  root,
  maxDepth,
  followSymlinks = false,
  sinceMs,
  matchesName,
}: {
  root: string;
  maxDepth: number;
  followSymlinks?: boolean;
  sinceMs: number;
  matchesName: (name: string) => boolean;
}): Promise<string[]> {
  const out: string[] = [];
  await walkSessionFiles({
    root,
    maxDepth,
    followSymlinks,
    onFile: async (full, name) => {
      if (!matchesName(name)) return false;
      if (await fileModifiedSince({ path: full, sinceMs })) out.push(full);
      return false;
    },
  });
  return out;
}

/**
 * Whether one file — named rather than found by a walk — is a file at all and
 * was last modified at or after `sinceMs`.
 *
 * The same question {@link findFilesModifiedSince} asks of everything it walks,
 * for a caller that already knows the path: pi can be handed an exact session
 * file with `--session`, and that file can be anywhere, so no walk reaches it.
 * Splitting the rule across two modules is how the two answers drift — one
 * gains a clock allowance or a link rule and the other does not — and the
 * allowance in particular is subtle enough that only one of them would get it.
 *
 * False rather than throwing for a path that does not exist, cannot be read, or
 * is a directory. An absent file is the ordinary state early in a run.
 */
export async function fileModifiedSince({
  path,
  sinceMs,
}: {
  path: string;
  sinceMs: number;
}): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile() && s.mtimeMs >= sinceMs;
  } catch {
    return false;
  }
}

/**
 * Send the declarations a sandboxed `langwatch ingest context` could not.
 *
 * The notify program an agent runs is spawned from the agent's own process,
 * outside the sandbox it puts its shell in, so this is the seam that can reach
 * the collector when the agent's own shell cannot. Callers run it after the
 * session context posts, so a declared checkout is the last one written and
 * becomes the session's current branch.
 */
export async function drainSpooledSessionContext(args: {
  nowMs: number;
  logsEndpoint: string | null;
  token: string;
  stateDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const { logsEndpoint, token } = args;
  if (!logsEndpoint) return;
  const doFetch = args.fetchImpl ?? fetch;
  await drainSessionContextSpool({
    stateDir: args.stateDir ?? defaultStateDir(),
    now: () => args.nowMs,
    post: async (payload) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await doFetch(logsEndpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        return response.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

/**
 * A refusal from the ingest endpoint, named so the caller can act on it.
 *
 * The key an agent posts with lives in its config file and is the normal thing
 * to go stale, so a refusal of the key reads as a key problem rather than as a
 * status code the reader has to look up. `tool` names the agent in both the
 * sentence and the command that reissues the key.
 */
export function ingestRefusal({
  status,
  tool,
}: {
  status: number;
  tool: string;
}): GovernanceCliError {
  if (status === 401 || status === 403) {
    return new GovernanceCliError(
      status,
      "ingest_key_rejected",
      `LangWatch refused the ingest key ${tool} is configured with. Run \`langwatch ingest install ${tool}\` to issue a new one.`,
    );
  }
  return new GovernanceCliError(
    status,
    "ingest_rejected",
    `LangWatch did not accept the conversation (HTTP ${status}).`,
  );
}

/**
 * POST one OTLP body. Capped at 5s so a slow or unreachable endpoint can't
 * wedge the user's shell.
 *
 * A refused upload throws, the same as an unreachable one: a response that
 * arrived is not the same as content that landed, and the turn-completion path
 * runs after every turn of every session, so "the key expired" would otherwise
 * read as success forever. Each caller decides what to do with the throw: the
 * turn-completion path swallows it, the backfill reports it.
 */
export async function postOtlpBody(args: {
  body: unknown;
  endpoint: string;
  token: string;
  /** The agent named in a refusal, e.g. `codex`. */
  tool: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const { body, endpoint, token, tool, fetchImpl } = args;
  const doFetch = fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  let response: Response;
  try {
    response = await doFetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw ingestRefusal({ status: response.status, tool });
}

/**
 * Run `handle` over every item, a few at a time, and stop starting new ones
 * once `budgetMs` is gone.
 *
 * Awaiting one item at a time is what makes an unreachable endpoint a long
 * delay rather than a short one: a sweep of every transcript on disk spends the
 * full per-post timeout on each session before the next one starts. Running
 * them together bounds the worst case at the budget plus the one call still in
 * flight, whatever the item count. Items the batch does not reach are the
 * caller's to offer again, which is the same path a refused post already takes.
 *
 * `handle` is expected not to throw — a rejection propagates out of here and
 * abandons the remaining items.
 */
export async function runBoundedBatch<T>({
  items,
  concurrency,
  budgetMs,
  handle,
}: {
  items: T[];
  concurrency: number;
  budgetMs: number;
  handle: (item: T | undefined) => Promise<unknown>;
}): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  let outOfBudget = false;
  const budget = setTimeout(() => {
    outOfBudget = true;
  }, budgetMs);
  // A CLI must not stay alive for the budget alone: every call can finish
  // early, and then there is nothing left to wait for.
  budget.unref?.();
  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (!outOfBudget && next < items.length) {
          // Read and advance in one synchronous step, so two workers never
          // take the same item.
          await handle(items[next++]);
        }
      }),
    );
  } finally {
    clearTimeout(budget);
  }
}
