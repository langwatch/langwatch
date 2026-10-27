import type { Named } from "@langwatch/module";
import { z } from "zod";

/** Evaluation's lifecycle facts, which peers react to from their own side (§9). */
export const EVALUATION_LIFECYCLE_PIPELINE_NAME = "evaluation_lifecycle" as const;
export const EVALUATION_LIFECYCLE_AGGREGATE_TYPE = "evaluation_lifecycle" as const;
export const EVALUATION_RAN_EVENT_TYPE = "lw.evaluation.ran" as const;
export const EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE =
  "lw.evaluation.lifecycle_completed" as const;
export const EVALUATION_LIFECYCLE_EVENT_VERSION = "2026-09-30" as const;

/** A person ran an evaluation on a trace by hand. */
const evaluationRanEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  userId: z.string().min(1),
  projectId: z.string().min(1),
});
export interface EvaluationRanEventDataSchema extends Named<
  typeof evaluationRanEventDataSchemaDefinition
> {}
export const evaluationRanEventDataSchema: EvaluationRanEventDataSchema =
  evaluationRanEventDataSchemaDefinition;
export type EvaluationRanEventData = z.infer<typeof evaluationRanEventDataSchema>;

/** An evaluation settled (completed or reported); peers count it from their own side. */
const evaluationLifecycleCompletedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  projectId: z.string().min(1),
  evaluationId: z.string().min(1),
  evaluatorType: z.string().nullish(),
  score: z.number().nullish(),
  passed: z.boolean().nullish(),
});
export interface EvaluationLifecycleCompletedEventDataSchema extends Named<
  typeof evaluationLifecycleCompletedEventDataSchemaDefinition
> {}
export const evaluationLifecycleCompletedEventDataSchema: EvaluationLifecycleCompletedEventDataSchema =
  evaluationLifecycleCompletedEventDataSchemaDefinition;
export type EvaluationLifecycleCompletedEventData = z.infer<
  typeof evaluationLifecycleCompletedEventDataSchema
>;

export const EVALUATION_MONITOR_ERROR_RATE_EXCEEDED_EVENT_TYPE =
  "lw.evaluation.monitor_error_rate_exceeded" as const;

/**
 * Most of an on-message monitor's runs in the last hour settled as an error; recorded once per
 * revision of the monitor (`monitorRevision` is its `updatedAt` in epoch milliseconds).
 */
const evaluationMonitorErrorRateExceededEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  projectId: z.string().min(1),
  monitorId: z.string().min(1),
  monitorRevision: z.number().int().nonnegative(),
  windowMs: z.number().int().positive(),
  runs: z.number().int().positive(),
  errors: z.number().int().nonnegative(),
  /** The most common error message, shortened and with secrets redacted. */
  topError: z.string().nullable(),
});
export interface EvaluationMonitorErrorRateExceededEventDataSchema extends Named<
  typeof evaluationMonitorErrorRateExceededEventDataSchemaDefinition
> {}
export const evaluationMonitorErrorRateExceededEventDataSchema: EvaluationMonitorErrorRateExceededEventDataSchema =
  evaluationMonitorErrorRateExceededEventDataSchemaDefinition;
export type EvaluationMonitorErrorRateExceededEventData = z.infer<
  typeof evaluationMonitorErrorRateExceededEventDataSchema
>;
