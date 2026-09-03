import type { Logger, LogLevel, LogType } from "vite";

/**
 * The dev server's lane, printed the way the other four lanes print theirs.
 *
 * `pnpm dev` puts Vite, two Node applications, two Go services and a vendored
 * ClickHouse driver in one terminal, and Vite's own logger was the odd one out
 * twice over: a twelve-hour clock with no milliseconds, and a `[vite]` tag
 * repeating what `concurrently`'s own `[ui]` prefix already said. So a line
 * here reads
 *
 *   [13:10:46.108] INFO (vite): ready in 812 ms
 *
 * — the same columns as the Node lanes, whose pino-pretty console prints
 * exactly this shape.
 *
 * It also collapses the proxy's failures. With the api lane down, Vite logs a
 * red `http proxy error: <url>` and a full AggregateError stack for EVERY
 * request the browser makes, and a single boot with the api lane failing to
 * bind buried the one line that said why. The same fact, said once per target
 * every few seconds, is the whole of what a developer can act on.
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
 * One line, in the shape every lane prints.
 *
 * A message spanning several lines — Vite's startup banner, a stack — keeps
 * its own shape after the first line rather than being prefixed line by line.
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
 * Vite colours its own messages; the pattern match must not depend on that.
 *
 * Built rather than written as a literal because the escape it matches is a
 * control character, which a regular expression literal may not carry.
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
 * Vite's `customLogger`, which is where the proxy's failures are caught as
 * well as formatted: Vite logs them through `config.logger.error` itself,
 * after any `configure` hook has run, so a per-entry handler would silence
 * nothing and this one place covers all eleven proxy entries at once.
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
      if (logOptions?.error) loggedErrors.add(logOptions.error);
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
