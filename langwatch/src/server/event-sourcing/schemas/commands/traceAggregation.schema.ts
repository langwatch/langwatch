import { z } from "zod";

/**
 * Zod schema for TriggerTraceAggregationCommandData.
 * Matches the TriggerTraceAggregationCommandData interface structure.
 */
export const triggerTraceAggregationCommandDataSchema = z.object({
  tenantId: z.string(),
  traceId: z.string(),
}) satisfies z.ZodType<{
  tenantId: string;
  traceId: string;
}>;

/**
 * Type inferred from the triggerTraceAggregationCommandDataSchema Zod schema.
 */
export type TriggerTraceAggregationCommandData = z.infer<
  typeof triggerTraceAggregationCommandDataSchema
>;
