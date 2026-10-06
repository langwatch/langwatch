// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GROWTH_SEAT_PLAN_TYPES } from "@langwatch/enterprise-billing-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { PrismaBillingReportOrganizationRepository } from "../prisma.billing-report-organization.repository.ts";

type OrganizationRow = {
  id: string;
  pricingModel: string;
  stripeCustomerId: string | null;
  selfHostedCustomer: boolean;
  subscriptions: { id: string }[];
};

/** A Postgres holding one organization row, recording what the repository asked it. */
function repositoryOver(row: OrganizationRow | null) {
  const asked: unknown[] = [];
  const prisma = prismaDouble({
    organization: {
      findFirst: async (args) => {
        asked.push(args);
        return row;
      },
    },
  });

  return { asked, repository: PrismaBillingReportOrganizationRepository.create(prisma) };
}

describe("PrismaBillingReportOrganizationRepository", () => {
  describe("when the worker asks whether a usage-billed organization is billable", () => {
    /** @scenario "The worker reads a billable organization the way the App reads it" */
    it("asks for the pricing model and the one live growth-seat subscription", async () => {
      const { asked, repository } = repositoryOver({
        id: "org_1",
        pricingModel: "SEAT_EVENT",
        stripeCustomerId: "cus_1",
        selfHostedCustomer: false,
        subscriptions: [{ id: "sub_1" }],
      });

      const lookup = await repository.getOrganizationForBilling("org_1");

      expect(asked).toEqual([
        {
          where: { id: "org_1" },
          select: {
            id: true,
            pricingModel: true,
            stripeCustomerId: true,
            selfHostedCustomer: true,
            subscriptions: {
              where: { status: "ACTIVE", plan: { in: [...GROWTH_SEAT_PLAN_TYPES] } },
              take: 1,
              select: { id: true },
              orderBy: { startDate: "desc" },
            },
          },
        },
      ]);
      expect(lookup).toEqual({
        outcome: "usage_billed",
        organization: {
          id: "org_1",
          stripeCustomerId: "cus_1",
          subscriptions: [{ id: "sub_1" }],
          contract: "cloud",
        },
      });
    });

    /** @scenario "The worker reads a billable organization the way the App reads it" */
    it("has nothing to report for an organization on another pricing model", async () => {
      const { repository } = repositoryOver({
        id: "org_2",
        pricingModel: "TIERED",
        stripeCustomerId: "cus_2",
        selfHostedCustomer: false,
        subscriptions: [{ id: "sub_2" }],
      });

      await expect(repository.getOrganizationForBilling("org_2")).resolves.toEqual({
        outcome: "not_usage_billed",
      });
    });
  });
});
