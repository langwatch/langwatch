/**
 * Which codex session ran this command, read from the process tree instead of
 * inferred from file times.
 *
 * Codex exports nothing about itself into the processes it spawns
 * (openai/codex#8923), which is why the rest of this seam infers the session
 * from rollout timestamps. But codex holds its rollout transcript OPEN for the
 * whole session, and `langwatch ingest context` always runs as a descendant of
 * the codex process, because codex spawns the shell that runs it. So the
 * invoking session is identifiable by construction: walk up the parent chain
 * and the first ancestor holding a rollout file open IS the session asking.
 * Two sessions running side by side stop being ambiguous, because each one's
 * command reaches its own process, not the newest writer on the machine.
 *
 * The identifying property is the open rollout, never the process name. A
 * process called `codex` that holds no rollout is not a session, and a session
 * renamed or wrapped still holds its rollout. The rollout has to be one of
 * codex's own, inside the sessions tree, since any process can open a file
 * named like one.
 *
 * Every step of the walk is best-effort. A sandbox that blocks `lsof`, a
 * platform without it, a `ps` that fails, a process that exits mid-walk: all
 * of them return nothing and the caller falls back to the timestamp inference.
 * The whole walk is also bounded in time, because this runs in front of a live
 * agent turn.
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

import { execFile } from "node:child_process";
import { opendir, readFile, readlink } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

import { ROLLOUT_SESSION_ID } from "./codex-live-session";
import { defaultCodexSessionsRoot } from "./codex-rollout-otlp";

/** How far up the parent chain a codex session is worth looking for. */
export const MAX_ANCESTOR_HOPS = 15;

/** How long one process's open files may take to list. */
export const OPEN_FILES_TIMEOUT_MS = 1_500;

/** How long the whole walk may take, agent turn included. */
export const ANCESTOR_WALK_BUDGET_MS = 2_000;

/** How many descriptors to resolve before checking the clock again. */
const FD_BATCH = 64;

/** The two readings the walk needs, injectable so tests never run `lsof`. */
export interface AncestorProbe {
  /** The parent of a pid, or null when it cannot be read. */
  parentPidOf: (pid: number) => Promise<number | null>;
  /** The paths a pid holds open, empty when they cannot be read. */
  openFilesOf: (pid: number, timeoutMs: number) => Promise<string[]>;
}

export interface AncestorCodexSession {
  sessionId: string;
  rolloutPath: string;
}

function runCommand({
  file,
  args,
  timeoutMs,
}: {
  file: string;
  args: string[];
  timeoutMs: number;
}): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) =>
      resolve(error ? "" : stdout),
    );
  });
}

const isLinux = process.platform === "linux";

