import type { Named } from "@langwatch/module";
import { z } from "zod";

import { usageUnitSchema } from "./usage.ts";

/** The metering pipeline and the facts it records; peers subscribe to them, none asks (§3).
 * Stored as `lw.usage.*` before the rename; the pipeline upcasts those (Alex, 2026-10-06). */
export const USAGE_PIPELINE_NAME = "entitlement" as const;
export const USAGE_MONTH_COUNTED_EVENT_TYPE = "lw.entitlement.month_counted" as const;
export const USAGE_LIMIT_REACHED_EVENT_TYPE = "lw.entitlement.limit_reached" as const;
export const USAGE_LIMIT_CLEARED_EVENT_TYPE = "lw.entitlement.limit_cleared" as const;
export const USAGE_THRESHOLD_CROSSED_EVENT_TYPE = "lw.entitlement.usage_threshold_crossed" as const;

/** A UTC calendar month, `YYYY-MM`, as billing's checkpoints key it. */
export const usageMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const envelope = {
  organizationId: z.string().min(1),
  month: usageMonthSchema,
  occurredAt: z.number().int().nonnegative(),
};

/** The plan's allowance the count was held against; main's 999,999,999 means it caps nothing. */
const usageLimitSchemaDefinition = z.object({
  allowance: z.number().int().nonnegative(),
  planName: z.string(),
  unit: usageUnitSchema,
});
export interface UsageLimitSchema extends Named<typeof usageLimitSchemaDefinition> {}
export const usageLimitSchema: UsageLimitSchema = usageLimitSchemaDefinition;
export type UsageLimit = z.infer<typeof usageLimitSchema>;

/** The organization's billable events counted for the month; a later count may be lower. */
const monthCountedEventDataSchemaDefinition = z.object({
  ...envelope,
  billableEvents: z.number().int().nonnegative(),
  /** The month's traces, counted only when a capped plan is held in traces. */
  traces: z.number().int().nonnegative().optional(),
  limit: usageLimitSchema,
});
export interface MonthCountedEventDataSchema extends Named<
  typeof monthCountedEventDataSchemaDefinition
> {}
export const monthCountedEventDataSchema: MonthCountedEventDataSchema =
  monthCountedEventDataSchemaDefinition;
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
const limitReachedEventDataSchemaDefinition = z.object(limitDecision);
export interface LimitReachedEventDataSchema extends Named<
  typeof limitReachedEventDataSchemaDefinition
> {}
export const limitReachedEventDataSchema: LimitReachedEventDataSchema =
  limitReachedEventDataSchemaDefinition;
export type LimitReachedEventData = z.infer<typeof limitReachedEventDataSchema>;

/** A reached limit no longer holds, after an upgrade or a lower recount. */
const limitClearedEventDataSchemaDefinition = z.object(limitDecision);
export interface LimitClearedEventDataSchema extends Named<
  typeof limitClearedEventDataSchemaDefinition
> {}
export const limitClearedEventDataSchema: LimitClearedEventDataSchema =
  limitClearedEventDataSchemaDefinition;
export type LimitClearedEventData = z.infer<typeof limitClearedEventDataSchema>;

/** The month's usage crossed a warning threshold; billing mails the admins once per threshold. */
const usageThresholdCrossedEventDataSchemaDefinition = z.object({
  ...envelope,
  crossedThreshold: z.number(),
  currentMonthMessagesCount: z.number(),
  maxMonthlyUsageLimit: z.number(),
  projectCounts: z.array(z.object({ projectId: z.string(), count: z.number() })),
});
export interface UsageThresholdCrossedEventDataSchema extends Named<
  typeof usageThresholdCrossedEventDataSchemaDefinition
> {}
export const usageThresholdCrossedEventDataSchema: UsageThresholdCrossedEventDataSchema =
  usageThresholdCrossedEventDataSchemaDefinition;
export type UsageThresholdCrossedEventData = z.infer<typeof usageThresholdCrossedEventDataSchema>;
