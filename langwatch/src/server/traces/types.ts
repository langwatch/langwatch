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

/**
 * Input parameters for getAllTracesForProject.
 * Used by both ClickHouse and Elasticsearch services.
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
 * Used by both ClickHouse and Elasticsearch services.
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
 * Returns unique span names and metadata keys for a project.
 */
export interface DistinctFieldNamesResult {
  spanNames: Array<{ key: string; label: string }>;
  metadataKeys: Array<{ key: string; label: string }>;
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
    litellmParams: Record<string, unknown>;
  };
  vendor: string | null;
  error: Span["error"] | null;
  timestamps: SpanTimestamps | undefined;
  metrics: LLMSpan["metrics"] | null;
}
