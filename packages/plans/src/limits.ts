import { z } from "zod";

/**
 * What a limit is counted in. A number without its unit is the reason the same
 * ceiling reads as "members" in one screen and "seats" in the next.
 */
export const LIMIT_UNITS = [
  "members",
  "messages-per-month",
  "events-per-month",
  "seats",
  "dispatches-per-day",
  "days",
] as const;

export const limitUnitSchema = z.enum(LIMIT_UNITS);
export type LimitUnit = z.infer<typeof limitUnitSchema>;

export const planLimitSchema = z.object({
  value: z.number(),
  unit: limitUnitSchema,
});
export type PlanLimit = z.infer<typeof planLimitSchema>;

/**
 * The sentinel the cloud catalogue uses for "no message cap". Kept finite
 * because a limit crosses JSON, where Infinity becomes null.
 */
export const UNLIMITED_MESSAGES = 999_999_999;

/** The sentinel the self-hosted baseline uses. See drift.md: the two disagree. */
export const UNLIMITED = Number.MAX_SAFE_INTEGER;

export const planLimitsSchema = z.object({
  members: planLimitSchema,
  membersLite: planLimitSchema,
  /** Metered volume per month, in the plan's own counting unit. */
  volume: planLimitSchema,
  /** Set only on seat-priced plans, where a seat is the thing sold. */
  seats: planLimitSchema.nullable(),
  automationDailyDispatch: planLimitSchema,
  /** The read-path window older content is teaser-redacted outside of. */
  visibility: planLimitSchema.nullable(),
});
export type PlanLimits = z.infer<typeof planLimitsSchema>;

export const LIMIT_NAMES = Object.keys(planLimitsSchema.shape) as ReadonlyArray<keyof PlanLimits>;
