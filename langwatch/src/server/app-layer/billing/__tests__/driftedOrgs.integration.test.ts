import { PricingModel, type Organization } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaOrganizationRepository } from "../../organizations/repositories/organization.prisma.repository";
import { findDriftedSeatEventOrgs } from "../driftedOrgs";

/**
 * ADR-039 rollout step 4: the pricingModel backfill converges exactly the
 * drifted cohort (active seat-event sub + column != SEAT_EVENT) and the
 * column update itself changes no billing decision (the metering gate reads
 * the subscription fact since rollout step 1).
 *
 * Pairs with: specs/licensing/pricing-model-backfill.feature
 */
describe("findDriftedSeatEventOrgs()", () => {
  const ns = `backfill-${nanoid(8)}`;
  const createdOrgIds: string[] = [];

  async function createOrg({
    pricingModel,
    subscription,
  }: {
    pricingModel: PricingModel;
    subscription?: { plan: string; status: string };
  }): Promise<Organization> {
    const org = await prisma.organization.create({
      data: {
        name: `Org ${nanoid(6)} ${ns}`,
        slug: `org-${nanoid(6)}-${ns}`,
        pricingModel,
      },
    });
    createdOrgIds.push(org.id);
    if (subscription) {
      await prisma.subscription.create({
        data: {
          organizationId: org.id,
          plan: subscription.plan as never,
          status: subscription.status as never,
        },
      });
    }
    return org;
  }

  function driftedIdsWithin(all: Array<{ id: string }>): string[] {
    return all.map((o) => o.id).filter((id) => createdOrgIds.includes(id));
  }

  beforeAll(async () => {
    // no-op: orgs created per test
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({
      where: { organizationId: { in: createdOrgIds } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: createdOrgIds } },
    });
  });

  describe("when an organization drifted (TIERED column + active seat subscription)", () => {
    /** @scenario Backfill flips organizations with an active seat-event subscription */
    it("includes it in the backfill population and the update converges it", async () => {
      const org = await createOrg({
        pricingModel: PricingModel.TIERED,
        subscription: { plan: "GROWTH_SEAT_EUR_ANNUAL", status: "ACTIVE" },
      });

      const drifted = await findDriftedSeatEventOrgs(prisma);
      expect(driftedIdsWithin(drifted)).toContain(org.id);

      await prisma.organization.updateMany({
        where: { id: { in: driftedIdsWithin(drifted) } },
        data: { pricingModel: "SEAT_EVENT" },
      });

      const updated = await prisma.organization.findUnique({
        where: { id: org.id },
        select: { pricingModel: true },
      });
      expect(updated?.pricingModel).toBe("SEAT_EVENT");
    });
  });

  describe("when the seat subscription is cancelled", () => {
    /** @scenario Backfill ignores organizations whose seat subscription is cancelled */
    it("excludes the organization from the backfill population", async () => {
      const org = await createOrg({
        pricingModel: PricingModel.TIERED,
        subscription: { plan: "GROWTH_SEAT_EUR_MONTHLY", status: "CANCELLED" },
      });

      const drifted = await findDriftedSeatEventOrgs(prisma);

      expect(driftedIdsWithin(drifted)).not.toContain(org.id);
    });
  });

  describe("when the organization is on a legacy tiered plan", () => {
    /** @scenario Backfill ignores organizations on legacy tiered plans */
    it("excludes the organization from the backfill population", async () => {
      const org = await createOrg({
        pricingModel: PricingModel.TIERED,
        subscription: { plan: "ACCELERATE", status: "ACTIVE" },
      });

      const drifted = await findDriftedSeatEventOrgs(prisma);

      expect(driftedIdsWithin(drifted)).not.toContain(org.id);
    });
  });

  describe("when the column converges", () => {
    /** @scenario Backfilling the column does not change any billing decision */
    it("resolves the same metering population before and after the update", async () => {
      const org = await createOrg({
        pricingModel: PricingModel.TIERED,
        subscription: { plan: "GROWTH_SEAT_USD_MONTHLY", status: "ACTIVE" },
      });
      const repository = new PrismaOrganizationRepository(prisma);

      const before = await repository.getOrganizationForBilling(org.id);
      await prisma.organization.update({
        where: { id: org.id },
        data: { pricingModel: "SEAT_EVENT" },
      });
      const after = await repository.getOrganizationForBilling(org.id);

      expect(before?.id).toBe(org.id);
      expect(after?.id).toBe(org.id);
      expect(before?.subscriptions).toEqual(after?.subscriptions);
    });
  });
});
