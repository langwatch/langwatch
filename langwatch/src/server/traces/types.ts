import type { z } from "zod";
import type { TraceWithGuardrail } from "~/components/messages/MessageCard";
import type { sharedFiltersInputSchema } from "~/server/analytics/types";
import type {
  ChatMessage,
  Evaluation,
  LLMSpan,
  Span,
  SpanTimestamps,
} from "~/server/tracer/types";
import type { ProjectionPlan } from "./projection/types";

/** Time axis that `startDate`/`endDate` and the keyset cursor apply to. */
export type TraceDateField = "occurred" | "updated";

/**
 * Options for getAllTracesForProject, shared by the TraceService facade and the
 * ClickHouse implementation so the contract stays in one place.
 */
export interface GetAllTracesForProjectOptions {
  downloadMode?: boolean;
  includeSpans?: boolean;
  scrollId?: string | null;
  /**
   * Which time axis the date window + keyset cursor filter on. "occurred"
   * (default) keeps the legacy OccurredAt behavior; "updated" pages by last
   * mutation time for incremental ETL (CDC) pulls.
   */
  dateField?: TraceDateField;
  /**
   * Compiled projection plan (from the projection DSL). Drives which child
   * collections are JOINed and whether the heavy io columns are fetched.
   * Opaque to callers — produced by `compileProjection`.
   */
  projection?: ProjectionPlan;
}

/**
 * Input parameters for getAllTracesForProject.
 * Used by the ClickHouse trace services.
 * Extends the shared filters input schema with pagination and sorting options.
 */
export type GetAllTracesForProjectInput = z.infer<
  typeof sharedFiltersInputSchema
> & {
  pageOffset?: number;
  pageSize?: number;
  groupBy?: string;
  sortBy?: string;
  sortDirection?: string;
  scrollId?: string | null;
  updatedAt?: number;
};

/**
 * Result structure for getAllTracesForProject.
 * Used by the ClickHouse trace services.
 */
export interface TracesForProjectResult {
  groups: TraceWithGuardrail[][];
  totalHits: number;
  traceChecks: Record<string, Evaluation[]>;
  scrollId?: string;
}

/**
 * Input parameters for aggregation queries (getTopicCounts, getCustomersAndLabels).
 */
export type AggregationFiltersInput = z.infer<typeof sharedFiltersInputSchema>;

/**
 * Result structure for topic count aggregations.
 */
export interface TopicCountsResult {
  topicCounts: Array<{ key: string; count: number }>;
  subtopicCounts: Array<{ key: string; count: number }>;
}

/**
 * Result structure for customers and labels aggregations.
 */
export interface CustomersAndLabelsResult {
  customers: string[];
  labels: string[];
}

/**
 * Result structure for getDistinctFieldNames.
 * Returns unique span names, metadata keys and evaluator names for a project,
 * so field-mapping dropdowns can offer every name the project produced (not
 * just the ones on the currently loaded trace).
 *
 * Evaluation entries carry the evaluator id as `key` and its display name as
 * `label`; the other arrays use the name for both.
 *
 * Event types are intentionally not included here: they live only inside the
 * heavy `stored_spans.SpanAttributes` map (the trace_summaries event columns
 * were dropped in migration 00025), so scanning them in this query would
 * materialise that column — exactly the OOM/IO vector the memory-safety guard
 * protects against. The events dropdown instead gets its project-wide options
 * from the bounded analytics event-type filter query (see useProjectEventTypes).
 */
export interface DistinctFieldNamesResult {
  spanNames: Array<{ key: string; label: string }>;
  metadataKeys: Array<{ key: string; label: string }>;
  evaluationNames: Array<{ key: string; label: string }>;
}

/**
 * Result structure for getSpanForPromptStudio.
 * Contains all the data needed to populate the prompt studio UI.
 */
export interface PromptStudioSpanResult {
  spanId: string;
  traceId: string;
  spanName: string | null;
  messages: ChatMessage[];
  llmConfig: {
    model: string | null;
    systemPrompt: ChatMessage["content"];
    temperature: number | null;
    maxTokens: number | null;
    topP: number | null;
    frequencyPenalty: number | null;
    presencePenalty: number | null;
    seed: number | null;
    topK: number | null;
    minP: number | null;
    repetitionPenalty: number | null;
    reasoning: string | null;
    verbosity: string | null;
    litellmParams: Record<string, unknown>;
  };
  vendor: string | null;
  error: Span["error"] | null;
  timestamps: SpanTimestamps | undefined;
  metrics: LLMSpan["metrics"] | null;
  /** Prompt handle from span attributes (new combined or old format) */
  promptHandle: string | null;
  /** Prompt version number from span attributes (new combined or old format) */
  promptVersionNumber: number | null;
  /** Prompt tag from span attributes (e.g., "production", "staging") */
  promptTag: string | null;
  /** Prompt variables extracted from span attributes */
  promptVariables: Record<string, string> | null;
}
