import { z } from "zod";

// ---------------------------------------------------------------------------
// Scoped output models – one per drawer use-case
// ---------------------------------------------------------------------------

/**
 * Trace list row shape returned by `tracesV2.list`. Defaults are wide because
 * older callers / replayed cached responses may pre-date newer fields — falling
 * back keeps consumers safe instead of throwing on a fresh deploy.
 */
export const traceListItemSchema = z.object({
  traceId: z.string(),
  timestamp: z.number(),
  name: z.string(),
  serviceName: z.string(),
  durationMs: z.number(),
  totalCost: z.number(),
  totalTokens: z.number(),
  inputTokens: z.number().nullable().optional(),
  outputTokens: z.number().nullable().optional(),
  models: z.array(z.string()),
  status: z.enum(["ok", "error", "warning"]),
  spanCount: z.number().int().nonnegative().default(0),
  input: z.string().nullable(),
  output: z.string().nullable(),
  error: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  origin: z.string(),
  tokensEstimated: z.boolean().optional(),
  ttft: z.number().nullable().optional(),
  rootSpanName: z.string().nullable().optional(),
  rootSpanType: z.string().nullable().optional(),
  events: z
    .array(
      z.object({
        spanId: z.string(),
        timestamp: z.number(),
        name: z.string(),
      }),
    )
    .default([]),
});

export type TraceListItemDto = z.infer<typeof traceListItemSchema>;

/**
 * Trace header: everything the drawer header + summary tab needs.
 * Returned by `tracesV2.header`.
 */
