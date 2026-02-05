/**
 * Types for analytics parity check
 *
 * Note: Intermediate span types (CollectorRESTParams, Span, LLMSpan, RAGSpan, etc.)
 * have been removed as the parity check now generates OTEL traces directly.
 */

// Analytics query types
export interface SharedFiltersInput {
  projectId: string;
  startDate: number;
  endDate: number;
  query?: string;
  filters?: Record<string, string[] | Record<string, string[]>>;
}

export interface TimeseriesInput extends SharedFiltersInput {
  series: SeriesInput[];
  groupBy?: string;
  groupByKey?: string;
  timeScale?: "full" | number;
  timeZone: string;
}

export interface SeriesInput {
  metric: string;
  key?: string;
  subkey?: string;
  aggregation: string;
  pipeline?: {
    field: string;
    aggregation: string;
  };
  filters?: Record<string, string[] | Record<string, string[]>>;
  asPercent?: boolean;
}

export interface DataForFilterInput extends SharedFiltersInput {
  field: string;
  key?: string;
  subkey?: string;
}

// Analytics results
export interface TimeseriesBucket {
  date: string;
  [key: string]: string | number | null;
}

export interface TimeseriesResult {
  currentPeriod: TimeseriesBucket[];
  previousPeriod: TimeseriesBucket[];
}

export interface FilterOption {
  field: string;
  label: string;
  count: number;
}

export interface FilterDataResult {
  options: FilterOption[];
}

export interface DocumentUsage {
  document_id: string;
  count: number;
}

export interface TopDocumentsResult {
  documents: DocumentUsage[];
}

export interface FeedbackEvent {
  event_id: string;
  event_type: string;
  trace_id: string;
  metrics: { key: string; value: number }[];
  event_details: { key: string; value: string }[];
}

export interface FeedbacksResult {
  events: FeedbackEvent[];
}

// Comparison types
export interface Discrepancy {
  path: string;
  esValue: unknown;
  chValue: unknown;
  percentDiff?: number;
}

export interface ComparisonResult {
  passed: boolean;
  queryName: string;
  discrepancies: Discrepancy[];
  esResultSummary: unknown;
  chResultSummary: unknown;
}

export interface VerificationReport {
  timestamp: string;
  runId: string;
  tracesGenerated: number;
  tracesSent: {
    es: number;
    ch: number;
  };
  comparisons: ComparisonResult[];
  overallPassed: boolean;
  summary: {
    totalQueries: number;
    passedQueries: number;
    failedQueries: number;
  };
  // Debug information (included when verbose mode is enabled)
  debug?: {
    esQueries: StructuredQueryDetail[];
    chQueries: StructuredQueryDetail[];
  };
}

// Enhanced query detail for debugging
export interface StructuredQueryDetail {
  name: string;
  type: "timeseries" | "filter" | "documents" | "feedbacks";
  input: unknown;
  result: unknown;
  rawResponse?: unknown;
  error: string | null;
}

// CLI configuration
export interface Config {
  baseUrl: string;
  esProjectId: string;
  esApiKey: string;
  chProjectId: string;
  chApiKey: string;
  prodApiKey: string | null;
  tolerance: number;
  traceCount: number;
  waitTimeMs: number;
}
