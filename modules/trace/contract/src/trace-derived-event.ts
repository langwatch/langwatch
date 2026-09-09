import { z } from "zod";

/**
 * Trace-level event shape, derived from a span's OTel events. Read from
 * stored_spans on demand (`getTraceEventsByTraceId`), not hoisted onto the
 * fold — that made folding O(n^2).
 */
export const derivedTraceEventSchema = z.object({
  spanId: z.string(),
  timestamp: z.number(),
  name: z.string(),
  attributes: z.record(z.string(), z.string()),
});

export type DerivedTraceEvent = z.infer<typeof derivedTraceEventSchema>;