export const traceHeaderSchema = z.object({
  traceId: z.string(),
  timestamp: z.number(),
  name: z.string(),
  serviceName: z.string(),
  origin: z.string(),
  conversationId: z.string().nullable(),
  userId: z.string().nullable(),
  durationMs: z.number(),
  spanCount: z.number(),
  status: z.enum(["ok", "error", "warning"]),
  error: z.string().nullish(),
  input: z.string().nullish(),
  output: z.string().nullish(),
  models: z.array(z.string()),
  totalCost: z.number().nullable(),
  totalTokens: z.number(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  tokensEstimated: z.boolean(),
  ttft: z.number().nullish(),
  rootSpanName: z.string().nullable(),
  rootSpanType: z.string().nullable(),
  scenarioRunId: z.string().nullable(),
  /**
   * Trace-level prompt rollup, projected from span attributes by the
   * trace-summary projection (PRD-023). `selected*` is what the developer
   * pinned (`langwatch.prompt.selected.id`); `lastUsed*` is what actually
   * ran (`langwatch.prompt.id`). When both are set and disagree the drawer
   * surfaces a drift warning. `containsPrompt` is the cheap precondition
   * gate — `false` when no span on this trace touched a managed prompt.
   */
  containsPrompt: z.boolean().default(false),
  selectedPromptId: z.string().nullable().default(null),
  selectedPromptSpanId: z.string().nullable().default(null),
  lastUsedPromptId: z.string().nullable().default(null),
  lastUsedPromptVersionNumber: z.number().nullable().default(null),
  lastUsedPromptVersionId: z.string().nullable().default(null),
  lastUsedPromptSpanId: z.string().nullable().default(null),
  attributes: z.record(z.string()),
  events: z
    .array(
      z.object({
        spanId: z.string(),
        timestamp: z.number(),
        name: z.string(),
        attributes: z.record(z.string()),
      }),
    )
    .default([]),
});

export type TraceHeader = z.infer<typeof traceHeaderSchema>;

/**
 * Span tree node: lightweight per-span data for waterfall / flame / span-list.
 * Returned by `tracesV2.spanTree`.
 */
export const spanTreeNodeSchema = z.object({
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  name: z.string(),
  type: z.string().nullable(),
  startTimeMs: z.number(),
  endTimeMs: z.number(),
  durationMs: z.number(),
  status: z.enum(["ok", "error", "unset"]),
  model: z.string().nullable(),
});

export type SpanTreeNode = z.infer<typeof spanTreeNodeSchema>;

/**
 * Per-span LangWatch instrumentation signals — fetched via
 * `tracesV2.spanLangwatchSignals` as a separate, secondary call so the
 * primary span tree query stays cheap. Keys correspond to attribute-prefix
 * buckets (`langwatch.prompt.*`, `gen_ai.*`, etc.) detected server-side.
 */
export const langwatchSignalBucketSchema = z.enum([
  "prompt",
  "scenario",
  "user",
  "thread",
  "evaluation",
  "rag",
  "metadata",
  "genai",
]);

export type LangwatchSignalBucket = z.infer<typeof langwatchSignalBucketSchema>;

export const spanLangwatchSignalsSchema = z.object({
  spanId: z.string(),
  signals: z.array(langwatchSignalBucketSchema),
});

export type SpanLangwatchSignals = z.infer<typeof spanLangwatchSignalsSchema>;

/**
 * Span detail: full span data for the accordion when a span is selected.
 * Returned by `tracesV2.spanDetail`.
 */
export const spanDetailSchema = z.object({
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  name: z.string(),
  type: z.string(),
  startTimeMs: z.number(),
  endTimeMs: z.number(),
  durationMs: z.number(),
  status: z.enum(["ok", "error", "unset"]),
  model: z.string().nullish(),
  vendor: z.string().nullish(),
  input: z.string().nullish(),
  output: z.string().nullish(),
  error: z
    .object({
      message: z.string(),
      stacktrace: z.array(z.string()),
    })
    .nullish(),
  metrics: z
    .object({
      promptTokens: z.number().nullish(),
      completionTokens: z.number().nullish(),
      cost: z.number().nullish(),
      tokensEstimated: z.boolean().nullish(),
    })
    .nullish(),
  params: z.record(z.unknown()).nullish(),
  events: z.array(
    z.object({
      name: z.string(),
      timestampMs: z.number(),
      attributes: z.record(z.unknown()),
    }),
  ),
});

export type SpanDetail = z.infer<typeof spanDetailSchema>;

/**
 * Lightweight thread/conversation context — adjacent turns plus position info,
 * for the "previous / next turn" affordance at the top of the drawer.
 */
export const conversationTurnSchema = z.object({
  traceId: z.string(),
  timestamp: z.number(),
  name: z.string(),
  status: z.enum(["ok", "error", "warning"]),
  input: z.string().nullish(),
  output: z.string().nullish(),
});

export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

export const conversationContextSchema = z.object({
  conversationId: z.string(),
  total: z.number(),
  turns: z.array(conversationTurnSchema),
});

export type ConversationContext = z.infer<typeof conversationContextSchema>;

/**
 * OTel resource info per span — separate read path because the standard
 * span mapping drops resource attributes and the instrumentation scope.
 */
export const instrumentationScopeSchema = z.object({
  name: z.string(),
  version: z.string().nullable(),
});

export type InstrumentationScope = z.infer<typeof instrumentationScopeSchema>;

export const spanResourceInfoSchema = z.object({
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  resourceAttributes: z.record(z.string()),
  scope: instrumentationScopeSchema,
});

export type SpanResourceInfoDto = z.infer<typeof spanResourceInfoSchema>;

export const traceResourceInfoSchema = z.object({
  /** The root (or earliest) span used as the trace-level representative. */
  rootSpanId: z.string().nullable(),
  /** Resource attributes from the root span — usually identical across the trace. */
  resourceAttributes: z.record(z.string()),
  /** Instrumentation scope from the root span. */
  scope: instrumentationScopeSchema.nullable(),
  /** Per-span info for the rest of the trace, in case scopes diverge. */
  spans: z.array(spanResourceInfoSchema),
});

export type TraceResourceInfoDto = z.infer<typeof traceResourceInfoSchema>;
