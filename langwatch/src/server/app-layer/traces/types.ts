import { z } from "zod";

// ---------------------------------------------------------------------------
// Span Insert (write path)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Trace Summary (write + read)
// ---------------------------------------------------------------------------

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
  satisfactionScore: z.number().nullable(),
  topicId: z.string().nullable(),
  subTopicId: z.string().nullable(),
  hasAnnotation: z.boolean().nullable(),
  attributes: z.record(z.string()),
  occurredAt: z.number(),
  createdAt: z.number(),
  lastUpdatedAt: z.number(),
});

export type TraceSummaryData = z.infer<typeof traceSummaryDataSchema>;
