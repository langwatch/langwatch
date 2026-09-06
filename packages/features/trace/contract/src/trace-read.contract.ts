import { z } from "zod";
import { evaluationResultSchema, evaluationSchema, traceSchema } from "./trace-format.schemas.ts";
import type {
  ChatMessage,
  Evaluation,
  EvaluationResult,
  LLMSpan,
  Span,
  SpanTimestamps,
  Trace,
} from "./trace-format.schemas.ts";

/**
 * The results the legacy trace read answers with. They are the contract between that read and
 * every transport over it — the tRPC surface, the v1 REST search, the export composer — so they
 * live beside the trace formats they are built from rather than inside any one caller.
 */

/**
 * A trace as the list/search read returns it: the stored trace plus the two
 * things that read joins on — the guardrail that blocked it, if one did, and
 * whether it carries annotations.
 */
export type TraceWithGuardrail = Trace & {
  lastGuardrail: (EvaluationResult & { name?: string }) | undefined;
  annotations?: {
    hasAnnotation: boolean;
    count: number;
  };
};

/**
 * Result structure for getAllTracesForProject.
 * Used by the ClickHouse trace service.
 */
export interface TracesForProjectResult {
  groups: TraceWithGuardrail[][];
  totalHits: number;
  traceChecks: Record<string, Evaluation[]>;
  scrollId?: string;
  /**
   * Updated axis only. The upper bound this scroll actually covered, in epoch ms — the moment
   * it was pinned to, which is at or before the requested `endDate`. A scroll reads each trace
   * as of its start so mid-scroll writes cannot move rows out from under the cursor.
   */
  updatedThrough?: number;
}

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
 * Result structure for getDistinctFieldNames. Returns unique span names, metadata keys and
 * evaluator names for a project, so field-mapping dropdowns can offer every name the project
 * produced (not just the ones on the currently loaded trace).
 */
export interface DistinctFieldNamesResult {
  spanNames: Array<{ key: string; label: string }>;
  metadataKeys: Array<{ key: string; label: string }>;
  evaluationNames: Array<{ key: string; label: string }>;
}

/**
 * Result structure for tryGetSpanForPromptStudio.
 * Contains all the data needed to populate the prompt studio UI.
 */
export interface PromptStudioSpanResult {
  spanId: string;
  traceId: string;
  spanName: string | null;
  messages: ChatMessage[];
  llmConfig: {
    model: string | null;
    /** Absent when the span carried no system message: JSON drops the key. */
    systemPrompt?: ChatMessage["content"];
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
  /** Absent when the span recorded no error: JSON drops a key holding `undefined`. */
  error?: Span["error"] | null;
  /** Absent on a span with no timing, for the same reason. */
  timestamps?: SpanTimestamps;
  /** Absent when the span carried no metrics: JSON drops a key holding `undefined`. */
  metrics?: LLMSpan["metrics"] | null;
  /** Prompt handle from span attributes (new combined or old format) */
  promptHandle: string | null;
  /** Prompt version number from span attributes (new combined or old format) */
  promptVersionNumber: number | null;
  /** Prompt tag from span attributes (e.g., "production", "staging") */
  promptTag: string | null;
  /** Prompt variables extracted from span attributes */
  promptVariables: Record<string, string> | null;
}

/**
 * The minimum every legacy trace read is scoped by: one project and one window over the
 * occurred axis. A deployment's real filter schema is richer — the shared analytics filters,
 * free text, a trace-id list, negation — and it is the application that owns it.
 */
export type TraceLegacyFilterInput = {
  projectId: string;
  startDate: number;
  endDate: number;
};

/** The same, plus the paging and ordering the list/search read understands. */
export type TraceLegacyListInput = TraceLegacyFilterInput & {
  /**
   * The deployment's own filter schema, carried through untouched. Opaque
   * here because the application owns its shape and the read hands it
   * straight to its repository.
   */
  filters?: unknown;
  /** Narrows the read to named traces, when the caller already has ids. */
  traceIds?: string[];
  query?: string;
  pageSize?: number;
  groupBy?: string;
  sortBy?: string;
  sortDirection?: string;
  /** Keyset cursor. Offset paging was removed in the ClickHouse migration. */
  scrollId?: string | null;
  updatedAt?: number;
};

// ---------------------------------------------------------------------------
// The same results, as parsers the tRPC surface declares its answers with.
// ---------------------------------------------------------------------------

/**
 * A trace as the list/search read returns it: the stored trace plus the two
 * things that read joins on — the guardrail that blocked it, if one did, and
 * whether it carries annotations.
 */
export const traceWithGuardrailSchema = traceSchema.extend({
  lastGuardrail: evaluationResultSchema.and(z.object({ name: z.string().optional() })).optional(),
  annotations: z.object({ hasAnnotation: z.boolean(), count: z.number() }).optional(),
});

export const tracesForProjectResultSchema = z.object({
  groups: z.array(z.array(traceWithGuardrailSchema)),
  totalHits: z.number(),
  traceChecks: z.record(z.string(), z.array(evaluationSchema)),
  scrollId: z.string().optional(),
  updatedThrough: z.number().optional(),
});

export const topicCountsResultSchema = z.object({
  topicCounts: z.array(z.object({ key: z.string(), count: z.number() })),
  subtopicCounts: z.array(z.object({ key: z.string(), count: z.number() })),
});

/** The named topic and subtopic counts the trace filters render. */
export const namedTopicCountsSchema = z.object({
  topicCounts: z.array(z.object({ id: z.string(), name: z.string(), count: z.number() })),
  subtopicCounts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      count: z.number(),
      parentId: z.string().nullable().optional(),
    }),
  ),
});

export const customersAndLabelsResultSchema = z.object({
  customers: z.array(z.string()),
  labels: z.array(z.string()),
});

const fieldNameSchema = z.object({ key: z.string(), label: z.string() });

export const distinctFieldNamesResultSchema = z.object({
  spanNames: z.array(fieldNameSchema),
  metadataKeys: z.array(fieldNameSchema),
  evaluationNames: z.array(fieldNameSchema),
});

/** One sampled trace, flagged with whether it met the evaluator's conditions. */
export const sampledTraceSchema = traceSchema.extend({ passesPreconditions: z.boolean() });
