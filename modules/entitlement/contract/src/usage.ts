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

/**
 * Copy is pre-formatted so the sidebar, settings, and email cannot render it differently.
 */
export const messageLimitInfoSchema = z
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
export type MessageLimitInfo = z.infer<typeof messageLimitInfoSchema>;

/** One organization's usage for the current period, and the plan it is measured against. */
export const usageStatsSchema = z
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
    messageLimitInfo: messageLimitInfoSchema,
    usageUnit: usageUnitSchema,
  })
  .strict();
export type UsageStats = z.infer<typeof usageStatsSchema>;
