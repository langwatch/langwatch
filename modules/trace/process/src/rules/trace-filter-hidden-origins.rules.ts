/**
 * The origins the Explorer's reads leave out, as a condition of the filter.
 * Which origins those are is the contract's `explorerHiddenOrigins`.
 */

import { TRACE_ORIGIN_CLICKHOUSE_EXPRESSION } from "@langwatch/trace-contract";

/** One compiled condition: a boolean expression and the values it binds. */
export interface TraceFilterWhere {
  sql: string;
  params: Record<string, unknown>;
}

export const HIDDEN_ORIGINS_PARAM = "hiddenOrigins";

/**
 * The exclusion of the hidden origins, or nothing when none are hidden. It
 * reads the origin the way every other reader does, so an unstamped trace
 * still counts as "application" and is kept.
 */
export function findHiddenOriginConditions({
  hiddenOrigins,
}: {
  hiddenOrigins: readonly string[];
}): TraceFilterWhere[] {
  if (hiddenOrigins.length === 0) return [];

  return [
    {
      sql: `${TRACE_ORIGIN_CLICKHOUSE_EXPRESSION} NOT IN ({${HIDDEN_ORIGINS_PARAM}:Array(String)})`,
      params: { [HIDDEN_ORIGINS_PARAM]: [...hiddenOrigins] },
    },
  ];
}

/** Every condition ANDed into one filter; no condition at all matches every row. */
export function andFilterConditions(conditions: readonly TraceFilterWhere[]): TraceFilterWhere {
  const [only] = conditions;
  if (conditions.length <= 1) return only ?? { sql: "1 = 1", params: {} };

  return {
    sql: conditions.map((condition) => `(${condition.sql})`).join(" AND "),
    params: Object.assign({}, ...conditions.map((condition) => condition.params)),
  };
}
