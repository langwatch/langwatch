import type { FilterOption } from "../filter-options.repository.ts";

/** Trace's translation of the other filters a picker is narrowed by. */
export type FilterOptionsScope = {
  conditions: string[];
  params: Record<string, unknown>;
};

export type ClickHouseFilterQueryParams = {
  tenantId: string;
  query?: string;
  key?: string;
  subkey?: string;
  startDate: number;
  endDate: number;
  /** Conditions over `trace_summaries ts` scoping results to a subset of traces, from Trace. */
  scope?: FilterOptionsScope;
};

/**
 * ClickHouse tables that support filter queries.
 */
export type ClickHouseFilterTable = "trace_summaries" | "stored_spans" | "evaluation_runs";

export type ClickHouseFilterDefinition = {
  /**
   * The ClickHouse table to query. If null, this filter is not supported in ClickHouse.
   */
  tableName: ClickHouseFilterTable | null;
  /**
   * Build the SQL query for this filter. Returns null when the filter cannot
   * be queried yet (e.g. a required key/subkey is missing) — callers resolve
   * that to an empty option list without hitting ClickHouse.
   */
  buildQuery: (params: ClickHouseFilterQueryParams) => string | null;
  /**
   * Extract filter options from the query result rows.
   */
  extractResults: (rows: unknown[]) => FilterOption[];
};

/**
 * A filter definition that is known to be supported in ClickHouse (non-null tableName).
 */
export type SupportedClickHouseFilterDefinition = ClickHouseFilterDefinition & {
  tableName: ClickHouseFilterTable;
};
