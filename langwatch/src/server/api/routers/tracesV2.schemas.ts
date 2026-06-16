import { z } from "zod";

// ---------------------------------------------------------------------------
// Scoped output models – one per drawer use-case
// ---------------------------------------------------------------------------

/**
 * Trace list row shape returned by `tracesV2.list`. Defaults are wide because
 * older callers / replayed cached responses may pre-date newer fields — falling
 * back keeps consumers safe instead of throwing on a fresh deploy.
 */
const traceListItemSchema = z.object({
  traceId: z.string(),
  timestamp: z.number(),
  name: z.string(),
  serviceName: z.string(),
  durationMs: z.number(),
  totalCost: z.number(),
  totalTokens: z.number(),
  inputTokens: z.number().nullable().optional(),
  outputTokens: z.number().nullable().optional(),
  cacheReadTokens: z.number().nullable().optional(),
  cacheCreationTokens: z.number().nullable().optional(),
  reasoningTokens: z.number().nullable().optional(),
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
  traceName: z.string().optional(),
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
const traceHeaderSchema = z.object({
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
  // Set when a restrict privacy rule hides the content from this viewer, so the
  // header shows a labeled placeholder instead of nothing.
  inputRedacted: z.boolean().nullish(),
  outputRedacted: z.boolean().nullish(),
  inputVisibleTo: z.string().nullish(),
  outputVisibleTo: z.string().nullish(),
  // True when input/output/error were teaser-redacted by the plan's
  // visibility window — drives the blurred-content upgrade treatment.
  redactedByVisibilityWindow: z.boolean().optional(),
  models: z.array(z.string()),
  /**
   * Grand list-price cost of the trace (sum of span costs). LangWatch bills
   * per captured event, not per token — `totalCost` is the customer's
   * provider-side spend. `nonBilledCost` is the bundled (theoretical) portion
   * of it (non-zero only when the trace's tool runs on a bundled plan); the
   * amount actually billed per token is `totalCost - nonBilledCost`.
   */
  totalCost: z.number().nullable(),
  nonBilledCost: z.number().default(0),
  totalTokens: z.number(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  tokensEstimated: z.boolean(),
  ttft: z.number().nullish(),
  traceName: z.string(),
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
  /**
   * Read-time privacy markers for the trace. `droppedCategories` lists content
   * categories (`input` / `output`) that a `drop` data-privacy policy stripped
   * at ingestion, so the drawer can surface the "dropped, cannot be recovered"
   * banner. Absent/null when nothing was dropped.
   */
  privacy: z
    .object({ droppedCategories: z.array(z.string()).optional() })
    .nullish(),
});

export type TraceHeader = z.infer<typeof traceHeaderSchema>;

/**
 * Span tree node: lightweight per-span data for waterfall / flame / span-list.
 * Returned by `tracesV2.spanTree`.
 */
const spanTreeNodeSchema = z.object({
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  name: z.string(),
  type: z.string().nullable(),
  startTimeMs: z.number(),
  endTimeMs: z.number(),
  durationMs: z.number(),
  status: z.enum(["ok", "error", "unset"]),
  model: z.string().nullable(),
  /**
   * USD cost — `gen_ai.usage.cost` when the SDK reported one, otherwise
   * computed server-side from token counts × model pricing (same cascade
   * the trace-level fold uses). Null when neither yields a value.
   * `.nullish()` so older clients (or sample fixtures) that don't set
   * the field at all stay compatible; readers should treat `undefined`
   * and `null` identically.
   */
  cost: z.number().nullish(),
  /** Token usage counts — surfaced so the waterfall's model pill can
   * show the input/output/cache breakdown without a spanDetail call. */
  inputTokens: z.number().nullish(),
  outputTokens: z.number().nullish(),
  cacheReadTokens: z.number().nullish(),
  cacheCreationTokens: z.number().nullish(),
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
  // Set when a restrict privacy rule hides the content from this viewer, so the
  // drawer shows a labeled placeholder instead of nothing. `*VisibleTo` is the
  // human audience label ("Admins, Security group" or "no one").
  inputRedacted: z.boolean().nullish(),
  outputRedacted: z.boolean().nullish(),
  inputVisibleTo: z.string().nullish(),
  outputVisibleTo: z.string().nullish(),
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
  /**
   * Present when the span names a model and carries token usage but nothing
   * (custom rule or static registry) prices it, the UI offers to create a
   * model cost mapping for `model`. Only computed by `spanDetail`.
   */
  costSuggestion: z.object({ model: z.string() }).nullish(),
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
