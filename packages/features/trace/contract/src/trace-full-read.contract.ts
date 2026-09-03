import { z } from "zod";
import { traceRecordValueSchema } from "./trace-record";

/**
 * Captured input and output values in a full Trace read.
 *
 * Values intentionally remain JSON-shaped: provider-specific message and tool
 * payloads are part of the captured trace, not a transport-owned union.
 */
export const traceFullContentSchema = z.looseObject({
  type: z.string().optional(),
  value: traceRecordValueSchema,
});

export const traceFullRecordSpanSchema = z.looseObject({
  span_id: z.string(),
  trace_id: z.string(),
  parent_id: z.string().nullable().optional(),
  type: z.string(),
  name: z.string().nullish(),
  timestamps: z.object({
    started_at: z.number(),
    finished_at: z.number(),
  }),
  input: traceFullContentSchema.nullish(),
  output: traceFullContentSchema.nullish(),
  generated: traceRecordValueSchema.optional(),
  params: z.record(z.string(), traceRecordValueSchema).nullish(),
  contexts: z.array(traceRecordValueSchema).nullish(),
  metrics: z.record(z.string(), traceRecordValueSchema).nullish(),
  error: z.looseObject({ message: z.string().optional() }).nullish(),
});

export type TraceFullRecordSpan = z.infer<typeof traceFullRecordSpanSchema>;

export const traceFullRecordEventSchema = z.looseObject({
  event_id: z.string(),
  event_type: z.string(),
  project_id: z.string(),
  trace_id: z.string(),
  metrics: z.record(z.string(), z.number()),
  event_details: z.record(z.string(), z.string()),
  timestamps: z.object({
    started_at: z.number(),
    inserted_at: z.number(),
    updated_at: z.number(),
  }),
});

export type TraceFullRecordEvent = z.infer<typeof traceFullRecordEventSchema>;

/**
 * Trace-owned full capture for internal readers.
 *
 * This is an internal read with process-owned visibility; it is not a browser
 * DTO and must not be supplied with caller-selected protections.
 */
export const traceFullRecordSchema = z.looseObject({
  trace_id: z.string(),
  project_id: z.string(),
  metadata: z.record(z.string(), traceRecordValueSchema),
  timestamps: z.object({
    started_at: z.number(),
    inserted_at: z.number(),
    updated_at: z.number().optional(),
  }),
  input: traceFullContentSchema.nullish(),
  output: traceFullContentSchema.nullish(),
  error: z.looseObject({ message: z.string().optional() }).nullish(),
  privacy: z
    .object({
      droppedCategories: z.array(z.string()).optional(),
    })
    .optional(),
  metrics: z.record(z.string(), traceRecordValueSchema).nullish(),
  spans: z.array(traceFullRecordSpanSchema),
  events: z.array(traceFullRecordEventSchema).optional(),
});

export type TraceFullRecord = z.infer<typeof traceFullRecordSchema>;

/** Exact identity plus an optional storage-anchor hint for a full Trace read. */
export const traceFullReadInputSchema = z
  .object({
    tenantId: z.string().min(1),
    traceId: z.string().min(1),
    occurredAtMs: z.number().int().nonnegative().optional(),
  })
  .strict();

export type TraceFullReadInput = z.infer<typeof traceFullReadInputSchema>;

/** Thread reads are complete captures and return chronological traces. */
export const traceFullThreadReadInputSchema = z
  .object({
    tenantId: z.string().min(1),
    threadId: z.string().min(1),
  })
  .strict();

export type TraceFullThreadReadInput = z.infer<typeof traceFullThreadReadInputSchema>;
