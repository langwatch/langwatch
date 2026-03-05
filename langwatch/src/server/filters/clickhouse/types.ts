/**
 * Result of building a filter condition - contains both the SQL fragment
 * and any parameters needed for the query.
 */
export type FilterConditionResult = {
  sql: string;
  params: Record<string, unknown>;
};

import type { FilterParam } from "~/hooks/useFilterParams";
import type { FilterField } from "../types";

export type ClickHouseFilterQueryParams = {
  tenantId: string;
  query?: string;
  key?: string;
  subkey?: string;
  startDate: number;
  endDate: number;
  /** Optional filters for scoping results to a subset of traces */
  scopeFilters?: Partial<Record<FilterField, FilterParam>>;
};

export type FilterOption = {
  field: string;
  label: string;
  count: number;
};

/**
 * ClickHouse tables that support filter queries.
 */
export type ClickHouseFilterTable =
  | "trace_summaries"
  | "stored_spans"
  | "evaluation_runs";

export type ClickHouseFilterDefinition = {
  /**
   * The ClickHouse table to query. If null, this filter is not supported in ClickHouse.
   */
  tableName: ClickHouseFilterTable | null;
  /**
   * Build the SQL query for this filter.
   */
  buildQuery: (params: ClickHouseFilterQueryParams) => string;
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

/**
 * Type for filter condition builder functions.
 * Each builder takes filter values and returns SQL + params for parameterized queries.
 * The paramId is used to create unique parameter names when multiple filters are combined.
 */
export type FilterConditionBuilder = (
  values: string[],
  paramId: string,
  key?: string,
  subkey?: string,
) => FilterConditionResult;

/**
 * Result of generating filter conditions from filter parameters.
 */
export type GenerateFilterConditionsResult = {
  conditions: string[];
  params: Record<string, unknown>;
  hasUnsupportedFilters: boolean;
};
