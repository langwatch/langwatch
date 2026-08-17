import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Organization } from "~/generated/prisma/client";
import { PricingModel } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { PrismaOrganizationRepository } from "../repositories/organization.prisma.repository";

/**
 * The three-way verdict of the billing lookup, pinned at the layer that
 * decides it.
 *
 * The usage-reporting handler's own unit tests mock this method, so they can
 * only check what it does with an answer, never which answer it gives. That
 * gap is where the defect lived: the query filtered on `pricingModel`, so an
 * organization that simply does not buy usage came back indistinguishable from
 * one that does not exist, and the handler reported the ordinary case at the
 * anomaly's severity because it had no way to tell them apart.
 *
 * The middle case below is the regression. The two either side of it are what
 * stop the fix from being written as "always answer not_usage_billed".
 */
describe("PrismaOrganizationRepository billing lookup", () => {
  let repository: PrismaOrganizationRepository;
  let usageBilled: Organization;
  let tiered: Organization;
  const namespace = `billing-lookup-${nanoid(8)}`;

  beforeAll(async () => {
    repository = new PrismaOrganizationRepository(prisma);

    usageBilled = await prisma.organization.create({
      data: {
        name: `Usage billed ${namespace}`,
        slug: `usage-billed-${namespace}`,
        pricingModel: PricingModel.SEAT_EVENT,
      },
    });

    tiered = await prisma.organization.create({
      data: {
        name: `Tiered ${namespace}`,
        slug: `tiered-${namespace}`,
        pricingModel: PricingModel.TIERED,
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [usageBilled.id, tiered.id] } },
    });
  });

  describe("given an organization on usage-based pricing", () => {
    describe("when the lookup runs", () => {
      it("answers usage_billed and carries the organization", async () => {
        const result = await repository.getOrganizationForBilling(
          usageBilled.id,
        );

        expect(result.outcome).toBe("usage_billed");
        if (result.outcome !== "usage_billed") return;
        expect(result.organization.id).toBe(usageBilled.id);
        // The pricing model is read to classify, not published: it is not part
        // of what the handler needs, and leaking it would invite a second
        // check of the same condition at the call site.
        expect(result.organization).not.toHaveProperty("pricingModel");
      });
    });
  });

  describe("given an organization that is not on usage-based pricing", () => {
    describe("when the lookup runs", () => {
      /** @scenario "The billing lookup tells an absent organization from one that does not buy usage" */
      it("answers not_usage_billed rather than not_found", async () => {
        const result = await repository.getOrganizationForBilling(tiered.id);

        expect(result.outcome).toBe("not_usage_billed");
      });
    });
  });

  describe("given no such organization", () => {
    describe("when the lookup runs", () => {
      it("answers not_found", async () => {
        const result = await repository.getOrganizationForBilling(
          `missing-${namespace}`,
        );

        expect(result.outcome).toBe("not_found");
      });
    });
  });
});
