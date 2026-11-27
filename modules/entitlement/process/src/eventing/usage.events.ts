import {
  SCENARIO_RUN_GRACE_ENDED_EVENT_TYPE,
  SCENARIO_RUNS_COUNTED_EVENT_TYPE,
  SCENARIO_RUNS_THRESHOLD_REACHED_EVENT_TYPE,
  scenarioRunGraceEndedEventDataSchema,
  scenarioRunsCountedEventDataSchema,
  scenarioRunsThresholdReachedEventDataSchema,
  limitClearedEventDataSchema,
  limitReachedEventDataSchema,
  monthCountedEventDataSchema,
  USAGE_LIMIT_CLEARED_EVENT_TYPE,
  USAGE_LIMIT_REACHED_EVENT_TYPE,
  USAGE_MONTH_COUNTED_EVENT_TYPE,
  USAGE_THRESHOLD_CROSSED_EVENT_TYPE,
  usageMonthSchema,
  usageThresholdCrossedEventDataSchema,
} from "@langwatch/entitlement-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const USAGE_AGGREGATE_TYPE = "entitlement_organization" as const;
export const USAGE_EVENT_VERSION = "2026-10-01" as const;

export const monthCountedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(USAGE_MONTH_COUNTED_EVENT_TYPE),
  version: z.literal(USAGE_EVENT_VERSION),
  data: monthCountedEventDataSchema,
});
export const limitReachedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(USAGE_LIMIT_REACHED_EVENT_TYPE),
  version: z.literal(USAGE_EVENT_VERSION),
  data: limitReachedEventDataSchema,
});
export const limitClearedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(USAGE_LIMIT_CLEARED_EVENT_TYPE),
  version: z.literal(USAGE_EVENT_VERSION),
  data: limitClearedEventDataSchema,
});
export const usageThresholdCrossedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(USAGE_THRESHOLD_CROSSED_EVENT_TYPE),
  version: z.literal(USAGE_EVENT_VERSION),
  data: usageThresholdCrossedEventDataSchema,
});
export const scenarioRunsCountedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SCENARIO_RUNS_COUNTED_EVENT_TYPE),
  version: z.literal(USAGE_EVENT_VERSION),
  data: scenarioRunsCountedEventDataSchema,
});
export const scenarioRunsThresholdReachedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SCENARIO_RUNS_THRESHOLD_REACHED_EVENT_TYPE),
  version: z.literal(USAGE_EVENT_VERSION),
  data: scenarioRunsThresholdReachedEventDataSchema,
});
export const scenarioRunGraceEndedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SCENARIO_RUN_GRACE_ENDED_EVENT_TYPE),
  version: z.literal(USAGE_EVENT_VERSION),
  data: scenarioRunGraceEndedEventDataSchema,
});
export type UsageEvent =
  | z.infer<typeof monthCountedEventSchema>
  | z.infer<typeof limitReachedEventSchema>
  | z.infer<typeof limitClearedEventSchema>
  | z.infer<typeof usageThresholdCrossedEventSchema>
  | z.infer<typeof scenarioRunsCountedEventSchema>
  | z.infer<typeof scenarioRunsThresholdReachedEventSchema>
  | z.infer<typeof scenarioRunGraceEndedEventSchema>;

export const countMonthCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  month: usageMonthSchema,
  occurredAt: z.number().int().nonnegative(),
});
export type CountMonthCommandData = z.infer<typeof countMonthCommandDataSchema>;

export const recordLimitDecisionCommandDataSchema = z.object({
  ...limitReachedEventDataSchema.shape,
  tenantId: z.string().min(1),
  decision: z.enum(["reached", "cleared"]),
});
export type RecordLimitDecisionCommandData = z.infer<typeof recordLimitDecisionCommandDataSchema>;

export const recordUsageWarningCommandDataSchema = z.object({
  ...usageThresholdCrossedEventDataSchema.shape,
  tenantId: z.string().min(1),
});
export type RecordUsageWarningCommandData = z.infer<typeof recordUsageWarningCommandDataSchema>;

export const countScenarioRunsCommandDataSchema = countMonthCommandDataSchema;
export type CountScenarioRunsCommandData = z.infer<typeof countScenarioRunsCommandDataSchema>;

export const recordScenarioRunsThresholdCommandDataSchema = z.object({
  ...scenarioRunsThresholdReachedEventDataSchema.shape,
  tenantId: z.string().min(1),
});
export type RecordScenarioRunsThresholdCommandData = z.infer<
  typeof recordScenarioRunsThresholdCommandDataSchema
>;

export const recordScenarioRunGraceEndedCommandDataSchema = z.object({
  ...scenarioRunGraceEndedEventDataSchema.shape,
  tenantId: z.string().min(1),
});
export type RecordScenarioRunGraceEndedCommandData = z.infer<
  typeof recordScenarioRunGraceEndedCommandDataSchema
>;
