import { PricingModel, type Organization } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaOrganizationRepository } from "../repositories/organization.prisma.repository";

/**
 * ADR-039 rollout step 1 (Invariant I1, money half): the Stripe metering
 * population derives from the active seat-event subscription, never from the
 * Organization.pricingModel column. Column drift (the incident class) must not
 * exclude a paying org from usage billing, and a stale SEAT_EVENT column must
 * not include an org that stopped paying for seats.
 *
 * Pairs with: specs/licensing/metering-gate-derivation.feature
 */
describe("PrismaOrganizationRepository.getOrganizationForBilling()", () => {
  const ns = `billing-gate-${nanoid(8)}`;
  let repository: PrismaOrganizationRepository;
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
        stripeCustomerId: `cus_${nanoid(8)}`,
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

  beforeAll(() => {
    repository = new PrismaOrganizationRepository(prisma);
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({
      where: { organizationId: { in: createdOrgIds } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: createdOrgIds } },
    });
  });

  describe("when the column drifted to TIERED but an active seat subscription exists", () => {
    /** @scenario Organization with an active seat subscription and a stale TIERED column is metered */
    it("includes the organization in the metering population", async () => {
      const org = await createOrg({
        pricingModel: PricingModel.TIERED,
        subscription: { plan: "GROWTH_SEAT_EUR_MONTHLY", status: "ACTIVE" },
      });

      const result = await repository.getOrganizationForBilling(org.id);

      expect(result?.subscriptions).toHaveLength(1);
    });
  });

  describe("when the column says SEAT_EVENT but no seat subscription exists", () => {
    /** @scenario Organization without a seat subscription is not metered even if the column says SEAT_EVENT */
    it("excludes the organization from the metering population", async () => {
      const org = await createOrg({ pricingModel: PricingModel.SEAT_EVENT });

      const result = await repository.getOrganizationForBilling(org.id);

      expect(result).toBeNull();
    });

    it("excludes the organization when its seat subscription is cancelled", async () => {
      const org = await createOrg({
        pricingModel: PricingModel.SEAT_EVENT,
        subscription: { plan: "GROWTH_SEAT_USD_MONTHLY", status: "CANCELLED" },
      });

      const result = await repository.getOrganizationForBilling(org.id);

      expect(result).toBeNull();
    });
  });

  describe("when organizations have no column drift", () => {
    /** @scenario Metering population is unchanged for organizations without column drift */
    it("includes only the seat-subscribed organization", async () => {
      const seatOrg = await createOrg({
        pricingModel: PricingModel.SEAT_EVENT,
        subscription: { plan: "GROWTH_SEAT_EUR_ANNUAL", status: "ACTIVE" },
      });
      const tieredOrg = await createOrg({ pricingModel: PricingModel.TIERED });

      const seatResult = await repository.getOrganizationForBilling(seatOrg.id);
      const tieredResult = await repository.getOrganizationForBilling(
        tieredOrg.id,
      );

      expect(seatResult?.id).toBe(seatOrg.id);
      expect(tieredResult).toBeNull();
    });
  });
});
