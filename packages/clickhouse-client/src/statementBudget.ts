/**
 * The most statement text a reader sends: ClickHouse's default `max_query_size`, 256 KiB (ADR-177
 * v4.7, ADR-183 §3). Measured after the markers expand, so a proof whose braids would overflow
 * it is refused by name before anything is sent. Bound parameters travel apart and do not count.
 */
import { StatementScopeError } from "./statementScopeError.ts";

export const STATEMENT_BYTE_BUDGET = 256 * 1024;

/** Refuses an expanded statement whose text is over {@link STATEMENT_BYTE_BUDGET}. */
export function refuseOverBudget({ statement }: { statement: string }): void {
  const bytes = Buffer.byteLength(statement, "utf8");
  if (bytes > STATEMENT_BYTE_BUDGET) {
    throw new StatementScopeError({ kind: "over-budget", bytes, budget: STATEMENT_BYTE_BUDGET });
  }
}
