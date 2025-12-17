import type { ScenarioRunStatus, Verdict } from "~/app/api/scenario-events/[[...route]]/enums";

/**
 * Row data structure for the scenarios table view
 * Represents a single scenario run with all its associated data
 */
export interface ScenarioRunRow {
  // Core identifiers
  scenarioRunId: string;
  scenarioId: string;
  scenarioSetId: string;
  batchRunId: string;

  // Display fields
  name: string | null;
  description: string | null;
  status: ScenarioRunStatus;
  verdict: Verdict | null;
  timestamp: number;
  durationInMs: number;

  // Results
  metCriteria: string[];
  unmetCriteria: string[];

  // Traces (for expandable rows)
  traces: TraceRow[];

  // Dynamic metadata from traces - flattened for filtering
  [key: `metadata.${string}`]: unknown;
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
