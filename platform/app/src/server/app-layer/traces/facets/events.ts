import type {
  FacetQuery,
  FacetQueryContext,
  QueryBuilderCategoricalDef,
} from "../facet-registry";
import { baseParams, buildTimeWhere } from "./helpers";

/**
 * Span event names. Each `stored_spans` row carries a parallel array
 * `Events.Name` of event names emitted on that span; we explode it via
 * `arrayJoin` so a span with N events contributes N rows to the
 * frequency count.
 *
 * The facet key is `event` (matching the search-bar field) so toggles
 * round-trip cleanly with the `event:` filter handler.
 */
export function buildEventsFacetQuery(ctx: FacetQueryContext): FacetQuery {
  const where = buildTimeWhere("StartTime");
  const prefixFilter = ctx.prefix
    ? "AND lower(name) ILIKE concat({prefix:String}, '%')"
    : "";
  return {
    sql: `
      SELECT
        name AS facet_value,
        count() AS cnt,
        count() OVER () AS total_distinct
      FROM (
        SELECT arrayJoin(\`Events.Name\`) AS name
        FROM stored_spans
        WHERE ${where}
          AND length(\`Events.Name\`) > 0
      )
      WHERE name != ''
        ${prefixFilter}
      GROUP BY name
      ORDER BY cnt DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    params: {
      ...baseParams(ctx),
      ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
    },
  };
}

export const EVENT_FACET: QueryBuilderCategoricalDef = {
  key: "event",
  kind: "categorical",
  label: "Event name",
  group: "span",
  table: "stored_spans",
  queryBuilder: buildEventsFacetQuery,
};
