import { z } from "zod";

export const sweepOrphansForTenantCommandDataSchema = z.object({
  tenantId: z.string(),
  occurredAt: z.number(),
  consecutiveFailures: z.number(),
});

export type SweepOrphansForTenantCommandData = z.infer<
  typeof sweepOrphansForTenantCommandDataSchema
>;
