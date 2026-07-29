/**
 * A trace's origin is stamped onto `Attributes['langwatch.origin']`, but the
 * stamp is applied late (`OriginResolved`), so a trace that has not been
 * resolved yet carries no key at all. ClickHouse returns `''` for a missing
 * map key — not the default — so every reader has to coalesce, and every
 * reader has to coalesce *the same way*, or the SQL and the in-memory
 * evaluator disagree about which traces are `origin:application`.
 *
 * That disagreement is not theoretical: an automation filtering on
 * `origin:application` fired on unstamped traces in the in-memory dispatch
 * evaluator while the identical query returned none of them in the trace
 * list. Both sides now derive from the constants below.
 */
export const DEFAULT_TRACE_ORIGIN = "application";

/** ClickHouse expression producing the same value `deriveTraceOrigin` does. */
export const TRACE_ORIGIN_CLICKHOUSE_EXPRESSION = `if(Attributes['langwatch.origin'] = '', '${DEFAULT_TRACE_ORIGIN}', Attributes['langwatch.origin'])`;

/** Read a trace's origin from its attributes, applying the same default. */
export function deriveTraceOrigin(
  attributes: Record<string, unknown> | undefined
): string {
  const origin = attributes?.["langwatch.origin"];

  return typeof origin === "string" && origin !== ""
    ? origin
    : DEFAULT_TRACE_ORIGIN;
}
