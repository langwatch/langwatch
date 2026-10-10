/**
 * Which organizations the billing lookup admits, and which it still skips.
 *
 * Boundary mocked: Prisma. The question these cases ask is a decision, not a
 * query plan, so the two reads the repository makes are stubbed and what is
 * asserted is the verdict it returns.
 *
 * @see specs/self-hosting/connected-services/connected-billing.feature
 */

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaOrganizationRepository } from "../repositories/organization.prisma.repository";

const ORGANIZATION_ID = "org-acme";

function makeRepository({
  organization,
  account = null,
}: {
  organization: Record<string, unknown> | null;
  account?: Record<string, unknown> | null;
}) {
  const findConnectedAccount = vi.fn(async () => account);
  const prisma = {
    organization: { findFirst: vi.fn(async () => organization) },
    connectedBillingAccount: { findUnique: findConnectedAccount },
  };
  return {
    repository: new PrismaOrganizationRepository(
      prisma as unknown as PrismaClient,
      { write: vi.fn() } as never,
    ),
    findConnectedAccount,
  };
}

describe("PrismaOrganizationRepository.getOrganizationForBilling", () => {
  describe("given a self-hosted customer with a connected billing account", () => {
    /** @scenario "A connected customer is not skipped for lacking a Cloud plan" */
    it("admits it although it is on no Cloud plan", async () => {
      const { repository } = makeRepository({
        organization: {
          id: ORGANIZATION_ID,
          pricingModel: "TIERED",
          stripeCustomerId: null,
          selfHostedCustomer: true,
          subscriptions: [],
        },
        account: {
          stripeCustomerId: "cus_connected",
          usageSubscriptionId: "sub_connected",
        },
      });

      const result =
        await repository.getOrganizationForBilling(ORGANIZATION_ID);

      expect(result).toEqual({
        outcome: "usage_billed",
        organization: {
          id: ORGANIZATION_ID,
          stripeCustomerId: "cus_connected",
          subscriptions: [{ id: "sub_connected" }],
          contract: "connected",
        },
      });
    });

    it("skips it until onboarding created the usage subscription", async () => {
      const { repository } = makeRepository({
        organization: {
          id: ORGANIZATION_ID,
          pricingModel: "TIERED",
          stripeCustomerId: null,
          selfHostedCustomer: true,
          subscriptions: [],
        },
        account: {
          stripeCustomerId: "cus_connected",
          usageSubscriptionId: null,
        },
      });

      const result =
        await repository.getOrganizationForBilling(ORGANIZATION_ID);

      expect(result).toMatchObject({
        outcome: "usage_billed",
        organization: { subscriptions: [] },
      });
    });
  });

  describe("given a self-hosted customer that was never onboarded for billing", () => {
    it("reports it as not billed for usage", async () => {
      const { repository } = makeRepository({
        organization: {
          id: ORGANIZATION_ID,
          pricingModel: "TIERED",
          stripeCustomerId: null,
          selfHostedCustomer: true,
          subscriptions: [],
        },
        account: null,
      });

      const result =
        await repository.getOrganizationForBilling(ORGANIZATION_ID);

      expect(result).toEqual({ outcome: "not_usage_billed" });
    });
  });

  describe("given an organization on a plan that is not billed for usage", () => {
    /** @scenario "An organization that is neither usage billed nor a self-hosted customer is still skipped" */
    it("skips it as before, and does not look for a billing account", async () => {
      const { repository, findConnectedAccount } = makeRepository({
        organization: {
          id: ORGANIZATION_ID,
          pricingModel: "TIERED",
          stripeCustomerId: "cus_cloud",
          selfHostedCustomer: false,
          subscriptions: [],
        },
      });

      const result =
        await repository.getOrganizationForBilling(ORGANIZATION_ID);

      expect(result).toEqual({ outcome: "not_usage_billed" });
      expect(findConnectedAccount).not.toHaveBeenCalled();
    });
  });

  describe("given a Cloud organization on seat and event pricing", () => {
    it("admits it under the Cloud contract", async () => {
      const { repository, findConnectedAccount } = makeRepository({
        organization: {
          id: ORGANIZATION_ID,
          pricingModel: "SEAT_EVENT",
          stripeCustomerId: "cus_cloud",
          selfHostedCustomer: false,
          subscriptions: [{ id: "sub_cloud" }],
        },
      });

      const result =
        await repository.getOrganizationForBilling(ORGANIZATION_ID);

      expect(result).toEqual({
        outcome: "usage_billed",
        organization: {
          id: ORGANIZATION_ID,
          stripeCustomerId: "cus_cloud",
          subscriptions: [{ id: "sub_cloud" }],
          contract: "cloud",
        },
      });
      expect(findConnectedAccount).not.toHaveBeenCalled();
    });
  });

  describe("given no such organization", () => {
    it("reports it as not found", async () => {
      const { repository } = makeRepository({ organization: null });

      expect(
        await repository.getOrganizationForBilling(ORGANIZATION_ID),
      ).toEqual({ outcome: "not_found" });
    });
  });
});
