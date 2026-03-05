/**
 * Types for traces parity check
 */

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
  runPythonExamples: boolean;
  runSnippets: boolean;
  pythonSdkDir: string;
}

// Trace types (matching the API response shape)
export interface TraceInput {
  value: string;
  satisfaction_score?: number;
}

export interface TraceOutput {
  value: string;
}

export interface TraceMetrics {
  first_token_ms?: number | null;
  total_time_ms?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  reasoning_tokens?: number | null;
  total_cost?: number | null;
  tokens_estimated?: boolean | null;
}

export interface ErrorCapture {
  has_error: true;
  message: string;
  stacktrace: string[];
}

export interface SpanInputOutput {
  type: string;
  value: unknown;
}

export interface SpanMetrics {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  reasoning_tokens?: number | null;
  tokens_estimated?: boolean | null;
  cost?: number | null;
}

export interface RAGChunk {
  document_id?: string | null;
  chunk_id?: string | null;
  content: string | Record<string, unknown> | unknown[];
}

export interface SpanTimestamps {
  started_at: number;
  first_token_at?: number | null;
  finished_at: number;
}

export interface TraceSpan {
  span_id: string;
  parent_id?: string | null;
  trace_id: string;
  type: string;
  name?: string | null;
  input?: SpanInputOutput | null;
  output?: SpanInputOutput | null;
  error?: ErrorCapture | null;
  timestamps: SpanTimestamps;
  metrics?: SpanMetrics | null;
  params?: Record<string, unknown> | null;
  vendor?: string | null;
  model?: string | null;
  contexts?: RAGChunk[];
}

export interface TraceMetadata {
  thread_id?: string | null;
  user_id?: string | null;
  customer_id?: string | null;
  labels?: string[] | null;
  sdk_name?: string | null;
  sdk_version?: string | null;
  sdk_language?: string | null;
  [key: string]: unknown;
}

export interface Trace {
  trace_id: string;
  project_id: string;
  metadata: TraceMetadata;
  timestamps: { started_at: number; inserted_at: number; updated_at: number };
  input?: TraceInput;
  output?: TraceOutput;
  metrics?: TraceMetrics;
  error?: ErrorCapture | null;
  spans: TraceSpan[];
  evaluations?: unknown[];
}

// Comparison types
export interface Discrepancy {
  path: string;
  esValue: unknown;
  chValue: unknown;
  percentDiff?: number;
}

export interface TraceComparisonResult {
  traceId: string;
  passed: boolean;
  discrepancies: Discrepancy[];
}

export interface FieldSummary {
  field: string;
  total: number;
  passed: number;
  failed: number;
  failures: { traceId: string; esValue: unknown; chValue: unknown; percentDiff?: number }[];
}

export interface PythonExampleResult {
  exampleName: string;
  esTraceId: string | null;
  chTraceId: string | null;
  esTrace: Trace | null;
  chTrace: Trace | null;
  structuralMatch: boolean;
  issues: string[];
}

export interface SnippetSingleRunResult {
  success: boolean;
  startTime: number;
  endTime: number;
  durationMs: number;
  serviceName: string;
  backend: "es" | "ch";
  error?: string;
  /** Last 500 chars of stdout (for debugging failures) */
  stdout?: string;
  /** Last 500 chars of stderr (for debugging failures) */
  stderr?: string;
}

export interface SnippetRunResult {
  snippetName: string;
  language: "python" | "typescript" | "go";
  esRun: SnippetSingleRunResult;
  chRun: SnippetSingleRunResult;
}

export interface TraceSummary {
  traceId: string;
  hasInput: boolean;
  hasOutput: boolean;
  spanCount: number;
  spanTypes: string[];
  model: string | null;
  durationMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface SnippetExampleResult {
  snippetName: string;
  esTraceId: string | null;
  chTraceId: string | null;
  esMatchMethod: "service.name" | "time-window" | null;
  chMatchMethod: "service.name" | "time-window" | null;
  esSummary: TraceSummary | null;
  chSummary: TraceSummary | null;
  esTrace: Trace | null;
  chTrace: Trace | null;
  structuralMatch: boolean;
  issues: string[];
}

export interface SnippetSkipResult {
  snippetName: string;
  reason: "skipped" | "es_failed" | "ch_failed" | "both_failed" | "no_trace_found";
  missingEnvVars?: string[];
  esError?: string;
  chError?: string;
}

export interface ParityReport {
  timestamp: string;
  runId: string;
  /** Quick-scan summary — all key numbers in one place */
  summary: {
    overallPassed: boolean;
    otelTraces: { total: number; passed: number; failed: number };
    snippets: { total: number; validated: number; passed: number; issues: number; skipped: number } | null;
    pythonSdk: { total: number; esOk: number; chOk: number } | null;
    totalDurationMs: number;
  };
  otelTraces: {
    totalCompared: number;
    passed: number;
    failed: number;
    traceResults: TraceComparisonResult[];
    fieldSummaries: FieldSummary[];
  };
  pythonSdk: {
    totalValidated: number;
    esOk: number;
    chOk: number;
    results: PythonExampleResult[];
  } | null;
  snippets: {
    totalRun: number;
    totalValidated: number;
    esOk: number;
    chOk: number;
    results: SnippetExampleResult[];
    skipped: SnippetSkipResult[];
  } | null;
  overallPassed: boolean;
}

export interface PythonRunResult {
  exampleName: string;
  traceId: string | null;
  success: boolean;
}
