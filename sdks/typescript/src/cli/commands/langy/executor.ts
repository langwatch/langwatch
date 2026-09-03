/**
 * Runs one command in the shared folder.
 *
 * Every command runs under `bash -lc` with the folder as its working
 * directory and its own process group, so a cancel, a timeout or a Ctrl-C
 * reaches the children too. The output the model reads is capped; the whole
 * log stays in the folder, in a directory the CLI keeps out of git.
 *
 * A background command is different in one way that matters: its output goes
 * straight to the log file descriptor rather than through a pipe, so the
 * process keeps writing after the CLI is gone.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  BASH_DEFAULT_TIMEOUT_MS,
  BASH_MAX_TIMEOUT_MS,
  BASH_OUTPUT_CAP_BYTES,
  LOCAL_LOG_DIR,
  type BashOutput,
} from "../../../agent/local-control-protocol";
import { LocalCallFailure } from "./errors";

/** How long a killed process group has to end before it is killed outright. */
const KILL_GRACE_MS = 2_000;

export interface RunningCommand {
  /** The process group leader, undefined when the spawn failed. */
  pid: number | undefined;
  logPath: string;
  result: Promise<BashOutput>;
  /** Kills the process group. A background command is left alone. */
  cancel: () => void;
}

export interface StartCommandInput {
  command: string;
  /** The resolved real path of the shared folder. */
  root: string;
  callId: string;
  /** Seconds, as the tool asks for them. */
  timeout?: number;
  background?: boolean;
}

/** The timeout one command runs under, in milliseconds. */
export function timeoutMsFor(seconds: number | undefined): number {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return BASH_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(BASH_MAX_TIMEOUT_MS, Math.round(seconds * 1000));
}

/** Where one call's log file lives inside the folder. */
export function logPathFor({
  root,
  callId,
}: {
  root: string;
  callId: string;
}): string {
  return path.join(root, LOCAL_LOG_DIR, `${callId}.log`);
}

/**
 * The repository's own exclude file, or null when the folder is not a git
 * repository. A worktree and a submodule carry a `.git` file that names the
 * real directory, so the file is read rather than assumed to be a directory.
 */
function gitInfoDir(root: string): string | null {
  const dotGit = path.join(root, ".git");
  let stats: fs.Stats;
  try {
    stats = fs.statSync(dotGit);
  } catch {
    return null;
  }
  if (stats.isDirectory()) return path.join(dotGit, "info");
  try {
    const pointer = fs.readFileSync(dotGit, "utf8").trim();
    const match = /^gitdir:\s*(.+)$/.exec(pointer);
    if (!match) return null;
    return path.join(path.resolve(root, match[1]!), "info");
  } catch {
    return null;
  }
}

/**
 * Keeps the log directory out of git through the repository's own exclude
 * file, so the developer's `.gitignore` is untouched. Runs once per session,
 * and does nothing at all outside a git repository.
 */
export function excludeLogDirFromGit(root: string): void {
  const info = gitInfoDir(root);
  if (!info) return;
  const excludeFile = path.join(info, "exclude");
  const entry = ".langwatch/";
  try {
    fs.mkdirSync(info, { recursive: true });
    const current = fs.existsSync(excludeFile)
      ? fs.readFileSync(excludeFile, "utf8")
      : "";
    if (current.split("\n").some((line) => line.trim() === entry)) return;
    const separator = current === "" || current.endsWith("\n") ? "" : "\n";
    fs.appendFileSync(excludeFile, `${separator}${entry}\n`);
  } catch {
    // A read-only repository is not a reason to refuse the command.
  }
}

/** Text captured from one stream, under a budget shared with the other. */
class CappedText {
  private chunks: string[] = [];
  truncated = false;

  constructor(private readonly budget: { remaining: number }) {}

  add(chunk: Buffer): void {
    if (this.budget.remaining <= 0) {
      this.truncated = true;
      return;
    }
    if (chunk.byteLength <= this.budget.remaining) {
      this.budget.remaining -= chunk.byteLength;
      this.chunks.push(chunk.toString("utf8"));
      return;
    }
    this.chunks.push(chunk.subarray(0, this.budget.remaining).toString("utf8"));
    this.budget.remaining = 0;
    this.truncated = true;
  }

  text(): string {
    return this.chunks.join("");
  }
}

const tailNote = (logPath: string): string =>
  `\n[output cut at ${BASH_OUTPUT_CAP_BYTES} bytes. The whole log is at ${logPath}]`;

/**
 * Starts one command and returns its handle at once. The result settles when
 * the process ends, or straight away for a background command.
 */
