import { z } from "zod";

/**
 * The `trace` aggregate's event/command payloads — what crosses `event_log`,
 * not raw OTLP. Normalization, PII redaction and cost enrichment all run in
 * `canonicalizeSpan.ts` before `recordSpan` sees the input.
 */

// ---------------------------------------------------------------------------
// The canonical span (recordSpan's input / spanReceived's data)
// ---------------------------------------------------------------------------

export const piiRedactionLevelSchema = z.enum(["STRICT", "ESSENTIAL", "DISABLED"]);
export type PIIRedactionLevel = z.infer<typeof piiRedactionLevelSchema>;
export const DEFAULT_PII_REDACTION_LEVEL: PIIRedactionLevel = "ESSENTIAL";

export const piiRedactionStatusSchema = z.enum(["partial", "none"]);
export type PIIRedactionStatus = z.infer<typeof piiRedactionStatusSchema>;

/** OTel SpanKind, both the numeric wire enum and normalized here to a name. */
export const spanKindSchema = z.enum([
  "UNSPECIFIED",
  "INTERNAL",
  "SERVER",
  "CLIENT",
  "PRODUCER",
  "CONSUMER",
]);
export type SpanKind = z.infer<typeof spanKindSchema>;

export const spanStatusCodeSchema = z.enum(["UNSET", "OK", "ERROR"]);
export type SpanStatusCode = z.infer<typeof spanStatusCodeSchema>;

/**
 * An attribute value after OTLP `AnyValue` flattening. Zero, `0.0` and
 * `false` are legitimate reported values and must decode as themselves, never
 * as absence (specs/trace-processing/zero-valued-attribute-ingestion.feature)
 * — this schema does not special-case any of them because a plain
 * `z.union` already round-trips a JS `0`/`false` without coercion; the
 * discipline lives in `canonicalizeSpan.ts`'s *extraction* helpers, which
 * must read a reported zero as present rather than skip it as falsy.
 */
export const attributeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);
export type AttributeValue = z.infer<typeof attributeValueSchema>;

export const attributeMapSchema = z.record(z.string(), attributeValueSchema);
export type AttributeMap = z.infer<typeof attributeMapSchema>;

export const canonicalSpanEventSchema = z.object({
  name: z.string(),
  timeUnixMs: z.number().int().nonnegative(),
  attributes: attributeMapSchema,
});
export type CanonicalSpanEvent = z.infer<typeof canonicalSpanEventSchema>;

export const canonicalSpanLinkSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  attributes: attributeMapSchema,
});
export type CanonicalSpanLink = z.infer<typeof canonicalSpanLinkSchema>;

/**
 * The per-span cost split. `cost` is the total; `nonBilledCost` is the
 * portion covered by a flat plan (the `langwatch.cost.non_billable` marker —
 * Claude Code subscription usage, codex bundled usage) so `cost -
 * nonBilledCost` is what actually bills
 * (specs/trace-processing/codex-bundled-cost.feature). Cost is rounded once,
 * by `canonicalizeSpan.ts`, never again by a fold — re-rounding every step
 * makes trace-level sums order-dependent.
 */
export const spanCostSchema = z.object({
  cost: z.number().nullable(),
  nonBilledCost: z.number().nullable(),
});
export type SpanCost = z.infer<typeof spanCostSchema>;

/**
 * Token usage, zero-safe throughout
 * (specs/trace-processing/zero-valued-attribute-ingestion.feature): a field
 * is `null` only when the SDK never reported it at all, never when it
 * reported zero. `canonicalizeSpan.ts` is the only place these are read off
 * raw attributes; the fold never re-parses an attribute bag for them.
 */
export const spanUsageSchema = z.object({
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  reasoningTokens: z.number().nullable(),
  cacheReadTokens: z.number().nullable(),
  cacheWriteTokens: z.number().nullable(),
  /** True when at least one of the above was estimated (tiktoken) rather than SDK-reported. */
  estimated: z.boolean(),
});
export type SpanUsage = z.infer<typeof spanUsageSchema>;

