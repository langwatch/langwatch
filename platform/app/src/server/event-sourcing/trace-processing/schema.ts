import { z } from "zod";
import { metricKindSchema } from "../metric-processing/schema";

/**
 * The `trace` aggregate's payloads — what crosses `event_log`, not raw OTLP.
 * Normalization, PII redaction and cost enrichment run upstream, before
 * `recordSpan` sees the input.
 */

export const piiRedactionLevelSchema = z.enum([
  "STRICT",
  "ESSENTIAL",
  "DISABLED",
]);
export type PIIRedactionLevel = z.infer<typeof piiRedactionLevelSchema>;
export const DEFAULT_PII_REDACTION_LEVEL: PIIRedactionLevel = "ESSENTIAL";

export const piiRedactionStatusSchema = z.enum(["partial", "none"]);
export type PIIRedactionStatus = z.infer<typeof piiRedactionStatusSchema>;

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
 * Zero, `0.0` and `false` are reported values and decode as themselves, never
 * as absence (specs/trace-processing/zero-valued-attribute-ingestion.feature).
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
 * `cost` is the total; `nonBilledCost` is the portion a flat plan covers, so
 * `cost - nonBilledCost` is what bills
 * (specs/trace-processing/codex-bundled-cost.feature). Rounded once, upstream.
 */
export const spanCostSchema = z.object({
  cost: z.number().nullable(),
  nonBilledCost: z.number().nullable(),
});
export type SpanCost = z.infer<typeof spanCostSchema>;

/** A field is `null` only when the SDK never reported it, never when it reported zero. */
export const spanUsageSchema = z.object({
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  reasoningTokens: z.number().nullable(),
  cacheReadTokens: z.number().nullable(),
  cacheWriteTokens: z.number().nullable(),
  estimated: z.boolean(),
});
export type SpanUsage = z.infer<typeof spanUsageSchema>;

/** Text extraction is `TraceIOExtractionService`'s job; a fold only picks a winner. */
export const spanIOSchema = z.object({
  inputText: z.string().nullable(),
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
  exceptionMessage: z.string().nullable(),

  attributes: attributeMapSchema,
  resourceAttributes: attributeMapSchema,
  instrumentationScopeName: z.string(),
  instrumentationScopeVersion: z.string().nullable(),

  events: z.array(canonicalSpanEventSchema),
  links: z.array(canonicalSpanLinkSchema),

  spanType: z.string().nullable(),
  /** `gen_ai.response.model` if present, else `gen_ai.request.model`. */
  model: z.string().nullable(),
  usage: spanUsageSchema,
  cost: spanCostSchema,
  io: spanIOSchema,
  timeToFirstTokenMs: z.number().nullable(),
  timeToLastTokenMs: z.number().nullable(),

  prompt: z
    .object({
      promptId: z.string(),
      versionId: z.string().nullable(),
      versionNumber: z.number().nullable(),
    })
    .nullable(),

  piiRedactionLevel: piiRedactionLevelSchema,
  /** Set only when an attribute exceeded the PII scan's max length. */
  piiRedactionStatus: piiRedactionStatusSchema.nullable(),

  occurredAt: z.number().int().nonnegative(),
  acceptedAt: z.number().int().nonnegative(),
});
export type CanonicalSpan = z.infer<typeof canonicalSpanSchema>;

export const topicAssignmentSchema = z.object({
  traceId: z.string(),
  topicId: z.string().nullable(),
  topicName: z.string().nullable(),
  subtopicId: z.string().nullable(),
  subtopicName: z.string().nullable(),
  isIncremental: z.boolean(),
  /**
   * Stamped by the assigner when the classification was decided — our own
   * boundary's clock, so a stale re-run racing a fresher manual assignment can
   * never win (ADR-098 §4).
   */
  assignedAt: z.number().int().nonnegative(),
});
export type TopicAssignment = z.infer<typeof topicAssignmentSchema>;

export const originResolutionSchema = z.object({
  traceId: z.string(),
  origin: z.string(),
  reason: z.string(),
});
export type OriginResolution = z.infer<typeof originResolutionSchema>;

/** `actedAt` is stamped by the command layer when the user acts, so add and remove are one lattice. */
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

export const TRACE_NAME_MIN_LENGTH = 1;
export const TRACE_NAME_MAX_LENGTH = 200;

export const traceNameChangeSchema = z.object({
  traceId: z.string(),
  newName: z.string().min(TRACE_NAME_MIN_LENGTH).max(TRACE_NAME_MAX_LENGTH),
  changedByUserId: z.string().nullable(),
  /** The rename's own stamp, set by the command layer — the LWW ordering key. */
  changedAt: z.number().int().nonnegative(),
});
export type TraceNameChange = z.infer<typeof traceNameChangeSchema>;

/**
 * Bridged from `log-processing`: `log` is keyed by recordId and `trace` by
 * traceId, so it crosses via a command bridge (ADR-098 decision 9).
 */
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

/**
 * Bridged from `metric-processing`, whose aggregate id is the point's content
 * hash — so the kind is that pipeline's, not a second enum. The local copy had
 * drifted to `counter | gauge | histogram | summary`, which cannot represent
 * the `sum` and `exponential_histogram` OTLP actually sends, so a correlation
 * for either would have been rejected on the way in.
 */
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

/** All-zero hex is a "null" sentinel in tracing systems, not a real id. */
const ALL_ZERO_HEX = /^0+$/;

export function isValidMetricCorrelation(data: MetricCorrelation): boolean {
  return (
    /^[a-f0-9]{32}$/i.test(data.traceId) &&
    !ALL_ZERO_HEX.test(data.traceId) &&
    /^[a-f0-9]{16}$/i.test(data.spanId) &&
    !ALL_ZERO_HEX.test(data.spanId)
  );
}
