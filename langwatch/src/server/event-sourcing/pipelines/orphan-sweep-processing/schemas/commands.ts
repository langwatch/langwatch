import { z } from "zod";

export const sweepOrphansForTenantCommandDataSchema = z.object({
  tenantId: z.string(),
  // Carried for trace/debug provenance only — dedup keys on tenantId, not this.
  occurredAt: z.number(),
  // Circuit-breaker counter carried in the payload (no separate store): the
  // handler self-dispatches with this incremented on a failed increment, reset
  // to 0 on success, and stops once it reaches MAX_CONSECUTIVE_SWEEP_FAILURES.
  consecutiveFailures: z.number(),
});

export type SweepOrphansForTenantCommandData = z.infer<
  typeof sweepOrphansForTenantCommandDataSchema
>;
