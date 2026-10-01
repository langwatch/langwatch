import { z } from "zod";

/** A user's lifecycle facts, which peers react to from their own side (§9). */
export const USER_LIFECYCLE_PIPELINE_NAME = "user_lifecycle" as const;
export const USER_AGGREGATE_TYPE = "user_account" as const;
export const USER_DEACTIVATED_EVENT_TYPE = "lw.user.deactivated" as const;
export const USER_REACTIVATED_EVENT_TYPE = "lw.user.reactivated" as const;
export const USER_LIFECYCLE_EVENT_VERSION = "2026-10-01" as const;

/** Who made a change, in the grants ledger's shape (restated per contract, as `team.ts` does). */
export const userLedgerActorSchema = z
  .object({ type: z.enum(["user", "system"]), id: z.string().nullable() })
  .strict();
export type UserLedgerActor = z.infer<typeof userLedgerActorSchema>;

/**
 * `tenantId` is the user's own id, as identity keys its user facts. `actor` is who made the
 * change; facts recorded before it existed have none.
 */
export const userLifecycleEventDataSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  actor: userLedgerActorSchema.optional(),
});
export type UserLifecycleEventData = z.infer<typeof userLifecycleEventDataSchema>;
