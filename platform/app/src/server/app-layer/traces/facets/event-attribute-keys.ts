import type {
  DynamicKeysDef,
  FacetQuery,
  FacetQueryContext,
} from "../facet-registry";
import { baseParams, buildTimeWhere, KEY_DISCOVERY_SETTINGS } from "./helpers";

/**
 * Discover query for event attribute keys: every distinct key seen across
 * the per-event `Events.Attributes` maps on `stored_spans`. The column is
 * `Array(Map(LowCardinality(String), String))` — one map per event per
 * span — so we double-`arrayJoin` to flatten down to a single key column
 * before deduping.
 *
 * Both the projection and the empty short-circuit go through the
 * `.keys` subcolumn, never `Events.Attributes` itself:
 *
 *   - `Events.Attributes.keys` is `Array(Array(LowCardinality(String)))` —
 *     the keys of every event's map, without the `String` values beside
 *     them. Reading the Map itself pulls those values into memory to
 *     produce a key list that never mentions them.
 *   - `length(Events.Attributes.keys)` counts events exactly as
 *     `length(Events.Attributes)` does, and reads the same lightweight
 *     column the projection already needs.
 *
 * This is the same trap `span-attribute-keys.ts` and `metadata-keys.ts`
 * document for their flat Maps. It survived here longer because the
 * subcolumn has to be reached through the outer array, so the fix does not
 * look identical to theirs. Untreated it is worth 2 GiB+ on a tenant with
 * busy events, which is MEMORY_LIMIT_EXCEEDED against the ceiling in
 * KEY_DISCOVERY_SETTINGS.
 *
 * Mirrors `span-attribute-keys.ts`: returns just the key list, with values
 * loaded lazily once the user expands a key. Keeping discovery cheap is
 * the whole point — a tenant can have unbounded distinct event-attribute
 * values, so a full `(key, value)` enumeration would not scale.
 *
 * Filtering (`event.attribute.<k>:value`) is already wired through
 * `filter-to-clickhouse/ast.ts`'s `translateEventAttribute`; this facet
 * only feeds the sidebar's discovery list.
 */
export function buildEventAttributeKeysFacetQuery(
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
        SELECT arrayJoin(arrayJoin(\`Events.Attributes\`.keys)) AS key
        FROM stored_spans
        WHERE ${where}
          AND length(\`Events.Attributes\`.keys) > 0
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

export const EVENT_ATTRIBUTE_KEYS_FACET: DynamicKeysDef = {
  key: "eventAttributeKeys",
  kind: "dynamic_keys",
  label: "Event attribute keys",
  group: "trace",
  table: "stored_spans",
  queryBuilder: buildEventAttributeKeysFacetQuery,
};
