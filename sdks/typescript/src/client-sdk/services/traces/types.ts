export interface GetTraceParams {
  includeSpans?: boolean;
}

/** The error block a trace or one of its parts carries when it failed. */
export interface TraceErrorCapture {
  stacktrace?: string[];
  message?: string;
  has_error?: boolean;
}

/** One message in a span's chat input or output. */
export interface TraceChatMessage {
  role?: string;
  content?: string;
}

/** One span of a trace, as the trace read answers it. */
export interface TraceSpan {
  trace_id?: string;
  span_id?: string;
  project_id?: string;
  parent_id?: string | null;
  name?: string | null;
  type?: string;
  model?: string;
  timestamps?: {
    started_at?: number;
    first_token_at?: number;
    finished_at?: number;
    inserted_at?: number;
    updated_at?: number;
  };
  error?: TraceErrorCapture | null;
  params?: {
    stream?: boolean;
    temperature?: number;
  };
  metrics?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    tokens_estimated?: boolean;
  };
  input?: {
    type?: string;
    value?: TraceChatMessage[];
  };
  output?: {
    type?: string;
    value?: TraceChatMessage[];
  };
}

/** One evaluation recorded against a trace. */
export interface TraceEvaluation {
  evaluation_id?: string;
  name?: string;
  type?: string;
  trace_id?: string;
  project_id?: string;
  status?: string;
  timestamps?: {
    inserted_at?: number;
    updated_at?: number;
  };
  error?: TraceErrorCapture;
}

/**
 * A single trace with its spans and evaluations. Hand-declared because the
 * served OpenAPI document describes this answer as a free-form object, so the
 * generated client cannot carry the shape callers read.
 */
export interface GetTraceResponse {
  trace_id?: string;
  project_id?: string;
  metadata?: {
    sdk_version?: string;
    sdk_language?: string;
  };
  timestamps?: {
    started_at?: number;
    inserted_at?: number;
    updated_at?: number;
  };
  input?: {
    value?: string;
  };
  output?: {
    value?: string;
  };
  error?: TraceErrorCapture | null;
  indexing_md5s?: string[];
  spans?: TraceSpan[];
  evaluations?: TraceEvaluation[];
}

/**
 * Custom error class for Traces API operations.
 * Provides context about the failed operation and the original error.
 */
export class TracesError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: any,
  ) {
    super(message);
    this.name = "TracesError";
  }
}
