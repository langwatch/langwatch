import { usageUnitSchema } from "@langwatch/entitlement-contract";
import { z } from "zod";

/** Usage's pipeline and the facts it records; peers react to them, none asks `UsageApi` (§3). */
export const USAGE_PIPELINE_NAME = "usage" as const;
export const USAGE_MONTH_COUNTED_EVENT_TYPE = "lw.usage.month_counted" as const;
export const USAGE_LIMIT_REACHED_EVENT_TYPE = "lw.usage.limit_reached" as const;
export const USAGE_LIMIT_CLEARED_EVENT_TYPE = "lw.usage.limit_cleared" as const;

/** A UTC calendar month, `YYYY-MM`, as billing's checkpoints key it. */
export const usageMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const envelope = {
  organizationId: z.string().min(1),
  month: usageMonthSchema,
  occurredAt: z.number().int().nonnegative(),
};

/** The plan's allowance the count was held against; main's 999,999,999 means it caps nothing. */
export const usageLimitSchema = z.object({
  allowance: z.number().int().nonnegative(),
  planName: z.string(),
  unit: usageUnitSchema,
});
export type UsageLimit = z.infer<typeof usageLimitSchema>;

/** The organization's billable events counted for the month; a later count may be lower. */
export const monthCountedEventDataSchema = z.object({
  ...envelope,
  billableEvents: z.number().int().nonnegative(),
  limit: usageLimitSchema,
});
export type MonthCountedEventData = z.infer<typeof monthCountedEventDataSchema>;

/** The plan's allowance as it stood when the decision was taken. */
const limitDecision = {
  ...envelope,
  count: z.number().int().nonnegative(),
  allowance: z.number().int().nonnegative(),
  planName: z.string(),
  unit: usageUnitSchema,
};

/** The month's count reached the plan's allowance; ingest doors refuse until it clears. */
export const limitReachedEventDataSchema = z.object(limitDecision);
export type LimitReachedEventData = z.infer<typeof limitReachedEventDataSchema>;

/** A reached limit no longer holds, after an upgrade or a lower recount. */
export const limitClearedEventDataSchema = z.object(limitDecision);
export type LimitClearedEventData = z.infer<typeof limitClearedEventDataSchema>;
