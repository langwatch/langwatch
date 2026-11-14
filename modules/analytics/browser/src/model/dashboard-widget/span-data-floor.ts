/**
 * Whether a widget says where its span data starts: `span_metrics` holds spans from the span
 * replay's recorded since on (analytics ADR-006), so a period that starts earlier is partial.
 * Before the replay starts, any period may be partial.
 * @see specs/lwql/stock-widgets-read-no-map.feature
 */

import { Temporal } from "@langwatch/time";

/** What the server reports about span history; the shape of `analytics.lwql.spanDataFloor`. */
export interface SpanDataFloor {
  /** The recorded since, an ISO instant; null when span history is whole or not yet known. */
  readonly from: string | null;
  /** True while no replay has started, so older span history may still be missing. */
  readonly rebuilding: boolean;
}

export const SPAN_HISTORY_REBUILDING_NOTICE = "Span history is still being rebuilt";

/** A query that names `span_metrics` after FROM or JOIN, in any case, schema-qualified or not. */
const READS_SPAN_METRICS = /\b(?:FROM|JOIN)\s+(?:analytics\.)?span_metrics\b/i;

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Whether any of a widget's queries reads `span_metrics`. */
export function readsSpanMetrics(queries: readonly { readonly sql: string }[]): boolean {
  return queries.some((query) => READS_SPAN_METRICS.test(query.sql));
}

/**
 * The notice a widget shows when it reads span_metrics while history is rebuilding or over a
 * period starting before the floor; null for no span query, no floor known, or a later period.
 */
export function spanDataFloorNotice({
  queries,
  periodStart,
  floor,
}: {
  readonly queries: readonly { readonly sql: string }[];
  /** The period's start, epoch milliseconds. */
  readonly periodStart: number;
  /** The server's answer; null while it loads or when it failed. */
  readonly floor: SpanDataFloor | null;
}): string | null {
  if (floor === null) return null;
  if (!readsSpanMetrics(queries)) return null;
  if (floor.rebuilding) return SPAN_HISTORY_REBUILDING_NOTICE;
  if (floor.from === null) return null;
  const from = Temporal.Instant.from(floor.from).epochMilliseconds;
  if (periodStart >= from) return null;
  return `Span data from ${DAY.format(from)}`;
}
