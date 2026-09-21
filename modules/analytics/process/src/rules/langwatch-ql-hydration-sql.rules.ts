/**
 * The statement a hydration reads its rows from: the caller's own, restricted
 * to the traces whose values are wanted. A caller that already knows which
 * traces it is about never pays for the rest of the selection.
 * @see specs/lwql/app-functions.feature
 */

import { LWQL_HYDRATION_TRACE_IDS_PARAMETER } from "@langwatch/analytics-contract";

/** The trace identity every LangWatchQL dataset projects. */
export const LWQL_TRACE_COLUMN = "TraceId";

/**
 * The predicate names the trace alone even for a selection keyed by a pair,
 * since a tuple parameter does not serialise — the over-fetched rows are the
 * caller's to drop.
 */
export function langWatchQLTraceRestrictedSql(sql: string): string {
  return (
    `SELECT * FROM (\n${sql}\n) AS q` +
    `\nWHERE q.${LWQL_TRACE_COLUMN} IN ({${LWQL_HYDRATION_TRACE_IDS_PARAMETER}:Array(String)})` +
    `\nORDER BY q.${LWQL_TRACE_COLUMN}`
  );
}
