import {
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  EVALUATION_LIFECYCLE_EVENT_VERSION,
  EVALUATION_MONITOR_ERROR_RATE_EXCEEDED_EVENT_TYPE,
  EVALUATION_RAN_EVENT_TYPE,
  evaluationLifecycleCompletedEventDataSchema,
  evaluationMonitorErrorRateExceededEventDataSchema,
  evaluationRanEventDataSchema,
} from "@langwatch/evaluation-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const RECORD_EVALUATION_RAN_COMMAND_TYPE = "lw.evaluation.record_ran" as const;
export const RECORD_EVALUATION_LIFECYCLE_COMPLETED_COMMAND_TYPE =
  "lw.evaluation.record_lifecycle_completed" as const;
export const RECORD_MONITOR_ERROR_RATE_EXCEEDED_COMMAND_TYPE =
  "lw.evaluation.record_monitor_error_rate_exceeded" as const;

export const recordEvaluationRanCommandDataSchema = evaluationRanEventDataSchema;
export type RecordEvaluationRanCommandData = z.infer<typeof recordEvaluationRanCommandDataSchema>;

export const recordEvaluationLifecycleCompletedCommandDataSchema =
  evaluationLifecycleCompletedEventDataSchema;
export type RecordEvaluationLifecycleCompletedCommandData = z.infer<
  typeof recordEvaluationLifecycleCompletedCommandDataSchema
>;

export const evaluationRanEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(EVALUATION_RAN_EVENT_TYPE),
  version: z.literal(EVALUATION_LIFECYCLE_EVENT_VERSION),
  data: evaluationRanEventDataSchema,
});
export type EvaluationRanEvent = z.infer<typeof evaluationRanEventSchema>;

export const evaluationLifecycleCompletedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE),
  version: z.literal(EVALUATION_LIFECYCLE_EVENT_VERSION),
  data: evaluationLifecycleCompletedEventDataSchema,
});
export type EvaluationLifecycleCompletedEvent = z.infer<
  typeof evaluationLifecycleCompletedEventSchema
>;

export const recordMonitorErrorRateExceededCommandDataSchema =
  evaluationMonitorErrorRateExceededEventDataSchema;
export type RecordMonitorErrorRateExceededCommandData = z.infer<
  typeof recordMonitorErrorRateExceededCommandDataSchema
>;

export const evaluationMonitorErrorRateExceededEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(EVALUATION_MONITOR_ERROR_RATE_EXCEEDED_EVENT_TYPE),
  version: z.literal(EVALUATION_LIFECYCLE_EVENT_VERSION),
  data: evaluationMonitorErrorRateExceededEventDataSchema,
});
export type EvaluationMonitorErrorRateExceededEvent = z.infer<
  typeof evaluationMonitorErrorRateExceededEventSchema
>;

export type EvaluationLifecycleEvent =
  | EvaluationRanEvent
  | EvaluationLifecycleCompletedEvent
  | EvaluationMonitorErrorRateExceededEvent;