/** `/proc` on linux, `ps` everywhere else. */
async function readParentPid(pid: number): Promise<number | null> {
  if (isLinux) {
    try {
      const status = await readFile(`/proc/${pid}/status`, "utf8");
      const parsed = Number(/^PPid:\s*(\d+)$/m.exec(status)?.[1]);
      return Number.isInteger(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  const out = await runCommand({
    file: "/bin/ps",
    args: ["-o", "ppid=", "-p", String(pid)],
    timeoutMs: OPEN_FILES_TIMEOUT_MS,
  });
  const parsed = Number(out.trim());
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Resolve a directory of symlinks, in batches, giving up when the deadline
 * passes. A process can hold thousands of descriptors, and resolving all of
 * them would blow the walk budget before the walk got the chance to check it.
 *
 * The directory is streamed rather than listed, so a huge descriptor table is
 * never materialised and the clock is checked before every batch starts.
 */
export async function readSymlinkedPaths({
  dir,
  timeoutMs,
  nowMs = () => Date.now(),
}: {
  dir: string;
  timeoutMs: number;
  nowMs?: () => number;
}): Promise<string[]> {
  const deadline = nowMs() + timeoutMs;
  if (nowMs() >= deadline) return [];

  let handle: Awaited<ReturnType<typeof opendir>>;
  try {
    handle = await opendir(dir);
  } catch {
    return [];
  }

  const paths: string[] = [];
  const drain = async (batch: string[]): Promise<void> => {
    const resolved = await Promise.all(
      batch.map((name) => readlink(join(dir, name)).catch(() => "")),
    );
    for (const path of resolved) if (path) paths.push(path);
  };

  try {
    let batch: string[] = [];
    for await (const entry of handle) {
      if (nowMs() >= deadline) break;
      batch.push(entry.name);
      if (batch.length < FD_BATCH) continue;
      await drain(batch);
      batch = [];
    }
    if (batch.length > 0 && nowMs() < deadline) await drain(batch);
  } catch {
    /* the process exited mid-read: what was resolved still counts */
  } finally {
    try {
      await handle.close();
    } catch {
      /* finishing or breaking out of `for await` already closed it */
    }
  }
  return paths;
}

/** `/proc/<pid>/fd` on linux, `lsof -Fn` everywhere else. */
async function readOpenFiles(pid: number, timeoutMs: number): Promise<string[]> {
  if (isLinux) {
    return readSymlinkedPaths({ dir: `/proc/${pid}/fd`, timeoutMs });
  }
  const out = await runCommand({
    file: "/usr/sbin/lsof",
    args: ["-p", String(pid), "-Fn"],
    timeoutMs,
  });
  // -Fn prints one field per line, each prefixed by its field letter; `n` is
  // the name. Anything else on the line belongs to another field.
  return out
    .split("\n")
    .filter((line) => line.startsWith("n/"))
    .map((line) => line.slice(1));
}

/** The real readings, used whenever a caller injects nothing. */
export const systemAncestorProbe: AncestorProbe = {
  parentPidOf: readParentPid,
  openFilesOf: readOpenFiles,
};

/** Whether a path sits inside a directory, symlink games and `..` resolved. */
function isInside({ root, candidate }: { root: string; candidate: string }): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(
      resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`,
    )
  );
}

/**
 * The codex session whose process this command runs under, or null when the
 * process tree does not answer inside the budget.
 */
export async function resolveCodexSessionFromAncestors({
  startPid,
  probe = systemAncestorProbe,
  sessionsRoot = defaultCodexSessionsRoot(),
  maxHops = MAX_ANCESTOR_HOPS,
  budgetMs = ANCESTOR_WALK_BUDGET_MS,
  nowMs = () => Date.now(),
}: {
  startPid?: number;
  probe?: AncestorProbe;
  sessionsRoot?: string;
  maxHops?: number;
  budgetMs?: number;
  nowMs?: () => number;
}): Promise<AncestorCodexSession | null> {
  if (!startPid || startPid <= 1) return null;
  const deadline = nowMs() + budgetMs;

  let pid: number | null = startPid;
  for (let hop = 0; hop < maxHops && pid && pid > 1; hop++) {
    const remaining = deadline - nowMs();
    if (remaining <= 0) return null;

    let openFiles: string[] = [];
    try {
      openFiles = await probe.openFilesOf(pid, Math.min(OPEN_FILES_TIMEOUT_MS, remaining));
    } catch {
      /* this ancestor does not answer: the next one still might */
    }

    for (const filePath of openFiles) {
      const sessionId = ROLLOUT_SESSION_ID.exec(basename(filePath))?.[1];
      // The name alone is not the property. Any process can hold a file
      // called rollout-<uuid>.jsonl open; only codex writes one into the
      // sessions tree, so a match outside that tree names no session.
      if (!sessionId) continue;
      if (!isInside({ root: sessionsRoot, candidate: filePath })) continue;
      return { sessionId, rolloutPath: filePath };
    }

    if (deadline - nowMs() <= 0) return null;
    try {
      pid = await probe.parentPidOf(pid);
    } catch {
      return null;
    }
  }
  return null;
}
