/** How much the services log and the terminal shows (spec 11-terminal-output). */
export type LogSettings = Readonly<{
  /** The level every service is started at, in the backend's names (debug, info, warn, ...). */
  level: string;
  /** True with `--verbose` or LOG_LEVEL: every service's output is shown, prefixed. */
  showsServiceOutput: boolean;
}>;

export const DEFAULT_LOG_LEVEL = "warn";

/** LOG_LEVEL when set, else info with `--verbose`, else warn. */
export function resolveLogSettings({
  env,
  isVerbose,
}: {
  env: Record<string, string | undefined>;
  isVerbose: boolean;
}): LogSettings {
  const requested = (env.LOG_LEVEL ?? "").trim().toLowerCase();
  if (requested !== "") return { level: requested, showsServiceOutput: true };
  return { level: isVerbose ? "info" : DEFAULT_LOG_LEVEL, showsServiceOutput: isVerbose };
}

const CLICKHOUSE_LEVELS: Readonly<Record<string, string>> = {
  trace: "trace",
  debug: "debug",
  info: "information",
  warn: "warning",
  error: "error",
  fatal: "fatal",
};

const POSTGRES_LEVELS: Readonly<Record<string, string>> = {
  trace: "debug5",
  debug: "debug1",
  info: "info",
  warn: "warning",
  error: "error",
  fatal: "fatal",
};

// Redis has no error level: warning is its quietest that still logs.
const REDIS_LEVELS: Readonly<Record<string, string>> = {
  trace: "debug",
  debug: "debug",
  info: "notice",
  warn: "warning",
  error: "warning",
  fatal: "warning",
};

/** ClickHouse's `<logger><level>`. */
export function clickhouseLogLevel(level: string): string {
  return CLICKHOUSE_LEVELS[level] ?? "warning";
}

/** Postgres' `log_min_messages`. */
export function postgresLogLevel(level: string): string {
  return POSTGRES_LEVELS[level] ?? "warning";
}

/** Redis' `loglevel`. */
export function redisLogLevel(level: string): string {
  return REDIS_LEVELS[level] ?? "warning";
}

/** Python's logging names, which LangEvals reads (WARN is an alias Python knows). */
export function pythonLogLevel(level: string): string {
  return level === "trace" ? "DEBUG" : level.toUpperCase();
}
