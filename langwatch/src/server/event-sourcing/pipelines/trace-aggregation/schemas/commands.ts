import { z } from "zod";

export type { TraceAggregationCommandType } from "./typeIdentifiers";
export {
  TRACE_AGGREGATION_TRIGGER_COMMAND_TYPE,
  TRACE_AGGREGATION_COMMAND_TYPES,
} from "./typeIdentifiers";

/**
 * Zod schema for TriggerTraceAggregationCommandData.
 * Matches the TriggerTraceAggregationCommandData interface structure.
 */
export const triggerTraceAggregationCommandDataSchema = z.object({
  tenantId: z.string(),
  traceId: z.string(),
  spanId: z.string(),
});

/**
 * Type inferred from the triggerTraceAggregationCommandDataSchema Zod schema.
 */
export type TriggerTraceAggregationCommandData = z.infer<
  typeof triggerTraceAggregationCommandDataSchema
>;
