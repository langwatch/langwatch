import type { ScenarioRunStatus, Verdict } from "~/app/api/scenario-events/[[...route]]/enums";
import type { ScenarioRunData } from "~/app/api/scenario-events/[[...route]]/types";

/**
 * Row data structure for the scenarios table view
 * Represents a single scenario run with all its associated data
 */
export interface ScenarioRunRow extends ScenarioRunData {
  // Traces (for expandable rows)
  metadata: {
    traces: { trace_id: string }[];
  };
}

/**
 * Trace row data for nested table in expanded rows
 */
export interface TraceRow {
  traceId: string;
  timestamp: number;
  input: string;
  output: string;
  metadata: Record<string, unknown>;
  spanCount: number;
  totalTokens: number;
  totalCost: number;
}

/**
 * Filter state for the table view
 */
export interface ScenarioTableFilter {
  columnId: string;
  operator: "eq" | "contains";
  value: unknown;
}

/**
 * Sorting state for the table view
 */
export interface ScenarioTableSorting {
  columnId: string;
  order: "asc" | "desc";
}

/**
 * Query parameters for the filtered scenarios API
 */
export interface FilteredScenariosQuery {
  projectId: string;
  filters?: ScenarioTableFilter[];
  sorting?: ScenarioTableSorting;
  page?: number;
  pageSize?: number;
  search?: string;
  includeTraces?: boolean;
}

/**
 * Response from the filtered scenarios API
 */
export interface FilteredScenariosResponse {
  rows: ScenarioRunRow[];
  totalCount: number;
  metadataKeys: string[];
}
