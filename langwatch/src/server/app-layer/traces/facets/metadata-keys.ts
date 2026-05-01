import type {
  DynamicKeysDef,
  FacetQuery,
  FacetQueryContext,
} from "../facet-registry";
import { baseParams, buildTimeWhere } from "./helpers";

/**
 * Discover query for trace metadata attribute keys: every distinct
 * `Attributes` map key on `trace_summaries`. Mirrors
 * `buildSpanAttributeKeysFacetQuery` shape but against the trace table —
 * the two run independently so the sidebar can render them as separate
 * sections without one query masking the other on failure.
 *
 * The actual filter side (`trace.attribute.<k>:value` / legacy
 * `attribute.<k>:value`) is handled in `filter-to-clickhouse/ast.ts`.
 */
export function buildMetadataKeysFacetQuery(
  ctx: FacetQueryContext,
): FacetQuery {
  const where = buildTimeWhere("OccurredAt");
  const prefixFilter = ctx.prefix
    ? "AND lower(key) ILIKE concat({prefix:String}, '%')"
    : "";

  // Same I/O optimisation as `span-attribute-keys.ts`: read the keys
  // subcolumn directly so the values side of the Map never gets loaded,
  // and short-circuit empty maps before the arrayJoin fans out rows.
  return {
    sql: `
      SELECT
        key AS facet_value,
        count() AS cnt,
        count() OVER () AS total_distinct
      FROM (
        SELECT arrayJoin(Attributes.keys) AS key
        FROM trace_summaries
        WHERE ${where}
          AND length(Attributes) > 0
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

export const METADATA_KEYS_FACET: DynamicKeysDef = {
  key: "metadataKeys",
  kind: "dynamic_keys",
  label: "Trace attribute keys",
  group: "metadata",
  table: "trace_summaries",
  queryBuilder: buildMetadataKeysFacetQuery,
};
