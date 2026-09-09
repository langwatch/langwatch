import type { Logger, LogLevel, LogType } from "vite";

/**
 * The dev server's lane, writing the same structured JSON every other lane
 * writes (dev/docs/best_practices/dev-log-format.md) instead of Vite's own
 * two-digit clock and `[vite]` tag - haven and `pnpm dev` render it for a
 * person, same as any other lane. Also collapses a proxy failure to one line
 * instead of a stack repeated per request.
 */

export interface DevLogSink {
  out(line: string): void;
  err(line: string): void;
}

const CONSOLE_SINK: DevLogSink = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

/** The process identity every record carries, per the shared format. */
const SERVICE_NAME = "langwatch-ui";

/** A literal `[vite]` tag, when a message still carries one of its own. */
const VITE_TAG = /^\[vite\]\s*/i;

/**
 * Built rather than written as a literal: the escape this matches is a
 * control character, which a regex literal may not carry.
 */
const ANSI_COLOUR = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");

function stripAnsi(value: string): string {
  return value.replace(ANSI_COLOUR, "");
}

/** One record in the shared shape every lane writes. */
export interface DevLogRecord {
  time: string;
  level: LogType;
  msg: string;
  service: string;
  /** The full multi-line trace, as one string with `\n` in it. */
  stack?: string;
}

/**
 * One record, in the shape every lane writes - a multi-line message (Vite's
 * startup banner, a stack) becomes ONE object rather than one per line: for
 * an ordinary message the lines rejoin with `\n` inside `msg`; for an error
 * the first line is the message and the rest becomes `stack`, the same split
 * a Node/Go lane reports an error with.
 *
 * `null` for a message that is blank once Vite's own tag and colour are
 * stripped - Vite logs empty strings purely for terminal spacing, and a
 * blank line carries nothing a structured record can hold.
 */
export function devLogRecord({
  level,
  message,
  at,
}: {
  level: LogType;
  message: string;
  at: Date;
}): DevLogRecord | null {
  const lines = stripAnsi(message)
    .split("\n")
    .map((line) => line.replace(VITE_TAG, ""));
  if (lines.every((line) => line.trim() === "")) return null;

  const [first = "", ...rest] = lines;
  const record: DevLogRecord = {
    time: at.toISOString(),
    level,
    msg: level === "error" && rest.length > 0 ? first : lines.join("\n"),
    service: SERVICE_NAME,
  };
  if (level === "error" && rest.length > 0) {
    record.stack = rest.join("\n");
  }
  return record;
}

/** One JSON line, or `null` for a blank message - see {@link devLogRecord}. */
export function devLogLine(options: { level: LogType; message: string; at: Date }): string | null {
  const record = devLogRecord(options);
  return record ? JSON.stringify(record) : null;
}

/** Vite's proxy failures, whichever of its three shapes they arrive in. */
function proxyFailurePath(message: string): string | null {
  const http = /http proxy error: (\S*)/.exec(stripAnsi(message));
  if (http) return http[1] ?? "";
  if (/\bws proxy (socket )?error\b/.test(stripAnsi(message))) return "the websocket upgrade";
  return null;
}

export interface DevLoggerOptions {
  /** Where the proxy sends what it cannot deliver, named in the one-line report. */
  proxyTarget: string;
  /** How long a target stays quiet after it has been reported unreachable. */
  quietMs?: number;
  now?: () => number;
  sink?: DevLogSink;
}

/**
 * Vite's `customLogger` — where proxy failures are caught, since Vite routes
 * them through `config.logger.error` after any `configure` hook runs, so
 * this one place covers all eleven proxy entries at once.
 */
export function createDevLogger(options: DevLoggerOptions): Logger {
  const sink = options.sink ?? CONSOLE_SINK;
  const now = options.now ?? (() => Date.now());
  const quietMs = options.quietMs ?? 5_000;

  const loggedErrors = new WeakSet<Error>();
  let lastReportedUnreachableAt: number | null = null;
  let hasWarned = false;

  const write = (level: LogType, message: string): void => {
    const line = devLogLine({ level, message, at: new Date(now()) });
    if (line === null) return;
    if (level === "error") sink.err(line);
    else sink.out(line);
  };

  /**
   * True when the message was a proxy failure and has been dealt with — said
   * once, or swallowed because it was said moments ago.
   */
  const reportedAsUnreachable = (message: string): boolean => {
    const path = proxyFailurePath(message);
    if (path === null) return false;

    const at = now();
    if (lastReportedUnreachableAt !== null && at - lastReportedUnreachableAt < quietMs) {
      return true;
    }
    lastReportedUnreachableAt = at;
    write("error", `api not reachable at ${options.proxyTarget} for ${path}`);
    return true;
  };

  return {
    get hasWarned() {
      return hasWarned;
    },
    set hasWarned(value: boolean) {
      hasWarned = value;
    },
    info: (message) => write("info", message),
    warn: (message) => {
      hasWarned = true;
      write("warn", message);
    },
    warnOnce: (message) => {
      hasWarned = true;
      write("warn", message);
    },
    error: (message, logOptions) => {
      // `LogErrorOptions.error` may be a `RollupError`, which is a plain log
      // shape (optional `name`) rather than a real `Error`. Only real
      // instances go in the set — `hasErrorLogged` only ever queries with one.
      if (logOptions?.error instanceof Error) loggedErrors.add(logOptions.error);
      if (reportedAsUnreachable(message)) return;
      write("error", message);
    },
    clearScreen: (_type: LogLevel) => {
      // Never. `concurrently` interleaves five lanes into one terminal, and a
      // lane that clears the screen takes the other four's output with it.
    },
    hasErrorLogged: (error) => error instanceof Error && loggedErrors.has(error),
  } as Logger;
}