/**
 * A span's contribution to trace-level IO. Text extraction is
 * `TraceIOExtractionService`'s job; the fold only decides which span's
 * already-extracted text wins trace-wide.
 */
export const spanIOSchema = z.object({
  inputText: z.string().nullable(),
  /** `true` when `inputText` came from `gen_ai.input.messages`/`langwatch.input` explicitly. */
  inputIsExplicit: z.boolean(),
  outputText: z.string().nullable(),
  outputIsExplicit: z.boolean(),
});
export type SpanIO = z.infer<typeof spanIOSchema>;

export const canonicalSpanSchema = z.object({
  tenantId: z.string(),

  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().nullable(),

  name: z.string(),
  kind: spanKindSchema,

  startTimeUnixMs: z.number().int().nonnegative(),
  endTimeUnixMs: z.number().int().nonnegative(),

  statusCode: spanStatusCodeSchema,
  statusMessage: z.string().nullable(),
  /** The newest `exception` span event's `exception.message`, if any — see
   * `spanDerivation.ts`'s error-message rank 3. */
  exceptionMessage: z.string().nullable(),

  /** Flattened, dedup'd, capped (256 KiB/value) attribute map — span-scoped. */
  attributes: attributeMapSchema,
  /** Flattened resource attributes — same span, resource-scoped. */
  resourceAttributes: attributeMapSchema,
  instrumentationScopeName: z.string(),
  instrumentationScopeVersion: z.string().nullable(),

  events: z.array(canonicalSpanEventSchema),
  links: z.array(canonicalSpanLinkSchema),

  /** The `langwatch.span.type` attribute, already extracted — `null` when absent. */
  spanType: z.string().nullable(),
  /** `gen_ai.response.model` if present, else `gen_ai.request.model`. */
  model: z.string().nullable(),
  usage: spanUsageSchema,
  cost: spanCostSchema,
  io: spanIOSchema,
  /** Milliseconds from span start to first token, already resolved through
   * the stream-event/attribute/`langwatch.timestamps` fallback ladder
   * (specs/trace-processing/sdk-timing-and-metrics-canonicalisation.feature). */
  timeToFirstTokenMs: z.number().nullable(),
  timeToLastTokenMs: z.number().nullable(),

  /** A prompt (LangWatch Prompt Management) this span used, if any. */
  prompt: z
    .object({
      promptId: z.string(),
      versionId: z.string().nullable(),
      versionNumber: z.number().nullable(),
    })
    .nullable(),

  piiRedactionLevel: piiRedactionLevelSchema,
  /** Set only when at least one attribute exceeded the PII scan's max length. */
  piiRedactionStatus: piiRedactionStatusSchema.nullable(),

  occurredAt: z.number().int().nonnegative(),
  acceptedAt: z.number().int().nonnegative(),
});
export type CanonicalSpan = z.infer<typeof canonicalSpanSchema>;

// ---------------------------------------------------------------------------
// Topic assignment
// ---------------------------------------------------------------------------

export const topicAssignmentSchema = z.object({
  traceId: z.string(),
  topicId: z.string().nullable(),
  topicName: z.string().nullable(),
  subtopicId: z.string().nullable(),
  subtopicName: z.string().nullable(),
  isIncremental: z.boolean(),
  /**
   * Stamped by the assigner (the topic-clustering job, or the manual
   * assignment service) at the moment the classification decision was made —
   * our own boundary's clock, not the customer's. LWW ordering for
   * `topicId`/`subTopicId` uses this, never `occurredAt`, so a stale
   * clustering re-run racing a fresher manual assignment can never win
   * (ADR-098 §4).
   */
  assignedAt: z.number().int().nonnegative(),
});
export type TopicAssignment = z.infer<typeof topicAssignmentSchema>;

// ---------------------------------------------------------------------------
// Origin resolution
// ---------------------------------------------------------------------------

