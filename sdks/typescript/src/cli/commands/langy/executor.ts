/**
 * Runs one command in the shared folder.
 *
 * Every command runs under a non-login `bash -c` with the folder as its
 * working directory and its own process group, so a cancel, a timeout or a
 * Ctrl-C reaches the children too. The output the model reads is capped; the
 * whole log stays in the folder, in a directory the CLI keeps out of git.
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

/**
 * The shell one command runs in.
 *
 * A login shell reads the developer's profile files, and a broken line in one
 * of them writes to stderr of every command. That text reaches the model as
 * part of each tool result and reads as a failure of the command it did not
 * come from. A non-login shell reads no profile, and the PATH the developer
 * expects arrives anyway: the CLI was started from their own terminal, so the
 * environment it hands the command already carries it.
 */
export const SHELL_ARGS = (command: string): [string, string[]] => [
  "bash",
  ["-c", command],
];

/**
 * The variables a command inherits from this process, by name.
 *
 * The terminal that started the CLI carries the developer's own keys, and a
 * command Langy runs reads every one of them the moment it is handed the
 * whole environment. What a build needs from the machine is where its
 * toolchain lives, how it reaches the network and which certificates it
 * trusts. What a project needs is in the project, and the project's own
 * tools read it from there.
 */
export const INHERITED_ENVIRONMENT: ReadonlySet<string> = new Set([
  // The machine and the shell.
  "PATH",
  "HOME",
  "SHELL",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TZ",
  "LANG",
  "LANGUAGE",
  "TERM",
  "COLORTERM",
  "TERM_PROGRAM",
  // The socket of the key agent, so a push over a signed connection still
  // works. It carries no key itself.
  "SSH_AUTH_SOCK",
  // Where the toolchains live.
  "HOMEBREW_PREFIX",
  "HOMEBREW_CELLAR",
  "HOMEBREW_REPOSITORY",
  "GOPATH",
  "GOROOT",
  "GOFLAGS",
  "GOPROXY",
  "PYENV_ROOT",
  "NVM_DIR",
  "NVM_BIN",
  "ASDF_DIR",
  "RBENV_ROOT",
  "SDKMAN_DIR",
  "VIRTUAL_ENV",
  "CONDA_PREFIX",
  "UV_CACHE_DIR",
  "UV_PYTHON",
  // How it reaches the network, and what it trusts.
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
]);

/** Families of variables that are inherited whatever the rest of the name is. */
export const INHERITED_ENVIRONMENT_PREFIXES: readonly string[] = ["LC_", "XDG_"];

/**
 * The name of a toolchain's own directory: `JAVA_HOME`, `PNPM_HOME`,
 * `CARGO_HOME`, `GRADLE_USER_HOME` and every other one written this way.
 */
export const INHERITED_ENVIRONMENT_SUFFIXES: readonly string[] = ["_HOME"];

/**
 * Names that never travel, whatever else matches.
 *
 * A prefix or a suffix rule is a family, and a family has secrets in it:
 * `HOMEBREW_GITHUB_API_TOKEN` is a homebrew variable and a token at the same
 * time. The veto is read last and wins.
 */
export const SECRET_ENVIRONMENT_SUFFIXES: readonly string[] = [
  "_KEY",
  "_TOKEN",
  "_SECRET",
  "_PASSWORD",
];

/** True when a command may read this variable. */
export function inheritsVariable(name: string): boolean {
  const upper = name.toUpperCase();
  if (SECRET_ENVIRONMENT_SUFFIXES.some((veto) => upper.endsWith(veto))) {
    return false;
  }
  if (INHERITED_ENVIRONMENT.has(name)) return true;
  if (INHERITED_ENVIRONMENT_PREFIXES.some((family) => name.startsWith(family))) {
    return true;
  }
  return INHERITED_ENVIRONMENT_SUFFIXES.some((family) => upper.endsWith(family));
}

/** The environment one command runs with. */
export function commandEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (inheritsVariable(name)) kept[name] = value;
  }
  return kept;
}
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

/** The longest limit a command may ask for, in whole seconds. */
export const BASH_MAX_TIMEOUT_SECONDS = Math.round(BASH_MAX_TIMEOUT_MS / 1000);

/** The timeout one command runs under, in milliseconds. */
export function timeoutMsFor(seconds: number | undefined): number {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return BASH_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(BASH_MAX_TIMEOUT_MS, Math.round(seconds * 1000));
}

const wholeSeconds = (ms: number): number => Math.max(1, Math.round(ms / 1000));

/**
 * The same limit in whole seconds, which is how the permission card names it
 * and how the timeout message reads it back. A limit under a second still
 * reads as one second, because zero would name no limit at all.
 */
export function timeoutSecondsFor(seconds: number | undefined): number {
  return wholeSeconds(timeoutMsFor(seconds));
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

/**
 * One line of captured output as a terminal would show it.
 *
 * A progress display rewrites the same line over and over, each redraw
 * separated by a carriage return. Kept as written, a two-minute test run
 * spends the whole output budget on spinner frames and the result the agent
 * actually needs is what gets cut. The last redraw of a line is what the
 * developer would see, so it is what Langy reads.
 */
export function collapseProgressRedraws(text: string): string {
  if (!text.includes("\r")) return text;
  return text
    .split("\n")
    .map((line) => {
      if (!line.includes("\r")) return line;
      const redraws = line.split("\r");
      for (let index = redraws.length - 1; index >= 0; index -= 1) {
        const redraw = redraws[index] ?? "";
        if (redraw.trim() !== "") return redraw;
      }
      return "";
    })
    .join("\n");
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
    const text = Buffer.from(collapseProgressRedraws(chunk.toString("utf8")));
    if (text.byteLength <= this.budget.remaining) {
      this.budget.remaining -= text.byteLength;
      this.chunks.push(text.toString("utf8"));
      return;
    }
    this.chunks.push(text.subarray(0, this.budget.remaining).toString("utf8"));
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
    child = spawn(...SHELL_ARGS(command), {
      cwd: root,
      env: commandEnvironment(),
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
  const child = spawn(...SHELL_ARGS(command), {
    cwd: root,
    env: commandEnvironment(),
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
            message: `The command was stopped at its ${wholeSeconds(limitMs)} second limit. To give it more time, ask for it again with a larger timeout parameter, which is in seconds and may go up to ${BASH_MAX_TIMEOUT_SECONDS}. The output so far is at ${logPath}.`,
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
