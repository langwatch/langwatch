// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GROWTH_SEAT_PLAN_TYPES } from "@langwatch/enterprise-billing-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { PrismaBillingReportOrganizationRepository } from "../prisma.billing-report-organization.repository.ts";

type SubscriptionRow = {
  id: string;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
};

type OrganizationRow = {
  id: string;
  pricingModel: string;
  stripeCustomerId: string | null;
  selfHostedCustomer: boolean;
  subscriptions: SubscriptionRow[];
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

function live(id: string, startDate: string | null): SubscriptionRow {
  return { id, status: "ACTIVE", startDate: startDate ? new Date(startDate) : null, endDate: null };
}

describe("PrismaBillingReportOrganizationRepository", () => {
  describe("when the worker asks whether a usage-billed organization is billable", () => {
    /** @scenario "The worker reads a billable organization the way the App reads it" */
    it("asks for the pricing model and the growth-seat subscriptions, live or ended", async () => {
      const { asked, repository } = repositoryOver({
        id: "org_1",
        pricingModel: "SEAT_EVENT",
        stripeCustomerId: "cus_1",
        selfHostedCustomer: false,
        subscriptions: [live("sub_1", "2026-02-10T13:00:00.000Z")],
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
              where: {
                plan: { in: [...GROWTH_SEAT_PLAN_TYPES] },
                OR: [{ status: "ACTIVE" }, { endDate: { not: null }, startDate: { not: null } }],
              },
              take: 50,
              select: { id: true, status: true, startDate: true, endDate: true },
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
          growthSeatPeriods: [{ startMs: Date.parse("2026-02-10T13:00:00.000Z"), endMs: null }],
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
        subscriptions: [live("sub_2", null)],
      });

      await expect(repository.getOrganizationForBilling("org_2")).resolves.toEqual({
        outcome: "not_usage_billed",
      });
    });
  });
});

describe("PrismaBillingReportOrganizationRepository, a subscription with no start date", () => {
  /** @scenario "A subscription with no recorded start reports the whole month" */
  it("carries a period with no start, so the month is read whole", async () => {
    const { repository } = repositoryOver({
      id: "org_3",
      pricingModel: "SEAT_EVENT",
      stripeCustomerId: "cus_3",
      selfHostedCustomer: false,
      subscriptions: [live("sub_3", null)],
    });

    await expect(repository.getOrganizationForBilling("org_3")).resolves.toEqual({
      outcome: "usage_billed",
      organization: {
        id: "org_3",
        stripeCustomerId: "cus_3",
        subscriptions: [{ id: "sub_3" }],
        contract: "cloud",
        growthSeatPeriods: [{ startMs: null, endMs: null }],
      },
    });
  });

  /** @scenario "A subscription with no recorded start reports the whole month" */
  it("keeps the one with no start first, as Postgres puts nulls first in a descending order", async () => {
    const { repository } = repositoryOver({
      id: "org_1",
      pricingModel: "SEAT_EVENT",
      stripeCustomerId: "cus_1",
      selfHostedCustomer: false,
      subscriptions: [live("sub_legacy", null), live("sub_dated", "2026-02-10T13:00:00Z")],
    });

    await expect(repository.getOrganizationForBilling("org_1")).resolves.toMatchObject({
      organization: {
        subscriptions: [{ id: "sub_legacy" }],
        growthSeatPeriods: [
          { startMs: null, endMs: null },
          { startMs: Date.parse("2026-02-10T13:00:00Z"), endMs: null },
        ],
      },
    });
  });
});

describe("PrismaBillingReportOrganizationRepository, a subscription replaced on 15 February", () => {
  /** @scenario "A subscription replaced mid-month keeps the month's window" */
  it("answers both periods newest start first, and only the live one as the subscription", async () => {
    const { repository } = repositoryOver({
      id: "org_1",
      pricingModel: "SEAT_EVENT",
      stripeCustomerId: "cus_1",
      selfHostedCustomer: false,
      // As Postgres returns them for `ORDER BY "startDate" DESC`.
      subscriptions: [
        live("sub_replacement", "2026-02-15T09:00:00Z"),
        {
          id: "sub_replaced",
          status: "CANCELLED",
          startDate: new Date("2025-06-15T00:00:00Z"),
          endDate: new Date("2026-02-15T09:00:00Z"),
        },
      ],
    });

    await expect(repository.getOrganizationForBilling("org_1")).resolves.toEqual({
      outcome: "usage_billed",
      organization: {
        id: "org_1",
        stripeCustomerId: "cus_1",
        subscriptions: [{ id: "sub_replacement" }],
        contract: "cloud",
        growthSeatPeriods: [
          { startMs: Date.parse("2026-02-15T09:00:00Z"), endMs: null },
          {
            startMs: Date.parse("2025-06-15T00:00:00Z"),
            endMs: Date.parse("2026-02-15T09:00:00Z"),
          },
        ],
      },
    });
  });
});
