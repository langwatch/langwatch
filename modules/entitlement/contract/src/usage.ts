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
