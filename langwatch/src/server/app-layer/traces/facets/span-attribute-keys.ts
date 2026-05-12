import type {
  DynamicKeysDef,
  FacetQuery,
  FacetQueryContext,
} from "../facet-registry";
import { baseParams, buildTimeWhere } from "./helpers";

/**
 * Discover query for span attribute keys: every distinct `SpanAttributes`
 * map key seen across `stored_spans` rows, ordered by frequency.
 *
 * The output is a key list — *not* a (key, value) cross-product — because
 * the sidebar drills into values lazily via `facetValues` once the user
 * expands a key. Keeping this query cheap is the whole point of the
 * `dynamic_keys` indirection: a full enumeration of every span attribute
 * value across a tenant would be unbounded.
 *
 * I/O notes:
 *   - `SpanAttributes.keys` is the keys subcolumn of the Map. Reading it
 *     directly skips loading the values column entirely — meaningful at
 *     scale because span attribute values can be large strings.
 *   - `length(SpanAttributes) > 0` short-circuits granules where every
 *     span has empty attrs, mirroring the events facet's prefilter.
 *
 * The actual filter side (`span.attribute.<k>:value`) is already wired
 * through `filter-to-clickhouse/ast.ts` — this facet only feeds the
 * discovery list.
 */
export function buildSpanAttributeKeysFacetQuery(
  ctx: FacetQueryContext,
): FacetQuery {
  const where = buildTimeWhere("StartTime");
  const prefixFilter = ctx.prefix
    ? "AND lower(key) ILIKE concat({prefix:String}, '%')"
    : "";

  return {
    sql: `
      SELECT
        key AS facet_value,
        count() AS cnt,
        count() OVER () AS total_distinct
      FROM (
        SELECT arrayJoin(SpanAttributes.keys) AS key
        FROM stored_spans
        WHERE ${where}
          AND length(SpanAttributes) > 0
      )
      WHERE key != ''
        ${prefixFilter}
      GROUP BY key
      ORDER BY cnt DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    params: {
      ...baseParams(ctx),
      ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
    },
  };
}

export const SPAN_ATTRIBUTE_KEYS_FACET: DynamicKeysDef = {
  key: "spanAttributeKeys",
  kind: "dynamic_keys",
  label: "Span attribute keys",
  group: "span",
  table: "stored_spans",
  queryBuilder: buildSpanAttributeKeysFacetQuery,
};
