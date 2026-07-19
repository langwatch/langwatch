import type {
  DynamicKeysDef,
  FacetQuery,
  FacetQueryContext,
} from "../facet-registry";
import { baseParams, buildTimeWhere, KEY_DISCOVERY_SETTINGS } from "./helpers";

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

  // Same I/O optimisation as `span-attribute-keys.ts`: stay entirely on the
  // keys subcolumn so the values side of the Map never gets loaded. The
  // empty-map short-circuit probes `Attributes.keys`, not `Attributes` —
  // `length(Attributes)` would materialise the whole Map (keys and values)
  // just to count entries, pulling the heavy values column into memory.
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
          AND length(Attributes.keys) > 0
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
    settings: KEY_DISCOVERY_SETTINGS,
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

/**
 * Metadata-scoped sibling of {@link buildMetadataKeysFacetQuery}: forces the
 * `metadata.` namespace onto the prefix so discovery surfaces ONLY
 * `metadata.<name>` keys (e.g. `metadata.environment`), never bare trace
 * attributes like `langwatch.origin` / `service.name`. Any user sub-search is
 * still honoured by appending it after the namespace (`metadata.<search>`), so
 * the facet's "Filter keys…" box keeps working on the stripped portion.
 */
export function buildTraceMetadataKeysFacetQuery(
  ctx: FacetQueryContext,
): FacetQuery {
  return buildMetadataKeysFacetQuery({
    ...ctx,
    prefix: `metadata.${ctx.prefix ?? ""}`,
  });
}

export const TRACE_METADATA_FACET: DynamicKeysDef = {
  key: "metadata",
  kind: "dynamic_keys",
  label: "Metadata",
  group: "trace",
  table: "trace_summaries",
  queryBuilder: buildTraceMetadataKeysFacetQuery,
};
