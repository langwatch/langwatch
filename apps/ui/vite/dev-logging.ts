import type { Logger, LogLevel, LogType } from "vite";

/**
 * The dev server's lane, printed in the same shape the four Node/Go lanes
 * use instead of Vite's own two-digit clock and `[vite]` tag. Also collapses
 * a proxy failure to one line instead of a stack repeated per request.
 */

export interface DevLogSink {
  out(line: string): void;
  err(line: string): void;
}

const CONSOLE_SINK: DevLogSink = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

/** `HH:mm:ss.SSS`, in local time, with no date. A dev terminal is always today. */
export function timeOfDay(at: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(
    at.getMilliseconds(),
    3,
  )}`;
}

/**
 * One line, in the shape every lane prints — a multi-line message (Vite's
 * startup banner, a stack) keeps its own shape after the first line rather
 * than being prefixed line by line.
 */
export function devLogLine({
  level,
  message,
  at,
}: {
  level: LogType;
  message: string;
  at: Date;
}): string {
  const [first = "", ...rest] = message.split("\n");
  const head = `[${timeOfDay(at)}] ${level.toUpperCase()} (vite): ${first}`;
  return [head, ...rest].join("\n");
}

/** Vite's proxy failures, whichever of its three shapes they arrive in. */
function proxyFailurePath(message: string): string | null {
  const http = /http proxy error: (\S*)/.exec(stripAnsi(message));
  if (http) return http[1] ?? "";
  if (/\bws proxy (socket )?error\b/.test(stripAnsi(message))) return "the websocket upgrade";
  return null;
}

/**
 * Built rather than written as a literal: the escape this matches is a
 * control character, which a regex literal may not carry. Strips Vite's own
 * ANSI colour before the proxy-failure pattern match runs.
 */
const ANSI_COLOUR = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");

function stripAnsi(value: string): string {
  return value.replace(ANSI_COLOUR, "");
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
