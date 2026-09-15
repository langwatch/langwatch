import { z } from "zod";

/**
 * Single source of truth for limit types; adding a new type causes compile errors
 * in exhaustive switch statements. Only seats are enforced; workspace and experiments
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
