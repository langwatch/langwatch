import { z } from "zod";

/**
 * The limits a plan puts on an organization, which organization answers
 * (`licenseEnforcement.*`). Only seats are enforced; workspace and experiments
 * are OSS.
 */
export const limitTypes = ["members", "membersLite"] as const;

export type LimitType = (typeof limitTypes)[number];

/** Zod schema derived from the same source of truth */
export const limitTypeSchema = z.enum(limitTypes);

/** Result of checking a limit */
export const limitCheckResultSchema = z
  .object({
    /** Whether the organization can create another resource of this type */
    allowed: z.boolean(),
    /** Current count of resources */
    current: z.number(),
    /** Maximum allowed by the current plan */
    max: z.number(),
    /** Type of limit being checked */
    limitType: limitTypeSchema,
  })
  .strict();
export type LimitCheckResult = z.infer<typeof limitCheckResultSchema>;

/** Every limit at once, keyed by type. Which limits exist is the app's answer. */
export const allLimitChecksSchema = z.record(limitTypeSchema, limitCheckResultSchema);

export const SEAT_LIMIT_REACHED_EVENT_TYPE = "lw.organization.seat_limit_reached" as const;
/** One seat limit an organization ran into: a refused invite, role change or client pre-check. */
export const seatLimitReachedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  limitType: limitTypeSchema,
  current: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
});
export type SeatLimitReachedEventData = z.infer<typeof seatLimitReachedEventDataSchema>;
