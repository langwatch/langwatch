import {
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
export type UsageEvent =
  | z.infer<typeof monthCountedEventSchema>
  | z.infer<typeof limitReachedEventSchema>
  | z.infer<typeof limitClearedEventSchema>
  | z.infer<typeof usageThresholdCrossedEventSchema>;

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
