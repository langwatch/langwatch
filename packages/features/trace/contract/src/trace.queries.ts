import { z } from "zod";
import { spanTreeCursorSchema } from "./trace";

/** Exact transport input of `tracesV2.spanTreePaginated`. */
export const spanTreeTransportInputSchema = z.object({
  projectId: z.string(),
  traceId: z.string(),
  limit: z.number().int().min(1).max(1000).default(200),
  cursor: spanTreeCursorSchema.optional(),
  occurredAtMs: z.number().int().optional(),
});

export type SpanTreeTransportInput = z.infer<typeof spanTreeTransportInputSchema>;

/** Transport input plus the resolved authorization capability for the service. */
export const spanTreeInputSchema = spanTreeTransportInputSchema.extend({
  canSeeCosts: z.boolean(),
});

export type SpanTreeInput = z.infer<typeof spanTreeInputSchema>;

/** Exact transport input of `tracesV2.spanTreeDelta`. */
export const spanTreeDeltaTransportInputSchema = z.object({
  projectId: z.string(),
  traceId: z.string(),
  sinceUpdatedAtMs: z.number().int().min(0),
  occurredAtMs: z.number().int().optional(),
});

export type SpanTreeDeltaTransportInput = z.infer<typeof spanTreeDeltaTransportInputSchema>;

/** Transport input plus the resolved authorization capability for the service. */
export const spanTreeDeltaInputSchema = spanTreeDeltaTransportInputSchema.extend({
  canSeeCosts: z.boolean(),
});

export type SpanTreeDeltaInput = z.infer<typeof spanTreeDeltaInputSchema>;

export const traceIngestWaitInputSchema = z.object({ projectId: z.string().min(1) }).strict();

export type TraceIngestWaitInput = z.infer<typeof traceIngestWaitInputSchema>;

/** Canonical Trace summary lookup for internal feature callers. */
export const traceSummaryLookupInputSchema = z
  .object({
    projectId: z.string().min(1),
    traceId: z.string().min(1),
  })
  .strict();

export type TraceSummaryLookupInput = z.infer<typeof traceSummaryLookupInputSchema>;

export const traceByIdInputSchema = z
  .object({
    projectId: z.string().min(1),
    traceId: z.string().min(1),
  })
  .strict();

export type TraceByIdInput = z.infer<typeof traceByIdInputSchema>;

export const traceDerivedEventsInputSchema = traceByIdInputSchema.extend({
  occurredAtMs: z.number().int().nonnegative().optional(),
  foldVersion: z.number().int().nonnegative().optional(),
});

export type TraceDerivedEventsInput = z.infer<typeof traceDerivedEventsInputSchema>;
