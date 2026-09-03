/**
 * Reading shape out of the vendor's untyped statement values.
 *
 * The resilience layer in ./vendorClient.ts never imports `@clickhouse/client`,
 * so the params object it is handed and the rows it streams back are `unknown`
 * to it. These are the total, defensive readers that turn those values into the
 * few facts the policy needs — a metric label, a table name, a log preview, an
 * in-band exception line — and every one of them answers for a value of the
 * wrong shape rather than throwing. Kept apart from the policy because they are
 * pure functions of a vendor value and testable as such.
 */

/** The statement categories the outcome metric is labelled by. */
export type VendorQueryType = "SELECT" | "INSERT" | "OTHER";

/** The fields of a params object that are safe to put in a log line. */
export interface VendorQueryMeta {
  queryId?: string;
  format?: string;
  paramKeys?: string[];
  table?: string;
}

export function safeQueryMeta(params: unknown): VendorQueryMeta {
  if (!params || typeof params !== "object") return {};
  const p = params as Record<string, unknown>;
  const meta: VendorQueryMeta = {};

  if (typeof p.query_id === "string") meta.queryId = p.query_id;
  if (typeof p.format === "string") meta.format = p.format;
  if (typeof p.table === "string") meta.table = p.table;
  if (p.query_params && typeof p.query_params === "object") {
    meta.paramKeys = Object.keys(p.query_params as Record<string, unknown>);
  }

  return meta;
}

export function extractQueryType(params: unknown): VendorQueryType {
  if (!params || typeof params !== "object") return "OTHER";
  const p = params as Record<string, unknown>;
  if (typeof p.query !== "string") return "OTHER";
  const trimmed = p.query.trimStart().toUpperCase();
  if (trimmed.startsWith("SELECT") || trimmed.startsWith("WITH")) return "SELECT";
  if (trimmed.startsWith("INSERT")) return "INSERT";
  return "OTHER";
}

export function extractTableName(params: unknown): string {
  const meta = safeQueryMeta(params);
  return meta.table ?? "unknown";
}

export function extractQueryPreview(params: unknown): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const p = params as Record<string, unknown>;
  if (typeof p.query !== "string") return undefined;
  return p.query.length > 200 ? p.query.slice(0, 200) + "..." : p.query;
}

export function extractRawQuery(params: unknown): string {
  if (!params || typeof params !== "object") return "";
  const p = params as Record<string, unknown>;
  return typeof p.query === "string" ? p.query : "";
}

/**
 * The server-side exception prefix, e.g.
 * `Code: 241. DB::Exception: Memory limit ... (MEMORY_LIMIT_EXCEEDED)`.
 * The class name is deliberately loose: the thrown type prints its own name
 * (`DB::NetException`, `DB::ErrnoException`, `Coordination::Exception`) and
 * every one of them means the query died. Missing one is the expensive
 * direction — it puts an error row back in front of a decoder.
 */
const CLICKHOUSE_EXCEPTION_SIGNATURE = /^Code: \d+\. (\w+::)?\w*Exception:/;

/**
 * A row is the server's exception line only when both hold: `exception` is
 * its sole key, and the value carries the ClickHouse error signature. The
 * sole-key test alone would reject a legitimate one-column result such as
 * `SELECT status AS exception`. A value that reproduces the full signature is
 * an accepted residual false positive — the stream offers nothing else to
 * tell it apart from the real thing.
 */
export function inbandExceptionOf(row: unknown): string | undefined {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return undefined;
  }
  if (Object.keys(row).length !== 1) return undefined;
  const exception = (row as { exception?: unknown }).exception;
  if (typeof exception !== "string") return undefined;
  return CLICKHOUSE_EXCEPTION_SIGNATURE.test(exception) ? exception : undefined;
}
