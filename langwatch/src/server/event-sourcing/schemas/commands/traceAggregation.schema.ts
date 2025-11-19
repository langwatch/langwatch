import { z } from "zod";

/**
 * Command type identifier for trace aggregation trigger command.
 */
export const TRACE_AGGREGATION_TRIGGER_COMMAND_TYPE = "lw.obs.trace_aggregation.trigger" as const;

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

/**
 * All command type identifiers for trace aggregation commands.
 */
export const TRACE_AGGREGATION_COMMAND_TYPES = [
  TRACE_AGGREGATION_TRIGGER_COMMAND_TYPE,
] as const;

/**
 * Type for trace aggregation command type identifiers.
 */
export type TraceAggregationCommandType = (typeof TRACE_AGGREGATION_COMMAND_TYPES)[number];
