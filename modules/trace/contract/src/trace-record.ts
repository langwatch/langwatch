import { z } from "zod";

export type TraceRecordValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | TraceRecordValue[]
  | { [key: string]: TraceRecordValue };

export const traceRecordValueSchema: z.ZodType<TraceRecordValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.undefined(),
    z.array(traceRecordValueSchema),
    z.record(z.string(), traceRecordValueSchema),
  ]),
);

export const traceRecordEventSchema = z.looseObject({
  event_id: z.string(),
  event_type: z.string(),
  project_id: z.string(),
  metrics: z.record(z.string(), z.number()),
  event_details: z.record(z.string(), z.string()),
  trace_id: z.string(),
  timestamps: z.object({
    started_at: z.number(),
    inserted_at: z.number(),
    updated_at: z.number(),
  }),
});

export const traceRecordSpanSchema = z.looseObject({
  span_id: z.string(),
  trace_id: z.string(),
  type: z.string(),
  timestamps: z.object({
    started_at: z.number(),
    first_token_at: z.number().nullish(),
    finished_at: z.number(),
    ignore_timestamps_on_write: z.boolean().nullish(),
  }),
});

/**
 * Portable form of the existing full-trace read.
 *
 * The named fields are the stable domain surface. Loose nested records retain
 * captured model/provider fields without making the Trace contract depend on
 * a transport-specific union for every provider payload.
 */
export const traceRecordSchema = z.looseObject({
  trace_id: z.string(),
  project_id: z.string(),
  metadata: z.record(z.string(), traceRecordValueSchema),
  privacy: z
    .object({
      droppedCategories: z.array(z.string()).optional(),
    })
    .optional(),
  timestamps: z.object({
    started_at: z.number(),
    inserted_at: z.number(),
    updated_at: z.number(),
  }),
  input: z.object({ value: z.string() }).optional(),
  output: z.object({ value: z.string() }).optional(),
  events: z.array(traceRecordEventSchema).optional(),
  spans: z.array(traceRecordSpanSchema),
  redacted_by_visibility_window: z.boolean().optional(),
});

export type TraceRecord = z.infer<typeof traceRecordSchema>;
export type TraceRecordEvent = z.infer<typeof traceRecordEventSchema>;
