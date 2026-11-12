import type { Named } from "@langwatch/module";
/**
 * Organization usage against plan: where it stands, its status, and formatted
 * copy shared across UI, settings, and email.
 */
import { z } from "zod";

import { planSchema } from "./plan.ts";

/** Where usage stands against the allowance. */
export const messageLimitStatusSchema = z.enum(["ok", "warning", "exceeded"]);
export type MessageLimitStatus = z.infer<typeof messageLimitStatusSchema>;

/** What the allowance is measured in. */
export const usageUnitSchema = z.enum(["traces", "events"]);
export type UsageUnit = z.infer<typeof usageUnitSchema>;

/** How a plan's counting unit reads on an alert, as main labelled it. */
export const USAGE_UNIT_DISPLAY_LABELS: Record<UsageUnit, string> = {
  traces: "Monthly Traces",
  events: "Monthly Events",
};

/**
 * Copy is pre-formatted so the sidebar, settings, and email cannot render it differently.
 */
const messageLimitInfoSchemaDefinition = z
  .object({
    status: messageLimitStatusSchema,
    current: z.number(),
    max: z.number(),
    currentFormatted: z.string(),
    maxFormatted: z.string(),
    percentageFormatted: z.string(),
    message: z.string(),
  })
  .strict();
export interface MessageLimitInfoSchema extends Named<typeof messageLimitInfoSchemaDefinition> {}
export const messageLimitInfoSchema: MessageLimitInfoSchema = messageLimitInfoSchemaDefinition;
export type MessageLimitInfo = z.infer<typeof messageLimitInfoSchema>;

/** Seats used against seats the plan includes, for one seat type. */
const seatUsageSchemaDefinition = z
  .object({ current: z.number(), max: z.number(), exceeded: z.boolean() })
  .strict();
export interface SeatUsageSchema extends Named<typeof seatUsageSchemaDefinition> {}
export const seatUsageSchema: SeatUsageSchema = seatUsageSchemaDefinition;
export type SeatUsage = z.infer<typeof seatUsageSchema>;

/**
 * Whether the organization uses more seats than its plan includes, which a plan
 * shrinking under a full organization leaves behind (specs/licensing/subscription-page.feature).
 */
const seatLimitInfoSchemaDefinition = z
  .object({
    status: z.enum(["ok", "exceeded"]),
    members: seatUsageSchema,
    membersLite: seatUsageSchema,
    message: z.string(),
  })
  .strict();
export interface SeatLimitInfoSchema extends Named<typeof seatLimitInfoSchemaDefinition> {}
export const seatLimitInfoSchema: SeatLimitInfoSchema = seatLimitInfoSchemaDefinition;
export type SeatLimitInfo = z.infer<typeof seatLimitInfoSchema>;

/** One organization's usage for the current period, and the plan it is measured against. */
const usageStatsSchemaDefinition = z
  .object({
    /** Null on a legacy or unlimited response, which has no count to show. */
    currentMonthMessagesCount: z.number().nullable(),
    currentMonthCost: z.number(),
    activePlan: planSchema,
    /**
     * The month's allowance. Finite always: an uncapped organization is reported at
     * `Number.MAX_SAFE_INTEGER`, because `Infinity` is neither JSON nor a `z.number()`, and
     * sending it turned every usage read into a 500.
     */
    maxMonthlyUsageLimit: z.number(),
    membersCount: z.number(),
    membersLiteCount: z.number(),
    /** Developer seats (ADR-171): shown beside the metered seats, never capped. */
    membersDeveloperCount: z.number(),
    messageLimitInfo: messageLimitInfoSchema,
    seatLimitInfo: seatLimitInfoSchema,
    usageUnit: usageUnitSchema,
  })
  .strict();
export interface UsageStatsSchema extends Named<typeof usageStatsSchemaDefinition> {}
export const usageStatsSchema: UsageStatsSchema = usageStatsSchemaDefinition;
export type UsageStats = z.infer<typeof usageStatsSchema>;

/** One UTC day's count this month: `date` is `YYYY-MM-DD`. */
const usageDaySchemaDefinition = z.object({ date: z.string(), count: z.number() }).strict();
export interface UsageDaySchema extends Named<typeof usageDaySchemaDefinition> {}
export const usageDaySchema: UsageDaySchema = usageDaySchemaDefinition;
export type UsageDay = z.infer<typeof usageDaySchema>;

/** One project's share of the month, named as the limit email names it. */
const projectUsageShareSchemaDefinition = z
  .object({ projectId: z.string(), name: z.string(), count: z.number() })
  .strict();
export interface ProjectUsageShareSchema extends Named<typeof projectUsageShareSchemaDefinition> {}
export const projectUsageShareSchema: ProjectUsageShareSchema = projectUsageShareSchemaDefinition;
export type ProjectUsageShare = z.infer<typeof projectUsageShareSchema>;

/** The kinds of billable event the usage page counts apart, in the order it shows them. */
export const USAGE_CATEGORIES = [
  "spans",
  "logs",
  "metrics",
  "evaluations",
  "experiments",
  "scenarios",
] as const;
export const usageCategorySchema = z.enum(USAGE_CATEGORIES);
export type UsageCategory = z.infer<typeof usageCategorySchema>;

/** One kind's distinct billable events this month. */
const usageCategoryCountSchemaDefinition = z
  .object({ category: usageCategorySchema, count: z.number() })
  .strict();
export interface UsageCategoryCountSchema extends Named<
  typeof usageCategoryCountSchemaDefinition
> {}
export const usageCategoryCountSchema: UsageCategoryCountSchema =
  usageCategoryCountSchemaDefinition;
export type UsageCategoryCount = z.infer<typeof usageCategoryCountSchema>;

/**
 * The usage page's month: each UTC day, each kind (`USAGE_CATEGORIES` order, zeros included) and
 * each project, busiest first. `days` and `byCategory` are null for a traces meter or a failed
 * read (`is*Unavailable` marks it); `projects` is null when the counting store could not answer.
 */
const usageMonthBreakdownSchemaDefinition = z
  .object({
    /** `YYYY-MM-DD`: the first day of next month, when the count starts again. */
    resetsOn: z.string(),
    days: usageDaySchema.array().nullable(),
    /** True when the organization is metered by day but the daily read failed. */
    isDailyUnavailable: z.boolean(),
    projects: projectUsageShareSchema.array().nullable(),
    byCategory: usageCategoryCountSchema.array().nullable(),
    /** True when the organization is metered in events but the per-kind read failed. */
    isByCategoryUnavailable: z.boolean(),
  })
  .strict();
export interface UsageMonthBreakdownSchema extends Named<
  typeof usageMonthBreakdownSchemaDefinition
> {}
export const usageMonthBreakdownSchema: UsageMonthBreakdownSchema =
  usageMonthBreakdownSchemaDefinition;
export type UsageMonthBreakdown = z.infer<typeof usageMonthBreakdownSchema>;