export function startCommand({
  command,
  root,
  callId,
  timeout,
  background = false,
}: StartCommandInput): RunningCommand {
  const logPath = logPathFor({ root, callId });
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
  } catch (error) {
    throw new LocalCallFailure({
      code: "exec_failed",
      message: `Could not create the log directory ${path.dirname(logPath)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
  excludeLogDirFromGit(root);

  const startedAt = Date.now();
  return background
    ? startBackground({ command, root, logPath, startedAt })
    : startForeground({ command, root, logPath, startedAt, timeout });
}

/**
 * A background command owns its log file: the child writes to the descriptor
 * itself, so nothing in this process has to stay alive for the output to keep
 * arriving.
 */
function startBackground({
  command,
  root,
  logPath,
  startedAt,
}: {
  command: string;
  root: string;
  logPath: string;
  startedAt: number;
}): RunningCommand {
  const fd = fs.openSync(logPath, "a");
  let child;
  try {
    child = spawn("bash", ["-lc", command], {
      cwd: root,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
  } finally {
    fs.closeSync(fd);
  }
  child.unref();
  const pid = child.pid;
  return {
    pid,
    logPath,
    cancel: () => killGroup(pid),
    result: Promise.resolve({
      exitCode: null,
      stdout: "",
      stderr: "",
      truncated: false,
      logPath,
      ...(pid === undefined ? {} : { pid }),
      durationMs: Date.now() - startedAt,
    }),
  };
}

function startForeground({
  command,
  root,
  logPath,
  startedAt,
  timeout,
}: {
  command: string;
  root: string;
  logPath: string;
  startedAt: number;
  timeout?: number;
}): RunningCommand {
  const log = fs.createWriteStream(logPath, { flags: "a" });
  // The log is a convenience, never the answer: the shared folder can be moved
  // or removed while a command runs, and an unhandled stream error would take
  // the whole session down. Drop the log and keep the command's own output.
  log.on("error", () => undefined);
  const child = spawn("bash", ["-lc", command], {
    cwd: root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pid = child.pid;

  const budget = { remaining: BASH_OUTPUT_CAP_BYTES };
  const stdout = new CappedText(budget);
  const stderr = new CappedText(budget);
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout.add(chunk);
    log.write(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr.add(chunk);
    log.write(chunk);
  });

  let timedOut = false;
  let cancelled = false;
  const limitMs = timeoutMsFor(timeout);
  const limit = setTimeout(() => {
    timedOut = true;
    killGroup(pid);
  }, limitMs);
  limit.unref();

  const result = new Promise<BashOutput>((resolve, reject) => {
    // The log is closed before the result settles, so a caller that reads the
    // file the moment the command answers finds every line in it. A stream
    // that already failed is past closing, so the result settles at once.
    const closeLog = (then: () => void) => {
      if (log.destroyed || log.writableEnded) {
        then();
        return;
      }
      log.end(then);
    };

    child.on("error", (error) => {
      clearTimeout(limit);
      closeLog(() =>
        reject(
          new LocalCallFailure({
            code: "exec_failed",
            message: `The command could not start: ${error.message}`,
          }),
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(limit);
      closeLog(() => onClosed(code));
    });

    const onClosed = (code: number | null) => {
      if (timedOut) {
        reject(
          new LocalCallFailure({
            code: "timeout",
            message: `The command passed its ${Math.round(limitMs / 1000)} second limit and was stopped. The output so far is at ${logPath}.`,
          }),
        );
        return;
      }
      if (cancelled) {
        reject(
          new LocalCallFailure({
            code: "cancelled",
            message: "The command was stopped before it ended.",
          }),
        );
        return;
      }
      const truncated = stdout.truncated || stderr.truncated;
      resolve({
        exitCode: code,
        stdout: stdout.text() + (stdout.truncated ? tailNote(logPath) : ""),
        stderr: stderr.text() + (stderr.truncated ? tailNote(logPath) : ""),
        truncated,
        logPath,
        durationMs: Date.now() - startedAt,
      });
    };
  });

  return {
    pid,
    logPath,
    result,
    cancel: () => {
      cancelled = true;
      killGroup(pid);
    },
  };
}

/**
 * Ends a process and everything it started. The group is addressed by the
 * negative process id, which is why every command is spawned detached: a
 * development server started through `pnpm` leaves children behind otherwise.
 */
export function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-pid, name);
    } catch {
      // The group is already gone.
    }
  };
  signal("SIGTERM");
  const force = setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS);
  force.unref();
}
