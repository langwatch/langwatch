import type { PrismaClient } from "@prisma/client";
import { GROWTH_SEAT_PLAN_TYPES } from "../../../../ee/billing/utils/growthSeatEvent";

/**
 * The ADR-039 drifted cohort: organizations holding an ACTIVE seat-event
 * subscription while their pricingModel display cache still says otherwise
 * (the incident class — migrateToSeatEvent skipped by webhook ordering).
 *
 * Shared by the checkpoint-seeding and pricingModel-backfill rollout scripts
 * so both operate on exactly the same population.
 */
export async function findDriftedSeatEventOrgs(
  prisma: PrismaClient,
): Promise<Array<{ id: string; name: string; pricingModel: string }>> {
  return prisma.organization.findMany({
    where: {
      pricingModel: { not: "SEAT_EVENT" },
      subscriptions: {
        some: {
          status: "ACTIVE",
          plan: { in: [...GROWTH_SEAT_PLAN_TYPES] },
        },
      },
    },
    select: { id: true, name: true, pricingModel: true },
  });
}
