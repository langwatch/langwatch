/**
 * Browser-safe createLogger: no Node builtins, matches the pino logger call
 * surface client code already uses.
 */

export type BrowserLogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

const LEVEL_RANK: Record<BrowserLogLevel, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
};

const CONSOLE_METHOD: Record<BrowserLogLevel, "error" | "warn" | "info" | "debug"> = {
  fatal: "error",
  error: "error",
  warn: "warn",
  info: "info",
  debug: "debug",
  trace: "debug",
};

const DEFAULT_LEVEL: BrowserLogLevel = "info";

export interface CreateBrowserLoggerOptions {
  /** Minimum level this logger (and any child of it) emits. */
  level?: BrowserLogLevel;
}

/** A single logged line's merge object plus message, pino's own overload shape. */
type LogArgs = readonly [objOrMsg: unknown, msg?: string, ...rest: unknown[]];

export interface BrowserLogger {
  readonly level: BrowserLogLevel;
  fatal(...args: LogArgs): void;
  error(...args: LogArgs): void;
  warn(...args: LogArgs): void;
  info(...args: LogArgs): void;
  debug(...args: LogArgs): void;
  trace(...args: LogArgs): void;
  /** Returns a logger that merges `bindings` into every record it emits. */
  child(bindings: Record<string, unknown>): BrowserLogger;
}

/** Splits pino's overloaded first two arguments into a payload and a message. */
function normalize(
  objOrMsg: unknown,
  msg: string | undefined,
): { payload: Record<string, unknown>; message: string | undefined } {
  if (typeof objOrMsg === "string") {
    return { payload: {}, message: objOrMsg };
  }
  if (objOrMsg instanceof Error) {
    return { payload: { error: objOrMsg }, message: msg ?? objOrMsg.message };
  }
  if (objOrMsg && typeof objOrMsg === "object") {
    return { payload: objOrMsg as Record<string, unknown>, message: msg };
  }
  return { payload: {}, message: msg };
}

function createLoggerAt(
  name: string,
  level: BrowserLogLevel,
  bindings: Record<string, unknown>,
): BrowserLogger {
  const at =
    (loggedLevel: BrowserLogLevel) =>
    (...args: LogArgs): void => {
      if (LEVEL_RANK[loggedLevel] < LEVEL_RANK[level]) return;

      const [objOrMsg, msg, ...rest] = args;
      const { payload, message } = normalize(objOrMsg, msg);
      // Kept as one structured object argument — never string-interpolated —
      // so a later real pipeline can adopt this shape without a rewrite.
      const record = { level: loggedLevel, name, ...bindings, ...payload };
      const consoleMethod = CONSOLE_METHOD[loggedLevel];

      if (message !== undefined) {
        console[consoleMethod](message, record, ...rest);
      } else {
        console[consoleMethod](record, ...rest);
      }
    };

  return {
    level,
    fatal: at("fatal"),
    error: at("error"),
    warn: at("warn"),
    info: at("info"),
    debug: at("debug"),
    trace: at("trace"),
    child: (childBindings) => createLoggerAt(name, level, { ...bindings, ...childBindings }),
  };
}

/** Creates a browser-legal logger with the same name+options call shape as the Node one. */
export function createLogger(name: string, options?: CreateBrowserLoggerOptions): BrowserLogger {
  return createLoggerAt(name, options?.level ?? DEFAULT_LEVEL, {});
}
