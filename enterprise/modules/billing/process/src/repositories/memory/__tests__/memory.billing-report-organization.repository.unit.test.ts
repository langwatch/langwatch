// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The memory twin answers what Postgres answers for the same rows, in the same order: the Prisma
 * twin's unit test pins the identical expectation over the rows `ORDER BY startDate DESC` returns.
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { BillingSubscriptionRecord } from "../../subscription.repository.ts";
import { MemoryBillingReportOrganizationRepository } from "../memory.billing-report-organization.repository.ts";
import { MemoryBillingStore } from "../memory.billing.store.ts";

const at = (iso: string) => Temporal.Instant.from(iso);

function subscription({
  id,
  status,
  plan = "GROWTH_SEAT_USD_MONTHLY",
  startDate,
  endDate,
}: {
  id: string;
  status: string;
  plan?: string;
  startDate: string | null;
  endDate: string | null;
}): BillingSubscriptionRecord {
  return {
    id,
    organizationId: "org_1",
    status,
    plan,
    stripeSubscriptionId: `stripe_${id}`,
    createdAt: at("2025-01-01T00:00:00Z"),
    startDate: startDate === null ? null : at(startDate),
    endDate: endDate === null ? null : at(endDate),
    maxMembers: null,
    maxMembersLite: null,
    maxMembersDeveloper: null,
    maxMessagesPerMonth: null,
    lastPaymentFailedDate: null,
    seatsKept: null,
    seatsKeptUntil: null,
  };
}

function repositoryWith(subscriptions: BillingSubscriptionRecord[]) {
  const store = MemoryBillingStore.create();
  store.organizations.set("org_1", {
    id: "org_1",
    name: "Acme",
    stripeCustomerId: "cus_1",
    pricingModel: "SEAT_EVENT",
    currency: "USD",
    selfHostedCustomer: false,
    teamIds: [],
    signupData: {},
  });
  store.subscriptions.push(...subscriptions);

  return MemoryBillingReportOrganizationRepository.create(store);
}

describe("MemoryBillingReportOrganizationRepository", () => {
  describe("given a subscription replaced on 15 February, beside rows that carry no period", () => {
    /** @scenario "A subscription replaced mid-month keeps the month's window" */
    it("answers the growth-seat periods newest start first, as Postgres orders them", async () => {
      const repository = repositoryWith([
        subscription({
          id: "sub_replaced",
          status: "CANCELLED",
          startDate: "2025-06-15T00:00:00Z",
          endDate: "2026-02-15T09:00:00Z",
        }),
        subscription({
          id: "sub_abandoned_checkout",
          status: "CANCELLED",
          startDate: null,
          endDate: "2026-02-14T00:00:00Z",
        }),
        subscription({
          id: "sub_tiered",
          status: "ACTIVE",
          plan: "LAUNCH",
          startDate: "2024-01-01T00:00:00Z",
          endDate: null,
        }),
        subscription({
          id: "sub_failed",
          status: "FAILED",
          startDate: "2026-02-12T00:00:00Z",
          endDate: null,
        }),
        subscription({
          id: "sub_replacement",
          status: "ACTIVE",
          startDate: "2026-02-15T09:00:00Z",
          endDate: null,
        }),
      ]);

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

  describe("given a live subscription with no recorded start beside one that has a start", () => {
    /** @scenario "A subscription with no recorded start reports the whole month" */
    it("keeps the one with no start first, as Postgres puts nulls first in a descending order", async () => {
      const repository = repositoryWith([
        subscription({
          id: "sub_dated",
          status: "ACTIVE",
          startDate: "2026-02-10T13:00:00Z",
          endDate: null,
        }),
        subscription({ id: "sub_legacy", status: "ACTIVE", startDate: null, endDate: null }),
      ]);

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
});
