/**
 * Analytics Service Types
 *
 * Clean input/output types for the AnalyticsService.
 * These are defined independently of the legacy analytics layer and match
 * the shape needed by the tRPC API.
 */

/**
 * Input for timeseries queries. Combines shared filter parameters
 * with series-specific configuration.
 */
export interface AnalyticsTimeseriesInput {
  projectId: string;
  startDate: number;
  endDate: number;
  filters: Record<string, unknown>;
  series: AnalyticsSeriesInput[];
  groupBy?: string;
  groupByKey?: string;
  timeScale?: number | "full";
  timeZone: string;
}

/**
 * A single series within a timeseries request.
 * Describes which metric to query, how to aggregate it,
 * and optional key/pipeline filters.
 */
export interface AnalyticsSeriesInput {
  metric: string;
  aggregation: string;
  key?: string;
  subkey?: string;
  pipeline?: { field: string; aggregation: string };
  filters?: Record<string, unknown>;
  asPercent?: boolean;
}

/**
 * A single timeseries bucket — one time interval with metric values.
 * Keys beyond "date" are series names (e.g., "0/metadata.trace_id/cardinality").
 * When groupBy is used, the groupBy field name maps to nested group data.
 */
export interface TimeseriesBucket {
  date: string;
  [key: string]: number | string | Record<string, Record<string, number>>;
}

/**
 * Timeseries result with previous and current period buckets
 * for comparison charts.
 */
export interface TimeseriesResult {
  previousPeriod: TimeseriesBucket[];
  currentPeriod: TimeseriesBucket[];
}

/** A single option returned by filter queries */
export interface FilterOption {
  field: string;
  label: string;
  count: number;
}

/** A top-used RAG document with usage count */
export interface TopDocument {
  documentId: string;
  count: number;
  traceId: string;
  content?: string;
}

/** A feedback event from trace facts */
export interface FeedbackEvent {
  event_id: string;
  event_type: string;
  project_id?: string;
  trace_id: string;
  timestamps: { started_at: number; inserted_at: number; updated_at: number };
  metrics?: Array<{ key: string; value: number }>;
  event_details?: Array<{ key: string; value: string }>;
}
