/**
 * The most statement text a reader sends: ClickHouse's default `max_query_size`, 256 KiB (ADR-177
 * v4.7, ADR-201 §3). Measured after the markers expand, so a proof whose braids would overflow
 * it is refused by name before anything is sent. Bound parameters travel apart and do not count.
 */
import { StatementScopeError } from "./statementScopeError.ts";

export const STATEMENT_BYTE_BUDGET = 256 * 1024;

/**
 * ClickHouse's default `http_max_fields`: a request carrying more URL or form fields is refused
 * with "Too many form fields". Every bound parameter is one field (`param_<name>`).
 */
export const CLICKHOUSE_HTTP_MAX_FIELDS = 1000;

/** The most parameters a statement binds, leaving room for the client's own fields beside them. */
export const STATEMENT_PARAM_BUDGET = CLICKHOUSE_HTTP_MAX_FIELDS - 100;

/** Refuses an expanded statement over {@link STATEMENT_BYTE_BUDGET} or its parameter budget. */
export function refuseOverBudget({
  statement,
  params,
}: {
  statement: string;
  params: Record<string, unknown>;
}): void {
  const bytes = Buffer.byteLength(statement, "utf8");
  if (bytes > STATEMENT_BYTE_BUDGET) {
    throw new StatementScopeError({ kind: "over-budget", bytes, budget: STATEMENT_BYTE_BUDGET });
  }
  const count = Object.keys(params).length;
  if (count > STATEMENT_PARAM_BUDGET) {
    throw new StatementScopeError({
      kind: "over-param-budget",
      params: count,
      budget: STATEMENT_PARAM_BUDGET,
    });
  }
}
