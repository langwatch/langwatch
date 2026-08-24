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
 * renamed or wrapped still holds its rollout.
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
import { readdir, readFile, readlink } from "node:fs/promises";
import { basename } from "node:path";

import { ROLLOUT_SESSION_ID } from "./codex-live-session";

/** How far up the parent chain a codex session is worth looking for. */
export const MAX_ANCESTOR_HOPS = 15;

/** How long one process's open files may take to list. */
export const OPEN_FILES_TIMEOUT_MS = 1_500;

/** How long the whole walk may take, agent turn included. */
export const ANCESTOR_WALK_BUDGET_MS = 2_000;

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
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => resolve(error ? "" : stdout),
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

/** `/proc/<pid>/fd` on linux, `lsof -Fn` everywhere else. */
async function readOpenFiles(
  pid: number,
  timeoutMs: number,
): Promise<string[]> {
  if (isLinux) {
    try {
      const fds = await readdir(`/proc/${pid}/fd`);
      const paths = await Promise.all(
        fds.map((fd) =>
          readlink(`/proc/${pid}/fd/${fd}`).catch(() => ""),
        ),
      );
      return paths.filter(Boolean);
    } catch {
      return [];
    }
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

/**
 * The codex session whose process this command runs under, or null when the
 * process tree does not answer inside the budget.
 */
export async function resolveCodexSessionFromAncestors({
  startPid,
  probe = systemAncestorProbe,
  maxHops = MAX_ANCESTOR_HOPS,
  budgetMs = ANCESTOR_WALK_BUDGET_MS,
  nowMs = () => Date.now(),
}: {
  startPid?: number;
  probe?: AncestorProbe;
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
      openFiles = await probe.openFilesOf(
        pid,
        Math.min(OPEN_FILES_TIMEOUT_MS, remaining),
      );
    } catch {
      /* this ancestor does not answer: the next one still might */
    }

    for (const filePath of openFiles) {
      const sessionId = ROLLOUT_SESSION_ID.exec(basename(filePath))?.[1];
      if (sessionId) return { sessionId, rolloutPath: filePath };
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
