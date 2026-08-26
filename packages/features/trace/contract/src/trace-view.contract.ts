import { z } from "zod";
import { spanTreeNodeSchema, type SpanTreeNode } from "./trace";

export { spanTreeNodeSchema, type SpanTreeNode };

const traceMediaRefSchema = z.object({
  kind: z.enum(["audio", "image", "video", "file"]),
  url: z.string().startsWith("/api/files/"),
  filename: z.string().optional(),
  mimeType: z.string().optional(),
});

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
  /** Context sent to the trace's first model call, rather than a total. */
  contextSizeTokens: z.number().nullable().optional(),
  models: z.array(z.string()),
  labels: z.array(z.string()).default([]),
  promptId: z.string().nullable().optional(),
  promptVersionNumber: z.number().nullable().optional(),
  status: z.enum(["ok", "error", "warning"]),
  spanCount: z.number().int().nonnegative().default(0),
  /** Stored summary payload size in bytes; zero keeps older cached rows valid. */
  sizeBytes: z.number().int().nonnegative().default(0),
  input: z.string().nullable(),
  output: z.string().nullable(),
  /** Winning-span media refs; absent from media-free and older summaries. */
  inputMediaRefs: z.array(traceMediaRefSchema).optional(),
  outputMediaRefs: z.array(traceMediaRefSchema).optional(),
  /** Read-time privacy markers: absent/false means the content is visible. */
  inputRedacted: z.boolean().nullish(),
  outputRedacted: z.boolean().nullish(),
  inputVisibleTo: z.string().nullish(),
  outputVisibleTo: z.string().nullish(),
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

/** Trace drawer header and summary response. */
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
  inputRedacted: z.boolean().nullish(),
  outputRedacted: z.boolean().nullish(),
  inputVisibleTo: z.string().nullish(),
  outputVisibleTo: z.string().nullish(),
  /** Visibility-window redaction drives the drawer's blurred-content treatment. */
  redactedByVisibilityWindow: z.boolean().optional(),
  models: z.array(z.string()),
  /** Provider-side cost. Billed token spend is totalCost minus nonBilledCost. */
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
  /** Trace-summary prompt rollup; selected and last-used may intentionally differ. */
  containsPrompt: z.boolean().default(false),
  selectedPromptId: z.string().nullable().default(null),
  selectedPromptSpanId: z.string().nullable().default(null),
  lastUsedPromptId: z.string().nullable().default(null),
  lastUsedPromptVersionNumber: z.number().nullable().default(null),
  lastUsedPromptVersionId: z.string().nullable().default(null),
  lastUsedPromptSpanId: z.string().nullable().default(null),
  attributes: z.record(z.string(), z.string()),
  /** Categories permanently removed by ingestion privacy policy. */
  privacy: z.object({ droppedCategories: z.array(z.string()).optional() }).nullish(),
});

export type TraceHeader = z.infer<typeof traceHeaderSchema>;

/** Server-detected LangWatch attribute-prefix buckets for a span. */
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

export const CONTENT_PRIVACY_STATES = ["visible", "restricted", "dropped"] as const;

const categoryPrivacySchema = z.object({
  state: z.enum(CONTENT_PRIVACY_STATES),
  visibleTo: z.string().nullable(),
});

/** Per-category read-time content privacy state for a span. */
export const contentPrivacySchema = z.object({
  input: categoryPrivacySchema,
  output: categoryPrivacySchema,
  system: categoryPrivacySchema,
  tools: categoryPrivacySchema,
});

export type CategoryPrivacy = z.infer<typeof categoryPrivacySchema>;
export type ContentPrivacy = z.infer<typeof contentPrivacySchema>;

export const restrictedAttributeSchema = z.object({
  pattern: z.string(),
  visibleTo: z.string(),
  canSee: z.boolean(),
});

export type RestrictedAttribute = z.infer<typeof restrictedAttributeSchema>;

/** Full selected-span response for the trace drawer. */
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
  inputRedacted: z.boolean().nullish(),
  outputRedacted: z.boolean().nullish(),
  inputVisibleTo: z.string().nullish(),
  outputVisibleTo: z.string().nullish(),
  /** Per-category markers keep absent content distinct from hidden/dropped content. */
  contentPrivacy: contentPrivacySchema.nullish(),
  /** Strict PII analysis was requested but did not complete. */
  piiAnalysisIncomplete: z.boolean().nullish(),
  restrictedAttributes: z.array(restrictedAttributeSchema).nullish(),
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
  params: z.record(z.string(), z.unknown()).nullish(),
  events: z.array(
    z.object({
      name: z.string(),
      timestampMs: z.number(),
      attributes: z.record(z.string(), z.unknown()),
    }),
  ),
  /** Offered only for an unpriced model with recorded token usage. */
  costSuggestion: z.object({ model: z.string() }).nullish(),
});

export type SpanDetail = z.infer<typeof spanDetailSchema>;

/** Adjacent conversation turns and their position within the conversation. */
export const conversationTurnSchema = z.object({
  traceId: z.string(),
  timestamp: z.number(),
  name: z.string(),
  status: z.enum(["ok", "error", "warning"]),
  input: z.string().nullish(),
  output: z.string().nullish(),
  inputRedacted: z.boolean().nullish(),
  outputRedacted: z.boolean().nullish(),
  inputVisibleTo: z.string().nullish(),
  outputVisibleTo: z.string().nullish(),
  totalTokens: z.number().nullish(),
  totalCost: z.number().nullish(),
});

export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

export const conversationContextSchema = z.object({
  conversationId: z.string(),
  total: z.number(),
  turns: z.array(conversationTurnSchema),
});

export type ConversationContext = z.infer<typeof conversationContextSchema>;

export const instrumentationScopeSchema = z.object({
  name: z.string(),
  version: z.string().nullable(),
});

export type InstrumentationScope = z.infer<typeof instrumentationScopeSchema>;

export const spanResourceInfoSchema = z.object({
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  resourceAttributes: z.record(z.string(), z.string()),
  scope: instrumentationScopeSchema,
});

export type SpanResourceInfoDto = z.infer<typeof spanResourceInfoSchema>;

/** Root representative resources plus per-span scope/resource divergence. */
export const traceResourceInfoSchema = z.object({
  rootSpanId: z.string().nullable(),
  resourceAttributes: z.record(z.string(), z.string()),
  scope: instrumentationScopeSchema.nullable(),
  spans: z.array(spanResourceInfoSchema),
});

export type TraceResourceInfoDto = z.infer<typeof traceResourceInfoSchema>;
