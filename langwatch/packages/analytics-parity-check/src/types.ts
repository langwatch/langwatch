/**
 * Types for analytics parity check
 */

// Span types matching the tracer types
export type SpanType =
  | "span"
  | "llm"
  | "chain"
  | "tool"
  | "agent"
  | "rag"
  | "guardrail"
  | "evaluation"
  | "workflow"
  | "component"
  | "module"
  | "server"
  | "client"
  | "producer"
  | "consumer"
  | "task"
  | "unknown";

export interface RAGChunk {
  document_id?: string | null;
  chunk_id?: string | null;
  content: string;
}

export interface SpanMetrics {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  reasoning_tokens?: number | null;
  tokens_estimated?: boolean | null;
  cost?: number | null;
}

export interface SpanTimestamps {
  started_at: number;
  first_token_at?: number | null;
  finished_at: number;
}

export interface ErrorCapture {
  has_error: true;
  message: string;
  stacktrace: string[];
}

export interface ChatMessage {
  role?: "system" | "user" | "assistant" | "function" | "tool" | "unknown";
  content?: string | null;
  name?: string | null;
}

export type SpanInputOutput =
  | { type: "text"; value: string }
  | { type: "chat_messages"; value: ChatMessage[] }
  | { type: "json"; value: unknown }
  | { type: "raw"; value: string };

export interface BaseSpan {
  span_id: string;
  parent_id?: string | null;
  trace_id: string;
  type: SpanType;
  name?: string | null;
  input?: SpanInputOutput | null;
  output?: SpanInputOutput | null;
  error?: ErrorCapture | null;
  timestamps: SpanTimestamps;
  metrics?: SpanMetrics | null;
  params?: Record<string, unknown> | null;
}

export interface LLMSpan extends BaseSpan {
  type: "llm";
  vendor?: string | null;
  model?: string | null;
}

export interface RAGSpan extends BaseSpan {
  type: "rag";
  contexts: RAGChunk[];
}

export type Span = LLMSpan | RAGSpan | BaseSpan;

export interface TraceMetadata {
  thread_id?: string | null;
  user_id?: string | null;
  customer_id?: string | null;
  labels?: string[] | null;
  [key: string]: unknown;
}

export interface RESTEvaluation {
  evaluation_id?: string | null;
  evaluator_id?: string | null;
  span_id?: string | null;
  name: string;
  type?: string | null;
  is_guardrail?: boolean | null;
  status?: "processed" | "skipped" | "error" | null;
  passed?: boolean | null;
  score?: number | null;
  label?: string | null;
  details?: string | null;
  timestamps?: {
    started_at?: number | null;
    finished_at?: number | null;
  } | null;
}

export interface CollectorRESTParams {
  trace_id?: string | null;
  spans: Span[];
  metadata?: TraceMetadata;
  expected_output?: string | null;
  evaluations?: RESTEvaluation[];
}

// Trace variation for testing
export interface TraceVariation {
  name: string;
  description: string;
  traces: CollectorRESTParams[];
}

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
}

// CLI configuration
export interface Config {
  baseUrl: string;
  esProjectId: string;
  esApiKey: string;
  chProjectId: string;
  chApiKey: string;
  tolerance: number;
  traceCount: number;
  waitTimeMs: number;
}