export const originResolutionSchema = z.object({
  traceId: z.string(),
  origin: z.string(),
  reason: z.string(),
});
export type OriginResolution = z.infer<typeof originResolutionSchema>;

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

/**
 * `actedAt` is stamped by the command layer when the user acts — our
 * boundary, not the customer's — so `applyAnnotationChange` can be genuine
 * last-write-wins rather than an add/remove asymmetry.
 */
export const annotationRefSchema = z.object({
  traceId: z.string(),
  annotationId: z.string(),
  actedAt: z.number().int().nonnegative(),
});
export type AnnotationRef = z.infer<typeof annotationRefSchema>;

export const annotationsBulkSyncSchema = z.object({
  traceId: z.string(),
  annotationIds: z.array(z.string()),
  actedAt: z.number().int().nonnegative(),
});
export type AnnotationsBulkSync = z.infer<typeof annotationsBulkSyncSchema>;

// ---------------------------------------------------------------------------
// Trace name
// ---------------------------------------------------------------------------

export const TRACE_NAME_MIN_LENGTH = 1;
export const TRACE_NAME_MAX_LENGTH = 200;

export const traceNameChangeSchema = z.object({
  traceId: z.string(),
  newName: z.string().min(TRACE_NAME_MIN_LENGTH).max(TRACE_NAME_MAX_LENGTH),
  changedByUserId: z.string().nullable(),
});
export type TraceNameChange = z.infer<typeof traceNameChangeSchema>;

// ---------------------------------------------------------------------------
// Log contribution (bridged from log-processing — ADR-098 decision 9: keys
// differ (log's aggregate is `log`, keyed by recordId; trace's is `trace`,
// keyed by traceId), so this crosses via a command bridge, never a direct
// subscription.
// ---------------------------------------------------------------------------

export const logContributionSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  recordId: z.string(),
  timeUnixMs: z.number().int().nonnegative(),
  severityNumber: z.number().int().min(0).max(255),
  severityText: z.string(),
  body: z.string(),
  attributes: attributeMapSchema,
  resourceAttributes: attributeMapSchema,
  scopeName: z.string(),
  scopeVersion: z.string().nullable(),
  piiRedactionLevel: piiRedactionLevelSchema,
});
export type LogContribution = z.infer<typeof logContributionSchema>;

// ---------------------------------------------------------------------------
// Metric correlation (bridged from metric-processing — same reasoning: the
// metric aggregate is keyed by the point's own content hash, trace by
// traceId, so a command bridge re-keys onto trace's FIFO lane).
// ---------------------------------------------------------------------------

export const metricKindSchema = z.enum(["counter", "gauge", "histogram", "summary"]);
export type MetricKind = z.infer<typeof metricKindSchema>;

export const metricCorrelationSchema = z.object({
  traceId: z.string().regex(/^[a-f0-9]{32}$/i),
  spanId: z.string().regex(/^[a-f0-9]{16}$/i),
  pointId: z.string().regex(/^[a-f0-9]{64}$/),
  seriesId: z.string().regex(/^[a-f0-9]{64}$/),
  metricName: z.string(),
  metricUnit: z.string(),
  metricKind: metricKindSchema,
  exemplarValue: z.number().nullable(),
  exemplarTimeUnixMs: z.number().int().nonnegative(),
});
export type MetricCorrelation = z.infer<typeof metricCorrelationSchema>;

/**
 * All-zero-hex is a "null" sentinel in tracing systems, not a real id.
 * `recordMetricCorrelation` drops such a correlation, emitting no event.
 */
const ALL_ZERO_HEX = /^0+$/;

export function isValidMetricCorrelation(data: MetricCorrelation): boolean {
  return (
    /^[a-f0-9]{32}$/i.test(data.traceId) &&
    !ALL_ZERO_HEX.test(data.traceId) &&
    /^[a-f0-9]{16}$/i.test(data.spanId) &&
    !ALL_ZERO_HEX.test(data.spanId)
  );
}
