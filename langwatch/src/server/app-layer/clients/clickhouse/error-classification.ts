// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export type ClickHouseErrorType =
  | "oom"
  | "timeout"
  | "network"
  | "rate_limit"
  | "unavailable"
  | "syntax"
  | "unknown";

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ENOTFOUND",
]);

/**
 * Classifies a ClickHouse error into a well-known category for structured
 * logging and alerting. Returns a short string tag suitable for log fields
 * and Prometheus labels.
 */
export function classifyClickHouseError(error: unknown): ClickHouseErrorType {
  if (!(error instanceof Error)) return "unknown";

  const message = error.message;

  // OOM
  if (message.includes("MEMORY_LIMIT_EXCEEDED")) return "oom";

  // Timeout (message or errno code)
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ETIMEDOUT" || /timeout/i.test(message)) return "timeout";

  // Network
  if (code && NETWORK_CODES.has(code)) return "network";

  // HTTP status-based classification
  const status =
    (error as { statusCode?: number }).statusCode ??
    (error as { status?: number }).status;

  if (status === 429) return "rate_limit";
  if (status === 502 || status === 503) return "unavailable";

  // Syntax / schema
  if (
    message.includes("SYNTAX_ERROR") ||
    message.includes("Unknown column") ||
    message.includes("Missing columns")
  )
    return "syntax";

  return "unknown";
}

const TRANSIENT_ERROR_TYPES: ReadonlySet<ClickHouseErrorType> = new Set([
  "oom",
  "timeout",
  "network",
  "rate_limit",
  "unavailable",
]);

export function isTransientClickHouseError(error: unknown): boolean {
  return TRANSIENT_ERROR_TYPES.has(classifyClickHouseError(error));
}
