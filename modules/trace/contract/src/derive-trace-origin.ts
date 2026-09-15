/**
 * Origin is stamped late, so unresolved traces lack the key. ClickHouse returns
 * empty string for missing keys; SQL and in-memory readers must coalesce identically.
 */
export const DEFAULT_TRACE_ORIGIN = "application";

/** ClickHouse expression producing the same value `deriveTraceOrigin` does. */
export const TRACE_ORIGIN_CLICKHOUSE_EXPRESSION = `if(Attributes['langwatch.origin'] = '', '${DEFAULT_TRACE_ORIGIN}', Attributes['langwatch.origin'])`;

/** Read a trace's origin from its attributes, applying the same default. */
export function deriveTraceOrigin(attributes: Record<string, unknown> | undefined): string {
  const origin = attributes?.["langwatch.origin"];

  return typeof origin === "string" && origin !== "" ? origin : DEFAULT_TRACE_ORIGIN;
}
