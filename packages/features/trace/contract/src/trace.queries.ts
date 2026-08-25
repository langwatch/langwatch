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

export type SpanTreeDeltaTransportInput = z.infer<
  typeof spanTreeDeltaTransportInputSchema
>;

/** Transport input plus the resolved authorization capability for the service. */
export const spanTreeDeltaInputSchema = spanTreeDeltaTransportInputSchema.extend({
  canSeeCosts: z.boolean(),
});

export type SpanTreeDeltaInput = z.infer<typeof spanTreeDeltaInputSchema>;
