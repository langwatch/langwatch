// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { randomUUID } from "node:crypto";

/**
 * @vitest-environment node
 *
 * The three-way verdict of the billing lookup, pinned at the layer that
 * decides it.
 *
 * The usage-reporting handler's own unit tests mock this repository, so they
 * can only check what it does with an answer, never which answer it gives.
 * That gap is where the defect lived: the query FILTERED on `pricingModel`, so
 * an organization that simply does not buy usage came back indistinguishable
 * from one that does not exist, and the handler reported the ordinary case at
 * the anomaly's severity because it had no way to tell them apart.
 *
 * The middle case below is the regression. The two either side of it are what
 * stop the fix from being written as "always answer not_usage_billed".
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 * @see specs/self-hosting/connected-services/connected-billing.feature
 */
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaBillingReportOrganizationRepository } from "../prisma.billing-report-organization.repository.ts";

const namespace = `billing-lookup-${randomUUID().slice(0, 8)}`;

describe("given organizations on either side of usage-based pricing", () => {
  let prisma: PrismaClient;
  let repository: PrismaBillingReportOrganizationRepository;
  let usageBilledId: string;
  let tieredId: string;
  let connectedId: string;
  let halfOnboardedId: string;
  let neverOnboardedId: string;

  /**
   * Cleanup reads this, not the fixtures. A create that throws leaves its
   * fixture undefined, and a teardown that dereferences one fails with an
   * error of its own in front of the one that actually broke the run.
   */
  const createdIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: PrismaDriverAdapterService.create().create(process.env.DATABASE_URL ?? "").adapter,
    });
    repository = PrismaBillingReportOrganizationRepository.create(prisma);

    const usageBilled = await prisma.organization.create({
      data: {
        name: `Usage billed ${namespace}`,
        slug: `usage-billed-${namespace}`,
        pricingModel: "SEAT_EVENT",
      },
    });
    usageBilledId = usageBilled.id;
    createdIds.push(usageBilled.id);

    const tiered = await prisma.organization.create({
      data: {
        name: `Tiered ${namespace}`,
        slug: `tiered-${namespace}`,
        pricingModel: "TIERED",
      },
    });
    tieredId = tiered.id;
    createdIds.push(tiered.id);

    connectedId = await selfHostedCustomer("connected", { usageSubscriptionId: "sub_usage" });
    halfOnboardedId = await selfHostedCustomer("half-onboarded", { usageSubscriptionId: null });
    neverOnboardedId = await selfHostedCustomer("never-onboarded", null);
  });

  /** A self-hosted customer on no Cloud plan, with or without a billing account. */
  async function selfHostedCustomer(
    label: string,
    account: { usageSubscriptionId: string | null } | null,
  ): Promise<string> {
    const organization = await prisma.organization.create({
      data: {
        name: `${label} ${namespace}`,
        slug: `${label}-${namespace}`,
        pricingModel: "TIERED",
        selfHostedCustomer: true,
      },
    });
    createdIds.push(organization.id);
    if (account) {
      await prisma.connectedBillingAccount.create({
        data: {
          organizationId: organization.id,
          stripeCustomerId: `cus_${label}_${namespace}`,
          usageSubscriptionId: account.usageSubscriptionId,
          termStartsAt: new Date("2026-01-01T00:00:00.000Z"),
          termEndsAt: new Date("2027-01-01T00:00:00.000Z"),
          seatCurrency: "USD",
          seatRateCents: 1000,
          seats: 5,
          billingEmail: `billing@${label}.test`,
        },
      });
    }
    return organization.id;
  }

  afterAll(async () => {
    if (createdIds.length > 0) {
      await prisma.connectedBillingAccount.deleteMany({
        where: { organizationId: { in: createdIds } },
      });
      await prisma.organization.deleteMany({ where: { id: { in: createdIds } } });
    }
    await prisma.$disconnect();
  });

  describe("when the lookup runs for an organization on usage-based pricing", () => {
    it("answers usage_billed and carries the organization", async () => {
      const result = await repository.getOrganizationForBilling(usageBilledId);

      expect(result.outcome).toBe("usage_billed");
      if (result.outcome !== "usage_billed") return;
      expect(result.organization.id).toBe(usageBilledId);
      // The pricing model is read to classify, not published: it is not part
      // of what the handler needs, and leaking it would invite a second check
      // of the same condition at the call site.
      expect(result.organization).not.toHaveProperty("pricingModel");
      expect(result.organization.contract).toBe("cloud");
    });
  });

  describe("when the lookup runs for an organization that is not on usage-based pricing", () => {
    /** @scenario "The billing lookup tells an absent organization from one that does not buy usage" */
    it("answers not_usage_billed rather than not_found", async () => {
      const result = await repository.getOrganizationForBilling(tieredId);

      expect(result.outcome).toBe("not_usage_billed");
    });
  });

  describe("when the lookup runs for no such organization", () => {
    it("answers not_found", async () => {
      const result = await repository.getOrganizationForBilling(`missing-${namespace}`);

      expect(result.outcome).toBe("not_found");
    });
  });

  describe("when the lookup runs for a self-hosted customer with a connected billing account", () => {
    /** @scenario "A connected customer is not skipped for lacking a Cloud plan" */
    it("admits it under the connected contract, on the account's subscription", async () => {
      const result = await repository.getOrganizationForBilling(connectedId);

      expect(result).toEqual({
        outcome: "usage_billed",
        organization: {
          id: connectedId,
          stripeCustomerId: `cus_connected_${namespace}`,
          subscriptions: [{ id: "sub_usage" }],
          contract: "connected",
        },
      });
    });

    it("carries no subscription until onboarding created the usage subscription", async () => {
      const result = await repository.getOrganizationForBilling(halfOnboardedId);

      expect(result).toMatchObject({
        outcome: "usage_billed",
        organization: { id: halfOnboardedId, subscriptions: [], contract: "connected" },
      });
    });
  });

  describe("when the lookup runs for a self-hosted customer never onboarded for billing", () => {
    it("answers not_usage_billed", async () => {
      const result = await repository.getOrganizationForBilling(neverOnboardedId);

      expect(result).toEqual({ outcome: "not_usage_billed" });
    });
  });

  describe("when the lookup runs for an organization that is neither usage billed nor a self-hosted customer", () => {
    /** @scenario "An organization that is neither usage billed nor a self-hosted customer is still skipped" */
    it("still answers not_usage_billed", async () => {
      const result = await repository.getOrganizationForBilling(tieredId);

      expect(result).toEqual({ outcome: "not_usage_billed" });
    });
  });
});
