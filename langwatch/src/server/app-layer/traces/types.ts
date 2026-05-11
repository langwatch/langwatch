import { z } from "zod";

export const spanInsertDataSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  parentTraceId: z.string().nullable(),
  parentIsRemote: z.boolean().nullable(),
  sampled: z.boolean(),
  startTimeUnixMs: z.number(),
  endTimeUnixMs: z.number(),
  durationMs: z.number(),
  name: z.string(),
  kind: z.number(),
  resourceAttributes: z.record(z.unknown()),
  spanAttributes: z.record(z.unknown()),
  statusCode: z.number().nullable(),
  statusMessage: z.string().nullable(),
  instrumentationScope: z.object({
    name: z.string(),
    version: z.string().nullable().optional(),
  }),
  events: z.array(
    z.object({
      name: z.string(),
      timeUnixMs: z.number(),
      attributes: z.record(z.unknown()),
    }),
  ),
  links: z.array(
    z.object({
      traceId: z.string(),
      spanId: z.string(),
      attributes: z.record(z.unknown()),
    }),
  ),
  droppedAttributesCount: z.number(),
  droppedEventsCount: z.number(),
  droppedLinksCount: z.number(),
});

export type SpanInsertData = z.infer<typeof spanInsertDataSchema>;

export const traceSummaryDataSchema = z.object({
  traceId: z.string(),
  spanCount: z.number(),
  totalDurationMs: z.number(),
  computedIOSchemaVersion: z.string(),
  computedInput: z.string().nullable(),
  computedOutput: z.string().nullable(),
  timeToFirstTokenMs: z.number().nullable(),
  timeToLastTokenMs: z.number().nullable(),
  tokensPerSecond: z.number().nullable(),
  containsErrorStatus: z.boolean(),
  containsOKStatus: z.boolean(),
  errorMessage: z.string().nullable(),
  models: z.array(z.string()),
  totalCost: z.number().nullable(),
  tokensEstimated: z.boolean(),
  totalPromptTokenCount: z.number().nullable(),
  totalCompletionTokenCount: z.number().nullable(),
  outputFromRootSpan: z.boolean(),
  outputSpanEndTimeMs: z.number(),
  blockedByGuardrail: z.boolean(),
  rootSpanType: z.string().nullable(),
  containsAi: z.boolean(),
  containsPrompt: z.boolean(),
  selectedPromptId: z.string().nullable(),
  selectedPromptSpanId: z.string().nullable(),
  /** Tracks the latest source span's startTimeUnixMs — internal bookkeeping
   * to disambiguate which span won the "latest" race. Not surfaced. */
  selectedPromptStartTimeMs: z.number().nullable(),
  lastUsedPromptId: z.string().nullable(),
  lastUsedPromptVersionNumber: z.number().nullable(),
  lastUsedPromptVersionId: z.string().nullable(),
  lastUsedPromptSpanId: z.string().nullable(),
  lastUsedPromptStartTimeMs: z.number().nullable(),
  topicId: z.string().nullable(),
  subTopicId: z.string().nullable(),
  annotationIds: z.array(z.string()),
  attributes: z.record(z.string()),
  scenarioRoleCosts: z.record(z.string(), z.number()).optional(),
  scenarioRoleLatencies: z.record(z.string(), z.number()).optional(),
  scenarioRoleSpans: z.record(z.string(), z.string()).optional(),
  /** Per-span costs for retroactive role assignment when parent arrives after children. Internal bookkeeping. */
  spanCosts: z.record(z.string(), z.number()).optional(),
  traceName: z.string(),
  /** Start time of the root span that set traceName, used for deterministic tie-breaking when multiple root spans exist. Internal bookkeeping. */
  rootSpanStartTimeMs: z.number().optional(),
  /** LangWatch SDK events hoisted from spans during fold projection. */
  events: z
    .array(
      z.object({
        spanId: z.string(),
        timestamp: z.number(),
        name: z.string(),
        attributes: z.record(z.string(), z.string()),
      }),
    )
    .optional(),
  occurredAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  LastEventOccurredAt: z.number(),
  /**
   * Span IDs known to be part of an evaluator (or otherwise downstream
   * causality) subtree on this trace. A span enters the set when its
   * own `langwatch.causality_depth` attribute is >= 1 OR when its
   * parent_span_id is already in the set. The evaluationTrigger reactor
   * consults this to skip dispatching evaluations for spans that come
   * from an evaluator workflow, breaking the eval-of-eval loop. See
   * specs/monitors/online-evaluator-loop-prevention.feature.
   *
   * Optional for back-compat with older fold snapshots.
   */
  causalSubtreeSpans: z.array(z.string()).optional(),
});

export type TraceSummaryData = z.infer<typeof traceSummaryDataSchema>;
