import { EventSchema } from "@langwatch/eventing";
import {
  COLLECTOR_EVALUATION_RECEIVED_EVENT_TYPE,
  collectorEvaluationReceivedEventDataSchema,
} from "@langwatch/trace-contract";
import { z } from "zod";

/** The evaluations collector bodies carried, one aggregate per trace; evaluation reports them. */
export const TRACE_COLLECTOR_EVALUATIONS_PIPELINE_NAME = "trace_collector_evaluations" as const;
export const TRACE_COLLECTOR_EVALUATION_AGGREGATE_TYPE = "trace_collector_evaluation" as const;
export const TRACE_COLLECTOR_EVALUATIONS_EVENT_VERSION = "2026-10-08" as const;

export const RECORD_COLLECTOR_EVALUATION_COMMAND_TYPE =
  "lw.trace.record_collector_evaluation" as const;

export const recordCollectorEvaluationCommandDataSchema =
  collectorEvaluationReceivedEventDataSchema;
export type RecordCollectorEvaluationCommandData = z.infer<
  typeof recordCollectorEvaluationCommandDataSchema
>;

export const collectorEvaluationReceivedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(COLLECTOR_EVALUATION_RECEIVED_EVENT_TYPE),
  version: z.literal(TRACE_COLLECTOR_EVALUATIONS_EVENT_VERSION),
  data: recordCollectorEvaluationCommandDataSchema,
});
export type CollectorEvaluationReceivedEvent = z.infer<
  typeof collectorEvaluationReceivedEventSchema
>;
