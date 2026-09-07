import {
  LANGY_TRACE_ORIGIN,
  TRACE_ORIGIN_CLICKHOUSE_EXPRESSION,
} from "./derive-trace-origin";
import { queryNamesField } from "./filter-to-clickhouse";

export interface FilterWhere {
  sql: string;
  params: Record<string, unknown>;
}

/**
 * The origins the Trace Explorer leaves out unless the query names the
 * `origin` field itself.
 *
 * Langy's own turns trace into the customer's project (ADR-061), but they are
 * not the customer's traffic: on a fresh guided project they would be the
 * only rows in the list, and on an established one they sit between the real
 * requests. So the list, the Sessions lens, the facet counts and the
 * new-traces poll skip them by default. Picking "Langy" in the origin facet,
 * or typing `origin:langy`, is the ask to see them, and any other origin term
 * means the user is choosing origins on their own, so the default steps
 * aside. The origin facet itself keeps counting them so the pick is offered.
 */
export function explorerHiddenOrigins(
  query: string | null | undefined,
): string[] {
  return queryNamesField(query ?? "", "origin") ? [] : [LANGY_TRACE_ORIGIN];
}

export const HIDDEN_ORIGINS_PARAM = "hiddenOrigins";

/**
 * The filter with the hidden origins excluded, after the filter's own terms.
 * The exclusion reads the origin the way every other reader does, so an
 * unstamped trace still counts as "application" and is kept.
 */
export function withHiddenOrigins(
  filterWhere: FilterWhere | undefined,
  hiddenOrigins: readonly string[] | undefined,
): FilterWhere | undefined {
  if (!hiddenOrigins || hiddenOrigins.length === 0) return filterWhere;

  const exclusion = `${TRACE_ORIGIN_CLICKHOUSE_EXPRESSION} NOT IN ({${HIDDEN_ORIGINS_PARAM}:Array(String)})`;
  return {
    sql: filterWhere ? `(${filterWhere.sql}) AND ${exclusion}` : exclusion,
    params: {
      ...filterWhere?.params,
      [HIDDEN_ORIGINS_PARAM]: [...hiddenOrigins],
    },
  };
}
